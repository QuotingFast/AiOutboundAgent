// ── Human SMS Composer ─────────────────────────────────────────────
// Generates texts that read like a person typed them: personalized
// from the lead's actual quote data (vehicle, state, insurer), varied
// per lead (no two leads get the same wording), consistent per lead
// (the same "person" is texting them across the whole journey), and
// free of template artifacts — no {{tokens}}, no marketing-speak, no
// exclamation-point salvos.
//
// Compliance line that never bends: the FIRST text in a thread always
// identifies the sender's brand and carries STOP language. Follow-ups
// inside an active thread read fully conversational.

import crypto from 'crypto';

export type SmsIntent =
  | 'intro_missed_call'   // first text right after an unanswered speed-to-lead call
  | 'second_try'          // tried again later the same day
  | 'value_nudge'         // day 1: give a reason to reconnect
  | 'link_offer'          // ask if they want the quote link
  | 'link_send'           // deliver the tracked prefilled link
  | 'last_checkin'        // day 7 soft close
  | 'renewal';            // consent-renewal push (also used by lifecycle)

export interface SmsPersonalization {
  firstName?: string;
  agentName: string;
  companyName: string;
  state?: string;
  city?: string;
  currentInsurer?: string;
  vehicle?: { year?: string; make?: string; model?: string };
  vehicleCount?: number;
  product?: 'auto' | 'home' | 'bundle';
  spouseFirstName?: string;       // if a spouse is on the policy
  additionalDriverCount?: number; // drivers beyond the applicant
  hasSr22?: boolean;
  link?: string;                  // tracked link for link_send / renewal
}

// Deterministic per-lead randomness: the same lead always draws the
// same variants (one consistent texting "voice"), different leads draw
// different ones. Salt by intent so consecutive messages vary.
function personaRand(phone: string, salt: string): (n: number) => number {
  const h = crypto.createHash('sha256').update(phone + '|' + salt).digest();
  let i = 0;
  return (n: number) => h[(i++) % h.length] % n;
}

function pick<T>(rand: (n: number) => number, options: T[]): T {
  return options[rand(options.length)];
}

/** "2019 Camry", "the Silverado", "your car" — how a person abbreviates. */
function vehiclePhrase(rand: (n: number) => number, p: SmsPersonalization): string {
  const v = p.vehicle;
  if (!v || (!v.make && !v.model)) {
    return p.product === 'home' ? 'your place' : p.vehicleCount && p.vehicleCount > 1 ? 'your cars' : 'your car';
  }
  const shortYear = v.year && v.year.length === 4 ? `'${v.year.slice(2)}` : v.year || '';
  const name = v.model || v.make || '';
  return pick(rand, [
    `the ${[shortYear, name].filter(Boolean).join(' ')}`.trim(),
    `your ${name}`,
    `the ${name}`,
  ]);
}

function productPhrase(p: SmsPersonalization): string {
  return p.product === 'home' ? 'home insurance' : p.product === 'bundle' ? 'home and auto' : 'car insurance';
}

/**
 * Compose a human-reading SMS for the given intent. Returns the body
 * plus a suggested send-delay so messages never land with robotic
 * instant timing.
 */
