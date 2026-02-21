import { Router, Request, Response } from 'express';
import { startOutboundCall, StartCallParams, sendSms, endCall } from '../twilio/client';
import { buildMediaStreamTwiml, buildTransferTwiml, escapeXml } from '../twilio/twiml';
import { registerPendingSession } from '../audio/stream';
import { TransferConfig, buildSystemPrompt } from '../agent/prompts';
import { getSettings, updateSettings, recordCall, getCallHistory } from '../config/runtime';
import { getDashboardHtml } from './dashboard';
import { config } from '../config';
import { getVoicePreset } from '../config/voice-presets';
import { logger } from '../utils/logger';
import { loadData, scheduleSave } from '../db/persistence';

// Module imports
import { getAnalyticsHistory, getAnalyticsSummary, getActiveAnalytics } from '../analytics';
import {
  addToDnc, removeFromDnc, getDncList, getDncCount,
  runPreCallComplianceCheck, checkCallTimeAllowed,
  recordConsent, getConsent,
  getAuditLog, getAuditLogCount,
  requiresRecordingDisclosure,
  checkPhoneRateLimit,
} from '../compliance';
import {
  getActiveSessions, getActiveSessionCount, getQueue, getQueueSize,
  getSystemHealth, setMaxConcurrency, getMaxConcurrency, canAcceptCall,
} from '../performance';
import {
  createABTest, getABTest, getAllABTests, deleteABTest,
  toggleABTest, recordABResult,
} from '../testing/ab';
import {
  getAllLeads, getLeadMemory, createOrUpdateLead,
  setLeadDisposition, addLeadNote, addLeadTag, scheduleCallback,
  getLeadCount, getLeadsByDisposition, getLeadsForCallback,
  searchLeads, importLeadsFromCSV, exportLeadsToCSV, calculateLeadScore,
} from '../memory';
import {
  logSms, getSmsLog, getSmsLogForLead, getSmsStats,
  getTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  renderTemplate,
} from '../sms';
import {
  scheduleCallback as scheduleCallbackTimer,
  cancelCallback as cancelCallbackTimer,
  getUpcomingCallbacks, getPastCallbacks,
  getCallbacks as getSchedulerCallbacks,
  getRetries, scheduleRetry,
} from '../scheduler';
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

// Campaign imports
import {
  enforceOutboundDial,
  enforceInboundCall,
  enforceSmsSend,
} from '../campaign/middleware';
import {
  resolveCallbackCampaign,
  buildFallbackIvrTwiml,
} from '../campaign/callback-router';
import {
  recordOutboundCall,
  isFeatureFlagEnabled as isCampaignFlagEnabled,
  getCampaign,
  logEnforcement,
} from '../campaign/store';
import { CampaignContext } from '../campaign/types';

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

const RECORDINGS_KEY = 'recordings';

function persistRecordings(): void {
  scheduleSave(RECORDINGS_KEY, () => recordingStore);
}

