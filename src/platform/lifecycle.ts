// ── Lifecycle Revenue Engine ───────────────────────────────────────
// Turns every consented lead into a renewable asset with three
// monetization surfaces, held compliantly in the funnel by renewing
// the TCPA opt-in before it expires:
//
//   1. warm_transfer / verified_inbound — qualified live calls sold
//      to buyers (no cooldown).
//   2. weblead_submission — "text me the quote" sends a tracked,
//      prefilled webform; submission = new sellable weblead AND a
//      fresh 90-day TCPA opt-in. Max one countable submission per
//      lead per 30 days (buyers reject faster resubmits as dupes);
//      a submission inside the cooldown still renews consent but is
//      flagged duplicate and valued at $0.
//   3. offer_click — partner quote offers shown after form submission
//      (and sendable as links anytime). Unlimited frequency.
//
// The renewal loop: when a lead's consent enters the renewal window
// (default: last 25 days of validity) and the weblead cooldown has
// lapsed, the lead surfaces in the renewal pipeline and — when auto-
// renewal is on — gets a policy-gated SMS with a fresh prefilled form
// link, restarting the 90-day clock on submission.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { getConsent, recordConsent, isOnDnc } from '../compliance';
import { getLeadMemory, getAllLeads, addLeadNote } from '../memory';
import { getPolicyConfig, evaluateOutreach, isBlocked, hasSmsStop } from './policy';
import { recordEvent, onEvent, normalizePhone, queryEvents } from './events';
import { buildLeadProfile } from './leadprofile';
import { config } from '../config';
import { logger } from '../utils/logger';

export type ConversionType = 'warm_transfer' | 'verified_inbound' | 'weblead_submission' | 'offer_click';

export interface ConversionRecord {
  id: string;
  type: ConversionType;
  phone: string;
  campaignId?: string;
  callSid?: string;
  value: number;               // revenue attributed (0 for duplicates)
  duplicate?: boolean;         // weblead inside the 30-day cooldown
  at: string;
  meta?: Record<string, unknown>;
}

export interface TrackedLink {
  token: string;
  phone: string;
  kind: 'webform' | 'offers';
  campaignId?: string;
  createdAt: string;
  sentVia?: 'sms' | 'email' | 'manual';
  clicks: number;
  lastClickAt?: string;
  submittedAt?: string;
}

export interface LifecycleConfig {
  webformBaseUrl: string;        // prefilled quote form host
  offerWallUrl: string;          // partner offer wall
  // Extra query params appended to the webform link that tell the form
  // to jump straight to the FINAL review slide (all fields pre-filled,
  // one tap to submit → offers). Set this to match your form, e.g.
  // "step=review", "slide=final", "prefilled=1", or a combination like
  // "step=review&autofill=1". Leave blank if your form auto-advances.
  webformFinalStepParams: string;
  // How the form receives the lead data:
  //   'query'  — individual fields as query params (default)
  //   'payload'— a single base64url JSON blob in the `d` param (use when
  //              the form ingests one encoded object like the offer wall)
  //   'token'  — send only the tracking token; the form looks the lead up
  //              server-side via GET /api/v2/links/:token/lead
  webformPrefillMode: 'query' | 'payload' | 'token';
  webleadCooldownDays: number;   // min days between countable submissions
  renewalWindowDays: number;     // start renewal pushes this many days before consent expiry
  renewalPushMinGapDays: number; // don't re-push the same lead more often than this
  autoRenewalSmsEnabled: boolean;
  values: Record<ConversionType, number>;   // default revenue per conversion
}

const DEFAULT_CONFIG: LifecycleConfig = {
  webformBaseUrl: 'https://quotingfast.com/quote',
  offerWallUrl: 'https://quotingfast.com/offers',
  webformFinalStepParams: 'step=review&prefilled=1',
  webformPrefillMode: 'query',
  webleadCooldownDays: 30,
  renewalWindowDays: 25,
  renewalPushMinGapDays: 7,
  autoRenewalSmsEnabled: false,   // opt-in: flip once the form host is live
  values: { warm_transfer: 55, verified_inbound: 40, weblead_submission: 12, offer_click: 3.5 },
};

const CONFIG_KEY = 'platform_lifecycle';
const CONVERSIONS_KEY = 'platform_conversions';
const LINKS_KEY = 'platform_links';
const MAX_CONVERSIONS = 20000;
const MAX_LINKS = 20000;

