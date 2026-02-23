import { config } from './index';
import { loadData, scheduleSave } from '../db/persistence';

export interface RuntimeSettings {
      // Voice provider: 'openai' = Realtime speech-to-speech, 'elevenlabs' = OpenAI LLM + EL TTS, 'deepseek' = DeepSeek LLM + EL TTS
  voiceProvider: 'openai' | 'elevenlabs' | 'deepseek';

  // Voice & Model (OpenAI)
  voice: string;
      realtimeModel: string;
      temperature: number;

  // ElevenLabs settings
  elevenlabsVoiceId: string;
      elevenlabsModelId: string;
      elevenlabsStability: number;
      elevenlabsSimilarityBoost: number;
      elevenlabsStyle: number;
      elevenlabsUseSpeakerBoost: boolean;
      elevenlabsSpeed: number;

  // DeepSeek settings
  deepseekModel: string;

  // VAD & Barge-in
  vadThreshold: number;
      silenceDurationMs: number;
      prefixPaddingMs: number;
      bargeInDebounceMs: number;
      echoSuppressionMs: number;

  // Response
  maxResponseTokens: number;

  // Agent persona
  agentName: string;
      companyName: string;

  // Full system prompt (empty = use default template)
  systemPromptOverride: string;

  // Inbound call prompt (empty = use default inbound template)
  inboundPromptOverride: string;

  // Whether inbound calls are enabled
  inboundEnabled: boolean;

  // Whether weblead auto-dial is enabled
  webleadAutoDialEnabled?: boolean;

  // TCPA time-of-day override (bypass 8am-9pm restriction when true)
  tcpaOverride: boolean;

  // Transfer numbers
  allstateNumber: string;
      nonAllstateNumber: string;

  // Test call defaults
  defaultFromNumber: string;
      defaultToNumber: string;

  // Background noise injection
  backgroundNoiseEnabled: boolean;
  backgroundNoiseVolume: number; // 0.0 - 1.0 (default 0.12 = 12%)

  // Voicemail / AMD detection
  amdEnabled: boolean;
  amdAction: 'hangup' | 'leave_message';
  amdMessage: string; // Pre-recorded message to leave on voicemail

  // Call duration limits
  maxCallDurationSec: number;     // 0 = unlimited
  callDurationWarnPct: number;    // Warn agent at this % of limit (default 80)

  // Silence (dead air) timeout — disconnect if no speech from either party for this many seconds
  silenceTimeoutSec: number;      // 0 = disabled, default 30

  // Call retry
  autoRetryEnabled: boolean;
  autoRetryMaxAttempts: number;

  // SMS
  smsEnabled: boolean;
  autoSmsOnMissedCall: boolean;
  autoSmsOnCallback: boolean;
  autoSmsOnTransfer: boolean;
  autoSmsOnTextRequest: boolean;

  // Per-phone rate limiting
  maxCallsPerPhonePerDay: number;  // 0 = unlimited

  // Auto-DNC on verbal request
  autoDncEnabled: boolean;

  // Retry delays (in minutes)
  retryDelay1Min: number;  // Default: 30 minutes
  retryDelay2Min: number;  // Default: 120 minutes (2 hours)
  retryDelay3Min: number;  // Default: 1440 minutes (24 hours)

  // Quality alerts
  qualityAlertsEnabled: boolean;
  latencyAlertThresholdMs: number;  // Default: 2000

  // Daily report
  dailyReportEnabled: boolean;
  dailyReportHour: number;  // 0-23, default: 18 (6PM)
}

export interface CallRecord {
      callSid: string;
      to: string;
      leadName: string;
      timestamp: string;
      settings: {
        voiceProvider: string;
        voice: string;
        realtimeModel: string;
        temperature: number;
        vadThreshold: number;
        silenceDurationMs: number;
        prefixPaddingMs: number;
        bargeInDebounceMs: number;
        echoSuppressionMs: number;
        maxResponseTokens: number;
        agentName: string;
      };
}

