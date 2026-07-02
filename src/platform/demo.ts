// ── Demo Data Seeder ───────────────────────────────────────────────
// Generates a realistic 14-day operating history (leads, calls,
// transfers, objections, QA scores, SMS, opt-outs) so the command
// center is immediately populated for demos and design review.
// Idempotent: refuses to run when real events already exist unless
// force=true. Never runs automatically in production.

import crypto from 'crypto';
import { recordEvent, queryEvents } from './events';
import { upsertBuyer, listBuyers, createTransfer, updateTransferStage, getBuyer, HandoffPacket } from './buyers';
import { scoreCall, QaTranscriptTurn } from './qa';
import { getObjectionLibrary, recordObjectionOutcome } from './rebuttals';
import { createTrackedLink, recordWebformSubmission, recordOfferClick } from './lifecycle';
import { createOrUpdateLead } from '../memory';
import { logger } from '../utils/logger';

const FIRST_NAMES = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Jennifer', 'Carlos', 'Ashley', 'Kevin', 'Sandra', 'Brian', 'Nancy', 'Tyler', 'Diane', 'Marcus', 'Teresa', 'Eric', 'Gloria'];
const STATES = ['FL', 'TX', 'GA', 'OH', 'NC', 'AZ', 'PA', 'MI', 'TN', 'CA'];
const SOURCES = ['quotewizard-lp1', 'smartfinancial-fb', 'organic-seo', 'jangl-feed-a', 'jangl-feed-b', 'tiktok-video-3'];
const INSURERS = ['GEICO', 'Progressive', 'State Farm', 'Allstate', 'Liberty Mutual', 'USAA', 'None'];

// Deterministic PRNG so seeding is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoTranscript(rand: () => number, firstName: string, insurer: string, outcome: string): QaTranscriptTurn[] {
  const turns: QaTranscriptTurn[] = [
    { role: 'agent', text: `Hey ${firstName}? It's Steve with Smart Quotes — you put in a car insurance quote request.` },
    { role: 'user', text: rand() < 0.8 ? 'Yeah, that was me.' : 'Who is this?' },
    { role: 'agent', text: "Cool — heads up, calls are recorded. Just gonna verify a couple things real quick." },
    { role: 'agent', text: 'Who do you have insurance with right now?' },
    { role: 'user', text: insurer === 'None' ? "I don't have insurance right now." : `I'm with ${insurer}.` },
    { role: 'agent', text: 'Got it. Been with them over six months?' },
    { role: 'user', text: rand() < 0.7 ? 'Yeah, a couple years.' : 'No, just switched.' },
    { role: 'agent', text: 'How many cars are we quoting?' },
    { role: 'user', text: rand() < 0.5 ? 'Two.' : 'Just the one.' },
  ];
  if (outcome === 'transferred') {
    turns.push(
      { role: 'agent', text: 'Perfect — want me to connect you with a licensed agent now to run the numbers?' },
      { role: 'user', text: 'Sure, go ahead.' },
      { role: 'agent', text: "Cool, one sec — getting you over now." },
    );
  } else if (outcome === 'callback') {
    turns.push(
      { role: 'user', text: "I'm busy right now, call me later." },
      { role: 'agent', text: 'No problem. What time works — this evening or tomorrow morning?' },
      { role: 'user', text: 'Tomorrow morning.' },
      { role: 'agent', text: "You got it — I'll call you tomorrow morning. Talk then." },
    );
  } else if (outcome === 'dnc') {
    turns.push(
      { role: 'user', text: 'Take me off your list please.' },
      { role: 'agent', text: "Got it — I'll mark you down right now. You won't hear from us again." },
    );
  } else {
    turns.push(
      { role: 'user', text: "I'm not interested, thanks." },
      { role: 'agent', text: "Fair enough — I'll leave you to it. Have a good one." },
    );
  }
  return turns;
}

