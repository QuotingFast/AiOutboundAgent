import { logger } from '../utils/logger';

// ── Cross-Session Lead Memory ───────────────────────────────────────

export interface LeadMemory {
  phone: string;
  name: string;
  state?: string;
  currentInsurer?: string;
  callHistory: LeadCallSummary[];
  notes: string[];
  tags: string[];
  lastContactedAt: string;
  totalCalls: number;
  disposition: 'new' | 'contacted' | 'interested' | 'transferred' | 'not_interested' | 'dnc' | 'callback';
  callbackScheduled?: string;
  customFields: Record<string, unknown>;
}

export interface LeadCallSummary {
  callSid: string;
  timestamp: string;
  durationMs: number;
  outcome: string;
  score: number;
  agentName: string;
  voiceProvider: string;
  keyMoments: string[];
  sentimentOverall: string;
}

// In-memory store (in production, this would be a database)
const leadStore = new Map<string, LeadMemory>();

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').replace(/^1/, '');
}

// ── CRUD Operations ──

export function getLeadMemory(phone: string): LeadMemory | undefined {
  return leadStore.get(normalizePhone(phone));
}

export function createOrUpdateLead(phone: string, data: Partial<LeadMemory>): LeadMemory {
  const normalized = normalizePhone(phone);
  const existing = leadStore.get(normalized);

  if (existing) {
    // Merge updates
    const updated = { ...existing, ...data, phone: normalized };
    if (data.notes) updated.notes = [...existing.notes, ...data.notes];
    if (data.tags) updated.tags = Array.from(new Set([...existing.tags, ...data.tags]));
    if (data.callHistory) updated.callHistory = [...existing.callHistory, ...data.callHistory];
    if (data.customFields) updated.customFields = { ...existing.customFields, ...data.customFields };
    leadStore.set(normalized, updated);
    return updated;
  }

  const newLead: LeadMemory = {
    phone: normalized,
    name: data.name || 'Unknown',
    state: data.state,
    currentInsurer: data.currentInsurer,
    callHistory: data.callHistory || [],
    notes: data.notes || [],
    tags: data.tags || [],
    lastContactedAt: new Date().toISOString(),
    totalCalls: 0,
    disposition: 'new',
    customFields: data.customFields || {},
  };
  leadStore.set(normalized, newLead);
  return newLead;
}

export function recordCallToLead(phone: string, summary: LeadCallSummary): LeadMemory {
  const normalized = normalizePhone(phone);
  const lead = leadStore.get(normalized) || createOrUpdateLead(phone, {});

  lead.callHistory.push(summary);
  lead.totalCalls++;
  lead.lastContactedAt = new Date().toISOString();

  // Auto-update disposition based on outcome
  if (summary.outcome === 'transferred') lead.disposition = 'transferred';
  else if (summary.outcome === 'ended' && summary.score < 30) lead.disposition = 'not_interested';
  else if (summary.outcome === 'ended') lead.disposition = 'contacted';

  leadStore.set(normalized, lead);
  return lead;
}

export function setLeadDisposition(phone: string, disposition: LeadMemory['disposition']): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead) lead.disposition = disposition;
}

export function addLeadNote(phone: string, note: string): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead) {
    lead.notes.push(`[${new Date().toISOString()}] ${note}`);
  }
}

export function addLeadTag(phone: string, tag: string): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead && !lead.tags.includes(tag)) {
    lead.tags.push(tag);
  }
}

export function scheduleCallback(phone: string, dateTime: string): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead) {
    lead.callbackScheduled = dateTime;
    lead.disposition = 'callback';
    logger.info('memory', 'Callback scheduled', { phone: normalizePhone(phone), dateTime });
  }
}

// ── Query ──

export function getAllLeads(): LeadMemory[] {
  return Array.from(leadStore.values());
}

export function getLeadsByDisposition(disposition: LeadMemory['disposition']): LeadMemory[] {
  return Array.from(leadStore.values()).filter(l => l.disposition === disposition);
}

export function getLeadsForCallback(): LeadMemory[] {
  return Array.from(leadStore.values()).filter(l =>
    l.disposition === 'callback' && l.callbackScheduled
  );
}

export function getLeadCount(): number {
  return leadStore.size;
}

// ── Context Building ──

export function buildLeadContext(phone: string): string {
  const lead = getLeadMemory(phone);
  if (!lead || lead.callHistory.length === 0) return '';

  const lines: string[] = [];
  lines.push(`PREVIOUS INTERACTION CONTEXT:`);
  lines.push(`- Total previous calls: ${lead.totalCalls}`);
  lines.push(`- Last contacted: ${lead.lastContactedAt}`);
  lines.push(`- Current disposition: ${lead.disposition}`);

  if (lead.currentInsurer) {
    lines.push(`- Known current insurer: ${lead.currentInsurer}`);
  }

  // Summarize last call
  const lastCall = lead.callHistory[lead.callHistory.length - 1];
  if (lastCall) {
    lines.push(`- Last call outcome: ${lastCall.outcome}`);
    lines.push(`- Last call duration: ${Math.round(lastCall.durationMs / 1000)}s`);
    if (lastCall.keyMoments.length > 0) {
      lines.push(`- Key moments from last call: ${lastCall.keyMoments.join('; ')}`);
    }
  }

  if (lead.notes.length > 0) {
    const recentNotes = lead.notes.slice(-3);
    lines.push(`- Recent notes: ${recentNotes.join(' | ')}`);
  }

  lines.push(`\nUse this context naturally — don't mention you have notes. If they called before, acknowledge familiarity subtly.`);

  return lines.join('\n');
}