const settings: RuntimeSettings = {
      voiceProvider: config.ttsProvider as 'openai' | 'elevenlabs' | 'deepseek',
      voice: config.openai.voice,
      realtimeModel: config.openai.realtimeModel,
      temperature: 0.8,
      elevenlabsVoiceId: config.elevenlabs.voiceId,
      elevenlabsModelId: 'eleven_turbo_v2_5',
      elevenlabsStability: 0.50,
      elevenlabsSimilarityBoost: 0.78,
      elevenlabsStyle: 0.07,
      elevenlabsUseSpeakerBoost: true,
      elevenlabsSpeed: 1.00,
      deepseekModel: config.deepseek.model || 'deepseek-chat',
      vadThreshold: 0.9,
      silenceDurationMs: 950,
      prefixPaddingMs: 300,
      bargeInDebounceMs: 350,
      echoSuppressionMs: 200,
      maxResponseTokens: 275,
      agentName: 'Alex',
      companyName: 'Affordable Auto Rates',
      systemPromptOverride: '',
      inboundPromptOverride: '',
      inboundEnabled: true,
      webleadAutoDialEnabled: true,
      tcpaOverride: false,
      allstateNumber: '',
      nonAllstateNumber: '',
      defaultFromNumber: config.twilio.fromNumber,
      defaultToNumber: '',

      // Background noise
      backgroundNoiseEnabled: false,
      backgroundNoiseVolume: 0.12,

      // AMD / Voicemail detection
      amdEnabled: false,
      amdAction: 'hangup',
      amdMessage: 'Hi, this is {{agent_name}} from {{company_name}}. We were calling about your auto insurance quote. Please call us back at your convenience. Thank you!',

      // Call duration limits
      maxCallDurationSec: 180,
      callDurationWarnPct: 80,

      // Silence (dead air) timeout
      silenceTimeoutSec: 30,

      // Call retry
      autoRetryEnabled: false,
      autoRetryMaxAttempts: 3,

      // SMS
      smsEnabled: false,
      autoSmsOnMissedCall: true,
      autoSmsOnCallback: true,
      autoSmsOnTransfer: true,
      autoSmsOnTextRequest: true,

      // Per-phone rate limiting
      maxCallsPerPhonePerDay: 3,

      // Auto-DNC
      autoDncEnabled: true,

      // Retry delays (minutes)
      retryDelay1Min: 30,
      retryDelay2Min: 120,
      retryDelay3Min: 1440,

      // Quality alerts
      qualityAlertsEnabled: true,
      latencyAlertThresholdMs: 2000,

      // Daily report
      dailyReportEnabled: false,
      dailyReportHour: 18,
};

// Keep last 20 calls
const callHistory: CallRecord[] = [];
const MAX_HISTORY = 20;

const CALL_HISTORY_KEY = 'call_history';
const SETTINGS_KEY = 'settings';

function persistCallHistory(): void {
  scheduleSave(CALL_HISTORY_KEY, () => callHistory);
}

function persistSettings(): void {
  scheduleSave(SETTINGS_KEY, () => settings);
}

export function loadRuntimeFromDisk(): void {
  const savedHistory = loadData<CallRecord[]>(CALL_HISTORY_KEY);
  if (savedHistory) {
    callHistory.push(...savedHistory);
  }

  const savedSettings = loadData<Partial<RuntimeSettings>>(SETTINGS_KEY);
  if (savedSettings) {
    for (const [key, value] of Object.entries(savedSettings)) {
      if (key in settings) {
        (settings as any)[key] = value;
      }
    }
  }
}

export function getSettings(): RuntimeSettings {
      return { ...settings };
}

export function updateSettings(updates: Partial<RuntimeSettings>): RuntimeSettings {
      for (const [key, value] of Object.entries(updates)) {
              if (key in settings) {
                        (settings as any)[key] = value;
              }
      }
      persistSettings();
      return { ...settings };
}

export function recordCall(callSid: string, to: string, leadName: string): void {
      const s = getSettings();
      callHistory.unshift({
              callSid,
              to,
              leadName,
              timestamp: new Date().toISOString(),
              settings: {
                        voiceProvider: s.voiceProvider,
                        voice: s.voiceProvider === 'openai' ? s.voice : s.voiceProvider === 'deepseek' ? `deepseek+el:${s.elevenlabsVoiceId}` : `elevenlabs:${s.elevenlabsVoiceId}`,
                        realtimeModel: s.realtimeModel,
                        temperature: s.temperature,
                        vadThreshold: s.vadThreshold,
                        silenceDurationMs: s.silenceDurationMs,
                        prefixPaddingMs: s.prefixPaddingMs,
                        bargeInDebounceMs: s.bargeInDebounceMs,
                        echoSuppressionMs: s.echoSuppressionMs,
                        maxResponseTokens: s.maxResponseTokens,
                        agentName: s.agentName,
              },
      });
      if (callHistory.length > MAX_HISTORY) {
              callHistory.length = MAX_HISTORY;
      }
      persistCallHistory();
}

export function getCallHistory(): CallRecord[] {
      return [...callHistory];
}
