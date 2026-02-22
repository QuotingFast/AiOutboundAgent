import Twilio from 'twilio';
import { config } from '../config';
import { logger } from '../utils/logger';
import { LeadData } from '../agent/prompts';

const twilioClient = Twilio(config.twilio.accountSid, config.twilio.authToken);

export interface StartCallParams {
  to: string;
  from: string;
  lead: LeadData;
  transfer?: {
    mode: 'warm' | 'cold';
    target_number: string;
  };
  amdEnabled?: boolean;
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
    callOptions.recordingChannels = config.recording.channels === 2 ? 'dual' : 'mono';
    callOptions.recordingStatusCallback = `${config.baseUrl}/twilio/recording-status`;
    callOptions.recordingStatusCallbackMethod = 'POST';
    callOptions.recordingStatusCallbackEvent = ['completed'];
  }

  // Answering Machine Detection (AMD)
  if (params.amdEnabled) {
    callOptions.machineDetection = 'DetectMessageEnd';
    callOptions.machineDetectionTimeout = 30;
    callOptions.asyncAmd = 'true';
    callOptions.asyncAmdStatusCallback = `${config.baseUrl}/twilio/amd-status`;
    callOptions.asyncAmdStatusCallbackMethod = 'POST';
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
      recordingChannels: config.recording.channels === 2 ? 'dual' : 'mono',
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

// ── SMS ──

export async function sendSms(to: string, body: string, from?: string): Promise<{ sid: string; status: string }> {
  const fromNumber = from || config.twilio.fromNumber;
  if (!fromNumber) {
    throw new Error('No "from" number provided and TWILIO_FROM_NUMBER not set');
  }

  logger.info('twilio-client', 'Sending SMS', { to, from: fromNumber });

  const message = await twilioClient.messages.create({
    to,
    from: fromNumber,
    body,
    statusCallback: `${config.baseUrl}/twilio/sms-status`,
  });

  logger.info('twilio-client', 'SMS sent', { sid: message.sid, status: message.status });
  return { sid: message.sid, status: message.status };
}

// ── Recording Sync ──

export interface TwilioRecordingSummary {
  recordingSid: string;
  callSid: string;
  recordingUrl: string;
  durationSec: number;
  channels: number;
  source: string;
  timestamp: string;
}

/**
 * Fetch recent recordings from Twilio's API.
 * Used to backfill any recordings missed due to callback failures or restarts.
 */
export async function fetchRecentRecordings(limit = 50): Promise<TwilioRecordingSummary[]> {
  try {
    const recordings = await twilioClient.recordings.list({ limit });
    return recordings.map(r => ({
      recordingSid: r.sid,
      callSid: r.callSid,
      recordingUrl: `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Recordings/${r.sid}`,
      durationSec: parseInt(String(r.duration || '0'), 10),
      channels: parseInt(String(r.channels || '1'), 10),
      source: r.source || 'unknown',
      timestamp: r.dateCreated ? r.dateCreated.toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    logger.error('twilio-client', 'Failed to fetch recordings from Twilio', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export { twilioClient };
