import { logger } from '../utils/logger';
import { loadData, scheduleSave } from '../db/persistence';

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

// In-memory store backed by JSON file persistence
const leadStore = new Map<string, LeadMemory>();

const LEADS_STORE_KEY = 'leads';

function persistLeads(): void {
  scheduleSave(LEADS_STORE_KEY, () => Object.fromEntries(leadStore));
}

export function loadLeadsFromDisk(): void {
  const data = loadData<Record<string, LeadMemory>>(LEADS_STORE_KEY);
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      leadStore.set(key, value);
    }
    logger.info('memory', `Loaded ${leadStore.size} leads from disk`);
  }
}

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
    persistLeads();
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
  persistLeads();
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
  persistLeads();
  return lead;
}

export function setLeadDisposition(phone: string, disposition: LeadMemory['disposition']): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead) {
    lead.disposition = disposition;
    persistLeads();
  }
}

export function addLeadNote(phone: string, note: string): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead) {
    lead.notes.push(`[${new Date().toISOString()}] ${note}`);
    persistLeads();
  }
}

export function addLeadTag(phone: string, tag: string): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead && !lead.tags.includes(tag)) {
    lead.tags.push(tag);
    persistLeads();
  }
}

export function scheduleCallback(phone: string, dateTime: string): void {
  const lead = leadStore.get(normalizePhone(phone));
  if (lead) {
    lead.callbackScheduled = dateTime;
    lead.disposition = 'callback';
    persistLeads();
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

// ── Search & Filter ──

export interface LeadSearchOptions {
  query?: string;          // Search name, phone
  disposition?: string;
  state?: string;
  tag?: string;
  dateFrom?: string;       // ISO
  dateTo?: string;         // ISO
  source?: string;
  page?: number;
  limit?: number;
}

export interface LeadSearchResult {
  leads: LeadMemory[];
  total: number;
  page: number;
  pages: number;
}

export function searchLeads(opts: LeadSearchOptions): LeadSearchResult {
  let results = Array.from(leadStore.values());

  if (opts.query) {
    const q = opts.query.toLowerCase();
    results = results.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.phone.includes(q.replace(/\D/g, '')) ||
      (l.state && l.state.toLowerCase().includes(q)) ||
      (l.currentInsurer && l.currentInsurer.toLowerCase().includes(q))
    );
  }

  if (opts.disposition) {
    results = results.filter(l => l.disposition === opts.disposition);
  }

  if (opts.state) {
    results = results.filter(l => l.state?.toUpperCase() === opts.state!.toUpperCase());
  }

  if (opts.tag) {
    results = results.filter(l => l.tags.includes(opts.tag!));
  }

  if (opts.source) {
    results = results.filter(l => l.customFields.source === opts.source);
  }

  if (opts.dateFrom) {
    const from = new Date(opts.dateFrom).getTime();
    results = results.filter(l => new Date(l.lastContactedAt).getTime() >= from);
  }

  if (opts.dateTo) {
    const to = new Date(opts.dateTo).getTime();
    results = results.filter(l => new Date(l.lastContactedAt).getTime() <= to);
  }

  // Sort by most recently contacted
  results.sort((a, b) => new Date(b.lastContactedAt).getTime() - new Date(a.lastContactedAt).getTime());

  const total = results.length;
  const limit = opts.limit || 50;
  const page = opts.page || 1;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;

  return {
    leads: results.slice(start, start + limit),
    total,
    page,
    pages,
  };
}

// ── Import / Export ──

// Normalize a CSV header to a canonical key for flexible matching.
// Lowercases, trims, and converts spaces/hyphens to underscores.
function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/"/g, '').replace(/[\s-]+/g, '_');
}

// Find first matching column index from a list of aliases
function findCol(headers: string[], ...aliases: string[]): number {
  return headers.findIndex(h => aliases.includes(h));
}

