// ── Lead Journey Engine ────────────────────────────────────────────
// The scripted funnel every weblead enters the moment it arrives.
// Each step is a timed touch (call or SMS) personalized from the
// lead's actual quote data via the humanizer + lead profile. Every
// touch passes through the policy engine (quiet hours defer, DNC/STOP
// kill), and any inbound reply pauses automation so a human thread
// never gets stomped by a scheduled message.
//
// Default journey (all offsets configurable):
//   T0+0s     call #1  (speed-to-lead — the weblead auto-dial)
//   T0+2m     sms intro_missed_call        (only if call unanswered)
//   T0+3.5h   call #2 (different window)
//   T0+4h     sms second_try               (if still no contact)
//   Day 1 am  sms value_nudge
//   Day 1 pm  call #3
//   Day 2     sms link_offer
//   Day 3     sms link_send (tracked prefilled webform)
//   Day 5     call #4
//   Day 7     sms last_checkin
//   → exits into the lifecycle renewal loop (day 60–90 re-opt-in)
//
// Exit conditions: transferred, opt-out/DNC, wrong party, replied
// (pause), completed all steps.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { evaluateOutreach, isBlocked } from './policy';
import { recordEvent, onEvent, normalizePhone } from './events';
import { composeSms, SmsIntent } from './humanizer';
import { buildLeadProfile } from './leadprofile';
import { createTrackedLink } from './lifecycle';
import { resolveTimezone, nextTimeInWindow } from './timezone';
import { isOnDnc } from '../compliance';
import { getSettings } from '../config/runtime';
import { logger } from '../utils/logger';

export interface JourneyStep {
  id: string;
  channel: 'call' | 'sms';
  intent?: SmsIntent;            // sms only
  offsetMinutes: number;         // from journey entry
  window?: { startHour: number; endHour: number };  // lead-local; defer into it
  skipIfContacted?: boolean;     // skip when we've already spoken to them
  onlyIfNoAnswerBefore?: boolean;// only fire if no call has connected yet
}

export interface JourneyDefinition {
  id: string;
  name: string;
  active: boolean;
  steps: JourneyStep[];
}

export type JourneyStatus = 'active' | 'engaged' | 'converted' | 'exited' | 'completed';

export interface JourneyState {
  phone: string;
  campaignId?: string;
  definitionId: string;
  status: JourneyStatus;
  enteredAt: string;
  currentStepIndex: number;
  nextTouchAt: string | null;
  touches: Array<{ stepId: string; channel: 'call' | 'sms'; at: string; result: string }>;
  contacted: boolean;            // a call connected at least once
  replied: boolean;              // they texted back (pauses automation)
  exitReason?: string;
}

const DEF_KEY = 'platform_journey_defs';
const STATE_KEY = 'platform_journeys';
const MAX_STATES = 20000;

let definitions: JourneyDefinition[] = [];
let states = new Map<string, JourneyState>();
let workerTimer: ReturnType<typeof setInterval> | null = null;

type DialFn = (phone: string, campaignId?: string) => Promise<boolean>;
type SmsFn = (to: string, body: string) => Promise<boolean>;
let dialFn: DialFn | null = null;
let smsFn: SmsFn | null = null;

function defaultDefinition(): JourneyDefinition {
  return {
    id: 'journey_default_newlead',
    name: 'New Weblead — Speed to Sold',
    active: true,
    steps: [
      { id: 'call1', channel: 'call', offsetMinutes: 0, window: { startHour: 8, endHour: 21 } },
      { id: 'sms_intro', channel: 'sms', intent: 'intro_missed_call', offsetMinutes: 2, onlyIfNoAnswerBefore: true },
      { id: 'call2', channel: 'call', offsetMinutes: 210, window: { startHour: 8, endHour: 21 }, skipIfContacted: true },
      { id: 'sms_second', channel: 'sms', intent: 'second_try', offsetMinutes: 245, onlyIfNoAnswerBefore: true },
      { id: 'sms_value', channel: 'sms', intent: 'value_nudge', offsetMinutes: 1 * 1440 + 90, window: { startHour: 9, endHour: 12 }, skipIfContacted: true },
      { id: 'call3', channel: 'call', offsetMinutes: 1 * 1440 + 540, window: { startHour: 17, endHour: 20 }, skipIfContacted: true },
      { id: 'sms_link_offer', channel: 'sms', intent: 'link_offer', offsetMinutes: 2 * 1440, window: { startHour: 10, endHour: 19 }, skipIfContacted: true },
      { id: 'sms_link_send', channel: 'sms', intent: 'link_send', offsetMinutes: 3 * 1440, window: { startHour: 10, endHour: 19 }, skipIfContacted: true },
      { id: 'call4', channel: 'call', offsetMinutes: 5 * 1440, window: { startHour: 11, endHour: 19 }, skipIfContacted: true },
      { id: 'sms_close', channel: 'sms', intent: 'last_checkin', offsetMinutes: 7 * 1440, window: { startHour: 10, endHour: 19 }, skipIfContacted: true },
    ],
  };
}

