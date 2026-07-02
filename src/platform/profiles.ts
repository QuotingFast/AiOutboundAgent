// ── Agent Profiles ─────────────────────────────────────────────────
// Named, versioned bundles of provider/voice/model/VAD/behavior
// settings that can be applied to the global runtime or a campaign
// without code changes, with full version history and one-click
// rollback. Ships with recommended presets for common call
// environments so tuning starts from a measured baseline.

import crypto from 'crypto';
import { loadData, scheduleSave } from '../db/persistence';
import { getSettings, updateSettings, RuntimeSettings } from '../config/runtime';
import { getCampaign, updateCampaign } from '../campaign/store';
import { recordEvent } from './events';
import { logger } from '../utils/logger';

// The tunable subset of runtime settings a profile controls.
export type ProfileSettings = Partial<Pick<RuntimeSettings,
  | 'voiceProvider' | 'voice' | 'realtimeModel' | 'temperature'
  | 'elevenlabsVoiceId' | 'elevenlabsModelId' | 'elevenlabsStability'
  | 'elevenlabsSimilarityBoost' | 'elevenlabsStyle' | 'elevenlabsUseSpeakerBoost' | 'elevenlabsSpeed'
  | 'deepgramTtsModel'
  | 'vadThreshold' | 'silenceDurationMs' | 'prefixPaddingMs' | 'bargeInDebounceMs' | 'echoSuppressionMs'
  | 'maxResponseTokens' | 'backgroundNoiseEnabled' | 'backgroundNoiseVolume'
  | 'amdEnabled' | 'amdAction' | 'silenceTimeoutSec'
>>;

