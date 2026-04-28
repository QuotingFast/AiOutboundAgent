import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

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
const BUFFER_DURATION_SEC = 30; // 30-second loopable buffer (longer = harder to detect repetition)
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

  // Layer 3: Sparse keyboard clicks (exponential distribution for natural irregularity)
  let nextClick = Math.floor(rng.next() * SAMPLE_RATE * 2);
  while (nextClick < BUFFER_LENGTH) {
    const clickLen = 40 + Math.floor(rng.next() * 30); // 5-9ms click
    const clickAmp = 150 + rng.next() * 350; // Vary amplitude more
    for (let j = 0; j < clickLen && nextClick + j < BUFFER_LENGTH; j++) {
      const envelope = 1 - j / clickLen; // decay
      linear[nextClick + j] += rng.nextGaussian() * clickAmp * envelope;
    }
    // Exponential distribution: more short gaps, occasional long gaps (natural typing pattern)
    const lambda = 0.4; // Average ~2.5 seconds between clicks
    const expInterval = -Math.log(1 - rng.next() + 0.001) / lambda;
    nextClick += Math.floor(SAMPLE_RATE * Math.min(expInterval, 8)); // Cap at 8s
  }

  // Layer 4: Muffled phone ring (distant, very quiet, more varied intervals)
  const ringInterval = SAMPLE_RATE * 12;
  for (let ringStart = Math.floor(rng.next() * SAMPLE_RATE * 5); ringStart < BUFFER_LENGTH; ringStart += ringInterval + Math.floor(rng.next() * SAMPLE_RATE * 10)) {
    const ringDur = Math.floor(SAMPLE_RATE * 0.4); // 400ms ring
    for (let j = 0; j < ringDur && ringStart + j < BUFFER_LENGTH; j++) {
      const t = j / SAMPLE_RATE;
      // Two-tone phone ring, muffled (low amplitude, filtered)
      const tone = Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t);
      const envelope = Math.sin(Math.PI * j / ringDur); // fade in/out
      linear[ringStart + j] += tone * 50 * envelope;
    }
  }

  // Layer 5: Paper rustling / mouse movement (very sparse, subtle)
  let nextRustle = Math.floor(rng.next() * SAMPLE_RATE * 8);
  while (nextRustle < BUFFER_LENGTH) {
    const rustleLen = 80 + Math.floor(rng.next() * 120); // 10-25ms rustle
    const rustleAmp = 80 + rng.next() * 120;
    for (let j = 0; j < rustleLen && nextRustle + j < BUFFER_LENGTH; j++) {
      // Filtered noise with fast attack, slow decay
      const envelope = j < rustleLen * 0.2
        ? j / (rustleLen * 0.2)
        : 1 - ((j - rustleLen * 0.2) / (rustleLen * 0.8));
      linear[nextRustle + j] += rng.nextGaussian() * rustleAmp * envelope * 0.5;
    }
    // Very sparse: 15-30 seconds between rustles
    nextRustle += Math.floor(SAMPLE_RATE * (15 + rng.next() * 15));
  }

  // Layer 6: Broadband very-low-level room tone
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

// ── Custom audio loader (WAV + MP3) ───────────────────────────────
// Replaces the synthetic noise with a real recording (e.g. an
// ElevenLabs office-ambience export). Source resolution order:
//   1. process.env.BACKGROUND_NOISE_FILE (absolute path, any extension)
//   2. <repo>/assets/office-ambience.wav (canonical path)
//   3. The first .wav or .mp3 found in <repo>/assets/ (alphabetical;
//      .wav preferred over .mp3 because no async decode).
// Loaded once on init: decoded → downmixed to mono → resampled to 8 kHz →
// cross-faded for seamless looping → converted to mulaw. Failure at any
// stage logs an error and falls back to the synthetic generator.

function findCustomNoiseFile(): string | null {
  const envPath = process.env.BACKGROUND_NOISE_FILE;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const assetsDir = path.join(process.cwd(), 'assets');
  const canonical = path.join(assetsDir, 'office-ambience.wav');
  if (fs.existsSync(canonical)) return canonical;

  if (!fs.existsSync(assetsDir)) return null;
  const entries = fs.readdirSync(assetsDir);
  const wavs = entries.filter((f) => f.toLowerCase().endsWith('.wav')).sort();
  const mp3s = entries.filter((f) => f.toLowerCase().endsWith('.mp3')).sort();
  const pick = wavs[0] || mp3s[0];
  return pick ? path.join(assetsDir, pick) : null;
}

function decodeWav(buf: Buffer, sourcePath: string): { mono: Float32Array; sampleRate: number; channels: number; bitsPerSample: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    logger.error('noise', 'Not a valid RIFF/WAVE file', { path: sourcePath });
    return null;
  }
  let format = 0, channels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOffset = -1, dataSize = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      format = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize & 1);
  }
  if (dataOffset < 0 || channels < 1 || sampleRate < 1 || (format !== 1 && format !== 3)) {
    logger.error('noise', 'Unsupported WAV format', { path: sourcePath, format, channels, sampleRate, bitsPerSample });
    return null;
  }
  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const totalFrames = Math.floor(dataSize / frameSize);
  const mono = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const sOff = dataOffset + (i * channels + c) * bytesPerSample;
      let v: number;
      if (format === 3 && bitsPerSample === 32) v = buf.readFloatLE(sOff);
      else if (bitsPerSample === 16) v = buf.readInt16LE(sOff) / 32768;
      else if (bitsPerSample === 24) {
        const b0 = buf[sOff], b1 = buf[sOff + 1], b2 = buf[sOff + 2];
        let raw = (b2 << 16) | (b1 << 8) | b0;
        if (raw & 0x800000) raw |= ~0xFFFFFF;
        v = raw / 8388608;
      }
      else if (bitsPerSample === 32 && format === 1) v = buf.readInt32LE(sOff) / 2147483648;
      else if (bitsPerSample === 8) v = (buf[sOff] - 128) / 128;
      else { logger.error('noise', 'Unsupported bit depth', { bitsPerSample }); return null; }
      sum += v;
    }
    mono[i] = sum / channels;
  }
  return { mono, sampleRate, channels, bitsPerSample };
}

