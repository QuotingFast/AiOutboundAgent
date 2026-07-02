// ── Transfer Orchestration ─────────────────────────────────────────
// Buyer/destination registry with real eligibility evaluation (state,
// operating hours, daily caps, concurrency, priority), structured
// handoff packets delivered to buyer webhooks, whisper briefings, and
// per-stage transfer telemetry. Replaces the old behavior where the
// LLM picked a route by name-substring and business hours were never
// evaluated.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { localTimeIn } from './timezone';
import { recordEvent, normalizePhone } from './events';
import { logger } from '../utils/logger';

export interface BuyerHours {
  tz: string;                 // buyer's operating timezone
  startHour: number;          // inclusive, 0-23
  endHour: number;            // exclusive
  days: number[];             // 0=Sun … 6=Sat
}

export interface Buyer {
  id: string;
  name: string;
  destinationNumber: string;          // E.164 dial target (or SIP URI)
  transport: 'pstn' | 'sip';
  active: boolean;
  priority: number;                   // lower = preferred
  states: string[];                   // empty = all states
  excludedInsurers: string[];         // e.g. buyer won't take current Allstate customers
  requiresInsured: boolean | null;    // true = insured-only, false = uninsured-only, null = any
  requiresContinuousCoverage: boolean;// requires >= 6 months continuous coverage
  acceptsDui: boolean;
  acceptsSr22: boolean;
  hours: BuyerHours;
  dailyCap: number;                   // 0 = unlimited
  concurrencyCap: number;             // 0 = unlimited simultaneous transfers
  handoffWebhookUrl?: string;         // POST handoff packet here
  handoffAuthHeader?: string;         // e.g. "Bearer …" (never sent to the browser)
  campaignIds: string[];              // empty = all campaigns
  routeTag?: string;                  // legacy compatibility: 'allstate' | 'other'
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TransferStage =
  | 'initiated' | 'buyer_ringing' | 'buyer_answered'
  | 'consumer_connected' | 'completed' | 'failed' | 'abandoned';

export interface TransferRecord {
  id: string;
  callSid: string;
  buyerId: string;
  buyerName: string;
  campaignId?: string;
  phone: string;
  stages: Partial<Record<TransferStage, string>>;   // stage -> ISO timestamp
  currentStage: TransferStage;
  failureReason?: string;
  handoffPacket?: HandoffPacket;
  handoffDelivered?: boolean;
  whisper?: string;
  consentUtterance?: string;
  createdAt: string;
}

export interface HandoffPacket {
  packetId: string;
  lead: {
    firstName?: string;
    lastName?: string;
    phone: string;
    state?: string;
    zip?: string;
  };
  consent: {
    source?: string;
    timestamp?: string;
    trustedFormUrl?: string;
    jornayaId?: string;
    transferConsentUtterance?: string;
    transferConsentAt?: string;
  };
  submission: {
    receivedAt?: string;
    source?: string;
    campaignId?: string;
    leadAgeMinutes?: number;
  };
  qualification: {
    currentInsurer?: string;
    insured?: boolean;
    continuousCoverage?: string;      // e.g. '6mo+' | '<6mo' | 'lapsed' | 'none'
    vehicleCount?: number;
    vehicles?: Array<{ year?: string; make?: string; model?: string }>;
    licenseActive?: boolean;
    dui?: boolean;
    sr22?: boolean;
    shoppingReason?: string;
  };
  call: {
    callSid: string;
    recordingRef?: string;
    transcriptRef?: string;
    aiSummary?: string;
  };
  bestCallbackTime?: string;
}

interface BuyerStoreState {
  buyers: Buyer[];
  transfers: TransferRecord[];
}

const STORE_KEY = 'platform_buyers';
const TRANSFERS_KEY = 'platform_transfers';
const MAX_TRANSFERS = 5000;

let buyers: Buyer[] = [];
let transfers: TransferRecord[] = [];
const activeTransfersByBuyer = new Map<string, number>();

export function loadBuyers(): void {
  const savedBuyers = loadData<Buyer[]>(STORE_KEY);
  if (Array.isArray(savedBuyers)) buyers = savedBuyers;
  const savedTransfers = loadData<TransferRecord[]>(TRANSFERS_KEY);
  if (Array.isArray(savedTransfers)) transfers = savedTransfers;
  logger.info('buyers', `Loaded ${buyers.length} buyers, ${transfers.length} transfer records`);
}

function persistBuyers(): void { scheduleSave(STORE_KEY, () => buyers); }
function persistTransfers(): void {
  if (transfers.length > MAX_TRANSFERS) transfers = transfers.slice(-MAX_TRANSFERS);
  scheduleSave(TRANSFERS_KEY, () => transfers);
}

// ── Buyer CRUD ──────────────────────────────────────────────────────

export function listBuyers(): Buyer[] { return buyers; }
export function getBuyer(id: string): Buyer | undefined { return buyers.find(b => b.id === id); }

export function upsertBuyer(input: Partial<Buyer> & { name: string; destinationNumber: string }, actor = 'system'): Buyer {
  const now = new Date().toISOString();
  const existing = input.id ? buyers.find(b => b.id === input.id) : undefined;
  const buyer: Buyer = {
    id: existing?.id || `buyer_${crypto.randomBytes(4).toString('hex')}`,
    transport: 'pstn',
    active: true,
    priority: 100,
    states: [],
    excludedInsurers: [],
    requiresInsured: null,
    requiresContinuousCoverage: false,
    acceptsDui: true,
    acceptsSr22: true,
    hours: { tz: 'America/New_York', startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5] },
    dailyCap: 0,
    concurrencyCap: 0,
    campaignIds: [],
    createdAt: existing?.createdAt || now,
    ...existing,
    ...input,
    updatedAt: now,
  };
  if (existing) {
    buyers = buyers.map(b => (b.id === buyer.id ? buyer : b));
  } else {
    buyers.push(buyer);
  }
  persistBuyers();
  recordEvent('config.changed', { scope: 'buyer', buyerId: buyer.id, name: buyer.name, action: existing ? 'updated' : 'created' }, { actor });
  return buyer;
}

