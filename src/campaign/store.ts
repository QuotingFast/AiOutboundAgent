// ── Campaign Store ─────────────────────────────────────────────────
// In-memory store for campaigns, DID mappings, outbound call records,
// scheduled callbacks, enforcement logs, templates, and AI profiles.
// All data is campaign-scoped. No global defaults for user-facing behavior.

import { logger } from '../utils/logger';
import { buildSystemPrompt } from '../agent/prompts';
import {
  CampaignConfig,
  CampaignContext,
  CampaignType,
  CampaignAIProfile,
  CampaignVoiceConfig,
  OutboundCallRecord,
  CampaignScheduledCallback,
  EnforcementLogEntry,
  DidMapping,
  CampaignFeatureFlags,
  CampaignTransferRouting,
  CampaignCallbackRules,
  CampaignRetryRules,
  CampaignFeatures,
} from './types';
import { SmsTemplate } from '../sms';

// ── In-Memory Stores ───────────────────────────────────────────────

const campaigns = new Map<string, CampaignConfig>();
const didMappings = new Map<string, DidMapping>(); // DID -> mapping
const outboundCallRecords: OutboundCallRecord[] = [];
const scheduledCallbacks: CampaignScheduledCallback[] = [];
const enforcementLog: EnforcementLogEntry[] = [];

// Per-campaign template registries
const campaignSmsTemplates = new Map<string, SmsTemplate[]>();
const campaignEmailTemplates = new Map<string, SmsTemplate[]>(); // reuse SmsTemplate shape for email
const campaignAiProfiles = new Map<string, CampaignAIProfile[]>();

// Feature flags
const featureFlags: CampaignFeatureFlags = {
  multi_campaign_mode: true,
  scheduled_callbacks: true,
  dynamic_voice_sync: true,
  hardened_campaign_isolation: true,
};

const MAX_ENFORCEMENT_LOG = 1000;
const MAX_OUTBOUND_RECORDS = 5000;
const MAX_SCHEDULED_CALLBACKS = 2000;

// ── Feature Flags ──────────────────────────────────────────────────

export function getFeatureFlags(): CampaignFeatureFlags {
  return { ...featureFlags };
}

export function setFeatureFlag(key: keyof CampaignFeatureFlags, value: boolean): void {
  featureFlags[key] = value;
  logger.info('campaign-store', `Feature flag ${key} set to ${value}`);
}

export function isFeatureFlagEnabled(key: keyof CampaignFeatureFlags): boolean {
  return featureFlags[key];
}

// ── Campaign CRUD ──────────────────────────────────────────────────

export function getCampaign(id: string): CampaignConfig | undefined {
  return campaigns.get(id);
}

export function getAllCampaigns(): CampaignConfig[] {
  return [...campaigns.values()];
}

export function getActiveCampaigns(): CampaignConfig[] {
  return [...campaigns.values()].filter(c => c.active);
}

export function createCampaign(config: CampaignConfig): CampaignConfig {
  campaigns.set(config.id, config);
  // Initialize empty template registries
  if (!campaignSmsTemplates.has(config.id)) {
    campaignSmsTemplates.set(config.id, []);
  }
  if (!campaignEmailTemplates.has(config.id)) {
    campaignEmailTemplates.set(config.id, []);
  }
  if (!campaignAiProfiles.has(config.id)) {
    campaignAiProfiles.set(config.id, [config.aiProfile]);
  }
  logger.info('campaign-store', 'Campaign created', { id: config.id, type: config.type, name: config.name });
  return config;
}

export function updateCampaign(id: string, updates: Partial<CampaignConfig>): CampaignConfig | undefined {
  const existing = campaigns.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, id: existing.id, updatedAt: new Date().toISOString() };
  campaigns.set(id, updated);
  logger.info('campaign-store', 'Campaign updated', { id });
  return updated;
}

export function deleteCampaign(id: string): boolean {
  return campaigns.delete(id);
}

