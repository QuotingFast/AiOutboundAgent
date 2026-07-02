import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { router, loadRecordingsFromDisk, syncRecordingsFromTwilio } from './routes';
import { handleMediaStream } from '../audio/stream';
import { config } from '../config';
import { logger } from '../utils/logger';
import { startScheduler, setDialFunction } from '../scheduler';
import { startOutboundCall } from '../twilio/client';
import { registerPendingSession } from '../audio/stream';
import { recordCall, loadRuntimeFromDisk } from '../config/runtime';
import { campaignRouter } from '../campaign/routes';
import { resolveCampaignMiddleware } from '../campaign/middleware';
import {
  seedCampaigns,
  isFeatureFlagEnabled,
  recordOutboundCall,
  getCampaign,
  loadCampaignStoreFromDisk,
} from '../campaign/store';
import {
  setCampaignDialFunction,
  startScheduledCallbackWorker,
} from '../campaign/scheduled-callbacks';
import { loadLeadsFromDisk } from '../memory';
import { flushAll, initPostgresPersistence } from '../db/persistence';
import { startAudioSocketServer } from '../audiosocket/server';
import { initOfficeNoise } from '../audio/noise';
import { platformRouter, initPlatform, requireAuth, twilioWebhookGuard, webleadGuard, authEnabled, startLifecycleWorker, setJourneyHandlers, startJourneyWorker, recordEvent as platformRecordEvent } from '../platform';
import { sendSMS as workflowSendSMS } from '../workflows';
import { getLoginHtml } from '../platform/dashboard/login';

export function createServer(): http.Server {
  const app = express();

  // Allow larger dashboard payloads (e.g., CSV lead imports)
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // ── Security perimeter ────────────────────────────────────────────
  // Twilio webhooks: signature validation (TWILIO_VALIDATE_SIGNATURE=true).
  app.use('/twilio', twilioWebhookGuard());
  // Lead-ingestion webhooks: shared secret / HMAC (WEBLEAD_SHARED_SECRET).
  app.use(['/webhook', '/webhooks'], webleadGuard());
  // Dashboard + APIs: session auth when ADMIN_PASSWORD is configured.
  // Twilio/webhook/health/audiosocket/login paths stay outside session auth.
  app.get('/login', (_req, res) => { res.type('html').send(getLoginHtml()); });
  app.use(['/dashboard', '/api'], (req, res, next) => {
    // The v2 auth endpoints must be reachable to log in.
    if (req.path.startsWith('/v2/auth/') || (req.baseUrl === '/api' && req.path.startsWith('/v2/auth/'))) { next(); return; }
    requireAuth('viewer')(req, res, next);
  });

  // Campaign context resolution middleware (runs on all routes)
  app.use(resolveCampaignMiddleware);

  // Platform v2 APIs (policy, buyers, cadence, rebuttals, QA, profiles, SSE)
  app.use(platformRouter);

  // Mount campaign management routes
  app.use(campaignRouter);

  // Mount main routes
  app.use(router);

  // Create HTTP server
  const server = http.createServer(app);

  // WebSocket server for Twilio Media Streams
  const wss = new WebSocket.Server({ server, path: '/twilio/stream' });

  wss.on('connection', (ws: WebSocket) => {
    logger.info('server', 'New WebSocket connection on /twilio/stream');
    handleMediaStream(ws);
  });

  wss.on('error', (err) => {
    logger.error('server', 'WebSocket server error', { error: err.message });
  });

  return server;
}

