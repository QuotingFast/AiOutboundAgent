import { logger } from '../utils/logger';
import { resolveFeatureFlag, FEATURE_AI_SMS_AUTOMATION } from './flags';
import { sendSMS } from '../workflows';
import { addToDnc } from '../compliance';
import { config } from '../config';

// ── FEATURE_AI_SMS_AUTOMATION ──────────────────────────────────────
// When enabled, AI-initiated SMS messages are sent based on campaign triggers.
// Campaign-level toggles control which SMS triggers are active.
// STOP instantly suppresses all future SMS + calls for that lead.

export type SMSTrigger = 'no_answer' | 'after_call' | 'before_callback';

// ── Campaign SMS configuration ─────────────────────────────────────

export interface CampaignSMSConfig {
  campaignId: string;
  workspaceId?: string;
  triggers: Record<SMSTrigger, boolean>;   // which triggers are enabled
  customTemplates?: Partial<Record<SMSTrigger, string>>; // optional custom templates per trigger
}

// In-memory store: campaignId -> config
const campaignSMSConfigs = new Map<string, CampaignSMSConfig>();

// ── SMS log per lead ───────────────────────────────────────────────

export interface SMSLogEntry {
  id: string;
  leadId: string;        // phone number
  trigger: SMSTrigger;
  message: string;
  sentAt: string;
  campaignId?: string;
  status: 'sent' | 'failed' | 'suppressed';
}

const smsLog: SMSLogEntry[] = [];
let smsSequence = 0;

// ── Suppression list (STOP requests) ───────────────────────────────
// Leads who have sent STOP are suppressed from ALL future SMS and calls.

const smsSuppressed = new Set<string>();

// ── Default AI-generated message templates ─────────────────────────

const defaultTemplates: Record<SMSTrigger, string> = {
  no_answer: 'Hi {{name}}, we tried reaching you about your auto insurance quote request. Feel free to call us back or reply here when you have a moment! - {{company}}',
  after_call: 'Thanks for chatting with us, {{name}}! If you have any questions about auto insurance, just reply here. - {{company}}',
  before_callback: 'Hi {{name}}, just a reminder — we have a call scheduled with you shortly about your auto insurance quote. Talk soon! - {{company}}',
};

function formatTemplate(template: string, vars: { name?: string; company?: string }): string {
  return template
    .replace(/\{\{name\}\}/g, vars.name || 'there')
    .replace(/\{\{company\}\}/g, vars.company || 'QuotingFast');
}

// ── Campaign SMS config management ─────────────────────────────────

export function setCampaignSMSConfig(cfg: CampaignSMSConfig): void {
  campaignSMSConfigs.set(cfg.campaignId, cfg);
  logger.info('features', 'Campaign SMS config set', { campaignId: cfg.campaignId, triggers: cfg.triggers });
}

export function getCampaignSMSConfig(campaignId: string): CampaignSMSConfig | undefined {
  return campaignSMSConfigs.get(campaignId);
}

export function removeCampaignSMSConfig(campaignId: string): boolean {
  return campaignSMSConfigs.delete(campaignId);
}

// ── STOP handling ──────────────────────────────────────────────────

/**
 * Process a STOP request from a lead. Suppresses all future SMS AND calls.
 */
export function processStopRequest(phone: string): void {
  const normalized = phone.replace(/\D/g, '').replace(/^1/, '');
  smsSuppressed.add(normalized);
  // Also add to DNC to suppress calls
  addToDnc(phone);
  logger.info('features', 'STOP processed — SMS + calls suppressed', { phone: normalized });
}

/**
 * Check if a lead is SMS-suppressed (sent STOP).
 */
export function isSMSSuppressed(phone: string): boolean {
  const normalized = phone.replace(/\D/g, '').replace(/^1/, '');
  return smsSuppressed.has(normalized);
}

// ── Core: send AI-triggered SMS ────────────────────────────────────

/**
 * Attempt to send an AI-triggered SMS for a given trigger.
 * Checks feature flag, campaign config, and suppression before sending.
 */
export async function triggerAISMS(params: {
  trigger: SMSTrigger;
  leadPhone: string;
  leadName: string;
  campaignId?: string;
  workspaceId?: string;
}): Promise<SMSLogEntry | null> {
  const { trigger, leadPhone, leadName, campaignId, workspaceId } = params;

  // Feature flag check
  if (!resolveFeatureFlag(FEATURE_AI_SMS_AUTOMATION, workspaceId, campaignId)) {
    return null;
  }

  // Suppression check
  if (isSMSSuppressed(leadPhone)) {
    const entry = logSMS(leadPhone, trigger, '(suppressed)', campaignId, 'suppressed');
    logger.info('features', 'SMS suppressed for lead', { leadPhone, trigger });
    return entry;
  }

  // Campaign trigger check
  if (campaignId) {
    const cfg = campaignSMSConfigs.get(campaignId);
    if (cfg && !cfg.triggers[trigger]) {
      logger.info('features', 'SMS trigger disabled for campaign', { campaignId, trigger });
      return null;
    }
  }

  // Build message from template (campaign custom or default)
  let template = defaultTemplates[trigger];
  if (campaignId) {
    const cfg = campaignSMSConfigs.get(campaignId);
    if (cfg?.customTemplates?.[trigger]) {
      template = cfg.customTemplates[trigger]!;
    }
  }

  const companyName = config.twilio?.fromNumber ? 'QuotingFast' : 'QuotingFast';
  const message = formatTemplate(template, { name: leadName, company: companyName });

  // Send via existing SMS infrastructure
  const success = await sendSMS(leadPhone, message);

  const entry = logSMS(leadPhone, trigger, message, campaignId, success ? 'sent' : 'failed');
  return entry;
}

// ── SMS log management ─────────────────────────────────────────────

function logSMS(
  leadId: string,
  trigger: SMSTrigger,
  message: string,
  campaignId: string | undefined,
  status: SMSLogEntry['status'],
): SMSLogEntry {
  const entry: SMSLogEntry = {
    id: `sms-${++smsSequence}`,
    leadId,
    trigger,
    message,
    sentAt: new Date().toISOString(),
    campaignId,
    status,
  };
  smsLog.push(entry);
  return entry;
}

export function getSMSLog(leadId?: string): SMSLogEntry[] {
  if (leadId) {
    const normalized = leadId.replace(/\D/g, '').replace(/^1/, '');
    return smsLog.filter(e => e.leadId.replace(/\D/g, '').replace(/^1/, '') === normalized);
  }
  return [...smsLog];
}