export function composeSms(phone: string, intent: SmsIntent, p: SmsPersonalization): { body: string; sendDelayMs: number } {
  const rand = personaRand(phone, intent);
  const first = p.firstName && p.firstName !== 'Unknown' ? p.firstName : '';
  const veh = vehiclePhrase(rand, p);
  const prod = productPhrase(p);
  const insurer = p.currentInsurer && !/none/i.test(p.currentInsurer) ? p.currentInsurer : '';

  let body: string;

  switch (intent) {
    case 'intro_missed_call': {
      // First touch: must identify brand + carry STOP. Still human.
      const opener = pick(rand, [
        first ? `Hey ${first}, ` : 'Hey, ',
        first ? `Hi ${first} — ` : 'Hi — ',
        first ? `${first}, hey — ` : 'Hey there — ',
      ]);
      const middle = pick(rand, [
        `it's ${p.agentName} with ${p.companyName}. Just tried you about the ${prod} quote you started online${p.state ? ` in ${p.state}` : ''}. I've got the info for ${veh} pulled up`,
        `${p.agentName} here from ${p.companyName} — saw your ${prod} request come through and gave you a quick call. Have everything for ${veh} ready to go`,
        `this is ${p.agentName} at ${p.companyName}. You'd started a ${prod} quote online, so I called real quick. Got ${veh} in the system already`,
      ]);
      const close = pick(rand, [
        `, just need 2 min to finish it up. When's good?`,
        ` — takes about 2 min to wrap up. Want me to try you later today?`,
        `. What time works for a quick call?`,
      ]);
      body = `${opener}${middle}${close} Reply STOP to opt out`;
      break;
    }
    case 'second_try': {
      body = pick(rand, [
        `Tried you again${first ? `, ${first}` : ''} — no luck. Still have your ${prod} numbers here whenever you get a sec`,
        `Me again${first ? ` ${first}` : ''}, sorry to double up. Didn't want your quote to just sit here. Later tonight better?`,
        `Just tried one more time. No rush — what's usually a good time to catch you?`,
      ]);
      break;
    }
    case 'value_nudge': {
      const multiDriver = (p.additionalDriverCount || 0) > 0;
      const where = p.city || p.state || '';
      const angle = insurer
        ? pick(rand, [
            `Quick thing — folks switching from ${insurer} lately have been seeing real differences${where ? ` around ${where}` : ''}, so it's worth the 2 min`,
            `Was going through your info — with you being at ${insurer} there are a couple carriers I'd want to run for ${veh}`,
            multiDriver
              ? `Looked at your file again — with ${p.spouseFirstName ? `you and ${p.spouseFirstName}` : 'more than one driver'} on there, a couple carriers get a lot more competitive vs ${insurer}`
              : `Ran a first pass on ${veh} — a couple carriers are coming in interesting vs ${insurer}. Worth 2 min`,
          ])
        : pick(rand, [
            `Rates${where ? ` around ${where}` : ''} have moved a lot this year — that's usually good news for shoppers, worth a quick look`,
            `Went ahead and lined up a few options for ${veh}. Some look pretty decent honestly`,
            multiDriver
              ? `With ${p.spouseFirstName ? `${p.spouseFirstName} on the policy too` : 'multiple drivers on the policy'} you'd qualify for a couple discounts most people miss. Quick call and I can confirm`
              : `Lined up a few options for ${veh} already — quick call and I can read them to you`,
          ]);
      const close = pick(rand, [
        `. Got 2 minutes today?`,
        `. Want me to call this afternoon or evening?`,
        ` — when should I call?`,
      ]);
      body = `${angle}${close}`;
      break;
    }
    case 'link_offer': {
      body = pick(rand, [
        `${first ? `${first} — ` : ''}if calls are a pain I can just text you the link instead. Everything's already filled in from what you gave us, you'd just hit submit. Want it?`,
        `Easier idea — I can send your quote link right here. It's all pre-filled, takes like a minute. Want me to?`,
        `No luck catching you live, so: want the link instead? Your info's already in there, you just review + submit`,
      ]);
      break;
    }
    case 'link_send': {
      const lead_in = pick(rand, [
        `Here you go: `,
        `Done — here's your link: `,
        `Alright, here it is: `,
      ]);
      const tail = pick(rand, [
        ` Everything's pre-filled, just double-check it and hit submit. I'll be around if anything looks off`,
        ` Takes about a minute. Text me here if you hit any snags`,
        ` If any of it looks outdated just fix it before you submit`,
      ]);
      body = `${lead_in}${p.link || ''}${tail}`;
      break;
    }
    case 'last_checkin': {
      body = pick(rand, [
        `${first ? `${first}, ` : ''}last one from me, promise — if the timing's just bad I'll close this out. If you still want the numbers for ${veh}, text me back or grab the link anytime`,
        `Going to stop bugging you after this — if you ever want to finish that ${prod} quote, I'm at this number. Take care${first ? `, ${first}` : ''}`,
        `Closing your file for now — no hard feelings. If rates start hurting later, you know where I am`,
      ]);
      break;
    }
    case 'renewal': {
      const opener = pick(rand, [
        first ? `Hey ${first}, ` : 'Hey, ',
        first ? `Hi ${first} — ` : 'Hi — ',
      ]);
      body = `${opener}${pick(rand, [
        `it's ${p.agentName} w/ ${p.companyName}. It's been a bit since your last ${prod} quote — rates moved, worth a fresh look. All pre-filled: `,
        `${p.agentName} from ${p.companyName} here. Your ${prod} numbers are getting stale — 1 min to refresh them, everything's filled in: `,
      ])}${p.link || ''} Reply STOP to opt out`;
      break;
    }
    default:
      body = `Hey${first ? ` ${first}` : ''}, it's ${p.agentName} with ${p.companyName} about your ${prod} quote. Reply STOP to opt out`;
  }

  // Human send timing: a person doesn't fire a text the same second an
  // event happens, and longer messages take longer to "type".
  const jitterMs = 20000 + Math.floor(personaRand(phone, intent + ':t')(90) * 1000);
  const typingMs = Math.min(9000, body.length * 45);
  return { body, sendDelayMs: jitterMs + typingMs };
}
