// ── Contact Strategy Engine ────────────────────────────────────────
// Campaign-configurable cadence plans (day-bucketed attempt windows),
// next-attempt computation in the lead's local timezone, and a
// natural-language callback-time parser ("call me at 6", "tomorrow
// morning", "after work", "Saturday"). All outreach it produces still
// passes through the policy engine before dialing.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { resolveTimezone, localTimeIn, nextTimeInWindow } from './timezone';
import { recordEvent } from './events';
import { logger } from '../utils/logger';

export interface CadenceWindow {
  startHour: number;   // lead-local, inclusive
  endHour: number;     // exclusive
}

export interface CadenceStep {
  fromDay: number;     // lead-age day bucket start (0 = submission day)
  toDay: number;       // inclusive
  maxAttemptsPerDay: number;
  windows: CadenceWindow[];
  smsAfterMissedCall: boolean;
}

export interface CadencePlan {
  id: string;
  name: string;
  description: string;
  steps: CadenceStep[];
  maxTotalAttempts: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORE_KEY = 'platform_cadence_plans';
let plans: CadencePlan[] = [];

export const DEFAULT_PLAN_ID = 'plan_default_newlead';

function defaultPlan(): CadencePlan {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_PLAN_ID,
    name: 'New Lead — Speed to Contact',
    description: 'Rapid day-0 pursuit across distinct local-time windows, tapering through day 7.',
    steps: [
      { fromDay: 0, toDay: 0, maxAttemptsPerDay: 4, smsAfterMissedCall: true, windows: [{ startHour: 8, endHour: 12 }, { startHour: 12, endHour: 17 }, { startHour: 17, endHour: 21 }] },
      { fromDay: 1, toDay: 1, maxAttemptsPerDay: 2, smsAfterMissedCall: true, windows: [{ startHour: 10, endHour: 13 }, { startHour: 17, endHour: 20 }] },
      { fromDay: 2, toDay: 7, maxAttemptsPerDay: 1, smsAfterMissedCall: false, windows: [{ startHour: 11, endHour: 19 }] },
    ],
    maxTotalAttempts: 12,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadCadencePlans(): void {
  const saved = loadData<CadencePlan[]>(STORE_KEY);
  if (Array.isArray(saved) && saved.length > 0) {
    plans = saved;
  } else {
    plans = [defaultPlan()];
    persist();
  }
  logger.info('cadence', `Loaded ${plans.length} cadence plans`);
}

function persist(): void { scheduleSave(STORE_KEY, () => plans); }

export function listCadencePlans(): CadencePlan[] { return plans; }
export function getCadencePlan(id: string): CadencePlan | undefined { return plans.find(p => p.id === id); }

export function upsertCadencePlan(input: Partial<CadencePlan> & { name: string; steps: CadenceStep[] }, actor = 'system'): CadencePlan {
  const now = new Date().toISOString();
  const existing = input.id ? plans.find(p => p.id === input.id) : undefined;
  const plan: CadencePlan = {
    id: existing?.id || `plan_${crypto.randomBytes(4).toString('hex')}`,
    description: '',
    maxTotalAttempts: 12,
    active: true,
    createdAt: existing?.createdAt || now,
    ...existing,
    ...input,
    updatedAt: now,
  };
  plans = existing ? plans.map(p => (p.id === plan.id ? plan : p)) : [...plans, plan];
  persist();
  recordEvent('config.changed', { scope: 'cadence_plan', planId: plan.id, action: existing ? 'updated' : 'created' }, { actor });
  return plan;
}

export function deleteCadencePlan(id: string, actor = 'system'): boolean {
  if (id === DEFAULT_PLAN_ID) return false;
  const before = plans.length;
  plans = plans.filter(p => p.id !== id);
  if (plans.length < before) {
    persist();
    recordEvent('config.changed', { scope: 'cadence_plan', planId: id, action: 'deleted' }, { actor });
    return true;
  }
  return false;
}

// ── Next attempt computation ────────────────────────────────────────

export interface AttemptHistoryEntry { at: string }

export interface NextAttemptResult {
  scheduleAt: string | null;    // ISO UTC instant; null = cadence exhausted
  reason: string;
  dayBucket?: number;
  window?: CadenceWindow;
  tz: string;
  sendSmsFirst?: boolean;
}

/**
 * Compute when the next attempt should happen for a lead, given the
 * plan, the lead's submission time, and prior attempts. Prefers a
 * window that has not been used today so repeated attempts land at
 * different times of day.
 */
export function computeNextAttempt(opts: {
  plan: CadencePlan;
  leadSubmittedAt: string;
  attempts: AttemptHistoryEntry[];
  state?: string;
  phone?: string;
  now?: Date;
}): NextAttemptResult {
  const now = opts.now || new Date();
  const { tz } = resolveTimezone(opts.state, opts.phone);

  if (opts.attempts.length >= opts.plan.maxTotalAttempts) {
    return { scheduleAt: null, reason: `plan cap of ${opts.plan.maxTotalAttempts} total attempts reached`, tz };
  }

  const submitted = new Date(opts.leadSubmittedAt);
  const leadDay = Math.floor((now.getTime() - submitted.getTime()) / 86400000);
  const step = opts.plan.steps.find(s => leadDay >= s.fromDay && leadDay <= s.toDay)
    || opts.plan.steps[opts.plan.steps.length - 1];
  if (!step || leadDay > opts.plan.steps[opts.plan.steps.length - 1].toDay) {
    return { scheduleAt: null, reason: `lead is ${leadDay} days old — beyond the plan's final step`, tz };
  }

  const todayLocal = localTimeIn(tz, now).dateKey;
  const attemptsToday = opts.attempts.filter(a => localTimeIn(tz, new Date(a.at)).dateKey === todayLocal);

  if (attemptsToday.length < step.maxAttemptsPerDay) {
    // Prefer an unused window today; if now is inside it, go immediately.
    const usedHours = attemptsToday.map(a => localTimeIn(tz, new Date(a.at)).hour);
    const lt = localTimeIn(tz, now);
    const candidateWindows = step.windows
      .filter(w => !usedHours.some(h => h >= w.startHour && h < w.endHour))
      .concat(step.windows); // fall back to any window if all were used
    for (const w of candidateWindows) {
      if (lt.hour >= w.startHour && lt.hour < w.endHour) {
        return { scheduleAt: now.toISOString(), reason: 'inside an open window now', dayBucket: leadDay, window: w, tz, sendSmsFirst: false };
      }
      const at = nextTimeInWindow(tz, w.startHour, w.endHour, now);
      if (localTimeIn(tz, at).dateKey === todayLocal) {
        return { scheduleAt: at.toISOString(), reason: 'next unused window today', dayBucket: leadDay, window: w, tz, sendSmsFirst: step.smsAfterMissedCall };
      }
    }
  }

  // Today exhausted (or no window remains) — first window tomorrow-or-later.
  const nextStep = opts.plan.steps.find(s => leadDay + 1 >= s.fromDay && leadDay + 1 <= s.toDay) || step;
  const w = nextStep.windows[0];
  if (!w) return { scheduleAt: null, reason: 'no windows configured', tz };
  const tomorrowStart = new Date(now.getTime());
  // Walk to at least the next local day before searching the window.
  let probe = tomorrowStart;
  while (localTimeIn(tz, probe).dateKey === todayLocal) {
    probe = new Date(probe.getTime() + 30 * 60 * 1000);
  }
  const at = nextTimeInWindow(tz, w.startHour, w.endHour, probe);
  return { scheduleAt: at.toISOString(), reason: 'daily attempts exhausted — next day window', dayBucket: leadDay + 1, window: w, tz, sendSmsFirst: nextStep.smsAfterMissedCall };
}

// ── Natural-language callback parsing ───────────────────────────────

export interface ParsedCallbackTime {
  matched: boolean;
  label: string;                // human confirmation, e.g. "tomorrow between 9 and 11 AM"
  startAt: string | null;       // ISO UTC
  endAt: string | null;
  confidence: 'high' | 'medium' | 'low';
  smsFirst?: boolean;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** Build the UTC instant for the next occurrence of a lead-local hour. */
function nextLocalHour(tz: string, hour: number, now: Date, opts: { dayOffset?: number; weekday?: number } = {}): Date {
  let probe = new Date(now.getTime());
  const startKey = localTimeIn(tz, probe).dateKey;
  if (opts.dayOffset && opts.dayOffset > 0) {
    let advanced = 0;
    let lastKey = startKey;
    while (advanced < opts.dayOffset) {
      probe = new Date(probe.getTime() + 30 * 60 * 1000);
      const k = localTimeIn(tz, probe).dateKey;
      if (k !== lastKey) { advanced++; lastKey = k; }
    }
  }
  if (opts.weekday !== undefined) {
    for (let i = 0; i < 8 * 48; i++) {
      const lt = localTimeIn(tz, probe);
      if (lt.day === opts.weekday && (lt.dateKey !== startKey || lt.hour <= hour)) break;
      probe = new Date(probe.getTime() + 30 * 60 * 1000);
    }
  }
  return nextTimeInWindow(tz, hour, hour + 1, probe);
}

export function parseCallbackRequest(text: string, opts: { state?: string; phone?: string; now?: Date } = {}): ParsedCallbackTime {
  const now = opts.now || new Date();
  const { tz } = resolveTimezone(opts.state, opts.phone);
  const t = (text || '').toLowerCase().trim();
  const none: ParsedCallbackTime = { matched: false, label: '', startAt: null, endAt: null, confidence: 'low' };
  if (!t) return none;

  const mk = (start: Date, durationHours: number, label: string, confidence: ParsedCallbackTime['confidence'], smsFirst = false): ParsedCallbackTime => ({
    matched: true, label,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + durationHours * 3600000).toISOString(),
    confidence, smsFirst,
  });

  const wantsTextFirst = /\btext\b.*\bfirst\b|\btext me before\b/.test(t);

  // "tomorrow morning/afternoon/evening/night", "tomorrow at 6"
  const tomorrowPart = t.match(/\btomorrow\s*(morning|afternoon|evening|night)?\b/);
  if (tomorrowPart) {
    const clockTomorrow = t.match(/\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (clockTomorrow) {
      let hour = parseInt(clockTomorrow[1], 10);
      const mer = clockTomorrow[3] ? clockTomorrow[3][0] : null;
      if (mer === 'p' && hour < 12) hour += 12;
      if (mer === 'a' && hour === 12) hour = 0;
      if (!mer && hour <= 8 && hour + 12 <= 21) hour += 12;
      const start = nextLocalHour(tz, hour, now, { dayOffset: 1 });
      const withMin = clockTomorrow[2] ? new Date(start.getTime() + parseInt(clockTomorrow[2], 10) * 60000) : start;
      return mk(withMin, 1, `tomorrow at ${((hour + 11) % 12) + 1} ${hour >= 12 ? 'PM' : 'AM'}`, mer ? 'high' : 'medium', wantsTextFirst);
    }
    const part = tomorrowPart[1] || '';
    const hour = part === 'morning' ? 9 : part === 'afternoon' ? 13 : part === 'evening' || part === 'night' ? 18 : 10;
    const span = part ? 3 : 9;
    return mk(nextLocalHour(tz, hour, now, { dayOffset: 1 }), span, `tomorrow ${part || 'daytime'}`.trim(), part ? 'high' : 'medium', wantsTextFirst);
  }

  // "this evening", "tonight", "this afternoon", "in the morning"
  const partOnly = t.match(/\b(this\s+)?(morning|afternoon|evening)\b|\btonight\b/);
  if (partOnly) {
    const part = t.includes('tonight') ? 'evening' : (partOnly[2] || 'morning');
    const hour = part === 'morning' ? 9 : part === 'afternoon' ? 13 : 18;
    const lt = localTimeIn(tz, now);
    const dayOffset = lt.hour >= hour + 3 ? 1 : 0;   // that part of today already passed
    return mk(nextLocalHour(tz, hour, now, { dayOffset }), 3, `${dayOffset ? 'tomorrow' : 'this'} ${part}`, 'high', wantsTextFirst);
  }

  // "after work" → 5:30-ish local
  if (/\bafter work\b/.test(t)) {
    const lt = localTimeIn(tz, now);
    const dayOffset = lt.hour >= 20 ? 1 : 0;
    return mk(nextLocalHour(tz, 17, now, { dayOffset }), 3, 'after work (5–8 PM)', 'high', wantsTextFirst);
  }

  // "after lunch"
  if (/\bafter lunch\b/.test(t)) {
    const lt = localTimeIn(tz, now);
    return mk(nextLocalHour(tz, 13, now, { dayOffset: lt.hour >= 16 ? 1 : 0 }), 2, 'early afternoon (1–3 PM)', 'high', wantsTextFirst);
  }

  // "in an hour", "in 30 minutes", "in 2 hours"
  const rel = t.match(/\bin\s+(?:about\s+)?(an?|\d+)\s+(minute|min|hour|hr)s?\b/);
  if (rel) {
    const n = rel[1] === 'a' || rel[1] === 'an' ? 1 : parseInt(rel[1], 10);
    const ms = /min/.test(rel[2]) ? n * 60000 : n * 3600000;
    const start = new Date(now.getTime() + ms);
    return mk(start, 1, `in ${n} ${/min/.test(rel[2]) ? 'minute' : 'hour'}${n === 1 ? '' : 's'}`, 'high', wantsTextFirst);
  }

  // Weekday names: "saturday", "call me monday morning"
  for (const [name, dayIdx] of Object.entries(DAY_NAMES)) {
    if (t.includes(name)) {
      const partMatch = t.match(new RegExp(`${name}\\s*(morning|afternoon|evening)?`));
      const part = partMatch?.[1] || '';
      const hour = part === 'morning' ? 9 : part === 'afternoon' ? 13 : part === 'evening' ? 18 : 10;
      return mk(nextLocalHour(tz, hour, now, { weekday: dayIdx }), part ? 3 : 9, `${name}${part ? ' ' + part : ''}`, part ? 'high' : 'medium', wantsTextFirst);
    }
  }

  // Explicit clock time: "at 6", "around 3:30", "at 6pm"
  const clock = t.match(/\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
  if (clock) {
    let hour = parseInt(clock[1], 10);
    const mer = clock[3] ? clock[3][0] : null;
    if (mer === 'p' && hour < 12) hour += 12;
    if (mer === 'a' && hour === 12) hour = 0;
    if (!mer) {
      // No meridiem: choose the next plausible contact-hour occurrence (8am–9pm).
      const lt = localTimeIn(tz, now);
      if (hour <= 8 && hour + 12 <= 21) hour += 12;                 // "at 6" → 6 PM
      else if (hour < 12 && lt.hour >= hour && hour + 12 <= 21) hour += 12;
    }
    const lt = localTimeIn(tz, now);
    const dayOffset = lt.hour > hour || (lt.hour === hour && lt.minute > 0) ? 1 : 0;
    const start = nextLocalHour(tz, hour, now, { dayOffset });
    const startWithMin = clock[2] ? new Date(start.getTime() + parseInt(clock[2], 10) * 60000) : start;
    const display = `${((hour + 11) % 12) + 1}${clock[2] ? ':' + clock[2] : ''} ${hour >= 12 ? 'PM' : 'AM'}${dayOffset ? ' tomorrow' : ''}`;
    return mk(startWithMin, 1, display, mer ? 'high' : 'medium', wantsTextFirst);
  }

  // "next week"
  if (/\bnext week\b/.test(t)) {
    return mk(nextLocalHour(tz, 10, now, { dayOffset: 7 }), 9, 'next week', 'low', wantsTextFirst);
  }

  // "when my spouse/wife/husband is home", "this weekend"
  if (/\b(spouse|wife|husband|partner)\b.*\bhome\b|\bweekend\b/.test(t)) {
    if (/\bweekend\b/.test(t)) {
      return mk(nextLocalHour(tz, 10, now, { weekday: 6 }), 8, 'Saturday daytime', 'medium', wantsTextFirst);
    }
    const lt = localTimeIn(tz, now);
    return mk(nextLocalHour(tz, 18, now, { dayOffset: lt.hour >= 20 ? 1 : 0 }), 3, 'this evening (6–9 PM)', 'medium', wantsTextFirst);
  }

  // "later today", "later"
  if (/\blater\b/.test(t)) {
    const start = new Date(now.getTime() + 3 * 3600000);
    return mk(start, 2, 'later today', 'low', wantsTextFirst);
  }

  return none;
}

/** Record + confirm a parsed callback into the ledger (dialing handled by the campaign worker). */
export function recordParsedCallback(phone: string, parsed: ParsedCallbackTime, campaignId?: string): void {
  if (!parsed.matched || !parsed.startAt) return;
  recordEvent('callback.scheduled', {
    label: parsed.label, startAt: parsed.startAt, endAt: parsed.endAt,
    confidence: parsed.confidence, smsFirst: parsed.smsFirst === true,
  }, { phone, campaignId });
}