let cfg: LifecycleConfig = { ...DEFAULT_CONFIG };
let conversions: ConversionRecord[] = [];
let links = new Map<string, TrackedLink>();
const lastRenewalPush = new Map<string, string>();  // phone -> ISO (persisted with links)
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function loadLifecycle(): void {
  const savedCfg = loadData<LifecycleConfig>(CONFIG_KEY);
  if (savedCfg) cfg = { ...DEFAULT_CONFIG, ...savedCfg, values: { ...DEFAULT_CONFIG.values, ...(savedCfg.values || {}) } };
  const savedConversions = loadData<ConversionRecord[]>(CONVERSIONS_KEY);
  if (Array.isArray(savedConversions)) conversions = savedConversions;
  const savedLinks = loadData<{ links: TrackedLink[]; renewalPushes?: Record<string, string> }>(LINKS_KEY);
  if (savedLinks?.links) links = new Map(savedLinks.links.map(l => [l.token, l]));
  for (const [p, at] of Object.entries(savedLinks?.renewalPushes || {})) lastRenewalPush.set(p, at);

  // Auto-attribute transfer revenue: one warm_transfer conversion per
  // connected transfer, recorded the moment the ledger sees the bridge.
  onEvent(ev => {
    if (ev.type === 'transfer.connected' && ev.phone) {
      recordConversion({
        type: 'warm_transfer', phone: ev.phone, campaignId: ev.campaignId, callSid: ev.callSid,
        meta: { transferId: (ev.data as Record<string, unknown>).transferId },
      });
    }
  });
  logger.info('lifecycle', `Lifecycle engine loaded — ${conversions.length} conversions, ${links.size} tracked links`);
}

function persistConfig(): void { scheduleSave(CONFIG_KEY, () => cfg); }
function persistConversions(): void {
  if (conversions.length > MAX_CONVERSIONS) conversions = conversions.slice(-MAX_CONVERSIONS);
  scheduleSave(CONVERSIONS_KEY, () => conversions);
}
function persistLinks(): void {
  scheduleSave(LINKS_KEY, () => ({
    links: [...links.values()].slice(-MAX_LINKS),
    renewalPushes: Object.fromEntries(lastRenewalPush),
  }));
}

export function getLifecycleConfig(): LifecycleConfig { return cfg; }

export function updateLifecycleConfig(updates: Partial<LifecycleConfig>, actor = 'system'): LifecycleConfig {
  cfg = { ...cfg, ...updates, values: { ...cfg.values, ...(updates.values || {}) } };
  persistConfig();
  recordEvent('config.changed', { scope: 'lifecycle', updates }, { actor });
  return cfg;
}

// ── Lead lifecycle status ───────────────────────────────────────────

export interface LeadLifecycle {
  phone: string;
  consent: {
    status: 'none' | 'active' | 'expiring' | 'expired';
    recordedAt?: string;
    expiresAt?: string;
    daysLeft?: number;
    source?: string;
  };
  weblead: {
    lastSubmittedAt?: string;
    eligibleAt: string;          // now if never submitted / cooldown lapsed
    eligibleNow: boolean;
    daysUntilEligible: number;
  };
  conversions: ConversionRecord[];
  totalValue: number;
  renewalDue: boolean;           // in the renewal window AND weblead-eligible
}

function consentValidityDays(): number {
  const days = getPolicyConfig().consentMaxAgeDays;
  return days > 0 ? days : 90;
}

