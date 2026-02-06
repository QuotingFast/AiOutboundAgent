import { logger } from '../utils/logger';
import { isKillSwitchActive } from './flags';

// ── FEATURE_GLOBAL_KILL_SWITCH ─────────────────────────────────────
// When enabled, ALL outbound dialing is immediately blocked.
// This is the single guard check that should be called before any
// outbound call or scheduled callback execution.

/**
 * Guard check: returns true if outbound dialing is allowed.
 * Returns false (blocks) if the kill switch is active.
 * Call this at the safest central location before placing any outbound call.
 */
export function isOutboundDialingAllowed(workspaceId?: string): boolean {
  if (isKillSwitchActive(workspaceId)) {
    logger.warn('features', 'Outbound dialing BLOCKED — kill switch is active', { workspaceId });
    return false;
  }
  return true;
}
