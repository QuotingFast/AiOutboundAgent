// ── Voice Lab API ──────────────────────────────────────────────────
// Powers the dashboard's Voice Lab: a catalog of every available voice
// across providers, provider-key status, and arbitrary-text synthesis
// (type any text, hear it in any ElevenLabs voice or OpenAI voice).

import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getVoicePreset } from '../config/voice-presets';
import { requireAuth } from './security';
import { logger } from '../utils/logger';

export const voiceLabRouter = Router();

// OpenAI Realtime speech-to-speech voices.
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

// ElevenLabs named voices → IDs (the full production roster).
const EL_VOICES: Record<string, string> = {
  sarah: 'EXAVITQu4vr4xnSDxMaL', jessica: 'cgSgspJ2msm6clMCkdW9', bella: 'hpp4J3VqNfWAUOO0d1Us',
  laura: 'FGY2WhTYpPnrIDTdsKH5', matilda: 'XrExE9yKIg1WjnnlVkGX', eric: 'cjVigY5qzO86Huf0OWal',
  chris: 'iP95p4xoKVk53GoZ742B', roger: 'CwhRBWXzGAHq8TQ4Fs17', will: 'bIHbv24MWmeRgasZH58o',
  brian: 'nPczCjzI2devNBz1zQrb', liam: 'TX3LPaxmHKxFdv7VOQHJ', adam: 'pNInz6obpgDQGcFmaJgB',
  bill: 'pqHfZKP75CvOlQylNhV4', callum: 'N2lVS1w4EtoT3dr4eOWO', harry: 'SOYHLrjzK2X1ezoPC6cr',
  river: 'SAz9YHcvj6GT2YYXdXww', 'daisy mae': 'S2fYVrVpl5QYHVJ1LkgT', 'outbound caller': 'WXOyQFCgL1KW7Rv9Fln0',
  'annie-beth': 'c4TutCiAuWP4vwb1xebb', 'billy bob': '8kvxG72xUMYnIFhZYwWj', austin: 'Bj9UqZbhQsanLzgalpEG',
  'southern mike': 'DwEFbvGTcJhAk9eY9m0f', cassidy: '56AoDkrOh6qfVPDXZ7Pt', adeline: '5l5f8iK3YPeGga21rQIX',
  carol: '5u41aNhyCU6hXOykdSKco', miranda: 'PoHUWWWMHFrA8z7Q88pu', hope: 'uYXf8XasLslADfZ2MB4u',
  lina: 'oWjuL7HSoaEJRMDMP3HD', 'mark convoai': '1SM7GgM6IMuvQlz2BwM3', 'marcus jackson': '1cvhXKE3uxgoijz9BMLU',
  leo: '46Gz2MoWgXGvpJ9yRzmw', 'kal jones': '68RUZBDjLe2YBQvv8zFx', pete: 'ChO6kqkVouUn0s7HMunx',
  jamahal: 'DTKMou8ccj1ZaWGBiotd', 'matt schmitz': 'FYZl5JbWOAm6O1fPKAOu', hayden: 'HfjqMQ0GHcNkhBWnIhy3',
  'mark natural': 'UgBBYS2sOqTuMpoF3BR0', jamal: 'Ybqj6CIlqb6M85s9Bl4n', 'david ashby': 'Z9hrfEHGU3dykHntWvIY',
  jarnathan: 'c6SfcYrb2t09NHXiT80T', 'hey its brad': 'f5HLTX707KIM4SzJYzSz', 'w. l. oxley': 'gOkFV1JMCt0G0n9xmBwV',
  boyd: 'gfRt6Z3Z8aTbpLfexQ7N', 'sam chang': 'rYW2LlWtM70M5vc3HBtm', 'adam authentic': 's3TPKV1kjDlVtZbl4Ksh',
  'matt hyper': 'pwMBn0SsmN1220Aorv15', finn: 'vBKc2FfBKJfcZNyEt1n6', alex: 'yl2ZDV1MzN4HbQJbMihG',
  steve: 'jn34bTlmmOgOJU9XfPuy', burt: 'kdVjFjOXaqExaDvXZECX', 'lamar lincoln': 'CVRACyqNcQefTlxMj9bt',
  'voice of america': 'r4iCyrmUEMCbsi7eGtf8', 'tyrese tate': 'rWyjfFeMZ6PxkHqD3wGC',
};

const DEMO_TEXT = "Hey there — this is a quick preview of how I sound on a real call. Pretty natural, right?";

// Cache arbitrary-text synthesis by voice+text hash to avoid re-billing
// identical requests during a demo session.
const ttsCache = new Map<string, Buffer>();
const MAX_TTS_CACHE = 200;