export function getLeadLifecycle(rawPhone: string, now: Date = new Date()): LeadLifecycle {
  const phone = normalizePhone(rawPhone);
  const consent = getConsent(phone);
  const validityMs = consentValidityDays() * 86400000;

  let consentInfo: LeadLifecycle['consent'] = { status: 'none' };
  if (consent) {
    const recorded = new Date(consent.timestamp).getTime();
    const expiresAt = recorded + validityMs;
    const daysLeft = Math.floor((expiresAt - now.getTime()) / 86400000);
    consentInfo = {
      status: daysLeft < 0 ? 'expired' : daysLeft <= cfg.renewalWindowDays ? 'expiring' : 'active',
      recordedAt: consent.timestamp,
      expiresAt: new Date(expiresAt).toISOString(),
      daysLeft,
      source: consent.source,
    };
  }

  const myConversions = conversions.filter(c => c.phone === phone);
  const lastWeblead = myConversions.filter(c => c.type === 'weblead_submission').slice(-1)[0];
  const cooldownMs = cfg.webleadCooldownDays * 86400000;
  const eligibleAtMs = lastWeblead ? new Date(lastWeblead.at).getTime() + cooldownMs : now.getTime();
  const eligibleNow = eligibleAtMs <= now.getTime();

  return {
    phone,
    consent: consentInfo,
    weblead: {
      lastSubmittedAt: lastWeblead?.at,
      eligibleAt: new Date(Math.max(eligibleAtMs, now.getTime())).toISOString(),
      eligibleNow,
      daysUntilEligible: eligibleNow ? 0 : Math.ceil((eligibleAtMs - now.getTime()) / 86400000),
    },
    conversions: myConversions,
    totalValue: myConversions.reduce((s, c) => s + c.value, 0),
    renewalDue: (consentInfo.status === 'expiring' || consentInfo.status === 'expired') && eligibleNow,
  };
}

// ── Conversions ─────────────────────────────────────────────────────

export function recordConversion(opts: {
  type: ConversionType;
  phone: string;
  campaignId?: string;
  callSid?: string;
  value?: number;              // override the configured default
  duplicate?: boolean;
  at?: string;
  meta?: Record<string, unknown>;
}): ConversionRecord {
  const phone = normalizePhone(opts.phone);
  const rec: ConversionRecord = {
    id: `cv_${crypto.randomBytes(5).toString('hex')}`,
    type: opts.type,
    phone,
    campaignId: opts.campaignId,
    callSid: opts.callSid,
    value: opts.duplicate ? 0 : (opts.value ?? cfg.values[opts.type] ?? 0),
    duplicate: opts.duplicate,
    at: opts.at || new Date().toISOString(),
    meta: opts.meta,
  };
  conversions.push(rec);
  persistConversions();
  recordEvent('conversion.recorded', {
    conversionType: rec.type, value: rec.value, duplicate: Boolean(rec.duplicate), ...opts.meta,
  }, { phone, campaignId: opts.campaignId, callSid: opts.callSid });
  return rec;
}

// ── Tracked links (prefilled webform / offer wall) ──────────────────

export interface CreatedLink {
  token: string;
  url: string;                 // the /t/<token> redirect URL to hand out
  destination: string;         // where the redirect lands (prefilled)
  kind: 'webform' | 'offers';
  downgraded?: string;         // set when a webform ask was converted to offers
}

/**
 * Create a tracked link. Asking for a webform link during the 30-day
 * cooldown automatically downgrades to an offers link — offers can be
 * clicked as often as the consumer likes, so there is always something
 * revenue-bearing to send.
 */
export function createTrackedLink(rawPhone: string, kind: 'webform' | 'offers', opts: { campaignId?: string; sentVia?: TrackedLink['sentVia'] } = {}): CreatedLink {
  const phone = normalizePhone(rawPhone);
  let effectiveKind = kind;
  let downgraded: string | undefined;
  if (kind === 'webform') {
    const lc = getLeadLifecycle(phone);
    if (!lc.weblead.eligibleNow) {
      effectiveKind = 'offers';
      downgraded = `weblead cooldown — eligible again in ${lc.weblead.daysUntilEligible} day(s)`;
    }
  }
  const token = crypto.randomBytes(9).toString('base64url');
  const link: TrackedLink = {
    token, phone, kind: effectiveKind, campaignId: opts.campaignId,
    createdAt: new Date().toISOString(), sentVia: opts.sentVia, clicks: 0,
  };
  links.set(token, link);
  persistLinks();
  recordEvent('link.sent', { kind: effectiveKind, token, via: opts.sentVia || 'manual', downgraded }, { phone, campaignId: opts.campaignId });
  return {
    token,
    url: `${config.baseUrl}/t/${token}`,
    destination: buildDestinationUrl(link),
    kind: effectiveKind,
    downgraded,
  };
}

/** Prefill the form from lead memory so the consumer just hits submit. */
/**
 * Build the full, flat prefill object for a lead — everything the form
 * needs to land on its final review slide with nothing left to fill:
 * identity, address, current policy, coverage, ALL drivers, ALL vehicles.
 */