export function loadJourneys(): void {
  const savedDefs = loadData<JourneyDefinition[]>(DEF_KEY);
  definitions = Array.isArray(savedDefs) && savedDefs.length > 0 ? savedDefs : [defaultDefinition()];
  const savedStates = loadData<JourneyState[]>(STATE_KEY);
  if (Array.isArray(savedStates)) states = new Map(savedStates.map(s => [s.phone, s]));

  // Ledger-driven transitions: a connected call marks contact; a
  // connected transfer converts; DNC/STOP exits immediately.
  onEvent(ev => {
    if (!ev.phone) return;
    const st = states.get(ev.phone);
    if (!st || st.status !== 'active' && st.status !== 'engaged') return;
    if (ev.type === 'call.correct_party' || ev.type === 'call.answered') {
      if (!st.contacted) { st.contacted = true; persistStates(); }
    }
    if (ev.type === 'transfer.connected' || (ev.type === 'conversion.recorded' && (ev.data as Record<string, unknown>).conversionType === 'weblead_submission' && !(ev.data as Record<string, unknown>).duplicate)) {
      transitionJourney(ev.phone, 'converted', ev.type);
    }
    if (ev.type === 'dnc.added' || ev.type === 'sms.stop' || ev.type === 'call.wrong_party') {
      transitionJourney(ev.phone, 'exited', ev.type);
    }
  });
  logger.info('journey', `Journey engine loaded — ${definitions.length} definitions, ${states.size} lead states`);
}

function persistDefs(): void { scheduleSave(DEF_KEY, () => definitions); }
function persistStates(): void {
  scheduleSave(STATE_KEY, () => {
    const all = [...states.values()];
    return all.length > MAX_STATES ? all.slice(-MAX_STATES) : all;
  });
}

export function getJourneyDefinitions(): JourneyDefinition[] { return definitions; }

export function upsertJourneyDefinition(def: JourneyDefinition, actor = 'system'): JourneyDefinition {
  const idx = definitions.findIndex(d => d.id === def.id);
  if (idx >= 0) definitions[idx] = def; else definitions.push(def);
  persistDefs();
  recordEvent('config.changed', { scope: 'journey', definitionId: def.id }, { actor });
  return def;
}

export function setJourneyHandlers(dial: DialFn, sms: SmsFn): void {
  dialFn = dial;
  smsFn = sms;
}

// ── Entry & transitions ─────────────────────────────────────────────

export function enterJourney(rawPhone: string, opts: { campaignId?: string; definitionId?: string; alreadyDialed?: boolean } = {}): JourneyState | null {
  const phone = normalizePhone(rawPhone);
  const def = definitions.find(d => d.id === (opts.definitionId || 'journey_default_newlead')) || definitions[0];
  if (!def || !def.active) return null;
  if (isOnDnc(phone)) return null;

  const existing = states.get(phone);
  if (existing && (existing.status === 'active' || existing.status === 'engaged')) {
    return existing; // already in flight — don't restart mid-journey
  }

  const now = new Date();
  // If the weblead auto-dial already fired, step 0 (call1) is done.
  const startIndex = opts.alreadyDialed ? 1 : 0;
  const st: JourneyState = {
    phone,
    campaignId: opts.campaignId,
    definitionId: def.id,
    status: 'active',
    enteredAt: now.toISOString(),
    currentStepIndex: startIndex,
    nextTouchAt: computeStepTime(def.steps[startIndex], now, phone),
    touches: opts.alreadyDialed
      ? [{ stepId: 'call1', channel: 'call', at: now.toISOString(), result: 'speed_to_lead_dial' }]
      : [],
    contacted: false,
    replied: false,
  };
  states.set(phone, st);
  persistStates();
  recordEvent('journey.entered', { definitionId: def.id, startIndex }, { phone, campaignId: opts.campaignId });
  return st;
}

