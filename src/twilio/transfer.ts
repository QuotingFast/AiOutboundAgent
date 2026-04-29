import { twilioClient, dialAgent } from './client';
import { buildConferenceProspectTwiml } from './twiml';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface WarmTransferLeadInfo {
  firstname: string;
  carrier?: string;
  years?: number;
  vehicleCount?: number;
}

export async function executeWarmTransfer(
  callSid: string,
  targetNumber: string,
  leadInfo: WarmTransferLeadInfo,
): Promise<boolean> {
  const confName = `conf-${callSid}`;

  try {
    // Step 1: redirect prospect's call into a waiting Conference room
    const confTwiml = buildConferenceProspectTwiml(confName);
    const confUrl = new URL('/twilio/conference-prospect', config.baseUrl);
    confUrl.searchParams.set('conf', confName);

    // Inline the call update — redirect prospect to conference TwiML via a data URL approach.
    // We serve the TwiML from a dedicated endpoint instead.
    await twilioClient.calls(callSid).update({
      url: confUrl.toString(),
      method: 'POST',
    });
    logger.info('transfer', 'Prospect redirected to conference', { callSid, confName });

    // Step 2: dial agent with intro TwiML
    const agentIntroUrl = new URL('/twilio/agent-intro', config.baseUrl);
    agentIntroUrl.searchParams.set('conf', confName);
    agentIntroUrl.searchParams.set('firstname', leadInfo.firstname);
    if (leadInfo.carrier) agentIntroUrl.searchParams.set('carrier', leadInfo.carrier);
    if (leadInfo.years != null) agentIntroUrl.searchParams.set('years', String(leadInfo.years));
    agentIntroUrl.searchParams.set('vehicles', String(leadInfo.vehicleCount ?? 1));

    await dialAgent(targetNumber, agentIntroUrl.toString());
    logger.info('transfer', 'Agent dial initiated', { targetNumber, confName });

    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('transfer', 'Warm transfer failed', { callSid, targetNumber, error: message });
    return false;
  }
}