export function loadRecordingsFromDisk(): void {
  const data = loadData<CallRecording[]>(RECORDINGS_KEY);
  if (data) {
    recordingStore.push(...data);
    logger.info('routes', `Loaded ${recordingStore.length} recordings from disk`);
  }
}

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
    const { to, from, lead, transfer, campaign_id } = req.body as StartCallParams & { transfer?: TransferConfig; campaign_id?: string };

    if (!to) {
      res.status(400).json({ error: 'Missing required field: to' });
      return;
    }
    if (!lead?.first_name) {
      res.status(400).json({ error: 'Missing required field: lead.first_name' });
      return;
    }

    // Campaign enforcement (if hardened isolation is enabled)
    const campaignEnforcement = enforceOutboundDial({
      phone: to,
      campaignId: campaign_id,
      leadId: to,
    });
    if (isCampaignFlagEnabled('hardened_campaign_isolation') && !campaignEnforcement.allowed) {
      res.status(403).json({
        error: 'Campaign context required for outbound dial',
        reason: campaignEnforcement.reason,
      });
      return;
    }

    // Concurrency check
    if (!canAcceptCall()) {
      res.status(429).json({ error: 'Max concurrent calls reached. Try again later.' });
      return;
    }

    // Pre-call compliance check
    const settings = getSettings();

    // Per-phone rate limiting
    if (settings.maxCallsPerPhonePerDay > 0) {
      const rateCheck = checkPhoneRateLimit(to, settings.maxCallsPerPhonePerDay);
      if (!rateCheck.allowed) {
        res.status(429).json({ error: `Phone called ${rateCheck.callsToday} times today (max: ${settings.maxCallsPerPhonePerDay})` });
        return;
      }
    }

    const compliance = runPreCallComplianceCheck(to, lead.state, settings.tcpaOverride);
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

    const result = await startOutboundCall({ to, from, lead, amdEnabled: settings.amdEnabled });

    // Register session data so the WebSocket handler can pick it up when the call connects
    // Always pass campaign_id through — even when hardened isolation is off, the stream
    // handler uses it to load the correct AI profile, voice, and system prompt.
    const resolvedCampaignId = campaignEnforcement.context?.campaignId || campaign_id || undefined;
    registerPendingSession(result.callSid, lead, transfer, to, resolvedCampaignId);

    // Record this call with current settings for history tracking
    recordCall(result.callSid, to, lead.first_name);

    // Record outbound call for campaign tracking
    const ctx = campaignEnforcement.context || req.campaignContext;
    if (ctx) {
      recordOutboundCall({
        callId: result.callSid,
        leadId: null,
        toPhone: to,
        fromDid: from || settings.defaultFromNumber || config.twilio.fromNumber,
        campaignId: ctx.campaignId,
        aiProfileId: ctx.aiProfileId,
        voiceId: ctx.voiceId,
        messageProfileId: ctx.smsTemplateSetId,
        timestamp: new Date().toISOString(),
        status: 'initiated',
      });
    }

    // Create/update lead in memory so it appears in the Leads tab
    createOrUpdateLead(to, {
      name: lead.first_name,
      state: lead.state,
      currentInsurer: lead.current_insurer,
      customFields: ctx ? { campaignId: ctx.campaignId } : undefined,
    });

    logger.info('routes', 'Call started', {
      callSid: result.callSid,
      to,
      campaignId: ctx?.campaignId || 'none',
    });

    res.json({
      call_sid: result.callSid,
      status: result.status,
      campaign_id: ctx?.campaignId || null,
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
  const toPhone = req.body?.To || '';
  let lead = null;
  let transfer = null;
  try { if (req.query.lead) lead = JSON.parse(req.query.lead as string); } catch {}
  try { if (req.query.transfer) transfer = JSON.parse(req.query.transfer as string); } catch {}

  logger.info('routes', 'Voice webhook hit', { callSid, toPhone });

  if (lead && callSid !== 'unknown') {
    registerPendingSession(callSid, lead, transfer, toPhone);
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

  // Campaign callback routing (if hardened isolation is enabled)
  if (isCampaignFlagEnabled('hardened_campaign_isolation')) {
    const callbackResult = resolveCallbackCampaign({
      callerPhone: callerNumber,
      calledDid: calledNumber,
    });

    if (callbackResult.useFallbackIvr) {
      // Ambiguous or unresolved -> safe fallback IVR
      logger.info('routes', 'Using fallback IVR for ambiguous callback', {
        callSid,
        callerNumber,
        reason: callbackResult.fallbackReason,
      });
      res.type('text/xml');
      res.send(buildFallbackIvrTwiml(callerNumber));
      return;
    }

    if (callbackResult.resolved && callbackResult.context) {
      // Resolved to a specific campaign
      const ctx = callbackResult.context;
      const campaign = getCampaign(ctx.campaignId);

      // Check if this campaign has inbound enabled
      if (campaign && !campaign.features.inboundEnabled) {
        logger.info('routes', 'Campaign inbound disabled', {
          callSid,
          campaignId: ctx.campaignId,
        });
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">We're sorry, we are not accepting calls at this time. Please try again later.</Say>
  <Hangup/>
</Response>`);
        return;
      }

      // Record in call history with campaign context
      recordCall(callSid, callerNumber, `Inbound: ${callerNumber} [${ctx.campaignName}]`);

      logEnforcement({
        timestamp: new Date().toISOString(),
        eventType: 'inbound_call_routed',
        phone: callerNumber,
        leadId: null,
        campaignId: ctx.campaignId,
        aiProfileId: ctx.aiProfileId,
        voiceId: ctx.voiceId,
        action: 'inbound_call',
        allowed: true,
        reason: `routed_via_${ctx.resolvedVia}`,
      });

      // Build TwiML with campaign context parameter
      const wsUrl = config.baseUrl.replace(/^http/, 'ws') + '/twilio/stream';
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="direction" value="inbound" />
      <Parameter name="callerNumber" value="${escapeXml(callerNumber)}" />
      <Parameter name="campaignId" value="${escapeXml(ctx.campaignId)}" />
    </Stream>
  </Connect>
</Response>`);
      return;
    }
  }

  // Legacy behavior (no campaign isolation or resolution succeeded without context)
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
    persistRecordings();

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
  const b = req.body;
  const errors: string[] = [];
  if (b.maxCallDurationSec !== undefined && b.maxCallDurationSec < 0) errors.push('maxCallDurationSec cannot be negative');
  if (b.maxCallsPerPhonePerDay !== undefined && b.maxCallsPerPhonePerDay < 0) errors.push('maxCallsPerPhonePerDay cannot be negative');
  if (b.callDurationWarnPct !== undefined && (b.callDurationWarnPct < 0 || b.callDurationWarnPct > 100)) errors.push('callDurationWarnPct must be 0-100');
  if (b.vadThreshold !== undefined && (b.vadThreshold < 0 || b.vadThreshold > 1)) errors.push('vadThreshold must be 0-1');
  if (b.backgroundNoiseVolume !== undefined && (b.backgroundNoiseVolume < 0 || b.backgroundNoiseVolume > 0.5)) errors.push('backgroundNoiseVolume must be 0-0.5');
  if (errors.length) {
    res.status(400).json({ error: 'Validation failed', details: errors });
    return;
  }
  const updated = updateSettings(b);
  logger.info('routes', 'Settings updated', { keys: Object.keys(b) });
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

// Reuse voicePreviewCache for OpenAI and elPreviewCache for ElevenLabs (keyed by voiceId)
const elPreviewCache = new Map<string, Buffer>();

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

      const preset = getVoicePreset(voiceId);
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: PREVIEW_TEXT,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: preset.stability,
            similarity_boost: preset.similarityBoost,
            style: preset.style,
            use_speaker_boost: preset.useSpeakerBoost,
          },
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

    const preset = getVoicePreset(voiceId);
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: PREVIEW_TEXT,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: preset.stability,
          similarity_boost: preset.similarityBoost,
          style: preset.style,
          use_speaker_boost: preset.useSpeakerBoost,
        },
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

/**
 * GET /api/leads/export
 * Export all leads as CSV.
 * NOTE: Must be registered before /api/leads/:phone to avoid route conflict.
 */
router.get('/api/leads/export', (_req: Request, res: Response) => {
  const csv = exportLeadsToCSV();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
  res.send(csv);
});

/**
 * GET /api/leads/search
 * Search leads with filters.
 * NOTE: Must be registered before /api/leads/:phone to avoid route conflict.
 */
router.get('/api/leads/search', (req: Request, res: Response) => {
  const result = searchLeads({
    query: req.query.q as string,
    disposition: req.query.disposition as string,
    state: req.query.state as string,
    tag: req.query.tag as string,
    dateFrom: req.query.dateFrom as string,
    dateTo: req.query.dateTo as string,
    source: req.query.source as string,
    page: req.query.page ? parseInt(req.query.page as string) : undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
  });
  res.json(result);
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

// ── Helper: Normalize phone number ────────────────────────────────────
function normalizePhone(phone: string): string {
    return phone.replace(/[^0-9+]/g, '');
}

// ── Weblead Webhook Endpoint (Jangl/QuotingFast format) ────────────────
// Supports campaign routing via:
//   1. Query param:  POST /webhook/weblead?campaign_id=campaign-consumer-auto
//   2. URL path:     POST /webhook/weblead/campaign-consumer-auto
//   3. Body field:   { "campaign_id": "campaign-consumer-auto", ... }

async function handleWeblead(req: Request, res: Response) {
    try {
          const body = req.body;
          const contact = body.contact || {};
          const data = body.data || {};
          const meta = body.meta || {};

          // ── Campaign resolution (priority: query param > URL path > body field) ──
          const rawCampaignId = (
                  (req.query.campaign_id as string) ||
                  req.params.campaignId ||
                  body.campaign_id ||
                  ''
          ).trim();

          let resolvedCampaignId: string | null = null;
          let campaignResolved = false;

          if (rawCampaignId) {
                  const campaign = getCampaign(rawCampaignId);
                  if (campaign && campaign.active) {
                        resolvedCampaignId = rawCampaignId;
                        campaignResolved = true;
                        logger.info('routes', 'Weblead campaign resolved', {
                              campaignId: resolvedCampaignId,
                              source: req.query.campaign_id ? 'query_param' :
                                      req.params.campaignId ? 'url_path' : 'body_field',
                        });
                  } else if (campaign && !campaign.active) {
                        logger.warn('routes', 'Weblead campaign_id references inactive campaign', {
                              campaignId: rawCampaignId,
                        });
                  } else {
                        logger.warn('routes', 'Weblead campaign_id not found', {
                              campaignId: rawCampaignId,
                        });
                  }
          } else {
                  logger.info('routes', 'Weblead received without campaign_id');
          }

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

          // Build comprehensive form data — store ALL webhook fields for easy reference
          const formDataSummary: Record<string, any> = {
                  contact: { firstName, lastName, state, city, email, zipCode, address },
                  leadId: body.id,
                  timestamp: body.timestamp,
                  sellPrice: body.sell_price,
                  campaignId: resolvedCampaignId || body.campaign_id,
                  tcpaCompliant: meta.tcpa_compliant,
                  trustedFormUrl: meta.trusted_form_cert_url,
                  driversCount: drivers.length,
                  vehiclesCount: vehicles.length,
          };

          // Store ALL drivers (not just the first)
          if (drivers.length > 0) {
                  formDataSummary.drivers = drivers.map((d: any, idx: number) => ({
                            driverNumber: idx + 1,
                            firstName: d.first_name || '',
                            lastName: d.last_name || '',
                            name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
                            birthDate: d.birth_date || '',
                            maritalStatus: d.marital_status || '',
                            occupation: d.occupation || '',
                            education: d.education || '',
                            gender: d.gender || '',
                            relationship: d.relationship || '',
                            licenseStatus: d.license_status || '',
                            ageFirstLicensed: d.age_first_licensed || '',
                            sr22: d.sr22 || false,
                  }));
          }

          // Store ALL vehicles (not just the first)
          if (vehicles.length > 0) {
                  formDataSummary.vehicles = vehicles.map((v: any, idx: number) => ({
                            vehicleNumber: idx + 1,
                            year: v.year || '',
                            make: v.make || '',
                            model: v.model || '',
                            vin: v.vin || '',
                            annualMiles: v.annual_miles || '',
                            primaryUse: v.primary_use || '',
                            ownership: v.ownership || '',
                            trim: v.trim || '',
                            bodyStyle: v.body_style || '',
                  }));
          }

          // Store current & requested policy info
          if (currentPolicy.insurance_company || currentPolicy.coverage_type) {
                  formDataSummary.currentPolicy = {
                            insurer: currentPolicy.insurance_company || '',
                            coverageType: currentPolicy.coverage_type || '',
                            insuredSince: currentPolicy.insured_since || '',
                            expirationDate: currentPolicy.expiration_date || '',
                            bodilyInjury: currentPolicy.bodily_injury || '',
                            propertyDamage: currentPolicy.property_damage || '',
                            deductible: currentPolicy.deductible || '',
                  };
          }

          if (requestedPolicy.coverage_type || requestedPolicy.bodily_injury) {
                  formDataSummary.requestedPolicy = {
                            coverageType: requestedPolicy.coverage_type || '',
                            bodilyInjury: requestedPolicy.bodily_injury || '',
                            propertyDamage: requestedPolicy.property_damage || '',
                            deductible: requestedPolicy.deductible || '',
                            comprehensiveDeductible: requestedPolicy.comprehensive_deductible || '',
                            collisionDeductible: requestedPolicy.collision_deductible || '',
                  };
          }

          // Store the complete raw webhook payload for full reference
          formDataSummary.rawWebhookData = body;

          const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';

          // Create/update lead with all the form data
          const lead = createOrUpdateLead(phone, {
                  name: fullName,
                  state,
                  currentInsurer,
                  tags: ['weblead', 'jangl'],
                  customFields: formDataSummary,
          });

          // Tag lead with resolved campaign for easy filtering
          if (resolvedCampaignId) {
                  addLeadTag(phone, `campaign:${resolvedCampaignId}`);
          }

          // Add auto-generated note with form submission details
          addLeadNote(phone, `Weblead received: ${drivers.length} driver(s), ${vehicles.length} vehicle(s). Current insurer: ${currentInsurer || 'N/A'}. Lead ID: ${body.id || 'N/A'}. Campaign: ${resolvedCampaignId || 'none'}`);

          // Check settings for auto-dial
          const settings = getSettings();
          const autoDialEnabled = settings.webleadAutoDialEnabled !== false; // default true
          const fromNumber = settings.defaultFromNumber || config.twilio?.fromNumber || '';

          if (autoDialEnabled && fromNumber) {
                  // Check concurrency before auto-dialing
                  if (!canAcceptCall()) {
                        logger.info('routes', 'Weblead auto-dial skipped: max concurrency reached', { phone, campaignId: resolvedCampaignId });
                        res.json({
                              success: true,
                              phone,
                              name: fullName,
                              state,
                              call: null,
                              autoDialed: false,
                              reason: 'max_concurrency',
                              campaignId: resolvedCampaignId,
                              campaignResolved,
                              formData: formDataSummary,
                        });
                        return;
                  }

                  const compliance = runPreCallComplianceCheck(phone, state, settings.tcpaOverride);

                  if (compliance.allowed) {
                            // Campaign enforcement for auto-dial (soft — never blocks the call)
                            let campaignCtx: CampaignContext | null = null;
                            if (resolvedCampaignId) {
                                  const campaignEnforcement = enforceOutboundDial({
                                        phone,
                                        campaignId: resolvedCampaignId,
                                        leadId: phone,
                                  });
                                  if (campaignEnforcement.allowed && campaignEnforcement.context) {
                                        campaignCtx = campaignEnforcement.context;
                                  } else {
                                        logger.warn('routes', 'Weblead auto-dial campaign enforcement failed, proceeding without campaign context', {
                                              phone,
                                              campaignId: resolvedCampaignId,
                                              reason: campaignEnforcement.reason,
                                        });
                                  }
                            }

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
                            }, undefined, phone);

                            recordCall(cr.callSid, phone, firstName);

                            // Record outbound call for campaign tracking (mirrors /call/start)
                            if (campaignCtx) {
                                  recordOutboundCall({
                                        callId: cr.callSid,
                                        leadId: null,
                                        toPhone: phone,
                                        fromDid: fromNumber,
                                        campaignId: campaignCtx.campaignId,
                                        aiProfileId: campaignCtx.aiProfileId,
                                        voiceId: campaignCtx.voiceId,
                                        messageProfileId: campaignCtx.smsTemplateSetId,
                                        timestamp: new Date().toISOString(),
                                        status: 'initiated',
                                  });
                            }

                            logger.info('routes', 'Weblead call started', {
                                        phone,
                                        callSid: cr.callSid,
                                        leadId: body.id,
                                        campaignId: campaignCtx?.campaignId || resolvedCampaignId || 'none',
                            });

                            res.json({
                                        success: true,
                                        phone,
                                        name: fullName,
                                        state,
                                        callSid: cr.callSid,
                                        autoDialed: true,
                                        campaignId: resolvedCampaignId,
                                        campaignResolved,
                                        formData: formDataSummary,
                            });
                            return;
                  }

                  logger.info('routes', 'Weblead compliance failed', { phone, state, campaignId: resolvedCampaignId });
                  res.json({
                            success: true,
                            phone,
                            name: fullName,
                            state,
                            call: null,
                            reason: 'compliance',
                            autoDialed: false,
                            campaignId: resolvedCampaignId,
                            campaignResolved,
                            formData: formDataSummary,
                  });
                  return;
          }

          // Auto-dial disabled or no from number configured
          logger.info('routes', 'Weblead stored (no auto-dial)', { phone, leadId: body.id, campaignId: resolvedCampaignId });
          res.json({
                  success: true,
                  phone,
                  name: fullName,
                  state,
                  call: null,
                  autoDialed: false,
                  reason: autoDialEnabled ? 'no_from_number' : 'auto_dial_disabled',
                  campaignId: resolvedCampaignId,
                  campaignResolved,
                  formData: formDataSummary,
          });

    } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('routes', 'Weblead webhook error', { error: msg });
          res.status(500).json({ error: msg });
    }
}

