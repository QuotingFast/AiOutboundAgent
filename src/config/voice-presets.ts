/**
 * Per-voice ElevenLabs tuning presets optimized for μ-law 8 kHz telephony.
 *
 * Design principles (from ElevenLabs + telephony best practices):
 * - Narrowband (G.711 μ-law 8 kHz) smears subtle prosody, so we favor
 *   clarity and consistent cadence over extreme expressiveness.
 * - stability: lower = broader emotional range; higher = monotone.
 *   Phone agents need enough variation to sound human, but not so much
 *   that μ-law compression creates artifacts.
 * - similarity_boost: adherence to the original voice timbre.
 *   Higher keeps the voice recognizable on degraded audio.
 * - style: amplifies the voice's native style. Can increase latency
 *   when > 0. Keep very low for telephony — a little goes a long way.
 * - use_speaker_boost: clarity boost that helps on narrowband. Generally
 *   true for phone agents, false only when latency is ultra-critical.
 * - speed: 0.7–1.2 safe range per ElevenLabs docs. Slight adjustments
 *   per voice character (southern drawl slower, energetic voices slightly faster).
 *
 * Each voice is tuned based on its persona/character type:
 *   - Warm sales voices: moderate stability, slight style
 *   - Southern/character voices: lower stability, more style, slower speed
 *   - Professional/crisp voices: higher stability, minimal style
 *   - Energetic/young voices: moderate stability, slightly faster
 *   - Deep/authoritative voices: higher stability, slightly slower
 */

