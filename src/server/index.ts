import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { router } from './routes';
import { handleMediaStream } from '../audio/stream';
import { config } from '../config';
import { logger } from '../utils/logger';
import { startScheduler, setDialFunction } from '../scheduler';
import { startOutboundCall } from '../twilio/client';
import { registerPendingSession } from '../audio/stream';
import { recordCall } from '../config/runtime';

export function createServer(): http.Server {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount routes
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
  const server = createServer();

  server.listen(config.port, () => {
    logger.info('server', `Server listening on port ${config.port}`);
    logger.info('server', `Base URL: ${config.baseUrl}`);
    logger.info('server', `Realtime model: ${config.openai.realtimeModel}`);
    logger.info('server', `Voice: ${config.openai.voice}`);
    logger.info('server', `TTS Provider: ${config.ttsProvider}`);
    logger.info('server', `DeepSeek: ${config.deepseek.apiKey ? 'configured' : 'not configured'}`);
    logger.info('server', `Debug mode: ${config.debug}`);
    logger.info('server', 'Endpoints:');
    logger.info('server', `  Dashboard:  ${config.baseUrl}/dashboard`);
    logger.info('server', `  Outbound:   POST ${config.baseUrl}/call/start`);
    logger.info('server', `  Inbound:    POST ${config.baseUrl}/twilio/incoming`);
    logger.info('server', `  Voice:      POST ${config.baseUrl}/twilio/voice`);
    logger.info('server', `  Stream:     WS   ${config.baseUrl.replace(/^http/, 'ws')}/twilio/stream`);
    logger.info('server', `  Health:     GET  ${config.baseUrl}/health`);
    logger.info('server', `  SMS In:     POST ${config.baseUrl}/twilio/sms-incoming`);

    // Start callback/retry scheduler
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
  });
}