export function importLeadsFromCSV(csvText: string): { imported: number; skipped: number; errors: string[] } {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return { imported: 0, skipped: 0, errors: ['No data rows found'] };

  // Parse header row through the CSV parser to handle quoted headers, then normalize
  const rawHeaders = parseCSVLine(lines[0]);
  const header = rawHeaders.map(normalizeHeader);
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Map columns — support both simple and vendor-format headers
  const phoneIdx = findCol(header, 'phone', 'phone_number', 'primary_phone');
  const phone2Idx = findCol(header, 'phone_2', 'phone2', 'secondary_phone');
  const firstNameIdx = findCol(header, 'first_name', 'firstname', 'name', 'drivers_1_first_name');
  const lastNameIdx = findCol(header, 'last_name', 'lastname', 'drivers_1_last_name');
  const stateIdx = findCol(header, 'state');
  const zipIdx = findCol(header, 'zip_code', 'zip', 'zipcode');
  const cityIdx = findCol(header, 'city');
  const emailIdx = findCol(header, 'email');
  const addressIdx = findCol(header, 'address');
  const insurerIdx = findCol(header, 'current_insurer', 'insurer', 'current_policy_insurance_company');
  const sourceIdx = findCol(header, 'source');
  const notesIdx = findCol(header, 'notes');

  // Vehicle columns (up to 3 vehicles)
  const vehicleCols: { yearIdx: number; makeIdx: number; modelIdx: number }[] = [];
  for (let v = 1; v <= 3; v++) {
    const yearIdx = findCol(header, `vehicles_${v}_year`, `vehicle_${v}_year`, ...(v === 1 ? ['vehicle_year'] : []));
    const makeIdx = findCol(header, `vehicles_${v}_make`, `vehicle_${v}_make`, ...(v === 1 ? ['vehicle_make'] : []));
    const modelIdx = findCol(header, `vehicles_${v}_model`, `vehicle_${v}_model`, ...(v === 1 ? ['vehicle_model'] : []));
    if (yearIdx >= 0 || makeIdx >= 0 || modelIdx >= 0) {
      vehicleCols.push({ yearIdx, makeIdx, modelIdx });
    }
  }

  // Compliance columns
  const tcpaIdx = findCol(header, 'tcpa', 'tcpa_consent');
  const tcpaTextIdx = findCol(header, 'tcpa_consent_text');
  const trustedFormIdx = findCol(header, 'trusted_form_cert_url', 'trustedform_cert_url', 'trustedform');
  const leadIdIdx = findCol(header, 'leadid_code', 'leadid', 'lead_id');

  // Driver detail columns
  const driverDobIdx = findCol(header, 'drivers_1_birth_date', 'dob', 'birth_date');
  const driverGenderIdx = findCol(header, 'drivers_1_gender', 'gender');
  const driverMaritalIdx = findCol(header, 'drivers_1_marital_status', 'marital_status');

  // Coverage columns
  const coverageTypeIdx = findCol(header, 'requested_policy_coverage_type', 'coverage_type');
  const currentCoverageIdx = findCol(header, 'current_policy_coverage_type');

  if (phoneIdx < 0) return { imported: 0, skipped: 0, errors: ['Missing required "phone" column'] };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    let phone = cols[phoneIdx]?.trim();
    // Fall back to phone_2 if primary is empty
    if (!phone && phone2Idx >= 0) phone = cols[phone2Idx]?.trim();
    if (!phone) { skipped++; continue; }

    const firstName = cols[firstNameIdx]?.trim() || '';
    const lastName = lastNameIdx >= 0 ? cols[lastNameIdx]?.trim() || '' : '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
    const state = stateIdx >= 0 ? cols[stateIdx]?.trim() : undefined;
    const insurer = insurerIdx >= 0 ? cols[insurerIdx]?.trim() : undefined;
    const source = sourceIdx >= 0 ? cols[sourceIdx]?.trim() : undefined;
    const notes = notesIdx >= 0 ? cols[notesIdx]?.trim() : undefined;

    // Build vehicles array
    const vehicles: { year?: string; make?: string; model?: string }[] = [];
    for (const vc of vehicleCols) {
      const year = vc.yearIdx >= 0 ? cols[vc.yearIdx]?.trim() : undefined;
      const make = vc.makeIdx >= 0 ? cols[vc.makeIdx]?.trim() : undefined;
      const model = vc.modelIdx >= 0 ? cols[vc.modelIdx]?.trim() : undefined;
      if (year || make || model) vehicles.push({ year, make, model });
    }

    // Build custom fields from extra columns
    const customFields: Record<string, unknown> = {};
    if (source) customFields.source = source;
    if (emailIdx >= 0 && cols[emailIdx]?.trim()) customFields.email = cols[emailIdx].trim();
    if (zipIdx >= 0 && cols[zipIdx]?.trim()) customFields.zipCode = cols[zipIdx].trim();
    if (cityIdx >= 0 && cols[cityIdx]?.trim()) customFields.city = cols[cityIdx].trim();
    if (addressIdx >= 0 && cols[addressIdx]?.trim()) customFields.address = cols[addressIdx].trim();
    if (phone2Idx >= 0 && cols[phone2Idx]?.trim()) customFields.phone2 = cols[phone2Idx].trim();
    if (leadIdIdx >= 0 && cols[leadIdIdx]?.trim()) customFields.leadId = cols[leadIdIdx].trim();
    if (trustedFormIdx >= 0 && cols[trustedFormIdx]?.trim()) customFields.trustedFormUrl = cols[trustedFormIdx].trim();
    if (tcpaIdx >= 0 && cols[tcpaIdx]?.trim()) customFields.tcpaCompliant = cols[tcpaIdx].trim();
    if (tcpaTextIdx >= 0 && cols[tcpaTextIdx]?.trim()) customFields.tcpaConsentText = cols[tcpaTextIdx].trim();
    if (coverageTypeIdx >= 0 && cols[coverageTypeIdx]?.trim()) customFields.requestedCoverageType = cols[coverageTypeIdx].trim();
    if (currentCoverageIdx >= 0 && cols[currentCoverageIdx]?.trim()) customFields.currentCoverageType = cols[currentCoverageIdx].trim();
    if (vehicles.length > 0) customFields.vehicles = vehicles;

    // Driver details
    if (driverDobIdx >= 0 || driverGenderIdx >= 0 || driverMaritalIdx >= 0) {
      const driver: Record<string, string> = {};
      if (driverDobIdx >= 0 && cols[driverDobIdx]?.trim()) driver.birthDate = cols[driverDobIdx].trim();
      if (driverGenderIdx >= 0 && cols[driverGenderIdx]?.trim()) driver.gender = cols[driverGenderIdx].trim();
      if (driverMaritalIdx >= 0 && cols[driverMaritalIdx]?.trim()) driver.maritalStatus = cols[driverMaritalIdx].trim();
      if (Object.keys(driver).length > 0) customFields.primaryDriver = driver;
    }

    try {
      createOrUpdateLead(phone, {
        name,
        state,
        currentInsurer: insurer,
        customFields,
        notes: notes ? [notes] : [],
      });
      imported++;
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  persistLeads();
  logger.info('memory', 'CSV import completed', { imported, skipped, errors: errors.length });
  return { imported, skipped, errors };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function exportLeadsToCSV(): string {
  const leads = Array.from(leadStore.values());
  const header = 'phone,name,state,current_insurer,disposition,total_calls,last_contacted,tags,source,notes';
  const rows = leads.map(l => {
    const source = (l.customFields.source as string) || '';
    const notes = l.notes.length > 0 ? l.notes[l.notes.length - 1] : '';
    return [
      l.phone,
      csvEscape(l.name),
      l.state || '',
      csvEscape(l.currentInsurer || ''),
      l.disposition,
      l.totalCalls.toString(),
      l.lastContactedAt,
      csvEscape(l.tags.join('; ')),
      csvEscape(source),
      csvEscape(notes),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── Lead Scoring ──

export function calculateLeadScore(phone: string): number {
  const lead = leadStore.get(normalizePhone(phone));
  if (!lead) return 0;

  let score = 0;

  // Engagement: calls answered
  score += Math.min(lead.totalCalls * 10, 30);

  // Call duration (average)
  if (lead.callHistory.length > 0) {
    const avgDuration = lead.callHistory.reduce((sum, c) => sum + c.durationMs, 0) / lead.callHistory.length;
    if (avgDuration > 120_000) score += 25;       // > 2 min
    else if (avgDuration > 60_000) score += 15;    // > 1 min
    else if (avgDuration > 30_000) score += 5;     // > 30s
  }

  // Transferred = high intent
  if (lead.disposition === 'transferred') score += 30;
  else if (lead.disposition === 'interested') score += 20;
  else if (lead.disposition === 'callback') score += 15;

  // Recent sentiment
  const lastCall = lead.callHistory[lead.callHistory.length - 1];
  if (lastCall) {
    if (lastCall.sentimentOverall === 'positive') score += 10;
    if (lastCall.score > 70) score += 10;
  }

  return Math.min(100, score);
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

  // Include weblead form data if available (vehicles, coverage, etc.)
  const cf = lead.customFields as Record<string, any>;
  if (cf && Object.keys(cf).length > 0) {
    const webDataLines: string[] = [];
    // Vehicles
    if (cf.vehicles && Array.isArray(cf.vehicles) && cf.vehicles.length > 0) {
      const vehDescriptions = cf.vehicles.map((v: any) => [v.year, v.make, v.model].filter(Boolean).join(' ')).filter(Boolean);
      if (vehDescriptions.length > 0) {
        webDataLines.push(`- Vehicles on quote: ${vehDescriptions.join(', ')}`);
      }
    }
    // Current policy
    if (cf.currentPolicy) {
      if (cf.currentPolicy.insurer) webDataLines.push(`- Current insurer (from form): ${cf.currentPolicy.insurer}`);
      if (cf.currentPolicy.coverageType) webDataLines.push(`- Current coverage type: ${cf.currentPolicy.coverageType}`);
      if (cf.currentPolicy.expirationDate) webDataLines.push(`- Policy expiration: ${cf.currentPolicy.expirationDate}`);
    }
    // Requested policy
    if (cf.requestedPolicy && cf.requestedPolicy.coverageType) {
      webDataLines.push(`- Looking for: ${cf.requestedPolicy.coverageType} coverage`);
    }
    // Drivers
    if (cf.drivers && Array.isArray(cf.drivers) && cf.drivers.length > 0) {
      webDataLines.push(`- Number of drivers: ${cf.drivers.length}`);
      const primaryDriver = cf.drivers[0];
      if (primaryDriver.maritalStatus) webDataLines.push(`- Marital status: ${primaryDriver.maritalStatus}`);
    }
    // Contact
    if (cf.contact) {
      if (cf.contact.city && cf.contact.state) webDataLines.push(`- Location: ${cf.contact.city}, ${cf.contact.state}`);
    }
    if (webDataLines.length > 0) {
      lines.push(`\nINFO FROM THEIR ONLINE QUOTE REQUEST:`);
      lines.push(...webDataLines);
      lines.push(`Reference this info naturally to show you know their situation — e.g., "I see you're looking for coverage on your [vehicle]" — but don't recite every detail.`);
    }
  }

  lines.push(`\nUse this context naturally — don't mention you have notes. If they called before, acknowledge familiarity subtly.`);

  return lines.join('\n');
}