export interface ProfileVersion {
  version: number;
  settings: ProfileSettings;
  savedAt: string;
  savedBy: string;
  note?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  environment: string;              // e.g. 'clean-mobile', 'noisy', 'high-compliance'
  settings: ProfileSettings;
  versions: ProfileVersion[];       // history, newest last (current = settings)
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORE_KEY = 'platform_profiles';
let profiles: AgentProfile[] = [];

function preset(id: string, name: string, description: string, environment: string, settings: ProfileSettings): AgentProfile {
  const now = new Date().toISOString();
  return {
    id, name, description, environment, settings,
    versions: [{ version: 1, settings, savedAt: now, savedBy: 'system', note: 'built-in preset' }],
    builtin: true, createdAt: now, updatedAt: now,
  };
}

// Baseline reference (documented in the product spec): temperature 0.7,
// VAD 0.8, silence 500ms, debounce 250ms, echo 100ms. The GA realtime
// model uses semantic VAD, where vadThreshold/silence are inert — they
// are still stored so switching back to a server-VAD model restores
// sensible values.
function seedProfiles(): AgentProfile[] {
  return [
    preset('prof_baseline', 'Baseline (reference)', 'The documented reference configuration — start experiments from here.', 'reference', {
      temperature: 0.7, vadThreshold: 0.8, silenceDurationMs: 500, bargeInDebounceMs: 250, echoSuppressionMs: 100,
      maxResponseTokens: 250,
    }),
    preset('prof_clean_mobile', 'Clean Mobile Calls', 'Snappy turn-taking for consumers on decent mobile connections.', 'clean-mobile', {
      temperature: 0.65, vadThreshold: 0.55, silenceDurationMs: 300, prefixPaddingMs: 100,
      bargeInDebounceMs: 100, echoSuppressionMs: 150, maxResponseTokens: 120, backgroundNoiseEnabled: false,
    }),
    preset('prof_noisy', 'Noisy Environment', 'Higher thresholds and longer debounce so background chatter and TVs do not trigger false barge-ins.', 'noisy', {
      temperature: 0.65, vadThreshold: 0.8, silenceDurationMs: 550, prefixPaddingMs: 200,
      bargeInDebounceMs: 300, echoSuppressionMs: 250, maxResponseTokens: 120,
    }),
    preset('prof_older_consumers', 'Older Consumers', 'Slower pace, longer end-of-turn silence, more patience before nudging.', 'older-consumers', {
      temperature: 0.6, silenceDurationMs: 800, bargeInDebounceMs: 250, echoSuppressionMs: 150,
      maxResponseTokens: 150, elevenlabsSpeed: 0.92, silenceTimeoutSec: 45,
    }),
    preset('prof_fast_newlead', 'Fast New-Lead Follow-Up', 'Minimum-latency profile for speed-to-lead dials where energy matters.', 'fast-new-lead', {
      temperature: 0.7, silenceDurationMs: 250, prefixPaddingMs: 80, bargeInDebounceMs: 90,
      echoSuppressionMs: 120, maxResponseTokens: 90,
    }),
    preset('prof_high_compliance', 'High-Compliance Campaigns', 'Conservative behavior: fuller disclosures, AMD always on, no background noise, longer patience.', 'high-compliance', {
      temperature: 0.6, maxResponseTokens: 180, amdEnabled: true, amdAction: 'hangup',
      backgroundNoiseEnabled: false, bargeInDebounceMs: 200, echoSuppressionMs: 150, silenceTimeoutSec: 40,
    }),
  ];
}

export function loadProfiles(): void {
  const saved = loadData<AgentProfile[]>(STORE_KEY);
  if (Array.isArray(saved) && saved.length > 0) {
    profiles = saved;
    // Ensure built-ins exist even if the store predates a new preset.
    for (const p of seedProfiles()) {
      if (!profiles.some(x => x.id === p.id)) profiles.push(p);
    }
  } else {
    profiles = seedProfiles();
  }
  persist();
  logger.info('profiles', `Loaded ${profiles.length} agent profiles`);
}

function persist(): void { scheduleSave(STORE_KEY, () => profiles); }

export function listProfiles(): AgentProfile[] { return profiles; }
export function getProfile(id: string): AgentProfile | undefined { return profiles.find(p => p.id === id); }

export function upsertProfile(input: { id?: string; name: string; description?: string; environment?: string; settings: ProfileSettings; note?: string }, actor = 'system'): AgentProfile {
  const now = new Date().toISOString();
  const existing = input.id ? profiles.find(p => p.id === input.id) : undefined;
  if (existing) {
    const version = (existing.versions[existing.versions.length - 1]?.version || 0) + 1;
    existing.versions.push({ version, settings: input.settings, savedAt: now, savedBy: actor, note: input.note });
    if (existing.versions.length > 25) existing.versions = existing.versions.slice(-25);
    existing.settings = input.settings;
    existing.name = input.name;
    if (input.description !== undefined) existing.description = input.description;
    if (input.environment !== undefined) existing.environment = input.environment;
    existing.updatedAt = now;
    persist();
    recordEvent('config.changed', { scope: 'profile', profileId: existing.id, version, action: 'updated' }, { actor });
    return existing;
  }
  const profile: AgentProfile = {
    id: `prof_${crypto.randomBytes(4).toString('hex')}`,
    name: input.name,
    description: input.description || '',
    environment: input.environment || 'custom',
    settings: input.settings,
    versions: [{ version: 1, settings: input.settings, savedAt: now, savedBy: actor, note: input.note }],
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  persist();
  recordEvent('config.changed', { scope: 'profile', profileId: profile.id, action: 'created' }, { actor });
  return profile;
}

export function rollbackProfile(id: string, toVersion: number, actor = 'system'): AgentProfile | undefined {
  const p = profiles.find(x => x.id === id);
  if (!p) return undefined;
  const target = p.versions.find(v => v.version === toVersion);
  if (!target) return undefined;
  const now = new Date().toISOString();
  const newVersion = (p.versions[p.versions.length - 1]?.version || 0) + 1;
  p.versions.push({ version: newVersion, settings: target.settings, savedAt: now, savedBy: actor, note: `rollback to v${toVersion}` });
  p.settings = target.settings;
  p.updatedAt = now;
  persist();
  recordEvent('profile.rolledback', { profileId: id, from: newVersion - 1, to: toVersion }, { actor });
  return p;
}

export function deleteProfile(id: string, actor = 'system'): boolean {
  const p = profiles.find(x => x.id === id);
  if (!p || p.builtin) return false;
  profiles = profiles.filter(x => x.id !== id);
  persist();
  recordEvent('config.changed', { scope: 'profile', profileId: id, action: 'deleted' }, { actor });
  return true;
}

/** Apply a profile to the global runtime settings. Returns what changed. */
export function applyProfileToRuntime(id: string, actor = 'system'): { applied: ProfileSettings; before: ProfileSettings } | undefined {
  const p = profiles.find(x => x.id === id);
  if (!p) return undefined;
  const current = getSettings();
  const before: ProfileSettings = {};
  for (const k of Object.keys(p.settings) as Array<keyof ProfileSettings>) {
    (before as Record<string, unknown>)[k] = (current as unknown as Record<string, unknown>)[k];
  }
  updateSettings(p.settings as Partial<RuntimeSettings>);
  recordEvent('profile.applied', { profileId: id, scope: 'runtime', settings: p.settings, before }, { actor });
  return { applied: p.settings, before };
}

/** Apply a profile's voice/model settings onto a campaign's AI/voice config. */
export function applyProfileToCampaign(id: string, campaignId: string, actor = 'system'): boolean {
  const p = profiles.find(x => x.id === id);
  const campaign = getCampaign(campaignId);
  if (!p || !campaign) return false;
  const s = p.settings;
  const aiProfile = { ...campaign.aiProfile };
  if (s.realtimeModel !== undefined) aiProfile.realtimeModel = s.realtimeModel;
  if (s.temperature !== undefined) aiProfile.temperature = s.temperature;
  if (s.maxResponseTokens !== undefined) aiProfile.maxResponseTokens = s.maxResponseTokens;
  const voiceConfig = { ...campaign.voiceConfig };
  if (s.voiceProvider !== undefined) voiceConfig.voiceProvider = s.voiceProvider;
  if (s.voice !== undefined) voiceConfig.openaiVoice = s.voice;
  if (s.elevenlabsVoiceId !== undefined) voiceConfig.elevenlabsVoiceId = s.elevenlabsVoiceId;
  if (s.elevenlabsModelId !== undefined) voiceConfig.elevenlabsModelId = s.elevenlabsModelId;
  if (s.elevenlabsStability !== undefined) voiceConfig.elevenlabsStability = s.elevenlabsStability;
  if (s.elevenlabsSimilarityBoost !== undefined) voiceConfig.elevenlabsSimilarityBoost = s.elevenlabsSimilarityBoost;
  if (s.elevenlabsStyle !== undefined) voiceConfig.elevenlabsStyle = s.elevenlabsStyle;
  if (s.elevenlabsUseSpeakerBoost !== undefined) voiceConfig.elevenlabsUseSpeakerBoost = s.elevenlabsUseSpeakerBoost;
  if (s.elevenlabsSpeed !== undefined) voiceConfig.elevenlabsSpeed = s.elevenlabsSpeed;
  updateCampaign(campaignId, { aiProfile, voiceConfig });
  recordEvent('profile.applied', { profileId: id, scope: 'campaign', settings: p.settings }, { actor, campaignId });
  return true;
}
