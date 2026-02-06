import { logger } from '../utils/logger';
import { resolveFeatureFlag, FEATURE_SCHEDULED_CALLBACKS } from './flags';
import { isOutboundDialingAllowed } from './kill-switch';
import { runPreCallComplianceCheck } from '../compliance';

// ── FEATURE_SCHEDULED_CALLBACKS ────────────────────────────────────
// When enabled, callback times result in actual outbound calls.
// Respects quiet hours, suppression (DNC), and the kill switch.

export type CallbackStatus = 'pending' | 'attempted' | 'completed' | 'cancelled';

export interface ScheduledCallback {
  id: string;
  leadId: string;       // phone number (normalized)
  leadName: string;
  leadState?: string;
  scheduledAt: string;   // ISO datetime
  status: CallbackStatus;
  createdAt: string;
  attemptedAt?: string;
  completedAt?: string;
  callSid?: string;      // populated when the callback call is placed
  workspaceId?: string;
  campaignId?: string;
}

// In-memory store for scheduled callbacks
const callbackStore = new Map<string, ScheduledCallback>();
let callbackSequence = 0;

// Callback processor — set from routes/server to avoid circular deps
let callbackDialer: ((cb: ScheduledCallback) => Promise<string | null>) | null = null;

/**
 * Register the dialer function that places actual callback calls.
 * This should be set once during server initialization.
 */
export function setCallbackDialer(dialer: (cb: ScheduledCallback) => Promise<string | null>): void {
  callbackDialer = dialer;
}

/**
 * Schedule a callback. Stores it in pending state.
 * The callback processor will pick it up when the time comes.
 */
export function createScheduledCallback(params: {
  leadId: string;
  leadName: string;
  leadState?: string;
  scheduledAt: string;
  workspaceId?: string;
  campaignId?: string;
}): ScheduledCallback {
  const id = `cb-${++callbackSequence}-${Date.now()}`;
  const callback: ScheduledCallback = {
    id,
    leadId: params.leadId,
    leadName: params.leadName,
    leadState: params.leadState,
    scheduledAt: params.scheduledAt,
    status: 'pending',
    createdAt: new Date().toISOString(),
    workspaceId: params.workspaceId,
    campaignId: params.campaignId,
  };
  callbackStore.set(id, callback);
  logger.info('features', 'Callback scheduled', { id, leadId: params.leadId, scheduledAt: params.scheduledAt });
  return callback;
}

/**
 * Cancel a scheduled callback.
 */
export function cancelScheduledCallback(id: string): boolean {
  const cb = callbackStore.get(id);
  if (!cb || cb.status !== 'pending') return false;
  cb.status = 'cancelled';
  logger.info('features', 'Callback cancelled', { id });
  return true;
}

/**
 * Get all scheduled callbacks, optionally filtered by status.
 */
export function getScheduledCallbacks(status?: CallbackStatus): ScheduledCallback[] {
  const all = Array.from(callbackStore.values());
  if (status) return all.filter(cb => cb.status === status);
  return all;
}

/**
 * Get a single callback by ID.
 */
export function getScheduledCallback(id: string): ScheduledCallback | undefined {
  return callbackStore.get(id);
}

/**
 * Process due callbacks: find pending callbacks whose scheduled time has passed,
 * check compliance, and place calls via the registered dialer.
 * This should be called on a regular interval (e.g., every 30 seconds).
 */
export async function processDueCallbacks(workspaceId?: string): Promise<number> {
  // Feature flag check
  if (!resolveFeatureFlag(FEATURE_SCHEDULED_CALLBACKS, workspaceId)) {
    return 0;
  }

  // Kill switch check
  if (!isOutboundDialingAllowed(workspaceId)) {
    return 0;
  }

  if (!callbackDialer) {
    logger.warn('features', 'Callback dialer not registered — skipping processing');
    return 0;
  }

  const now = new Date();
  let processed = 0;

  for (const cb of callbackStore.values()) {
    if (cb.status !== 'pending') continue;

    const scheduledTime = new Date(cb.scheduledAt);
    if (scheduledTime > now) continue;

    // Compliance check (quiet hours + DNC)
    const compliance = runPreCallComplianceCheck(cb.leadId, cb.leadState);
    if (!compliance.allowed) {
      logger.info('features', 'Callback blocked by compliance', {
        id: cb.id,
        leadId: cb.leadId,
        reasons: compliance.checks,
      });
      // Don't cancel — it may become allowed later (e.g., quiet hours pass)
      continue;
    }

    // Kill switch re-check (could have changed during loop)
    if (!isOutboundDialingAllowed(cb.workspaceId)) {
      break;
    }

    cb.status = 'attempted';
    cb.attemptedAt = new Date().toISOString();

    try {
      const callSid = await callbackDialer(cb);
      if (callSid) {
        cb.callSid = callSid;
        cb.status = 'completed';
        cb.completedAt = new Date().toISOString();
        logger.info('features', 'Callback executed', { id: cb.id, callSid });
      } else {
        logger.warn('features', 'Callback dial returned no callSid', { id: cb.id });
      }
      processed++;
    } catch (err) {
      logger.error('features', 'Callback dial failed', {
        id: cb.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return processed;
}

// ── Callback processor interval ────────────────────────────────────

let processorInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the callback processor that checks for due callbacks every intervalMs.
 */
export function startCallbackProcessor(intervalMs = 30000, workspaceId?: string): void {
  if (processorInterval) return; // Already running
  processorInterval = setInterval(() => {
    processDueCallbacks(workspaceId).catch(err =>
      logger.error('features', 'Callback processor error', { error: String(err) })
    );
  }, intervalMs);
  logger.info('features', 'Callback processor started', { intervalMs });
}

/**
 * Stop the callback processor.
 */
export function stopCallbackProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    logger.info('features', 'Callback processor stopped');
  }
}