export async function startServer(): Promise<void> {
  // Graceful shutdown: flush all pending writes to disk
  const shutdownHandler = (signal: string) => {
    logger.info('server', `Received ${signal}, flushing data to disk...`);
    flushAll();
    logger.info('server', 'Data flushed. Exiting.');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  const server = createServer();

  // Bind the port FIRST so Render's port-scan health check passes immediately.
  // Postgres init and store loading happen after — requests during that window
  // will work with file-based persistence or empty state (harmless at cold start).
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  logger.info('server', `Port ${config.port} open`);

  // Init persistence backend (Postgres if DATABASE_URL set, else file-based)
  await initPostgresPersistence();

  // Load persisted data
  logger.info('server', 'Loading persisted data...');
  loadRuntimeFromDisk();
  loadLeadsFromDisk();
  loadCampaignStoreFromDisk();
  loadRecordingsFromDisk();
  logger.info('server', 'Persisted data loaded');

  // Seed default campaigns (skips if campaigns already loaded from disk)
  seedCampaigns();

  // Platform layer: event ledger, policy engine, buyers, cadence,
  // rebuttals, QA, profiles, security (loads persisted compliance state)
  initPlatform();
  logger.info('server', `Auth: ${authEnabled() ? 'ENABLED' : 'DISABLED (set ADMIN_PASSWORD)'}`);

  // Lifecycle renewal worker: keeps consented leads in the funnel by
  // pushing policy-gated re-opt-in links before the 90-day TCPA expiry
  // (auto-send only when lifecycle config enables it).
  startLifecycleWorker((to, body) => workflowSendSMS(to, body));

  // Journey worker: executes the scripted new-lead funnel (calls +
  // humanized SMS). Calls reuse the same outbound path as webleads;
  // SMS go through Twilio with human-timing delays applied upstream.
  setJourneyHandlers(
    async (phone, campaignId) => {
      try {
        const campaign = campaignId ? getCampaign(campaignId) : undefined;
        const from = campaign?.assignedDids[0] || config.twilio.fromNumber;
        if (!from) return false;
        const lead = (await import('../memory')).getLeadMemory(phone);
        const firstName = (lead?.name || '').split(' ')[0] || 'there';
        const result = await startOutboundCall({
          to: phone,
          from,
          lead: { first_name: firstName, state: lead?.state, current_insurer: lead?.currentInsurer },
        });
        registerPendingSession(result.callSid, { first_name: firstName, state: lead?.state }, undefined, phone, campaignId);
        recordCall(result.callSid, phone, firstName);
        platformRecordEvent('call.attempted', { source: 'journey', state: lead?.state }, { phone, callSid: result.callSid, campaignId });
        return true;
      } catch (err) {
        logger.error('journey', 'Journey dial failed', { phone, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    },
    (to, body) => workflowSendSMS(to, body),
  );
  startJourneyWorker();

  // Pre-load the office-ambience buffer
  initOfficeNoise()
    .then(() => logger.info('server', 'Office ambience buffer ready'))
    .catch((err) => logger.error('server', 'Office ambience init failed', { error: String(err) }));

  logger.info('server', `Server listening on port ${config.port}`);
  logger.info('server', `Base URL: ${config.baseUrl}`);
  logger.info('server', `Realtime model: ${config.openai.realtimeModel}`);
  logger.info('server', `Voice: ${config.openai.voice}`);
  logger.info('server', `TTS Provider: ${config.ttsProvider}`);
  logger.info('server', `DeepSeek: ${config.deepseek.apiKey ? 'configured' : 'not configured'}`);
  logger.info('server', `Debug mode: ${config.debug}`);
  logger.info('server', `Multi-campaign mode: ${isFeatureFlagEnabled('multi_campaign_mode')}`);
  logger.info('server', `Hardened isolation: ${isFeatureFlagEnabled('hardened_campaign_isolation')}`);
  logger.info('server', 'Endpoints:');
  logger.info('server', `  Dashboard:  ${config.baseUrl}/dashboard`);
  logger.info('server', `  Outbound:   POST ${config.baseUrl}/call/start`);
  logger.info('server', `  Inbound:    POST ${config.baseUrl}/twilio/incoming`);
  logger.info('server', `  Voice:      POST ${config.baseUrl}/twilio/voice`);
  logger.info('server', `  Stream:     WS   ${config.baseUrl.replace(/^http/, 'ws')}/twilio/stream`);
  logger.info('server', `  Health:     GET  ${config.baseUrl}/health`);
  logger.info('server', `  SMS In:     POST ${config.baseUrl}/twilio/sms-incoming`);
  logger.info('server', `  Jangl:      POST ${config.baseUrl}/webhooks/jangl`);
  logger.info('server', `  Weblead:    POST ${config.baseUrl}/webhook/weblead`);
  logger.info('server', `  Campaigns:  GET  ${config.baseUrl}/api/campaigns`);
  logger.info('server', `  AudioSocket: TCP ${config.audiosocket.host}:${config.audiosocket.port} (${config.audiosocket.enabled ? 'enabled' : 'disabled'})`);

  // Start AudioSocket TCP server for Asterisk/VICIdial integration
  if (config.audiosocket.enabled) {
    startAudioSocketServer(config.audiosocket.port, config.audiosocket.host);
  }

  // Backfill any recordings missed while server was down
  syncRecordingsFromTwilio().then(({ synced, total }) => {
    if (synced > 0) {
      logger.info('server', `Recording sync complete: ${synced} new, ${total} total`);
    }
  }).catch(err => {
    logger.error('server', 'Recording sync failed on startup', { error: String(err) });
  });

  // Start callback/retry scheduler (legacy)
  setDialFunction(async (phone: string, leadName: string, state?: string) => {
    try {
      const from = config.twilio.fromNumber;
      if (!from) return false;
      const result = await startOutboundCall({
        to: phone,
        from,
        lead: { first_name: leadName, state },
      });
      registerPendingSession(result.callSid, { first_name: leadName, state }, undefined, phone);
      recordCall(result.callSid, phone, leadName);
      logger.info('scheduler', 'Auto-dialed callback/retry', { callSid: result.callSid, phone });
      return true;
    } catch (err) {
      logger.error('scheduler', 'Auto-dial failed', { phone, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  });
  startScheduler();

  // Start campaign-locked scheduled callback worker
  setCampaignDialFunction(async (params) => {
    try {
      const campaign = getCampaign(params.campaignId);
      if (!campaign) return false;
      const from = campaign.assignedDids[0] || config.twilio.fromNumber;
      if (!from) return false;
      const result = await startOutboundCall({
        to: params.phone,
        from,
        lead: { first_name: 'Callback' },
      });
      registerPendingSession(result.callSid, { first_name: 'Callback' }, undefined, params.phone);
      recordCall(result.callSid, params.phone, 'Scheduled Callback');
      recordOutboundCall({
        callId: result.callSid,
        leadId: params.leadId,
        toPhone: params.phone,
        fromDid: from,
        campaignId: params.campaignId,
        aiProfileId: params.aiProfileId,
        voiceId: params.voiceId,
        messageProfileId: campaign.smsTemplateSetId,
        timestamp: new Date().toISOString(),
        status: 'initiated',
      });
      logger.info('scheduler', 'Campaign callback dialed', {
        callSid: result.callSid,
        campaignId: params.campaignId,
        phone: params.phone,
      });
      return true;
    } catch (err) {
      logger.error('scheduler', 'Campaign callback dial failed', {
        phone: params.phone,
        campaignId: params.campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  });
  startScheduledCallbackWorker();
}
