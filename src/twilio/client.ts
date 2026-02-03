import Twilio from 'twilio';
import { config } from '../config';
import { logger } from '../utils/logger';

const twilioClient = Twilio(config.twilio.accountSid, config.twilio.authToken);

export interface StartCallParams {
  to: string;
  from: string;
  lead: {
    first_name: string;
    state?: string;
    current_insurer?: string;
    insured?: boolean;
  };
  transfer?: {
    mode: 'warm' | 'cold';
    target_number: string;
  };
}

export async function startOutboundCall(params: StartCallParams): Promise<{ callSid: string; status: string }> {
  const fromNumber = params.from || config.twilio.fromNumber;
  if (!fromNumber) {
    throw new Error('No "from" number provided and TWILIO_FROM_NUMBER not set');
  }

  // Encode lead + transfer data as query params so the webhook can read them
  const webhookUrl = new URL('/twilio/voice', config.baseUrl);
  webhookUrl.searchParams.set('lead', JSON.stringify(params.lead));
  if (params.transfer) {
    webhookUrl.searchParams.set('transfer', JSON.stringify(params.transfer));
  }

  logger.info('twilio-client', 'Placing outbound call', { to: params.to, from: fromNumber });

  const callOptions: any = {
    to: params.to,
    from: fromNumber,
    url: webhookUrl.toString(),
    method: 'POST',
    statusCallback: `${config.baseUrl}/twilio/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
  };

  if (config.recording.enabled) {
    callOptions.record = true;
    callOptions.recordingChannels = config.recording.channels;
    callOptions.recordingStatusCallback = `${config.baseUrl}/twilio/recording-status`;
    callOptions.recordingStatusCallbackMethod = 'POST';
    callOptions.recordingStatusCallbackEvent = ['completed'];
  }

  const call = await twilioClient.calls.create(callOptions);

  logger.info('twilio-client', 'Call created', { callSid: call.sid, status: call.status });

  return { callSid: call.sid, status: call.status || 'initiated' };
}

export async function transferCall(callSid: string, targetNumber: string, bridgePhrase: string): Promise<void> {
  const twimlUrl = new URL('/twilio/transfer', config.baseUrl);
  twimlUrl.searchParams.set('target', targetNumber);
  twimlUrl.searchParams.set('phrase', bridgePhrase);

  logger.info('twilio-client', 'Initiating transfer', { callSid, targetNumber });

  await twilioClient.calls(callSid).update({
    url: twimlUrl.toString(),
    method: 'POST',
  });
}

export async function startCallRecording(callSid: string): Promise<string | null> {
  if (!config.recording.enabled) return null;

  try {
    logger.info('twilio-client', 'Starting call recording', { callSid });
    const recording = await twilioClient.calls(callSid).recordings.create({
      recordingChannels: String(config.recording.channels),
      recordingStatusCallback: `${config.baseUrl}/twilio/recording-status`,
      recordingStatusCallbackMethod: 'POST',
      recordingStatusCallbackEvent: ['completed'],
    });
    logger.info('twilio-client', 'Recording started', { callSid, recordingSid: recording.sid });
    return recording.sid;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('twilio-client', 'Failed to start recording', { callSid, error: msg });
    return null;
  }
}

export async function endCall(callSid: string): Promise<void> {
  logger.info('twilio-client', 'Ending call', { callSid });
  await twilioClient.calls(callSid).update({ status: 'completed' });
}

export { twilioClient };
