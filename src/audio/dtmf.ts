/**
 * DTMF tone generator for Twilio media streams.
 * Generates DTMF tones as base64-encoded G.711 µ-law audio at 8kHz.
 */

// DTMF frequency pairs (row freq, col freq)
const DTMF_FREQS: Record<string, [number, number]> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '0': [941, 1336],
  '*': [941, 1209],
  '#': [941, 1477],
};

const SAMPLE_RATE = 8000;
const TONE_DURATION_MS = 200;   // Duration of each tone
const GAP_DURATION_MS = 150;    // Silence between tones
const AMPLITUDE = 0.5;          // Tone amplitude (0-1)

/**
 * Convert a linear PCM sample (-1..1) to G.711 µ-law byte.
 */
function linearToMulaw(sample: number): number {
  const MAX = 32635;
  const BIAS = 132;
  const CLIP = 32635;

  // Scale to 16-bit range
  let pcm = Math.round(sample * 32767);

  // Determine sign
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;

  pcm += BIAS;

  // Find segment
  let exponent = 7;
  let mask = 0x4000;
  while (exponent > 0 && (pcm & mask) === 0) {
    exponent--;
    mask >>= 1;
  }

  const mantissa = (pcm >> (exponent + 3)) & 0x0F;
  const mulaw = ~(sign | (exponent << 4) | mantissa) & 0xFF;

  return mulaw;
}

/**
 * Generate silence (µ-law encoded) for the given duration.
 */
function generateSilence(durationMs: number): Buffer {
  const numSamples = Math.round((SAMPLE_RATE * durationMs) / 1000);
  const buf = Buffer.alloc(numSamples);
  const silenceByte = linearToMulaw(0);
  buf.fill(silenceByte);
  return buf;
}

/**
 * Generate a single DTMF tone as µ-law audio.
 */
function generateTone(digit: string): Buffer {
  const freqs = DTMF_FREQS[digit];
  if (!freqs) return Buffer.alloc(0);

  const [f1, f2] = freqs;
  const numSamples = Math.round((SAMPLE_RATE * TONE_DURATION_MS) / 1000);
  const buf = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    // Sum of two sine waves
    const sample = AMPLITUDE * (
      Math.sin(2 * Math.PI * f1 * t) +
      Math.sin(2 * Math.PI * f2 * t)
    ) / 2;
    buf[i] = linearToMulaw(sample);
  }

  return buf;
}

/**
 * Generate DTMF audio for a sequence of digits.
 * Returns an array of base64-encoded µ-law audio chunks ready to send
 * to a Twilio media stream. Each chunk is ~20ms (160 samples) to match
 * Twilio's expected packet size.
 */
export function generateDtmfAudio(digits: string): string[] {
  const buffers: Buffer[] = [];

  for (let i = 0; i < digits.length; i++) {
    const ch = digits[i];
    if (ch === 'w') {
      // 'w' = 500ms pause (Twilio convention)
      buffers.push(generateSilence(500));
    } else if (DTMF_FREQS[ch]) {
      buffers.push(generateTone(ch));
      // Add gap between digits (except after last)
      if (i < digits.length - 1) {
        buffers.push(generateSilence(GAP_DURATION_MS));
      }
    }
  }

  // Concatenate all buffers
  const fullAudio = Buffer.concat(buffers);

  // Split into ~20ms chunks (160 bytes at 8kHz µ-law)
  const CHUNK_SIZE = 160;
  const chunks: string[] = [];
  for (let offset = 0; offset < fullAudio.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, fullAudio.length);
    chunks.push(fullAudio.subarray(offset, end).toString('base64'));
  }

  return chunks;
}

/**
 * Valid DTMF characters (digits, *, #, w for wait).
 */
export function isValidDtmf(digits: string): boolean {
  return /^[0-9*#w]+$/.test(digits);
}
