import { logger } from '../utils/logger';

// ── Do Not Call (DNC) list ──────────────────────────────────────────

const dncSet = new Set<string>();

export function addToDnc(phone: string): void {
  const normalized = normalizePhone(phone);
  dncSet.add(normalized);
  auditLog('dnc_add', { phone: normalized });
  logger.info('compliance', 'Added to DNC', { phone: normalized });
}

export function removeFromDnc(phone: string): void {
  const normalized = normalizePhone(phone);
  dncSet.delete(normalized);
  auditLog('dnc_remove', { phone: normalized });
  logger.info('compliance', 'Removed from DNC', { phone: normalized });
}

export function isOnDnc(phone: string): boolean {
  return dncSet.has(normalizePhone(phone));
}

export function getDncList(): string[] {
  return Array.from(dncSet);
}

export function getDncCount(): number {
  return dncSet.size;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1/, '');
}

// ── Time-of-day enforcement (TCPA) ─────────────────────────────────

// TCPA: No calls before 8am or after 9pm LOCAL time
const STATE_TIMEZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago',
  ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York',
  MI: 'America/New_York', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York',
  NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York',
  ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York',
  VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
};

export interface TimeCheckResult {
  allowed: boolean;
  localTime: string;
  timezone: string;
  reason?: string;
}

export function checkCallTimeAllowed(state?: string): TimeCheckResult {
  const tz = state ? STATE_TIMEZONES[state.toUpperCase()] : undefined;
  const timezone = tz || 'America/New_York'; // Default to Eastern if unknown

  const now = new Date();
  const localTime = now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: true });
  const localHour = parseInt(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));

  if (localHour < 8) {
    return { allowed: false, localTime, timezone, reason: `Too early: ${localTime} local time (before 8am TCPA window)` };
  }
  if (localHour >= 21) {
    return { allowed: false, localTime, timezone, reason: `Too late: ${localTime} local time (after 9pm TCPA window)` };
  }

  return { allowed: true, localTime, timezone };
}

// ── TCPA Consent tracking ───────────────────────────────────────────

export interface ConsentRecord {
  phone: string;
  consentType: 'express' | 'express_written' | 'prior_relationship';
  source: string;       // e.g. "web_form", "landing_page", "crm"
  timestamp: string;
  leadId?: string;
  trustedFormUrl?: string;
  jornayaId?: string;
  ip?: string;
}

const consentStore = new Map<string, ConsentRecord>();

export function recordConsent(record: ConsentRecord): void {
  const normalized = normalizePhone(record.phone);
  consentStore.set(normalized, { ...record, phone: normalized });
  auditLog('consent_recorded', { phone: normalized, type: record.consentType, source: record.source });
}

export function getConsent(phone: string): ConsentRecord | undefined {
  return consentStore.get(normalizePhone(phone));
}

export function hasConsent(phone: string): boolean {
  return consentStore.has(normalizePhone(phone));
}

// ── Recording disclosure ────────────────────────────────────────────

// States that require all-party consent for recording
const ALL_PARTY_CONSENT_STATES = new Set([
  'CA', 'CT', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NH', 'OR', 'PA', 'WA',
]);

export function requiresRecordingDisclosure(state?: string): boolean {
  if (!state) return true; // Default to requiring disclosure
  return ALL_PARTY_CONSENT_STATES.has(state.toUpperCase());
}

export function getRecordingDisclosureText(): string {
  return 'Just so you know, this call is recorded for quality assurance.';
}

// ── Pre-call compliance check ───────────────────────────────────────

export interface ComplianceCheckResult {
  allowed: boolean;
  checks: {
    dnc: { passed: boolean; reason?: string };
    time: { passed: boolean; reason?: string };
    consent: { passed: boolean; reason?: string };
  };
  warnings: string[];
}

