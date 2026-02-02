import { config } from './index';

export interface RuntimeSettings {
  // Voice provider: 'openai' = Realtime speech-to-speech, 'elevenlabs' = text-to-speech via ElevenLabs
  voiceProvider: 'openai' | 'elevenlabs';

  // Voice & Model (OpenAI)
  voice: string;
  realtimeModel: string;
  temperature: number;

  // ElevenLabs settings
  elevenlabsVoiceId: string;
  elevenlabsModelId: string;
  elevenlabsStability: number;
  elevenlabsSimilarityBoost: number;

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

  // Transfer numbers
  allstateNumber: string;
  nonAllstateNumber: string;

  // Test call defaults
  defaultFromNumber: string;
  defaultToNumber: string;
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
  voiceProvider: 'openai',
  voice: config.openai.voice,
  realtimeModel: config.openai.realtimeModel,
  temperature: 0.7,
  elevenlabsVoiceId: config.elevenlabs.voiceId,
  elevenlabsModelId: 'eleven_turbo_v2_5',
  elevenlabsStability: 0.5,
  elevenlabsSimilarityBoost: 0.75,
  vadThreshold: 0.75,
  silenceDurationMs: 700,
  prefixPaddingMs: 300,
  bargeInDebounceMs: 250,
  echoSuppressionMs: 100,
  maxResponseTokens: 120,
  agentName: 'Sarah',
  companyName: 'QuotingFast',
  systemPromptOverride: '',
  inboundPromptOverride: '',
  inboundEnabled: true,
  allstateNumber: '',
  nonAllstateNumber: '',
  defaultFromNumber: config.twilio.fromNumber,
  defaultToNumber: '',
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
      voice: s.voiceProvider === 'openai' ? s.voice : `elevenlabs:${s.elevenlabsVoiceId}`,
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
