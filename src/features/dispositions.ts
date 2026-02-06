import { logger } from '../utils/logger';
import { resolveFeatureFlag, FEATURE_CALL_DISPOSITIONS } from './flags';

// ── FEATURE_CALL_DISPOSITIONS ──────────────────────────────────────
// When enabled, every call ends with a normalized disposition.
// Dispositions auto-set when possible, editable manually.
// Drive retries, SMS triggers, and suppression.

export type CallDisposition =
  | 'sale'
  | 'connected'
  | 'callback_scheduled'
  | 'not_interested'
  | 'no_answer'
  | 'voicemail'
  | 'wrong_number'
  | 'do_not_call';

export const ALL_DISPOSITIONS: CallDisposition[] = [
  'sale',
  'connected',
  'callback_scheduled',
  'not_interested',
  'no_answer',
  'voicemail',
  'wrong_number',
  'do_not_call',
];

export interface CallDispositionRecord {
  callSid: string;
  leadId: string;        // phone number
  disposition: CallDisposition;
  autoSet: boolean;       // true if system-determined, false if manually set
  setAt: string;
  setBy: 'system' | 'manual';
  notes?: string;
}

// In-memory store: callSid -> disposition record
const dispositionStore = new Map<string, CallDispositionRecord>();

// ── Auto-disposition inference ──────────────────────────────────────

/**
 * Infer a disposition from call outcome and analytics tags.
 * Returns null if no auto-disposition can be determined.
 */
export function inferDisposition(params: {
  outcome: string;
  tags: string[];
  durationMs: number;
  endReason?: string;
}): CallDisposition | null {
  const { outcome, tags, durationMs, endReason } = params;
  const reason = (endReason || '').toLowerCase();

  // Transferred = sale or connected (we use 'connected' as the transferred disposition)
  if (outcome === 'transferred') {
    return tags.includes('hot_lead') ? 'sale' : 'connected';
  }

  // DNC request
  if (tags.includes('dnc_request') || reason.includes('do not call') || reason.includes('stop calling')) {
    return 'do_not_call';
  }

  // Not interested
  if (tags.includes('not_interested') || reason.includes('not interested')) {
    return 'not_interested';
  }

  // Wrong number
  if (reason.includes('wrong number') || reason.includes('wrong person')) {
    return 'wrong_number';
  }

  // Callback scheduled
  if (tags.includes('callback_requested') || reason.includes('callback') || reason.includes('call back')) {
    return 'callback_scheduled';
  }

  // Voicemail — very short calls with no user turns often indicate voicemail
  if (outcome === 'dropped' && durationMs < 15000) {
    return 'voicemail';
  }

  // No answer — call ended very quickly
  if (outcome === 'dropped' && durationMs < 5000) {
    return 'no_answer';
  }

  // Ended normally with some conversation
  if (outcome === 'ended' && durationMs > 10000) {
    return 'connected';
  }

  return null;
}

// ── Disposition management ─────────────────────────────────────────

/**
 * Auto-set disposition for a call based on its outcome.
 * Only operates when FEATURE_CALL_DISPOSITIONS is enabled.
 */
export function autoSetDisposition(params: {
  callSid: string;
  leadId: string;
  outcome: string;
  tags: string[];
  durationMs: number;
  endReason?: string;
  workspaceId?: string;
  campaignId?: string;
}): CallDispositionRecord | null {
  if (!resolveFeatureFlag(FEATURE_CALL_DISPOSITIONS, params.workspaceId, params.campaignId)) {
    return null;
  }

  const disposition = inferDisposition(params);
  if (!disposition) return null;

  const record: CallDispositionRecord = {
    callSid: params.callSid,
    leadId: params.leadId,
    disposition,
    autoSet: true,
    setAt: new Date().toISOString(),
    setBy: 'system',
  };

  dispositionStore.set(params.callSid, record);
  logger.info('features', 'Disposition auto-set', { callSid: params.callSid, disposition });
  return record;
}

/**
 * Manually set or override the disposition for a call.
 * Only operates when FEATURE_CALL_DISPOSITIONS is enabled.
 */
export function setCallDisposition(
  callSid: string,
  leadId: string,
  disposition: CallDisposition,
  notes?: string,
  workspaceId?: string,
  campaignId?: string,
): CallDispositionRecord | null {
  if (!resolveFeatureFlag(FEATURE_CALL_DISPOSITIONS, workspaceId, campaignId)) {
    return null;
  }

  const record: CallDispositionRecord = {
    callSid,
    leadId,
    disposition,
    autoSet: false,
    setAt: new Date().toISOString(),
    setBy: 'manual',
    notes,
  };

  dispositionStore.set(callSid, record);
  logger.info('features', 'Disposition manually set', { callSid, disposition });
  return record;
}

/**
 * Get the disposition for a specific call.
 */
export function getCallDisposition(callSid: string): CallDispositionRecord | undefined {
  return dispositionStore.get(callSid);
}

/**
 * Get all disposition records, optionally filtered.
 */
export function getAllDispositions(filter?: { disposition?: CallDisposition; leadId?: string }): CallDispositionRecord[] {
  let records = Array.from(dispositionStore.values());
  if (filter?.disposition) {
    records = records.filter(r => r.disposition === filter.disposition);
  }
  if (filter?.leadId) {
    const normalized = filter.leadId.replace(/\D/g, '').replace(/^1/, '');
    records = records.filter(r => r.leadId.replace(/\D/g, '').replace(/^1/, '') === normalized);
  }
  return records;
}

// ── Disposition-driven behavior queries ────────────────────────────

/**
 * Check if a disposition indicates the lead should be retried.
 */
export function shouldRetryLead(disposition: CallDisposition): boolean {
  return ['no_answer', 'voicemail', 'callback_scheduled'].includes(disposition);
}

/**
 * Check if a disposition indicates the lead should be suppressed.
 */
export function shouldSuppressLead(disposition: CallDisposition): boolean {
  return ['do_not_call', 'wrong_number'].includes(disposition);
}

/**
 * Check if a disposition indicates an SMS follow-up is appropriate.
 */
export function shouldSendSMS(disposition: CallDisposition): boolean {
  return ['no_answer', 'voicemail', 'connected', 'callback_scheduled'].includes(disposition);
}
