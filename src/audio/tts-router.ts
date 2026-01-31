import { config } from '../config';

export async function* streamTTS(text: string): AsyncGenerator<Buffer> {
  if (config.ttsProvider === 'openai') {
    const { streamTTS: openaiTTS } = await import('./tts-openai');
    yield* openaiTTS(text);
  } else {
    const { streamTTS: elevenTTS } = await import('./tts-elevenlabs');
    yield* elevenTTS(text);
  }
}