async function decodeMp3(buf: Buffer, sourcePath: string): Promise<{ mono: Float32Array; sampleRate: number; channels: number; bitsPerSample: number } | null> {
  try {
    // mpg123-decoder ships as ESM; require it dynamically so Node's CJS loader
    // gets the named exports and we don't pay WASM init cost unless used.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MPEGDecoder } = require('mpg123-decoder');
    const decoder = new MPEGDecoder();
    await decoder.ready;
    const result = decoder.decode(buf);
    decoder.free();

    const channels: Float32Array[] = result.channelData;
    const numChannels = channels.length;
    const numFrames = channels[0]?.length || 0;
    if (!numFrames || !numChannels) {
      logger.error('noise', 'MP3 decoder returned empty audio', { path: sourcePath });
      return null;
    }
    const mono = new Float32Array(numFrames);
    if (numChannels === 1) {
      mono.set(channels[0]);
    } else {
      for (let i = 0; i < numFrames; i++) {
        let s = 0;
        for (let c = 0; c < numChannels; c++) s += channels[c][i];
        mono[i] = s / numChannels;
      }
    }
    return { mono, sampleRate: result.sampleRate, channels: numChannels, bitsPerSample: 32 };
  } catch (err) {
    logger.error('noise', 'MP3 decode failed', { path: sourcePath, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function finalizeNoiseBuffer(mono: Float32Array, sourceSampleRate: number, label: { path: string; channels: number; bitsPerSample: number }): Buffer | null {
  if (mono.length < sourceSampleRate) {
    logger.error('noise', 'Custom noise file too short (<1s)', { path: label.path, frames: mono.length });
    return null;
  }

  // Resample to 8 kHz with linear interpolation (good enough for ambience).
  let resampled: Float32Array;
  if (sourceSampleRate === SAMPLE_RATE) {
    resampled = mono;
  } else {
    const ratio = sourceSampleRate / SAMPLE_RATE;
    const outLen = Math.floor(mono.length / ratio);
    resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, mono.length - 1);
      const frac = src - i0;
      resampled[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
    }
  }

  // Cross-fade head and tail for seamless looping (100 ms).
  const fadeLen = Math.min(Math.floor(SAMPLE_RATE * 0.1), Math.floor(resampled.length / 4));
  for (let i = 0; i < fadeLen; i++) {
    const w = i / fadeLen;
    resampled[i] = resampled[i] * w + resampled[resampled.length - fadeLen + i] * (1 - w);
  }

  // Convert to mulaw with ~15% headroom so peaks don't slam clip.
  const SCALE = 8191 * 0.85;
  const mulaw = Buffer.alloc(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]));
    mulaw[i] = linearToMulaw(Math.round(s * SCALE));
  }

  logger.info('noise', 'Loaded custom office ambience', {
    path: label.path,
    sourceSampleRate,
    sourceChannels: label.channels,
    sourceBitsPerSample: label.bitsPerSample,
    frames: mulaw.length,
    durationSec: Math.round(mulaw.length / SAMPLE_RATE),
  });
  return mulaw;
}

async function loadCustomNoiseFile(): Promise<Buffer | null> {
  const customPath = findCustomNoiseFile();
  if (!customPath) return null;

  try {
    const buf = fs.readFileSync(customPath);
    const ext = path.extname(customPath).toLowerCase();
    const decoded = ext === '.mp3'
      ? await decodeMp3(buf, customPath)
      : decodeWav(buf, customPath);
    if (!decoded) return null;
    return finalizeNoiseBuffer(decoded.mono, decoded.sampleRate, {
      path: customPath,
      channels: decoded.channels,
      bitsPerSample: decoded.bitsPerSample,
    });
  } catch (err) {
    logger.error('noise', 'Failed to load custom noise file — falling back to synthetic', {
      path: customPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

let initStarted = false;
let initPromise: Promise<void> | null = null;

/**
 * Pre-load and cache the office-ambience buffer. Call from server startup
 * before accepting calls so the first call already has the custom audio
 * (rather than briefly serving synthetic while the WASM MP3 decoder spins
 * up). Idempotent — safe to call multiple times.
 */
export function initOfficeNoise(): Promise<void> {
  if (initPromise) return initPromise;
  initStarted = true;
  initPromise = (async () => {
    const custom = await loadCustomNoiseFile();
    if (custom) {
      officeNoiseBuffer = custom;
    } else {
      officeNoiseBuffer = generateOfficeNoiseBuffer();
      logger.info('noise', `Synthetic office noise buffer generated: ${officeNoiseBuffer.length} bytes (${BUFFER_DURATION_SEC}s @ ${SAMPLE_RATE}Hz mulaw)`);
    }
  })();
  return initPromise;
}

export function getOfficeNoiseBuffer(): Buffer {
  if (!officeNoiseBuffer) {
    // Init wasn't called (or hasn't finished). Synthesize synchronously so
    // the audio path never blocks on a missing buffer; the proper custom
    // buffer will replace this once initOfficeNoise() resolves.
    if (!initStarted) {
      initOfficeNoise().catch(() => { /* logged inside */ });
    }
    if (!officeNoiseBuffer) {
      officeNoiseBuffer = generateOfficeNoiseBuffer();
    }
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