// ── DID Mappings ───────────────────────────────────────────────────

export function setDidMapping(did: string, campaignId: string): void {
  didMappings.set(normalizePhone(did), { did: normalizePhone(did), campaignId });
}

export function getDidMapping(did: string): DidMapping | undefined {
  return didMappings.get(normalizePhone(did));
}

export function getAllDidMappings(): DidMapping[] {
  return [...didMappings.values()];
}

export function removeDidMapping(did: string): boolean {
  return didMappings.delete(normalizePhone(did));
}

// ── Outbound Call Records ──────────────────────────────────────────

export function recordOutboundCall(record: OutboundCallRecord): void {
  outboundCallRecords.unshift(record);
  if (outboundCallRecords.length > MAX_OUTBOUND_RECORDS) {
    outboundCallRecords.length = MAX_OUTBOUND_RECORDS;
  }
}

export function getOutboundCallRecords(): OutboundCallRecord[] {
  return [...outboundCallRecords];
}

export function findOutboundByPhone(phone: string, maxAgeDays = 30): OutboundCallRecord[] {
  const normalized = normalizePhone(phone);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return outboundCallRecords.filter(
    r => normalizePhone(r.toPhone) === normalized && new Date(r.timestamp).getTime() > cutoff
  );
}

export function findOutboundByDid(did: string): OutboundCallRecord[] {
  const normalized = normalizePhone(did);
  return outboundCallRecords.filter(r => normalizePhone(r.fromDid) === normalized);
}

// ── Scheduled Callbacks (Campaign-Locked) ──────────────────────────

export function createScheduledCallback(cb: CampaignScheduledCallback): CampaignScheduledCallback {
  scheduledCallbacks.unshift(cb);
  if (scheduledCallbacks.length > MAX_SCHEDULED_CALLBACKS) {
    scheduledCallbacks.length = MAX_SCHEDULED_CALLBACKS;
  }
  logger.info('campaign-store', 'Scheduled callback created', { id: cb.id, campaignId: cb.campaignId, phone: cb.phone });
  return cb;
}

export function getScheduledCallbacks(filter?: { status?: string; campaignId?: string }): CampaignScheduledCallback[] {
  let result = [...scheduledCallbacks];
  if (filter?.status) result = result.filter(c => c.status === filter.status);
  if (filter?.campaignId) result = result.filter(c => c.campaignId === filter.campaignId);
  return result;
}

export function getDueScheduledCallbacks(): CampaignScheduledCallback[] {
  const now = new Date().toISOString();
  return scheduledCallbacks.filter(
    c => c.status === 'scheduled' && c.requestedDatetimeUtc <= now
  );
}

export function updateScheduledCallback(id: string, updates: Partial<CampaignScheduledCallback>): CampaignScheduledCallback | undefined {
  const cb = scheduledCallbacks.find(c => c.id === id);
  if (!cb) return undefined;
  Object.assign(cb, updates, { updatedAt: new Date().toISOString() });
  return cb;
}

