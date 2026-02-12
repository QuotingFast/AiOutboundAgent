import { logger } from '../utils/logger';
import { notifyCallbackExecuting, notifyCallbackFailed } from '../notifications';

// ── Callback Scheduler ─────────────────────────────────────────────
// Checks every 30 seconds for scheduled callbacks that are due and
// fires them via a registered dial function.

export interface ScheduledCallback {
  id: string;
  phone: string;
  leadName: string;
  state?: string;
  reason?: string;
  scheduledAt: string;       // ISO timestamp for when to call
  createdAt: string;
  status: 'pending' | 'dialing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  result?: string;
}

export interface RetryEntry {
  id: string;
  phone: string;
  leadName: string;
  state?: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string;        // ISO timestamp
  createdAt: string;
  status: 'pending' | 'dialing' | 'completed' | 'exhausted';
  lastResult?: string;
}

type DialFn = (phone: string, leadName: string, state?: string) => Promise<boolean>;

const callbacks: ScheduledCallback[] = [];
const retries: RetryEntry[] = [];
let dialFunction: DialFn | null = null;
let timerHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

// Retry delays: 30 min, 2 hours, next day (24h)
const RETRY_DELAYS_MS = [30 * 60_000, 2 * 3600_000, 24 * 3600_000];

// ── Registration ──

export function setDialFunction(fn: DialFn): void {
  dialFunction = fn;
}

// ── Callbacks ──

export function scheduleCallback(opts: {
  phone: string;
  leadName: string;
  state?: string;
  reason?: string;
  scheduledAt: string;
  maxAttempts?: number;
}): ScheduledCallback {
  const cb: ScheduledCallback = {
    id: `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    phone: opts.phone,
    leadName: opts.leadName,
    state: opts.state,
    reason: opts.reason,
    scheduledAt: opts.scheduledAt,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 3,
  };
  callbacks.push(cb);
  logger.info('scheduler', 'Callback scheduled', { id: cb.id, phone: cb.phone, scheduledAt: cb.scheduledAt });
  return cb;
}

export function cancelCallback(id: string): boolean {
  const cb = callbacks.find(c => c.id === id);
  if (cb && cb.status === 'pending') {
    cb.status = 'cancelled';
    return true;
  }
  return false;
}

export function getCallbacks(filter?: { status?: string }): ScheduledCallback[] {
  if (filter?.status) return callbacks.filter(c => c.status === filter.status);
  return [...callbacks];
}

export function getUpcomingCallbacks(): ScheduledCallback[] {
  return callbacks
    .filter(c => c.status === 'pending')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export function getPastCallbacks(limit = 50): ScheduledCallback[] {
  return callbacks
    .filter(c => c.status !== 'pending')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    .slice(0, limit);
}

// ── Retries ──

export function scheduleRetry(opts: {
  phone: string;
  leadName: string;
  state?: string;
  lastResult?: string;
}): RetryEntry | null {
  // Check if already being retried
  const existing = retries.find(r => r.phone === opts.phone && r.status === 'pending');
  if (existing) {
    // Increment retry
    if (existing.retryCount >= existing.maxRetries) {
      existing.status = 'exhausted';
      return null;
    }
    existing.retryCount++;
    existing.lastResult = opts.lastResult;
    const delayMs = RETRY_DELAYS_MS[Math.min(existing.retryCount - 1, RETRY_DELAYS_MS.length - 1)];
    existing.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    logger.info('scheduler', 'Retry rescheduled', { id: existing.id, retryCount: existing.retryCount, nextRetryAt: existing.nextRetryAt });
    return existing;
  }

  const entry: RetryEntry = {
    id: `retry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    phone: opts.phone,
    leadName: opts.leadName,
    state: opts.state,
    retryCount: 1,
    maxRetries: 3,
    nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MS[0]).toISOString(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    lastResult: opts.lastResult,
  };
  retries.push(entry);
  logger.info('scheduler', 'Retry scheduled', { id: entry.id, phone: entry.phone, nextRetryAt: entry.nextRetryAt });
  return entry;
}

export function getRetries(filter?: { status?: string }): RetryEntry[] {
  if (filter?.status) return retries.filter(r => r.status === filter.status);
  return [...retries];
}

// ── Processing Loop ──

