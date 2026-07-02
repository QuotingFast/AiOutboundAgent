// ── AI Quality Assurance ───────────────────────────────────────────
// Scores every completed call against a compliance + quality rubric.
// The heuristic scorer runs synchronously and offline (deterministic,
// testable); an optional LLM pass can enrich scores when an OpenAI key
// is configured. High-risk calls land in a review queue.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { recordEvent } from './events';
import { logger } from '../utils/logger';

export interface QaTranscriptTurn {
  role: 'agent' | 'user';
  text: string;
}

export interface QaCallInput {
  callSid: string;
  campaignId?: string;
  phone?: string;
  transcript: QaTranscriptTurn[];
  outcome?: string;                // 'transferred' | 'callback' | 'declined' | 'dnc' | …
  transferConsentUtterance?: string;
  transferInitiated?: boolean;
  optOutRequested?: boolean;
  optOutHonored?: boolean;
  recordingDisclosureRequired?: boolean;
  durationMs?: number;
}

export interface QaDimension {
  key: string;
  label: string;
  score: number;       // 0-100
  weight: number;
  notes: string[];
}

export interface QaScore {
  id: string;
  callSid: string;
  campaignId?: string;
  phone?: string;
  at: string;
  overall: number;                 // 0-100 weighted
  dimensions: QaDimension[];
  riskFlags: string[];             // non-empty ⇒ lands in the review queue
  reviewed: boolean;
  reviewedBy?: string;
  reviewNote?: string;
}

const STORE_KEY = 'platform_qa';
const MAX_SCORES = 5000;
let scores: QaScore[] = [];

export function loadQa(): void {
  const saved = loadData<QaScore[]>(STORE_KEY);
  if (Array.isArray(saved)) scores = saved;
  logger.info('qa', `Loaded ${scores.length} QA scores`);
}

function persist(): void {
  if (scores.length > MAX_SCORES) scores = scores.slice(-MAX_SCORES);
  scheduleSave(STORE_KEY, () => scores);
}

