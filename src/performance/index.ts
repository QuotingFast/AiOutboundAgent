import { logger } from '../utils/logger';

// ── Concurrency Control ─────────────────────────────────────────────

export interface SessionInfo {
  callSid: string;
  startTime: number;
  phone: string;
  leadName: string;
  status: 'active' | 'transferring' | 'ending';
}

const activeSessions = new Map<string, SessionInfo>();
let maxConcurrentCalls = 10;

export function setMaxConcurrency(max: number): void {
  maxConcurrentCalls = Math.max(1, max);
}

export function getMaxConcurrency(): number {
  return maxConcurrentCalls;
}

export function canAcceptCall(): boolean {
  return activeSessions.size < maxConcurrentCalls;
}

export function registerSession(callSid: string, phone: string, leadName: string): boolean {
  if (!canAcceptCall()) {
    logger.warn('performance', 'Rejected call: max concurrency reached', {
      current: activeSessions.size,
      max: maxConcurrentCalls,
    });
    return false;
  }

  activeSessions.set(callSid, {
    callSid,
    startTime: Date.now(),
    phone,
    leadName,
    status: 'active',
  });

  logger.info('performance', 'Session registered', {
    callSid,
    activeSessions: activeSessions.size,
  });
  return true;
}

export function updateSessionStatus(callSid: string, status: SessionInfo['status']): void {
  const session = activeSessions.get(callSid);
  if (session) session.status = status;
}

export function removeSession(callSid: string): void {
  activeSessions.delete(callSid);
  logger.info('performance', 'Session removed', {
    callSid,
    activeSessions: activeSessions.size,
  });
}

export function getActiveSessions(): SessionInfo[] {
  return Array.from(activeSessions.values());
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}

// ── Call Queue ───────────────────────────────────────────────────────

export interface QueuedCall {
  id: string;
  to: string;
  from?: string;
  lead: { first_name: string; state?: string };
  priority: number; // 1 = highest, 10 = lowest
  queuedAt: number;
  attempts: number;
  maxAttempts: number;
}

const callQueue: QueuedCall[] = [];
let queueProcessing = false;
let queueProcessorCallback: ((item: QueuedCall) => Promise<boolean>) | null = null;

export function enqueueCall(call: Omit<QueuedCall, 'id' | 'queuedAt' | 'attempts'>): QueuedCall {
  const queued: QueuedCall = {
    ...call,
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    queuedAt: Date.now(),
    attempts: 0,
  };

  // Insert in priority order
  const idx = callQueue.findIndex(c => c.priority > queued.priority);
  if (idx >= 0) {
    callQueue.splice(idx, 0, queued);
  } else {
    callQueue.push(queued);
  }

  logger.info('performance', 'Call queued', { id: queued.id, to: queued.to, priority: queued.priority, queueSize: callQueue.length });

  // Try to process queue
  processQueue();

  return queued;
}

export function getQueue(): QueuedCall[] {
  return [...callQueue];
}

export function getQueueSize(): number {
  return callQueue.length;
}

export function removeFromQueue(id: string): boolean {
  const idx = callQueue.findIndex(c => c.id === id);
  if (idx >= 0) {
    callQueue.splice(idx, 1);
    return true;
  }
  return false;
}

export function setQueueProcessor(callback: (item: QueuedCall) => Promise<boolean>): void {
  queueProcessorCallback = callback;
}

async function processQueue(): Promise<void> {
  if (queueProcessing || !queueProcessorCallback || callQueue.length === 0) return;
  if (!canAcceptCall()) return;

  queueProcessing = true;

  while (callQueue.length > 0 && canAcceptCall()) {
    const item = callQueue.shift();
    if (!item) break;

    item.attempts++;
    try {
      const success = await queueProcessorCallback(item);
      if (!success && item.attempts < item.maxAttempts) {
        // Re-queue with lower priority
        item.priority = Math.min(10, item.priority + 1);
        callQueue.push(item);
      }
    } catch (err) {
      logger.error('performance', 'Queue processor error', {
        id: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (item.attempts < item.maxAttempts) {
        callQueue.push(item);
      }
    }
  }

  queueProcessing = false;
}

// Process queue when sessions free up
export function onSessionFreed(): void {
  processQueue();
}

// ── Backpressure ────────────────────────────────────────────────────

export interface SystemHealth {
  activeSessions: number;
  maxSessions: number;
  queueSize: number;
  utilization: number;  // 0-100%
  status: 'healthy' | 'busy' | 'overloaded';
  uptime: number;
}

const startTime = Date.now();

export function getSystemHealth(): SystemHealth {
  const active = activeSessions.size;
  const utilization = Math.round((active / maxConcurrentCalls) * 100);

  let status: SystemHealth['status'] = 'healthy';
  if (utilization > 90) status = 'overloaded';
  else if (utilization > 70) status = 'busy';

  return {
    activeSessions: active,
    maxSessions: maxConcurrentCalls,
    queueSize: callQueue.length,
    utilization,
    status,
    uptime: Date.now() - startTime,
  };
}
