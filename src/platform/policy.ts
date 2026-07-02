// ── Compliance Policy Engine ───────────────────────────────────────
// Single evaluation point for every outreach attempt (call or SMS).
// Consumes persisted compliance state (DNC, consent, suppression),
// lead-local quiet hours, frequency caps, lead age, and disposition
// suppression. Every decision is written to the event ledger so the
// Compliance Center can show exactly what was blocked and why.

import { loadData, scheduleSave } from '../db/persistence';
import { isOnDnc, getConsent } from '../compliance';
import { getLeadMemory } from '../memory';
import { resolveTimezone, localTimeIn } from './timezone';
import { recordEvent, normalizePhone, queryEvents } from './events';
import { logger } from '../utils/logger';

export type OutreachChannel = 'call' | 'sms';

export interface PolicyConfig {
  enforced: boolean;                 // master switch for call/SMS gating
  consentRequired: boolean;          // block outreach without a consent record
  consentMaxAgeDays: number;         // consent older than this fails (0 = no limit)
  quietHoursStart: number;           // lead-local hour outreach may begin (inclusive)
  quietHoursEnd: number;             // lead-local hour outreach must stop (exclusive)
  maxCallsPerDay: number;            // per lead phone
  maxSmsPerDay: number;
  maxTotalAttempts: number;          // lifetime call attempts per lead (0 = no limit)
  maxLeadAgeDays: number;            // don't cold-call leads older than this (0 = no limit)
  blockedStates: string[];           // states outreach is disabled for entirely
  suppressDispositions: string[];    // lead dispositions that stop outreach
  perCampaign: Record<string, Partial<Omit<PolicyConfig, 'perCampaign'>>>;
}

const DEFAULT_CONFIG: PolicyConfig = {
  enforced: true,
  consentRequired: false,            // opt-in: flip when consent records are backfilled
  consentMaxAgeDays: 90,
  quietHoursStart: 8,
  quietHoursEnd: 21,
  maxCallsPerDay: 4,
  maxSmsPerDay: 2,
  maxTotalAttempts: 12,
  maxLeadAgeDays: 30,
  blockedStates: [],
  suppressDispositions: ['dnc', 'not_interested', 'wrong_number', 'transferred'],
  perCampaign: {},
};

const STORE_KEY = 'platform_policy';
let config: PolicyConfig = { ...DEFAULT_CONFIG };

// SMS STOP suppression is tracked separately from voice DNC so the
// compliance center can distinguish them; a STOP also adds to DNC.
interface SuppressionState {
  smsStop: Record<string, string>;   // phone -> ISO timestamp
  complaints: Record<string, { at: string; note: string }>;
}
const SUPPRESSION_KEY = 'platform_suppression';
let suppression: SuppressionState = { smsStop: {}, complaints: {} };

export function loadPolicy(): void {
  const saved = loadData<PolicyConfig>(STORE_KEY);
  if (saved) config = { ...DEFAULT_CONFIG, ...saved, perCampaign: saved.perCampaign || {} };
  const sup = loadData<SuppressionState>(SUPPRESSION_KEY);
  if (sup) suppression = { smsStop: sup.smsStop || {}, complaints: sup.complaints || {} };
  logger.info('policy', `Policy engine loaded — enforced=${config.enforced} consentRequired=${config.consentRequired}`);
}

export function getPolicyConfig(): PolicyConfig {
  return config;
}

export function updatePolicyConfig(updates: Partial<PolicyConfig>, actor = 'system'): PolicyConfig {
  const before = { ...config };
  config = { ...config, ...updates, perCampaign: updates.perCampaign ?? config.perCampaign };
  scheduleSave(STORE_KEY, () => config);
  recordEvent('config.changed', { scope: 'policy', updates, before: diffKeys(before, updates) }, { actor });
  return config;
}

function diffKeys(before: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(updates)) out[k] = before[k];
  return out;
}

function effectiveConfig(campaignId?: string): Omit<PolicyConfig, 'perCampaign'> {
  const overrides = campaignId ? config.perCampaign[campaignId] || {} : {};
  const { perCampaign: _ignored, ...base } = config;
  return { ...base, ...overrides };
}

// ── Suppression management ──────────────────────────────────────────