export function runPreCallComplianceCheck(phone: string, state?: string, tcpaOverride?: boolean): ComplianceCheckResult {
  const checks = {
    dnc: { passed: true, reason: undefined as string | undefined },
    time: { passed: true, reason: undefined as string | undefined },
    consent: { passed: true, reason: undefined as string | undefined },
  };
  const warnings: string[] = [];

  // DNC check
  if (isOnDnc(phone)) {
    checks.dnc = { passed: false, reason: 'Number is on the Do Not Call list' };
  }

  // Time check
  const timeCheck = checkCallTimeAllowed(state);
  if (!timeCheck.allowed) {
    checks.time = { passed: false, reason: timeCheck.reason };
  }

  // Consent check (warn but don't block — consent may be tracked externally)
  if (!hasConsent(phone)) {
    checks.consent = { passed: true, reason: 'No consent record found — ensure external consent exists' };
    warnings.push('No TCPA consent record on file for this number');
  }

  const allowed = checks.dnc.passed && (tcpaOverride || checks.time.passed);

  auditLog('compliance_check', {
    phone: normalizePhone(phone),
    state,
    allowed,
    dncPassed: checks.dnc.passed,
    timePassed: checks.time.passed,
    consentPassed: checks.consent.passed,
  });

  return { allowed, checks, warnings };
}

// ── Immutable Audit Log ─────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  data: Record<string, unknown>;
  hash: string;
}

const auditEntries: AuditEntry[] = [];
let auditSequence = 0;

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export function auditLog(action: string, data: Record<string, unknown>): void {
  const seq = ++auditSequence;
  const timestamp = new Date().toISOString();
  const prevHash = auditEntries.length > 0 ? auditEntries[auditEntries.length - 1].hash : '0';
  const content = `${seq}:${timestamp}:${action}:${JSON.stringify(data)}:${prevHash}`;
  const hash = simpleHash(content);

  const entry: AuditEntry = {
    id: `audit-${seq}`,
    timestamp,
    action,
    data,
    hash,
  };

  auditEntries.push(entry);
  logger.debug('audit', action, data);
}

export function getAuditLog(limit = 50): AuditEntry[] {
  return auditEntries.slice(-limit);
}

export function getAuditLogCount(): number {
  return auditEntries.length;
}

// ── Per-Phone Rate Limiting ─────────────────────────────────────────

interface PhoneCallTracker {
  counts: Map<string, number>; // dateKey -> count
}

const phoneCallTracker = new Map<string, PhoneCallTracker>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordPhoneCall(phone: string): void {
  const normalized = normalizePhone(phone);
  const key = todayKey();
  let tracker = phoneCallTracker.get(normalized);
  if (!tracker) {
    tracker = { counts: new Map() };
    phoneCallTracker.set(normalized, tracker);
  }
  tracker.counts.set(key, (tracker.counts.get(key) || 0) + 1);
}

export function getPhoneCallCountToday(phone: string): number {
  const normalized = normalizePhone(phone);
  const tracker = phoneCallTracker.get(normalized);
  if (!tracker) return 0;
  return tracker.counts.get(todayKey()) || 0;
}

export function checkPhoneRateLimit(phone: string, maxPerDay: number): { allowed: boolean; callsToday: number } {
  if (maxPerDay <= 0) return { allowed: true, callsToday: getPhoneCallCountToday(phone) };
  const callsToday = getPhoneCallCountToday(phone);
  return { allowed: callsToday < maxPerDay, callsToday };
}

// ── Auto-DNC Detection ──────────────────────────────────────────────

const DNC_PHRASES = [
  'don\'t call me',
  'do not call me',
  'stop calling',
  'remove my number',
  'remove me from your list',
  'take me off your list',
  'put me on the do not call',
  'add me to the do not call',
  'never call again',
  'quit calling me',
  'don\'t ever call',
  'do not ever call',
  'i want to be removed',
];

export function detectDncRequest(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return DNC_PHRASES.some(phrase => lower.includes(phrase));
}

export function handleAutoDnc(phone: string, transcript: string): boolean {
  if (detectDncRequest(transcript)) {
    addToDnc(phone);
    auditLog('auto_dnc', { phone: normalizePhone(phone), trigger: 'verbal_request', transcript: transcript.substring(0, 200) });
    logger.info('compliance', 'Auto-DNC triggered by verbal request', { phone: normalizePhone(phone) });
    return true;
  }
  return false;
}
