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
    smsFromNumber: optional('TWILIO_SMS_FROM_NUMBER', '+18445117954'),
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

  deepseek: {
    apiKey: optional('DEEPSEEK_API_KEY', ''),
    model: optional('DEEPSEEK_MODEL', 'deepseek-chat'),
  },

  sendgrid: {
    apiKey: optional('SENDGRID_API_KEY', ''),
  },

  notifications: {
    ownerPhone: optional('NOTIFICATION_PHONE', '+19547905093'),
    ownerEmail: optional('NOTIFICATION_EMAIL', 'info@quotingfast.com'),
    senderEmail: optional('NOTIFICATION_SENDER_EMAIL', 'notifications@quotingfast.com'),
  },

  ttsProvider: optional('TTS_PROVIDER', 'elevenlabs') as 'openai' | 'elevenlabs' | 'deepseek',
  sttProvider: optional('STT_PROVIDER', 'openai') as 'openai' | 'deepgram',

  recording: {
    enabled: optional('RECORDING_ENABLED', 'true') === 'true',
    channels: parseInt(optional('RECORDING_CHANNELS', '2'), 10) as 1 | 2,
  },

  debug: optional('DEBUG', 'false') === 'true',
};