export function recordSmsStop(phone: string, source = 'sms'): void {
  const p = normalizePhone(phone);
  suppression.smsStop[p] = new Date().toISOString();
  scheduleSave(SUPPRESSION_KEY, () => suppression);
  recordEvent('sms.stop', { source }, { phone: p });
}

export function hasSmsStop(phone: string): boolean {
  return Boolean(suppression.smsStop[normalizePhone(phone)]);
}

export function clearSmsStop(phone: string, actor: string): void {
  const p = normalizePhone(phone);
  if (suppression.smsStop[p]) {
    delete suppression.smsStop[p];
    scheduleSave(SUPPRESSION_KEY, () => suppression);
    recordEvent('config.changed', { scope: 'suppression', action: 'sms_stop_cleared' }, { actor, phone: p });
  }
}

export function recordComplaint(phone: string, note: string, actor = 'system'): void {
  const p = normalizePhone(phone);
  suppression.complaints[p] = { at: new Date().toISOString(), note };
  scheduleSave(SUPPRESSION_KEY, () => suppression);
  recordEvent('complaint.opened', { note }, { actor, phone: p });
}

export function hasComplaint(phone: string): boolean {
  return Boolean(suppression.complaints[normalizePhone(phone)]);
}

export function listSuppressions(): { smsStop: Array<{ phone: string; at: string }>; complaints: Array<{ phone: string; at: string; note: string }> } {
  return {
    smsStop: Object.entries(suppression.smsStop).map(([phone, at]) => ({ phone, at })),
    complaints: Object.entries(suppression.complaints).map(([phone, v]) => ({ phone, ...v })),
  };
}

// ── Evaluation ──────────────────────────────────────────────────────

export interface PolicyBlock {
  code: string;
  reason: string;
  hard: boolean;        // hard blocks can never be overridden by flags
}

export interface PolicyDecision {
  allowed: boolean;
  enforced: boolean;    // whether the caller should actually block on this
  channel: OutreachChannel;
  phone: string;
  campaignId?: string;
  blocks: PolicyBlock[];
  warnings: string[];
  evaluated: string[];  // rule names that ran
  localHour?: number;
  tz?: string;
  at: string;
}

export interface OutreachRequest {
  channel: OutreachChannel;
  phone: string;
  state?: string;
  campaignId?: string;
  leadCreatedAt?: string;           // ISO; falls back to lead memory firstContactDate
  isCallback?: boolean;             // consumer-requested callbacks bypass lead-age + attempt caps
  isTestNumber?: boolean;           // whitelisted internal test numbers bypass windows/caps
  now?: Date;
}

