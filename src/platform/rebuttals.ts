// ── Objection & Rebuttal Engine ────────────────────────────────────
// Versioned rebuttal library with per-campaign limits and outcome
// analytics. Rebuttals follow acknowledge → clarify → low-friction
// next step → respect the decision; the engine tracks which variant
// advanced the conversation so operators can promote winners.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { recordEvent } from './events';
import { logger } from '../utils/logger';

export type ObjectionCode =
  | 'already_insured' | 'busy' | 'already_got_quotes' | 'dont_remember'
  | 'text_me' | 'call_later' | 'not_interested' | 'how_got_number'
  | 'is_this_scam' | 'only_wanted_online' | 'dont_want_to_talk'
  | 'ask_spouse' | 'driving' | 'already_bought' | 'no_info_over_phone';

export interface RebuttalVariant {
  id: string;
  text: string;
  version: number;
  status: 'active' | 'testing' | 'retired';
  createdAt: string;
  // rolling outcome counters
  uses: number;
  advanced: number;        // conversation continued past the objection
  transfers: number;
  callbacks: number;
  optOuts: number;
  hangups: number;
}

export interface ObjectionEntry {
  code: ObjectionCode;
  label: string;
  detectPatterns: string[];        // regex sources for transcript detection
  maxAttempts: number;             // respectful-rebuttal limit before clean exit
  variants: RebuttalVariant[];
}

export interface ObjectionEvent {
  id: string;
  at: string;
  callSid?: string;
  campaignId?: string;
  phone?: string;
  code: ObjectionCode;
  variantId?: string;
  outcome: 'advanced' | 'transfer' | 'callback' | 'opt_out' | 'declined' | 'hangup' | 'unknown';
}

const LIB_KEY = 'platform_rebuttals';
const EVENTS_KEY = 'platform_objection_events';
const MAX_OBJECTION_EVENTS = 10000;

let library: ObjectionEntry[] = [];
let objectionEvents: ObjectionEvent[] = [];

function variant(text: string): RebuttalVariant {
  return {
    id: `reb_${crypto.randomBytes(4).toString('hex')}`,
    text, version: 1, status: 'active', createdAt: new Date().toISOString(),
    uses: 0, advanced: 0, transfers: 0, callbacks: 0, optOuts: 0, hangups: 0,
  };
}