// Claims the agent must never make. Patterns are matched against
// agent turns only.
const PROHIBITED_PATTERNS: Array<{ re: RegExp; flag: string }> = [
  { re: /\bguarantee[ds]?\b.*\b(sav|rate|price|approval)/i, flag: 'guaranteed_savings_claim' },
  { re: /\byou('| wi)ll (definitely|certainly) save\b/i, flag: 'guaranteed_savings_claim' },
  { re: /\bi('| a)m (a )?licensed (insurance )?agent\b/i, flag: 'false_licensure_claim' },
  { re: /\bcalling (from|on behalf of) (geico|progressive|state farm|allstate|usaa|liberty mutual)\b/i, flag: 'carrier_affiliation_claim' },
  { re: /\b(final notice|last chance|policy (will be|is being) cancell?ed)\b/i, flag: 'false_urgency' },
  { re: /\b(social security|ssn|bank account|routing number|card number)\b/i, flag: 'sensitive_data_request' },
  { re: /\b(yes,? )?(i('| a)m|i am) (a )?(real |actual )?(human|person)\b/i, flag: 'false_human_claim' },
];

const IDENTITY_CHECK_RE = /\b(is this|am i speaking with|speaking to|this) .{0,24}\?|\bhey \w+\?/i;
const RECORDING_DISCLOSURE_RE = /\b(call[s]? (is|are|may be) recorded|recorded (line|call)|on a recorded)/i;
const PURPOSE_RE = /\b(insurance|quote|coverage|rate)\b/i;
const TRANSFER_PERMISSION_RE = /\b(want me to|can i|should i|ready to|ok(ay)? if i|mind if i).{0,40}(connect|transfer|get you (over|through)|put you (through|on))/i;
const OPT_OUT_ACK_RE = /\b(take you off|won'?t (call|bother)|mark(ed)? (that|you) down|off (the|our) list|remove(d)? you)\b/i;
const NEXT_STEP_RE = /\b(call you (back|at)|text you|connect|transfer|agent will|expect a call|scheduled)\b/i;

function dim(key: string, label: string, score: number, weight: number, notes: string[] = []): QaDimension {
  return { key, label, score: Math.max(0, Math.min(100, Math.round(score))), weight, notes };
}

export function scoreCall(input: QaCallInput): QaScore {
  const agentTurns = input.transcript.filter(t => t.role === 'agent').map(t => t.text);
  const userTurns = input.transcript.filter(t => t.role === 'user').map(t => t.text);
  const agentText = agentTurns.join('\n');
  const riskFlags: string[] = [];
  const dims: QaDimension[] = [];

  // 1. Identity verification before divulging detail.
  const firstAgent = agentTurns.slice(0, 2).join(' ');
  const identityOk = IDENTITY_CHECK_RE.test(firstAgent);
  dims.push(dim('identity', 'Identity check first', identityOk ? 100 : 25, 1.5,
    identityOk ? [] : ['No identity confirmation detected in the opening turns']));

  // 2. Purpose disclosure.
  const purposeOk = agentTurns.slice(0, 3).some(t => PURPOSE_RE.test(t));
  dims.push(dim('purpose', 'Purpose of call disclosed', purposeOk ? 100 : 30, 1,
    purposeOk ? [] : ['Call purpose (insurance quote request) not stated early']));

  // 3. Recording disclosure when required.
  if (input.recordingDisclosureRequired !== false) {
    const disclosed = RECORDING_DISCLOSURE_RE.test(agentText);
    if (!disclosed && agentTurns.length >= 3) riskFlags.push('missing_recording_disclosure');
    dims.push(dim('recording', 'Recording disclosure', disclosed ? 100 : 0, 1.5,
      disclosed ? [] : ['No recording disclosure found']));
  }

  // 4. Prohibited claims.
  const prohibitedHits: string[] = [];
  for (const t of agentTurns) {
    for (const { re, flag } of PROHIBITED_PATTERNS) {
      if (re.test(t) && !prohibitedHits.includes(flag)) prohibitedHits.push(flag);
    }
  }
  for (const f of prohibitedHits) riskFlags.push(f);
  dims.push(dim('truthfulness', 'No prohibited claims', prohibitedHits.length === 0 ? 100 : 0, 2,
    prohibitedHits.map(f => `Detected: ${f}`)));

  // 5. Transfer permission before transfer.
  if (input.transferInitiated) {
    const asked = TRANSFER_PERMISSION_RE.test(agentText) || Boolean(input.transferConsentUtterance);
    const consented = Boolean(input.transferConsentUtterance) ||
      userTurns.some(t => /\b(yes|yeah|sure|ok(ay)?|go ahead|sounds good|let'?s do it)\b/i.test(t));
    if (!asked || !consented) riskFlags.push('transfer_without_clear_permission');
    dims.push(dim('transfer_consent', 'Permission before transfer', asked && consented ? 100 : 10, 2,
      asked && consented ? [] : ['Transfer initiated without a detected ask + affirmative']));
  }

  // 6. Opt-out handling.
  if (input.optOutRequested) {
    const honored = input.optOutHonored !== false && OPT_OUT_ACK_RE.test(agentText);
    if (!honored) riskFlags.push('opt_out_not_honored');
    dims.push(dim('opt_out', 'Opt-out honored', honored ? 100 : 0, 2,
      honored ? [] : ['Consumer asked to stop; no acknowledgment detected']));
  }

  // 7. Repetition (same normalized agent line 3+ times).
  const normalized = agentTurns.map(t => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()).filter(t => t.length > 12);
  const counts = new Map<string, number>();
  for (const n of normalized) counts.set(n, (counts.get(n) || 0) + 1);
  const worstRepeat = Math.max(0, ...counts.values());
  dims.push(dim('repetition', 'Avoided repetition', worstRepeat >= 3 ? 30 : worstRepeat === 2 ? 75 : 100, 0.5,
    worstRepeat >= 2 ? [`An agent line repeated ${worstRepeat}×`] : []));

  // 8. Brevity (short conversational turns).
  const avgWords = agentTurns.length > 0
    ? agentTurns.reduce((s, t) => s + t.split(/\s+/).length, 0) / agentTurns.length
    : 0;
  dims.push(dim('brevity', 'Short natural turns', avgWords <= 16 ? 100 : avgWords <= 28 ? 70 : 35, 0.5,
    avgWords > 16 ? [`Average agent turn ${avgWords.toFixed(0)} words`] : []));

  // 9. Talk ratio (agent shouldn't dominate).
  const agentWords = agentTurns.join(' ').split(/\s+/).length;
  const userWords = Math.max(1, userTurns.join(' ').split(/\s+/).length);
  const ratio = agentWords / (agentWords + userWords);
  dims.push(dim('talk_ratio', 'Balanced talk ratio', ratio <= 0.6 ? 100 : ratio <= 0.75 ? 70 : 40, 0.5,
    ratio > 0.6 ? [`Agent spoke ${(ratio * 100).toFixed(0)}% of words`] : []));

  // 10. Clear next step at the end.
  const closing = agentTurns.slice(-2).join(' ');
  const nextStepOk = NEXT_STEP_RE.test(closing) || input.outcome === 'transferred' || input.outcome === 'dnc';
  dims.push(dim('next_step', 'Clear next step', nextStepOk ? 100 : 55, 0.5,
    nextStepOk ? [] : ['No explicit next step in the closing turns']));

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
  const overall = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0) / Math.max(1, totalWeight));

  const score: QaScore = {
    id: `qa_${crypto.randomBytes(4).toString('hex')}`,
    callSid: input.callSid,
    campaignId: input.campaignId,
    phone: input.phone,
    at: new Date().toISOString(),
    overall,
    dimensions: dims,
    riskFlags,
    reviewed: false,
  };
  scores.push(score);
  persist();
  recordEvent(riskFlags.length > 0 ? 'qa.flagged' : 'qa.scored',
    { overall, riskFlags, dimensions: dims.map(d => ({ key: d.key, score: d.score })) },
    { callSid: input.callSid, campaignId: input.campaignId, phone: input.phone });
  return score;
}

export function listQaScores(opts: { limit?: number; flaggedOnly?: boolean; campaignId?: string } = {}): QaScore[] {
  let list = scores;
  if (opts.flaggedOnly) list = list.filter(s => s.riskFlags.length > 0 && !s.reviewed);
  if (opts.campaignId) list = list.filter(s => s.campaignId === opts.campaignId);
  return list.slice(-(opts.limit || 100)).reverse();
}

export function getQaScore(callSid: string): QaScore | undefined {
  for (let i = scores.length - 1; i >= 0; i--) {
    if (scores[i].callSid === callSid) return scores[i];
  }
  return undefined;
}

export function reviewQaScore(id: string, reviewer: string, note: string): QaScore | undefined {
  const s = scores.find(x => x.id === id);
  if (!s) return undefined;
  s.reviewed = true;
  s.reviewedBy = reviewer;
  s.reviewNote = note;
  persist();
  return s;
}

export function qaSummary(): {
  scored: number; avgOverall: number; flagged: number; pendingReview: number;
  dimensionAverages: Record<string, number>; topRiskFlags: Array<{ flag: string; count: number }>;
} {
  const scored = scores.length;
  const avgOverall = scored > 0 ? Math.round(scores.reduce((s, x) => s + x.overall, 0) / scored) : 0;
  const flagged = scores.filter(s => s.riskFlags.length > 0).length;
  const pendingReview = scores.filter(s => s.riskFlags.length > 0 && !s.reviewed).length;
  const dimTotals = new Map<string, { sum: number; n: number }>();
  const flagCounts = new Map<string, number>();
  for (const s of scores) {
    for (const d of s.dimensions) {
      const t = dimTotals.get(d.key) || { sum: 0, n: 0 };
      t.sum += d.score; t.n += 1;
      dimTotals.set(d.key, t);
    }
    for (const f of s.riskFlags) flagCounts.set(f, (flagCounts.get(f) || 0) + 1);
  }
  const dimensionAverages: Record<string, number> = {};
  for (const [k, t] of dimTotals) dimensionAverages[k] = Math.round(t.sum / t.n);
  const topRiskFlags = [...flagCounts.entries()].map(([flag, count]) => ({ flag, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  return { scored, avgOverall, flagged, pendingReview, dimensionAverages, topRiskFlags };
}