export function seedDemoData(opts: { force?: boolean } = {}): { seeded: boolean; reason?: string; leads?: number; calls?: number; transfers?: number } {
  const existing = queryEvents({ limit: 0 }).total;
  if (existing > 50 && !opts.force) {
    return { seeded: false, reason: `${existing} events already exist — pass force=true to seed anyway` };
  }

  const rand = mulberry32(42);
  const now = Date.now();

  // Demo buyers (only if none configured).
  if (listBuyers().length === 0) {
    upsertBuyer({
      name: 'Allstate Direct Desk', destinationNumber: '+18005550101', routeTag: 'allstate',
      priority: 10, states: [], excludedInsurers: ['Allstate'], requiresContinuousCoverage: true,
      acceptsDui: false, acceptsSr22: false, dailyCap: 60,
      hours: { tz: 'America/New_York', startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5] },
    }, 'demo-seed');
    upsertBuyer({
      name: 'General Agent Pool', destinationNumber: '+18005550102', routeTag: 'other',
      priority: 20, dailyCap: 0,
      hours: { tz: 'America/Chicago', startHour: 8, endHour: 21, days: [1, 2, 3, 4, 5, 6] },
    }, 'demo-seed');
    upsertBuyer({
      name: 'High-Risk Specialist Desk', destinationNumber: '+18005550103', routeTag: 'other',
      priority: 30, acceptsDui: true, acceptsSr22: true, dailyCap: 25,
      hours: { tz: 'America/New_York', startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] },
    }, 'demo-seed');
  }

  const objections = getObjectionLibrary();
  let leads = 0, calls = 0, transfers = 0;
  const demoLeads: Array<{ phone: string; firstName: string; state: string; insurer: string; campaignId: string }> = [];

  for (let day = 13; day >= 0; day--) {
    const leadsToday = 25 + Math.floor(rand() * 20);
    for (let i = 0; i < leadsToday; i++) {
      leads++;
      const firstName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
      const state = STATES[Math.floor(rand() * STATES.length)];
      const source = SOURCES[Math.floor(rand() * SOURCES.length)];
      const insurer = INSURERS[Math.floor(rand() * INSURERS.length)];
      const phone = `+1555${String(1000000 + Math.floor(rand() * 8999999))}`;
      const campaignId = 'campaign-consumer-auto';
      const callSid = `CAdemo${crypto.randomBytes(8).toString('hex')}`;
      // Note: recordEvent stamps events "now"; the demo timeline is encoded
      // in data.demoDay for charting (dashboards read data.occurredAt first).
      const occurredAt = new Date(now - day * 86400000 - Math.floor(rand() * 10 * 3600000)).toISOString();
      const common = { phone, campaignId };
      demoLeads.push({ phone, firstName, state, insurer, campaignId });

      recordEvent('lead.received', { source, state, insurer, firstName, occurredAt, demo: true }, common);

      // ~7% blocked by policy before dialing.
      if (rand() < 0.07) {
        recordEvent('policy.blocked', { channel: 'call', blocks: [rand() < 0.5 ? 'quiet_hours' : 'daily_call_cap'], occurredAt, demo: true }, common);
        continue;
      }

      calls++;
      recordEvent('call.attempted', { source, state, occurredAt, demo: true }, { ...common, callSid });

      const answered = rand() < 0.42;
      if (!answered) {
        recordEvent(rand() < 0.6 ? 'call.no_answer' : 'call.voicemail', { occurredAt, demo: true }, { ...common, callSid });
        if (rand() < 0.5) recordEvent('sms.sent', { template: 'missed_call', occurredAt, demo: true }, common);
        continue;
      }
      recordEvent('call.answered', { occurredAt, demo: true }, { ...common, callSid });

      const correctParty = rand() < 0.88;
      if (!correctParty) {
        recordEvent('call.wrong_party', { occurredAt, demo: true }, { ...common, callSid });
        continue;
      }
      recordEvent('call.correct_party', { occurredAt, demo: true }, { ...common, callSid });

      // Objection in ~55% of live conversations.
      if (rand() < 0.55) {
        const entry = objections[Math.floor(rand() * objections.length)];
        const variant = entry.variants[0];
        const advanced = rand() < 0.62;
        recordObjectionOutcome({
          code: entry.code, variantId: variant?.id,
          outcome: advanced ? 'advanced' : rand() < 0.5 ? 'declined' : 'hangup',
          callSid, campaignId, phone,
        });
        if (!advanced && rand() < 0.6) {
          recordEvent('call.completed', { outcome: 'declined', occurredAt, demo: true }, { ...common, callSid });
          scoreCall({ callSid, campaignId, phone, transcript: demoTranscript(rand, firstName, insurer, 'declined'), outcome: 'declined' });
          continue;
        }
      }

      const qualified = rand() < 0.72;
      if (!qualified) {
        recordEvent('call.disqualified', { reason: rand() < 0.5 ? 'no_license' : 'recent_dui', occurredAt, demo: true }, { ...common, callSid });
        continue;
      }
      recordEvent('call.qualified', { insurer, state, occurredAt, demo: true }, { ...common, callSid });

      const roll = rand();
      if (roll < 0.12) {
        // callback path
        recordEvent('callback.scheduled', { label: 'tomorrow morning', occurredAt, demo: true }, { ...common, callSid });
        scoreCall({ callSid, campaignId, phone, transcript: demoTranscript(rand, firstName, insurer, 'callback'), outcome: 'callback' });
        continue;
      }
      if (roll < 0.16) {
        // opt-out path
        recordEvent('dnc.added', { source: 'verbal', occurredAt, demo: true }, common);
        scoreCall({ callSid, campaignId, phone, transcript: demoTranscript(rand, firstName, insurer, 'dnc'), outcome: 'dnc', optOutRequested: true, optOutHonored: true });
        continue;
      }

      recordEvent('transfer.offered', { occurredAt, demo: true }, { ...common, callSid });
      if (rand() < 0.82) {
        recordEvent('transfer.accepted_by_consumer', { occurredAt, demo: true }, { ...common, callSid });
        const buyerList = listBuyers();
        const buyer = getBuyer(buyerList[Math.floor(rand() * buyerList.length)].id)!;
        const packet: HandoffPacket = {
          packetId: `pkt_${crypto.randomBytes(4).toString('hex')}`,
          lead: { firstName, phone, state },
          consent: { source: source, timestamp: occurredAt, transferConsentUtterance: 'Sure, go ahead.', transferConsentAt: occurredAt },
          submission: { receivedAt: occurredAt, source, campaignId, leadAgeMinutes: Math.floor(rand() * 30) },
          qualification: { currentInsurer: insurer === 'None' ? undefined : insurer, insured: insurer !== 'None', continuousCoverage: insurer !== 'None' ? '6mo+' : 'none', vehicleCount: 1 + Math.floor(rand() * 2) },
          call: { callSid, aiSummary: `${firstName} in ${state}, ${insurer === 'None' ? 'currently uninsured' : `with ${insurer}`}, ready for quotes.` },
        };
        const rec = createTransfer({ callSid, buyer, phone, campaignId, packet, consentUtterance: 'Sure, go ahead.' });
        transfers++;
        updateTransferStage(rec.id, 'buyer_ringing');
        if (rand() < 0.9) {
          updateTransferStage(rec.id, 'buyer_answered');
          if (rand() < 0.93) {
            updateTransferStage(rec.id, 'consumer_connected');
            updateTransferStage(rec.id, 'completed');
          } else {
            updateTransferStage(rec.id, 'abandoned', 'consumer dropped during hold');
          }
        } else {
          updateTransferStage(rec.id, 'failed', 'buyer no-answer');
          recordEvent('callback.scheduled', { label: 'fallback after failed transfer', occurredAt, demo: true }, { ...common, callSid });
        }
        scoreCall({
          callSid, campaignId, phone,
          transcript: demoTranscript(rand, firstName, insurer, 'transferred'),
          outcome: 'transferred', transferInitiated: true, transferConsentUtterance: 'Sure, go ahead.',
        });
      } else {
        recordEvent('call.completed', { outcome: 'declined_transfer', occurredAt, demo: true }, { ...common, callSid });
        scoreCall({ callSid, campaignId, phone, transcript: demoTranscript(rand, firstName, insurer, 'declined'), outcome: 'declined' });
      }
    }
  }

  // Lifecycle revenue loop: a slice of leads gets the "text me the
  // quote" flow — tracked link → click → prefilled-form submission
  // (new weblead + consent renewal) → offer-wall clicks.
  let webforms = 0, offerClicks = 0;
  for (const dl of demoLeads) {
    if (rand() >= 0.18) continue;
    createOrUpdateLead(dl.phone, {
      name: dl.firstName,
      state: dl.state,
      currentInsurer: dl.insurer === 'None' ? undefined : dl.insurer,
      tags: ['demo'],
    });
    const link = createTrackedLink(dl.phone, 'webform', { campaignId: dl.campaignId, sentVia: 'sms' });
    if (rand() < 0.7) {
      recordEvent('link.clicked', { kind: link.kind, token: link.token, demo: true }, { phone: dl.phone, campaignId: dl.campaignId });
      if (rand() < 0.6) {
        const sub = recordWebformSubmission({ token: link.token, source: 'demo-webform', campaignId: dl.campaignId });
        if (sub && !sub.duplicate) webforms++;
        const clicks = 1 + Math.floor(rand() * 3);
        for (let c = 0; c < clicks; c++) {
          recordOfferClick({ token: link.token, offerId: `offer-${1 + Math.floor(rand() * 6)}`, payout: 2 + rand() * 6 });
          offerClicks++;
        }
      }
    }
  }

  logger.info('demo', `Seeded demo data: ${leads} leads, ${calls} calls, ${transfers} transfers, ${webforms} webforms, ${offerClicks} offer clicks`);
  return { seeded: true, leads, calls, transfers };
}