export function buildPrefillData(phone: string, token: string): Record<string, unknown> {
  const p = buildLeadProfile(phone);
  const data: Record<string, unknown> = {
    tk: token,
    phone: phone.replace(/^\+/, ''),
    first_name: p.firstName,
    last_name: p.lastName,
    email: p.email,
    state: p.state,
    city: p.city,
    zip: p.zip,
    current_insurer: p.currentInsurer,
    insured: p.insured,
    coverage_type: p.coverageType,
    insured_since: p.insuredSince,
    vehicle_count: p.vehicleCount,
    driver_count: p.drivers.length,
    // Structured arrays for forms that ingest them:
    vehicles: p.vehicles.map(v => ({ year: v.year, make: v.make, model: v.model, primary_use: v.primaryUse })),
    drivers: p.drivers.map(d => ({ name: d.name, first_name: d.firstName, relationship: d.relationship, marital_status: d.maritalStatus, sr22: d.sr22 })),
  };
  // Also flatten the first few vehicles/drivers as indexed params for
  // forms that read vehicle1_make style fields.
  p.vehicles.slice(0, 4).forEach((v, i) => {
    if (v.year) data[`vehicle${i + 1}_year`] = v.year;
    if (v.make) data[`vehicle${i + 1}_make`] = v.make;
    if (v.model) data[`vehicle${i + 1}_model`] = v.model;
  });
  p.drivers.slice(0, 4).forEach((d, i) => {
    if (d.firstName) data[`driver${i + 1}_first_name`] = d.firstName;
    if (d.relationship) data[`driver${i + 1}_relationship`] = d.relationship;
  });
  // Drop undefined/empty so the URL stays clean.
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete data[k];
  }
  return data;
}

/**
 * Prefill the form and land on the FINAL review slide. The exact shape
 * is controlled by lifecycle config (webformPrefillMode + the
 * final-step params) so it can be matched to the live form without a
 * code change:
 *   - query   → every field as a query param (default)
 *   - payload → one base64url JSON blob in `d` (offer-wall style)
 *   - token   → just ?tk=…; the form looks the lead up server-side
 * The final-step params (e.g. step=review&prefilled=1) are always
 * appended so the consumer opens straight on "hit submit → see offers".
 */
export function buildDestinationUrl(link: TrackedLink): string {
  const base = link.kind === 'webform' ? cfg.webformBaseUrl : cfg.offerWallUrl;
  const sep = base.includes('?') ? '&' : '?';

  // Offer-wall links are already the final destination; just carry the token.
  if (link.kind === 'offers') {
    return `${base}${sep}tk=${encodeURIComponent(link.token)}&phone=${encodeURIComponent(link.phone.replace(/^\+/, ''))}`;
  }

  const data = buildPrefillData(link.phone, link.token);
  const finalStep = (cfg.webformFinalStepParams || '').trim();

  let qs: string;
  if (cfg.webformPrefillMode === 'token') {
    qs = `tk=${encodeURIComponent(link.token)}`;
  } else if (cfg.webformPrefillMode === 'payload') {
    const blob = Buffer.from(JSON.stringify(data)).toString('base64url');
    qs = `d=${blob}`;
  } else {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) || typeof v === 'object') params.set(k, JSON.stringify(v));
      else params.set(k, String(v));
    }
    qs = params.toString();
  }

  return `${base}${sep}${qs}${finalStep ? '&' + finalStep : ''}`;
}

export function getTrackedLink(token: string): TrackedLink | undefined { return links.get(token); }

/** Consumer opened the link: count it and hand back the destination. */
export function handleLinkClick(token: string): { destination: string } | null {
  const link = links.get(token);
  if (!link) return null;
  link.clicks += 1;
  link.lastClickAt = new Date().toISOString();
  persistLinks();
  recordEvent('link.clicked', { kind: link.kind, token, clicks: link.clicks }, { phone: link.phone, campaignId: link.campaignId });
  return { destination: buildDestinationUrl(link) };
}

// ── Webform submission (new weblead + consent renewal) ──────────────

export interface SubmissionResult {
  conversion: ConversionRecord;
  duplicate: boolean;
  consentRenewedUntil: string;
  offerWallUrl: string;         // show this to the consumer post-submit
}

/**
 * A form submission ALWAYS renews TCPA consent (the consumer just
 * opted in again — restart the 90-day clock). It only counts as a
 * sellable weblead when outside the 30-day cooldown; inside it, the
 * conversion is flagged duplicate and valued at $0 so the funnel never
 * double-sells data a buyer would reject.
 */
