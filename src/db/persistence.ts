// ── Persistence Layer ──────────────────────────────────────────────
// Supports two backends:
//   • PostgreSQL  — used when DATABASE_URL is set (production on Render)
//   • JSON files  — fallback for local dev without a database
//
// The public interface (loadData / scheduleSave / flushAll) is identical
// in both modes so no other module needs to change.

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { logger } from '../utils/logger';

// ── File-based config ───────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DEBOUNCE_MS = 1000;

// ── Postgres state ──────────────────────────────────────────────────

let pgPool: Pool | null = null;
const pgCache = new Map<string, unknown>();
let pgReady = false;

// ── Init ────────────────────────────────────────────────────────────

/**
 * Connect to Postgres, create the kv_store table if needed, and
 * pre-load all rows into pgCache so loadData() stays synchronous.
 * Call this once at server startup before loading any stores.
 */
export async function initPostgresPersistence(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.info('persistence', 'DATABASE_URL not set — using file-based persistence');
    return;
  }

  pgPool = new Pool({
    connectionString: url,
    // Accept SSL for both external render.com URLs and internal dpg-* hostnames
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });

  let client;
  try {
    client = await pgPool.connect();
  } catch (err) {
    logger.error('persistence', 'Postgres connection failed — falling back to file-based persistence', {
      error: err instanceof Error ? err.message : String(err),
    });
    pgPool = null;
    return;
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key        TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await client.query<{ key: string; data: unknown }>('SELECT key, data FROM kv_store');
    for (const row of result.rows) {
      pgCache.set(row.key, row.data);
    }

    pgReady = true;
    logger.info('persistence', `Postgres persistence ready — ${result.rows.length} keys loaded`, {
      keys: result.rows.map(r => r.key),
    });
  } catch (err) {
    logger.error('persistence', 'Postgres init query failed — falling back to file-based persistence', {
      error: err instanceof Error ? err.message : String(err),
    });
    pgPool = null;
  } finally {
    client.release();
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Load data for a key. Returns undefined if not found.
 * In Postgres mode reads from in-memory cache (populated at init).
 * In file mode reads from disk synchronously.
 */
export function loadData<T>(key: string): T | undefined {
  if (pgReady) {
    const cached = pgCache.get(key);
    if (cached !== undefined) {
      logger.info('persistence', `Loaded ${key} from postgres cache`);
      return cached as T;
    }
    return undefined;
  }

  // File fallback
  ensureDataDir();
  const fp = filePath(key);
  try {
    if (!fs.existsSync(fp)) return undefined;
    const raw = fs.readFileSync(fp, 'utf-8');
    const parsed = JSON.parse(raw) as T;
    logger.info('persistence', `Loaded ${key} from disk`, { path: fp });
    return parsed;
  } catch (err) {
    logger.error('persistence', `Failed to load ${key}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Schedule a debounced save. The dataFn is called at write time so it
 * captures the latest in-memory state.
 */
export function scheduleSave(key: string, dataFn: () => unknown): void {
  pendingData.set(key, dataFn);

  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);

  pendingTimers.set(
    key,
    setTimeout(() => {
      const fn = pendingData.get(key);
      if (fn) {
        const data = fn();
        if (pgReady) {
          pgSave(key, data);
        } else {
          saveDataSync(key, data);
        }
        pendingData.delete(key);
      }
      pendingTimers.delete(key);
    }, DEBOUNCE_MS),
  );
}

/**
 * Flush all pending saves immediately (call on shutdown).
 */
export function flushAll(): void {
  for (const [key, timer] of pendingTimers.entries()) {
    clearTimeout(timer);
    const fn = pendingData.get(key);
    if (fn) {
      const data = fn();
      if (pgReady) {
        pgSave(key, data);
      } else {
        saveDataSync(key, data);
      }
      logger.info('persistence', `Flushed ${key} on shutdown`);
    }
  }
  pendingTimers.clear();
  pendingData.clear();
}

// ── Internal ────────────────────────────────────────────────────────

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingData = new Map<string, () => unknown>();

function pgSave(key: string, data: unknown): void {
  if (!pgPool) return;
  pgCache.set(key, data);
  pgPool.query(
    `INSERT INTO kv_store (key, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [key, JSON.stringify(data)],
  ).then(() => {
    logger.info('persistence', `Saved ${key} to postgres`);
  }).catch(err => {
    logger.error('persistence', `Failed to save ${key} to postgres`, {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

function saveDataSync(key: string, data: unknown): void {
  ensureDataDir();
  const fp = filePath(key);
  const tmp = fp + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, fp);
  } catch (err) {
    logger.error('persistence', `Failed to save ${key}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logger.info('persistence', `Created data directory: ${DATA_DIR}`);
  }
}

function filePath(key: string): string {
  return path.join(DATA_DIR, `${key}.json`);
}
