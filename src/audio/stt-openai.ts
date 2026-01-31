import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Transcribe a buffer of raw audio (mulaw 8000Hz mono) using OpenAI Whisper.
 * We convert the raw buffer to a WAV in-memory before sending.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  if (audioBuffer.length < 1600) {
    // Less than ~100ms of audio at 8kHz — skip
    return '';
  }

  const wavBuffer = wrapMulawInWav(audioBuffer, 8000);

  try {
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'en',
      response_format: 'text',
    });

    const text = typeof result === 'string' ? result : (result as { text?: string }).text || '';
    logger.debug('stt-openai', 'Transcription result', { length: audioBuffer.length, text });
    return text.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('stt-openai', 'Transcription failed', { error: msg });
    return '';
  }
}

/**
 * Wrap raw mu-law audio bytes in a minimal WAV header.
 */
function wrapMulawInWav(raw: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = raw.length;
  const fileSize = 36 + dataSize;

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);

  // fmt chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);         // chunk size
  header.writeUInt16LE(7, 20);          // format: mu-law
  header.writeUInt16LE(1, 22);          // channels: mono
  header.writeUInt32LE(sampleRate, 24); // sample rate
  header.writeUInt32LE(sampleRate, 28); // byte rate (1 byte per sample for mulaw)
  header.writeUInt16LE(1, 32);          // block align
  header.writeUInt16LE(8, 34);          // bits per sample

  // data chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, raw]);
}
