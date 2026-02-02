import { logger } from '../utils/logger';

// ── PII Redaction ───────────────────────────────────────────────────

const PII_PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
  { name: 'ssn', pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, replacement: '[SSN_REDACTED]' },
  { name: 'credit_card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CC_REDACTED]' },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[EMAIL_REDACTED]' },
  { name: 'phone', pattern: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  { name: 'dob', pattern: /\b(?:0[1-9]|1[0-2])[\/\-](?:0[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g, replacement: '[DOB_REDACTED]' },
  { name: 'dl_number', pattern: /\b[A-Z]\d{7,14}\b/g, replacement: '[DL_REDACTED]' },
  { name: 'vin', pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g, replacement: '[VIN_REDACTED]' },
];

export function redactPII(text: string): string {
  let redacted = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function containsPII(text: string): boolean {
  return PII_PATTERNS.some(({ pattern }) => {
    const regex = new RegExp(pattern.source, pattern.flags);
    return regex.test(text);
  });
}

export function detectPIITypes(text: string): string[] {
  const types: string[] = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(text)) types.push(name);
  }
  return types;
}

// ── Data Isolation ──────────────────────────────────────────────────

export interface TenantConfig {
  id: string;
  name: string;
  apiKeyHash: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

const tenants = new Map<string, TenantConfig>();

export function registerTenant(tenant: TenantConfig): void {
  tenants.set(tenant.id, tenant);
}

export function getTenant(id: string): TenantConfig | undefined {
  return tenants.get(id);
}

export function validateTenantAccess(tenantId: string, resourceTenantId: string): boolean {
  return tenantId === resourceTenantId;
}

// ── Rate Limiting ───────────────────────────────────────────────────

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitBucket>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = rateLimits.get(key);

  if (!bucket || now > bucket.resetAt) {
    // New window
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  bucket.count++;
  const allowed = bucket.count <= maxRequests;
  return {
    allowed,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetAt: bucket.resetAt,
  };
}

// ── API Key Management ──────────────────────────────────────────────

interface APIKeyInfo {
  key: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  rotateAfter?: string;
  scopes: string[];
}

const apiKeys = new Map<string, APIKeyInfo>();

export function registerAPIKey(key: string, name: string, scopes: string[] = ['*'], rotateAfterDays?: number): void {
  const rotateAfter = rotateAfterDays
    ? new Date(Date.now() + rotateAfterDays * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  apiKeys.set(key, {
    key,
    name,
    createdAt: new Date().toISOString(),
    scopes,
    rotateAfter,
  });
}

export function validateAPIKey(key: string, scope?: string): boolean {
  const info = apiKeys.get(key);
  if (!info) return false;

  info.lastUsedAt = new Date().toISOString();

  if (scope && !info.scopes.includes('*') && !info.scopes.includes(scope)) {
    return false;
  }

  return true;
}

export function getKeysNeedingRotation(): APIKeyInfo[] {
  const now = new Date().toISOString();
  return Array.from(apiKeys.values()).filter(k =>
    k.rotateAfter && k.rotateAfter < now
  );
}

// ── Secure Logging ──────────────────────────────────────────────────

export function secureLog(component: string, message: string, data?: Record<string, unknown>): void {
  const sanitized: Record<string, unknown> = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        sanitized[key] = redactPII(value);
      } else {
        sanitized[key] = value;
      }
    }
  }
  logger.info(component, message, sanitized);
}
