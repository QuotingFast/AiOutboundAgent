// ── Lead Profile Extractor ─────────────────────────────────────────
// Single normalized view over everything a weblead carries (drivers,
// vehicles, address, current policy, coverage). Both the SMS composer
// and the voice-call context builder read from this so personalization
// is consistent across every touch — the "person" texting knows the
// same facts the voice agent references on the call.

import { getLeadMemory } from '../memory';

export interface DriverInfo {
  name: string;
  firstName?: string;
  relationship?: string;   // self, spouse, child, other
  maritalStatus?: string;
  sr22?: boolean;
  licenseStatus?: string;
}

export interface VehicleInfo {
  year?: string;
  make?: string;
  model?: string;
  primaryUse?: string;
  annualMiles?: string;
}

export interface LeadProfile {
  phone: string;
  firstName?: string;
  lastName?: string;
  state?: string;
  city?: string;
  zip?: string;
  email?: string;
  product: 'auto' | 'home' | 'bundle';
  currentInsurer?: string;
  insured: boolean;
  coverageType?: string;         // e.g. full coverage, liability only
  insuredSince?: string;
  vehicles: VehicleInfo[];
  vehicleCount: number;
  drivers: DriverInfo[];
  additionalDrivers: DriverInfo[]; // everyone who isn't the primary/self
  hasSpouseDriver: boolean;
  hasSr22: boolean;
  source?: string;
  sourceWebsite?: string;   // the domain the lead was sourced from (for "what website did I fill this out on?")
  submittedAt?: string;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : v != null ? String(v) : '';
  return s ? s : undefined;
}

