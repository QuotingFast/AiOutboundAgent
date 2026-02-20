import { logger } from '../utils/logger';

// ── A/B Test Framework ──────────────────────────────────────────────

export interface ABTestVariant {
  id: string;
  name: string;
  weight: number;  // 0-100, all variants should sum to 100
  config: Record<string, unknown>;
}

export interface ABTest {
  id: string;
  name: string;
  description: string;
  active: boolean;
  type: 'prompt' | 'voice' | 'settings' | 'flow';
  variants: ABTestVariant[];
  results: ABTestResults;
  createdAt: string;
}

export interface ABTestResults {
  totalAssignments: number;
  variantStats: Record<string, VariantStats>;
}

export interface VariantStats {
  assignments: number;
  calls: number;
  transfers: number;
  avgDurationMs: number;
  avgScore: number;
  totalCostUsd: number;
  conversionRate: number;
}

// ── Store ──

const abTests = new Map<string, ABTest>();

export function createABTest(test: Omit<ABTest, 'results' | 'createdAt'>): ABTest {
  const fullTest: ABTest = {
    ...test,
    createdAt: new Date().toISOString(),
    results: {
      totalAssignments: 0,
      variantStats: {},
    },
  };

  // Initialize variant stats
  for (const v of test.variants) {
    fullTest.results.variantStats[v.id] = {
      assignments: 0, calls: 0, transfers: 0,
      avgDurationMs: 0, avgScore: 0, totalCostUsd: 0, conversionRate: 0,
    };
  }

  abTests.set(test.id, fullTest);
  logger.info('ab-test', 'Test created', { id: test.id, name: test.name, variants: test.variants.length });
  return fullTest;
}

export function getABTest(id: string): ABTest | undefined {
  return abTests.get(id);
}

export function getAllABTests(): ABTest[] {
  return Array.from(abTests.values());
}

export function deleteABTest(id: string): boolean {
  return abTests.delete(id);
}

export function toggleABTest(id: string, active: boolean): ABTest | undefined {
  const test = abTests.get(id);
  if (test) {
    test.active = active;
    return test;
  }
  return undefined;
}

// ── Assignment ──

export function assignVariant(testId: string): ABTestVariant | undefined {
  const test = abTests.get(testId);
  if (!test || !test.active || test.variants.length === 0) return undefined;

  // Weighted random selection
  const totalWeight = test.variants.reduce((sum, v) => sum + v.weight, 0);
  const rand = Math.random() * totalWeight;
  let cumulative = 0;

  for (const variant of test.variants) {
    cumulative += variant.weight;
    if (rand < cumulative) {
      test.results.totalAssignments++;
      test.results.variantStats[variant.id].assignments++;
      logger.debug('ab-test', 'Variant assigned', {
        testId,
        variantId: variant.id,
        variantName: variant.name,
      });
      return variant;
    }
  }

  // Fallback to first variant
  const fallback = test.variants[0];
  test.results.totalAssignments++;
  test.results.variantStats[fallback.id].assignments++;
  return fallback;
}

// Get all active test assignments for a new call
export function getActiveAssignments(): { testId: string; variant: ABTestVariant }[] {
  const assignments: { testId: string; variant: ABTestVariant }[] = [];

  for (const test of abTests.values()) {
    if (!test.active) continue;
    const variant = assignVariant(test.id);
    if (variant) {
      assignments.push({ testId: test.id, variant });
    }
  }

  return assignments;
}

// ── Recording results ──

export function recordABResult(testId: string, variantId: string, result: {
  transferred: boolean;
  durationMs: number;
  score: number;
  costUsd: number;
}): void {
  const test = abTests.get(testId);
  if (!test) return;

  const stats = test.results.variantStats[variantId];
  if (!stats) return;

  stats.calls++;
  if (result.transferred) stats.transfers++;
  stats.totalCostUsd += result.costUsd;

  // Rolling averages
  stats.avgDurationMs = Math.round(
    ((stats.avgDurationMs * (stats.calls - 1)) + result.durationMs) / stats.calls
  );
  stats.avgScore = Math.round(
    ((stats.avgScore * (stats.calls - 1)) + result.score) / stats.calls
  );
  stats.conversionRate = parseFloat((stats.transfers / stats.calls * 100).toFixed(1));

  logger.debug('ab-test', 'Result recorded', {
    testId,
    variantId,
    calls: stats.calls,
    conversionRate: stats.conversionRate,
  });
}

// ── Utility: Apply variant config to settings ──

export function applyVariantOverrides(
  settings: Record<string, unknown>,
  assignments: { testId: string; variant: ABTestVariant }[],
): { settings: Record<string, unknown>; variantLabel: string } {
  const labels: string[] = [];

  for (const { testId, variant } of assignments) {
    for (const [key, value] of Object.entries(variant.config)) {
      settings[key] = value;
    }
    labels.push(`${testId}:${variant.id}`);
  }

  return {
    settings,
    variantLabel: labels.join(',') || 'control',
  };
}