// Parameterized route must be registered first so Express matches it before the bare path
router.post('/webhook/weblead/:campaignId', handleWeblead);
router.post('/webhook/weblead', handleWeblead);

// ── AMD Status Webhook ──────────────────────────────────────────────

router.post('/twilio/amd-status', (req: Request, res: Response) => {
  const callSid = req.body?.CallSid || '';
  const answeredBy = req.body?.AnsweredBy || ''; // human, machine_start, machine_end_beep, machine_end_silence, fax, unknown
  const machineDetectionDuration = req.body?.MachineDetectionDuration;

  logger.info('routes', 'AMD result', { callSid, answeredBy, machineDetectionDuration });

  const settings = getSettings();

  if (answeredBy.startsWith('machine')) {
    if (settings.amdAction === 'hangup') {
      logger.info('routes', 'AMD detected machine, hanging up', { callSid });
      // End the call
      endCall(callSid).catch(() => {});
    } else if (settings.amdAction === 'leave_message') {
      logger.info('routes', 'AMD detected machine, will leave message via stream', { callSid });
      // The stream handler will detect AMD and handle the message
    }
  }

  res.sendStatus(200);
});

// ── SMS Status Webhook ──────────────────────────────────────────────

router.post('/twilio/sms-status', (req: Request, res: Response) => {
  const messageSid = req.body?.MessageSid || '';
  const messageStatus = req.body?.MessageStatus || '';
  const to = req.body?.To || '';

  logger.info('routes', 'SMS status update', { messageSid, messageStatus, to });
  res.sendStatus(200);
});

