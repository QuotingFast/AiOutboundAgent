import { logger } from '../utils/logger';
import { scheduleSave, loadData } from '../db/persistence';

// ── Per-call analytics ──────────────────────────────────────────────

export interface LatencyBreakdown {
  sttMs?: number;       // speech-to-text (input audio → transcription)
  llmMs?: number;       // LLM thinking (request → first token)
  ttsMs?: number;       // text-to-speech (text → first audio chunk)
  totalMs?: number;     // end-to-end (user stops talking → agent starts talking)
}

export interface TranscriptEntry {
  role: 'agent' | 'user' | 'system';
  text: string;
  timestamp: number;
  latency?: LatencyBreakdown;
}

export interface CallAnalyticsData {
  callSid: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  turnCount: number;
  agentTurns: number;
  userTurns: number;
  interruptions: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  transcript: TranscriptEntry[];
  latencyHistory: LatencyBreakdown[];
  sentiment: SentimentSnapshot[];
  dropOffPoint?: string;
  outcome: 'transferred' | 'ended' | 'dropped' | 'in_progress';
  transferRoute?: string;
  endReason?: string;
  costEstimate: CostEstimate;
  abTestVariant?: string;
  tags: string[];
  score?: number;
}

export interface SentimentSnapshot {
  timestamp: number;
  turn: number;
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  confidence: number;
}

export interface CostEstimate {
  realtimeInputTokens: number;
  realtimeOutputTokens: number;
  realtimeAudioInSeconds: number;
  realtimeAudioOutSeconds: number;
  elevenlabsCharacters: number;
  estimatedCostUsd: number;
}

// Pricing constants (USD) — updated 2025 rates
const PRICING = {
  // OpenAI Realtime
  realtimeAudioInputPerMin: 0.06,     // $0.06/min audio input
  realtimeAudioOutputPerMin: 0.24,    // $0.24/min audio output
  realtimeTextInputPer1k: 0.005,      // $5/1M input tokens
  realtimeTextOutputPer1k: 0.02,      // $20/1M output tokens
  // ElevenLabs
  elevenlabsPerChar: 0.00003,         // ~$30/1M chars (Turbo v2.5)
  // Twilio
  twilioPerMin: 0.014,               // ~$0.014/min outbound
};

export class CallAnalytics {
  private data: CallAnalyticsData;
  private turnStartTime = 0;
  private responseStartTime = 0;
  private currentLatency: Partial<LatencyBreakdown> = {};

  constructor(callSid: string) {
    this.data = {
      callSid,
      startTime: Date.now(),
      turnCount: 0,
      agentTurns: 0,
      userTurns: 0,
      interruptions: 0,
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      transcript: [],
      latencyHistory: [],
      sentiment: [],
      outcome: 'in_progress',
      costEstimate: {
        realtimeInputTokens: 0,
        realtimeOutputTokens: 0,
        realtimeAudioInSeconds: 0,
        realtimeAudioOutSeconds: 0,
        elevenlabsCharacters: 0,
        estimatedCostUsd: 0,
      },
      tags: [],
      score: undefined,
    };
  }

  // ── Turn tracking ──

  userStartedSpeaking(): void {
    this.turnStartTime = Date.now();
  }

  userFinishedSpeaking(transcript?: string): void {
    this.data.userTurns++;
    this.data.turnCount++;
    this.responseStartTime = Date.now();
    this.currentLatency = {};

    if (transcript) {
      this.data.transcript.push({
        role: 'user',
        text: transcript,
        timestamp: Date.now(),
      });
    }
  }

  agentStartedSpeaking(): void {
    const now = Date.now();
    if (this.responseStartTime > 0) {
      this.currentLatency.totalMs = now - this.responseStartTime;
    }
    this.data.agentTurns++;
  }

  agentFinishedSpeaking(text?: string): void {
    if (Object.keys(this.currentLatency).length > 0) {
      this.data.latencyHistory.push(this.currentLatency as LatencyBreakdown);
      this.updateLatencyStats();
    }

    if (text) {
      this.data.transcript.push({
        role: 'agent',
        text,
        timestamp: Date.now(),
        latency: { ...this.currentLatency } as LatencyBreakdown,
      });
    }
    this.currentLatency = {};
  }

