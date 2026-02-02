import { Router, Request, Response } from 'express';
import { startOutboundCall, StartCallParams } from '../twilio/client';
import { buildMediaStreamTwiml, buildTransferTwiml } from '../twilio/twiml';
import { registerPendingSession } from '../audio/stream';
import { TransferConfig, buildSystemPrompt } from '../agent/prompts';
import { getSettings, updateSettings, recordCall, getCallHistory } from '../config/runtime';
import { getDashboardHtml } from './dashboard';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();

// In-memory cache for voice preview audio (voice -> mp3 Buffer)
const voicePreviewCache = new Map<string, Buffer>();
const PREVIEW_TEXT = "Hey there! This is a quick preview of how I sound. Pretty natural, right?";

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

    const result = await startOutboundCall({ to, from, lead });

    // Register session data so the WebSocket handler can pick it up when the call connects
    registerPendingSession(result.callSid, lead, transfer);

    // Record this call with current settings for history tracking
    recordCall(result.callSid, to, lead.first_name);

    logger.info('routes', 'Call started', { callSid: result.callSid, to });

    res.json({
      call_sid: result.callSid,
      status: result.status,
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
 * Returns TwiML that starts a Media Stream to our WebSocket.
 */
router.post('/twilio/voice', (req: Request, res: Response) => {
  const callSid = req.body?.CallSid || 'unknown';
  const lead = req.query.lead ? JSON.parse(req.query.lead as string) : null;
  const transfer = req.query.transfer ? JSON.parse(req.query.transfer as string) : null;

  logger.info('routes', 'Voice webhook hit', { callSid });

  // If we got lead data via query params, register the session
  if (lead && callSid !== 'unknown') {
    registerPendingSession(callSid, lead, transfer);
  }

  const twiml = buildMediaStreamTwiml();
  res.type('text/xml');
  res.send(twiml);
});

/**
 * POST /twilio/transfer
 * TwiML endpoint for warm transfer. Called when we update the call URL.
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
 * Status callback for call events.
 */
router.post('/twilio/status', (req: Request, res: Response) => {
  const { CallSid, CallStatus } = req.body || {};
  logger.info('routes', 'Call status update', { callSid: CallSid, status: CallStatus });
  res.sendStatus(200);
});

/**
 * GET /health
 * Health check endpoint.
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /dashboard
 * Web dashboard for managing settings and making test calls.
 */
router.get('/dashboard', (_req: Request, res: Response) => {
  res.type('text/html');
  res.send(getDashboardHtml());
});

/**
 * GET /api/settings
 * Returns current runtime settings.
 */
router.get('/api/settings', (_req: Request, res: Response) => {
  res.json(getSettings());
});

/**
 * PUT /api/settings
 * Update runtime settings. Partial updates supported.
 */
router.put('/api/settings', (req: Request, res: Response) => {
  const updated = updateSettings(req.body);
  logger.info('routes', 'Settings updated', { keys: Object.keys(req.body) });
  res.json(updated);
});

/**
 * GET /api/calls
 * Returns recent call history with the settings used for each call.
 */
router.get('/api/calls', (_req: Request, res: Response) => {
  res.json(getCallHistory());
});

/**
 * GET /api/default-prompt
 * Returns the default system prompt template for reference.
 */
router.get('/api/default-prompt', (_req: Request, res: Response) => {
  const prompt = buildSystemPrompt({ first_name: '{{first_name}}', state: '{{state}}', current_insurer: '{{current_insurer}}' });
  res.json({ prompt });
});

/**
 * GET /api/voice-preview/:voice
 * Returns an MP3 audio preview of the given voice using OpenAI TTS.
 * Results are cached in memory so each voice is only generated once.
 */
router.get('/api/voice-preview/:voice', async (req: Request, res: Response) => {
  const voice = req.params.voice;
  const validVoices = ['alloy','ash','ballad','coral','echo','sage','shimmer','verse'];
  if (!validVoices.includes(voice)) {
    res.status(400).json({ error: 'Invalid voice. Valid: ' + validVoices.join(', ') });
    return;
  }

  try {
    // Check cache first
    if (voicePreviewCache.has(voice)) {
      res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' });
      res.send(voicePreviewCache.get(voice));
      return;
    }

    // Generate via OpenAI TTS API
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

    // Cache for future requests
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

/**
 * GET /api/elevenlabs-voice-preview/:voiceId
 * Returns an MP3 audio preview of the given ElevenLabs voice.
 * Results are cached in memory so each voice is only generated once.
 */
const elPreviewCache = new Map<string, Buffer>();
const EL_PREVIEW_TEXT = "Hey there! This is a quick preview of how I sound. Pretty natural, right?";

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

export { router };