// ── SMS Receive Webhook ─────────────────────────────────────────────

router.post('/twilio/sms-incoming', (req: Request, res: Response) => {
  const from = req.body?.From || '';
  const body = req.body?.Body || '';
  const messageSid = req.body?.MessageSid || '';

  logger.info('routes', 'Incoming SMS', { from, body: body.substring(0, 100), messageSid });

  logSms({
    phone: from,
    direction: 'inbound',
    status: 'received',
    body,
    twilioSid: messageSid,
    triggerReason: 'inbound',
  });

  // Auto-reply if needed
  const settings = getSettings();
  if (settings.smsEnabled) {
    const lead = getLeadMemory(from);
    if (lead) {
      addLeadNote(from, `SMS received: "${body.substring(0, 100)}"`);
    }
  }

  // Empty TwiML response (no auto-reply text for now)
  res.type('text/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// ── SMS API Endpoints ───────────────────────────────────────────────

/**
 * POST /api/sms/send
 * Send an SMS to a phone number.
 */
router.post('/api/sms/send', async (req: Request, res: Response) => {
  try {
    const { phone, body, templateId, leadName, campaign_id } = req.body;
    if (!phone || !body) {
      res.status(400).json({ error: 'Missing phone or body' });
      return;
    }

    // Campaign enforcement for SMS
    if (isCampaignFlagEnabled('hardened_campaign_isolation')) {
      const smsEnforcement = enforceSmsSend({ phone, campaignId: campaign_id });
      if (!smsEnforcement.allowed) {
        res.status(403).json({
          error: 'Campaign context required for SMS',
          reason: smsEnforcement.reason,
        });
        return;
      }
    }

    const settings = getSettings();
    if (!settings.smsEnabled) {
      res.status(400).json({ error: 'SMS is not enabled in settings' });
      return;
    }

    const entry = logSms({
      phone,
      direction: 'outbound',
      status: 'queued',
      body,
      templateId,
      leadName,
      triggerReason: 'manual',
    });

    try {
      const result = await sendSms(phone, body);
      entry.status = 'sent';
      entry.twilioSid = result.sid;
      res.json({ success: true, smsId: entry.id, twilioSid: result.sid });
    } catch (err) {
      entry.status = 'failed';
      entry.error = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: entry.error });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/sms/log
 * Get SMS log with optional filters.
 */
router.get('/api/sms/log', (req: Request, res: Response) => {
  const phone = req.query.phone as string | undefined;
  const direction = req.query.direction as 'inbound' | 'outbound' | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  res.json(getSmsLog({ phone, direction, limit }));
});

/**
 * GET /api/sms/stats
 */
router.get('/api/sms/stats', (_req: Request, res: Response) => {
  res.json(getSmsStats());
});

/**
 * GET /api/sms/templates
 */
router.get('/api/sms/templates', (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  res.json(getTemplates(category));
});

/**
 * POST /api/sms/templates
 */
router.post('/api/sms/templates', (req: Request, res: Response) => {
  const { name, body, category, active } = req.body;
  if (!name || !body) {
    res.status(400).json({ error: 'Missing name or body' });
    return;
  }
  const tpl = createTemplate({ name, body, category: category || 'custom', active: active !== false });
  res.json(tpl);
});

/**
 * PUT /api/sms/templates/:id
 */
router.put('/api/sms/templates/:id', (req: Request, res: Response) => {
  const tpl = updateTemplate(req.params.id, req.body);
  if (!tpl) { res.status(404).json({ error: 'Template not found' }); return; }
  res.json(tpl);
});

/**
 * DELETE /api/sms/templates/:id
 */
router.delete('/api/sms/templates/:id', (req: Request, res: Response) => {
  const ok = deleteTemplate(req.params.id);
  if (!ok) { res.status(404).json({ error: 'Template not found' }); return; }
  res.json({ success: true });
});

/**
 * POST /api/sms/send-template
 * Send an SMS using a template.
 */
router.post('/api/sms/send-template', async (req: Request, res: Response) => {
  try {
    const { phone, templateId, variables } = req.body;
    if (!phone || !templateId) {
      res.status(400).json({ error: 'Missing phone or templateId' });
      return;
    }

    const settings = getSettings();
    if (!settings.smsEnabled) {
      res.status(400).json({ error: 'SMS is not enabled' });
      return;
    }

    const tpl = getTemplate(templateId);
    if (!tpl) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const vars = {
      first_name: variables?.first_name || 'there',
      company_name: settings.companyName,
      agent_name: settings.agentName,
      state: variables?.state || '',
      callback_time: variables?.callback_time || '',
      ...variables,
    };

    const body = renderTemplate(tpl.body, vars);

    const entry = logSms({
      phone,
      direction: 'outbound',
      status: 'queued',
      body,
      templateId,
      triggerReason: tpl.category,
    });

    const result = await sendSms(phone, body);
    entry.status = 'sent';
    entry.twilioSid = result.sid;
    res.json({ success: true, smsId: entry.id, body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Scheduler / Callback API ────────────────────────────────────────

/**
 * POST /api/callbacks/schedule
 * Schedule a callback.
 */
router.post('/api/callbacks/schedule', (req: Request, res: Response) => {
  const { phone, leadName, state, reason, scheduledAt, maxAttempts } = req.body;
  if (!phone || !scheduledAt) {
    res.status(400).json({ error: 'Missing phone or scheduledAt' });
    return;
  }

  // Also update lead memory
  scheduleCallback(phone, scheduledAt);

  const cb = scheduleCallbackTimer({
    phone,
    leadName: leadName || 'Unknown',
    state,
    reason,
    scheduledAt,
    maxAttempts,
  });
  res.json(cb);
});

/**
 * GET /api/callbacks
 */
router.get('/api/callbacks', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  res.json(getSchedulerCallbacks(status ? { status } : undefined));
});

/**
 * GET /api/callbacks/upcoming
 */
router.get('/api/callbacks/upcoming', (_req: Request, res: Response) => {
  res.json(getUpcomingCallbacks());
});

/**
 * GET /api/callbacks/past
 */
router.get('/api/callbacks/past', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
  res.json(getPastCallbacks(limit));
});

/**
 * DELETE /api/callbacks/:id
 */
router.delete('/api/callbacks/:id', (req: Request, res: Response) => {
  const ok = cancelCallbackTimer(req.params.id);
  if (!ok) { res.status(404).json({ error: 'Callback not found or already processed' }); return; }
  res.json({ success: true });
});

// ── Retry API ───────────────────────────────────────────────────────

/**
 * POST /api/retries
 */
router.post('/api/retries', (req: Request, res: Response) => {
  const { phone, leadName, state, lastResult } = req.body;
  if (!phone) { res.status(400).json({ error: 'Missing phone' }); return; }
  const entry = scheduleRetry({ phone, leadName, state, lastResult });
  if (!entry) { res.status(400).json({ error: 'Max retries exhausted' }); return; }
  res.json(entry);
});

/**
 * GET /api/retries
 */
router.get('/api/retries', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  res.json(getRetries(status ? { status } : undefined));
});

// ── Lead Import/Export ──────────────────────────────────────────────

/**
 * POST /api/leads/import
 * Import leads from CSV text body.
 */
router.post('/api/leads/import', (req: Request, res: Response) => {
  const csv = req.body?.csv;
  if (!csv || typeof csv !== 'string') {
    res.status(400).json({ error: 'Missing csv field (string)' });
    return;
  }
  const result = importLeadsFromCSV(csv);
  res.json(result);
});

/**
 * GET /api/leads/:phone/detail
 * Get full lead detail including SMS log, call history, score.
 */
router.get('/api/leads/:phone/detail', (req: Request, res: Response) => {
  const phone = req.params.phone;
  const lead = getLeadMemory(phone);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const smsHistory = getSmsLogForLead(phone);
  const score = calculateLeadScore(phone);

  // Find recordings for this lead's calls
  const callRecordings = lead.callHistory.map(call => {
    const rec = recordingStore.find(r => r.callSid === call.callSid);
    return {
      ...call,
      recording: rec ? { url: `/api/recordings/${rec.callSid}/audio`, durationSec: rec.durationSec } : null,
    };
  });

  res.json({
    ...lead,
    smsHistory,
    score,
    callHistory: callRecordings,
  });
});

/**
 * POST /api/leads/:phone/sms
 * Send SMS to a specific lead.
 */
router.post('/api/leads/:phone/sms', async (req: Request, res: Response) => {
  try {
    const phone = req.params.phone;
    const { body } = req.body;
    if (!body) { res.status(400).json({ error: 'Missing body' }); return; }

    const settings = getSettings();
    if (!settings.smsEnabled) {
      res.status(400).json({ error: 'SMS not enabled' });
      return;
    }

    const lead = getLeadMemory(phone);
    const entry = logSms({
      phone,
      direction: 'outbound',
      status: 'queued',
      body,
      leadName: lead?.name,
      triggerReason: 'manual',
    });

    const result = await sendSms(phone, body);
    entry.status = 'sent';
    entry.twilioSid = result.sid;
    addLeadNote(phone, `SMS sent: "${body.substring(0, 80)}"`);
    res.json({ success: true, smsId: entry.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Enhanced Recordings ─────────────────────────────────────────────

/**
 * GET /api/recordings/enriched
 * Get recordings with lead info.
 */
router.get('/api/recordings/enriched', (_req: Request, res: Response) => {
  const recordings = recordingStore.map(r => {
    // Find call in history
    const callHistory = getCallHistory();
    const call = callHistory.find(c => c.callSid === r.callSid);
    const lead = call ? getLeadMemory(call.to) : undefined;

    return {
      ...r,
      phone: call?.to || '',
      leadName: call?.leadName || lead?.name || 'Unknown',
      disposition: lead?.disposition || 'unknown',
    };
  });
  res.json({ recordings });
});

export { router };