/** Pull a clean domain (e.g. "autosavingsnow.com") out of any URL/host string. */
function toDomain(raw: unknown): string | undefined {
  const s = str(raw);
  if (!s) return undefined;
  let host = s.trim();
  try {
    if (/^https?:\/\//i.test(host)) host = new URL(host).hostname;
    else if (host.includes('/')) host = host.split('/')[0];
  } catch { /* fall through to cleanup */ }
  host = host.replace(/^www\./i, '').replace(/[^a-z0-9.-].*$/i, '').toLowerCase();
  // Must look like a domain (has a dot, valid TLD-ish), not a vendor slug.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : undefined;
}

/**
 * Find the website/domain a lead was sourced from. Vendors put it under
 * many different keys, and it may be nested in the raw payload — check
 * the common ones plus a recursive scan of the raw webhook data.
 */
function extractSourceWebsite(cf: Record<string, unknown>): string | undefined {
  const direct = [
    'landing_page', 'landingPage', 'landing_page_url', 'source_url', 'sourceUrl',
    'origin_url', 'originUrl', 'website', 'domain', 'source_domain', 'referrer',
    'referer', 'original_url', 'url', 'lp_url', 'site', 'source_website',
  ];
  const raw = (cf.rawWebhookData || {}) as Record<string, unknown>;
  const meta = (raw.meta || cf.meta || {}) as Record<string, unknown>;
  const search: Record<string, unknown>[] = [cf, raw, meta];
  for (const obj of search) {
    for (const k of direct) {
      const d = toDomain(obj[k]);
      if (d) return d;
    }
  }
  // Recursive shallow scan of the raw payload for any URL-ish value.
  const seen = new Set<unknown>();
  const walk = (o: unknown, depth: number): string | undefined => {
    if (!o || typeof o !== 'object' || depth > 3 || seen.has(o)) return undefined;
    seen.add(o);
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (/url|site|domain|landing|referr|origin/i.test(k)) {
        const d = toDomain(v);
        if (d && !/trustedform|jornaya|leadid/i.test(d)) return d;
      }
      if (v && typeof v === 'object') {
        const nested = walk(v, depth + 1);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const found = walk(raw, 0);
  return found;
}

/**
 * Build a normalized profile from lead memory. Defensive against the
 * many shapes weblead vendors send — everything is optional.
 */
export function buildLeadProfile(phone: string): LeadProfile {
  const lead = getLeadMemory(phone);
  const cf = (lead?.customFields || {}) as Record<string, unknown>;
  const contact = (cf.contact || {}) as Record<string, unknown>;
  const currentPolicy = (cf.currentPolicy || {}) as Record<string, unknown>;
  const requestedPolicy = (cf.requestedPolicy || {}) as Record<string, unknown>;
  const rawVehicles = Array.isArray(cf.vehicles) ? (cf.vehicles as Record<string, unknown>[]) : [];
  const rawDrivers = Array.isArray(cf.drivers) ? (cf.drivers as Record<string, unknown>[]) : [];

  const [firstFromName, ...restName] = (lead?.name || '').split(' ');
  const firstName = str(contact.firstName) || (firstFromName && firstFromName !== 'Unknown' ? firstFromName : undefined);
  const lastName = str(contact.lastName) || (restName.length ? restName.join(' ') : undefined);

  const vehicles: VehicleInfo[] = rawVehicles.map(v => ({
    year: str(v.year), make: str(v.make), model: str(v.model),
    primaryUse: str(v.primaryUse), annualMiles: str(v.annualMiles),
  })).filter(v => v.make || v.model || v.year);

  const drivers: DriverInfo[] = rawDrivers.map(d => ({
    name: str(d.name) || [str(d.firstName), str(d.lastName)].filter(Boolean).join(' ') || 'driver',
    firstName: str(d.firstName),
    relationship: str(d.relationship)?.toLowerCase(),
    maritalStatus: str(d.maritalStatus)?.toLowerCase(),
    sr22: d.sr22 === true,
    licenseStatus: str(d.licenseStatus),
  }));

  const additionalDrivers = drivers.filter(d => d.relationship && !/self|primary|applicant/.test(d.relationship));
  const insurer = str(currentPolicy.insurer) || lead?.currentInsurer;
  const insured = Boolean(insurer && !/none|no insurance|uninsured/i.test(insurer));

  // Product inference: home fields present ⇒ home/bundle, else auto.
  const hasHome = Boolean(str(cf.propertyType) || str((cf as Record<string, unknown>).homeValue) || /home|property/i.test(str(cf.product) || ''));
  const product: LeadProfile['product'] = hasHome && vehicles.length > 0 ? 'bundle' : hasHome ? 'home' : 'auto';

  return {
    phone,
    firstName,
    lastName,
    state: str(contact.state) || lead?.state,
    city: str(contact.city),
    zip: str(contact.zipCode) || str(contact.zip),
    email: str(contact.email),
    product,
    currentInsurer: insurer,
    insured,
    coverageType: str(currentPolicy.coverageType) || str(requestedPolicy.coverageType),
    insuredSince: str(currentPolicy.insuredSince),
    vehicles,
    vehicleCount: vehicles.length || (str(cf.vehiclesCount) ? Number(cf.vehiclesCount) : 0),
    drivers,
    additionalDrivers,
    hasSpouseDriver: drivers.some(d => d.relationship === 'spouse' || d.maritalStatus === 'married'),
    hasSr22: drivers.some(d => d.sr22),
    source: str(cf.source) || (Array.isArray(lead?.tags) && lead!.tags.includes('jangl') ? 'jangl' : undefined),
    sourceWebsite: extractSourceWebsite(cf),
    submittedAt: str(cf.timestamp) || str((cf as Record<string, unknown>).receivedAt),
  };
}

/** A short natural reference to the vehicle(s), the way a person says it. */
export function vehicleShorthand(profile: LeadProfile): string {
  if (profile.product === 'home') return 'your place';
  const v = profile.vehicles[0];
  if (!v) return profile.vehicleCount > 1 ? 'your cars' : 'your car';
  const shortYear = v.year && v.year.length === 4 ? `'${v.year.slice(2)}` : (v.year || '');
  const name = v.model || v.make || 'car';
  const base = [shortYear, name].filter(Boolean).join(' ');
  return profile.vehicleCount > 1 ? `the ${base} (and the other${profile.vehicleCount > 2 ? 's' : ''})` : `the ${base}`;
}

/**
 * A compact fact sheet the voice agent can weave in naturally — used
 * to make the call reference real details (spouse on the policy, the
 * specific car, current carrier) instead of generic questions.
 */
export function voicePersonalizationBrief(profile: LeadProfile): string {
  const bits: string[] = [];
  if (profile.firstName) bits.push(`Lead: ${profile.firstName}${profile.state ? ` in ${profile.state}` : ''}.`);
  if (profile.product !== 'auto') bits.push(`Requested: ${profile.product} insurance.`);
  if (profile.vehicles.length) {
    bits.push(`Vehicles: ${profile.vehicles.map(v => [v.year, v.make, v.model].filter(Boolean).join(' ')).filter(Boolean).join('; ')}.`);
  } else if (profile.vehicleCount) {
    bits.push(`${profile.vehicleCount} vehicle(s) on file.`);
  }
  if (profile.currentInsurer) bits.push(`Currently with ${profile.currentInsurer}${profile.insuredSince ? ` since ${profile.insuredSince}` : ''}.`);
  else if (!profile.insured) bits.push('Currently uninsured.');
  if (profile.coverageType) bits.push(`Coverage: ${profile.coverageType}.`);
  if (profile.additionalDrivers.length) {
    bits.push(`Additional driver(s): ${profile.additionalDrivers.map(d => `${d.firstName || d.name}${d.relationship ? ` (${d.relationship})` : ''}`).join(', ')}.`);
  }
  if (profile.hasSr22) bits.push('At least one driver needs SR-22.');
  if (profile.city || profile.zip) bits.push(`Area: ${[profile.city, profile.zip].filter(Boolean).join(' ')}.`);
  if (profile.sourceWebsite) bits.push(`Sourced from the website: ${profile.sourceWebsite}.`);
  if (bits.length === 0) return '';
  const lines = [
    'KNOWN LEAD DETAILS (reference these naturally — do NOT read them as a list; weave one or two in so it feels like you already have their file open):',
    ...bits.map(b => `- ${b}`),
    'Never re-ask something you already know here; instead confirm it ("still the ' + (profile.vehicles[0] ? [profile.vehicles[0].year, profile.vehicles[0].make].filter(Boolean).join(' ') : 'same car') + '?"). If a detail is missing, then ask.',
  ];
  if (profile.sourceWebsite) {
    lines.push(`IF THEY ASK "what website did I fill this out on?" or "where did you get my info?": tell them the truth — they requested a quote on ${profile.sourceWebsite}. Say it plainly, e.g. "You filled out a quote form over on ${profile.sourceWebsite}." Never dodge that question.`);
  }
  return lines.join('\n');
}
