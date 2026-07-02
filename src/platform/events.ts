// ── Platform Event Ledger ──────────────────────────────────────────
// Append-only, hash-chained, persisted event log. Every compliance
// decision, call attempt, transfer stage, SMS, opt-out, config change,
// and QA flag is recorded here. The funnel, compliance exports, and
// audit trails are views over this ledger.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { logger } from '../utils/logger';

export type PlatformEventType =
  | 'lead.received' | 'lead.invalid'
  | 'policy.allowed' | 'policy.blocked'
  | 'call.attempted' | 'call.answered' | 'call.no_answer' | 'call.voicemail'
  | 'call.correct_party' | 'call.wrong_party' | 'call.completed'
  | 'call.qualified' | 'call.disqualified'
  | 'objection.raised' | 'rebuttal.used'
  | 'transfer.offered' | 'transfer.accepted_by_consumer' | 'transfer.initiated'
  | 'transfer.buyer_answered' | 'transfer.connected' | 'transfer.failed'
  | 'callback.scheduled' | 'callback.completed' | 'callback.missed'
  | 'sms.sent' | 'sms.received' | 'sms.blocked' | 'sms.stop'
  | 'dnc.added' | 'dnc.removed' | 'consent.recorded' | 'complaint.opened'
  | 'qa.scored' | 'qa.flagged'
  | 'config.changed' | 'profile.applied' | 'profile.rolledback'
  | 'auth.login' | 'auth.denied' | 'export.compliance';

export interface PlatformEvent {
  id: string;
  seq: number;
  type: PlatformEventType;
  at: string;                       // ISO timestamp
  actor?: string;                   // user id / 'system' / 'agent'
  phone?: string;                   // normalized lead phone when applicable
  callSid?: string;
  campaignId?: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

interface EventLedgerState {
  seq: number;
  headHash: string;
  events: PlatformEvent[];          // capped ring; seq keeps global ordering
  droppedCount: number;             // events rotated out of the ring
}

const MAX_EVENTS = 20000;
const STORE_KEY = 'platform_events';

let state: EventLedgerState = { seq: 0, headHash: 'genesis', events: [], droppedCount: 0 };
const listeners = new Set<(ev: PlatformEvent) => void>();

export function loadEventLedger(): void {
  const saved = loadData<EventLedgerState>(STORE_KEY);
  if (saved && Array.isArray(saved.events)) {
    state = saved;
    logger.info('events', `Event ledger loaded — seq ${state.seq}, ${state.events.length} in ring`);
  }
}

function persist(): void {
  scheduleSave(STORE_KEY, () => state);
}

function chainHash(prevHash: string, payload: string): string {
  return crypto.createHash('sha256').update(prevHash + '|' + payload).digest('hex').slice(0, 32);
}

/** Canonical serialization used for both hashing and verification. */
function canonicalPayload(ev: Pick<PlatformEvent, 'seq' | 'type' | 'at' | 'actor' | 'phone' | 'callSid' | 'campaignId' | 'data'>): string {
  return JSON.stringify({
    seq: ev.seq, type: ev.type, at: ev.at,
    actor: ev.actor, phone: ev.phone, callSid: ev.callSid, campaignId: ev.campaignId,
    data: ev.data,
  });
}

export function recordEvent(
  type: PlatformEventType,
  data: Record<string, unknown>,
  opts: { actor?: string; phone?: string; callSid?: string; campaignId?: string } = {},
): PlatformEvent {
  const at = new Date().toISOString();
  const seq = ++state.seq;
  const base = {
    seq, type, at,
    actor: opts.actor,
    phone: opts.phone ? normalizePhone(opts.phone) : undefined,
    callSid: opts.callSid,
    campaignId: opts.campaignId,
    data,
  };
  const ev: PlatformEvent = {
    id: `ev_${seq.toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    ...base,
    prevHash: state.headHash,
    hash: chainHash(state.headHash, canonicalPayload(base)),
  };
  state.headHash = ev.hash;
  state.events.push(ev);
  if (state.events.length > MAX_EVENTS) {
    state.droppedCount += state.events.length - MAX_EVENTS;
    state.events = state.events.slice(-MAX_EVENTS);
  }
  persist();
  for (const fn of listeners) {
    try { fn(ev); } catch { /* listener errors must not break the caller */ }
  }
  return ev;
}

export interface EventQuery {
  type?: PlatformEventType | PlatformEventType[];
  typePrefix?: string;              // e.g. 'transfer.'
  phone?: string;
  callSid?: string;
  campaignId?: string;
  since?: string;                   // ISO
  until?: string;
  limit?: number;
  offset?: number;
}

export function queryEvents(q: EventQuery = {}): { events: PlatformEvent[]; total: number } {
  const types = q.type ? (Array.isArray(q.type) ? q.type : [q.type]) : null;
  const phone = q.phone ? normalizePhone(q.phone) : null;
  let list = state.events.filter(ev =>
    (!types || types.includes(ev.type)) &&
    (!q.typePrefix || ev.type.startsWith(q.typePrefix)) &&
    (!phone || ev.phone === phone) &&
    (!q.callSid || ev.callSid === q.callSid) &&
    (!q.campaignId || ev.campaignId === q.campaignId) &&
    (!q.since || ev.at >= q.since) &&
    (!q.until || ev.at <= q.until),
  );
  const total = list.length;
  list = list.slice().reverse(); // newest first
  const offset = q.offset || 0;
  const limit = q.limit ?? 100;
  return { events: list.slice(offset, offset + limit), total };
}

export function countEvents(q: EventQuery = {}): number {
  return queryEvents({ ...q, limit: 0 }).total;
}

/** Verify hash-chain integrity of the in-ring events. */
export function verifyLedger(): { valid: boolean; checked: number; brokenAtSeq?: number } {
  let prev = state.events.length > 0 ? state.events[0].prevHash : state.headHash;
  for (const ev of state.events) {
    if (ev.prevHash !== prev || ev.hash !== chainHash(prev, canonicalPayload(ev))) {
      return { valid: false, checked: state.events.length, brokenAtSeq: ev.seq };
    }
    prev = ev.hash;
  }
  return { valid: true, checked: state.events.length };
}

export function onEvent(fn: (ev: PlatformEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function ledgerStats(): { seq: number; inRing: number; dropped: number; headHash: string } {
  return { seq: state.seq, inRing: state.events.length, dropped: state.droppedCount, headHash: state.headHash };
}

/** Canonical phone normalization for the platform layer: E.164-ish digits. */
export function normalizePhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : '';
}
