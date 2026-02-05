import { logger } from '../utils/logger';

// ── Prompt Versioning ───────────────────────────────────────────────

export interface PromptVersion {
  id: string;
  name: string;
  content: string;
  version: number;
  environment: 'dev' | 'staging' | 'prod';
  active: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const promptVersions = new Map<string, PromptVersion[]>();
let currentEnvironment: PromptVersion['environment'] = 'prod';

export function setEnvironment(env: PromptVersion['environment']): void {
  currentEnvironment = env;
  logger.info('prompts', 'Environment set', { env });
}

export function getEnvironment(): string {
  return currentEnvironment;
}

export function savePromptVersion(
  name: string,
  content: string,
  environment?: PromptVersion['environment'],
  metadata?: Record<string, unknown>,
): PromptVersion {
  const env = environment || currentEnvironment;
  const versions = promptVersions.get(name) || [];
  const version = versions.length + 1;

  // Deactivate previous active version for this env
  for (const v of versions) {
    if (v.environment === env && v.active) {
      v.active = false;
    }
  }

  const pv: PromptVersion = {
    id: `${name}-v${version}-${env}`,
    name,
    content,
    version,
    environment: env,
    active: true,
    createdAt: new Date().toISOString(),
    metadata,
  };

  versions.push(pv);
  promptVersions.set(name, versions);

  logger.info('prompts', 'Prompt version saved', { name, version, env });
  return pv;
}

export function getActivePrompt(name: string, environment?: PromptVersion['environment']): PromptVersion | undefined {
  const env = environment || currentEnvironment;
  const versions = promptVersions.get(name) || [];
  return versions.find(v => v.active && v.environment === env);
}

export function getPromptVersions(name: string): PromptVersion[] {
  return promptVersions.get(name) || [];
}

export function rollbackPrompt(name: string, version: number): PromptVersion | undefined {
  const versions = promptVersions.get(name) || [];
  const target = versions.find(v => v.version === version);
  if (!target) return undefined;

  // Deactivate all for this env, activate target
  for (const v of versions) {
    if (v.environment === target.environment) {
      v.active = v.id === target.id;
    }
  }

  logger.info('prompts', 'Prompt rolled back', { name, version, env: target.environment });
  return target;
}

export function getAllPromptNames(): string[] {
  return Array.from(promptVersions.keys());
}

// ── Feature Flags ───────────────────────────────────────────────────

export interface FeatureFlag {
  id: string;
  description: string;
  enabled: boolean;
  environments: PromptVersion['environment'][];
  percentage?: number;  // Gradual rollout 0-100
  createdAt: string;
}

const featureFlags = new Map<string, FeatureFlag>();

export function setFeatureFlag(
  id: string,
  enabled: boolean,
  description?: string,
  environments?: PromptVersion['environment'][],
  percentage?: number,
): FeatureFlag {
  const existing = featureFlags.get(id);
  const flag: FeatureFlag = {
    id,
    description: description || existing?.description || id,
    enabled,
    environments: environments || existing?.environments || ['dev', 'staging', 'prod'],
    percentage,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  featureFlags.set(id, flag);
  return flag;
}

export function isFeatureEnabled(id: string, environment?: PromptVersion['environment']): boolean {
  const flag = featureFlags.get(id);
  if (!flag || !flag.enabled) return false;

  const env = environment || currentEnvironment;
  if (!flag.environments.includes(env)) return false;

  // Percentage-based rollout
  if (flag.percentage !== undefined && flag.percentage < 100) {
    return Math.random() * 100 < flag.percentage;
  }

  return true;
}

export function getFeatureFlags(): FeatureFlag[] {
  return Array.from(featureFlags.values());
}

export function deleteFeatureFlag(id: string): boolean {
  return featureFlags.delete(id);
}

// ── Hot-swap Configuration ──────────────────────────────────────────

export interface HotSwapConfig {
  promptOverride?: string;
  voiceOverride?: string;
  modelOverride?: string;
  temperatureOverride?: number;
  maxTokensOverride?: number;
  toolsEnabled: string[];
  guardrails: GuardrailConfig;
}

export interface GuardrailConfig {
  maxResponseLength: number;        // Max characters per response
  prohibitedTopics: string[];       // Topics to avoid
  requiredDisclosures: string[];    // Must-say phrases
  toneGuidelines: string;           // Tone direction
  escalationTriggers: string[];     // When to escalate to human
}

const defaultGuardrails: GuardrailConfig = {
  maxResponseLength: 200,
  prohibitedTopics: ['politics', 'religion', 'competitors_negative'],
  requiredDisclosures: ['call recording disclosure'],
  toneGuidelines: 'Friendly, conversational, not pushy. Natural human-like speech.',
  escalationTriggers: ['legal_threat', 'harassment_claim', 'explicit_anger'],
};

let hotSwapConfig: HotSwapConfig = {
  toolsEnabled: ['transfer_call', 'end_call'],
  guardrails: { ...defaultGuardrails },
};

export function getHotSwapConfig(): HotSwapConfig {
  return { ...hotSwapConfig, guardrails: { ...hotSwapConfig.guardrails } };
}

export function updateHotSwapConfig(updates: Partial<HotSwapConfig>): HotSwapConfig {
  if (updates.guardrails) {
    hotSwapConfig.guardrails = { ...hotSwapConfig.guardrails, ...updates.guardrails };
    delete updates.guardrails;
  }
  Object.assign(hotSwapConfig, updates);
  logger.info('prompts', 'Hot-swap config updated', { keys: Object.keys(updates) });
  return getHotSwapConfig();
}

export function getGuardrails(): GuardrailConfig {
  return { ...hotSwapConfig.guardrails };
}
