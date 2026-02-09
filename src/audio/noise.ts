import { logger } from '../utils/logger';

// ── Background Noise Injection ─────────────────────────────────────
// Generates a synthetic office ambiance buffer in 8kHz µ-law format
// and mixes it into outgoing TTS audio at a configurable volume
// (~10-15% default) to make the AI sound like it's in a real office.

// µ-law encoding/decoding helpers
function linearToMulaw(sample: number): number {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;
  sample += MULAW_BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) { /* find exponent */ }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xFF;
  return mulawByte;
}

function mulawToLinear(mulawByte: number): number {
  mulawByte = ~mulawByte & 0xFF;
  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0F;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

// Seeded pseudo-random for reproducible noise
class PRNG {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (this.state >>> 0) / 0xFFFFFFFF;
  }
  nextGaussian(): number {
    // Box-Muller transform
    const u1 = this.next() || 0.0001;
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ── Noise Buffer ──

let officeNoiseBuffer: Buffer | null = null;
const SAMPLE_RATE = 8000;
const BUFFER_DURATION_SEC = 10; // 10-second loopable buffer
const BUFFER_LENGTH = SAMPLE_RATE * BUFFER_DURATION_SEC;

function generateOfficeNoiseBuffer(): Buffer {
  const rng = new PRNG(42);
  const linear = new Float32Array(BUFFER_LENGTH);

  // Layer 1: Low-frequency hum (60Hz electrical, very subtle)
  for (let i = 0; i < BUFFER_LENGTH; i++) {
    linear[i] = Math.sin(2 * Math.PI * 60 * i / SAMPLE_RATE) * 80;
  }

  // Layer 2: HVAC / air conditioner rumble (broadband low noise, filtered)
  for (let i = 0; i < BUFFER_LENGTH; i++) {
    const noise = rng.nextGaussian() * 40;
    // Simple low-pass: weight towards previous sample
    linear[i] += i > 0 ? linear[i - 1] * 0.02 + noise * 0.08 : noise * 0.08;
  }

  // Layer 3: Sparse keyboard clicks (short bursts of noise at random intervals)
  let nextClick = Math.floor(rng.next() * SAMPLE_RATE * 2);
  while (nextClick < BUFFER_LENGTH) {
    const clickLen = 40 + Math.floor(rng.next() * 30); // 5-9ms click
    const clickAmp = 200 + rng.next() * 300;
    for (let j = 0; j < clickLen && nextClick + j < BUFFER_LENGTH; j++) {
      const envelope = 1 - j / clickLen; // decay
      linear[nextClick + j] += rng.nextGaussian() * clickAmp * envelope;
    }
    nextClick += Math.floor(SAMPLE_RATE * (0.8 + rng.next() * 4)); // 0.8-4.8s between clicks
  }

  // Layer 4: Muffled phone ring (distant, very quiet, every ~8 seconds)
  const ringInterval = SAMPLE_RATE * 8;
  for (let ringStart = Math.floor(rng.next() * SAMPLE_RATE * 3); ringStart < BUFFER_LENGTH; ringStart += ringInterval + Math.floor(rng.next() * SAMPLE_RATE * 4)) {
    const ringDur = Math.floor(SAMPLE_RATE * 0.4); // 400ms ring
    for (let j = 0; j < ringDur && ringStart + j < BUFFER_LENGTH; j++) {
      const t = j / SAMPLE_RATE;
      // Two-tone phone ring, muffled (low amplitude, filtered)
      const tone = Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t);
      const envelope = Math.sin(Math.PI * j / ringDur); // fade in/out
      linear[ringStart + j] += tone * 60 * envelope;
    }
  }

  // Layer 5: Broadband very-low-level room tone
  for (let i = 0; i < BUFFER_LENGTH; i++) {
    linear[i] += rng.nextGaussian() * 20;
  }

  // Cross-fade the ends for seamless looping (100ms fade)
  const fadeLen = Math.floor(SAMPLE_RATE * 0.1);
  for (let i = 0; i < fadeLen; i++) {
    const fade = i / fadeLen;
    linear[i] = linear[i] * fade + linear[BUFFER_LENGTH - fadeLen + i] * (1 - fade);
  }

  // Convert to µ-law
  const mulaw = Buffer.alloc(BUFFER_LENGTH);
  for (let i = 0; i < BUFFER_LENGTH; i++) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(linear[i])));
    mulaw[i] = linearToMulaw(clamped);
  }

  return mulaw;
}

export function getOfficeNoiseBuffer(): Buffer {
  if (!officeNoiseBuffer) {
    officeNoiseBuffer = generateOfficeNoiseBuffer();
    logger.info('noise', `Office noise buffer generated: ${officeNoiseBuffer.length} bytes (${BUFFER_DURATION_SEC}s @ ${SAMPLE_RATE}Hz mulaw)`);
  }
  return officeNoiseBuffer;
}

// ── Mixer ──

let noisePosition = 0;

/**
 * Mix background noise into a µ-law audio buffer.
 * @param audio - The TTS/voice audio buffer (8kHz µ-law)
 * @param volume - Noise volume 0.0-1.0 (default 0.12 = 12%)
 * @returns New buffer with noise mixed in
 */
export function mixNoiseIntoAudio(audio: Buffer, volume = 0.12): Buffer {
  const noise = getOfficeNoiseBuffer();
  const output = Buffer.alloc(audio.length);

  for (let i = 0; i < audio.length; i++) {
    const audioSample = mulawToLinear(audio[i]);
    const noiseSample = mulawToLinear(noise[noisePosition % noise.length]);
    noisePosition++;

    // Mix: keep audio at full volume, add noise at specified volume
    const mixed = audioSample + noiseSample * volume;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(mixed)));
    output[i] = linearToMulaw(clamped);
  }

  return output;
}

/**
 * Reset the noise playback position (call at start of each call).
 */
export function resetNoisePosition(): void {
  noisePosition = Math.floor(Math.random() * BUFFER_LENGTH);
}

/**
 * Generate silence-only noise frames (for when TTS is not speaking,
 * to maintain consistent background ambiance).
 * @param numSamples - Number of samples to generate
 * @param volume - Noise volume 0.0-1.0
 * @returns µ-law buffer of pure background noise
 */
export function getNoiseOnlyFrames(numSamples: number, volume = 0.12): Buffer {
  const noise = getOfficeNoiseBuffer();
  const output = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const noiseSample = mulawToLinear(noise[noisePosition % noise.length]);
    noisePosition++;
    const scaled = Math.round(noiseSample * volume);
    const clamped = Math.max(-32768, Math.min(32767, scaled));
    output[i] = linearToMulaw(clamped);
  }

  return output;
}