async function processDueItems(): Promise<void> {
  if (!dialFunction || running) return;
  running = true;

  const now = Date.now();

  // Process due callbacks
  const dueCallbacks = callbacks.filter(
    c => c.status === 'pending' && new Date(c.scheduledAt).getTime() <= now
  );

  for (const cb of dueCallbacks) {
    cb.status = 'dialing';
    cb.attempts++;
    cb.lastAttemptAt = new Date().toISOString();
    logger.info('scheduler', 'Firing callback', { id: cb.id, phone: cb.phone, attempt: cb.attempts });

    notifyCallbackExecuting(cb.phone, cb.leadName, cb.attempts, cb.maxAttempts).catch(err =>
      logger.error('scheduler', 'Notification error', { error: String(err) })
    );

    try {
      const success = await dialFunction(cb.phone, cb.leadName, cb.state);
      if (success) {
        cb.status = 'completed';
        cb.result = 'connected';
        logger.info('scheduler', 'Callback completed', { id: cb.id });
      } else if (cb.attempts < cb.maxAttempts) {
        // Re-schedule 30 minutes later
        cb.status = 'pending';
        cb.scheduledAt = new Date(now + 30 * 60_000).toISOString();
        cb.result = 'no_answer_retrying';
        logger.info('scheduler', 'Callback rescheduled', { id: cb.id, nextAt: cb.scheduledAt });
      } else {
        cb.status = 'failed';
        cb.result = 'max_attempts_exhausted';
        logger.warn('scheduler', 'Callback failed after max attempts', { id: cb.id });
        notifyCallbackFailed(cb.phone, cb.leadName, cb.attempts).catch(err =>
          logger.error('scheduler', 'Notification error', { error: String(err) })
        );
      }
    } catch (err) {
      cb.status = cb.attempts < cb.maxAttempts ? 'pending' : 'failed';
      cb.result = err instanceof Error ? err.message : String(err);
      if (cb.status === 'pending') {
        cb.scheduledAt = new Date(now + 30 * 60_000).toISOString();
      }
      logger.error('scheduler', 'Callback dial error', { id: cb.id, error: cb.result });
    }
  }

  // Process due retries
  const dueRetries = retries.filter(
    r => r.status === 'pending' && new Date(r.nextRetryAt).getTime() <= now
  );

  for (const retry of dueRetries) {
    retry.status = 'dialing';
    logger.info('scheduler', 'Firing retry', { id: retry.id, phone: retry.phone, attempt: retry.retryCount });

    try {
      const success = await dialFunction(retry.phone, retry.leadName, retry.state);
      if (success) {
        retry.status = 'completed';
        retry.lastResult = 'connected';
      } else if (retry.retryCount < retry.maxRetries) {
        retry.retryCount++;
        const delayMs = RETRY_DELAYS_MS[Math.min(retry.retryCount - 1, RETRY_DELAYS_MS.length - 1)];
        retry.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        retry.status = 'pending';
        retry.lastResult = 'no_answer';
      } else {
        retry.status = 'exhausted';
        retry.lastResult = 'max_retries_exhausted';
        notifyCallbackFailed(retry.phone, retry.leadName, retry.retryCount).catch(err =>
          logger.error('scheduler', 'Notification error', { error: String(err) })
        );
      }
    } catch (err) {
      retry.lastResult = err instanceof Error ? err.message : String(err);
      if (retry.retryCount < retry.maxRetries) {
        retry.retryCount++;
        const delayMs = RETRY_DELAYS_MS[Math.min(retry.retryCount - 1, RETRY_DELAYS_MS.length - 1)];
        retry.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        retry.status = 'pending';
      } else {
        retry.status = 'exhausted';
        notifyCallbackFailed(retry.phone, retry.leadName, retry.retryCount).catch(notifErr =>
          logger.error('scheduler', 'Notification error', { error: String(notifErr) })
        );
      }
    }
  }

  running = false;
}

// ── Lifecycle ──

export function startScheduler(): void {
  if (timerHandle) return;
  logger.info('scheduler', 'Scheduler started (30s interval)');
  timerHandle = setInterval(() => {
    processDueItems().catch(err => {
      logger.error('scheduler', 'Scheduler tick error', { error: err instanceof Error ? err.message : String(err) });
    });
  }, 30_000);
}

export function stopScheduler(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
    logger.info('scheduler', 'Scheduler stopped');
  }
}
