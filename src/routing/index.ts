import { logger } from '../utils/logger';

// ── Model Routing & Fallbacks ───────────────────────────────────────

export interface ModelProvider {
  id: string;
  name: string;
  type: 'openai-realtime' | 'openai-chat' | 'anthropic' | 'google';
  model: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;  // Lower = higher priority
  costPerMinute: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  healthCheck: boolean;
  lastHealthCheck?: number;
  failureCount: number;
  maxFailures: number;
}

const providers = new Map<string, ModelProvider>();

// Track latency per provider
const latencyHistory = new Map<string, number[]>();

export function registerProvider(provider: ModelProvider): void {
  providers.set(provider.id, provider);
  latencyHistory.set(provider.id, []);
  logger.info('routing', 'Provider registered', { id: provider.id, model: provider.model });
}

export function getProviders(): ModelProvider[] {
  return Array.from(providers.values()).sort((a, b) => a.priority - b.priority);
}

export function getProvider(id: string): ModelProvider | undefined {
  return providers.get(id);
}

export function removeProvider(id: string): boolean {
  latencyHistory.delete(id);
  return providers.delete(id);
}

// ── Routing Logic ──

export type RoutingStrategy = 'priority' | 'lowest_cost' | 'lowest_latency' | 'round_robin';

let currentStrategy: RoutingStrategy = 'priority';
let roundRobinIndex = 0;

export function setRoutingStrategy(strategy: RoutingStrategy): void {
  currentStrategy = strategy;
  logger.info('routing', 'Strategy changed', { strategy });
}

export function getRoutingStrategy(): RoutingStrategy {
  return currentStrategy;
}

export function selectProvider(): ModelProvider | undefined {
  const available = Array.from(providers.values())
    .filter(p => p.enabled && p.failureCount < p.maxFailures);

  if (available.length === 0) {
    logger.error('routing', 'No available providers');
    return undefined;
  }

  switch (currentStrategy) {
    case 'lowest_cost':
      return available.sort((a, b) => a.costPerMinute - b.costPerMinute)[0];

    case 'lowest_latency':
      return available.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];

    case 'round_robin': {
      roundRobinIndex = (roundRobinIndex + 1) % available.length;
      return available[roundRobinIndex];
    }

    case 'priority':
    default:
      return available.sort((a, b) => a.priority - b.priority)[0];
  }
}

// ── Fallback Chain ──

export function selectWithFallback(): ModelProvider | undefined {
  const sorted = Array.from(providers.values())
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const provider of sorted) {
    if (provider.failureCount < provider.maxFailures) {
      return provider;
    }
  }

  // All providers exhausted — reset failure counts and try again
  logger.warn('routing', 'All providers exhausted, resetting failure counts');
  for (const p of providers.values()) {
    p.failureCount = 0;
  }
  return sorted[0];
}

// ── Health & Metrics ──

export function recordProviderLatency(id: string, latencyMs: number): void {
  const provider = providers.get(id);
  if (!provider) return;

  const history = latencyHistory.get(id) || [];
  history.push(latencyMs);
  if (history.length > 100) history.shift();
  latencyHistory.set(id, history);

  // Update rolling average
  provider.avgLatencyMs = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
}

export function recordProviderFailure(id: string): void {
  const provider = providers.get(id);
  if (!provider) return;

  provider.failureCount++;
  logger.warn('routing', 'Provider failure recorded', {
    id,
    failureCount: provider.failureCount,
    maxFailures: provider.maxFailures,
    willDisable: provider.failureCount >= provider.maxFailures,
  });
}

export function recordProviderSuccess(id: string): void {
  const provider = providers.get(id);
  if (!provider) return;

  // Decay failure count on success
  if (provider.failureCount > 0) {
    provider.failureCount = Math.max(0, provider.failureCount - 1);
  }
  provider.lastHealthCheck = Date.now();
}

export function getProviderHealth(): {
  providers: Array<{
    id: string;
    name: string;
    model: string;
    enabled: boolean;
    avgLatencyMs: number;
    failureCount: number;
    status: 'healthy' | 'degraded' | 'down';
  }>;
  activeProvider?: string;
} {
  const providerHealth = Array.from(providers.values()).map(p => ({
    id: p.id,
    name: p.name,
    model: p.model,
    enabled: p.enabled,
    avgLatencyMs: p.avgLatencyMs,
    failureCount: p.failureCount,
    status: (p.failureCount >= p.maxFailures ? 'down' :
             p.failureCount > 0 ? 'degraded' : 'healthy') as 'healthy' | 'degraded' | 'down',
  }));

  const active = selectProvider();
  return {
    providers: providerHealth,
    activeProvider: active?.id,
  };
}