function transitionJourney(phone: string, status: JourneyStatus, reason: string): void {
  const st = states.get(phone);
  if (!st || st.status === status) return;
  st.status = status;
  st.exitReason = reason;
  st.nextTouchAt = status === 'active' ? st.nextTouchAt : null;
  persistStates();
  recordEvent(status === 'converted' ? 'journey.converted' : 'journey.exited', { reason, atStep: st.currentStepIndex }, { phone, campaignId: st.campaignId });
}

/** Inbound reply: a human is talking — automation steps aside. */
export function journeyMarkReplied(rawPhone: string): void {
  const phone = normalizePhone(rawPhone);
  const st = states.get(phone);
  if (!st || st.status !== 'active') return;
  st.replied = true;
  st.status = 'engaged';
  st.nextTouchAt = null;
  persistStates();
  recordEvent('journey.engaged', { atStep: st.currentStepIndex }, { phone, campaignId: st.campaignId });
}

/** Resume automation after an operator finishes a manual thread. */
export function journeyResume(rawPhone: string, actor = 'system'): JourneyState | null {
  const phone = normalizePhone(rawPhone);
  const st = states.get(phone);
  if (!st || st.status !== 'engaged') return null;
  st.status = 'active';
  st.replied = false;
  const def = definitions.find(d => d.id === st.definitionId);
  const step = def?.steps[st.currentStepIndex];
  st.nextTouchAt = step ? computeStepTime(step, new Date(st.enteredAt), phone) : null;
  if (st.nextTouchAt && new Date(st.nextTouchAt).getTime() < Date.now()) {
    st.nextTouchAt = new Date(Date.now() + 5 * 60000).toISOString();
  }
  persistStates();
  recordEvent('config.changed', { scope: 'journey', action: 'resumed' }, { actor, phone });
  return st;
}

export function getJourneyState(rawPhone: string): JourneyState | undefined {
  return states.get(normalizePhone(rawPhone));
}

export function journeyStats(): {
  active: number; engaged: number; converted: number; exited: number; completed: number;
  byStep: Array<{ stepId: string; leadsWaiting: number }>;
} {
  const counts = { active: 0, engaged: 0, converted: 0, exited: 0, completed: 0 };
  const stepMap = new Map<string, number>();
  const def = definitions[0];
  for (const st of states.values()) {
    counts[st.status] += 1;
    if (st.status === 'active' && def) {
      const step = def.steps[st.currentStepIndex];
      if (step) stepMap.set(step.id, (stepMap.get(step.id) || 0) + 1);
    }
  }
  return {
    ...counts,
    byStep: (def?.steps || []).map(s => ({ stepId: s.id, leadsWaiting: stepMap.get(s.id) || 0 })),
  };
}

// ── Scheduling & execution ──────────────────────────────────────────

function computeStepTime(step: JourneyStep | undefined, enteredAt: Date, phone: string): string | null {
  if (!step) return null;
  const raw = new Date(enteredAt.getTime() + step.offsetMinutes * 60000);
  if (!step.window) return raw.toISOString();
  const { tz } = resolveTimezone(undefined, phone);
  return nextTimeInWindow(tz, step.window.startHour, step.window.endHour, raw).toISOString();
}

function advance(st: JourneyState, def: JourneyDefinition): void {
  st.currentStepIndex += 1;
  const next = def.steps[st.currentStepIndex];
  if (!next) {
    st.status = 'completed';
    st.nextTouchAt = null;
    recordEvent('journey.completed', { touches: st.touches.length }, { phone: st.phone, campaignId: st.campaignId });
  } else {
    st.nextTouchAt = computeStepTime(next, new Date(st.enteredAt), st.phone);
  }
  persistStates();
}

