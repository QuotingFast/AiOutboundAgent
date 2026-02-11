// ── Campaign Enforcement Middleware ─────────────────────────────────
// Single gating layer in front of:
//   - Outbound dial initiation
//   - Inbound call/callback handling
//   - SMS sending
//   - Email sending
//   - Scheduled callback execution
//
// FAIL CLOSED: If CampaignContext is missing/invalid, block the action.

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { CampaignContext, CampaignType } from './types';
import { resolveCampaignContext, ResolveResult } from './resolver';
import {
  getCampaign,
  logEnforcement,
  getCampaignSmsTemplates,
  getCampaignEmailTemplates,
  getCampaignAiProfile,
  isFeatureFlagEnabled,
} from './store';

// ── Express Request Extension ──────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      campaignContext?: CampaignContext;
    }
  }
}

// ── Middleware Types ────────────────────────────────────────────────

export interface EnforcementResult {
  allowed: boolean;
  context: CampaignContext | null;
  reason: string;
  ambiguous: boolean;
}

// ── Core Enforcement Functions ─────────────────────────────────────

/**
 * Resolve + Validate CampaignContext for any action.
 * Returns enforcement result with allow/deny + reason.
 */
export function enforceCampaignContext(params: {
  inboundDid?: string;
  leadPhone?: string;
  leadId?: string;
  explicitCampaignId?: string;
  action: string;
}): EnforcementResult {
  // If hardened isolation is off, allow everything (legacy mode)
  if (!isFeatureFlagEnabled('hardened_campaign_isolation')) {
    return { allowed: true, context: null, reason: 'hardened_isolation_disabled', ambiguous: false };
  }

  const resolution = resolveCampaignContext({
    inboundDid: params.inboundDid,
    leadPhone: params.leadPhone,
    leadId: params.leadId,
    explicitCampaignId: params.explicitCampaignId,
  });

  if (!resolution.success || !resolution.context) {
    logEnforcement({
      timestamp: new Date().toISOString(),
      eventType: 'enforcement_block',
      phone: params.leadPhone || null,
      leadId: params.leadId || null,
      campaignId: null,
      aiProfileId: null,
      voiceId: null,
      action: params.action,
      allowed: false,
      reason: resolution.error || 'no_campaign_context',
      metadata: { ambiguous: resolution.ambiguous },
    });
    return {
      allowed: false,
      context: null,
      reason: resolution.error || 'no_campaign_context',
      ambiguous: resolution.ambiguous,
    };
  }

  // Validate context integrity
  const validationResult = validateCampaignContext(resolution.context, params.action);
  if (!validationResult.allowed) {
    return validationResult;
  }

  // Log successful enforcement
  logEnforcement({
    timestamp: new Date().toISOString(),
    eventType: 'enforcement_allow',
    phone: params.leadPhone || null,
    leadId: params.leadId || null,
    campaignId: resolution.context.campaignId,
    aiProfileId: resolution.context.aiProfileId,
    voiceId: resolution.context.voiceId,
    action: params.action,
    allowed: true,
    reason: `resolved_via_${resolution.source}`,
  });

  return {
    allowed: true,
    context: resolution.context,
    reason: `allowed_via_${resolution.source}`,
    ambiguous: false,
  };
}

/**
 * Validate CampaignContext integrity:
 *   - campaign_id exists + active
 *   - ai_profile_id exists + belongs to campaign_id
 *   - voice_id exists + belongs to campaign_id
 *   - messaging templates exist + belong to campaign_id
 *   - no cross-wiring (consumer ↔ agency)
 */