  recordInterruption(): void {
    this.data.interruptions++;
  }

  // ── Latency ──

  recordLLMLatency(ms: number): void {
    this.currentLatency.llmMs = ms;
  }

  recordTTSLatency(ms: number): void {
    this.currentLatency.ttsMs = ms;
  }

  recordSTTLatency(ms: number): void {
    this.currentLatency.sttMs = ms;
  }

  private updateLatencyStats(): void {
    const totals = this.data.latencyHistory
      .map(l => l.totalMs)
      .filter((t): t is number => t !== undefined && t > 0);
    if (totals.length === 0) return;
    this.data.avgLatencyMs = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
    this.data.maxLatencyMs = Math.max(...totals);
  }

  // ── Sentiment ──

  recordSentiment(sentiment: SentimentSnapshot['sentiment'], confidence: number): void {
    this.data.sentiment.push({
      timestamp: Date.now(),
      turn: this.data.turnCount,
      sentiment,
      confidence,
    });
  }

  // ── Cost tracking ──

  addAudioInputSeconds(seconds: number): void {
    this.data.costEstimate.realtimeAudioInSeconds += seconds;
  }

  addAudioOutputSeconds(seconds: number): void {
    this.data.costEstimate.realtimeAudioOutSeconds += seconds;
  }

  addTokens(input: number, output: number): void {
    this.data.costEstimate.realtimeInputTokens += input;
    this.data.costEstimate.realtimeOutputTokens += output;
  }

  addElevenLabsCharacters(chars: number): void {
    this.data.costEstimate.elevenlabsCharacters += chars;
  }

  // ── Outcome ──

  setOutcome(outcome: CallAnalyticsData['outcome'], reason?: string): void {
    this.data.outcome = outcome;
    this.data.endReason = reason;
    if (outcome === 'transferred') {
      this.data.dropOffPoint = undefined;
    }
  }

  setTransferRoute(route: string): void {
    this.data.transferRoute = route;
  }

  setDropOffPoint(point: string): void {
    this.data.dropOffPoint = point;
  }

  setABTestVariant(variant: string): void {
    this.data.abTestVariant = variant;
  }

  addTag(tag: string): void {
    if (!this.data.tags.includes(tag)) {
      this.data.tags.push(tag);
    }
  }

  setScore(score: number): void {
    this.data.score = Math.max(0, Math.min(100, score));
  }

  addTranscriptEntry(role: TranscriptEntry['role'], text: string): void {
    this.data.transcript.push({ role, text, timestamp: Date.now() });
  }

  // ── Finalize ──

  finalize(): CallAnalyticsData {
    this.data.endTime = Date.now();
    this.data.durationMs = this.data.endTime - this.data.startTime;

    // Calculate cost
    const c = this.data.costEstimate;
    const durationMin = (this.data.durationMs / 1000) / 60;
    c.estimatedCostUsd = parseFloat((
      c.realtimeAudioInSeconds / 60 * PRICING.realtimeAudioInputPerMin +
      c.realtimeAudioOutSeconds / 60 * PRICING.realtimeAudioOutputPerMin +
      c.realtimeInputTokens / 1000 * PRICING.realtimeTextInputPer1k +
      c.realtimeOutputTokens / 1000 * PRICING.realtimeTextOutputPer1k +
      c.elevenlabsCharacters * PRICING.elevenlabsPerChar +
      durationMin * PRICING.twilioPerMin
    ).toFixed(4));

    // Reclassify "dropped" calls that had significant engagement
    if (this.data.outcome === 'dropped' && (this.data.turnCount >= 5 || this.data.durationMs > 60000)) {
      this.data.outcome = 'ended';
      this.data.endReason = this.data.endReason || 'reclassified: significant engagement detected';
      this.addTag('auto-reclassified');
    }

    // Auto-score if not manually scored
    if (this.data.score === undefined) {
      this.data.score = this.autoScore();
    }

    // Detect drop-off point
    if (this.data.outcome !== 'transferred' && this.data.transcript.length > 0) {
      const lastAgent = [...this.data.transcript].reverse().find(t => t.role === 'agent');
      if (lastAgent) {
        this.data.dropOffPoint = lastAgent.text.substring(0, 100);
      }
    }

    logger.info('analytics', 'Call finalized', {
      callSid: this.data.callSid,
      durationMs: this.data.durationMs,
      turns: this.data.turnCount,
      outcome: this.data.outcome,
      avgLatencyMs: this.data.avgLatencyMs,
      cost: c.estimatedCostUsd,
      score: this.data.score,
    });

    return this.data;
  }

