import { transferCall } from './client';
import { logger } from '../utils/logger';

export async function executeWarmTransfer(
  callSid: string,
  targetNumber: string,
  whisperBriefing?: string,
): Promise<boolean> {
  // Short transfer pre-bridge per caller UX preference.
  const bridgePhrase = 'Connecting you with the licensed agent. You may hear a ring before it connects.';

  try {
    await transferCall(callSid, targetNumber, bridgePhrase, whisperBriefing);
    logger.info('transfer', 'Warm transfer initiated', {
      callSid,
      targetNumber,
      hasWhisper: Boolean(whisperBriefing),
    });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('transfer', 'Warm transfer failed', { callSid, targetNumber, error: message });
    return false;
  }
}
