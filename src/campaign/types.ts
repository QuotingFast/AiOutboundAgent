// ── Campaign Types ─────────────────────────────────────────────────
// Hard-isolated campaign type definitions.
// Every lead, call, SMS, email, and callback MUST be tied to exactly one campaign_id.

export type CampaignType = 'consumer_auto_insurance' | 'agency_development';

export interface CampaignConfig {
  id: string;
  name: string;
  type: CampaignType;
  active: boolean;
  createdAt: string;
  updatedAt: string;

  // AI Agent Profile
  aiProfile: CampaignAIProfile;

  // Voice
  voiceConfig: CampaignVoiceConfig;

  // Messaging
  smsTemplateSetId: string;
  emailTemplateSetId: string;

  // Routing & Transfer
  transferRouting: CampaignTransferRouting;

  // Callback rules
  callbackRules: CampaignCallbackRules;

  // Retry rules
  retryRules: CampaignRetryRules;

  // Dispositions
  dispositions: string[];

  // Feature toggles
  features: CampaignFeatures;

  // Twilio DIDs assigned to this campaign
  assignedDids: string[];

  // Voice whitelist (empty = all voices allowed)
  voiceWhitelist: string[];

  // Color accent for UI
  uiAccentColor: string;
  uiBadgeLabel: string;
}

export interface CampaignAIProfile {
  id: string;
  campaignId: string;
  systemPrompt: string;
  inboundPrompt: string;
  greetingText: string;
  inboundGreetingText: string;
  agentName: string;
  companyName: string;
  temperature: number;
  maxResponseTokens: number;
  realtimeModel: string;
  tools: any[];
}

export interface CampaignVoiceConfig {
  voiceProvider: 'openai' | 'elevenlabs' | 'deepseek';
  openaiVoice: string;
  elevenlabsVoiceId: string;
  elevenlabsModelId: string;
  elevenlabsStability: number;
  elevenlabsSimilarityBoost: number;
  elevenlabsStyle: number;
  elevenlabsUseSpeakerBoost: boolean;
  elevenlabsSpeed: number;
  deepseekModel: string;
}

export interface CampaignTransferRouting {
  routes: TransferRoute[];
  fallbackMessage: string;
}

export interface TransferRoute {
  id: string;
  name: string;
  destinationNumber: string;
  businessHoursStart: string; // HH:MM
  businessHoursEnd: string;   // HH:MM
  businessDays: number[];     // 0=Sun, 1=Mon, ... 6=Sat
  active: boolean;
}

export interface CampaignCallbackRules {
  enabled: boolean;
  maxAttempts: number;
  retryDelayMinutes: number[];
  tcpaWindowStart: number; // Hour (8)
  tcpaWindowEnd: number;   // Hour (21)
}

export interface CampaignRetryRules {
  enabled: boolean;
  maxAttempts: number;
  retryDelaysMs: number[];
  quietHoursStart: number; // Hour
  quietHoursEnd: number;   // Hour
}

export interface CampaignFeatures {
  scheduledCallbacks: boolean;
  autoDialNewLeads: boolean;
  voicemailDrop: boolean;
  smsFollowUps: boolean;
  emailFollowUps: boolean;
  inboundEnabled: boolean;
}

// ── CampaignContext ────────────────────────────────────────────────
// REQUIRED for all call/message flows. If missing or invalid, the system MUST fail closed.

export interface CampaignContext {
  campaignId: string;
  campaignType: CampaignType;
  campaignName: string;
  aiProfileId: string;
  voiceId: string;
  voiceProvider: 'openai' | 'elevenlabs' | 'deepseek';
  smsTemplateSetId: string;
  emailTemplateSetId: string;
  transferRouting: CampaignTransferRouting;
  callbackRules: CampaignCallbackRules;
  retryRules: CampaignRetryRules;
  features: CampaignFeatures;
  resolvedVia: string; // How this context was resolved (for audit)
  resolvedAt: string;  // ISO timestamp
}

// ── Outbound Call Tracking ─────────────────────────────────────────
// Stored on every outbound attempt for callback resolution.

export interface OutboundCallRecord {
  callId: string;
  leadId: string | null;
  toPhone: string;
  fromDid: string;
  campaignId: string;
  aiProfileId: string;
  voiceId: string;
  messageProfileId: string;
  timestamp: string;
  status: string;
}

// ── Scheduled Callback (Campaign-Locked) ───────────────────────────

export interface CampaignScheduledCallback {
  id: string;
  leadId: string | null;
  phone: string;
  campaignId: string;
  aiProfileId: string;
  voiceId: string;
  requestedLocalDatetime: string;
  requestedTimezone: string;
  requestedDatetimeUtc: string;
  consentCapture: string;
  status: 'scheduled' | 'processing' | 'completed' | 'failed' | 'canceled';
  createdAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  result: string | null;
}

// ── Enforcement Log Entry ──────────────────────────────────────────

export interface EnforcementLogEntry {
  timestamp: string;
  eventType: string;
  phone: string | null;
  leadId: string | null;
  campaignId: string | null;
  aiProfileId: string | null;
  voiceId: string | null;
  action: string;
  allowed: boolean;
  reason: string;
  metadata?: Record<string, unknown>;
}

// ── DID Mapping ────────────────────────────────────────────────────

export interface DidMapping {
  did: string;         // The Twilio phone number
  campaignId: string;
}

// ── Feature Flags ──────────────────────────────────────────────────

export interface CampaignFeatureFlags {
  multi_campaign_mode: boolean;
  scheduled_callbacks: boolean;
  dynamic_voice_sync: boolean;
  hardened_campaign_isolation: boolean;
}
