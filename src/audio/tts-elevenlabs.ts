import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Stream TTS audio from ElevenLabs in ulaw_8000 format.
 * Returns an async generator yielding Buffer chunks ready for Twilio.
 */
export async function* streamTTS(text: string): AsyncGenerator<Buffer> {
  if (!config.elevenlabs.apiKey || !config.elevenlabs.voiceId) {
    throw new Error('ElevenLabs API key and voice ID are required when TTS_PROVIDER=elevenlabs');
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs.voiceId}/stream?output_format=ulaw_8000`;

  logger.info('tts-elevenlabs', 'Requesting TTS', { textLength: text.length, voiceId: config.elevenlabs.voiceId });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenlabs.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS error ${response.status}: ${body}`);
  }

  if (!response.body) {
    throw new Error('ElevenLabs returned no body');
  }

  const reader = response.body.getReader();
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.length;
      yield Buffer.from(value);
    }
  }

  logger.debug('tts-elevenlabs', 'TTS stream complete', { totalBytes });
}
