// ── Per-Voice ElevenLabs Tuning Presets ───────────────────────────
// Individualized voice settings for μ-law 8kHz telephony output.
// Each voice is tuned for its character type and optimal narrowband clarity.

export interface VoicePreset {
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
}

// Default fallback for unknown voices
const DEFAULT_PRESET: VoicePreset = {
  stability: 0.60,
  similarityBoost: 0.80,
  style: 0.05,
  useSpeakerBoost: true,
  speed: 1.00,
};

// Voice ID → tuning preset
const VOICE_PRESETS: Record<string, VoicePreset> = {
  // ── Natural Female ─────────────────────────────────────────────
  // Warm clarity without over-expressiveness on narrowband
  EXAVITQu4vr4xnSDxMaL: { stability: 0.60, similarityBoost: 0.82, style: 0.04, useSpeakerBoost: true, speed: 1.00 },  // Sarah
  cgSgspJ2msm6clMCkdW9: { stability: 0.58, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 0.99 },  // Jessica
  hpp4J3VqNfWAUOO0d1Us: { stability: 0.57, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.00 },  // Bella
  FGY2WhTYpPnrIDTdsKH5: { stability: 0.61, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 0.98 },  // Laura
  XrExE9yKIg1WjnnlVkGX: { stability: 0.63, similarityBoost: 0.84, style: 0.03, useSpeakerBoost: true, speed: 0.97 },  // Matilda
  PoHUWWWMHFrA8z7Q88pu: { stability: 0.59, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Miranda
  uYXf8XasLslADfZ2MB4u: { stability: 0.60, similarityBoost: 0.82, style: 0.04, useSpeakerBoost: true, speed: 1.01 },  // Hope
  oWjuL7HSoaEJRMDMP3HD: { stability: 0.58, similarityBoost: 0.80, style: 0.05, useSpeakerBoost: true, speed: 1.02 },  // Lina
  '5u41aNhyCU6hXOykdSKco': { stability: 0.62, similarityBoost: 0.83, style: 0.03, useSpeakerBoost: true, speed: 0.98 },  // Carol
  '5l5f8iK3YPeGga21rQIX': { stability: 0.59, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Adeline
  '56AoDkrOh6qfVPDXZ7Pt': { stability: 0.60, similarityBoost: 0.82, style: 0.04, useSpeakerBoost: true, speed: 0.99 },  // Cassidy

  // ── Natural Male ───────────────────────────────────────────────
  // Confident but natural variation
  cjVigY5qzO86Huf0OWal: { stability: 0.58, similarityBoost: 0.82, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Eric
  iP95p4xoKVk53GoZ742B: { stability: 0.55, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.01 },  // Chris
  bIHbv24MWmeRgasZH58o: { stability: 0.57, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Will
  nPczCjzI2devNBz1zQrb: { stability: 0.59, similarityBoost: 0.82, style: 0.04, useSpeakerBoost: true, speed: 0.99 },  // Brian
  TX3LPaxmHKxFdv7VOQHJ: { stability: 0.56, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.02 },  // Liam
  pNInz6obpgDQGcFmaJgB: { stability: 0.58, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Adam
  N2lVS1w4EtoT3dr4eOWO: { stability: 0.60, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 0.99 },  // Callum
  SOYHLrjzK2X1ezoPC6cr: { stability: 0.57, similarityBoost: 0.80, style: 0.05, useSpeakerBoost: true, speed: 1.01 },  // Harry
  SAz9YHcvj6GT2YYXdXww: { stability: 0.55, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.00 },  // River
  yl2ZDV1MzN4HbQJbMihG: { stability: 0.57, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Alex
  Ybqj6CIlqb6M85s9Bl4n: { stability: 0.56, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.01 },  // Jamal
  Z9hrfEHGU3dykHntWvIY: { stability: 0.60, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 0.99 },  // David Ashby
  HfjqMQ0GHcNkhBWnIhy3: { stability: 0.56, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.01 },  // Hayden

  // ── Deep / Authoritative ───────────────────────────────────────
  // Higher stability preserves gravitas; slower for clarity
  CwhRBWXzGAHq8TQ4Fs17: { stability: 0.68, similarityBoost: 0.84, style: 0.03, useSpeakerBoost: true, speed: 0.97 },  // Roger
  pqHfZKP75CvOlQylNhV4: { stability: 0.70, similarityBoost: 0.85, style: 0.02, useSpeakerBoost: true, speed: 0.96 },  // Bill
  kdVjFjOXaqExaDvXZECX: { stability: 0.72, similarityBoost: 0.86, style: 0.02, useSpeakerBoost: true, speed: 0.96 },  // Burt
  gOkFV1JMCt0G0n9xmBwV: { stability: 0.69, similarityBoost: 0.84, style: 0.03, useSpeakerBoost: true, speed: 0.97 },  // W. L. Oxley
  CVRACyqNcQefTlxMj9bt: { stability: 0.67, similarityBoost: 0.83, style: 0.03, useSpeakerBoost: true, speed: 0.97 },  // Lamar Lincoln
  r4iCyrmUEMCbsi7eGtf8: { stability: 0.71, similarityBoost: 0.85, style: 0.02, useSpeakerBoost: true, speed: 0.96 },  // Voice of America

  // ── Southern Female ────────────────────────────────────────────
  // Lower stability + higher style for drawl/character
  S2fYVrVpl5QYHVJ1LkgT: { stability: 0.50, similarityBoost: 0.79, style: 0.11, useSpeakerBoost: true, speed: 0.95 },  // Daisy Mae
  c4TutCiAuWP4vwb1xebb: { stability: 0.48, similarityBoost: 0.78, style: 0.12, useSpeakerBoost: true, speed: 0.96 },  // Annie-Beth

  // ── Southern Male ──────────────────────────────────────────────
  // Maximum character expression with slow pacing
  '8kvxG72xUMYnIFhZYwWj': { stability: 0.47, similarityBoost: 0.77, style: 0.14, useSpeakerBoost: true, speed: 0.93 },  // Billy Bob
  Bj9UqZbhQsanLzgalpEG: { stability: 0.50, similarityBoost: 0.78, style: 0.12, useSpeakerBoost: true, speed: 0.94 },  // Austin
  DwEFbvGTcJhAk9eY9m0f: { stability: 0.52, similarityBoost: 0.79, style: 0.10, useSpeakerBoost: true, speed: 0.95 },  // Southern Mike

  // ── Professional / Outbound ────────────────────────────────────
  // Optimized for phone clarity and trust
  WXOyQFCgL1KW7Rv9Fln0: { stability: 0.63, similarityBoost: 0.84, style: 0.03, useSpeakerBoost: true, speed: 0.99 },  // Outbound Caller
  '1SM7GgM6IMuvQlz2BwM3': { stability: 0.62, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 1.00 },  // Mark ConvoAI
  UgBBYS2sOqTuMpoF3BR0: { stability: 0.61, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 0.99 },  // Mark Natural
  FYZl5JbWOAm6O1fPKAOu: { stability: 0.60, similarityBoost: 0.82, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Matt Schmitz
  '1cvhXKE3uxgoijz9BMLU': { stability: 0.60, similarityBoost: 0.82, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Marcus Jackson
  '68RUZBDjLe2YBQvv8zFx': { stability: 0.58, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Kal Jones
  DTKMou8ccj1ZaWGBiotd: { stability: 0.59, similarityBoost: 0.82, style: 0.04, useSpeakerBoost: true, speed: 0.99 },  // Jamahal
  rYW2LlWtM70M5vc3HBtm: { stability: 0.61, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 1.00 },  // Sam Chang
  s3TPKV1kjDlVtZbl4Ksh: { stability: 0.58, similarityBoost: 0.81, style: 0.05, useSpeakerBoost: true, speed: 1.00 },  // Adam Authentic
  gfRt6Z3Z8aTbpLfexQ7N: { stability: 0.62, similarityBoost: 0.83, style: 0.04, useSpeakerBoost: true, speed: 0.98 },  // Boyd
  c6SfcYrb2t09NHXiT80T: { stability: 0.57, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.00 },  // Jarnathan
  f5HLTX707KIM4SzJYzSz: { stability: 0.55, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 1.01 },  // Hey Its Brad

  // ── Steve — conversational, warm, not stiff ────────────────────
  jn34bTlmmOgOJU9XfPuy: { stability: 0.54, similarityBoost: 0.81, style: 0.08, useSpeakerBoost: true, speed: 0.98 },  // Steve

  // ── Energetic / Young ──────────────────────────────────────────
  // Slightly faster with more style for energy
  vBKc2FfBKJfcZNyEt1n6: { stability: 0.52, similarityBoost: 0.80, style: 0.08, useSpeakerBoost: true, speed: 1.03 },  // Finn
  ChO6kqkVouUn0s7HMunx: { stability: 0.53, similarityBoost: 0.79, style: 0.07, useSpeakerBoost: true, speed: 1.02 },  // Pete
  '46Gz2MoWgXGvpJ9yRzmw': { stability: 0.50, similarityBoost: 0.79, style: 0.09, useSpeakerBoost: true, speed: 1.04 },  // Leo
  pwMBn0SsmN1220Aorv15: { stability: 0.51, similarityBoost: 0.80, style: 0.08, useSpeakerBoost: true, speed: 1.03 },  // Matt Hyper

  // ── Character / Specialty ──────────────────────────────────────
  Z7HhYXzYeRsQk3RnXqiG: { stability: 0.55, similarityBoost: 0.79, style: 0.07, useSpeakerBoost: true, speed: 1.00 },  // Attank
  '1THll2MhJjluQYaSQxDr': { stability: 0.57, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 0.99 },  // Sanchez
  NFJlRMNv6b8kbunXwjHC: { stability: 0.56, similarityBoost: 0.80, style: 0.06, useSpeakerBoost: true, speed: 0.98 },  // Luis Plata
  rWyjfFeMZ6PxkHqD3wGC: { stability: 0.55, similarityBoost: 0.79, style: 0.07, useSpeakerBoost: true, speed: 1.01 },  // Tyrese Tate
};

/**
 * Get the tuning preset for a given ElevenLabs voice ID.
 * Returns the per-voice preset if one exists, otherwise the default.
 */
export function getVoicePreset(voiceId: string): VoicePreset {
  return VOICE_PRESETS[voiceId] ?? DEFAULT_PRESET;
}

/**
 * Get the voice name → voice ID map (useful for preview endpoints).
 */
export function getVoiceIdByName(name: string): string | undefined {
  const VOICE_NAME_MAP: Record<string, string> = {
    sarah: 'EXAVITQu4vr4xnSDxMaL',
    jessica: 'cgSgspJ2msm6clMCkdW9',
    bella: 'hpp4J3VqNfWAUOO0d1Us',
    laura: 'FGY2WhTYpPnrIDTdsKH5',
    matilda: 'XrExE9yKIg1WjnnlVkGX',
    eric: 'cjVigY5qzO86Huf0OWal',
    chris: 'iP95p4xoKVk53GoZ742B',
    roger: 'CwhRBWXzGAHq8TQ4Fs17',
    will: 'bIHbv24MWmeRgasZH58o',
    brian: 'nPczCjzI2devNBz1zQrb',
    liam: 'TX3LPaxmHKxFdv7VOQHJ',
    adam: 'pNInz6obpgDQGcFmaJgB',
    bill: 'pqHfZKP75CvOlQylNhV4',
    callum: 'N2lVS1w4EtoT3dr4eOWO',
    harry: 'SOYHLrjzK2X1ezoPC6cr',
    river: 'SAz9YHcvj6GT2YYXdXww',
    steve: 'jn34bTlmmOgOJU9XfPuy',
  };
  return VOICE_NAME_MAP[name.toLowerCase()];
}