export function recordWebformSubmission(opts: {
  token?: string;
  phone?: string;
  campaignId?: string;
  trustedFormUrl?: string;
  jornayaId?: string;
  source?: string;
  payload?: Record<string, unknown>;
}): SubmissionResult | null {
  const link = opts.token ? links.get(opts.token) : undefined;
  const phone = normalizePhone(opts.phone || link?.phone || '');
  if (!phone) return null;

  const before = getLeadLifecycle(phone);
  const duplicate = !before.weblead.eligibleNow;
  const now = new Date();

  if (link) {
    link.submittedAt = now.toISOString();
    persistLinks();
  }

  // Consent renewal — the heart of the compliant re-engagement loop.
  recordConsent({
    phone,
    consentType: 'express_written',
    source: opts.source || (link ? `webform_renewal:${link.kind}` : 'webform_renewal'),
    timestamp: now.toISOString(),
    trustedFormUrl: opts.trustedFormUrl,
    jornayaId: opts.jornayaId,
  });
  const renewedUntil = new Date(now.getTime() + consentValidityDays() * 86400000).toISOString();
  recordEvent('consent.renewed', {
    validUntil: renewedUntil, viaToken: opts.token, duplicateSubmission: duplicate,
  }, { phone, campaignId: opts.campaignId || link?.campaignId });

  const conversion = recordConversion({
    type: 'weblead_submission',
    phone,
    campaignId: opts.campaignId || link?.campaignId,
    duplicate,
    meta: { token: opts.token, source: opts.source, hasTrustedForm: Boolean(opts.trustedFormUrl) },
  });
  addLeadNote(phone, duplicate
    ? 'Webform re-submitted inside 30-day cooldown — consent renewed, weblead NOT resold (duplicate).'
    : 'Webform submitted — new weblead created and TCPA consent renewed for another cycle.');

  return { conversion, duplicate, consentRenewedUntil: renewedUntil, offerWallUrl: cfg.offerWallUrl };
}

/** Partner offer clicked on the wall — unlimited, each click pays. */
export function recordOfferClick(opts: { token?: string; phone?: string; offerId?: string; payout?: number; campaignId?: string }): ConversionRecord | null {
  const link = opts.token ? links.get(opts.token) : undefined;
  const phone = normalizePhone(opts.phone || link?.phone || '');
  if (!phone) return null;
  return recordConversion({
    type: 'offer_click',
    phone,
    campaignId: opts.campaignId || link?.campaignId,
    value: opts.payout,
    meta: { offerId: opts.offerId, token: opts.token },
  });
}

// ── Revenue reporting ───────────────────────────────────────────────

export interface RevenueSummary {
  since: string;
  totalValue: number;
  byType: Record<ConversionType, { count: number; value: number; duplicates: number }>;
  byDay: Array<{ date: string; value: number; count: number }>;
  linkStats: { sent: number; clicked: number; submitted: number; clickRate: number };
}