  private autoScore(): number {
    let score = 50;
    if (this.data.outcome === 'transferred') score += 30;
    if (this.data.turnCount >= 4) score += 10;
    if (this.data.avgLatencyMs < 500) score += 5;
    if (this.data.interruptions < 3) score += 5;
    const lastSentiments = this.data.sentiment.slice(-3);
    const positives = lastSentiments.filter(s => s.sentiment === 'positive').length;
    score += positives * 5;
    const negatives = lastSentiments.filter(s => s.sentiment === 'negative' || s.sentiment === 'frustrated').length;
    score -= negatives * 10;
    return Math.max(0, Math.min(100, score));
  }

  getData(): CallAnalyticsData { return { ...this.data }; }
  getTranscript(): TranscriptEntry[] { return [...this.data.transcript]; }
  getCost(): CostEstimate { return { ...this.data.costEstimate }; }
}

// ── Global analytics store ──────────────────────────────────────────

const analyticsStore: CallAnalyticsData[] = [];
const MAX_STORED = 100;
const activeAnalytics = new Map<string, CallAnalytics>();

const ANALYTICS_KEY = 'analytics';

function persistAnalytics(): void {
  scheduleSave(ANALYTICS_KEY, () => analyticsStore);
}

export function loadAnalyticsFromDisk(): void {
  const saved = loadData<CallAnalyticsData[]>(ANALYTICS_KEY);
  if (saved) {
    analyticsStore.push(...saved);
    logger.info('analytics', `Loaded ${saved.length} analytics records from disk`);
  }
}

export function createCallAnalytics(callSid: string): CallAnalytics {
  const a = new CallAnalytics(callSid);
  activeAnalytics.set(callSid, a);
  return a;
}

export function getActiveAnalytics(callSid: string): CallAnalytics | undefined {
  return activeAnalytics.get(callSid);
}

export function finalizeCallAnalytics(callSid: string): CallAnalyticsData | undefined {
  const a = activeAnalytics.get(callSid);
  if (!a) return undefined;
  const data = a.finalize();
  analyticsStore.unshift(data);
  if (analyticsStore.length > MAX_STORED) analyticsStore.length = MAX_STORED;
  activeAnalytics.delete(callSid);
  persistAnalytics();
  return data;
}

export function getAnalyticsHistory(): CallAnalyticsData[] {
  return [...analyticsStore];
}

export function getAnalyticsSummary(): {
  totalCalls: number;
  avgDurationMs: number;
  avgLatencyMs: number;
  transferRate: number;
  avgScore: number;
  totalCostUsd: number;
  outcomes: Record<string, number>;
} {
  const calls = analyticsStore;
  if (calls.length === 0) {
    return { totalCalls: 0, avgDurationMs: 0, avgLatencyMs: 0, transferRate: 0, avgScore: 0, totalCostUsd: 0, outcomes: {} };
  }

  const outcomes: Record<string, number> = {};
  let totalDuration = 0, totalLatency = 0, totalScore = 0, totalCost = 0, transfers = 0;

  for (const c of calls) {
    totalDuration += c.durationMs || 0;
    totalLatency += c.avgLatencyMs;
    totalScore += c.score || 0;
    totalCost += c.costEstimate.estimatedCostUsd;
    outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1;
    if (c.outcome === 'transferred') transfers++;
  }

  return {
    totalCalls: calls.length,
    avgDurationMs: Math.round(totalDuration / calls.length),
    avgLatencyMs: Math.round(totalLatency / calls.length),
    transferRate: parseFloat((transfers / calls.length * 100).toFixed(1)),
    avgScore: Math.round(totalScore / calls.length),
    totalCostUsd: parseFloat(totalCost.toFixed(4)),
    outcomes,
  };
}
