// ── Platform test suite ────────────────────────────────────────────
// Run: npm run test:platform
// (SKIP_ENV_VALIDATION=true npx ts-node src/platform/__tests__/platform.test.ts)
//
// Covers: policy engine (DNC, STOP, quiet hours, consent, caps),
// event ledger integrity, buyer selection (state/hours/caps/priority),
// cadence next-attempt + NL callback parsing, QA scoring rubric,
// rebuttal detection, profile versioning/rollback, security primitives.

process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION || 'true';
process.env.DATA_DIR = process.env.DATA_DIR || `/tmp/platform-test-${Date.now()}`;

import { recordEvent, queryEvents, verifyLedger, normalizePhone, loadEventLedger } from '../events';
import {
  loadPolicy, updatePolicyConfig, evaluateOutreach, recordSmsStop, hasSmsStop, recordComplaint,
} from '../policy';
import { loadBuyers, upsertBuyer, selectBuyer, evaluateBuyer, createTransfer, updateTransferStage } from '../buyers';
import { loadCadencePlans, listCadencePlans, computeNextAttempt, parseCallbackRequest } from '../cadence';
import { loadRebuttals, detectObjection, buildRebuttalPromptSection } from '../rebuttals';
import { loadQa, scoreCall } from '../qa';
import { loadProfiles, upsertProfile, getProfile, rollbackProfile, listProfiles } from '../profiles';
import { hashPassword, verifyPassword, redactPhoneForRole, loadSecurity, authEnabled } from '../security';
import {
  loadLifecycle, updateLifecycleConfig, getLeadLifecycle, createTrackedLink, handleLinkClick,
  recordWebformSubmission, recordOfferClick, revenueSummary, listConversions, runRenewalScan,
} from '../lifecycle';
import { resolveTimezone, localTimeIn } from '../timezone';
import { addToDnc, removeFromDnc, loadComplianceFromDisk, recordConsent, getConsent } from '../../compliance';
import { createOrUpdateLead } from '../../memory';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; failures.push(label); console.log(`  FAIL: ${label}`); }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; failures.push(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); console.log(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n=== ${name} ===`);
  try { fn(); } catch (err) {
    failed++;
    failures.push(`${name} threw: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  FAIL (threw): ${err instanceof Error ? err.stack : String(err)}`);
  }
}

// A UTC instant chosen so every US timezone is inside 8:00–21:00 local:
// 18:00 UTC = 14:00 ET / 13:00 CT / 12:00 MT / 11:00 PT (June: DST).
const MIDDAY = new Date('2026-06-16T18:00:00Z'); // a Tuesday
// 07:00 UTC = 03:00 ET / 00:00 PT — quiet hours everywhere in CONUS.
const NIGHT = new Date('2026-06-16T07:00:00Z');

loadComplianceFromDisk();
loadEventLedger();
loadPolicy();
loadBuyers();
loadCadencePlans();
loadRebuttals();
loadQa();
loadProfiles();
loadSecurity();
loadLifecycle();

describe('Timezone resolution', () => {
  assertEqual(resolveTimezone('CA').tz, 'America/Los_Angeles', 'State CA → Pacific');
  assertEqual(resolveTimezone('tx').tz, 'America/Chicago', 'Lowercase state works');
  assertEqual(resolveTimezone(undefined, '+13055551234').tz, 'America/New_York', 'Unknown area code defaults Eastern');
  assertEqual(resolveTimezone(undefined, '+12135551234').tz, 'America/Los_Angeles', 'Area code 213 → Pacific');
  assertEqual(resolveTimezone('FL', '+12135551234').source, 'state', 'State beats area code');
  const lt = localTimeIn('America/New_York', MIDDAY);
  assertEqual(lt.hour, 14, 'Local hour computed for ET');
  assertEqual(lt.day, 2, 'Weekday computed (Tuesday)');
});

describe('Event ledger', () => {
  const before = queryEvents({ limit: 0 }).total;
  recordEvent('lead.received', { source: 'test' }, { phone: '555-000-1111' });
  recordEvent('call.attempted', { source: 'test' }, { phone: '(555) 000-1111' });
  const after = queryEvents({ limit: 0 }).total;
  assertEqual(after - before, 2, 'Events recorded');
  const byPhone = queryEvents({ phone: '+15550001111', limit: 10 });
  assert(byPhone.total >= 2, 'Phone normalization unifies formats in queries');
  const integrity = verifyLedger();
  assert(integrity.valid, `Hash chain verifies (${integrity.checked} events)`);
  assertEqual(normalizePhone('555-000-1111'), '+15550001111', 'normalizePhone E.164');
});

describe('Policy engine — DNC and STOP', () => {
  const dncPhone = '+15550002222';
  addToDnc(dncPhone);
  const call = evaluateOutreach({ channel: 'call', phone: dncPhone, state: 'FL', now: MIDDAY });
  assert(!call.allowed, 'DNC blocks calls');
  assert(call.blocks.some(b => b.code === 'dnc' && b.hard), 'DNC is a hard block');
  assert(call.enforced, 'Hard blocks enforce even if policy disabled');
  removeFromDnc(dncPhone);

  const stopPhone = '+15550003333';
  recordSmsStop(stopPhone, 'test');
  assert(hasSmsStop(stopPhone), 'STOP recorded');
  const sms = evaluateOutreach({ channel: 'sms', phone: stopPhone, state: 'FL', now: MIDDAY });
  assert(!sms.allowed && sms.blocks.some(b => b.code === 'sms_stop' && b.hard), 'STOP hard-blocks SMS');
  const voice = evaluateOutreach({ channel: 'call', phone: stopPhone, state: 'FL', now: MIDDAY });
  assert(!voice.blocks.some(b => b.code === 'sms_stop'), 'STOP alone does not block voice');
  assert(voice.warnings.length > 0, 'STOP surfaces a warning on voice');
});

describe('Policy engine — quiet hours & lead-local time', () => {
  const day = evaluateOutreach({ channel: 'call', phone: '+15550004444', state: 'TX', now: MIDDAY });
  assert(!day.blocks.some(b => b.code === 'quiet_hours'), 'Midday call allowed in TX');
  const night = evaluateOutreach({ channel: 'call', phone: '+15550004444', state: 'TX', now: NIGHT });
  assert(night.blocks.some(b => b.code === 'quiet_hours'), 'Middle-of-night call blocked in TX');
  const nightCA = evaluateOutreach({ channel: 'call', phone: '+12135550000', now: NIGHT });
  assert(nightCA.blocks.some(b => b.code === 'quiet_hours'), 'Quiet hours derived from area code when no state');
});

describe('Policy engine — consent gate', () => {
  const phone = '+15550005555';
  updatePolicyConfig({ consentRequired: true }, 'test');
  const noConsent = evaluateOutreach({ channel: 'call', phone, state: 'GA', now: MIDDAY });
  assert(noConsent.blocks.some(b => b.code === 'consent_missing'), 'Missing consent blocks when required');
  recordConsent({ phone, consentType: 'express_written', source: 'unit-test', timestamp: MIDDAY.toISOString() });
  const withConsent = evaluateOutreach({ channel: 'call', phone, state: 'GA', now: MIDDAY });
  assert(!withConsent.blocks.some(b => b.code.startsWith('consent')), 'Documented consent passes');
  const staleNow = new Date(MIDDAY.getTime() + 200 * 86400000);
  // Move to a compliant local hour on the stale date (18:00 UTC works year-round for GA).
  const stale = evaluateOutreach({ channel: 'call', phone, state: 'GA', now: staleNow });
  assert(stale.blocks.some(b => b.code === 'consent_stale'), 'Stale consent blocks when required');
  updatePolicyConfig({ consentRequired: false }, 'test');
  const relaxed = evaluateOutreach({ channel: 'call', phone: '+15550005556', state: 'GA', now: MIDDAY });
  assert(relaxed.allowed || !relaxed.blocks.some(b => b.code === 'consent_missing'), 'Consent only warns when not required');
});

describe('Policy engine — frequency caps', () => {
  const phone = '+15550006666';
  updatePolicyConfig({ maxCallsPerDay: 2 }, 'test');
  recordEvent('call.attempted', {}, { phone });
  recordEvent('call.attempted', {}, { phone });
  const capped = evaluateOutreach({ channel: 'call', phone, state: 'OH', now: new Date() });
  assert(capped.blocks.some(b => b.code === 'daily_call_cap'), 'Daily call cap enforced from ledger');
  const testNum = evaluateOutreach({ channel: 'call', phone, state: 'OH', now: new Date(), isTestNumber: true });
  assert(!testNum.blocks.some(b => b.code === 'daily_call_cap'), 'Test numbers bypass caps');
  updatePolicyConfig({ maxCallsPerDay: 4 }, 'test');
});

describe('Complaint suppression', () => {
  const phone = '+15550007777';
  recordComplaint(phone, 'unit test complaint', 'test');
  const d = evaluateOutreach({ channel: 'call', phone, state: 'FL', now: MIDDAY });
  assert(d.blocks.some(b => b.code === 'complaint' && b.hard), 'Complaint hard-blocks outreach');
});

describe('Buyer selection', () => {
  const flOnly = upsertBuyer({
    name: 'FL Only Desk', destinationNumber: '+18005550201', states: ['FL'], priority: 5,
    hours: { tz: 'America/New_York', startHour: 0, endHour: 24, days: [0, 1, 2, 3, 4, 5, 6] },
  }, 'test');
  const anyState = upsertBuyer({
    name: 'Nationwide Desk', destinationNumber: '+18005550202', priority: 50,
    hours: { tz: 'America/New_York', startHour: 0, endHour: 24, days: [0, 1, 2, 3, 4, 5, 6] },
  }, 'test');
  const closed = upsertBuyer({
    name: 'Closed Desk', destinationNumber: '+18005550203', priority: 1,
    hours: { tz: 'America/New_York', startHour: 9, endHour: 10, days: [3] }, // Wednesdays 9-10 only
  }, 'test');

  const fl = selectBuyer({ state: 'FL', now: MIDDAY });
  assert(fl.selected !== null, 'A buyer is selected for FL');
  assertEqual(fl.selected!.buyer.id, flOnly.id, 'Priority + state eligibility picks FL desk');

  const tx = selectBuyer({ state: 'TX', now: MIDDAY });
  assertEqual(tx.selected!.buyer.id, anyState.id, 'State-ineligible buyer skipped for TX');

  const closedEval = evaluateBuyer(closed, { state: 'FL', now: MIDDAY });
  assert(!closedEval.eligible && closedEval.reasons.some(r => r.includes('operating hours')), 'Business hours actually evaluated');

  const noDui = upsertBuyer({
    id: flOnly.id, name: flOnly.name, destinationNumber: flOnly.destinationNumber,
    states: ['FL'], priority: 5, acceptsDui: false,
    hours: flOnly.hours,
  }, 'test');
  const duiCase = evaluateBuyer(noDui, { state: 'FL', dui: true, now: MIDDAY });
  assert(!duiCase.eligible && duiCase.reasons.some(r => r.includes('DUI')), 'DUI exclusion enforced');

  const excl = upsertBuyer({
    id: anyState.id, name: anyState.name, destinationNumber: anyState.destinationNumber,
    priority: 50, excludedInsurers: ['Allstate'], hours: anyState.hours,
  }, 'test');
  const allstateCustomer = evaluateBuyer(excl, { state: 'TX', currentInsurer: 'Allstate', now: MIDDAY });
  assert(!allstateCustomer.eligible, 'Current-insurer exclusion enforced');
});

describe('Transfer lifecycle', () => {
  const buyer = upsertBuyer({
    name: 'Lifecycle Desk', destinationNumber: '+18005550301',
    hours: { tz: 'America/New_York', startHour: 0, endHour: 24, days: [0, 1, 2, 3, 4, 5, 6] },
  }, 'test');
  const rec = createTransfer({
    callSid: 'CAtest123', buyer, phone: '+15550008888',
    packet: {
      packetId: 'pkt_test', lead: { firstName: 'Test', phone: '+15550008888', state: 'FL' },
      consent: {}, submission: {}, qualification: { currentInsurer: 'GEICO', vehicleCount: 2 },
      call: { callSid: 'CAtest123' },
    },
  });
  assertEqual(rec.currentStage, 'initiated', 'Transfer starts at initiated');
  updateTransferStage(rec.id, 'buyer_answered');
  const done = updateTransferStage(rec.id, 'completed');
  assertEqual(done!.currentStage, 'completed', 'Stage progression tracked');
  assert(Boolean(done!.stages.initiated && done!.stages.buyer_answered && done!.stages.completed), 'Stage timestamps recorded');
  const connected = queryEvents({ type: 'transfer.connected', callSid: 'CAtest123', limit: 5 });
  assert(connected.total >= 1, 'transfer.connected event recorded');
});

describe('Cadence — next attempt', () => {
  const plan = listCadencePlans()[0];
  assert(Boolean(plan), 'Default cadence plan seeded');
  // Fresh lead, no attempts, midday → dial now.
  const fresh = computeNextAttempt({
    plan, leadSubmittedAt: MIDDAY.toISOString(), attempts: [], state: 'FL', now: MIDDAY,
  });
  assertEqual(fresh.scheduleAt, MIDDAY.toISOString(), 'Fresh lead inside window dials immediately');
  // Exhausted day-0 attempts → schedules for a later window / next day.
  const attempts = [0, 1, 2, 3].map(i => ({ at: new Date(MIDDAY.getTime() + i * 60000).toISOString() }));
  const exhausted = computeNextAttempt({
    plan, leadSubmittedAt: MIDDAY.toISOString(), attempts, state: 'FL', now: new Date(MIDDAY.getTime() + 5 * 60000),
  });
  assert(exhausted.scheduleAt === null || new Date(exhausted.scheduleAt).getTime() > MIDDAY.getTime() + 5 * 60000,
    'Day cap pushes next attempt into the future');
  // Plan total cap.
  const many = Array.from({ length: plan.maxTotalAttempts }, (_, i) => ({ at: new Date(MIDDAY.getTime() - i * 3600000).toISOString() }));
  const capped = computeNextAttempt({ plan, leadSubmittedAt: MIDDAY.toISOString(), attempts: many, state: 'FL', now: MIDDAY });
  assertEqual(capped.scheduleAt, null, 'Total attempt cap ends the cadence');
});

describe('Cadence — natural-language callback parsing', () => {
  const opts = { state: 'FL', now: MIDDAY };
  const at6 = parseCallbackRequest('call me at 6', opts);
  assert(at6.matched, '"call me at 6" parses');
  assertEqual(localTimeIn('America/New_York', new Date(at6.startAt!)).hour, 18, '"at 6" resolves to 6 PM local');

  const tomorrow = parseCallbackRequest('tomorrow morning works', opts);
  assert(tomorrow.matched, '"tomorrow morning" parses');
  const tmLocal = localTimeIn('America/New_York', new Date(tomorrow.startAt!));
  assertEqual(tmLocal.hour, 9, 'Tomorrow morning → 9 AM local');
  assert(tmLocal.dateKey > localTimeIn('America/New_York', MIDDAY).dateKey, 'Tomorrow is actually the next local day');

  const afterWork = parseCallbackRequest('after work is better', opts);
  assert(afterWork.matched && localTimeIn('America/New_York', new Date(afterWork.startAt!)).hour === 17, '"after work" → 5 PM');

  const saturday = parseCallbackRequest('try me Saturday', opts);
  assert(saturday.matched && localTimeIn('America/New_York', new Date(saturday.startAt!)).day === 6, '"Saturday" lands on a Saturday');

  const textFirst = parseCallbackRequest('text me first, then call tomorrow morning', opts);
  assert(textFirst.matched === true && textFirst.smsFirst === true, '"text me first" flag detected');

  const spouse = parseCallbackRequest('call me when my wife is home', opts);
  assert(spouse.matched, 'Spouse-home request maps to an evening window');

  const inHour = parseCallbackRequest('give me a call in an hour', opts);
  assert(inHour.matched && Math.abs(new Date(inHour.startAt!).getTime() - (MIDDAY.getTime() + 3600000)) < 60000, '"in an hour" is relative');

  const nonsense = parseCallbackRequest('purple monkey dishwasher', opts);
  assert(!nonsense.matched, 'Nonsense does not parse');
});

describe('Rebuttal engine', () => {
  const objection = detectObjection("I'm busy right now, can't talk");
  assertEqual(objection?.code, 'busy', 'Busy objection detected');
  assertEqual(detectObjection('is this some kind of scam?')?.code, 'is_this_scam', 'Scam objection detected');
  assertEqual(detectObjection('I already have insurance thanks')?.code, 'already_insured', 'Already-insured detected');
  assert(detectObjection('lovely weather today') === undefined, 'No false positives on benign text');
  const section = buildRebuttalPromptSection();
  assert(section.includes('OBJECTION PLAYBOOK') && section.length > 500, 'Prompt section renders');
});

describe('QA scoring', () => {
  const goodCall = scoreCall({
    callSid: 'CAqa_good',
    transcript: [
      { role: 'agent', text: "Hey James? It's Steve with Smart Quotes — you put in a car insurance quote request." },
      { role: 'user', text: 'Yeah that was me.' },
      { role: 'agent', text: 'Cool — heads up, calls are recorded. Who do you have insurance with right now?' },
      { role: 'user', text: "I'm with GEICO." },
      { role: 'agent', text: 'Got it. Want me to connect you with a licensed agent now?' },
      { role: 'user', text: 'Sure, go ahead.' },
      { role: 'agent', text: 'One sec — getting you over now.' },
    ],
    outcome: 'transferred', transferInitiated: true, transferConsentUtterance: 'Sure, go ahead.',
  });
  assert(goodCall.overall >= 85, `Clean call scores high (${goodCall.overall})`);
  assertEqual(goodCall.riskFlags.length, 0, 'Clean call has no risk flags');

  const badCall = scoreCall({
    callSid: 'CAqa_bad',
    transcript: [
      { role: 'agent', text: 'I am a licensed insurance agent and I guarantee you will save four hundred dollars.' },
      { role: 'user', text: 'Take me off your list.' },
      { role: 'agent', text: 'Connecting you to a specialist now.' },
    ],
    outcome: 'transferred', transferInitiated: true,
    optOutRequested: true, optOutHonored: false,
  });
  assert(badCall.riskFlags.includes('false_licensure_claim'), 'False licensure detected');
  assert(badCall.riskFlags.includes('guaranteed_savings_claim'), 'Guaranteed-savings claim detected');
  assert(badCall.riskFlags.includes('opt_out_not_honored'), 'Ignored opt-out flagged');
  assert(badCall.riskFlags.includes('transfer_without_clear_permission'), 'Transfer without permission flagged');
  assert(badCall.overall < 50, `Bad call scores low (${badCall.overall})`);

  const humanLie = scoreCall({
    callSid: 'CAqa_lie',
    transcript: [
      { role: 'agent', text: 'Hey, is this Maria? This is about your insurance quote.' },
      { role: 'user', text: 'Are you a robot?' },
      { role: 'agent', text: "No, I'm a real person, of course." },
    ],
    outcome: 'ended',
  });
  assert(humanLie.riskFlags.includes('false_human_claim'), 'False "I am human" claim flagged');
});

describe('Agent profiles', () => {
  assert(listProfiles().length >= 6, 'Built-in presets seeded');
  const p = upsertProfile({ name: 'Test Profile', settings: { temperature: 0.7, vadThreshold: 0.6 } }, 'test');
  upsertProfile({ id: p.id, name: 'Test Profile', settings: { temperature: 0.9, vadThreshold: 0.5 }, note: 'v2' }, 'test');
  const v2 = getProfile(p.id)!;
  assertEqual(v2.settings.temperature, 0.9, 'Update creates new current settings');
  assertEqual(v2.versions.length, 2, 'Version history kept');
  const rolled = rollbackProfile(p.id, 1, 'test')!;
  assertEqual(rolled.settings.temperature, 0.7, 'Rollback restores v1 settings');
  assertEqual(rolled.versions.length, 3, 'Rollback recorded as a new version');
});

describe('Security primitives', () => {
  const hash = hashPassword('correct horse battery');
  assert(verifyPassword('correct horse battery', hash), 'Password verifies');
  assert(!verifyPassword('wrong password', hash), 'Wrong password rejected');
  assert(hash !== hashPassword('correct horse battery'), 'Salted (same input, different hash)');
  assertEqual(redactPhoneForRole('+15551234567', 'viewer'), '+1555•••••67', 'Viewer sees redacted phone');
  assertEqual(redactPhoneForRole('+15551234567', 'admin'), '+15551234567', 'Admin sees full phone');
  assert(!authEnabled() || true, 'authEnabled callable');
});

describe('Lifecycle — webform loop, cooldown, consent renewal', () => {
  const phone = '+15551230001';
  createOrUpdateLead(phone, { name: 'Carla Jimenez', state: 'FL', currentInsurer: 'GEICO' });

  // 1. Fresh lead: webform link is a webform link, prefilled.
  const link1 = createTrackedLink(phone, 'webform', { sentVia: 'sms' });
  assertEqual(link1.kind, 'webform', 'Fresh lead gets a webform link');
  assert(link1.url.includes('/t/'), 'Tracked redirect URL issued');
  assert(link1.destination.includes('first_name=Carla') && link1.destination.includes('state=FL'), 'Destination is prefilled from lead memory');

  // 2. Click tracking.
  const click = handleLinkClick(link1.token);
  assert(click !== null && click.destination.includes('tk='), 'Click resolves to prefilled destination with token');
  assert(handleLinkClick('nonexistent-token') === null, 'Unknown token rejected');

  // 3. Submission: sellable weblead + consent renewal.
  const sub1 = recordWebformSubmission({ token: link1.token, trustedFormUrl: 'https://cert.trustedform.com/abc' })!;
  assert(!sub1.duplicate, 'First submission is sellable (not duplicate)');
  assert(sub1.conversion.value > 0, 'Sellable weblead carries revenue value');
  const consent1 = getConsent(phone)!;
  assert(Boolean(consent1) && new Date(consent1.timestamp).getTime() > Date.now() - 60000, 'Consent renewed to now');
  assert(new Date(sub1.consentRenewedUntil).getTime() > Date.now() + 80 * 86400000, 'Renewal extends ~90 days out');

  // 4. Cooldown: an immediate second webform ask downgrades to offers…
  const link2 = createTrackedLink(phone, 'webform');
  assertEqual(link2.kind, 'offers', 'Webform ask during cooldown downgrades to offer wall');
  assert(Boolean(link2.downgraded), 'Downgrade reason is stated');

  // …and a forced second submission renews consent but is a $0 duplicate.
  const sub2 = recordWebformSubmission({ phone })!;
  assert(sub2.duplicate, 'Submission inside 30-day cooldown flagged duplicate');
  assertEqual(sub2.conversion.value, 0, 'Duplicate weblead not valued');
  const lc = getLeadLifecycle(phone);
  assert(!lc.weblead.eligibleNow && lc.weblead.daysUntilEligible > 0, 'Cooldown countdown exposed');
  assertEqual(lc.consent.status, 'active', 'Consent still active after duplicate submission');

  // 5. Offer clicks: unlimited, each one pays.
  recordOfferClick({ token: link2.token, offerId: 'offer-1', payout: 4.25 });
  recordOfferClick({ token: link2.token, offerId: 'offer-2' });
  recordOfferClick({ phone, offerId: 'offer-3' });
  const clicks = listConversions({ phone, type: 'offer_click' });
  assertEqual(clicks.length, 3, 'Multiple offer clicks all recorded');
  assert(clicks.every(c => c.value > 0), 'Every offer click carries revenue');

  // 6. Revenue rollup.
  const rev = revenueSummary({ since: new Date(Date.now() - 3600000).toISOString() });
  assert(rev.byType.weblead_submission.count === 2 && rev.byType.weblead_submission.duplicates === 1, 'Revenue splits sellable vs duplicate webleads');
  assert(rev.byType.offer_click.count === 3 && rev.totalValue > 0, 'Offer clicks roll into revenue');
});

describe('Lifecycle — transfer auto-attribution', () => {
  const phone = '+15551230002';
  const buyer = upsertBuyer({
    name: 'Attribution Desk', destinationNumber: '+18005550401',
    hours: { tz: 'America/New_York', startHour: 0, endHour: 24, days: [0, 1, 2, 3, 4, 5, 6] },
  }, 'test');
  const rec = createTransfer({
    callSid: 'CAattr1', buyer, phone,
    packet: { packetId: 'pkt_attr', lead: { phone }, consent: {}, submission: {}, qualification: {}, call: { callSid: 'CAattr1' } },
  });
  updateTransferStage(rec.id, 'buyer_answered');
  updateTransferStage(rec.id, 'consumer_connected');
  const attributed = listConversions({ phone, type: 'warm_transfer' });
  assertEqual(attributed.length, 1, 'Connected transfer auto-records a warm_transfer conversion');
  assert(attributed[0].value > 0, 'Transfer conversion carries configured value');
});

async function renewalWorkerTests(): Promise<void> {
  console.log('\n=== Lifecycle — renewal pipeline & worker ===');
  const phone = '+15551230003';
  createOrUpdateLead(phone, { name: 'Renewal Rick', state: 'TX' });
  // Consent recorded 70 days ago → 20 days left → inside the 25-day window.
  recordConsent({ phone, consentType: 'express_written', source: 'unit-test', timestamp: new Date(Date.now() - 70 * 86400000).toISOString() });
  const lc = getLeadLifecycle(phone);
  assertEqual(lc.consent.status, 'expiring', 'Consent 70 days old is in the renewal window');
  assert(lc.renewalDue, 'Renewal due when expiring and weblead-eligible');

  // Worker: with auto-send on and quiet hours opened, one push happens.
  updateLifecycleConfig({ autoRenewalSmsEnabled: true }, 'test');
  updatePolicyConfig({ quietHoursStart: 0, quietHoursEnd: 24 }, 'test');
  const sent: string[] = [];
  const fakeSms = async (to: string, body: string) => { sent.push(`${to}|${body}`); return true; };

  const scan1 = await runRenewalScan(fakeSms);
  assert(scan1.pushed >= 1, 'Renewal scan pushes an SMS for the expiring lead');
  assert(sent.some(s => s.startsWith(phone) && s.includes('/t/') && s.includes('STOP')), 'Renewal SMS carries tracked link + STOP language');
  const scan2 = await runRenewalScan(fakeSms);
  assertEqual(scan2.pushed, 0, 'Min-gap prevents re-pushing the same lead');
  updateLifecycleConfig({ autoRenewalSmsEnabled: false }, 'test');
  updatePolicyConfig({ quietHoursStart: 8, quietHoursEnd: 21 }, 'test');
}

describe('Ledger integrity after all activity', () => {
  const integrity = verifyLedger();
  assert(integrity.valid, `Hash chain still valid after ${integrity.checked} events`);
});

renewalWorkerTests()
  .catch(err => {
    failed++;
    failures.push(`renewal worker tests threw: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    console.log('\n' + '='.repeat(50));
    console.log(`Tests: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  FAIL: ${f}`);
    }
    console.log('='.repeat(50));
    process.exit(failed > 0 ? 1 : 0);
  });
