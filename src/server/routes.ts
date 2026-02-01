import { Router, Request, Response } from 'express';
import { startOutboundCall, StartCallParams } from '../twilio/client';
import { buildMediaStreamTwiml, buildTransferTwiml } from '../twilio/twiml';
import { registerPendingSession } from '../audio/stream';
import { TransferConfig, buildSystemPrompt } from '../agent/prompts';
import { getSettings, updateSettings, recordCall, getCallHistory } from '../config/runtime';
import { getDashboardHtml } from './dashboard';
import { logger } from '../utils/logger';

const router = Router();

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

export { router };
