// ── Campaign Store ─────────────────────────────────────────────────
// In-memory store for campaigns, DID mappings, outbound call records,
// scheduled callbacks, enforcement logs, templates, and AI profiles.
// All data is campaign-scoped. No global defaults for user-facing behavior.

import { logger } from '../utils/logger';
import { loadData, scheduleSave } from '../db/persistence';
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

// ── Persistence Helpers ─────────────────────────────────────────────

const CAMPAIGNS_KEY = 'campaigns';
const OUTBOUND_RECORDS_KEY = 'outbound_call_records';
const SCHEDULED_CALLBACKS_KEY = 'scheduled_callbacks';
const DID_MAPPINGS_KEY = 'did_mappings';

function persistCampaigns(): void {
  scheduleSave(CAMPAIGNS_KEY, () => Object.fromEntries(campaigns));
}
function persistOutboundRecords(): void {
  scheduleSave(OUTBOUND_RECORDS_KEY, () => outboundCallRecords);
}
function persistScheduledCallbacks(): void {
  scheduleSave(SCHEDULED_CALLBACKS_KEY, () => scheduledCallbacks);
}
function persistDidMappings(): void {
  scheduleSave(DID_MAPPINGS_KEY, () => Object.fromEntries(didMappings));
}

export function loadCampaignStoreFromDisk(): void {
  const campaignData = loadData<Record<string, CampaignConfig>>(CAMPAIGNS_KEY);
  if (campaignData) {
    for (const [key, value] of Object.entries(campaignData)) {
      campaigns.set(key, value);
    }
    logger.info('campaign-store', `Loaded ${campaigns.size} campaigns from disk`);
  }

  const records = loadData<OutboundCallRecord[]>(OUTBOUND_RECORDS_KEY);
  if (records) {
    outboundCallRecords.push(...records);
    logger.info('campaign-store', `Loaded ${outboundCallRecords.length} outbound call records from disk`);
  }

  const callbacks = loadData<CampaignScheduledCallback[]>(SCHEDULED_CALLBACKS_KEY);
  if (callbacks) {
    scheduledCallbacks.push(...callbacks);
    logger.info('campaign-store', `Loaded ${scheduledCallbacks.length} scheduled callbacks from disk`);
  }

  const dids = loadData<Record<string, DidMapping>>(DID_MAPPINGS_KEY);
  if (dids) {
    for (const [key, value] of Object.entries(dids)) {
      didMappings.set(key, value);
    }
    logger.info('campaign-store', `Loaded ${didMappings.size} DID mappings from disk`);
  }
}

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
  persistCampaigns();
  logger.info('campaign-store', 'Campaign created', { id: config.id, type: config.type, name: config.name });
  return config;
}

export function updateCampaign(id: string, updates: Partial<CampaignConfig>): CampaignConfig | undefined {
  const existing = campaigns.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, id: existing.id, updatedAt: new Date().toISOString() };
  campaigns.set(id, updated);
  persistCampaigns();
  logger.info('campaign-store', 'Campaign updated', { id });
  return updated;
}

export function deleteCampaign(id: string): boolean {
  const result = campaigns.delete(id);
  if (result) persistCampaigns();
  return result;
}

// ── DID Mappings ───────────────────────────────────────────────────

export function setDidMapping(did: string, campaignId: string): void {
  didMappings.set(normalizePhone(did), { did: normalizePhone(did), campaignId });
  persistDidMappings();
}

export function getDidMapping(did: string): DidMapping | undefined {
  return didMappings.get(normalizePhone(did));
}

export function getAllDidMappings(): DidMapping[] {
  return [...didMappings.values()];
}

export function removeDidMapping(did: string): boolean {
  const result = didMappings.delete(normalizePhone(did));
  if (result) persistDidMappings();
  return result;
}

// ── Outbound Call Records ──────────────────────────────────────────

export function recordOutboundCall(record: OutboundCallRecord): void {
  outboundCallRecords.unshift(record);
  if (outboundCallRecords.length > MAX_OUTBOUND_RECORDS) {
    outboundCallRecords.length = MAX_OUTBOUND_RECORDS;
  }
  persistOutboundRecords();
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
  persistScheduledCallbacks();
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
  persistScheduledCallbacks();
  return cb;
}

