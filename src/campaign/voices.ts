// ── ElevenLabs Voice Sync ──────────────────────────────────────────
// Fetches all voices from ElevenLabs API and caches them.
// Every voice in the account appears in the dashboard voice selector.

import { config } from '../config';
import { logger } from '../utils/logger';
import { getCampaign } from './store';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string | null;
  description: string | null;
}

interface VoiceCache {
  voices: ElevenLabsVoice[];
  fetchedAt: number;
  ttlMs: number;
}

let voiceCache: VoiceCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all voices from ElevenLabs API.
 * Uses a short TTL cache to avoid hammering the API.
 */
export async function getElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  // Return cached if fresh
  if (voiceCache && Date.now() - voiceCache.fetchedAt < voiceCache.ttlMs) {
    return voiceCache.voices;
  }

  const apiKey = config.elevenlabs?.apiKey;
  if (!apiKey) {
    logger.warn('voices', 'ELEVENLABS_API_KEY not configured');
    return [];
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('voices', 'ElevenLabs voices fetch failed', {
        status: response.status,
        error: errText,
      });
      // Return stale cache if available
      return voiceCache?.voices || [];
    }

    const data = await response.json() as { voices: any[] };
    const voices: ElevenLabsVoice[] = (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id || '',
      name: v.name || '',
      category: v.category || 'unknown',
      labels: v.labels || {},
      preview_url: v.preview_url || null,
      description: v.description || null,
    }));

    voiceCache = {
      voices,
      fetchedAt: Date.now(),
      ttlMs: CACHE_TTL_MS,
    };

    logger.info('voices', 'ElevenLabs voices fetched and cached', {
      count: voices.length,
    });

    return voices;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('voices', 'ElevenLabs voices fetch error', { error: msg });
    return voiceCache?.voices || [];
  }
}

/**
 * Get voices filtered by campaign whitelist.
 * If the campaign has no whitelist, return all voices.
 */
export async function getVoicesForCampaign(campaignId: string): Promise<ElevenLabsVoice[]> {
  const allVoices = await getElevenLabsVoices();
  const campaign = getCampaign(campaignId);

  if (!campaign || !campaign.voiceWhitelist || campaign.voiceWhitelist.length === 0) {
    return allVoices;
  }

  return allVoices.filter(v => campaign.voiceWhitelist.includes(v.voice_id));
}

/**
 * Invalidate the voice cache (for manual refresh).
 */
export function invalidateVoiceCache(): void {
  voiceCache = null;
}