function providerStatus() {
  return {
    openai: { configured: Boolean(config.openai.apiKey && !config.openai.apiKey.startsWith('__MISSING')), model: config.openai.realtimeModel, kind: 'realtime speech-to-speech' },
    elevenlabs: { configured: Boolean(config.elevenlabs.apiKey), voices: Object.keys(EL_VOICES).length, kind: 'premium TTS' },
    deepseek: { configured: Boolean(config.deepseek.apiKey), model: config.deepseek.model, kind: 'LLM (with ElevenLabs TTS)' },
    deepgram: { configured: Boolean(config.deepgram.apiKey), model: config.deepgram.ttsModel, kind: 'Aura TTS' },
  };
}

voiceLabRouter.get('/api/voicelab/status', requireAuth('viewer'), (_req: Request, res: Response) => {
  res.json(providerStatus());
});

voiceLabRouter.get('/api/voicelab/catalog', requireAuth('viewer'), (_req: Request, res: Response) => {
  res.json({
    providers: providerStatus(),
    openaiVoices: OPENAI_VOICES.map(v => ({
      id: v, name: v.charAt(0).toUpperCase() + v.slice(1), provider: 'openai',
      previewUrl: `/api/voice-preview/${v}`,
    })),
    elevenlabsVoices: Object.entries(EL_VOICES).map(([name, id]) => ({
      id, name: name.replace(/\b\w/g, c => c.toUpperCase()), provider: 'elevenlabs',
      previewUrl: `/api/elevenlabs-voice-preview/${id}`,
    })),
  });
});

/**
 * Synthesize arbitrary text in a chosen voice. Body:
 *   { provider: 'elevenlabs'|'openai', voiceId, text, stability?, similarityBoost?, style?, speakerBoost?, modelId? }
 * Returns audio/mpeg (ElevenLabs) or audio/mpeg (OpenAI tts-1).
 */
voiceLabRouter.post('/api/voicelab/tts', requireAuth('operator'), async (req: Request, res: Response) => {
  const { provider, voiceId, text: rawText, stability, similarityBoost, style, speakerBoost, modelId } = req.body || {};
  const text = String(rawText || DEMO_TEXT).slice(0, 800);
  if (!text.trim()) { res.status(400).json({ error: 'text required' }); return; }

  try {
    if (provider === 'openai') {
      const apiKey = config.openai.apiKey;
      const voice = String(voiceId || 'coral');
      const cacheKey = `oa:${voice}:${text}`;
      if (ttsCache.has(cacheKey)) { res.set('Content-Type', 'audio/mpeg'); res.send(ttsCache.get(cacheKey)); return; }
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', voice, input: text, response_format: 'mp3' }),
      });
      if (!r.ok) { res.status(502).json({ error: `OpenAI TTS failed: ${r.status} ${await r.text()}` }); return; }
      const buf = Buffer.from(await r.arrayBuffer());
      cacheTts(cacheKey, buf);
      res.set('Content-Type', 'audio/mpeg'); res.send(buf);
      return;
    }

    // default: ElevenLabs
    const apiKey = config.elevenlabs.apiKey;
    if (!apiKey) { res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' }); return; }
    const vId = String(voiceId || EL_VOICES.steve);
    const preset = getVoicePreset(vId);
    const cacheKey = `el:${vId}:${stability}:${similarityBoost}:${style}:${speakerBoost}:${modelId}:${text}`;
    if (ttsCache.has(cacheKey)) { res.set('Content-Type', 'audio/mpeg'); res.send(ttsCache.get(cacheKey)); return; }
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: modelId || 'eleven_flash_v2_5',
        voice_settings: {
          stability: typeof stability === 'number' ? stability : preset.stability,
          similarity_boost: typeof similarityBoost === 'number' ? similarityBoost : preset.similarityBoost,
          style: typeof style === 'number' ? style : preset.style,
          use_speaker_boost: typeof speakerBoost === 'boolean' ? speakerBoost : preset.useSpeakerBoost,
        },
      }),
    });
    if (!r.ok) { res.status(502).json({ error: `ElevenLabs TTS failed: ${r.status} ${await r.text()}` }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    cacheTts(cacheKey, buf);
    res.set('Content-Type', 'audio/mpeg'); res.send(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('voicelab', 'TTS error', { error: msg });
    res.status(500).json({ error: msg });
  }
});

function cacheTts(key: string, buf: Buffer): void {
  if (ttsCache.size >= MAX_TTS_CACHE) {
    const first = ttsCache.keys().next().value;
    if (first) ttsCache.delete(first);
  }
  ttsCache.set(key, buf);
}