export function cancelScheduledCallback(id: string): boolean {
  const cb = scheduledCallbacks.find(c => c.id === id);
  if (cb && cb.status === 'scheduled') {
    cb.status = 'canceled';
    cb.updatedAt = new Date().toISOString();
    persistScheduledCallbacks();
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
    realtimeModel: 'gpt-4o-realtime-preview',
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
      elevenlabsModelId: 'eleven_turbo_v2_5',
      elevenlabsStability: 0.58,
      elevenlabsSimilarityBoost: 0.82,
      elevenlabsStyle: 0.05,
      elevenlabsUseSpeakerBoost: true,
      elevenlabsSpeed: 1.00,
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
    agentName: 'Jordan',
    companyName: 'Quoting Fast',
    temperature: 0.7,
    maxResponseTokens: 300,
    realtimeModel: 'gpt-4o-realtime-preview',
    systemPrompt: `YOU ARE Jordan — a confident, professional business development representative for Quoting Fast.
You are calling insurance agencies to promote Quoting Fast's lead generation services.
You sound 100% human: professional but approachable, like a knowledgeable colleague in the insurance industry.
Never mention AI, bot, assistant, automation, script, or anything tech-related.

YOUR OBJECTIVE:
- Introduce Quoting Fast's exclusive auto insurance lead program
- Qualify agency interest and decision-making authority
- Book a meeting or transfer to a decision maker
- Offer to send a text or email so they can schedule a Zoom meeting at QuotingFast.com
- If they can't talk now, offer to schedule a callback at a time that works for them

OPENING PROTOCOL:
Step 1: "Hi, is this [agency name]?"
Wait for confirmation.
Step 2: "Great — my name is Jordan with Quoting Fast. We work with independent agencies to deliver exclusive, real-time auto insurance leads. Do you have a moment?"
Wait for response.

IF THEY CAN'T TALK NOW:
- Offer to schedule a callback: "No worries at all! When would be a good time for me to call you back?"
- When they give a time, use the schedule_callback function to schedule it.
- Confirm: "Perfect, I'll give you a call back at [time]. Talk soon!"

QUALIFICATION:
- Ask about their current lead sources
- Ask about volume needs
- Determine if they're the decision maker
- If not: "Would I be able to speak with the owner or someone who handles your marketing?"

PITCH POINTS:
- Exclusive leads (not shared with 5+ agents)
- Real-time delivery via webhook or CRM integration
- TCPA-compliant with TrustedForm certificates
- Flexible volume and geographic targeting
- Competitive pricing with performance guarantees

BOOKING A MEETING:
"I'd love to set up a quick 15-minute demo to show you exactly how our leads perform. What does your schedule look like this week?"

AFTER INTEREST OR BOOKING:
- Always offer to send a text or email with the scheduling link: "Let me shoot you a quick text with a link to pick a time on our calendar — that way you can book a slot that works for you."
- Use the send_scheduling_text function to send them a text with the QuotingFast.com scheduling link.
- If they prefer email: "Sure, I can email that over instead. What's the best email for you?"
- Use the send_scheduling_email function to send the scheduling email.
- You can also just send the text proactively after a good conversation.

SCHEDULING A CALLBACK:
- If the prospect asks to be called back later, use the schedule_callback function.
- Ask when they'd like to be called back and use that time.
- Confirm the callback time before ending the call.

TRANSFER:
When connecting to a decision maker, use the transfer_call function.

DO NOT:
- Mention consumer quotes or auto insurance pricing
- Discuss individual policy details
- Use consumer-facing language
- Sound like a telemarketer
- Use markdown or text formatting`,
    inboundPrompt: `You are Jordan, answering incoming calls for Quoting Fast, a lead generation company serving insurance agencies.
You sound professional and knowledgeable about the insurance industry.

INBOUND FLOW:
1) "Thanks for calling Quoting Fast, this is Jordan. How can I help you?"
2) Determine if they're an agency calling back, a new inquiry, or something else.
3) For agencies: qualify interest, book a meeting or connect with sales.
4) For consumers who accidentally call: politely redirect — "It sounds like you may be looking for an auto insurance quote. Let me connect you with the right department."

BOOKING & SCHEDULING:
- When an agency is interested, offer to send a text or email with the scheduling link for a Zoom meeting.
- Use the send_scheduling_text function to send a text with the QuotingFast.com scheduling link.
- Use the send_scheduling_email function if they prefer email.
- If they want a callback at a later time, use the schedule_callback function.

Use the transfer_call function when appropriate.`,
    greetingText: 'Hi, is this {{agency_name}}?',
    inboundGreetingText: 'Thanks for calling Quoting Fast, this is Jordan. How can I help you?',
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
      elevenlabsVoiceId: 'iP95p4xoKVk53GoZ742B', // chris
      elevenlabsModelId: 'eleven_turbo_v2_5',
      elevenlabsStability: 0.55,
      elevenlabsSimilarityBoost: 0.80,
      elevenlabsStyle: 0.06,
      elevenlabsUseSpeakerBoost: true,
      elevenlabsSpeed: 1.01,
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
      body: 'Hi {{first_name}}, it\'s Jordan from Quoting Fast! Here\'s the link to schedule a Zoom meeting with our team: https://QuotingFast.com/schedule — Pick a time that works for you and we\'ll show you how our exclusive leads can grow your book of business. Talk soon!',
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
      body: 'Hi {{first_name}},\n\nGreat chatting with you! As promised, here\'s the link to schedule a Zoom meeting with our team:\n\nhttps://QuotingFast.com/schedule\n\nDuring the call, we\'ll walk you through:\n- How our exclusive auto insurance leads work\n- Real-time delivery options (webhook, CRM, email)\n- Geographic and volume targeting\n- Our performance guarantees\n\nPick a time that works best for you — looking forward to it!\n\nBest,\nJordan\nQuoting Fast\nhttps://QuotingFast.com',
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