export function deleteBuyer(id: string, actor = 'system'): boolean {
  const before = buyers.length;
  buyers = buyers.filter(b => b.id !== id);
  if (buyers.length < before) {
    persistBuyers();
    recordEvent('config.changed', { scope: 'buyer', buyerId: id, action: 'deleted' }, { actor });
    return true;
  }
  return false;
}

// ── Eligibility & selection ─────────────────────────────────────────

export interface TransferCriteria {
  state?: string;
  currentInsurer?: string;
  insured?: boolean;
  continuousCoverage6mo?: boolean;
  dui?: boolean;
  sr22?: boolean;
  campaignId?: string;
  routeTag?: string;            // legacy hint from the LLM ('allstate' | 'other')
  now?: Date;
}

export interface BuyerEvaluation {
  buyer: Buyer;
  eligible: boolean;
  reasons: string[];
  transfersToday: number;
  activeNow: number;
}

function transfersTodayFor(buyerId: string, now: Date): number {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const iso = dayStart.toISOString();
  return transfers.filter(t => t.buyerId === buyerId && t.createdAt >= iso).length;
}

export function evaluateBuyer(buyer: Buyer, c: TransferCriteria): BuyerEvaluation {
  const now = c.now || new Date();
  const reasons: string[] = [];
  if (!buyer.active) reasons.push('inactive');
  if (!buyer.destinationNumber) reasons.push('no destination number');

  const st = (c.state || '').toUpperCase();
  if (buyer.states.length > 0 && st && !buyer.states.map(s => s.toUpperCase()).includes(st)) {
    reasons.push(`state ${st} not eligible`);
  }
  if (buyer.campaignIds.length > 0 && c.campaignId && !buyer.campaignIds.includes(c.campaignId)) {
    reasons.push('campaign not eligible');
  }
  if (c.currentInsurer && buyer.excludedInsurers.some(i => i.toLowerCase() === c.currentInsurer!.toLowerCase())) {
    reasons.push(`current insurer ${c.currentInsurer} excluded`);
  }
  if (buyer.requiresInsured === true && c.insured === false) reasons.push('requires insured consumer');
  if (buyer.requiresInsured === false && c.insured === true) reasons.push('uninsured-only buyer');
  if (buyer.requiresContinuousCoverage && c.continuousCoverage6mo === false) reasons.push('requires 6mo+ continuous coverage');
  if (c.dui && !buyer.acceptsDui) reasons.push('does not accept DUI');
  if (c.sr22 && !buyer.acceptsSr22) reasons.push('does not accept SR-22');

  const lt = localTimeIn(buyer.hours.tz, now);
  const hoursOk = buyer.hours.days.includes(lt.day) && lt.hour >= buyer.hours.startHour && lt.hour < buyer.hours.endHour;
  if (!hoursOk) reasons.push(`outside operating hours (${buyer.hours.startHour}:00–${buyer.hours.endHour}:00 ${buyer.hours.tz})`);

  const today = transfersTodayFor(buyer.id, now);
  if (buyer.dailyCap > 0 && today >= buyer.dailyCap) reasons.push(`daily cap reached (${today}/${buyer.dailyCap})`);

  const active = activeTransfersByBuyer.get(buyer.id) || 0;
  if (buyer.concurrencyCap > 0 && active >= buyer.concurrencyCap) reasons.push(`concurrency cap reached (${active}/${buyer.concurrencyCap})`);

  return { buyer, eligible: reasons.length === 0, reasons, transfersToday: today, activeNow: active };
}

