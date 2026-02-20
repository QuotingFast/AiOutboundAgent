import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { router, loadRecordingsFromDisk } from './routes';
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
import { flushAll } from '../db/persistence';
import { loadAnalyticsFromDisk } from '../analytics';
import { loadComplianceFromDisk } from '../compliance';

export function createServer(): http.Server {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Campaign context resolution middleware (runs on all routes)
  app.use(resolveCampaignMiddleware);

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

export function startServer(): void {
  // Load persisted data from disk before anything else
  logger.info('server', 'Loading persisted data from disk...');
  loadRuntimeFromDisk();
  loadLeadsFromDisk();
  loadCampaignStoreFromDisk();
  loadRecordingsFromDisk();
  loadAnalyticsFromDisk();
  loadComplianceFromDisk();
  logger.info('server', 'Persisted data loaded');

  // Seed default campaigns (skips if campaigns already loaded from disk)
  seedCampaigns();

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

  server.listen(config.port, () => {
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
    logger.info('server', `  Campaigns:  GET  ${config.baseUrl}/api/campaigns`);

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
        // Record outbound call for campaign tracking
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
  });
}
