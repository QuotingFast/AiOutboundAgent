import { Router, Request, Response } from 'express';
import { startOutboundCall, StartCallParams } from '../twilio/client';
import { buildMediaStreamTwiml, buildTransferTwiml } from '../twilio/twiml';
import { registerPendingSession } from '../audio/stream';
import { TransferConfig, buildSystemPrompt } from '../agent/prompts';
import { getSettings, updateSettings, recordCall, getCallHistory } from '../config/runtime';
import { getDashboardHtml } from './dashboard';
import { config } from '../config';
import { logger } from '../utils/logger';

// Module imports
import { getAnalyticsHistory, getAnalyticsSummary, getActiveAnalytics } from '../analytics';
import {
  addToDnc, removeFromDnc, getDncList, getDncCount,
  runPreCallComplianceCheck, checkCallTimeAllowed,
  recordConsent, getConsent,
  getAuditLog, getAuditLogCount,
  requiresRecordingDisclosure,
} from '../compliance';
import {
  getActiveSessions, getActiveSessionCount, getQueue, getQueueSize,
  getSystemHealth, setMaxConcurrency, getMaxConcurrency,
} from '../performance';
import {
  createABTest, getABTest, getAllABTests, deleteABTest,
  toggleABTest, recordABResult,
} from '../testing/ab';
import {
  getAllLeads, getLeadMemory, createOrUpdateLead,
  setLeadDisposition, addLeadNote, scheduleCallback,
  getLeadCount, getLeadsByDisposition, getLeadsForCallback,
} from '../memory';
import {
  savePromptVersion, getActivePrompt, getPromptVersions,
  rollbackPrompt, getAllPromptNames,
  setFeatureFlag, getFeatureFlags, deleteFeatureFlag, isFeatureEnabled,
  getHotSwapConfig, updateHotSwapConfig, getGuardrails,
  setEnvironment, getEnvironment,
} from '../prompts/manager';
import {
  redactPII, containsPII, detectPIITypes,
  checkRateLimit,
} from '../security';
import {
  registerWebhook, removeWebhook, getWebhooks,
  getWorkflowConfig, updateWorkflowConfig,
  scoreCall,
} from '../workflows';
import {
  getProviders, registerProvider, removeProvider,
  getProviderHealth, getRoutingStrategy, setRoutingStrategy,
} from '../routing';

const router = Router();

// ── Recording store ─────────────────────────────────────────────────

export interface CallRecording {
  recordingSid: string;
  callSid: string;
  recordingUrl: string;
  durationSec: number;
  channels: number;
  source: string;
  timestamp: string;
}

const recordingStore: CallRecording[] = [];
const MAX_RECORDINGS = 200;

export function getRecordings(): CallRecording[] {
  return [...recordingStore];
}

export function getRecordingByCallSid(callSid: string): CallRecording | undefined {
  return recordingStore.find(r => r.callSid === callSid);
}

export function getRecordingBySid(recordingSid: string): CallRecording | undefined {
  return recordingStore.find(r => r.recordingSid === recordingSid);
}

// In-memory cache for voice preview audio (voice -> mp3 Buffer)
const voicePreviewCache = new Map<string, Buffer>();
const PREVIEW_TEXT = "Hey there! This is a quick preview of how I sound. Pretty natural, right?";

// ── Call Endpoints ──────────────────────────────────────────────────

/**
 * POST /call/start
 * Start an outbound call to a prospect.
 */