function validateCampaignContext(ctx: CampaignContext, action: string): EnforcementResult {
  const campaign = getCampaign(ctx.campaignId);

  // Campaign must exist and be active
  if (!campaign) {
    return blockResult(ctx, action, 'campaign_not_found');
  }
  if (!campaign.active) {
    return blockResult(ctx, action, 'campaign_inactive');
  }

  // AI profile must belong to campaign
  if (ctx.aiProfileId !== campaign.aiProfile.id) {
    return blockResult(ctx, action, `ai_profile_mismatch: ${ctx.aiProfileId} not owned by ${ctx.campaignId}`);
  }

  // Voice must match campaign config
  const vc = campaign.voiceConfig;
  const expectedVoice = vc.voiceProvider === 'openai' ? vc.openaiVoice : vc.elevenlabsVoiceId;
  if (ctx.voiceId !== expectedVoice) {
    return blockResult(ctx, action, `voice_mismatch: ${ctx.voiceId} not configured for ${ctx.campaignId}`);
  }

  // Template set must belong to campaign
  if (ctx.smsTemplateSetId !== campaign.smsTemplateSetId) {
    return blockResult(ctx, action, `sms_template_set_mismatch: ${ctx.smsTemplateSetId} not owned by ${ctx.campaignId}`);
  }

  // Enforce "no cross-wiring" policy locks
  const crossWireResult = enforceNoCrossWiring(ctx, action);
  if (!crossWireResult.allowed) {
    return crossWireResult;
  }

  return { allowed: true, context: ctx, reason: 'validated', ambiguous: false };
}

/**
 * Policy locks:
 *   - Consumer calls must never use agency prompts
 *   - Agency calls must never use consumer prompts
 */
function enforceNoCrossWiring(ctx: CampaignContext, action: string): EnforcementResult {
  const campaign = getCampaign(ctx.campaignId);
  if (!campaign) {
    return blockResult(ctx, action, 'campaign_not_found_for_cross_wire_check');
  }

  // Cross-campaign template check: ensure templates loaded match campaign type
  const smsTemplates = getCampaignSmsTemplates(ctx.campaignId);
  for (const tpl of smsTemplates) {
    // Templates are already scoped by campaign ID in the store,
    // so if they exist under this campaign, they belong.
    // Additional policy: check template IDs don't contain wrong campaign prefix
    if (ctx.campaignType === 'consumer_auto_insurance' && tpl.id.startsWith('agency-')) {
      return blockResult(ctx, action, `cross_wire_detected: agency template ${tpl.id} in consumer campaign`);
    }
    if (ctx.campaignType === 'agency_development' && tpl.id.startsWith('consumer-')) {
      return blockResult(ctx, action, `cross_wire_detected: consumer template ${tpl.id} in agency campaign`);
    }
  }

  return { allowed: true, context: ctx, reason: 'no_cross_wiring', ambiguous: false };
}

function blockResult(ctx: CampaignContext, action: string, reason: string): EnforcementResult {
  logEnforcement({
    timestamp: new Date().toISOString(),
    eventType: 'enforcement_block',
    phone: null,
    leadId: null,
    campaignId: ctx.campaignId,
    aiProfileId: ctx.aiProfileId,
    voiceId: ctx.voiceId,
    action,
    allowed: false,
    reason,
  });
  return { allowed: false, context: ctx, reason, ambiguous: false };
}

// ── Express Middleware ──────────────────────────────────────────────

/**
 * Express middleware that resolves CampaignContext from the request.
 * Attaches to req.campaignContext if resolved.
 * For routes that REQUIRE campaign context, use requireCampaignContext().
 */
export function resolveCampaignMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!isFeatureFlagEnabled('hardened_campaign_isolation')) {
    next();
    return;
  }

  const campaignId = req.body?.campaign_id || req.query?.campaign_id as string;
  const phone = req.body?.to || req.body?.phone || req.params?.phone;
  const inboundDid = req.body?.To || req.body?.Called; // Twilio webhook fields

  const result = enforceCampaignContext({
    inboundDid,
    leadPhone: phone,
    explicitCampaignId: campaignId,
    action: `${req.method} ${req.path}`,
  });

  if (result.context) {
    req.campaignContext = result.context;
  }

  next();
}

/**
 * Express middleware that REQUIRES CampaignContext.
 * If context can't be resolved: 403 fail-closed response.
 */