/**
 * Rank all buyers for the given consumer. Eligible buyers sorted by
 * priority, then fewest transfers today (soft load balancing).
 * routeTag is honored as a preference boost, not a hard filter, so the
 * legacy 'allstate'/'other' hint still shapes selection without being
 * able to bypass eligibility.
 */
export function selectBuyer(c: TransferCriteria): { selected: BuyerEvaluation | null; ranked: BuyerEvaluation[] } {
  const ranked = buyers.map(b => evaluateBuyer(b, c)).sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const tagA = c.routeTag && a.buyer.routeTag === c.routeTag ? 0 : 1;
    const tagB = c.routeTag && b.buyer.routeTag === c.routeTag ? 0 : 1;
    if (tagA !== tagB) return tagA - tagB;
    if (a.buyer.priority !== b.buyer.priority) return a.buyer.priority - b.buyer.priority;
    return a.transfersToday - b.transfersToday;
  });
  const selected = ranked.find(r => r.eligible) || null;
  return { selected, ranked };
}

export function hasConfiguredBuyers(): boolean {
  return buyers.some(b => b.active && b.destinationNumber);
}

// ── Transfer lifecycle ──────────────────────────────────────────────

export function createTransfer(opts: {
  callSid: string;
  buyer: Buyer;
  phone: string;
  campaignId?: string;
  packet: HandoffPacket;
  whisper?: string;
  consentUtterance?: string;
}): TransferRecord {
  const now = new Date().toISOString();
  const rec: TransferRecord = {
    id: `xfer_${crypto.randomBytes(5).toString('hex')}`,
    callSid: opts.callSid,
    buyerId: opts.buyer.id,
    buyerName: opts.buyer.name,
    campaignId: opts.campaignId,
    phone: normalizePhone(opts.phone),
    stages: { initiated: now },
    currentStage: 'initiated',
    handoffPacket: opts.packet,
    whisper: opts.whisper,
    consentUtterance: opts.consentUtterance,
    createdAt: now,
  };
  transfers.push(rec);
  activeTransfersByBuyer.set(opts.buyer.id, (activeTransfersByBuyer.get(opts.buyer.id) || 0) + 1);
  persistTransfers();
  recordEvent('transfer.initiated', { transferId: rec.id, buyerId: rec.buyerId, buyerName: rec.buyerName },
    { phone: rec.phone, callSid: rec.callSid, campaignId: rec.campaignId });
  return rec;
}

const TERMINAL_STAGES: TransferStage[] = ['completed', 'failed', 'abandoned'];

