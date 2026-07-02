// ── Funnel & Live-Ops Aggregation ──────────────────────────────────
// Computes the conversion funnel and live operations snapshot from the
// event ledger plus the existing session/queue/provider stores. Every
// number here is drillable: the ledger query that produced it is
// reproducible via /api/v2/events with the same filters.

import { queryEvents, ledgerStats, PlatformEventType } from './events';
import { listTransfers } from './buyers';
import { listQaScores, qaSummary } from './qa';
import { getObjectionStats } from './rebuttals';
import { getActiveSessions, getQueue, getSystemHealth } from '../performance';
import { getProviderHealth } from '../routing';
import { getScheduledCallbacks, getAllCampaigns } from '../campaign/store';
import { getDncCount } from '../compliance';
import { getSettings } from '../config/runtime';

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  conversionFromPrev: number | null;   // 0-1
}

const FUNNEL_DEF: Array<{ key: string; label: string; types: PlatformEventType[] }> = [
  { key: 'leads', label: 'Leads received', types: ['lead.received'] },
  { key: 'attempted', label: 'Calls attempted', types: ['call.attempted'] },
  { key: 'answered', label: 'Answered', types: ['call.answered'] },
  { key: 'correct_party', label: 'Correct party', types: ['call.correct_party'] },
  { key: 'qualified', label: 'Qualified', types: ['call.qualified'] },
  { key: 'transfer_offered', label: 'Transfer offered', types: ['transfer.offered'] },
  { key: 'transfer_accepted', label: 'Consumer said yes', types: ['transfer.accepted_by_consumer'] },
  { key: 'transfer_initiated', label: 'Transfer initiated', types: ['transfer.initiated'] },
  { key: 'buyer_connected', label: 'Buyer connected', types: ['transfer.connected'] },
];

export interface FunnelResult {
  since: string;
  until: string;
  stages: FunnelStage[];
  blocked: number;
  optOuts: number;
  smsSent: number;
  callbacksScheduled: number;
}

export function getFunnel(opts: { since?: string; until?: string; campaignId?: string } = {}): FunnelResult {
  const since = opts.since || new Date(Date.now() - 7 * 86400000).toISOString();
  const until = opts.until || new Date().toISOString();
  const base = { since, until, campaignId: opts.campaignId, limit: 0 };
  let prev: number | null = null;
  const stages: FunnelStage[] = FUNNEL_DEF.map(def => {
    const count = def.types.reduce((s, t) => s + queryEvents({ ...base, type: t }).total, 0);
    const stage: FunnelStage = {
      key: def.key, label: def.label, count,
      conversionFromPrev: prev !== null && prev > 0 ? count / prev : null,
    };
    prev = count;
    return stage;
  });
  return {
    since, until, stages,
    blocked: queryEvents({ ...base, type: 'policy.blocked' }).total,
    optOuts: queryEvents({ ...base, type: ['dnc.added', 'sms.stop'] }).total,
    smsSent: queryEvents({ ...base, type: 'sms.sent' }).total,
    callbacksScheduled: queryEvents({ ...base, type: 'callback.scheduled' }).total,
  };
}

export interface BreakdownRow {
  key: string;
  leads: number;
  attempts: number;
  answered: number;
  qualified: number;
  transfers: number;
  connects: number;
  transferRate: number;   // connects / attempts
}

/** Group funnel counts by a data dimension recorded on the events. */
export function getBreakdown(dimension: 'campaignId' | 'state' | 'source' | 'insurer', opts: { since?: string } = {}): BreakdownRow[] {
  const since = opts.since || new Date(Date.now() - 7 * 86400000).toISOString();
  const { events } = queryEvents({ since, limit: 100000 });
  const rows = new Map<string, BreakdownRow>();
  const keyOf = (ev: { campaignId?: string; data: Record<string, unknown> }): string => {
    if (dimension === 'campaignId') return ev.campaignId || 'unknown';
    const v = ev.data[dimension];
    return typeof v === 'string' && v ? v : 'unknown';
  };
  for (const ev of events) {
    const key = keyOf(ev);
    let row = rows.get(key);
    if (!row) { row = { key, leads: 0, attempts: 0, answered: 0, qualified: 0, transfers: 0, connects: 0, transferRate: 0 }; rows.set(key, row); }
    switch (ev.type) {
      case 'lead.received': row.leads++; break;
      case 'call.attempted': row.attempts++; break;
      case 'call.answered': row.answered++; break;
      case 'call.qualified': row.qualified++; break;
      case 'transfer.initiated': row.transfers++; break;
      case 'transfer.connected': row.connects++; break;
      default: break;
    }
  }
  return [...rows.values()]
    .map(r => ({ ...r, transferRate: r.attempts > 0 ? r.connects / r.attempts : 0 }))
    .sort((a, b) => b.leads - a.leads || b.attempts - a.attempts);
}

export interface LiveOpsSnapshot {
  at: string;
  activeCalls: Array<{ callSid: string; leadName: string; status: string; startedAt: string }>;
  queueDepth: number;
  systemHealth: ReturnType<typeof getSystemHealth>;
  providerHealth: ReturnType<typeof getProviderHealth>;
  transfersInFlight: number;
  transfersToday: number;
  connectsToday: number;
  callbacksPending: number;
  blockedToday: number;
  optOutsToday: number;
  smsToday: number;
  attemptsToday: number;
  answeredToday: number;
  dncCount: number;
  campaignsActive: number;
  paused: boolean;
  ledger: ReturnType<typeof ledgerStats>;
  qa: { avgOverall: number; pendingReview: number };
}

export function getLiveOps(): LiveOpsSnapshot {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const count = (type: PlatformEventType | PlatformEventType[]) => queryEvents({ type, since, limit: 0 }).total;
  const transfers = listTransfers({ since, limit: 1000 });
  const qa = qaSummary();
  return {
    at: new Date().toISOString(),
    activeCalls: getActiveSessions().map(s => ({
      callSid: s.callSid, leadName: s.leadName, status: s.status,
      startedAt: new Date(s.startTime).toISOString(),
    })),
    queueDepth: getQueue().length,
    systemHealth: getSystemHealth(),
    providerHealth: getProviderHealth(),
    transfersInFlight: transfers.filter(t => !['completed', 'failed', 'abandoned'].includes(t.currentStage)).length,
    transfersToday: transfers.length,
    connectsToday: count('transfer.connected'),
    callbacksPending: getScheduledCallbacks({ status: 'pending' }).length,
    blockedToday: count('policy.blocked'),
    optOutsToday: count(['dnc.added', 'sms.stop']),
    smsToday: count('sms.sent'),
    attemptsToday: count('call.attempted'),
    answeredToday: count('call.answered'),
    dncCount: getDncCount(),
    campaignsActive: getAllCampaigns().filter(c => c.active).length,
    paused: getSettings().autoProcessingPaused,
    ledger: ledgerStats(),
    qa: { avgOverall: qa.avgOverall, pendingReview: qa.pendingReview },
  };
}

export interface ConversationIntelligenceSummary {
  qa: ReturnType<typeof qaSummary>;
  objections: ReturnType<typeof getObjectionStats>;
  recentFlagged: ReturnType<typeof listQaScores>;
}

export function getConversationIntelligence(): ConversationIntelligenceSummary {
  return {
    qa: qaSummary(),
    objections: getObjectionStats(),
    recentFlagged: listQaScores({ flaggedOnly: true, limit: 25 }),
  };
}