export function requireCampaignContext(req: Request, res: Response, next: NextFunction): void {
  if (!isFeatureFlagEnabled('hardened_campaign_isolation')) {
    next();
    return;
  }

  const campaignId = req.body?.campaign_id || req.query?.campaign_id as string;
  const phone = req.body?.to || req.body?.phone || req.params?.phone;
  const inboundDid = req.body?.To || req.body?.Called;

  const result = enforceCampaignContext({
    inboundDid,
    leadPhone: phone,
    explicitCampaignId: campaignId,
    action: `${req.method} ${req.path}`,
  });

  if (!result.allowed) {
    logger.warn('middleware', 'Campaign context required but not resolved — fail closed', {
      path: req.path,
      reason: result.reason,
      ambiguous: result.ambiguous,
    });
    res.status(403).json({
      error: 'Campaign context required',
      reason: result.reason,
      ambiguous: result.ambiguous,
      action: 'fail_closed',
    });
    return;
  }

  req.campaignContext = result.context!;
  next();
}

// ── Programmatic Enforcement (non-Express) ─────────────────────────

/**
 * Enforce campaign context for outbound dial.
 * Returns CampaignContext or null (fail closed).
 */
export function enforceOutboundDial(params: {
  phone: string;
  campaignId?: string;
  leadId?: string;
}): EnforcementResult {
  return enforceCampaignContext({
    leadPhone: params.phone,
    leadId: params.leadId,
    explicitCampaignId: params.campaignId,
    action: 'outbound_dial',
  });
}

/**
 * Enforce campaign context for inbound call.
 */
export function enforceInboundCall(params: {
  callerPhone: string;
  calledDid: string;
}): EnforcementResult {
  return enforceCampaignContext({
    inboundDid: params.calledDid,
    leadPhone: params.callerPhone,
    action: 'inbound_call',
  });
}

/**
 * Enforce campaign context for SMS sending.
 */
export function enforceSmsSend(params: {
  phone: string;
  campaignId?: string;
}): EnforcementResult {
  return enforceCampaignContext({
    leadPhone: params.phone,
    explicitCampaignId: params.campaignId,
    action: 'sms_send',
  });
}

/**
 * Enforce campaign context for email sending.
 */
export function enforceEmailSend(params: {
  phone: string;
  campaignId?: string;
}): EnforcementResult {
  return enforceCampaignContext({
    leadPhone: params.phone,
    explicitCampaignId: params.campaignId,
    action: 'email_send',
  });
}

/**
 * Enforce campaign context for scheduled callback execution.
 */
export function enforceScheduledCallback(params: {
  phone: string;
  campaignId: string;
  aiProfileId: string;
  voiceId: string;
}): EnforcementResult {
  const result = enforceCampaignContext({
    leadPhone: params.phone,
    explicitCampaignId: params.campaignId,
    action: 'scheduled_callback',
  });

  if (!result.allowed || !result.context) return result;

  // Additional validation: stored fields must match resolved context
  if (result.context.aiProfileId !== params.aiProfileId) {
    logEnforcement({
      timestamp: new Date().toISOString(),
      eventType: 'enforcement_block',
      phone: params.phone,
      leadId: null,
      campaignId: params.campaignId,
      aiProfileId: params.aiProfileId,
      voiceId: params.voiceId,
      action: 'scheduled_callback',
      allowed: false,
      reason: `ai_profile_mismatch_on_callback: expected ${result.context.aiProfileId}, got ${params.aiProfileId}`,
    });
    return { allowed: false, context: null, reason: 'ai_profile_mismatch_on_callback', ambiguous: false };
  }

  if (result.context.voiceId !== params.voiceId) {
    logEnforcement({
      timestamp: new Date().toISOString(),
      eventType: 'enforcement_block',
      phone: params.phone,
      leadId: null,
      campaignId: params.campaignId,
      aiProfileId: params.aiProfileId,
      voiceId: params.voiceId,
      action: 'scheduled_callback',
      allowed: false,
      reason: `voice_mismatch_on_callback: expected ${result.context.voiceId}, got ${params.voiceId}`,
    });
    return { allowed: false, context: null, reason: 'voice_mismatch_on_callback', ambiguous: false };
  }

  return result;
}
