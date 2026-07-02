// ── Platform bootstrap ─────────────────────────────────────────────
// Loads all persisted platform stores and exposes the v2 router.
// Call initPlatform() at server startup after persistence is ready.

import { loadEventLedger } from './events';
import { loadPolicy } from './policy';
import { loadBuyers } from './buyers';
import { loadCadencePlans } from './cadence';
import { loadRebuttals } from './rebuttals';
import { loadQa } from './qa';
import { loadProfiles } from './profiles';
import { loadSecurity } from './security';
import { loadComplianceFromDisk } from '../compliance';
import { logger } from '../utils/logger';

export { platformRouter } from './routes';
export { requireAuth, twilioWebhookGuard, webleadGuard, authEnabled } from './security';
export { evaluateOutreach, isBlocked, recordSmsStop, hasSmsStop } from './policy';
export { recordEvent } from './events';
export { selectBuyer, hasConfiguredBuyers, createTransfer, updateTransferStage, findTransferByCallSid, deliverHandoff, buildWhisper, getBuyer } from './buyers';
export { parseCallbackRequest } from './cadence';
export { scoreCall } from './qa';
export { detectObjection } from './rebuttals';

export function initPlatform(): void {
  loadComplianceFromDisk();
  loadEventLedger();
  loadPolicy();
  loadBuyers();
  loadCadencePlans();
  loadRebuttals();
  loadQa();
  loadProfiles();
  loadSecurity();
  logger.info('platform', 'Platform layer initialized (events, policy, buyers, cadence, rebuttals, QA, profiles, security)');
}
