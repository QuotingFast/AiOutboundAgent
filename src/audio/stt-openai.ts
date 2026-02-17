import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Whisper commonly hallucinates these phrases from noise/silence
const HALLUCINATION_PATTERNS = [
  /^you're welcome\.?$/i,
  /^thank you\.?$/i,
  /^thanks for watching\.?$/i,
  /^thanks for listening\.?$/i,
  /^bye\.?$/i,
  /^goodbye\.?$/i,
  /^the end\.?$/i,
  /^see you\.?$/i,
  /^please subscribe\.?$/i,
  /^like and subscribe\.?$/i,
  /^music$/i,
  /^music playing$/i,
  /^\[.*\]$/,        // [Music], [Applause], etc.
  /^\(.*\)$/,        // (music), (silence), etc.
  /^\.+$/,           // Just dots
  /^,+$/,            // Just commas
  /^\s*$/,           // Empty/whitespace
];

function isHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  return HALLUCINATION_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Transcribe a buffer of raw audio (mulaw 8000Hz mono) using OpenAI Whisper.
 * We convert the raw buffer to a WAV in-memory before sending.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  // Need at least ~400ms of audio for reliable transcription
  if (audioBuffer.length < 3200) {
    logger.debug('stt-openai', 'Audio too short, skipping', { bytes: audioBuffer.length });
    return '';
  }

  const wavBuffer = wrapMulawInWav(audioBuffer, 8000);

  try {
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: file as any,
      language: 'en',
      response_format: 'text',
      prompt: 'This is a phone conversation about auto insurance quotes.',
    });

    const text = typeof result === 'string' ? result : (result as { text?: string }).text || '';
    const trimmed = text.trim();

    if (isHallucination(trimmed)) {
      logger.info('stt-openai', 'Filtered hallucination', { text: trimmed, bytes: audioBuffer.length });
      return '';
    }

    logger.info('stt-openai', 'Transcription', { text: trimmed, bytes: audioBuffer.length });
    return trimmed;
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
