import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Stream TTS audio from OpenAI in PCM format, then convert to mulaw for Twilio.
 * Returns an async generator yielding Buffer chunks.
 */
export async function* streamTTS(text: string): AsyncGenerator<Buffer> {
  logger.debug('tts-openai', 'Requesting TTS', { textLength: text.length });

  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: text,
    response_format: 'pcm', // raw 24kHz 16-bit LE mono PCM
    speed: 1.0,
  });

  const arrayBuf = await response.arrayBuffer();
  const pcmBuffer = Buffer.from(arrayBuf);

  // Downsample from 24kHz 16-bit PCM to 8kHz mu-law
  const mulawBuffer = pcm16kToMulaw8k(pcmBuffer, 24000, 8000);
  logger.debug('tts-openai', 'TTS conversion complete', { pcmBytes: pcmBuffer.length, mulawBytes: mulawBuffer.length });

  // Yield in chunks of ~20ms (160 bytes at 8kHz mulaw)
  const chunkSize = 160;
  for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
    yield mulawBuffer.subarray(i, Math.min(i + chunkSize, mulawBuffer.length));
  }
}

function pcm16kToMulaw8k(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  const ratio = srcRate / dstRate;
  const srcSamples = pcm.length / 2; // 16-bit = 2 bytes per sample
  const dstSamples = Math.floor(srcSamples / ratio);
  const out = Buffer.alloc(dstSamples);

  for (let i = 0; i < dstSamples; i++) {
    const srcIdx = Math.floor(i * ratio);
    const sample = pcm.readInt16LE(srcIdx * 2);
    out[i] = linearToMulaw(sample);
  }
  return out;
}

function linearToMulaw(sample: number): number {
  const MULAW_BIAS = 33;
  const MULAW_MAX = 8159;

  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > MULAW_MAX) sample = MULAW_MAX;
  sample += MULAW_BIAS;

  let exponent = 7;
  const mask = 0x4000;
  for (; exponent > 0; exponent--) {
    if (sample & mask) break;
    sample <<= 1;
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const byte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return byte;
}
