import { logger } from '../utils/logger';

// ── Feature Flag Constants ─────────────────────────────────────────
// All flags default to OFF. Enable at workspace level, override at campaign level.

export const FEATURE_AUTO_CALL_NEW_LEADS = 'FEATURE_AUTO_CALL_NEW_LEADS';
export const FEATURE_SCHEDULED_CALLBACKS = 'FEATURE_SCHEDULED_CALLBACKS';
export const FEATURE_AI_SMS_AUTOMATION = 'FEATURE_AI_SMS_AUTOMATION';
export const FEATURE_WARM_HANDOFF = 'FEATURE_WARM_HANDOFF';
export const FEATURE_CALL_DISPOSITIONS = 'FEATURE_CALL_DISPOSITIONS';
export const FEATURE_AI_CALL_NOTES = 'FEATURE_AI_CALL_NOTES';
export const FEATURE_GLOBAL_KILL_SWITCH = 'FEATURE_GLOBAL_KILL_SWITCH';

export const ALL_FEATURE_FLAGS = [
  FEATURE_AUTO_CALL_NEW_LEADS,
  FEATURE_SCHEDULED_CALLBACKS,
  FEATURE_AI_SMS_AUTOMATION,
  FEATURE_WARM_HANDOFF,
  FEATURE_CALL_DISPOSITIONS,
  FEATURE_AI_CALL_NOTES,
  FEATURE_GLOBAL_KILL_SWITCH,
] as const;

export type FeatureFlagId = typeof ALL_FEATURE_FLAGS[number];

// ── Default workspace for single-tenant backwards compatibility ────

export const DEFAULT_WORKSPACE = 'default';

// ── Workspace-level flag storage ───────────────────────────────────
// Map<workspaceId, Map<flagId, enabled>>

const workspaceFlags = new Map<string, Map<string, boolean>>();

// ── Campaign-level override storage ────────────────────────────────
// Map<"workspaceId:campaignId", Map<flagId, enabled>>

const campaignOverrides = new Map<string, Map<string, boolean>>();

// ── Helper: build campaign key ─────────────────────────────────────

function campaignKey(workspaceId: string, campaignId: string): string {
  return `${workspaceId}:${campaignId}`;
}

// ── Core resolution: campaign override > workspace > default (OFF) ─

/**
 * Resolve whether a feature flag is enabled.
 * Resolution order: campaign override > workspace flag > default OFF.
 * This is the single runtime check all feature gates should use.
 */
export function resolveFeatureFlag(
  flagId: string,
  workspaceId?: string,
  campaignId?: string,
): boolean {
  const wsId = workspaceId || DEFAULT_WORKSPACE;

  // Campaign-level override takes precedence
  if (campaignId) {
    const key = campaignKey(wsId, campaignId);
    const overrides = campaignOverrides.get(key);
    if (overrides && overrides.has(flagId)) {
      return overrides.get(flagId)!;
    }
  }

  // Workspace-level flag
  const wsFlags = workspaceFlags.get(wsId);
  if (wsFlags && wsFlags.has(flagId)) {
    return wsFlags.get(flagId)!;
  }

  // Default: OFF
  return false;
}

// ── Convenience: resolve auto-call specifically ────────────────────

export function resolveAutoCall(workspaceId?: string, campaignId?: string): boolean {
  return resolveFeatureFlag(FEATURE_AUTO_CALL_NEW_LEADS, workspaceId, campaignId);
}

// ── Convenience: check kill switch ─────────────────────────────────

export function isKillSwitchActive(workspaceId?: string): boolean {
  return resolveFeatureFlag(FEATURE_GLOBAL_KILL_SWITCH, workspaceId);
}

// ── Workspace flag management ──────────────────────────────────────

export function setWorkspaceFlag(
  flagId: string,
  enabled: boolean,
  workspaceId?: string,
): void {
  const wsId = workspaceId || DEFAULT_WORKSPACE;
  let wsFlags = workspaceFlags.get(wsId);
  if (!wsFlags) {
    wsFlags = new Map();
    workspaceFlags.set(wsId, wsFlags);
  }
  wsFlags.set(flagId, enabled);
  logger.info('features', 'Workspace flag set', { workspaceId: wsId, flagId, enabled });
}

export function getWorkspaceFlags(workspaceId?: string): Record<string, boolean> {
  const wsId = workspaceId || DEFAULT_WORKSPACE;
  const wsFlags = workspaceFlags.get(wsId);
  if (!wsFlags) return {};
  const result: Record<string, boolean> = {};
  for (const [k, v] of wsFlags) {
    result[k] = v;
  }
  return result;
}

// ── Campaign override management ───────────────────────────────────

export function setCampaignOverride(
  flagId: string,
  enabled: boolean,
  campaignId: string,
  workspaceId?: string,
): void {
  const wsId = workspaceId || DEFAULT_WORKSPACE;
  const key = campaignKey(wsId, campaignId);
  let overrides = campaignOverrides.get(key);
  if (!overrides) {
    overrides = new Map();
    campaignOverrides.set(key, overrides);
  }
  overrides.set(flagId, enabled);
  logger.info('features', 'Campaign override set', { workspaceId: wsId, campaignId, flagId, enabled });
}

export function removeCampaignOverride(
  flagId: string,
  campaignId: string,
  workspaceId?: string,
): void {
  const wsId = workspaceId || DEFAULT_WORKSPACE;
  const key = campaignKey(wsId, campaignId);
  const overrides = campaignOverrides.get(key);
  if (overrides) {
    overrides.delete(flagId);
    logger.info('features', 'Campaign override removed', { workspaceId: wsId, campaignId, flagId });
  }
}

export function getCampaignOverrides(
  campaignId: string,
  workspaceId?: string,
): Record<string, boolean> {
  const wsId = workspaceId || DEFAULT_WORKSPACE;
  const key = campaignKey(wsId, campaignId);
  const overrides = campaignOverrides.get(key);
  if (!overrides) return {};
  const result: Record<string, boolean> = {};
  for (const [k, v] of overrides) {
    result[k] = v;
  }
  return result;
}

// ── Bulk status: get all flags resolved for a workspace+campaign ───

export function getAllResolvedFlags(
  workspaceId?: string,
  campaignId?: string,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flagId of ALL_FEATURE_FLAGS) {
    result[flagId] = resolveFeatureFlag(flagId, workspaceId, campaignId);
  }
  return result;
}