async function executeStep(st: JourneyState, def: JourneyDefinition): Promise<void> {
  const step = def.steps[st.currentStepIndex];
  if (!step) { advance(st, def); return; }

  // Skip rules — someone we've already spoken to shouldn't get the
  // "couldn't reach you" track.
  if ((step.skipIfContacted || step.onlyIfNoAnswerBefore) && st.contacted) {
    st.touches.push({ stepId: step.id, channel: step.channel, at: new Date().toISOString(), result: 'skipped_contacted' });
    advance(st, def);
    return;
  }

  const decision = evaluateOutreach({ channel: step.channel, phone: st.phone, campaignId: st.campaignId });
  if (isBlocked(decision)) {
    const hard = decision.blocks.some(b => b.hard);
    if (hard) {
      transitionJourney(st.phone, 'exited', decision.blocks[0]?.code || 'policy');
      return;
    }
    // Soft block (quiet hours / caps): defer 45–90 min and retry.
    st.nextTouchAt = new Date(Date.now() + (45 + Math.floor(Math.random() * 45)) * 60000).toISOString();
    persistStates();
    return;
  }

  let result = 'attempted';
  try {
    if (step.channel === 'call') {
      if (!dialFn) { result = 'no_dial_handler'; }
      else {
        const ok = await dialFn(st.phone, st.campaignId);
        result = ok ? 'dialed' : 'dial_failed';
      }
    } else {
      if (!smsFn) { result = 'no_sms_handler'; }
      else if (!getSettings().smsEnabled) { result = 'sms_disabled'; }
      else {
        const profile = buildLeadProfile(st.phone);
        const s = getSettings();
        const spouse = profile.additionalDrivers.find(d => d.relationship === 'spouse');
        let link: string | undefined;
        if (step.intent === 'link_send' || step.intent === 'renewal') {
          link = createTrackedLink(st.phone, 'webform', { campaignId: st.campaignId, sentVia: 'sms' }).url;
        }
        const { body, sendDelayMs } = composeSms(st.phone, step.intent || 'value_nudge', {
          firstName: profile.firstName,
          agentName: s.agentName,
          companyName: s.companyName,
          state: profile.state,
          city: profile.city,
          currentInsurer: profile.currentInsurer,
          vehicle: profile.vehicles[0],
          vehicleCount: profile.vehicleCount,
          product: profile.product,
          spouseFirstName: spouse?.firstName,
          additionalDriverCount: profile.additionalDrivers.length,
          hasSr22: profile.hasSr22,
          link,
        });
        // Human timing: never instant.
        await new Promise(r => setTimeout(r, Math.min(sendDelayMs, 10000)));
        const ok = await smsFn(st.phone, body);
        result = ok ? 'sent' : 'send_failed';
        if (ok) recordEvent('sms.sent', { trigger: `journey:${step.id}`, intent: step.intent }, { phone: st.phone, campaignId: st.campaignId });
      }
    }
  } catch (err) {
    result = `error:${err instanceof Error ? err.message : String(err)}`;
  }

  st.touches.push({ stepId: step.id, channel: step.channel, at: new Date().toISOString(), result });
  recordEvent('journey.touch', { stepId: step.id, channel: step.channel, intent: step.intent, result }, { phone: st.phone, campaignId: st.campaignId });
  advance(st, def);
}

export async function processDueJourneySteps(now: Date = new Date()): Promise<number> {
  let processed = 0;
  for (const st of states.values()) {
    if (st.status !== 'active' || !st.nextTouchAt) continue;
    if (new Date(st.nextTouchAt).getTime() > now.getTime()) continue;
    const def = definitions.find(d => d.id === st.definitionId);
    if (!def) { st.status = 'exited'; st.exitReason = 'definition_missing'; persistStates(); continue; }
    await executeStep(st, def);
    processed++;
    if (processed >= 25) break;   // spread bursts across ticks
  }
  return processed;
}

export function startJourneyWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processDueJourneySteps().catch(err =>
      logger.error('journey', 'Journey tick error', { error: err instanceof Error ? err.message : String(err) }));
  }, 60 * 1000);
  logger.info('journey', 'Journey worker started (60s interval)');
}