export function revenueSummary(opts: { since?: string } = {}): RevenueSummary {
  const since = opts.since || new Date(Date.now() - 30 * 86400000).toISOString();
  const inRange = conversions.filter(c => c.at >= since);
  const byType = {
    warm_transfer: { count: 0, value: 0, duplicates: 0 },
    verified_inbound: { count: 0, value: 0, duplicates: 0 },
    weblead_submission: { count: 0, value: 0, duplicates: 0 },
    offer_click: { count: 0, value: 0, duplicates: 0 },
  } as RevenueSummary['byType'];
  const dayMap = new Map<string, { value: number; count: number }>();
  for (const c of inRange) {
    byType[c.type].count += 1;
    byType[c.type].value += c.value;
    if (c.duplicate) byType[c.type].duplicates += 1;
    const day = c.at.slice(0, 10);
    const d = dayMap.get(day) || { value: 0, count: 0 };
    d.value += c.value; d.count += 1;
    dayMap.set(day, d);
  }
  const linkList = [...links.values()].filter(l => l.createdAt >= since);
  const clicked = linkList.filter(l => l.clicks > 0).length;
  return {
    since,
    totalValue: inRange.reduce((s, c) => s + c.value, 0),
    byType,
    byDay: [...dayMap.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    linkStats: {
      sent: linkList.length,
      clicked,
      submitted: linkList.filter(l => l.submittedAt).length,
      clickRate: linkList.length > 0 ? clicked / linkList.length : 0,
    },
  };
}

export function listConversions(opts: { phone?: string; type?: ConversionType; limit?: number } = {}): ConversionRecord[] {
  let list = conversions;
  if (opts.phone) { const p = normalizePhone(opts.phone); list = list.filter(c => c.phone === p); }
  if (opts.type) list = list.filter(c => c.type === opts.type);
  return list.slice(-(opts.limit || 100)).reverse();
}

// ── Renewal pipeline & worker ───────────────────────────────────────

export interface RenewalPipeline {
  expiringSoon: Array<{ phone: string; name: string; daysLeft: number; webleadEligible: boolean; lastPushAt?: string }>;
  webleadEligibleCount: number;
  expiredCount: number;
  autoRenewalEnabled: boolean;
}

export function renewalPipeline(now: Date = new Date()): RenewalPipeline {
  const expiringSoon: RenewalPipeline['expiringSoon'] = [];
  let webleadEligibleCount = 0;
  let expiredCount = 0;
  for (const lead of getAllLeads()) {
    const lc = getLeadLifecycle(lead.phone, now);
    if (lc.weblead.eligibleNow) webleadEligibleCount++;
    if (lc.consent.status === 'expired') expiredCount++;
    if (lc.consent.status === 'expiring' && !isOnDnc(lead.phone)) {
      expiringSoon.push({
        phone: lc.phone,
        name: lead.name,
        daysLeft: lc.consent.daysLeft ?? 0,
        webleadEligible: lc.weblead.eligibleNow,
        lastPushAt: lastRenewalPush.get(lc.phone),
      });
    }
  }
  expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft);
  return { expiringSoon, webleadEligibleCount, expiredCount, autoRenewalEnabled: cfg.autoRenewalSmsEnabled };
}

/**
 * Hourly scan: leads inside the renewal window get one policy-gated
 * renewal SMS per `renewalPushMinGapDays`, carrying a fresh prefilled
 * form link. Marks `lifecycle.renewal_due` either way so the pipeline
 * is visible even with auto-send off.
 */
export async function runRenewalScan(sendSmsFn?: (to: string, body: string) => Promise<boolean>): Promise<{ due: number; pushed: number }> {
  const pipeline = renewalPipeline();
  let pushed = 0;
  const gapMs = cfg.renewalPushMinGapDays * 86400000;
  for (const lead of pipeline.expiringSoon) {
    if (!lead.webleadEligible) continue;
    const last = lastRenewalPush.get(lead.phone);
    if (last && Date.now() - new Date(last).getTime() < gapMs) continue;

    recordEvent('lifecycle.renewal_due', { daysLeft: lead.daysLeft }, { phone: lead.phone });

    if (!cfg.autoRenewalSmsEnabled || !sendSmsFn || hasSmsStop(lead.phone)) continue;
    const decision = evaluateOutreach({ channel: 'sms', phone: lead.phone });
    if (isBlocked(decision)) continue;

    const link = createTrackedLink(lead.phone, 'webform', { sentVia: 'sms' });
    const first = (lead.name || '').split(' ')[0] || 'there';
    const body = `Hi ${first}, it's time for your free auto-insurance rate refresh — everything's pre-filled, takes under 2 minutes: ${link.url} Reply STOP to opt out.`;
    try {
      const ok = await sendSmsFn(lead.phone, body);
      if (ok) {
        pushed++;
        lastRenewalPush.set(lead.phone, new Date().toISOString());
        persistLinks();
        recordEvent('sms.sent', { trigger: 'renewal', token: link.token }, { phone: lead.phone });
      }
    } catch (err) {
      logger.warn('lifecycle', 'Renewal SMS failed', { phone: lead.phone, error: String(err) });
    }
  }
  return { due: pipeline.expiringSoon.filter(l => l.webleadEligible).length, pushed };
}

export function startLifecycleWorker(sendSmsFn: (to: string, body: string) => Promise<boolean>): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    runRenewalScan(sendSmsFn).then(({ due, pushed }) => {
      if (due > 0) logger.info('lifecycle', `Renewal scan: ${due} due, ${pushed} pushed`);
    }).catch(err => logger.error('lifecycle', 'Renewal scan error', { error: String(err) }));
  }, 60 * 60 * 1000);
  logger.info('lifecycle', 'Lifecycle renewal worker started (hourly)');
}
