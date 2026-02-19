// ── JSON File Persistence Layer ────────────────────────────────────
// Provides atomic save/load for in-memory data stores.
// Data is written to individual JSON files in a configurable directory.
// Writes are atomic: write to .tmp file, then rename (prevents corruption on crash).
// Saves are debounced so rapid mutations don't cause excessive disk I/O.

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DEBOUNCE_MS = 1000; // Wait 1s after last mutation before writing

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logger.info('persistence', `Created data directory: ${DATA_DIR}`);
  }
}

function filePath(key: string): string {
  return path.join(DATA_DIR, `${key}.json`);
}

/**
 * Load data from a JSON file. Returns undefined if the file doesn't exist.
 */
export function loadData<T>(key: string): T | undefined {
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
 * Save data to a JSON file atomically (write tmp, then rename).
 */
function saveDataSync<T>(key: string, data: T): void {
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
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// ── Debounced save ──────────────────────────────────────────────────
// Each key gets its own debounce timer so saving leads doesn't delay saving recordings.

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingData = new Map<string, () => unknown>();

/**
 * Schedule a debounced save. The `dataFn` is called at write time (not at schedule time)
 * so it captures the latest state.
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
        saveDataSync(key, fn());
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
      saveDataSync(key, fn());
      logger.info('persistence', `Flushed ${key} on shutdown`);
    }
  }
  pendingTimers.clear();
  pendingData.clear();
}
