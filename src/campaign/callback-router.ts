// ── Callback Intelligence Router ───────────────────────────────────
// Routes inbound callbacks to the SAME campaign experience that originally reached them.
// If ambiguous: FAIL CLOSED to safe fallback IVR.

import { logger } from '../utils/logger';
import { CampaignContext } from './types';
import { resolveCampaignContext } from './resolver';
import {
  getDidMapping,
  findOutboundByPhone,
  logEnforcement,
  isFeatureFlagEnabled,
  getCampaign,
} from './store';
import { config } from '../config';
import { escapeXml } from '../twilio/twiml';

export interface CallbackResolution {
  resolved: boolean;
  context: CampaignContext | null;
  useFallbackIvr: boolean;
  fallbackReason: string | null;
}

/**
 * Resolve campaign for an inbound callback.
 * Strict rules:
 *   1. inbound DID -> campaign_id (primary)
 *   2. recent call history: to_phone == inbound_caller within X days -> campaign_id
 *   3. lead match by phone -> campaign_id
 * If ambiguous (multiple campaigns): FAIL CLOSED to safe fallback IVR.
 */
export function resolveCallbackCampaign(params: {
  callerPhone: string;
  calledDid: string;
  lookbackDays?: number;
}): CallbackResolution {
  const { callerPhone, calledDid, lookbackDays = 30 } = params;

  // If hardened isolation is off, skip
  if (!isFeatureFlagEnabled('hardened_campaign_isolation')) {
    return { resolved: true, context: null, useFallbackIvr: false, fallbackReason: null };
  }

  // 1. DID mapping (primary)
  const didMapping = getDidMapping(calledDid);
  if (didMapping) {
    const resolution = resolveCampaignContext({
      inboundDid: calledDid,
      leadPhone: callerPhone,
    });
    if (resolution.success && resolution.context) {
      logger.info('callback-router', 'Callback resolved via DID', {
        callerPhone,
        calledDid,
        campaignId: resolution.context.campaignId,
      });
      return { resolved: true, context: resolution.context, useFallbackIvr: false, fallbackReason: null };
    }
  }

  // 2. Recent call history match
  const recentCalls = findOutboundByPhone(callerPhone, lookbackDays);
  if (recentCalls.length > 0) {
    const uniqueCampaigns = [...new Set(recentCalls.map(c => c.campaignId))];

    if (uniqueCampaigns.length === 1) {
      const resolution = resolveCampaignContext({
        leadPhone: callerPhone,
        explicitCampaignId: uniqueCampaigns[0],
      });
      if (resolution.success && resolution.context) {
        logger.info('callback-router', 'Callback resolved via call history', {
          callerPhone,
          campaignId: resolution.context.campaignId,
        });
        return { resolved: true, context: resolution.context, useFallbackIvr: false, fallbackReason: null };
      }
    }

    if (uniqueCampaigns.length > 1) {
      // AMBIGUOUS: Multiple campaigns called this phone -> FALLBACK IVR
      logEnforcement({
        timestamp: new Date().toISOString(),
        eventType: 'callback_ambiguous',
        phone: callerPhone,
        leadId: null,
        campaignId: null,
        aiProfileId: null,
        voiceId: null,
        action: 'inbound_callback',
        allowed: false,
        reason: `ambiguous_callback: campaigns ${uniqueCampaigns.join(', ')}`,
      });
      logger.warn('callback-router', 'Ambiguous callback — multiple campaigns', {
        callerPhone,
        campaigns: uniqueCampaigns,
      });
      return {
        resolved: false,
        context: null,
        useFallbackIvr: true,
        fallbackReason: `Multiple campaigns: ${uniqueCampaigns.join(', ')}`,
      };
    }
  }

  // 3. Lead match (via resolver)
  const leadResolution = resolveCampaignContext({ leadPhone: callerPhone });
  if (leadResolution.success && leadResolution.context) {
    logger.info('callback-router', 'Callback resolved via lead match', {
      callerPhone,
      campaignId: leadResolution.context.campaignId,
    });
    return { resolved: true, context: leadResolution.context, useFallbackIvr: false, fallbackReason: null };
  }

  // FAIL CLOSED -> safe fallback IVR
  logEnforcement({
    timestamp: new Date().toISOString(),
    eventType: 'callback_unresolved',
    phone: callerPhone,
    leadId: null,
    campaignId: null,
    aiProfileId: null,
    voiceId: null,
    action: 'inbound_callback',
    allowed: false,
    reason: 'no_campaign_resolved_for_callback',
  });
  logger.warn('callback-router', 'Callback unresolved — using fallback IVR', { callerPhone, calledDid });
  return {
    resolved: false,
    context: null,
    useFallbackIvr: true,
    fallbackReason: 'No campaign resolved for callback',
  };
}

/**
 * Generate safe fallback IVR TwiML.
 * Neutral message that does NOT mention Quoting Fast, auto quotes, agencies, or anything campaign-specific.
 * Collects: "Press 1 if you requested an auto insurance quote, press 2 if you're an insurance agency calling us back."
 * Then locks to selected campaign_id.
 */
export function buildFallbackIvrTwiml(callerPhone: string): string {
  const gatherUrl = `${config.baseUrl}/twilio/campaign-select`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${escapeXml(gatherUrl)}?caller=${escapeXml(callerPhone)}" method="POST" timeout="10">
    <Say voice="Polly.Matthew">Thank you for calling. To help us direct your call, please make a selection.</Say>
    <Pause length="1"/>
    <Say voice="Polly.Matthew">If you recently requested a quote and are calling us back, press 1.</Say>
    <Pause length="1"/>
    <Say voice="Polly.Matthew">If you are a business partner calling us back, press 2.</Say>
  </Gather>
  <Say voice="Polly.Matthew">We didn't receive a selection. Please call back and try again. Goodbye.</Say>
</Response>`;
}

/**
 * Handle the IVR selection and lock to the selected campaign.
 * Returns TwiML to continue the call with the correct campaign's AI agent.
 */
export function handleCampaignSelection(digit: string, callerPhone: string): {
  campaignId: string | null;
  twiml: string;
} {
  let campaignId: string | null = null;

  if (digit === '1') {
    campaignId = 'campaign-consumer-auto';
  } else if (digit === '2') {
    campaignId = 'campaign-agency-dev';
  }

  if (!campaignId) {
    return {
      campaignId: null,
      twiml: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Sorry, that was not a valid selection. Goodbye.</Say>
  <Hangup/>
</Response>`,
    };
  }

  const campaign = getCampaign(campaignId);
  if (!campaign || !campaign.active) {
    return {
      campaignId,
      twiml: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">We are unable to connect you at this time. Please try again later. Goodbye.</Say>
  <Hangup/>
</Response>`,
    };
  }

  logEnforcement({
    timestamp: new Date().toISOString(),
    eventType: 'callback_ivr_selection',
    phone: callerPhone,
    leadId: null,
    campaignId,
    aiProfileId: campaign.aiProfile.id,
    voiceId: null,
    action: 'ivr_campaign_lock',
    allowed: true,
    reason: `caller_selected_digit_${digit}`,
  });

  // Connect to the media stream with campaign context
  const wsUrl = config.baseUrl.replace(/^http/, 'ws') + '/twilio/stream';
  return {
    campaignId,
    twiml: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Thank you. Connecting you now.</Say>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="direction" value="inbound" />
      <Parameter name="callerNumber" value="${escapeXml(callerPhone)}" />
      <Parameter name="campaignId" value="${escapeXml(campaignId)}" />
    </Stream>
  </Connect>
</Response>`,
  };
}

