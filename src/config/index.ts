import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  baseUrl: required('BASE_URL'),

  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    fromNumber: optional('TWILIO_FROM_NUMBER', ''),
  },

  openai: {
    apiKey: required('OPENAI_API_KEY'),
    model: optional('OPENAI_MODEL', 'gpt-4o'),
    realtimeModel: optional('OPENAI_REALTIME_MODEL', 'gpt-4o-realtime-preview'),
    voice: optional('OPENAI_VOICE', 'coral'),
  },

  elevenlabs: {
    apiKey: optional('ELEVENLABS_API_KEY', ''),
    voiceId: optional('ELEVENLABS_VOICE_ID', ''),
  },

  ttsProvider: optional('TTS_PROVIDER', 'elevenlabs') as 'openai' | 'elevenlabs',
  sttProvider: optional('STT_PROVIDER', 'openai') as 'openai' | 'deepgram',

  debug: optional('DEBUG', 'false') === 'true',
};