export function cancelScheduledCallback(id: string): boolean {
  const cb = scheduledCallbacks.find(c => c.id === id);
  if (cb && cb.status === 'scheduled') {
    cb.status = 'canceled';
    cb.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
}

// ── Enforcement Log ────────────────────────────────────────────────

export function logEnforcement(entry: EnforcementLogEntry): void {
  enforcementLog.unshift(entry);
  if (enforcementLog.length > MAX_ENFORCEMENT_LOG) {
    enforcementLog.length = MAX_ENFORCEMENT_LOG;
  }

  const level = entry.allowed ? 'info' : 'warn';
  logger[level]('enforcement', `${entry.eventType}: ${entry.action} - ${entry.reason}`, {
    phone: entry.phone,
    leadId: entry.leadId,
    campaignId: entry.campaignId,
    aiProfileId: entry.aiProfileId,
    voiceId: entry.voiceId,
    allowed: entry.allowed,
  });
}

export function getEnforcementLog(limit = 100): EnforcementLogEntry[] {
  return enforcementLog.slice(0, limit);
}

// ── Per-Campaign Template Registries ───────────────────────────────

export function getCampaignSmsTemplates(campaignId: string): SmsTemplate[] {
  return campaignSmsTemplates.get(campaignId) || [];
}

export function addCampaignSmsTemplate(campaignId: string, template: SmsTemplate): void {
  if (!campaignSmsTemplates.has(campaignId)) {
    campaignSmsTemplates.set(campaignId, []);
  }
  campaignSmsTemplates.get(campaignId)!.push(template);
}

export function removeCampaignSmsTemplate(campaignId: string, templateId: string): boolean {
  const templates = campaignSmsTemplates.get(campaignId);
  if (!templates) return false;
  const idx = templates.findIndex(t => t.id === templateId);
  if (idx >= 0) { templates.splice(idx, 1); return true; }
  return false;
}

export function getCampaignEmailTemplates(campaignId: string): SmsTemplate[] {
  return campaignEmailTemplates.get(campaignId) || [];
}

export function addCampaignEmailTemplate(campaignId: string, template: SmsTemplate): void {
  if (!campaignEmailTemplates.has(campaignId)) {
    campaignEmailTemplates.set(campaignId, []);
  }
  campaignEmailTemplates.get(campaignId)!.push(template);
}

export function removeCampaignEmailTemplate(campaignId: string, templateId: string): boolean {
  const templates = campaignEmailTemplates.get(campaignId);
  if (!templates) return false;
  const idx = templates.findIndex(t => t.id === templateId);
  if (idx >= 0) { templates.splice(idx, 1); return true; }
  return false;
}

// ── Per-Campaign AI Profiles ───────────────────────────────────────

export function getCampaignAiProfiles(campaignId: string): CampaignAIProfile[] {
  return campaignAiProfiles.get(campaignId) || [];
}

export function getCampaignAiProfile(campaignId: string, profileId: string): CampaignAIProfile | undefined {
  const profiles = campaignAiProfiles.get(campaignId);
  return profiles?.find(p => p.id === profileId);
}

export function addCampaignAiProfile(campaignId: string, profile: CampaignAIProfile): void {
  if (!campaignAiProfiles.has(campaignId)) {
    campaignAiProfiles.set(campaignId, []);
  }
  campaignAiProfiles.get(campaignId)!.push(profile);
}

// ── Helper ─────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, '');
}

// ── Seed Data ──────────────────────────────────────────────────────
// Initialize two default campaigns matching the spec.