function seedLibrary(): ObjectionEntry[] {
  return [
    { code: 'already_insured', label: 'I already have insurance', maxAttempts: 2,
      detectPatterns: ['already (have|got) insurance', "i'?m (already )?covered", 'have a policy'],
      variants: [
        variant("That's actually perfect — this is just a quick rate check against what you've got. Takes two minutes, and if yours is better, you keep it. Who are you with right now?"),
        variant("Good — that means you qualify for the comparison. Most folks we talk to are overpaying and don't know it. Mind if I ask who you're with?"),
      ] },
    { code: 'busy', label: "I'm busy", maxAttempts: 1,
      detectPatterns: ["i'?m busy", 'in the middle of', "can'?t talk", 'at work right now'],
      variants: [
        variant("Totally get it — this literally takes ninety seconds, or I can call back. What's better, later today or tomorrow?"),
        variant('No problem. When works — this evening or tomorrow morning?'),
      ] },
    { code: 'already_got_quotes', label: 'I already got quotes', maxAttempts: 1,
      detectPatterns: ['already got (a )?quotes?', 'someone (already )?called', 'been getting calls'],
      variants: [
        variant("Makes sense — rates swing a lot between carriers though, so one more data point usually helps. What were they quoting you, roughly?"),
      ] },
    { code: 'dont_remember', label: "I don't remember filling anything out", maxAttempts: 2,
      detectPatterns: ["don'?t remember", "didn'?t (fill|sign|request)", 'never (filled|signed|requested)'],
      variants: [
        variant("No worries — it was an online form for car-insurance quotes, probably on your phone. Either way, since I've got you: are you with anyone for auto insurance right now?"),
      ] },
    { code: 'text_me', label: 'Just text me', maxAttempts: 1,
      detectPatterns: ['just text me', 'send (me )?a text', 'text me (instead|first)'],
      variants: [
        variant("Happy to — I'll text this number. Before I let you go, one quick thing: who's your insurance with right now?"),
      ] },
    { code: 'call_later', label: 'Call me later', maxAttempts: 1,
      detectPatterns: ['call (me )?(back )?later', 'not a good time', 'try me (later|tomorrow)'],
      variants: [
        variant('Sure — what time works? I can lock in a slot so you only hear from me once.'),
      ] },
    { code: 'not_interested', label: "I'm not interested", maxAttempts: 1,
      detectPatterns: ['not interested', 'no thanks?', 'stop calling'],
      variants: [
        variant("Fair enough — one honest question and I'll let you go: are you paying over a hundred fifty a month? That's usually where we save people money."),
      ] },
    { code: 'how_got_number', label: 'How did you get my number?', maxAttempts: 2,
      detectPatterns: ['how (did|do) you (get|have) my (number|info)', 'where.{0,20}my number'],
      variants: [
        variant("You put in a quote request online — that form comes to us so a real person can actually get you numbers. Takes two minutes; want me to run it?"),
      ] },
    { code: 'is_this_scam', label: 'Is this a scam?', maxAttempts: 2,
      detectPatterns: ['scam', 'is this legit', "don'?t trust"],
      variants: [
        variant("Totally fair to ask. I'm not selling anything on this call and I'll never ask for payment or your social — I just verify a couple basics and connect you with a licensed agent. Want to do that?"),
      ] },
    { code: 'only_wanted_online', label: 'I only wanted an online quote', maxAttempts: 1,
      detectPatterns: ['online quote', 'just wanted (a )?quote online', "didn'?t want (a )?calls?"],
      variants: [
        variant("Understood — the online number is only accurate once a licensed agent confirms a couple details. That's all this is. Two minutes and you'll have a real number instead of an estimate."),
      ] },
    { code: 'dont_want_to_talk', label: "I don't want to talk to anyone", maxAttempts: 1,
      detectPatterns: ["don'?t want to talk", 'no phone calls', 'leave me alone'],
      variants: [
        variant("Got it — I'll keep it to one question then: want me to text you a link instead so you can do it on your own time?"),
      ] },
    { code: 'ask_spouse', label: 'I need to ask my spouse', maxAttempts: 1,
      detectPatterns: ['ask my (wife|husband|spouse|partner)', 'talk to my (wife|husband|spouse|partner)'],
      variants: [
        variant("Smart move. When are you both usually home? I'll call then so you can decide together."),
      ] },
    { code: 'driving', label: "I'm driving", maxAttempts: 1,
      detectPatterns: ["i'?m driving", 'in the car', 'behind the wheel'],
      variants: [
        variant("Say no more — drive safe. When are you off the road? I'll call you then."),
      ] },
    { code: 'already_bought', label: 'I already bought a policy', maxAttempts: 1,
      detectPatterns: ['already (bought|purchased|signed up)', 'just got a (new )?policy'],
      variants: [
        variant("Congrats — good timing on your part. I'll mark you down so we don't bug you. Quick one before I go: mind me asking who you went with?"),
      ] },
    { code: 'no_info_over_phone', label: "I don't give info over the phone", maxAttempts: 1,
      detectPatterns: ["don'?t give (out )?(info|information)", 'not giving.{0,20}over the phone'],
      variants: [
        variant("Completely reasonable — I don't need anything sensitive. No social, no payment, nothing like that. Just who you're insured with and how many cars. That's it."),
      ] },
  ];
}

export function loadRebuttals(): void {
  const saved = loadData<ObjectionEntry[]>(LIB_KEY);
  if (Array.isArray(saved) && saved.length > 0) {
    library = saved;
  } else {
    library = seedLibrary();
    persistLib();
  }
  const savedEvents = loadData<ObjectionEvent[]>(EVENTS_KEY);
  if (Array.isArray(savedEvents)) objectionEvents = savedEvents;
  logger.info('rebuttals', `Loaded ${library.length} objections, ${objectionEvents.length} outcome events`);
}

function persistLib(): void { scheduleSave(LIB_KEY, () => library); }
function persistEvents(): void {
  if (objectionEvents.length > MAX_OBJECTION_EVENTS) objectionEvents = objectionEvents.slice(-MAX_OBJECTION_EVENTS);
  scheduleSave(EVENTS_KEY, () => objectionEvents);
}

export function getObjectionLibrary(): ObjectionEntry[] { return library; }

export function updateRebuttalVariant(code: ObjectionCode, variantId: string, updates: { text?: string; status?: RebuttalVariant['status'] }, actor = 'system'): RebuttalVariant | undefined {
  const entry = library.find(e => e.code === code);
  if (!entry) return undefined;
  const v = entry.variants.find(x => x.id === variantId);
  if (!v) return undefined;
  if (updates.text && updates.text !== v.text) {
    v.text = updates.text;
    v.version += 1;
  }
  if (updates.status) v.status = updates.status;
  persistLib();
  recordEvent('config.changed', { scope: 'rebuttal', code, variantId, version: v.version, status: v.status }, { actor });
  return v;
}