export function evaluateOutreach(req: OutreachRequest): PolicyDecision {
  const cfg = effectiveConfig(req.campaignId);
  const phone = normalizePhone(req.phone);
  const now = req.now || new Date();
  const blocks: PolicyBlock[] = [];
  const warnings: string[] = [];
  const evaluated: string[] = [];
  const lead = getLeadMemory(phone);

  // 1. DNC — hard block, always enforced regardless of master switch.
  evaluated.push('dnc');
  if (isOnDnc(phone)) blocks.push({ code: 'dnc', reason: 'Number is on the do-not-call list', hard: true });

  // 2. SMS STOP — hard block for SMS; warning for calls.
  evaluated.push('sms_stop');
  if (hasSmsStop(phone)) {
    if (req.channel === 'sms') blocks.push({ code: 'sms_stop', reason: 'Consumer replied STOP — SMS suppressed', hard: true });
    else warnings.push('Consumer opted out of SMS (voice still permitted unless on DNC)');
  }

  // 3. Complaint — hard block on both channels.
  evaluated.push('complaint');
  if (hasComplaint(phone)) blocks.push({ code: 'complaint', reason: 'Open complaint — outreach suspended pending review', hard: true });

  // 4. Disposition suppression.
  evaluated.push('disposition');
  if (lead?.disposition && cfg.suppressDispositions.includes(lead.disposition)) {
    blocks.push({ code: 'disposition', reason: `Lead disposition '${lead.disposition}' suppresses outreach`, hard: lead.disposition === 'dnc' });
  }

  // 5. Consent.
  evaluated.push('consent');
  const consent = getConsent(phone);
  if (!consent) {
    if (cfg.consentRequired) blocks.push({ code: 'consent_missing', reason: 'No documented consent record', hard: false });
    else warnings.push('No documented consent record on file');
  } else if (cfg.consentMaxAgeDays > 0) {
    const ageDays = (now.getTime() - new Date(consent.timestamp).getTime()) / 86400000;
    if (ageDays > cfg.consentMaxAgeDays) {
      if (cfg.consentRequired) blocks.push({ code: 'consent_stale', reason: `Consent is ${Math.floor(ageDays)} days old (max ${cfg.consentMaxAgeDays})`, hard: false });
      else warnings.push(`Consent is ${Math.floor(ageDays)} days old`);
    }
  }

  // 6. Blocked states.
  evaluated.push('state');
  const st = (req.state || lead?.state || '').toUpperCase();
  if (st && cfg.blockedStates.map(s => s.toUpperCase()).includes(st)) {
    blocks.push({ code: 'blocked_state', reason: `Outreach disabled for state ${st}`, hard: false });
  }

  // 7. Quiet hours in the lead's local timezone.
  evaluated.push('quiet_hours');
  const { tz } = resolveTimezone(st, phone);
  const lt = localTimeIn(tz, now);
  if (!req.isTestNumber && (lt.hour < cfg.quietHoursStart || lt.hour >= cfg.quietHoursEnd)) {
    blocks.push({
      code: 'quiet_hours',
      reason: `Local time ${lt.hour}:${String(lt.minute).padStart(2, '0')} (${tz}) outside ${cfg.quietHoursStart}:00–${cfg.quietHoursEnd}:00`,
      hard: false,
    });
  }

  // 8. Frequency caps (per-day per channel, from the event ledger).
  evaluated.push('frequency');
  if (!req.isTestNumber) {
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    if (req.channel === 'call' && cfg.maxCallsPerDay > 0) {
      const todays = queryEvents({ type: 'call.attempted', phone, since: dayStart.toISOString(), limit: 0 }).total;
      if (todays >= cfg.maxCallsPerDay) blocks.push({ code: 'daily_call_cap', reason: `${todays} calls today (cap ${cfg.maxCallsPerDay})`, hard: false });
    }
    if (req.channel === 'sms' && cfg.maxSmsPerDay > 0) {
      const todays = queryEvents({ type: 'sms.sent', phone, since: dayStart.toISOString(), limit: 0 }).total;
      if (todays >= cfg.maxSmsPerDay) blocks.push({ code: 'daily_sms_cap', reason: `${todays} SMS today (cap ${cfg.maxSmsPerDay})`, hard: false });
    }
    if (req.channel === 'call' && cfg.maxTotalAttempts > 0 && !req.isCallback) {
      const total = queryEvents({ type: 'call.attempted', phone, limit: 0 }).total;
      if (total >= cfg.maxTotalAttempts) blocks.push({ code: 'total_attempt_cap', reason: `${total} lifetime attempts (cap ${cfg.maxTotalAttempts})`, hard: false });
    }
  }

  // 9. Lead age (skipped for consumer-requested callbacks).
  evaluated.push('lead_age');
  if (!req.isCallback && cfg.maxLeadAgeDays > 0) {
    const created = req.leadCreatedAt
      || (lead?.customFields?.receivedAt as string | undefined)
      || lead?.callHistory?.[0]?.timestamp;
    if (created) {
      const ageDays = (now.getTime() - new Date(created).getTime()) / 86400000;
      if (ageDays > cfg.maxLeadAgeDays) {
        blocks.push({ code: 'lead_age', reason: `Lead is ${Math.floor(ageDays)} days old (max ${cfg.maxLeadAgeDays})`, hard: false });
      }
    }
  }

  const hardBlocked = blocks.some(b => b.hard);
  const allowed = blocks.length === 0;
  const enforced = hardBlocked || cfg.enforced;

  const decision: PolicyDecision = {
    allowed, enforced,
    channel: req.channel, phone, campaignId: req.campaignId,
    blocks, warnings, evaluated,
    localHour: lt.hour, tz,
    at: now.toISOString(),
  };

  recordEvent(allowed ? 'policy.allowed' : 'policy.blocked', {
    channel: req.channel,
    blocks: blocks.map(b => b.code),
    reasons: blocks.map(b => b.reason),
    warnings, enforced, tz, localHour: lt.hour,
  }, { phone, campaignId: req.campaignId });

  return decision;
}

/** Convenience: should this outreach actually be stopped right now? */
export function isBlocked(decision: PolicyDecision): boolean {
  return !decision.allowed && decision.enforced;
}