export function seedCampaigns(): void {
  if (campaigns.size > 0) return;

  const now = new Date().toISOString();

  // Campaign A: Consumer Auto Insurance Leads
  const consumerAiProfile: CampaignAIProfile = {
    id: 'ai-profile-consumer-default',
    campaignId: 'campaign-consumer-auto',
    agentName: 'Alex',
    companyName: 'Affordable Auto Rates',
    temperature: 0.8,
    maxResponseTokens: 275,
    realtimeModel: 'gpt-realtime',
    systemPrompt: buildSystemPrompt({ first_name: '{{first_name}}', state: '{{state}}', current_insurer: '{{current_insurer}}' }),
    inboundPrompt: '',
    greetingText: 'Hey {{first_name}}, this is Alex over at Affordable Auto Rates — you had looked into an auto insurance quote not too long ago, right?',
    inboundGreetingText: 'Thanks for calling Affordable Auto Rates, this is Alex. How can I help you today?',
    tools: [],
  };

  const consumerCampaign: CampaignConfig = {
    id: 'campaign-consumer-auto',
    name: 'Consumer Auto Insurance Leads',
    type: 'consumer_auto_insurance',
    active: true,
    createdAt: now,
    updatedAt: now,
    aiProfile: consumerAiProfile,
    voiceConfig: {
      voiceProvider: 'elevenlabs',
      openaiVoice: 'coral',
      elevenlabsVoiceId: 'cjVigY5qzO86Huf0OWal', // eric
      elevenlabsModelId: 'eleven_flash_v2_5',
      elevenlabsStability: 0.62,
      elevenlabsSimilarityBoost: 0.82,
      deepseekModel: 'deepseek-chat',
    },
    smsTemplateSetId: 'sms-set-consumer',
    emailTemplateSetId: 'email-set-consumer',
    transferRouting: {
      routes: [
        {
          id: 'route-allstate',
          name: 'Allstate Qualified',
          destinationNumber: '',
          businessHoursStart: '08:00',
          businessHoursEnd: '20:00',
          businessDays: [1, 2, 3, 4, 5],
          active: true,
        },
        {
          id: 'route-non-allstate',
          name: 'General Agent Pool',
          destinationNumber: '',
          businessHoursStart: '08:00',
          businessHoursEnd: '20:00',
          businessDays: [1, 2, 3, 4, 5, 6],
          active: true,
        },
      ],
      fallbackMessage: 'We are unable to connect you right now. Someone will call you back shortly.',
    },
    callbackRules: {
      enabled: true,
      maxAttempts: 3,
      retryDelayMinutes: [30, 120, 1440],
      tcpaWindowStart: 8,
      tcpaWindowEnd: 21,
    },
    retryRules: {
      enabled: true,
      maxAttempts: 3,
      retryDelaysMs: [30 * 60_000, 2 * 3600_000, 24 * 3600_000],
      quietHoursStart: 21,
      quietHoursEnd: 8,
    },
    dispositions: [
      'new', 'contacted', 'interested', 'qualified', 'transferred',
      'not_interested', 'dnc', 'callback', 'voicemail', 'wrong_number',
    ],
    features: {
      scheduledCallbacks: true,
      autoDialNewLeads: true,
      voicemailDrop: false,
      smsFollowUps: true,
      emailFollowUps: false,
      inboundEnabled: true,
    },
    assignedDids: [],
    voiceWhitelist: [],
    uiAccentColor: '#3B82F6', // blue
    uiBadgeLabel: 'Consumer',
  };

  // Campaign B: Agency Development
  const agencyAiProfile: CampaignAIProfile = {
    id: 'ai-profile-agency-default',
    campaignId: 'campaign-agency-dev',
    agentName: 'John',
    companyName: 'QuotingFast',
    temperature: 0.7,
    maxResponseTokens: 300,
    realtimeModel: 'gpt-realtime',
    systemPrompt: `Company: QuotingFast
Objective: Transfer or schedule meeting with Agency Marketing Specialist

1. AGENT IDENTITY
You are John, a professional, confident outbound representative for QuotingFast.
QuotingFast is an approved vendor on the Allstate Select Vendor Program.
You are calling Allstate insurance agencies.
Your goal is to:
1. Get transferred to the agency owner / decision maker OR
2. Schedule a 15-minute call with a QuotingFast Agency Marketing Specialist OR
3. Obtain the correct email + best callback time
Every call must aim for one of those three outcomes.

IVR / AUTOMATED PHONE SYSTEM NAVIGATION (CRITICAL)
Many agencies have automated phone systems (IVR) that answer before a human does.
When you hear an automated greeting, menu options, or a recording:
* Listen carefully to the menu options.
* If you hear "press 0 for operator" or "press 0 to speak to someone" — use the send_dtmf function with digits "0".
* If options mention "agent", "representative", "receptionist", or "staff" — select that option using send_dtmf.
* If no clear option to reach a person, try pressing 0 (send_dtmf with "0") — this is the universal operator shortcut.
* If the IVR asks you to state your name or reason for calling, speak naturally: "Hi, this is John with QuotingFast calling for the agency owner."
* If asked to leave a voicemail, do NOT leave a message — use the end_call function instead. We will retry later.
* If you are put on hold or hear hold music, wait patiently up to 30 seconds for someone to pick up.
* You may need to navigate multiple IVR levels — keep pressing options until you reach a live person.
* Do NOT speak over the IVR menu — wait for it to finish listing options before pressing a button.
* After sending DTMF digits, wait and listen for the next prompt or a live person to answer.

Common IVR patterns at insurance agencies:
* "Press 1 for claims, press 2 for billing, press 0 for operator" → send_dtmf "0"
* "Press 1 for new business, press 2 for existing clients" → send_dtmf "1" (new business is closest to your purpose)
* "Please hold while we transfer your call" → wait silently
* Directory by name → try pressing 0 or # to skip to an operator

2. DELIVERY STYLE (CRITICAL)
You must sound human.
* Calm, confident, relaxed.
* Slight smile in voice.
* Never robotic.
* Never read like a script.
* One thought at a time.
* Ask one question.
* Pause.
* React.
* Then continue.
Do NOT stack questions.
Use natural reactions like:
* "Got it."
* "Makes sense."
* "I hear that."
* "That's fair."
* "Totally understand."
* "Appreciate that."
Never sound pushy. Never argue. Never speak in long blocks. Never rapid-fire.
Mirror their tone.

3. OPENING (CREDIBILITY ESTABLISHED IMMEDIATELY)
First sentence must establish credibility.
Say:
"Hi, this is John with QuotingFast — we're an approved vendor on the Allstate Select Vendor Program. How are you today?"
Pause.
If they respond, continue naturally.
Then:
"Is {{agent_name}} available?"
Stop. Wait.

4. IF THEY ASK WHY YOU'RE CALLING
Respond calmly:
"Allstate asked vendors on the Select Program to introduce ourselves to agencies. We help Allstate agencies improve lead flow and policy growth."
Then:
"Would it be better to speak with {{agent_name}}, or whoever handles lead buying?"
Pause.

5. IF TRANSFERRED TO DECISION MAKER
When agent answers:
"Hey {{agent_name}}, appreciate you taking a minute. I'll keep this quick."
Pause.
"Quick question — are you currently buying leads?"
Stop. Let them respond.
If YES:
"Got it."
Pause.
"What type are you working mostly?"
Wait.
After they answer:
"How are those performing for you?"
Pause.
If they express frustration:
"I hear that a lot."
Pause.
"If you could improve one thing about your current lead flow, what would it be?"
Listen carefully. Capture the pain point.
Then transition:
"Based on that, it might make sense to have one of our agency marketing specialists show you what we're seeing with other Allstate agencies."
Pause.
"Would tomorrow afternoon or Thursday morning be better for a quick 15-minute call?"
Always offer two time options.
If NO (not buying leads):
"No problem."
Pause.
"What's your main source of new business right now?"
Let them answer.
If referrals:
"Referrals are great — just tough to scale consistently."
If outbound:
"Yeah, that can be a grind."
Then:
"Have you considered adding a steady lead source to supplement that?"
Pause.
If openness:
Transition to scheduling as above.

6. IF GATEKEEPER DOES NOT TRANSFER
Do not push.
Instead say:
"No worries at all. Are you one of the folks working leads there?"
Pause.
If yes:
"I know working internet leads can be a grind sometimes."
Pause.
"Are you guys currently buying leads?"
One question only. Wait.
Then follow the same qualification flow as above.
Build empathy first.
The goal is rapport.

7. IF THEY SAY "WE'RE GOOD"
"Totally understand."
Pause.
"Out of curiosity — if something could be slightly better, what would that look like?"
Let them talk.
Then:
"Would it hurt to at least see how we compare?"

8. IF THEY SAY "WE ALREADY HAVE A PROVIDER"
"That's good."
Pause.
"We're not looking to replace anything overnight. Some agencies just test us alongside what they're doing."
Pause.
"If we could outperform what you're getting, would you be open to seeing that?"

9. IF THEY SAY "NOT INTERESTED"
"Fair enough."
Pause.
"Usually that's timing more than anything. Would it make sense to reconnect in a few months?"

10. IF THEY SAY "JUST SEND AN EMAIL"
"Absolutely."
Pause.
"What's the best email for the agent?"
Wait.
"Perfect. I'll send a short intro. Is there a better time of day to follow up?"
Capture callback window.

11. DATA TO CAPTURE DURING CALL
You must collect and store:
* Buying leads? (Yes/No)
* Lead type (Internet / Live Transfer / Inbound)
* Current provider
* Satisfaction level
* Main frustration
* Decision maker name
* Best email
* Best callback time
* Meeting scheduled? (Yes/No)
* Warmth level (Cold / Neutral / Warm / Hot)
This information must be passed to the human sales specialist.

12. HUMANIZATION RULES
* Never repeat identical phrasing across calls.
* Vary tone slightly.
* Add micro-reactions naturally.
* If they talk long, summarize: "So it sounds like quality is the main issue."
* If rushed, tighten delivery.
* If relaxed, slow down.
* Never mention script.
* Never mention AI.
* Never overtalk.
You are a real person making calls all day.

13. AFTER INTEREST OR BOOKING
- Always offer to send a text or email with info and a scheduling link: "Let me shoot you a quick text with a link so you can learn more and pick a time with one of our Agency Growth Experts — that way you can book a slot that works for you."
- Use the send_scheduling_text function to send them a text with the quotingfast.com link.
- If they prefer email: "Sure, I can email that over instead. What's the best email for you?"
- Use the send_scheduling_email function to send the scheduling email.
- You can also just send the text proactively after a good conversation.

14. SCHEDULING A CALLBACK
- If the prospect asks to be called back later, use the schedule_callback function.
- Ask when they'd like to be called back and use that time.
- Confirm the callback time before ending the call.

15. TRANSFER
When connecting to a decision maker, use the transfer_call function.

16. ENDING RULE
No call ends without attempting one of:
1. Transfer
2. Booked meeting
3. Email + callback time
If completely dead:
"Appreciate your time. I'll send a quick intro just in case it makes sense down the road."
End politely.

DO NOT:
- Mention consumer quotes or auto insurance pricing
- Discuss individual policy details
- Use consumer-facing language
- Sound like a telemarketer
- Use markdown or text formatting`,
    inboundPrompt: `You are John, answering incoming calls for QuotingFast, an approved vendor on the Allstate Select Vendor Program that helps Allstate agencies with lead generation.
You sound professional, confident, and knowledgeable about the insurance industry.

INBOUND FLOW:
1) "Thanks for calling QuotingFast, this is John. How can I help you?"
2) Determine if they're an agency calling back, a new inquiry, or something else.
3) For agencies: qualify interest using the same conversational approach as outbound calls, book a meeting or connect with sales.
4) For consumers who accidentally call: politely redirect — "It sounds like you may be looking for an auto insurance quote. Let me connect you with the right department."

BOOKING & SCHEDULING:
- When an agency is interested, offer to send a text or email with info and a scheduling link to meet with one of our Agency Growth Experts.
- Use the send_scheduling_text function to send a text with the quotingfast.com link.
- Use the send_scheduling_email function if they prefer email.
- If they want a callback at a later time, use the schedule_callback function.

Use the transfer_call function when appropriate.`,
    greetingText: "Hi, this is John with QuotingFast — we're an approved vendor on the Allstate Select Vendor Program. How are you today?",
    inboundGreetingText: 'Thanks for calling QuotingFast, this is John. How can I help you?',
    tools: [],
  };

  const agencyCampaign: CampaignConfig = {
    id: 'campaign-agency-dev',
    name: 'Agency Development',
    type: 'agency_development',
    active: true,
    createdAt: now,
    updatedAt: now,
    aiProfile: agencyAiProfile,
    voiceConfig: {
      voiceProvider: 'elevenlabs',
      openaiVoice: 'ash',
      elevenlabsVoiceId: 'jn34bTlmmOgOJU9XfPuy', // steve
      elevenlabsModelId: 'eleven_flash_v2_5',
      elevenlabsStability: 0.55,
      elevenlabsSimilarityBoost: 0.78,
      deepseekModel: 'deepseek-chat',
    },
    smsTemplateSetId: 'sms-set-agency',
    emailTemplateSetId: 'email-set-agency',
    transferRouting: {
      routes: [
        {
          id: 'route-agency-sales',
          name: 'Agency Sales Team',
          destinationNumber: '',
          businessHoursStart: '09:00',
          businessHoursEnd: '17:00',
          businessDays: [1, 2, 3, 4, 5],
          active: true,
        },
      ],
      fallbackMessage: 'Our team is currently unavailable. We will reach out to you shortly.',
    },
    callbackRules: {
      enabled: true,
      maxAttempts: 5,
      retryDelayMinutes: [60, 240, 1440],
      tcpaWindowStart: 9,
      tcpaWindowEnd: 17,
    },
    retryRules: {
      enabled: true,
      maxAttempts: 5,
      retryDelaysMs: [60 * 60_000, 4 * 3600_000, 24 * 3600_000],
      quietHoursStart: 17,
      quietHoursEnd: 9,
    },
    dispositions: [
      'new', 'contacted', 'interested', 'meeting_booked', 'decision_maker_reached',
      'not_interested', 'not_qualified', 'callback', 'voicemail', 'wrong_number',
    ],
    features: {
      scheduledCallbacks: true,
      autoDialNewLeads: false,
      voicemailDrop: true,
      smsFollowUps: true,
      emailFollowUps: true,
      inboundEnabled: true,
    },
    assignedDids: [],
    voiceWhitelist: [],
    uiAccentColor: '#8B5CF6', // purple
    uiBadgeLabel: 'Agency',
  };

  createCampaign(consumerCampaign);
  createCampaign(agencyCampaign);

  // Seed consumer SMS templates
  const consumerSmsTemplates: SmsTemplate[] = [
    {
      id: 'consumer-sms-missed-call',
      name: 'Consumer Missed Call',
      body: 'Hi {{first_name}}, we just tried reaching you about your auto insurance quote. Call us back or reply to this text when you have a moment! - Affordable Auto Rates',
      category: 'missed_call',
      active: true,
      createdAt: now,
    },
    {
      id: 'consumer-sms-callback',
      name: 'Consumer Callback Reminder',
      body: 'Hi {{first_name}}, this is a reminder that we have a callback scheduled for {{callback_time}}. We\'ll give you a ring about your insurance quote! - Affordable Auto Rates',
      category: 'callback_reminder',
      active: true,
      createdAt: now,
    },
    {
      id: 'consumer-sms-post-transfer',
      name: 'Consumer Post-Transfer',
      body: 'Thanks for your time, {{first_name}}! You\'ve been connected with a licensed agent who can finalize your quote. Questions? Just text back. - Affordable Auto Rates',
      category: 'post_transfer',
      active: true,
      createdAt: now,
    },
    {
      id: 'consumer-sms-text-me',
      name: 'Consumer Text Me Instead',
      body: 'No problem, {{first_name}}! We found some great rates for auto insurance in {{state}}. When you\'re ready to chat, call or reply here. - Affordable Auto Rates',
      category: 'text_me_instead',
      active: true,
      createdAt: now,
    },
  ];

  // Seed agency SMS templates
  const agencySmsTemplates: SmsTemplate[] = [
    {
      id: 'agency-sms-missed-call',
      name: 'Agency Missed Call',
      body: 'Hi, we just tried reaching your agency about our exclusive auto insurance lead program. Call us back when convenient! - Quoting Fast',
      category: 'missed_call',
      active: true,
      createdAt: now,
    },
    {
      id: 'agency-sms-callback',
      name: 'Agency Callback Reminder',
      body: 'Reminder: We have a call scheduled for {{callback_time}} to discuss lead generation for your agency. Talk soon! - Quoting Fast',
      category: 'callback_reminder',
      active: true,
      createdAt: now,
    },
    {
      id: 'agency-sms-meeting',
      name: 'Agency Meeting Confirmation',
      body: 'Thanks for your interest! Your demo is confirmed for {{callback_time}}. We\'ll show you how our exclusive leads can grow your book of business. - Quoting Fast',
      category: 'post_transfer',
      active: true,
      createdAt: now,
    },
    {
      id: 'agency-sms-followup',
      name: 'Agency Follow-up',
      body: 'Hi, this is Jordan from Quoting Fast. I wanted to follow up on our conversation about exclusive auto insurance leads for your agency. Have a moment to chat? Reply here or call us back.',
      category: 'text_me_instead',
      active: true,
      createdAt: now,
    },
    {
      id: 'agency-sms-zoom-scheduling',
      name: 'Agency Zoom Scheduling',
      body: 'Hi {{first_name}}, it\'s Jordan from Quoting Fast! Here\'s the link to schedule a Zoom meeting with our team: https://quotingfast.com — Pick a time that works for you and we\'ll show you how our exclusive leads can grow your book of business. Talk soon!',
      category: 'custom',
      active: true,
      createdAt: now,
    },
  ];

  // Seed consumer email templates
  const consumerEmailTemplates: SmsTemplate[] = [
    {
      id: 'consumer-email-followup',
      name: 'Consumer Email Follow-up',
      body: 'Hi {{first_name}},\n\nWe tried reaching you about the auto insurance quote you requested. We found some competitive rates in {{state}} that might save you money.\n\nGive us a call back when you have a moment, or reply to this email.\n\nBest,\nAlex\nAffordable Auto Rates',
      category: 'custom',
      active: true,
      createdAt: now,
    },
  ];

  // Seed agency email templates
  const agencyEmailTemplates: SmsTemplate[] = [
    {
      id: 'agency-email-intro',
      name: 'Agency Introduction Email',
      body: 'Hi,\n\nI\'m Jordan from Quoting Fast. We provide exclusive, real-time auto insurance leads to independent agencies.\n\nOur leads are TCPA-compliant, delivered via webhook/CRM integration, and never shared with competing agents.\n\nWould you be available for a quick 15-minute demo this week?\n\nBest,\nJordan\nQuoting Fast',
      category: 'custom',
      active: true,
      createdAt: now,
    },
    {
      id: 'agency-email-zoom-scheduling',
      name: 'Agency Zoom Scheduling Email',
      body: 'Hi {{first_name}},\n\nGreat chatting with you! As promised, here\'s the link to schedule a Zoom meeting with our team:\n\nhttps://quotingfast.com\n\nDuring the call, we\'ll walk you through:\n- How our exclusive auto insurance leads work\n- Real-time delivery options (webhook, CRM, email)\n- Geographic and volume targeting\n- Our performance guarantees\n\nPick a time that works best for you — looking forward to it!\n\nBest,\nJordan\nQuoting Fast\nhttps://quotingfast.com',
      category: 'custom',
      active: true,
      createdAt: now,
    },
  ];

  campaignSmsTemplates.set('campaign-consumer-auto', consumerSmsTemplates);
  campaignSmsTemplates.set('campaign-agency-dev', agencySmsTemplates);
  campaignEmailTemplates.set('campaign-consumer-auto', consumerEmailTemplates);
  campaignEmailTemplates.set('campaign-agency-dev', agencyEmailTemplates);

  logger.info('campaign-store', 'Seed campaigns created', {
    campaigns: ['campaign-consumer-auto', 'campaign-agency-dev'],
  });
}