router.post('/call/start', async (req: Request, res: Response) => {
  try {
    const { to, from, lead, transfer } = req.body as StartCallParams & { transfer?: TransferConfig };

    if (!to) {
      res.status(400).json({ error: 'Missing required field: to' });
      return;
    }
    if (!lead?.first_name) {
      res.status(400).json({ error: 'Missing required field: lead.first_name' });
      return;
    }

    // Pre-call compliance check
    const compliance = runPreCallComplianceCheck(to, lead.state);
    if (!compliance.allowed) {
      const reasons = [
        !compliance.checks.dnc.passed ? compliance.checks.dnc.reason : null,
        !compliance.checks.time.passed ? compliance.checks.time.reason : null,
      ].filter(Boolean);
      res.status(403).json({
        error: 'Compliance check failed',
        reasons,
        warnings: compliance.warnings,
      });
      return;
    }

    const result = await startOutboundCall({ to, from, lead });

    // Register session data so the WebSocket handler can pick it up when the call connects
    registerPendingSession(result.callSid, lead, transfer);

    // Record this call with current settings for history tracking
    recordCall(result.callSid, to, lead.first_name);

    logger.info('routes', 'Call started', { callSid: result.callSid, to });

    res.json({
      call_sid: result.callSid,
      status: result.status,
      compliance_warnings: compliance.warnings,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('routes', 'Failed to start call', { error: msg });
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /twilio/voice
 * Twilio webhook when the outbound call is answered.
 */
router.post('/twilio/voice', (req: Request, res: Response) => {
  const callSid = req.body?.CallSid || 'unknown';
  const lead = req.query.lead ? JSON.parse(req.query.lead as string) : null;
  const transfer = req.query.transfer ? JSON.parse(req.query.transfer as string) : null;

  logger.info('routes', 'Voice webhook hit', { callSid });

  if (lead && callSid !== 'unknown') {
    registerPendingSession(callSid, lead, transfer);
  }

  const twiml = buildMediaStreamTwiml('outbound');
  res.type('text/xml');
  res.send(twiml);
});

/**
 * POST /twilio/incoming
 * Twilio webhook for incoming calls to the Twilio number.
 * Configure this URL in Twilio Console > Phone Numbers > Voice webhook.
 */
router.post('/twilio/incoming', (req: Request, res: Response) => {
  const callSid = req.body?.CallSid || 'unknown';
  const callerNumber = req.body?.From || 'unknown';
  const calledNumber = req.body?.To || 'unknown';

  logger.info('routes', 'Incoming call received', { callSid, from: callerNumber, to: calledNumber });

  // Check if inbound is enabled
  const s = getSettings();
  if (!s.inboundEnabled) {
    logger.info('routes', 'Inbound calls disabled, rejecting', { callSid });
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">We're sorry, we are not accepting calls at this time. Please try again later.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  // Record in call history
  recordCall(callSid, callerNumber, `Inbound: ${callerNumber}`);

  const twiml = buildMediaStreamTwiml('inbound', callerNumber);
  res.type('text/xml');
  res.send(twiml);
});

/**
 * POST /twilio/transfer
 */
router.post('/twilio/transfer', (req: Request, res: Response) => {
  const target = req.query.target as string;
  const phrase = req.query.phrase as string || 'Connecting you now.';

  if (!target) {
    res.status(400).send('Missing target parameter');
    return;
  }

  logger.info('routes', 'Transfer TwiML requested', { target });
  const twiml = buildTransferTwiml(target, phrase);
  res.type('text/xml');
  res.send(twiml);
});

/**
 * POST /twilio/status
 */
router.post('/twilio/status', (req: Request, res: Response) => {
  const { CallSid, CallStatus } = req.body || {};
  logger.info('routes', 'Call status update', { callSid: CallSid, status: CallStatus });
  res.sendStatus(200);
});

/**
 * POST /twilio/recording-status
 * Twilio webhook when a call recording is completed.
 */
router.post('/twilio/recording-status', (req: Request, res: Response) => {
  const {
    RecordingSid,
    CallSid,
    RecordingUrl,
    RecordingDuration,
    RecordingChannels,
    RecordingSource,
  } = req.body || {};

  if (RecordingSid && CallSid) {
    const recording: CallRecording = {
      recordingSid: RecordingSid,
      callSid: CallSid,
      recordingUrl: RecordingUrl || '',
      durationSec: parseInt(RecordingDuration || '0', 10),
      channels: parseInt(RecordingChannels || '1', 10),
      source: RecordingSource || 'unknown',
      timestamp: new Date().toISOString(),
    };

    recordingStore.unshift(recording);
    if (recordingStore.length > MAX_RECORDINGS) {
      recordingStore.length = MAX_RECORDINGS;
    }

    logger.info('routes', 'Recording completed', {
      recordingSid: RecordingSid,
      callSid: CallSid,
      durationSec: recording.durationSec,
    });
  }

  res.sendStatus(200);
});

// ── General Endpoints ───────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  const health = getSystemHealth();
  res.json({ status: 'ok', timestamp: new Date().toISOString(), system: health });
});

router.get('/dashboard', (_req: Request, res: Response) => {
  res.type('text/html');
  res.send(getDashboardHtml());
});

router.get('/api/settings', (_req: Request, res: Response) => {
  res.json(getSettings());
});

router.put('/api/settings', (req: Request, res: Response) => {
  const updated = updateSettings(req.body);
  logger.info('routes', 'Settings updated', { keys: Object.keys(req.body) });
  res.json(updated);
});

router.get('/api/calls', (_req: Request, res: Response) => {
  res.json(getCallHistory());
});

router.get('/api/default-prompt', (_req: Request, res: Response) => {
  const prompt = buildSystemPrompt({ first_name: '{{first_name}}', state: '{{state}}', current_insurer: '{{current_insurer}}' });
  res.json({ prompt });
});

// ── Voice Preview Endpoints ─────────────────────────────────────────

const elPreviewCache = new Map<string, Buffer>();
const EL_PREVIEW_TEXT = "Hey there! This is a quick preview of how I sound. Pretty natural, right?";

router.get('/api/voice-preview/:voice', async (req: Request, res: Response) => {
  const voice = req.params.voice.toLowerCase();
  const validVoices = ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'];

  // ElevenLabs voice name → ID mapping (all American premade voices)
  const elVoiceMap: Record<string, string> = {
    sarah: 'EXAVITQu4vr4xnSDxMaL',
    jessica: 'cgSgspJ2msm6clMCkdW9',
    bella: 'hpp4J3VqNfWAUOO0d1Us',
    laura: 'FGY2WhTYpPnrIDTdsKH5',
    matilda: 'XrExE9yKIg1WjnnlVkGX',
    eric: 'cjVigY5qzO86Huf0OWal',
    chris: 'iP95p4xoKVk53GoZ742B',
    roger: 'CwhRBWXzGAHq8TQ4Fs17',
    will: 'bIHbv24MWmeRgasZH58o',
    brian: 'nPczCjzI2devNBz1zQrb',
    liam: 'TX3LPaxmHKxFdv7VOQHJ',
    adam: 'pNInz6obpgDQGcFmaJgB',
    bill: 'pqHfZKP75CvOlQylNhV4',
    callum: 'N2lVS1w4EtoT3dr4eOWO',
    harry: 'SOYHLrjzK2X1ezoPC6cr',
    river: 'SAz9YHcvj6GT2YYXdXww',
    'daisy mae': 'S2fYVrVpl5QYHVJ1LkgT',
    'outbound caller': 'WXOyQFCgL1KW7Rv9Fln0',
    'annie-beth': 'c4TutCiAuWP4vwb1xebb',
    'billy bob': '8kvxG72xUMYnIFhZYwWj',
    austin: 'Bj9UqZbhQsanLzgalpEG',
    'southern mike': 'DwEFbvGTcJhAk9eY9m0f',
    cassidy: '56AoDkrOh6qfVPDXZ7Pt',
    adeline: '5l5f8iK3YPeGga21rQIX',
    carol: '5u41aNhyCU6hXOykdSKco',
    miranda: 'PoHUWWWMHFrA8z7Q88pu',
    hope: 'uYXf8XasLslADfZ2MB4u',
    lina: 'oWjuL7HSoaEJRMDMP3HD',
    'mark convoai': '1SM7GgM6IMuvQlz2BwM3',
    'marcus jackson': '1cvhXKE3uxgoijz9BMLU',
    leo: '46Gz2MoWgXGvpJ9yRzmw',
    'kal jones': '68RUZBDjLe2YBQvv8zFx',
    pete: 'ChO6kqkVouUn0s7HMunx',
    jamahal: 'DTKMou8ccj1ZaWGBiotd',
    'matt schmitz': 'FYZl5JbWOAm6O1fPKAOu',
    hayden: 'HfjqMQ0GHcNkhBWnIhy3',
    'mark natural': 'UgBBYS2sOqTuMpoF3BR0',
    jamal: 'Ybqj6CIlqb6M85s9Bl4n',
    'david ashby': 'Z9hrfEHGU3dykHntWvIY',
    jarnathan: 'c6SfcYrb2t09NHXiT80T',
    'hey its brad': 'f5HLTX707KIM4SzJYzSz',
    'w. l. oxley': 'gOkFV1JMCt0G0n9xmBwV',
    boyd: 'gfRt6Z3Z8aTbpLfexQ7N',
    'sam chang': 'rYW2LlWtM70M5vc3HBtm',
    'adam authentic': 's3TPKV1kjDlVtZbl4Ksh',
    'matt hyper': 'pwMBn0SsmN1220Aorv15',
    finn: 'vBKc2FfBKJfcZNyEt1n6',
    alex: 'yl2ZDV1MzN4HbQJbMihG',
    steve: 'jn34bTlmmOgOJU9XfPuy',
    burt: 'kdVjFjOXaqExaDvXZECX',
    'lamar lincoln': 'CVRACyqNcQefTlxMj9bt',
    'voice of america': 'r4iCyrmUEMCbsi7eGtf8',
    'tyrese tate': 'rWyjfFeMZ6PxkHqD3wGC',
    attank: 'Z7HhYXzYeRsQk3RnXqiG',
    sanchez: '1THll2MhJjluQYaSQxDr',
    'luis plata': 'NFJlRMNv6b8kbunXwjHC',
  };

  // Route ElevenLabs voices to the ElevenLabs preview endpoint
  if (elVoiceMap[voice]) {
    const voiceId = elVoiceMap[voice];
    const apiKey = config.elevenlabs?.apiKey;
    if (!apiKey) {
      res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
      return;
    }
    try {
      if (elPreviewCache.has(voiceId)) {
        res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
        res.send(elPreviewCache.get(voiceId));
        return;
      }

      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: EL_PREVIEW_TEXT,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        logger.error('routes', 'ElevenLabs preview failed', { voice, voiceId, status: ttsRes.status, error: errText });
        res.status(502).json({ error: 'ElevenLabs TTS failed: ' + ttsRes.status });
        return;
      }

      const arrayBuf = await ttsRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      elPreviewCache.set(voiceId, buffer);
      logger.info('routes', 'ElevenLabs preview generated via name', { voice, voiceId, bytes: buffer.length });

      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
      res.send(buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('routes', 'ElevenLabs preview error', { voice, error: msg });
      res.status(500).json({ error: msg });
    }
    return;
  }

  if (!validVoices.includes(voice)) {
    res.status(400).json({ error: 'Invalid voice. Valid: ' + validVoices.join(', ') + ', ' + Object.keys(elVoiceMap).join(', ') });
    return;
  }

  try {
    if (voicePreviewCache.has(voice)) {
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
      res.send(voicePreviewCache.get(voice));
      return;
    }

    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: PREVIEW_TEXT,
        voice: voice,
        response_format: 'mp3',
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      logger.error('routes', 'TTS preview failed', { voice, status: ttsRes.status, error: errText });
      res.status(502).json({ error: 'TTS generation failed: ' + ttsRes.status });
      return;
    }

    const arrayBuf = await ttsRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    voicePreviewCache.set(voice, buffer);
    logger.info('routes', 'Voice preview generated and cached', { voice, bytes: buffer.length });

    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
    res.send(buffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('routes', 'Voice preview error', { voice, error: msg });
    res.status(500).json({ error: msg });
  }
});

router.get('/api/elevenlabs-voice-preview/:voiceId', async (req: Request, res: Response) => {
  const voiceId = req.params.voiceId;
  if (!voiceId || voiceId.length < 10) {
    res.status(400).json({ error: 'Invalid voice ID' });
    return;
  }

  const apiKey = config.elevenlabs?.apiKey;
  if (!apiKey) {
    res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
    return;
  }

  try {
    if (elPreviewCache.has(voiceId)) {
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
      res.send(elPreviewCache.get(voiceId));
      return;
    }

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: EL_PREVIEW_TEXT,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      logger.error('routes', 'ElevenLabs preview failed', { voiceId, status: ttsRes.status, error: errText });
      res.status(502).json({ error: 'ElevenLabs TTS failed: ' + ttsRes.status });
      return;
    }

    const arrayBuf = await ttsRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    elPreviewCache.set(voiceId, buffer);
    logger.info('routes', 'ElevenLabs preview generated and cached', { voiceId, bytes: buffer.length });

    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
    res.send(buffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('routes', 'ElevenLabs preview error', { voiceId, error: msg });
    res.status(500).json({ error: msg });
  }
});

// ── Analytics Endpoints ─────────────────────────────────────────────

router.get('/api/analytics/history', (_req: Request, res: Response) => {
  res.json(getAnalyticsHistory());
});

router.get('/api/analytics/summary', (_req: Request, res: Response) => {
  res.json(getAnalyticsSummary());
});

router.get('/api/analytics/:callSid', (req: Request, res: Response) => {
  const history = getAnalyticsHistory();
  const found = history.find(a => a.callSid === req.params.callSid);
  if (!found) {
    // Check active calls
    const active = getActiveAnalytics(req.params.callSid);
    if (active) {
      res.json(active.getData());
      return;
    }
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  res.json(found);
});

// ── Recording Endpoints ─────────────────────────────────────────────

router.get('/api/recordings', (_req: Request, res: Response) => {
  const recordings = getRecordings();
  res.json({ recordings, count: recordings.length });
});

router.get('/api/recordings/:callSid', (req: Request, res: Response) => {
  const recording = getRecordingByCallSid(req.params.callSid);
  if (!recording) {
    res.status(404).json({ error: 'No recording found for this call' });
    return;
  }
  res.json(recording);
});

// Proxy endpoint to serve recording audio (Twilio requires auth)
router.get('/api/recordings/:callSid/audio', async (req: Request, res: Response) => {
  const recording = getRecordingByCallSid(req.params.callSid);
  if (!recording) {
    res.status(404).json({ error: 'No recording found for this call' });
    return;
  }

  try {
    const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Recordings/${recording.recordingSid}.mp3`;
    const authHeader = 'Basic ' + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');

    const response = await fetch(audioUrl, {
      headers: { 'Authorization': authHeader },
    });

    if (!response.ok) {
      logger.error('routes', `Failed to fetch recording from Twilio: ${response.status}`);
      res.status(response.status).json({ error: 'Failed to fetch recording from Twilio' });
      return;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length.toString());
    res.setHeader('Content-Disposition', `inline; filename="recording-${recording.callSid}.mp3"`);
    res.send(audioBuffer);
  } catch (err: unknown) {
    logger.error('routes', 'Error proxying recording', { error: String(err) });
    res.status(500).json({ error: 'Failed to stream recording' });
  }
});

// ── Compliance Endpoints ────────────────────────────────────────────

router.get('/api/compliance/dnc', (_req: Request, res: Response) => {
  res.json({ list: getDncList(), count: getDncCount() });
});

router.post('/api/compliance/dnc', (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'Missing phone' });
    return;
  }
  addToDnc(phone);
  res.json({ success: true, count: getDncCount() });
});

router.delete('/api/compliance/dnc/:phone', (req: Request, res: Response) => {
  removeFromDnc(req.params.phone);
  res.json({ success: true, count: getDncCount() });
});

router.post('/api/compliance/check', (req: Request, res: Response) => {
  const { phone, state } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'Missing phone' });
    return;
  }
  const result = runPreCallComplianceCheck(phone, state);
  res.json(result);
});

router.get('/api/compliance/time-check', (req: Request, res: Response) => {
  const state = req.query.state as string;
  res.json(checkCallTimeAllowed(state));
});

router.post('/api/compliance/consent', (req: Request, res: Response) => {
  const { phone, consentType, source, leadId, trustedFormUrl, jornayaId, ip } = req.body;
  if (!phone || !consentType || !source) {
    res.status(400).json({ error: 'Missing required fields: phone, consentType, source' });
    return;
  }
  recordConsent({
    phone, consentType, source,
    timestamp: new Date().toISOString(),
    leadId, trustedFormUrl, jornayaId, ip,
  });
  res.json({ success: true });
});

router.get('/api/compliance/consent/:phone', (req: Request, res: Response) => {
  const consent = getConsent(req.params.phone);
  res.json(consent || { found: false });
});

router.get('/api/compliance/recording-disclosure', (req: Request, res: Response) => {
  const state = req.query.state as string;
  res.json({
    required: requiresRecordingDisclosure(state),
    state: state || 'unknown',
  });
});

router.get('/api/compliance/audit-log', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ entries: getAuditLog(limit), total: getAuditLogCount() });
});

// ── Performance Endpoints ───────────────────────────────────────────

router.get('/api/performance/sessions', (_req: Request, res: Response) => {
  res.json({
    sessions: getActiveSessions(),
    count: getActiveSessionCount(),
    max: getMaxConcurrency(),
  });
});

router.get('/api/performance/queue', (_req: Request, res: Response) => {
  res.json({ queue: getQueue(), size: getQueueSize() });
});

router.get('/api/performance/health', (_req: Request, res: Response) => {
  res.json(getSystemHealth());
});

router.put('/api/performance/concurrency', (req: Request, res: Response) => {
  const { max } = req.body;
  if (typeof max !== 'number' || max < 1) {
    res.status(400).json({ error: 'max must be a positive number' });
    return;
  }
  setMaxConcurrency(max);
  res.json({ max: getMaxConcurrency() });
});

// ── A/B Testing Endpoints ───────────────────────────────────────────

router.get('/api/ab-tests', (_req: Request, res: Response) => {
  res.json(getAllABTests());
});

router.post('/api/ab-tests', (req: Request, res: Response) => {
  try {
    const { id, name, description, active, type, variants } = req.body;
    if (!id || !name || !variants?.length) {
      res.status(400).json({ error: 'Missing required fields: id, name, variants' });
      return;
    }
    const test = createABTest({
      id, name, description: description || '', active: active ?? true,
      type: type || 'settings', variants,
    });
    res.json(test);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get('/api/ab-tests/:id', (req: Request, res: Response) => {
  const test = getABTest(req.params.id);
  if (!test) {
    res.status(404).json({ error: 'Test not found' });
    return;
  }
  res.json(test);
});

router.delete('/api/ab-tests/:id', (req: Request, res: Response) => {
  const deleted = deleteABTest(req.params.id);
  res.json({ success: deleted });
});

router.put('/api/ab-tests/:id/toggle', (req: Request, res: Response) => {
  const { active } = req.body;
  const test = toggleABTest(req.params.id, active ?? true);
  if (!test) {
    res.status(404).json({ error: 'Test not found' });
    return;
  }
  res.json(test);
});

router.post('/api/ab-tests/:id/record', (req: Request, res: Response) => {
  const { variantId, transferred, durationMs, score, costUsd } = req.body;
  if (!variantId) {
    res.status(400).json({ error: 'Missing variantId' });
    return;
  }
  recordABResult(req.params.id, variantId, {
    transferred: transferred ?? false,
    durationMs: durationMs ?? 0,
    score: score ?? 0,
    costUsd: costUsd ?? 0,
  });
  res.json({ success: true });
});

// ── Lead Memory Endpoints ───────────────────────────────────────────

router.get('/api/leads', (req: Request, res: Response) => {
  const disposition = req.query.disposition as string;
  if (disposition) {
    res.json(getLeadsByDisposition(disposition as any));
    return;
  }
  res.json({ leads: getAllLeads(), count: getLeadCount() });
});

router.get('/api/leads/callbacks', (_req: Request, res: Response) => {
  res.json(getLeadsForCallback());
});

router.get('/api/leads/:phone', (req: Request, res: Response) => {
  const lead = getLeadMemory(req.params.phone);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  res.json(lead);
});

router.post('/api/leads', (req: Request, res: Response) => {
  const { phone, name, state, currentInsurer, tags, notes, customFields } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'Missing phone' });
    return;
  }
  const lead = createOrUpdateLead(phone, { name, state, currentInsurer, tags, notes, customFields });
  res.json(lead);
});

router.put('/api/leads/:phone/disposition', (req: Request, res: Response) => {
  const { disposition } = req.body;
  if (!disposition) {
    res.status(400).json({ error: 'Missing disposition' });
    return;
  }
  setLeadDisposition(req.params.phone, disposition);
  res.json({ success: true });
});

router.post('/api/leads/:phone/note', (req: Request, res: Response) => {
  const { note } = req.body;
  if (!note) {
    res.status(400).json({ error: 'Missing note' });
    return;
  }
  addLeadNote(req.params.phone, note);
  res.json({ success: true });
});

router.post('/api/leads/:phone/callback', (req: Request, res: Response) => {
  const { dateTime } = req.body;
  if (!dateTime) {
    res.status(400).json({ error: 'Missing dateTime' });
    return;
  }
  scheduleCallback(req.params.phone, dateTime);
  res.json({ success: true });
});

// ── Prompt Management Endpoints ─────────────────────────────────────

router.get('/api/prompts', (_req: Request, res: Response) => {
  res.json({
    names: getAllPromptNames(),
    environment: getEnvironment(),
  });
});

router.get('/api/prompts/config', (_req: Request, res: Response) => {
  res.json(getHotSwapConfig());
});

router.put('/api/prompts/config', (req: Request, res: Response) => {
  const updated = updateHotSwapConfig(req.body);
  res.json(updated);
});

router.get('/api/prompts/guardrails', (_req: Request, res: Response) => {
  res.json(getGuardrails());
});

router.put('/api/prompts/environment', (req: Request, res: Response) => {
  const { environment } = req.body;
  if (!environment || !['dev', 'staging', 'prod'].includes(environment)) {
    res.status(400).json({ error: 'Invalid environment. Must be dev, staging, or prod' });
    return;
  }
  setEnvironment(environment);
  res.json({ environment: getEnvironment() });
});

router.get('/api/prompts/flags', (_req: Request, res: Response) => {
  res.json(getFeatureFlags());
});

router.post('/api/prompts/flags', (req: Request, res: Response) => {
  const { id, enabled, description, environments, percentage } = req.body;
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }
  const flag = setFeatureFlag(id, enabled ?? true, description, environments, percentage);
  res.json(flag);
});

router.delete('/api/prompts/flags/:id', (req: Request, res: Response) => {
  const deleted = deleteFeatureFlag(req.params.id);
  res.json({ success: deleted });
});

router.get('/api/prompts/flags/:id/check', (req: Request, res: Response) => {
  const env = req.query.environment as string;
  res.json({ enabled: isFeatureEnabled(req.params.id, env as any) });
});

router.get('/api/prompts/:name/versions', (req: Request, res: Response) => {
  res.json(getPromptVersions(req.params.name));
});

router.get('/api/prompts/:name/active', (req: Request, res: Response) => {
  const env = req.query.environment as string;
  const prompt = getActivePrompt(req.params.name, env as any);
  if (!prompt) {
    res.status(404).json({ error: 'No active prompt found' });
    return;
  }
  res.json(prompt);
});

router.post('/api/prompts/:name', (req: Request, res: Response) => {
  const { content, environment, metadata } = req.body;
  if (!content) {
    res.status(400).json({ error: 'Missing content' });
    return;
  }
  const pv = savePromptVersion(req.params.name, content, environment, metadata);
  res.json(pv);
});

router.post('/api/prompts/:name/rollback', (req: Request, res: Response) => {
  const { version } = req.body;
  if (!version) {
    res.status(400).json({ error: 'Missing version' });
    return;
  }
  const pv = rollbackPrompt(req.params.name, version);
  if (!pv) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }
  res.json(pv);
});

// ── Security Endpoints ──────────────────────────────────────────────

router.post('/api/security/pii-check', (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: 'Missing text' });
    return;
  }
  res.json({
    containsPII: containsPII(text),
    types: detectPIITypes(text),
    redacted: redactPII(text),
  });
});

router.get('/api/security/rate-limit/:key', (req: Request, res: Response) => {
  const maxReq = parseInt(req.query.max as string) || 60;
  const windowMs = parseInt(req.query.window as string) || 60000;
  const result = checkRateLimit(req.params.key, maxReq, windowMs);
  res.json(result);
});

// ── Workflow Endpoints ──────────────────────────────────────────────

router.get('/api/workflows/webhooks', (_req: Request, res: Response) => {
  res.json(getWebhooks());
});

router.post('/api/workflows/webhooks', (req: Request, res: Response) => {
  const { id, url, events, active, headers, secret } = req.body;
  if (!id || !url || !events?.length) {
    res.status(400).json({ error: 'Missing required fields: id, url, events' });
    return;
  }
  registerWebhook({ id, url, events, active: active ?? true, headers, secret });
  res.json({ success: true });
});

router.delete('/api/workflows/webhooks/:id', (req: Request, res: Response) => {
  const removed = removeWebhook(req.params.id);
  res.json({ success: removed });
});

router.get('/api/workflows/config', (_req: Request, res: Response) => {
  res.json(getWorkflowConfig());
});

router.put('/api/workflows/config', (req: Request, res: Response) => {
  const updated = updateWorkflowConfig(req.body);
  res.json(updated);
});

// ── Routing Endpoints ───────────────────────────────────────────────

router.get('/api/routing/providers', (_req: Request, res: Response) => {
  res.json(getProviders());
});

router.post('/api/routing/providers', (req: Request, res: Response) => {
  try {
    registerProvider(req.body);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.delete('/api/routing/providers/:id', (req: Request, res: Response) => {
  const removed = removeProvider(req.params.id);
  res.json({ success: removed });
});

router.get('/api/routing/health', (_req: Request, res: Response) => {
  res.json(getProviderHealth());
});

router.get('/api/routing/strategy', (_req: Request, res: Response) => {
  res.json({ strategy: getRoutingStrategy() });
});

router.put('/api/routing/strategy', (req: Request, res: Response) => {
  const { strategy } = req.body;
  if (!strategy) {
    res.status(400).json({ error: 'Missing strategy' });
    return;
  }
  setRoutingStrategy(strategy);
  res.json({ strategy: getRoutingStrategy() });
});

.973
971
// ── Helper: Normalize phone number ────────────────────────────────────
function normalizePhone(phone: string): string {
    return phone.replace(/[^0-9+]/g, '');
}

// ── Weblead Webhook Endpoint (Jangl/QuotingFast format) ────────────────
router.post('/webhook/weblead', async (req: Request, res: Response) => {
    try {
          const body = req.body;
          const contact = body.contact || {};
          const data = body.data || {};
          const meta = body.meta || {};

          // Extract and normalize phone number from various possible fields
          const rawPhone = (
                  contact.phone || 
                  body.phone || 
                  body.phone_number || 
                  body.primary_phone || 
                  ''
                ).toString().trim();

          const phone = normalizePhone(rawPhone);

          if (!phone) {
                  res.status(400).json({ error: 'Missing phone' });
                  return;
          }

          // Extract contact info
          const firstName = contact.first_name || body.first_name || body.firstName || 'Unknown';
          const lastName = contact.last_name || body.last_name || body.lastName || '';
          const state = contact.state || body.state || '';
          const city = contact.city || body.city || '';
          const email = contact.email || body.email || '';
          const zipCode = contact.zip_code || body.zip_code || body.zip || '';
          const address = contact.address || body.address || '';

          // Extract policy/insurance data
          const currentPolicy = data.current_policy || {};
          const requestedPolicy = data.requested_policy || {};
          const currentInsurer = currentPolicy.insurance_company || body.current_insurer || body.current_carrier || '';

          // Extract drivers info (for display/notes)
          const drivers = data.drivers || [];
          const vehicles = data.vehicles || [];

          // Build form data summary for notes
          const formDataSummary: Record<string, any> = {
                  contact: { firstName, lastName, state, city, email, zipCode, address },
                  leadId: body.id,
                  timestamp: body.timestamp,
                  sellPrice: body.sell_price,
                  campaignId: body.campaign_id,
                  tcpaCompliant: meta.tcpa_compliant,
                  trustedFormUrl: meta.trusted_form_cert_url,
                  driversCount: drivers.length,
                  vehiclesCount: vehicles.length,
          };

          // Store detailed driver info
          if (drivers.length > 0) {
                  formDataSummary.primaryDriver = {
                            name: `${drivers[0].first_name || ''} ${drivers[0].last_name || ''}`.trim(),
                            dob: drivers[0].birth_date,
                            maritalStatus: drivers[0].marital_status,
                            occupation: drivers[0].occupation,
                            education: drivers[0].education,
                  };
          }

          // Store vehicle info
          if (vehicles.length > 0) {
                  formDataSummary.primaryVehicle = {
                            year: vehicles[0].year,
                            make: vehicles[0].make,
                            model: vehicles[0].model,
                            vin: vehicles[0].vin,
                            annualMiles: vehicles[0].annual_miles,
                            primaryUse: vehicles[0].primary_use,
                  };
          }

          // Store current & requested policy info
          if (currentPolicy.insurance_company) {
                  formDataSummary.currentPolicy = {
                            insurer: currentPolicy.insurance_company,
                            coverageType: currentPolicy.coverage_type,
                            insuredSince: currentPolicy.insured_since,
                            expirationDate: currentPolicy.expiration_date,
                  };
          }

          if (requestedPolicy.coverage_type) {
                  formDataSummary.requestedPolicy = {
                            coverageType: requestedPolicy.coverage_type,
                            bodilyInjury: requestedPolicy.bodily_injury,
                            propertyDamage: requestedPolicy.property_damage,
                  };
          }

          const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';

          // Create/update lead with all the form data
          const lead = createOrUpdateLead(phone, {
                  name: fullName,
                  state,
                  currentInsurer,
                  tags: ['weblead', 'jangl'],
                  customFields: formDataSummary,
          });

          // Add auto-generated note with form submission details
          addLeadNote(phone, `Weblead received: ${drivers.length} driver(s), ${vehicles.length} vehicle(s). Current insurer: ${currentInsurer || 'N/A'}. Lead ID: ${body.id || 'N/A'}`);

          // Check settings for auto-dial
          const settings = getSettings();
          const autoDialEnabled = settings.webleadAutoDialEnabled !== false; // default true
          const fromNumber = settings.defaultFromNumber || config.twilio?.fromNumber || '';

          if (autoDialEnabled && fromNumber) {
                  const compliance = runPreCallComplianceCheck(phone, state);

                  if (compliance.allowed) {
                            const cr = await startOutboundCall({
                                        to: phone,
                                        from: fromNumber,
                                        lead: {
                                                      first_name: firstName,
                                                      state,
                                                      current_insurer: currentInsurer,
                                        },
                            });

                            registerPendingSession(cr.callSid, {
                                        first_name: firstName,
                                        state,
                                        current_insurer: currentInsurer,
                            });

                            recordCall(cr.callSid, phone, firstName);

                            logger.info('routes', 'Weblead call started', { 
                                        phone, 
                                        callSid: cr.callSid,
                                        leadId: body.id,
                            });

                            res.json({
                                        success: true,
                                        phone,
                                        name: fullName,
                                        state,
                                        callSid: cr.callSid,
                                        autoDialed: true,
                                        formData: formDataSummary,
                            });
                            return;
                  }

                  logger.info('routes', 'Weblead compliance failed', { phone, state });
                  res.json({
                            success: true,
                            phone,
                            name: fullName,
                            state,
                            call: null,
                            reason: 'compliance',
                            autoDialed: false,
                            formData: formDataSummary,
                  });
                  return;
          }

          // Auto-dial disabled or no from number configured
          logger.info('routes', 'Weblead stored (no auto-dial)', { phone, leadId: body.id });
          res.json({
                  success: true,
                  phone,
                  name: fullName,
                  state,
                  call: null,
                  autoDialed: false,
                  reason: autoDialEnabled ? 'no_from_number' : 'auto_dial_disabled',
                  formData: formDataSummary,
          });

    } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('routes', 'Weblead webhook error', { error: msg });
          res.status(500).json({ error: msg });
    }
});


// Weblead Webhook - receives leads from Jangl/QuotingFast
router.post('/webhook/weblead', async (req: Request, res: Response) => {
    try {
          const body = req.body;
          logger.info('Weblead webhook received:', { body });

          // Normalize phone number - remove non-digits
          const normalizePhone = (phone: string | undefined): string => {
                  if (!phone) return '';
                  return phone.replace(/\D/g, '');
          };

          // Extract phone from various possible locations (Jangl format)
          let phone = normalizePhone(body.phone) || 
                            normalizePhone(body.contact?.phone) || 
                            normalizePhone(body.lead?.phone) ||
                            normalizePhone(body.data?.phone);

          if (!phone) {
                  logger.warn('Weblead webhook: Missing phone number');
                  return res.status(400).json({ error: 'Missing phone' });
          }

          // Ensure phone has country code
          if (phone.length === 10) {
                  phone = '1' + phone;
          }
          if (!phone.startsWith('+')) {
                  phone = '+' + phone;
          }

          // Extract name from various possible locations
          const firstName = body.contact?.first_name || body.first_name || body.firstName || body.lead?.firstName || '';
          const lastName = body.contact?.last_name || body.last_name || body.lastName || body.lead?.lastName || '';
          const name = `${firstName} ${lastName}`.trim() || 'Web Lead';

          // Build customFields from all available data
          const customFields: Record<string, any> = {};

          // Contact info
          if (body.contact) {
                  customFields.email = body.contact.email;
                  customFields.address = body.contact.address;
                  customFields.city = body.contact.city;
                  customFields.state = body.contact.state;
                  customFields.zip = body.contact.zip;
          }

          // Driver info (if present in data.drivers)
          if (body.data?.drivers && Array.isArray(body.data.drivers)) {
                  customFields.drivers = body.data.drivers.map((d: any) => ({
                            name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
                            dob: d.dob,
                            gender: d.gender,
                            marital_status: d.marital_status,
                            license_status: d.license_status
                  }));
          }

          // Vehicle info (if present in data.vehicles)
          if (body.data?.vehicles && Array.isArray(body.data.vehicles)) {
                  customFields.vehicles = body.data.vehicles.map((v: any) => ({
                            year: v.year,
                            make: v.make,
                            model: v.model,
                            vin: v.vin
                  }));
          }

          // Policy info
          if (body.data?.policy) {
                  customFields.currentInsurer = body.data.policy.current_insurer;
                  customFields.coverageType = body.data.policy.coverage_type;
          }

          // Store lead source info
          customFields.leadSource = 'weblead';
          customFields.receivedAt = new Date().toISOString();
          customFields.rawPayload = body;

          // Auto-generated notes
          const notes = `Web lead received at ${new Date().toLocaleString()}. ` +
                  (firstName ? `Contact: ${name}. ` : '') +
                  (customFields.email ? `Email: ${customFields.email}. ` : '') +
                  (customFields.drivers?.length ? `${customFields.drivers.length} driver(s). ` : '') +
                  (customFields.vehicles?.length ? `${customFields.vehicles.length} vehicle(s). ` : '');

          // Check if auto-dial is enabled
          const settings = getSettings();
          const autoDialEnabled = settings.webleadAutoDialEnabled !== false;

          if (autoDialEnabled) {
                  // Add lead to memory and initiate call
                  addLead({
                            phone,
                            name,
                            customFields,
                            notes,
                            status: 'pending',
                            attempts: 0,
                            lastAttempt: null,
                            scheduledCallback: null,
                            disposition: null
                  });

                  logger.info('Weblead added to queue:', { phone, name, autoDialEnabled });

                  return res.json({ 
                            success: true, 
                            message: 'Lead received and queued for dialing',
                            phone,
                            name
                  });
          } else {
                  // Just store the lead without auto-dialing
                  addLead({
                            phone,
                            name,
                            customFields,
                            notes,
                            status: 'pending',
                            attempts: 0,
                            lastAttempt: null,
                            scheduledCallback: null,
                            disposition: null
                  });

                  logger.info('Weblead stored (auto-dial disabled):', { phone, name });

                  return res.json({ 
                            success: true, 
                            message: 'Lead received and stored (auto-dial disabled)',
                            phone,
                            name
                  });
          }
    } catch (error) {
          logger.error('Weblead webhook error:', error);
          return res.status(500).json({ error: 'Internal server error' });
    }
});



export { router };
