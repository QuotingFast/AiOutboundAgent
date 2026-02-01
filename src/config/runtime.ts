import { config } from './index';

export interface RuntimeSettings {
  // Voice & Model
  voice: string;
  realtimeModel: string;
  temperature: number;

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

  // Transfer numbers
  allstateNumber: string;
  nonAllstateNumber: string;

  // Test call defaults
  defaultFromNumber: string;
  defaultToNumber: string;
}

const settings: RuntimeSettings = {
  voice: config.openai.voice,
  realtimeModel: config.openai.realtimeModel,
  temperature: 0.7,
  vadThreshold: 0.75,
  silenceDurationMs: 700,
  prefixPaddingMs: 300,
  bargeInDebounceMs: 250,
  echoSuppressionMs: 100,
  maxResponseTokens: 120,
  agentName: 'Sarah',
  companyName: 'QuotingFast',
  systemPromptOverride: '',
  allstateNumber: '',
  nonAllstateNumber: '',
  defaultFromNumber: config.twilio.fromNumber,
  defaultToNumber: '',
};

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
