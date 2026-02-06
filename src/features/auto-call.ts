import { logger } from '../utils/logger';
import { resolveAutoCall } from './flags';
import { isOutboundDialingAllowed } from './kill-switch';

// ── FEATURE_AUTO_CALL_NEW_LEADS ────────────────────────────────────
// When enabled, new leads automatically enter the dialing flow.
// When disabled, leads are ingested normally but NOT dialed.
// No retroactive behavior — only gates the lead→dialer entry point.

/**
 * Determine whether a new lead should be auto-dialed.
 * Checks both the auto-call flag AND the kill switch.
 * Returns { allowed, reason } so callers can log the decision.
 */
export function shouldAutoCallLead(
  workspaceId?: string,
  campaignId?: string,
): { allowed: boolean; reason: string } {
  // Kill switch takes absolute precedence
  if (!isOutboundDialingAllowed(workspaceId)) {
    return { allowed: false, reason: 'kill_switch_active' };
  }

  // Check auto-call feature flag (workspace + campaign override)
  if (!resolveAutoCall(workspaceId, campaignId)) {
    logger.info('features', 'Auto-call disabled for this context', { workspaceId, campaignId });
    return { allowed: false, reason: 'auto_call_disabled' };
  }

  return { allowed: true, reason: 'auto_call_enabled' };
}