export function updateTransferStage(transferId: string, stage: TransferStage, failureReason?: string): TransferRecord | undefined {
  const rec = transfers.find(t => t.id === transferId);
  if (!rec) return undefined;
  const wasTerminal = TERMINAL_STAGES.includes(rec.currentStage);
  rec.stages[stage] = new Date().toISOString();
  rec.currentStage = stage;
  if (failureReason) rec.failureReason = failureReason;
  if (!wasTerminal && TERMINAL_STAGES.includes(stage)) {
    const n = (activeTransfersByBuyer.get(rec.buyerId) || 1) - 1;
    activeTransfersByBuyer.set(rec.buyerId, Math.max(0, n));
  }
  persistTransfers();
  // 'completed' after 'consumer_connected' is terminal bookkeeping, not a
  // second connect — only count transfer.connected once per transfer.
  const evType = stage === 'buyer_answered' ? 'transfer.buyer_answered'
    : stage === 'consumer_connected' ? 'transfer.connected'
    : stage === 'completed' && !rec.stages.consumer_connected ? 'transfer.connected'
    : stage === 'failed' || stage === 'abandoned' ? 'transfer.failed'
    : null;
  if (evType) {
    recordEvent(evType, { transferId: rec.id, buyerId: rec.buyerId, stage, failureReason },
      { phone: rec.phone, callSid: rec.callSid, campaignId: rec.campaignId });
  }
  return rec;
}

export function findTransferByCallSid(callSid: string): TransferRecord | undefined {
  for (let i = transfers.length - 1; i >= 0; i--) {
    if (transfers[i].callSid === callSid) return transfers[i];
  }
  return undefined;
}

export function listTransfers(opts: { limit?: number; buyerId?: string; since?: string } = {}): TransferRecord[] {
  let list = transfers;
  if (opts.buyerId) list = list.filter(t => t.buyerId === opts.buyerId);
  if (opts.since) list = list.filter(t => t.createdAt >= opts.since!);
  return list.slice(-(opts.limit || 100)).reverse();
}

// ── Handoff delivery ────────────────────────────────────────────────

/**
 * POST the handoff packet to the buyer's webhook. Fire-and-forget with
 * one retry; the transfer proceeds regardless (voice handoff is primary,
 * the packet is enrichment).
 */
export async function deliverHandoff(buyer: Buyer, rec: TransferRecord): Promise<boolean> {
  if (!buyer.handoffWebhookUrl || !rec.handoffPacket) return false;
  const body = JSON.stringify(rec.handoffPacket);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (buyer.handoffAuthHeader) headers['Authorization'] = buyer.handoffAuthHeader;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(buyer.handoffWebhookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        rec.handoffDelivered = true;
        persistTransfers();
        return true;
      }
      logger.warn('buyers', `Handoff webhook returned ${res.status} for ${buyer.name} (attempt ${attempt + 1})`);
    } catch (err) {
      logger.warn('buyers', `Handoff webhook failed for ${buyer.name} (attempt ${attempt + 1})`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return false;
}

/** Build the whisper the receiving agent hears before the consumer connects. */
export function buildWhisper(packet: HandoffPacket): string {
  const q = packet.qualification;
  const parts: string[] = [];
  parts.push(`Incoming transfer: ${packet.lead.firstName || 'a consumer'}${packet.lead.state ? ` in ${packet.lead.state}` : ''}.`);
  if (q.currentInsurer) parts.push(`Currently with ${q.currentInsurer}.`);
  else if (q.insured === false) parts.push('Currently uninsured.');
  if (q.continuousCoverage) parts.push(`Coverage: ${q.continuousCoverage}.`);
  if (q.vehicleCount) parts.push(`${q.vehicleCount} vehicle${q.vehicleCount === 1 ? '' : 's'}.`);
  if (q.dui) parts.push('Has a DUI on record.');
  if (q.sr22) parts.push('Needs SR-22.');
  parts.push('They verified their info and agreed to speak with a licensed agent. Connecting now.');
  return parts.join(' ');
}
