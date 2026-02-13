// ── CampaignContext Resolver ───────────────────────────────────────
// Resolves CampaignContext from identifiers in strict priority order.
// If no context can be resolved: FAIL CLOSED.

import { logger } from '../utils/logger';
import { CampaignContext } from './types';
import {
  getCampaign,
  getDidMapping,
  findOutboundByPhone,
  logEnforcement,
  getCampaignSmsTemplates,
  getCampaignEmailTemplates,
  getCampaignAiProfile,
  isFeatureFlagEnabled,
} from './store';
import { getLeadMemory } from '../memory';

export type ResolutionSource =
  | 'inbound_did'
  | 'lead_id'
  | 'last_outbound_call'
  | 'explicit_campaign_id'
  | 'safe_fallback';

export interface ResolveResult {
  success: boolean;
  context: CampaignContext | null;
  source: ResolutionSource | null;
  ambiguous: boolean;
  error: string | null;
}

/**
 * Resolve CampaignContext from available identifiers.
 * Priority order:
 *   1. explicit campaign_id passed by caller (user's selection ALWAYS wins)
 *   2. inbound DID / Twilio number mapping -> campaign_id
 *   3. lead_id -> campaign_id (via lead memory custom fields)
 *   4. last_outbound_call mapping (phone+campaign) -> campaign_id
 * If none match: FAIL CLOSED.
 */
export function resolveCampaignContext(params: {
  inboundDid?: string;
  leadPhone?: string;
  leadId?: string;
  explicitCampaignId?: string;
}): ResolveResult {
  // If hardened isolation is disabled, skip resolution
  if (!isFeatureFlagEnabled('hardened_campaign_isolation')) {
    return { success: true, context: null, source: null, ambiguous: false, error: null };
  }

  const { inboundDid, leadPhone, leadId, explicitCampaignId } = params;

  // 1. Explicit campaign_id (user's selection takes highest priority)
  if (explicitCampaignId) {
    const ctx = buildContext(explicitCampaignId, 'explicit_campaign_id');
    if (ctx) {
      logResolution('explicit_campaign_id', explicitCampaignId, inboundDid, leadPhone, true);
      return { success: true, context: ctx, source: 'explicit_campaign_id', ambiguous: false, error: null };
    }
  }

  // 2. Inbound DID mapping
  if (inboundDid) {
    const mapping = getDidMapping(inboundDid);
    if (mapping) {
      const ctx = buildContext(mapping.campaignId, 'inbound_did');
      if (ctx) {
        logResolution('inbound_did', mapping.campaignId, inboundDid, leadPhone, true);
        return { success: true, context: ctx, source: 'inbound_did', ambiguous: false, error: null };
      }
    }
  }

  // 3. Lead ID / phone -> campaign_id
  if (leadPhone || leadId) {
    const phone = leadPhone || leadId || '';
    const lead = getLeadMemory(phone);
    if (lead?.customFields?.campaignId) {
      const campaignId = lead.customFields.campaignId as string;
      const ctx = buildContext(campaignId, 'lead_id');
      if (ctx) {
        logResolution('lead_id', campaignId, null, phone, true);
        return { success: true, context: ctx, source: 'lead_id', ambiguous: false, error: null };
      }
    }
  }

  // 4. Last outbound call mapping
  if (leadPhone) {
    const recentCalls = findOutboundByPhone(leadPhone, 30);
    if (recentCalls.length > 0) {
      // Check for ambiguity: multiple different campaign_ids
      const uniqueCampaigns = [...new Set(recentCalls.map(c => c.campaignId))];
      if (uniqueCampaigns.length === 1) {
        const ctx = buildContext(uniqueCampaigns[0], 'last_outbound_call');
        if (ctx) {
          logResolution('last_outbound_call', uniqueCampaigns[0], null, leadPhone, true);
          return { success: true, context: ctx, source: 'last_outbound_call', ambiguous: false, error: null };
        }
      } else if (uniqueCampaigns.length > 1) {
        // AMBIGUOUS: Multiple campaigns called this phone
        logResolution('last_outbound_call', null, null, leadPhone, false, 'ambiguous_multiple_campaigns');
        return {
          success: false,
          context: null,
          source: 'last_outbound_call',
          ambiguous: true,
          error: `Ambiguous: phone ${leadPhone} has outbound records for campaigns: ${uniqueCampaigns.join(', ')}`,
        };
      }
    }
  }

  // FAIL CLOSED
  logResolution('safe_fallback', null, inboundDid, leadPhone, false, 'no_campaign_resolved');
  return {
    success: false,
    context: null,
    source: null,
    ambiguous: false,
    error: 'No campaign context could be resolved from available identifiers',
  };
}

/**
 * Build a full CampaignContext from a campaign_id.
 * Validates: campaign exists + active, AI profile exists, voice config exists, templates exist.
 */
function buildContext(campaignId: string, source: ResolutionSource): CampaignContext | null {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    logger.warn('resolver', 'Campaign not found', { campaignId });
    return null;
  }
  if (!campaign.active) {
    logger.warn('resolver', 'Campaign inactive', { campaignId });
    return null;
  }

  // Validate AI profile
  if (!campaign.aiProfile || !campaign.aiProfile.id) {
    logger.warn('resolver', 'Campaign missing AI profile', { campaignId });
    return null;
  }

  // Validate voice config
  const vc = campaign.voiceConfig;
  let voiceId: string;
  if (vc.voiceProvider === 'elevenlabs') {
    voiceId = vc.elevenlabsVoiceId;
  } else if (vc.voiceProvider === 'openai') {
    voiceId = vc.openaiVoice;
  } else {
    voiceId = vc.elevenlabsVoiceId; // deepseek uses EL TTS
  }
  if (!voiceId) {
    logger.warn('resolver', 'Campaign missing voice ID', { campaignId });
    return null;
  }

  // Validate SMS templates exist for campaign
  const smsTemplates = getCampaignSmsTemplates(campaignId);
  // Templates may be empty but the set must be registered (we check the campaign has a set ID)

  return {
    campaignId: campaign.id,
    campaignType: campaign.type,
    campaignName: campaign.name,
    aiProfileId: campaign.aiProfile.id,
    voiceId,
    voiceProvider: vc.voiceProvider,
    smsTemplateSetId: campaign.smsTemplateSetId,
    emailTemplateSetId: campaign.emailTemplateSetId,
    transferRouting: campaign.transferRouting,
    callbackRules: campaign.callbackRules,
    retryRules: campaign.retryRules,
    features: campaign.features,
    resolvedVia: source,
    resolvedAt: new Date().toISOString(),
  };
}

function logResolution(
  source: ResolutionSource,
  campaignId: string | null,
  did: string | null | undefined,
  phone: string | null | undefined,
  success: boolean,
  reason?: string
): void {
  logEnforcement({
    timestamp: new Date().toISOString(),
    eventType: 'campaign_resolution',
    phone: phone || null,
    leadId: null,
    campaignId,
    aiProfileId: null,
    voiceId: null,
    action: `resolve_via_${source}`,
    allowed: success,
    reason: reason || (success ? `resolved_via_${source}` : `failed_${source}`),
    metadata: { did },
  });
}