export function addRebuttalVariant(code: ObjectionCode, text: string, actor = 'system'): RebuttalVariant | undefined {
  const entry = library.find(e => e.code === code);
  if (!entry) return undefined;
  const v = variant(text);
  v.status = 'testing';
  entry.variants.push(v);
  persistLib();
  recordEvent('config.changed', { scope: 'rebuttal', code, variantId: v.id, action: 'added' }, { actor });
  return v;
}

export function setObjectionLimit(code: ObjectionCode, maxAttempts: number, actor = 'system'): void {
  const entry = library.find(e => e.code === code);
  if (!entry) return;
  entry.maxAttempts = Math.max(0, Math.min(3, maxAttempts));
  persistLib();
  recordEvent('config.changed', { scope: 'rebuttal', code, maxAttempts: entry.maxAttempts }, { actor });
}

/** Detect which objection (if any) a consumer utterance contains. */
export function detectObjection(utterance: string): ObjectionEntry | undefined {
  const text = (utterance || '').toLowerCase();
  if (!text) return undefined;
  for (const entry of library) {
    for (const pattern of entry.detectPatterns) {
      try {
        if (new RegExp(pattern, 'i').test(text)) return entry;
      } catch { /* bad user-authored pattern — skip */ }
    }
  }
  return undefined;
}

export function recordObjectionOutcome(opts: {
  code: ObjectionCode;
  variantId?: string;
  outcome: ObjectionEvent['outcome'];
  callSid?: string;
  campaignId?: string;
  phone?: string;
}): void {
  const ev: ObjectionEvent = {
    id: `obj_${crypto.randomBytes(4).toString('hex')}`,
    at: new Date().toISOString(),
    ...opts,
  };
  objectionEvents.push(ev);
  persistEvents();
  const entry = library.find(e => e.code === opts.code);
  const v = opts.variantId ? entry?.variants.find(x => x.id === opts.variantId) : undefined;
  if (v) {
    v.uses += 1;
    if (opts.outcome === 'advanced') v.advanced += 1;
    if (opts.outcome === 'transfer') { v.advanced += 1; v.transfers += 1; }
    if (opts.outcome === 'callback') { v.advanced += 1; v.callbacks += 1; }
    if (opts.outcome === 'opt_out') v.optOuts += 1;
    if (opts.outcome === 'hangup') v.hangups += 1;
    persistLib();
  }
  recordEvent('objection.raised', { code: opts.code, variantId: opts.variantId, outcome: opts.outcome },
    { callSid: opts.callSid, campaignId: opts.campaignId, phone: opts.phone });
}

export interface ObjectionStats {
  code: ObjectionCode;
  label: string;
  occurrences: number;
  advanceRate: number;      // 0-1 across all variants
  bestVariantId?: string;
  variants: Array<Pick<RebuttalVariant, 'id' | 'text' | 'version' | 'status' | 'uses' | 'advanced' | 'transfers' | 'callbacks' | 'optOuts' | 'hangups'>>;
}

export function getObjectionStats(): ObjectionStats[] {
  return library.map(entry => {
    const occurrences = objectionEvents.filter(e => e.code === entry.code).length;
    const uses = entry.variants.reduce((s, v) => s + v.uses, 0);
    const advanced = entry.variants.reduce((s, v) => s + v.advanced, 0);
    const best = entry.variants
      .filter(v => v.uses >= 5)
      .sort((a, b) => b.advanced / b.uses - a.advanced / a.uses)[0];
    return {
      code: entry.code,
      label: entry.label,
      occurrences,
      advanceRate: uses > 0 ? advanced / uses : 0,
      bestVariantId: best?.id,
      variants: entry.variants.map(({ id, text, version, status, uses: u, advanced: a, transfers, callbacks, optOuts, hangups }) =>
        ({ id, text, version, status, uses: u, advanced: a, transfers, callbacks, optOuts, hangups })),
    };
  }).sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Render the active rebuttal guidance as a prompt section so campaign
 * prompts stay in lock-step with the managed library.
 */
export function buildRebuttalPromptSection(): string {
  const lines: string[] = ['OBJECTION PLAYBOOK (acknowledge → one short rebuttal → respect a second no):'];
  for (const entry of library) {
    const active = entry.variants.find(v => v.status === 'active') || entry.variants[0];
    if (!active) continue;
    lines.push(`- "${entry.label}" → "${active.text}" (max ${entry.maxAttempts} attempt${entry.maxAttempts === 1 ? '' : 's'}, then exit cleanly or offer a callback)`);
  }
  return lines.join('\n');
}