export interface VoicePreset {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

/** Sensible default for any voice not in the map */
export const DEFAULT_VOICE_PRESET: VoicePreset = {
  stability: 0.60,
  similarity_boost: 0.80,
  style: 0.05,
  use_speaker_boost: true,
  speed: 1.00,
};

/**
 * Individualized presets keyed by ElevenLabs voice_id.
 * Grouped by voice character for readability.
 */
export const VOICE_PRESETS: Record<string, VoicePreset> = {

  // ──────────────────────────────────────────────────────────────────
  // NATURAL FEMALE — warm, friendly, conversational
  // ──────────────────────────────────────────────────────────────────

  // Sarah — warm, soft, approachable female
  'EXAVITQu4vr4xnSDxMaL': {
    stability: 0.58,
    similarity_boost: 0.82,
    style: 0.06,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // Jessica — clear, confident female
  'cgSgspJ2msm6clMCkdW9': {
    stability: 0.62,
    similarity_boost: 0.83,
    style: 0.04,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Bella — youthful, energetic female
  'hpp4J3VqNfWAUOO0d1Us': {
    stability: 0.55,
    similarity_boost: 0.80,
    style: 0.07,
    use_speaker_boost: true,
    speed: 1.02,
  },

  // Laura — professional, measured female
  'FGY2WhTYpPnrIDTdsKH5': {
    stability: 0.65,
    similarity_boost: 0.84,
    style: 0.03,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // Matilda — mature, reassuring female
  'XrExE9yKIg1WjnnlVkGX': {
    stability: 0.66,
    similarity_boost: 0.82,
    style: 0.04,
    use_speaker_boost: true,
    speed: 0.97,
  },

  // Hope — bright, optimistic female
  'uYXf8XasLslADfZ2MB4u': {
    stability: 0.57,
    similarity_boost: 0.80,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.01,
  },

  // Lina — smooth, calm female
  'oWjuL7HSoaEJRMDMP3HD': {
    stability: 0.63,
    similarity_boost: 0.81,
    style: 0.04,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // Miranda — poised, articulate female
  'PoHUWWWMHFrA8z7Q88pu': {
    stability: 0.64,
    similarity_boost: 0.83,
    style: 0.03,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // Carol — friendly, mid-range female
  '5u41aNhyCU6hXOykdSKco': {
    stability: 0.61,
    similarity_boost: 0.82,
    style: 0.05,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // ──────────────────────────────────────────────────────────────────
  // NATURAL MALE — warm, confident, conversational
  // ──────────────────────────────────────────────────────────────────

  // Eric — warm, approachable male (campaign default: Consumer Auto)
  'cjVigY5qzO86Huf0OWal': {
    stability: 0.58,
    similarity_boost: 0.82,
    style: 0.05,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Chris — confident, clear male (campaign default: Agency Dev)
  'iP95p4xoKVk53GoZ742B': {
    stability: 0.55,
    similarity_boost: 0.80,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.01,
  },

  // Will — friendly, natural male
  'bIHbv24MWmeRgasZH58o': {
    stability: 0.57,
    similarity_boost: 0.81,
    style: 0.05,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Brian — steady, trustworthy male
  'nPczCjzI2devNBz1zQrb': {
    stability: 0.63,
    similarity_boost: 0.83,
    style: 0.04,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // Liam — young professional male
  'TX3LPaxmHKxFdv7VOQHJ': {
    stability: 0.56,
    similarity_boost: 0.80,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.02,
  },

  // Adam — balanced, versatile male
  'pNInz6obpgDQGcFmaJgB': {
    stability: 0.60,
    similarity_boost: 0.82,
    style: 0.05,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Callum — smooth, articulate male
  'N2lVS1w4EtoT3dr4eOWO': {
    stability: 0.61,
    similarity_boost: 0.83,
    style: 0.04,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // Harry — warm, personable male
  'SOYHLrjzK2X1ezoPC6cr': {
    stability: 0.58,
    similarity_boost: 0.81,
    style: 0.05,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // River — expressive, youthful
  'SAz9YHcvj6GT2YYXdXww': {
    stability: 0.52,
    similarity_boost: 0.79,
    style: 0.08,
    use_speaker_boost: true,
    speed: 1.03,
  },

  // ──────────────────────────────────────────────────────────────────
  // DEEP / AUTHORITATIVE MALE — mature, commanding
  // ──────────────────────────────────────────────────────────────────

  // Roger — deep, authoritative male
  'CwhRBWXzGAHq8TQ4Fs17': {
    stability: 0.68,
    similarity_boost: 0.85,
    style: 0.03,
    use_speaker_boost: true,
    speed: 0.96,
  },

  // Bill — seasoned, steady male
  'pqHfZKP75CvOlQylNhV4': {
    stability: 0.70,
    similarity_boost: 0.84,
    style: 0.02,
    use_speaker_boost: true,
    speed: 0.97,
  },

  // Burt — deep, grounded male
  'kdVjFjOXaqExaDvXZECX': {
    stability: 0.69,
    similarity_boost: 0.83,
    style: 0.03,
    use_speaker_boost: true,
    speed: 0.96,
  },

  // David Ashby — polished, authoritative male
  'Z9hrfEHGU3dykHntWvIY': {
    stability: 0.67,
    similarity_boost: 0.85,
    style: 0.03,
    use_speaker_boost: true,
    speed: 0.97,
  },

  // W. L. Oxley — distinguished, measured male
  'gOkFV1JMCt0G0n9xmBwV': {
    stability: 0.71,
    similarity_boost: 0.84,
    style: 0.02,
    use_speaker_boost: true,
    speed: 0.96,
  },

  // ──────────────────────────────────────────────────────────────────
  // SOUTHERN / CHARACTER FEMALE — warm drawl, personality-forward
  // ──────────────────────────────────────────────────────────────────

  // Daisy Mae — southern belle female
  'S2fYVrVpl5QYHVJ1LkgT': {
    stability: 0.48,
    similarity_boost: 0.78,
    style: 0.12,
    use_speaker_boost: true,
    speed: 0.94,
  },

  // Annie-Beth — sweet southern female
  'c4TutCiAuWP4vwb1xebb': {
    stability: 0.50,
    similarity_boost: 0.79,
    style: 0.11,
    use_speaker_boost: true,
    speed: 0.95,
  },

  // Cassidy — friendly southern female
  '56AoDkrOh6qfVPDXZ7Pt': {
    stability: 0.52,
    similarity_boost: 0.80,
    style: 0.10,
    use_speaker_boost: true,
    speed: 0.96,
  },

  // Adeline — graceful southern female
  '5l5f8iK3YPeGga21rQIX': {
    stability: 0.51,
    similarity_boost: 0.79,
    style: 0.10,
    use_speaker_boost: true,
    speed: 0.95,
  },

  // ──────────────────────────────────────────────────────────────────
  // SOUTHERN / CHARACTER MALE — drawl, laid-back warmth
  // ──────────────────────────────────────────────────────────────────

  // Billy Bob — broad southern male
  '8kvxG72xUMYnIFhZYwWj': {
    stability: 0.47,
    similarity_boost: 0.77,
    style: 0.14,
    use_speaker_boost: true,
    speed: 0.93,
  },

  // Austin — relaxed southern male
  'Bj9UqZbhQsanLzgalpEG': {
    stability: 0.50,
    similarity_boost: 0.79,
    style: 0.11,
    use_speaker_boost: true,
    speed: 0.95,
  },

  // Southern Mike — classic southern male
  'DwEFbvGTcJhAk9eY9m0f': {
    stability: 0.49,
    similarity_boost: 0.78,
    style: 0.13,
    use_speaker_boost: true,
    speed: 0.94,
  },

  // Boyd — rugged, down-to-earth male
  'gfRt6Z3Z8aTbpLfexQ7N': {
    stability: 0.52,
    similarity_boost: 0.78,
    style: 0.10,
    use_speaker_boost: true,
    speed: 0.95,
  },

  // ──────────────────────────────────────────────────────────────────
  // PROFESSIONAL / OUTBOUND-SPECIFIC — crisp, purpose-built
  // ──────────────────────────────────────────────────────────────────

  // Outbound Caller — purpose-built for phone outreach
  'WXOyQFCgL1KW7Rv9Fln0': {
    stability: 0.62,
    similarity_boost: 0.85,
    style: 0.04,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Mark ConvoAI — conversational AI-optimized male
  '1SM7GgM6IMuvQlz2BwM3': {
    stability: 0.60,
    similarity_boost: 0.84,
    style: 0.04,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Alex — balanced, professional male
  'yl2ZDV1MzN4HbQJbMihG': {
    stability: 0.60,
    similarity_boost: 0.83,
    style: 0.05,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Steve — warm, conversational male (tuned for natural phone delivery)
  'jn34bTlmmOgOJU9XfPuy': {
    stability: 0.54,
    similarity_boost: 0.81,
    style: 0.08,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // Mark Natural — organic, conversational male
  'UgBBYS2sOqTuMpoF3BR0': {
    stability: 0.57,
    similarity_boost: 0.82,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Adam Authentic — natural, genuine male
  's3TPKV1kjDlVtZbl4Ksh': {
    stability: 0.56,
    similarity_boost: 0.81,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Voice of America — broadcast-quality, polished
  'r4iCyrmUEMCbsi7eGtf8': {
    stability: 0.72,
    similarity_boost: 0.86,
    style: 0.02,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // ──────────────────────────────────────────────────────────────────
  // ENERGETIC / YOUNG — upbeat, dynamic
  // ──────────────────────────────────────────────────────────────────

  // Finn — lively, youthful male
  'vBKc2FfBKJfcZNyEt1n6': {
    stability: 0.53,
    similarity_boost: 0.80,
    style: 0.07,
    use_speaker_boost: true,
    speed: 1.03,
  },

  // Pete — upbeat, direct male
  'ChO6kqkVouUn0s7HMunx': {
    stability: 0.55,
    similarity_boost: 0.81,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.02,
  },

  // Leo — energetic, charismatic male
  '46Gz2MoWgXGvpJ9yRzmw': {
    stability: 0.52,
    similarity_boost: 0.80,
    style: 0.08,
    use_speaker_boost: true,
    speed: 1.03,
  },

  // Hayden — bright, contemporary male
  'HfjqMQ0GHcNkhBWnIhy3': {
    stability: 0.54,
    similarity_boost: 0.80,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.02,
  },

  // Matt Hyper — high-energy male
  'pwMBn0SsmN1220Aorv15': {
    stability: 0.50,
    similarity_boost: 0.79,
    style: 0.09,
    use_speaker_boost: true,
    speed: 1.04,
  },

  // Hey Its Brad — casual, relatable male
  'f5HLTX707KIM4SzJYzSz': {
    stability: 0.53,
    similarity_boost: 0.80,
    style: 0.07,
    use_speaker_boost: true,
    speed: 1.02,
  },

  // ──────────────────────────────────────────────────────────────────
  // DISTINCTIVE / CHARACTER MALE — unique persona, varied energy
  // ──────────────────────────────────────────────────────────────────

  // Marcus Jackson — smooth, assured male
  '1cvhXKE3uxgoijz9BMLU': {
    stability: 0.59,
    similarity_boost: 0.83,
    style: 0.06,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // Kal Jones — cool, collected male
  '68RUZBDjLe2YBQvv8zFx': {
    stability: 0.58,
    similarity_boost: 0.82,
    style: 0.06,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // Jamahal — rich, resonant male
  'DTKMou8ccj1ZaWGBiotd': {
    stability: 0.60,
    similarity_boost: 0.84,
    style: 0.05,
    use_speaker_boost: true,
    speed: 0.98,
  },

  // Matt Schmitz — conversational, easygoing male
  'FYZl5JbWOAm6O1fPKAOu': {
    stability: 0.56,
    similarity_boost: 0.81,
    style: 0.06,
    use_speaker_boost: true,
    speed: 1.01,
  },

  // Jamal — warm, engaging male
  'Ybqj6CIlqb6M85s9Bl4n': {
    stability: 0.57,
    similarity_boost: 0.82,
    style: 0.06,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // Jarnathan — distinctive, character male
  'c6SfcYrb2t09NHXiT80T': {
    stability: 0.54,
    similarity_boost: 0.79,
    style: 0.08,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Sam Chang — clear, pleasant male
  'rYW2LlWtM70M5vc3HBtm': {
    stability: 0.61,
    similarity_boost: 0.83,
    style: 0.04,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Lamar Lincoln — deep, confident male
  'CVRACyqNcQefTlxMj9bt': {
    stability: 0.63,
    similarity_boost: 0.84,
    style: 0.05,
    use_speaker_boost: true,
    speed: 0.97,
  },

  // Tyrese Tate — charismatic, dynamic male
  'rWyjfFeMZ6PxkHqD3wGC': {
    stability: 0.55,
    similarity_boost: 0.82,
    style: 0.07,
    use_speaker_boost: true,
    speed: 1.01,
  },

  // Attank — bold, distinctive male
  'Z7HhYXzYeRsQk3RnXqiG': {
    stability: 0.54,
    similarity_boost: 0.80,
    style: 0.08,
    use_speaker_boost: true,
    speed: 1.00,
  },

  // Sanchez — warm, direct male
  '1THll2MhJjluQYaSQxDr': {
    stability: 0.59,
    similarity_boost: 0.82,
    style: 0.05,
    use_speaker_boost: true,
    speed: 0.99,
  },

  // Luis Plata — clear, personable male
  'NFJlRMNv6b8kbunXwjHC': {
    stability: 0.60,
    similarity_boost: 0.83,
    style: 0.05,
    use_speaker_boost: true,
    speed: 0.99,
  },
};

/**
 * Look up the tuned preset for a given voice_id.
 * Returns the individualized preset if one exists, otherwise the default.
 */
export function getVoicePreset(voiceId: string): VoicePreset {
  return VOICE_PRESETS[voiceId] ?? { ...DEFAULT_VOICE_PRESET };
}
