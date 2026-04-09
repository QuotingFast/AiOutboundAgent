/**
 * G.711 µ-law codec — converts between signed 16-bit linear PCM (slin16)
 * and 8-bit µ-law (mulaw) as defined by ITU-T G.711.
 *
 * Asterisk AudioSocket sends slin16 (8 kHz, little-endian).
 * OpenAI Realtime / Twilio expect g711_ulaw (8 kHz).
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

// Precomputed decode table (mulaw byte → signed 16-bit sample)
const MULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const mu = ~i & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
}

/**
 * Encode a single signed 16-bit linear sample to a µ-law byte.
 */
function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sign) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  let exponent = 7;
  const expMask = 0x4000;
  for (; exponent > 0; exponent--) {
    if (sample & expMask) break;
    sample <<= 1;
  }

  const mantissa = (sample >> 10) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Decode a single µ-law byte to a signed 16-bit linear sample.
 */
function mulawToLinear(mulawByte: number): number {
  return MULAW_DECODE_TABLE[mulawByte & 0xff];
}

/**
 * Convert a Buffer of signed 16-bit LE PCM samples to a Buffer of µ-law bytes.
 * Input:  slin16, 2 bytes per sample, little-endian
 * Output: mulaw, 1 byte per sample
 */
export function slin16ToMulaw(slin: Buffer): Buffer {
  const sampleCount = slin.length >> 1;
  const out = Buffer.allocUnsafe(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const sample = slin.readInt16LE(i * 2);
    out[i] = linearToMulaw(sample);
  }
  return out;
}

/**
 * Convert a Buffer of µ-law bytes to signed 16-bit LE PCM.
 * Input:  mulaw, 1 byte per sample
 * Output: slin16, 2 bytes per sample, little-endian
 */
export function mulawToSlin16(mulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(mulawToLinear(mulaw[i]), i * 2);
  }
  return out;
}
