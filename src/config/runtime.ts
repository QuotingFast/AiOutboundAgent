import { config } from './index';

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
      elevenlabsStability: 0.62,
      elevenlabsSimilarityBoost: 0.82,
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
};

// Keep last 20 calls
const callHistory: CallRecord[] = [];
const MAX_HISTORY = 20;

export function getSettings(): RuntimeSettings {
      return { ...settings };
}

export function updateSettings(updates: Partial<RuntimeSettings>): RuntimeSettings {
      for (const [key, value] of Object.entries(updates)) {
              if (key in settings) {
                        (settings as any)[key] = value;
              }
      }
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
}

export function getCallHistory(): CallRecord[] {
      return [...callHistory];
}
