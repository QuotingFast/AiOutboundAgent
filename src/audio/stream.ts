import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getSettings } from '../config/runtime';
import { getVoicePreset } from '../config/voice-presets';
import { buildSystemPrompt, buildInboundSystemPrompt, buildInboundGreetingText, getRealtimeTools, LeadData, TransferConfig } from '../agent/prompts';
import { executeWarmTransfer } from '../twilio/transfer';
import { endCall, startCallRecording, sendSms } from '../twilio/client';
import { logger } from '../utils/logger';
import { createCallAnalytics, finalizeCallAnalytics, CallAnalytics } from '../analytics';
import { ConversationIntelligence } from '../conversation/intelligence';
import { registerSession, removeSession, updateSessionStatus, onSessionFreed } from '../performance';
import { buildLeadContext, recordCallToLead, addLeadNote } from '../memory';
import { runPostCallWorkflow } from '../workflows';
import { redactPII } from '../security';
import { mixNoiseIntoAudio, resetNoisePosition } from './noise';
import { handleAutoDnc, recordPhoneCall } from '../compliance';
import { logSms } from '../sms';
import {
  notifySchedulingTextSent,
  notifySchedulingEmailSent,
  notifyCallbackScheduled,
  sendProspectEmail,
  notifyHighFrustration,
  notifyHighLatency,
} from '../notifications';
import {
  scheduleCallback as scheduleCallbackTimer,
} from '../scheduler';
import { getCampaign } from '../campaign/store';
import { CampaignConfig } from '../campaign/types';

// Map of callSid -> session data for passing lead/transfer info
const pendingSessions = new Map<string, { lead: LeadData; transfer?: TransferConfig; toPhone?: string; campaignId?: string }>();

// Active live transcript listeners (callSid -> callback)
const liveTranscriptListeners = new Map<string, (entry: { role: string; text: string; timestamp: number }) => void>();

function normalizeCarrierForSpeech(carrier?: string): string {
  const raw = (carrier || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (['unknown', 'other', 'n/a', 'na', 'none', 'unsure', 'not sure'].includes(lower)) return '';
  return raw;
}

export function registerPendingSession(callSid: string, lead: LeadData, transfer?: TransferConfig, toPhone?: string, campaignId?: string): void {
  pendingSessions.set(callSid, { lead, transfer, toPhone, campaignId });
}

export function hasPendingSession(callSid: string): boolean {
  return pendingSessions.has(callSid);
}

export function registerTranscriptListener(callSid: string, callback: (entry: { role: string; text: string; timestamp: number }) => void): void {
  liveTranscriptListeners.set(callSid, callback);
}

export function removeTranscriptListener(callSid: string): void {
  liveTranscriptListeners.delete(callSid);
}

export function handleMediaStream(twilioWs: WebSocket): void {
  const sessionId = uuidv4().slice(0, 8);
  let streamSid = '';
  let callSid = '';
  let openaiWs: WebSocket | null = null;
  let transferConfig: TransferConfig | undefined;
  let leadData: LeadData = { first_name: 'there' };

  // Call direction and caller info
  let callDirection: 'outbound' | 'inbound' = 'outbound';
  let callerNumber = '';

  // Campaign-specific config (resolved from campaign selection)
  let activeCampaign: CampaignConfig | undefined;

  // Voice provider determined at call start
  let useElevenLabs = false;
  let elevenLabsWs: WebSocket | null = null;

  // Pending text buffer for ElevenLabs lazy reconnect
  let elevenLabsPendingText: string[] = [];

  // DeepSeek state
  let useDeepSeek = false;
  let deepseekHistory: Array<any> = [];
  let deepseekInstructions = '';
  let deepseekAbortController: AbortController | null = null;
  let deepseekAuthFailed = false;

  // Guard against double greeting on session reconfiguration
  let initialGreetingDone = false;

  // Barge-in state
  let bargeInDebounceMs = 250;
  let echoSuppressionMs = 100;
  let bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  let responseIsPlaying = false;
  let lastAudioSentAt = 0;

  // Speech acceptance telemetry/gating
  let speechStartedAt = 0;
  let lastSpeechDurationMs = 0;
  let lastRejectReason: string | null = null;

  // Module instances (created when call starts)
  let analytics: CallAnalytics | null = null;
  let conversation: ConversationIntelligence | null = null;

  // Latency tracking
  let responseRequestedAt = 0;
  let firstAudioAt = 0;
  let audioChunkCount = 0;
  let currentAgentText = '';
  let currentElevenLabsText = '';

  // Call duration tracking
  let callStartedAt = 0;
  let durationWarningFired = false;
  let durationLimitReached = false;

  // Silence (dead air) tracking
  let lastSpeechActivityAt = 0;
  let silenceDisconnectFired = false;
  let silenceCheckInterval: ReturnType<typeof setInterval> | null = null;

  logger.info('stream', 'Twilio WS opened', { sessionId });

  // --- Twilio WebSocket handlers ---

  twilioWs.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.event) {
        case 'connected':
          logger.info('stream', 'Twilio connected', { sessionId });
          break;

        case 'start': {
          streamSid = msg.start?.streamSid || '';
          callSid = msg.start?.callSid || '';

          // Read custom parameters sent via TwiML <Parameter>
          const customParams = msg.start?.customParameters || {};
          callDirection = customParams.direction === 'inbound' ? 'inbound' : 'outbound';
          callerNumber = customParams.callerNumber || '';

          logger.info('stream', 'Stream started', { sessionId, streamSid, callSid, direction: callDirection, callerNumber });

          if (callDirection === 'inbound') {
            // Inbound call — no pending session expected, create lead from caller info
            leadData = { first_name: 'there' };  // We don't know their name yet
            // Load campaign from TwiML custom parameter if provided
            const inboundCampaignId = customParams.campaignId || '';
            if (inboundCampaignId) {
              activeCampaign = getCampaign(inboundCampaignId);
              if (activeCampaign) {
                logger.info('stream', 'Inbound call campaign loaded', { sessionId, campaignId: inboundCampaignId, campaignName: activeCampaign.name });
              }
            }
            logger.info('stream', 'Inbound call connected', { sessionId, callerNumber });
          } else {
            // Outbound call — look up pending session
            const session = pendingSessions.get(callSid);
            if (session) {
              leadData = session.lead;
              transferConfig = session.transfer;
              callerNumber = session.toPhone || '';
              // Load campaign config for campaign-specific prompts/voice/settings
              if (session.campaignId) {
                activeCampaign = getCampaign(session.campaignId);
                if (activeCampaign) {
                  logger.info('stream', 'Outbound call campaign loaded', { sessionId, campaignId: session.campaignId, campaignName: activeCampaign.name });
                }
              }
              pendingSessions.delete(callSid);
              logger.info('stream', 'Session found', { sessionId, lead: leadData.first_name, toPhone: callerNumber, campaignId: session.campaignId || 'none' });
            } else {
              logger.warn('stream', 'No session found, using default', {
                sessionId,
                callSid,
                pendingKeys: [...pendingSessions.keys()],
              });
            }
          }

          // Initialize modules
          analytics = createCallAnalytics(callSid);
          if (analytics) analytics.addTag(callDirection);
          conversation = new ConversationIntelligence(callSid);
          callStartedAt = Date.now();
          lastSpeechActivityAt = Date.now();
          resetNoisePosition();

          // Start silence (dead air) monitoring
          const silenceSettings = getSettings();
          if (silenceSettings.silenceTimeoutSec > 0) {
            silenceCheckInterval = setInterval(() => {
              if (silenceDisconnectFired || !callSid) return;
              const s2 = getSettings();
              if (s2.silenceTimeoutSec <= 0) return;
              const silentSec = (Date.now() - lastSpeechActivityAt) / 1000;
              if (silentSec >= s2.silenceTimeoutSec) {
                silenceDisconnectFired = true;
                logger.warn('stream', 'Silence timeout reached, ending call', { sessionId, callSid, silentSec: Math.round(silentSec), timeoutSec: s2.silenceTimeoutSec });
                if (analytics) analytics.setOutcome('dropped', `Silence timeout: no speech for ${Math.round(silentSec)}s`);
                endCall(callSid).catch(() => {});
              }
            }, 5000); // Check every 5 seconds
          }
          if (callerNumber) recordPhoneCall(callerNumber);
          const sessionAccepted = registerSession(callSid, callerNumber, leadData.first_name);
          if (!sessionAccepted) {
            logger.warn('stream', 'Max concurrency reached, call may degrade', { sessionId, callSid });
          }

          // Start recording for inbound calls (outbound calls use record=true on calls.create)
          if (callDirection === 'inbound') {
            startCallRecording(callSid).catch(err =>
              logger.error('stream', 'Failed to start inbound recording', { sessionId, error: String(err) })
            );
          }

          connectToOpenAIRealtime();
          break;
        }

        case 'media':
          if (msg.media?.payload && openaiWs?.readyState === WebSocket.OPEN) {
            openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.media.payload,
            }));
            // Track audio input for cost estimation (~20ms per chunk at 8kHz ulaw)
            if (analytics) analytics.addAudioInputSeconds(0.02);
          }
          break;

        case 'stop':
          logger.info('stream', 'Twilio stream stopped', { sessionId, callSid });
          cleanup();
          break;

        default:
          break;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Twilio message error', { sessionId, error: errMsg });
    }
  });

  twilioWs.on('close', () => {
    logger.info('stream', 'Twilio WS closed', { sessionId, callSid });
    cleanup();
  });

  twilioWs.on('error', (err) => {
    logger.error('stream', 'Twilio WS error', { sessionId, error: err.message });
  });

  // --- OpenAI Realtime connection ---

  function connectToOpenAIRealtime(): void {
    const s = getSettings();
    // Use campaign voice config if available, fall back to global settings
    const campaignVoice = activeCampaign?.voiceConfig;
    const effectiveVoiceProvider = campaignVoice?.voiceProvider || s.voiceProvider;
    const model = activeCampaign?.aiProfile?.realtimeModel || s.realtimeModel;
    useDeepSeek = effectiveVoiceProvider === 'deepseek';

    // Fall back to ElevenLabs mode if DeepSeek selected but API key missing
    if (useDeepSeek && !config.deepseek.apiKey) {
      logger.warn('stream', 'DeepSeek selected but no API key configured — falling back to ElevenLabs mode', { sessionId });
      useDeepSeek = false;
    }

    useElevenLabs = effectiveVoiceProvider === 'elevenlabs' || effectiveVoiceProvider === 'deepseek';
    const url = `wss://api.openai.com/v1/realtime?model=${model}`;

    logger.info('stream', 'Connecting to OpenAI Realtime', {
      sessionId, model, voiceProvider: s.voiceProvider,
    });

    openaiWs = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    openaiWs.on('open', () => {
      logger.info('stream', 'OpenAI Realtime connected', { sessionId });
      sendSessionUpdate();
    });

    openaiWs.on('message', (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString());
        handleOpenAIEvent(event);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('stream', 'OpenAI message parse error', { sessionId, error: errMsg });
      }
    });

    openaiWs.on('close', (code, reason) => {
      logger.info('stream', 'OpenAI WS closed', { sessionId, code, reason: reason?.toString() });
      openaiWs = null;
    });

    openaiWs.on('error', (err) => {
      logger.error('stream', 'OpenAI WS error', { sessionId, error: err.message });
    });
  }

  function sendSessionUpdate(): void {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    const s = getSettings();
    bargeInDebounceMs = s.bargeInDebounceMs;
    echoSuppressionMs = s.echoSuppressionMs;

    // Use campaign-specific AI profile and voice when available, fall back to global settings
    const campaignProfile = activeCampaign?.aiProfile;
    const campaignVoice = activeCampaign?.voiceConfig;
    const effectiveAgentName = campaignProfile?.agentName || s.agentName;
    const effectiveCompanyName = campaignProfile?.companyName || s.companyName;

    // Build vehicle template strings from lead data
    const vList = leadData.vehicles || [];
    const firstVehicle = vList[0];
    const vehicleYear = firstVehicle?.year || '';
    const vehicleModel = firstVehicle?.model || '';
    const vehicleMake = firstVehicle?.make || '';
    const allVehiclesStr = vList.length > 0
      ? vList.map(v => [v.year, v.model].filter(Boolean).join(' ')).join(' and ')
      : '';

    let instructions: string;
    if (campaignProfile?.systemPrompt && callDirection === 'outbound') {
      // Campaign has its own system prompt — use it with variable substitution
      instructions = campaignProfile.systemPrompt
        .replace(/\{\{first_name\}\}/g, leadData.first_name)
        .replace(/\{\{state\}\}/g, leadData.state || 'unknown')
        .replace(/\{\{current_insurer\}\}/g, normalizeCarrierForSpeech(leadData.current_insurer) || 'not provided')
        .replace(/\{\{agent_name\}\}/g, effectiveAgentName)
        .replace(/\{\{company_name\}\}/g, effectiveCompanyName)
        .replace(/\{\{agency_name\}\}/g, leadData.first_name)
        .replace(/\{\{vehicle_year\}\}/g, vehicleYear)
        .replace(/\{\{vehicle_model\}\}/g, vehicleModel)
        .replace(/\{\{vehicle_make\}\}/g, vehicleMake)
        .replace(/\{\{all_vehicles\}\}/g, allVehiclesStr);
    } else if (campaignProfile?.inboundPrompt && callDirection === 'inbound') {
      // Campaign has its own inbound prompt
      instructions = campaignProfile.inboundPrompt
        .replace(/\{\{caller_number\}\}/g, callerNumber)
        .replace(/\{\{agent_name\}\}/g, effectiveAgentName)
        .replace(/\{\{company_name\}\}/g, effectiveCompanyName);
    } else if (s.systemPromptOverride) {
      instructions = s.systemPromptOverride
        .replace(/\{\{first_name\}\}/g, leadData.first_name)
        .replace(/\{\{state\}\}/g, leadData.state || 'unknown')
        .replace(/\{\{current_insurer\}\}/g, normalizeCarrierForSpeech(leadData.current_insurer) || 'not provided');
    } else if (callDirection === 'inbound') {
      instructions = s.inboundPromptOverride
        ? s.inboundPromptOverride
            .replace(/\{\{caller_number\}\}/g, callerNumber)
            .replace(/\{\{agent_name\}\}/g, effectiveAgentName)
            .replace(/\{\{company_name\}\}/g, effectiveCompanyName)
        : buildInboundSystemPrompt(callerNumber, { agentName: effectiveAgentName, companyName: effectiveCompanyName });
    } else {
      instructions = buildSystemPrompt(leadData, { agentName: effectiveAgentName, companyName: effectiveCompanyName });
    }

    logger.info('stream', 'Using campaign config for session', {
      sessionId,
      campaignId: activeCampaign?.id || 'none',
      campaignName: activeCampaign?.name || 'global',
      agentName: effectiveAgentName,
      companyName: effectiveCompanyName,
    });

    // Inject lead memory context if available
    const leadContext = buildLeadContext(callerNumber);
    if (leadContext) {
      instructions += '\n\n' + leadContext;
    }

    // Build transfer config: campaign routes take priority, then global settings
    if (!transferConfig) {
      // First, try campaign-specific transfer routing
      if (activeCampaign?.transferRouting?.routes?.length) {
        const routes = activeCampaign.transferRouting.routes;
        const allstateRoute = routes.find(r => r.id === 'route-allstate' || r.name.toLowerCase().includes('allstate'));
        const otherRoute = routes.find(r => r.id === 'route-non-allstate' || r.id === 'route-agency-sales' || (!r.name.toLowerCase().includes('allstate') && r.active));
        const allNum = allstateRoute?.active ? allstateRoute.destinationNumber : undefined;
        const otherNum = otherRoute?.active ? otherRoute.destinationNumber : undefined;
        if (allNum || otherNum) {
          transferConfig = {
            allstate_number: allNum || undefined,
            non_allstate_number: otherNum || undefined,
          };
        }
      }
      // Fall back to global settings if campaign had no numbers
      if (!transferConfig && (s.allstateNumber || s.nonAllstateNumber)) {
        transferConfig = {
          allstate_number: s.allstateNumber || undefined,
          non_allstate_number: s.nonAllstateNumber || undefined,
        };
      }
    }

    // Use campaign-specific temperature and max tokens if available
    const effectiveTemperature = activeCampaign?.aiProfile?.temperature ?? s.temperature;
    const effectiveMaxTokens = activeCampaign?.aiProfile?.maxResponseTokens ?? s.maxResponseTokens;

    const effectiveModel = activeCampaign?.aiProfile?.realtimeModel || s.realtimeModel;

    logger.info('stream', 'Configuring session', {
      sessionId,
      campaignId: activeCampaign?.id || 'none',
      voiceProvider: campaignVoice?.voiceProvider || s.voiceProvider,
      voice: useElevenLabs ? `elevenlabs:${campaignVoice?.elevenlabsVoiceId || s.elevenlabsVoiceId}` : s.voice,
      model: effectiveModel,
      vadThreshold: s.vadThreshold,
      silenceDurationMs: s.silenceDurationMs,
      maxTokens: effectiveMaxTokens,
    });

    if (useDeepSeek) {
      // DeepSeek mode: OpenAI Realtime is STT-only (no auto-response)
      // Store instructions for DeepSeek API calls
      deepseekInstructions = instructions;
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text'],
          instructions: 'You are a speech-to-text transcription relay. Do not generate responses.',
          input_audio_format: 'g711_ulaw',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: s.vadThreshold,
            prefix_padding_ms: s.prefixPaddingMs,
            silence_duration_ms: s.silenceDurationMs,
            create_response: false,
            interrupt_response: true,
          },
          tools: [],
          max_response_output_tokens: 1,
          temperature: 0.6,
        },
      }));
    } else if (useElevenLabs) {
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text'],
          instructions,
          input_audio_format: 'g711_ulaw',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: s.vadThreshold,
            prefix_padding_ms: s.prefixPaddingMs,
            silence_duration_ms: s.silenceDurationMs,
            create_response: true,
            interrupt_response: true,
          },
          tools: getRealtimeTools(),
          max_response_output_tokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
        },
      }));
    } else {
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions,
          voice: campaignVoice?.openaiVoice || s.voice,
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: s.vadThreshold,
            prefix_padding_ms: s.prefixPaddingMs,
            silence_duration_ms: s.silenceDurationMs,
            create_response: true,
            interrupt_response: true,
          },
          tools: getRealtimeTools(),
          max_response_output_tokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
        },
      }));
    }
  }

  function triggerGreeting(): void {
    const s = getSettings();
    const campaignProfile = activeCampaign?.aiProfile;
    const effectiveAgentName = campaignProfile?.agentName || s.agentName;
    const effectiveCompanyName = campaignProfile?.companyName || s.companyName;

    // Build vehicle strings for greeting substitution
    const gVehicles = leadData.vehicles || [];
    const gFirstVehicle = gVehicles[0];
    const vehicleYear = gFirstVehicle?.year || '';
    const vehicleModel = gFirstVehicle?.model || '';
    const vehicleMake = gFirstVehicle?.make || '';

    logger.info('stream', 'Triggering greeting', { sessionId, direction: callDirection, lead: leadData.first_name, campaignId: activeCampaign?.id || 'none' });
    responseRequestedAt = Date.now();

    let greetingInstruction: string;
    if (callDirection === 'inbound') {
      // Use campaign-specific inbound greeting if available
      if (campaignProfile?.inboundGreetingText) {
        const greetingText = campaignProfile.inboundGreetingText
          .replace(/\{\{agent_name\}\}/g, effectiveAgentName)
          .replace(/\{\{company_name\}\}/g, effectiveCompanyName);
        greetingInstruction = `[An inbound call has just connected. Someone is calling your company. Answer the phone warmly. Start with: "${greetingText}"]`;
      } else {
        const greetingText = buildInboundGreetingText({ agentName: effectiveAgentName, companyName: effectiveCompanyName });
        greetingInstruction = `[An inbound call has just connected. Someone is calling your company. Answer the phone warmly. Start with: "${greetingText}"]`;
      }
    } else {
      // Use campaign-specific outbound greeting if available
      if (campaignProfile?.greetingText) {
        const greetingText = campaignProfile.greetingText
          .replace(/\{\{first_name\}\}/g, leadData.first_name)
          .replace(/\{\{agency_name\}\}/g, leadData.first_name)
          .replace(/\{\{vehicle_year\}\}/g, vehicleYear)
          .replace(/\{\{vehicle_model\}\}/g, vehicleModel)
          .replace(/\{\{vehicle_make\}\}/g, vehicleMake);
        greetingInstruction = `[The outbound call to ${leadData.first_name} has just connected. Greet them now. Start with: "${greetingText}"]`;
      } else {
        greetingInstruction = `[The outbound call to ${leadData.first_name} has just connected. Greet them now. Start with: "Hey ${leadData.first_name}, this is ${effectiveAgentName} over at ${effectiveCompanyName} — you had looked into an auto insurance quote not too long ago, right?"]`;
      }
    }

    if (useDeepSeek) {
      // DeepSeek handles the greeting via its own API
      callDeepSeekStreaming(greetingInstruction);
      return;
    }

    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: greetingInstruction,
        }],
      },
    }));

    openaiWs.send(JSON.stringify({ type: 'response.create' }));
  }

  // --- ElevenLabs WebSocket streaming TTS ---

  function connectElevenLabs(): void {
    const s = getSettings();
    // Use campaign voice config for ElevenLabs voice ID, model, and tuning
    const campaignVoice = activeCampaign?.voiceConfig;
    const effectiveVoiceId = campaignVoice?.elevenlabsVoiceId || s.elevenlabsVoiceId;
    const effectiveModelId = campaignVoice?.elevenlabsModelId || s.elevenlabsModelId || 'eleven_turbo_v2_5';
    // Resolve per-voice preset, then allow campaign/runtime overrides
    const preset = getVoicePreset(effectiveVoiceId);
    const effectiveStability = campaignVoice?.elevenlabsStability ?? s.elevenlabsStability ?? preset.stability;
    const effectiveSimilarityBoost = campaignVoice?.elevenlabsSimilarityBoost ?? s.elevenlabsSimilarityBoost ?? preset.similarityBoost;
    const effectiveStyle = campaignVoice?.elevenlabsStyle ?? s.elevenlabsStyle ?? preset.style;
    const effectiveUseSpeakerBoost = campaignVoice?.elevenlabsUseSpeakerBoost ?? s.elevenlabsUseSpeakerBoost ?? preset.useSpeakerBoost;
    const effectiveSpeed = campaignVoice?.elevenlabsSpeed ?? s.elevenlabsSpeed ?? preset.speed;

    if (!config.elevenlabs.apiKey || !effectiveVoiceId) {
      logger.error('stream', 'ElevenLabs MISSING config', {
        sessionId,
        hasApiKey: !!config.elevenlabs.apiKey,
        voiceId: effectiveVoiceId || '(empty)',
        campaignId: activeCampaign?.id || 'none',
      });
      return;
    }

    const voiceId = effectiveVoiceId;
    logger.info('stream', 'ElevenLabs connecting', { sessionId, voiceId, campaignId: activeCampaign?.id || 'none' });
    const modelId = effectiveModelId;
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${modelId}&output_format=ulaw_8000`;

    const ws = new WebSocket(url);
    elevenLabsWs = ws;

    ws.on('open', () => {
      // Guard: if this socket was replaced by a newer one, ignore
      if (elevenLabsWs !== ws) {
        logger.debug('stream', 'Stale ElevenLabs open event, ignoring', { sessionId });
        ws.close();
        return;
      }
      logger.info('stream', 'ElevenLabs WS connected', { sessionId });
      ws.send(JSON.stringify({
        text: ' ',
        voice_settings: {
          stability: effectiveStability,
          similarity_boost: effectiveSimilarityBoost,
          style: effectiveStyle,
          use_speaker_boost: effectiveUseSpeakerBoost,
        },
        generation_config: {
          chunk_length_schedule: [120, 160, 250, 290],
          ...(effectiveSpeed !== 1.0 ? { speed: effectiveSpeed } : {}),
        },
        xi_api_key: config.elevenlabs.apiKey,
      }));

      // Flush any pending text that was buffered while connecting
      if (elevenLabsPendingText.length > 0) {
        logger.info('stream', 'Flushing pending ElevenLabs text', { sessionId, chunks: elevenLabsPendingText.length });
        for (const chunk of elevenLabsPendingText) {
          ws.send(JSON.stringify({ text: chunk }));
        }
        elevenLabsPendingText = [];
      }
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.audio) {
          responseIsPlaying = true;
          lastAudioSentAt = Date.now();
          sendAudioToTwilio(msg.audio);
          logger.debug('stream', 'tts_chunk', { sessionId, ts: lastAudioSentAt });

          // Track first audio latency (TTS latency)
          if (firstAudioAt === 0) {
            firstAudioAt = Date.now();
            if (analytics && responseRequestedAt > 0) {
              analytics.recordTTSLatency(firstAudioAt - responseRequestedAt);
            }
          }
          audioChunkCount++;
          if (analytics) analytics.addAudioOutputSeconds(0.02);
        }
        if (msg.isFinal) {
          responseIsPlaying = false;
          logger.debug('stream', 'tts_end', { sessionId, ts: Date.now() });
          if (analytics) analytics.agentFinishedSpeaking(currentElevenLabsText);
          currentElevenLabsText = '';
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('stream', 'ElevenLabs message error', { sessionId, error: errMsg });
      }
    });

    ws.on('close', () => {
      logger.debug('stream', 'ElevenLabs WS closed', { sessionId });
      // Only null out if this is still the active socket
      if (elevenLabsWs === ws) {
        elevenLabsWs = null;
      }
    });

    ws.on('error', (err) => {
      logger.error('stream', 'ElevenLabs WS error', { sessionId, error: err.message });
    });
  }

  function sendTextToElevenLabs(text: string): void {
    currentElevenLabsText += text;
    if (analytics) analytics.addElevenLabsCharacters(text.length);

    // If WS is open, send immediately
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.send(JSON.stringify({ text }));
      return;
    }

    // Buffer text and lazily reconnect
    elevenLabsPendingText.push(text);
    if (!elevenLabsWs || elevenLabsWs.readyState === WebSocket.CLOSED || elevenLabsWs.readyState === WebSocket.CLOSING) {
      logger.info('stream', 'ElevenLabs WS not open, reconnecting on demand', { sessionId });
      connectElevenLabs();
    }
    // else: WS is in CONNECTING state, pending text will flush on open
  }

  function flushElevenLabs(): void {
    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) {
      // If not connected, add flush marker to pending buffer
      if (elevenLabsPendingText.length > 0) {
        elevenLabsPendingText.push('');
      }
      return;
    }
    elevenLabsWs.send(JSON.stringify({ text: '' }));
  }

  function resetElevenLabs(): void {
    if (elevenLabsWs) {
      elevenLabsWs.close();
      elevenLabsWs = null;
    }
    connectElevenLabs();
  }

  // --- DeepSeek streaming LLM ---

  /** Reconfigure OpenAI Realtime from STT-only to full ElevenLabs-mode LLM after DeepSeek auth failure */
  function reconfigureOpenAIForFallback(): void {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    const s = getSettings();
    logger.info('stream', 'Reconfiguring OpenAI Realtime for ElevenLabs fallback (was STT-only)', { sessionId });

    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text'],
        instructions: deepseekInstructions,
        input_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: s.vadThreshold,
          prefix_padding_ms: s.prefixPaddingMs,
          silence_duration_ms: s.silenceDurationMs,
          create_response: true,
          interrupt_response: true,
        },
        tools: getRealtimeTools(),
        max_response_output_tokens: s.maxResponseTokens,
        temperature: Math.max(s.temperature, 0.6),
      },
    }));
  }

  function getDeepSeekTools(): any[] {
    const tools = getRealtimeTools();
    return tools.map((t: any) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async function callDeepSeekStreaming(userMessage: string, role: 'user' | 'tool' = 'user', toolCallId?: string): Promise<void> {
    // If DeepSeek already failed auth, route through OpenAI instead
    if (deepseekAuthFailed) {
      sendUserMessage(userMessage);
      return;
    }

    if (role === 'user') {
      deepseekHistory.push({ role: 'user', content: userMessage });
    } else if (role === 'tool' && toolCallId) {
      deepseekHistory.push({ role: 'tool', tool_call_id: toolCallId, content: userMessage });
    }

    // Keep history manageable (last 30 messages)
    if (deepseekHistory.length > 30) {
      deepseekHistory = deepseekHistory.slice(-30);
    }

    deepseekAbortController = new AbortController();
    const s = getSettings();

    logger.info('stream', 'Calling DeepSeek', {
      sessionId,
      model: s.deepseekModel,
      historyLength: deepseekHistory.length,
      role,
    });

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.deepseek.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: s.deepseekModel || 'deepseek-chat',
          messages: [
            { role: 'system', content: deepseekInstructions },
            ...deepseekHistory,
          ],
          stream: true,
          max_tokens: s.maxResponseTokens * 4,
          temperature: s.temperature,
          tools: getDeepSeekTools(),
        }),
        signal: deepseekAbortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error('stream', 'DeepSeek API error', { sessionId, status: response.status, error: errText });

        if (response.status === 401) {
          logger.error('stream', 'DeepSeek auth failed, falling back to OpenAI for rest of session', { sessionId });
          deepseekAuthFailed = true;
          useDeepSeek = false;

          // Reconfigure OpenAI Realtime from STT-only to full ElevenLabs-mode LLM
          reconfigureOpenAIForFallback();

          // Route the current message through OpenAI so the caller hears something
          sendUserMessage(userMessage);
        }
        return;
      }

      const body = response.body;
      if (!body) {
        logger.error('stream', 'DeepSeek: no response body', { sessionId });
        return;
      }

      const reader = (body as any).getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let fullResponse = '';
      let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta;

            // Text content
            if (delta?.content) {
              fullResponse += delta.content;
              responseIsPlaying = true;
              sendTextToElevenLabs(delta.content);

              // Track LLM latency on first text chunk
              if (firstAudioAt === 0 && analytics && responseRequestedAt > 0) {
                firstAudioAt = Date.now();
                analytics.recordLLMLatency(Date.now() - responseRequestedAt);
                analytics.agentStartedSpeaking();
              }
            }

            // Tool calls (function calling)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: tc.id || '', name: '', arguments: '' };
                }
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].name += tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      deepseekAbortController = null;

      // Handle function calls
      if (toolCalls.length > 0 && toolCalls[0].name) {
        // Add assistant message with tool_calls to history
        deepseekHistory.push({
          role: 'assistant',
          content: fullResponse || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Execute each function call
        for (const tc of toolCalls) {
          if (!tc.name) continue;
          logger.info('stream', 'DeepSeek function call', { sessionId, name: tc.name, args: tc.arguments });

          let args: any = {};
          try { args = JSON.parse(tc.arguments || '{}'); } catch {}

          // Execute via existing handler
          const fakeItem = { name: tc.name, call_id: tc.id, arguments: tc.arguments };
          handleFunctionCall(fakeItem);

          // Send function result back to DeepSeek for follow-up
          const result = { status: tc.name === 'transfer_call' ? 'transferring' : 'ending' };
          await callDeepSeekStreaming(JSON.stringify(result), 'tool', tc.id);
        }
        return;
      }

      // Text response complete
      if (fullResponse) {
        flushElevenLabs();

        deepseekHistory.push({ role: 'assistant', content: fullResponse });

        logger.info('stream', 'DeepSeek response', { sessionId, transcript: redactPII(fullResponse) });
        if (conversation) conversation.processAgentTurn(fullResponse);
        if (analytics) analytics.addTranscriptEntry('agent', fullResponse);
        emitTranscript('agent', fullResponse);

        // Close ElevenLabs WS after response (lazy reconnect pattern)
        setTimeout(() => {
          if (elevenLabsWs) {
            elevenLabsWs.close();
            elevenLabsWs = null;
          }
        }, 500);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        logger.info('stream', 'DeepSeek request aborted (barge-in)', { sessionId });
      } else {
        logger.error('stream', 'DeepSeek streaming error', { sessionId, error: err.message });
      }
      deepseekAbortController = null;
    }
  }

  function getTranscriptConfidence(event: any): number | undefined {
    if (typeof event?.confidence === 'number') return event.confidence;
    if (typeof event?.transcript_confidence === 'number') return event.transcript_confidence;
    if (Array.isArray(event?.segments)) {
      const vals = event.segments.map((s: any) => s?.confidence).filter((v: any) => typeof v === 'number');
      if (vals.length > 0) return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    }
    return undefined;
  }

  function countMeaningfulWords(text: string): number {
    return (text.toLowerCase().match(/[a-z0-9]{2,}/g) || []).length;
  }

  function isFillerOnly(text: string): boolean {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return true;
    const filler = new Set(['uh', 'um', 'hmm', 'hm', 'yeah', 'ok', 'okay']);
    const parts = normalized.split(' ').filter(Boolean);
    return parts.length > 0 && parts.every(p => filler.has(p));
  }

  function deterministicReprompt(): void {
    const line = 'Sorry, I didn\'t catch that — could you repeat that?';
    if (useElevenLabs) {
      currentElevenLabsText = '';
      sendTextToElevenLabs(line);
      flushElevenLabs();
      logger.info('stream', 'Deterministic reprompt', { sessionId, line });
      return;
    }
    sendUserMessage(`[System: Say exactly: "${line}"]`);
  }

  // --- OpenAI event handling ---

  function handleOpenAIEvent(event: any): void {
    switch (event.type) {
      case 'session.created':
        logger.info('stream', 'Realtime session created', { sessionId });
        break;

      case 'session.updated':
        logger.info('stream', 'Realtime session configured', { sessionId, useElevenLabs });
        // Only trigger greeting on the first session.updated (not on reconfiguration fallback)
        if (initialGreetingDone) break;
        initialGreetingDone = true;
        if (useElevenLabs) {
          connectElevenLabs();
          // Wait for ElevenLabs to connect before triggering greeting
          let greetingSent = false;
          const waitForEl = setInterval(() => {
            if (!greetingSent && elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
              clearInterval(waitForEl);
              greetingSent = true;
              triggerGreeting();
            }
          }, 100);
          // Safety timeout — don't wait forever
          setTimeout(() => {
            clearInterval(waitForEl);
            if (!greetingSent) {
              greetingSent = true;
              logger.warn('stream', 'ElevenLabs connect timeout, triggering greeting anyway', { sessionId });
              triggerGreeting();
            }
          }, 3000);
        } else {
          setTimeout(() => triggerGreeting(), 300);
        }
        break;

      // --- OpenAI voice output (only when NOT using ElevenLabs) ---
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (useElevenLabs) {
          // ElevenLabs mode — ignore OpenAI audio, text path handles TTS
          break;
        }
        responseIsPlaying = true;
        lastAudioSentAt = Date.now();
        lastSpeechActivityAt = Date.now();
        if (event.delta) {
          sendAudioToTwilio(event.delta);

          // Track first audio latency
          if (firstAudioAt === 0) {
            firstAudioAt = Date.now();
            if (analytics && responseRequestedAt > 0) {
              const totalLatency = firstAudioAt - responseRequestedAt;
              analytics.recordLLMLatency(totalLatency);
              analytics.agentStartedSpeaking();
            }
          }
          audioChunkCount++;
          if (analytics) analytics.addAudioOutputSeconds(0.02);
        }
        break;

      case 'response.audio.done':
      case 'response.output_audio.done':
        if (!useElevenLabs) {
          responseIsPlaying = false;
        }
        break;

      // --- Text output (for ElevenLabs mode + transcript) ---
      // DeepSeek mode handles its own text→ElevenLabs path, skip OpenAI text events
      case 'response.text.delta':
        if (useElevenLabs && !useDeepSeek && event.delta) {
          responseIsPlaying = true;
          lastSpeechActivityAt = Date.now();
          sendTextToElevenLabs(event.delta);

          // Track LLM latency (time to first text token)
          if (firstAudioAt === 0 && analytics && responseRequestedAt > 0) {
            firstAudioAt = Date.now(); // reuse flag
            analytics.recordLLMLatency(Date.now() - responseRequestedAt);
            analytics.agentStartedSpeaking();
          }
        }
        break;

      case 'response.text.done':
        if (useElevenLabs && !useDeepSeek) {
          flushElevenLabs();
          const agentText = event.text || currentElevenLabsText;
          logger.info('stream', 'Agent said', { sessionId, transcript: redactPII(agentText) });

          // Process agent turn
          if (conversation) conversation.processAgentTurn(agentText);
          if (analytics) analytics.addTranscriptEntry('agent', agentText);
          emitTranscript('agent', agentText);
        }
        break;

      // --- Barge-in handling ---
      case 'input_audio_buffer.speech_started':
        speechStartedAt = Date.now();
        lastSpeechActivityAt = speechStartedAt;
        if (analytics) analytics.userStartedSpeaking();
        logger.debug('stream', 'speech_started', { sessionId, ts: speechStartedAt });

        if (!responseIsPlaying) break;

        if (Date.now() - lastAudioSentAt < echoSuppressionMs) {
          logger.debug('stream', 'Speech within echo window — suppressing', { sessionId });
          break;
        }

        if (bargeInTimer) clearTimeout(bargeInTimer);
        logger.debug('stream', 'Potential barge-in — starting debounce', { sessionId });
        bargeInTimer = setTimeout(() => {
          bargeInTimer = null;
          logger.info('stream', 'Barge-in confirmed — canceling response', { sessionId, interruption_source: 'speech_started_debounced' });

          if (analytics) analytics.recordInterruption();

          if (openaiWs?.readyState === WebSocket.OPEN) {
            openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          if (useElevenLabs && elevenLabsWs) {
            elevenLabsWs.close();
            elevenLabsWs = null;
            elevenLabsPendingText = [];
          }
          if (useDeepSeek && deepseekAbortController) {
            deepseekAbortController.abort();
            deepseekAbortController = null;
          }
          sendClearToTwilio();
          responseIsPlaying = false;
        }, bargeInDebounceMs);
        break;

      case 'input_audio_buffer.speech_stopped':
        if (speechStartedAt > 0) {
          lastSpeechDurationMs = Math.max(0, Date.now() - speechStartedAt);
        } else {
          lastSpeechDurationMs = 0;
        }
        logger.debug('stream', 'speech_stopped', { sessionId, speechDurationMs: lastSpeechDurationMs });

        if (bargeInTimer) {
          clearTimeout(bargeInTimer);
          bargeInTimer = null;
          logger.debug('stream', 'Speech stopped before debounce — ignored', { sessionId });
        }

        // Natural response delay: humans pause 300-800ms before responding.
        // This prevents the uncanny instant-response effect that reveals AI.
        {
          const humanDelayMs = 300 + Math.floor(Math.random() * 500);
          logger.debug('stream', 'Adding human response delay', { sessionId, delayMs: humanDelayMs });
          responseRequestedAt = Date.now() + humanDelayMs; // Adjust baseline for latency tracking
          firstAudioAt = 0;
          audioChunkCount = 0;
        }
        break;

      case 'response.done':
        if (useElevenLabs && !useDeepSeek && elevenLabsWs) {
          // Don't eagerly reconnect — just close. Next sendTextToElevenLabs will reconnect on demand.
          // This avoids ElevenLabs idle timeout killing the connection.
          setTimeout(() => {
            if (elevenLabsWs) {
              elevenLabsWs.close();
              elevenLabsWs = null;
            }
          }, 500);
        }
        if (!useElevenLabs) {
          responseIsPlaying = false;
          if (analytics && currentAgentText) {
            analytics.agentFinishedSpeaking(currentAgentText);
          }
          currentAgentText = '';
        }
        if (bargeInTimer) {
          clearTimeout(bargeInTimer);
          bargeInTimer = null;
        }
        if (event.response?.output) {
          for (const item of event.response.output) {
            if (item.type === 'function_call') {
              handleFunctionCall(item).catch(err => {
                logger.error('stream', 'Function call error', { sessionId, name: item.name, error: String(err) });
              });
            }
          }
        }
        // Reset latency tracking for next turn
        firstAudioAt = 0;
        audioChunkCount = 0;
        break;

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        if (!useElevenLabs) {
          const agentText = event.transcript || '';
          currentAgentText = agentText;
          logger.info('stream', 'Agent said', { sessionId, transcript: redactPII(agentText) });

          if (conversation) conversation.processAgentTurn(agentText);
          if (analytics) analytics.addTranscriptEntry('agent', agentText);
          emitTranscript('agent', agentText);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed': {
        const userText = event.transcript || '';
        const speechDurationMs = lastSpeechDurationMs;
        lastSpeechDurationMs = 0;
        const confidence = getTranscriptConfidence(event);
        const cleanedText = userText.replace(/[^a-zA-Z0-9]/g, '').trim();
        const meaningfulWords = countMeaningfulWords(userText);
        const fillerOnly = isFillerOnly(userText);

        logger.info('stream', 'User said', {
          sessionId,
          transcript: redactPII(userText),
          speechDurationMs,
          confidence,
        });

        // Phase 2: hard acceptance gate (minimal)
        let rejectReason: string | null = null;
        if (!cleanedText && speechDurationMs === 0) rejectReason = 'empty_no_speech';
        else if (speechDurationMs > 0 && speechDurationMs < 450) rejectReason = 'short_speech';
        else if (typeof confidence === 'number' && confidence < 0.85) rejectReason = 'low_conf';
        else if (fillerOnly) rejectReason = 'filler_only';
        else if (meaningfulWords < 2 && cleanedText.length < 4) rejectReason = 'low_quality';

        if (rejectReason) {
          lastRejectReason = rejectReason;
          logger.info('stream', 'Rejected user turn', {
            sessionId,
            reject_reason: rejectReason,
            speechDurationMs,
            confidence,
            cleanedLen: cleanedText.length,
            meaningfulWords,
          });

          // Do not advance state, do not send to reasoning history.
          // For pure no-speech empty events, ignore silently to avoid self-chatter loops.
          if (rejectReason !== 'empty_no_speech') {
            deterministicReprompt();
          }
          break;
        }

        lastRejectReason = null;

        // Process through conversation intelligence
        if (conversation && userText) {
          const result = conversation.processUserTurn(userText);
          if (analytics) {
            analytics.userFinishedSpeaking(userText);
            analytics.recordSentiment(result.sentiment, 0.7);

            // Add tags from conversation flags
            for (const flag of conversation.getFlags()) {
              analytics.addTag(flag);
            }
          }

          // Log warnings from conversation intelligence
          for (const warning of result.warnings) {
            logger.warn('stream', 'Conversation warning', { sessionId, warning });
          }
        } else if (analytics) {
          analytics.userFinishedSpeaking(userText);
        }

        emitTranscript('user', userText);

        // Auto-DNC detection: if user says "stop calling", add to DNC
        if (userText && callerNumber) {
          const autoDncSettings = getSettings();
          if (autoDncSettings.autoDncEnabled && handleAutoDnc(callerNumber, userText)) {
            logger.info('stream', 'Auto-DNC triggered, ending call gracefully', { sessionId, callSid });
            if (analytics) {
              analytics.addTag('auto_dnc');
              analytics.setOutcome('ended', 'Auto-DNC verbal request');
            }
            const dncMsg = '[System: The caller has asked to be removed from the call list. Their number has been added to the Do Not Call list automatically. End the call gracefully — apologize for the inconvenience and say goodbye.]';
            if (useDeepSeek) {
              callDeepSeekStreaming(dncMsg);
            } else {
              sendUserMessage(dncMsg);
            }
          }
        }

        // DeepSeek mode: OpenAI doesn't auto-respond, so we call DeepSeek
        if (useDeepSeek && userText.trim()) {
          responseRequestedAt = Date.now();
          firstAudioAt = 0;
          audioChunkCount = 0;
          callDeepSeekStreaming(userText);
        }
        break;
      }

      case 'error':
        logger.error('stream', 'OpenAI Realtime error', {
          sessionId,
          type: event.error?.type,
          code: event.error?.code,
          message: event.error?.message,
        });
        break;

      default:
        if (!event.type.includes('.delta')) {
          logger.debug('stream', `OpenAI: ${event.type}`, { sessionId });
        }
        break;
    }
  }

  // --- Function call handling ---

  async function handleFunctionCall(item: any): Promise<void> {
    const { name, call_id } = item;
    let args: any = {};
    try {
      args = JSON.parse(item.arguments || '{}');
    } catch {
      logger.error('stream', 'Failed to parse function args', { sessionId, name, raw: item.arguments });
    }

    logger.info('stream', 'Function call received', { sessionId, name, args });

    if (name === 'transfer_call') {
      const route = args.route || 'other';
      let targetNumber: string | undefined;

      if (route === 'allstate' && transferConfig?.allstate_number) {
        targetNumber = transferConfig.allstate_number;
      } else if (route === 'other' && transferConfig?.non_allstate_number) {
        targetNumber = transferConfig.non_allstate_number;
      } else if (transferConfig?.target_number) {
        targetNumber = transferConfig.target_number;
      } else {
        targetNumber = transferConfig?.non_allstate_number || transferConfig?.allstate_number;
      }

      // In DeepSeek mode, don't send function output to OpenAI — DeepSeek handles its own tool responses
      if (!useDeepSeek) {
        sendFunctionOutput(call_id, { status: 'transferring', target: targetNumber ? 'found' : 'not_configured' });
      }

      if (analytics) {
        analytics.setOutcome('transferred', `Route: ${route}`);
        analytics.setTransferRoute(route);
      }
      if (callSid) updateSessionStatus(callSid, 'transferring');

      if (targetNumber) {
        await new Promise(r => setTimeout(r, 1500));
        logger.info('stream', 'Executing blind transfer', { sessionId, route, target: targetNumber });
        const success = await executeWarmTransfer(callSid, targetNumber);
        if (!success) {
          logger.error('stream', 'Transfer failed', { sessionId, route });
          if (analytics) analytics.setOutcome('ended', 'Transfer failed');
          const failMsg = '[System: The transfer failed. The line did not connect. Let the caller know and ask if they want to try again.]';
          if (useDeepSeek) {
            callDeepSeekStreaming(failMsg);
          } else {
            sendUserMessage(failMsg);
          }
        }
      } else {
        logger.error('stream', 'No transfer number configured', { sessionId, route });
        const noNumMsg = '[System: No transfer number is configured for this route. Apologize and say someone will call them back shortly.]';
        if (useDeepSeek) {
          callDeepSeekStreaming(noNumMsg);
        } else {
          sendUserMessage(noNumMsg);
        }
      }
    } else if (name === 'end_call') {
      logger.info('stream', 'Call ending via function', { sessionId, reason: args.reason });
      if (!useDeepSeek) {
        sendFunctionOutput(call_id, { status: 'ending' });
      }

      if (analytics) analytics.setOutcome('ended', args.reason);
      if (callSid) updateSessionStatus(callSid, 'ending');

      // Check if user requested DNC
      const reason = (args.reason || '').toLowerCase();
      if (reason.includes('not interested') || reason.includes('remove') || reason.includes('stop calling')) {
        if (analytics) analytics.addTag('dnc_request');
      }

      await new Promise(r => setTimeout(r, 3000));
      try {
        await endCall(callSid);
        logger.info('stream', 'Call terminated via Twilio API', { sessionId, callSid });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('stream', 'Failed to end call via Twilio API', { sessionId, error: errMsg });
      }
    } else if (name === 'send_scheduling_text') {
      // Send a text with Zoom scheduling link to the prospect
      // Safety guardrail: always send only to current caller number, never an arbitrary spoken number.
      const prospectName = args.prospect_name || leadData.first_name || 'there';
      const targetPhone = callerNumber;
      if (args.phone || args.phone_number || args.to) {
        logger.warn('stream', 'Ignored model-provided phone override for scheduling text', {
          sessionId,
          provided: args.phone || args.phone_number || args.to,
          enforced: targetPhone,
        });
      }

      logger.info('stream', 'Sending scheduling text', { sessionId, prospectName, targetPhone });

      if (!targetPhone) {
        if (!useDeepSeek) {
          sendFunctionOutput(call_id, { status: 'error', reason: 'no_phone_number' });
        }
        const errMsg = '[System: Could not send the text — no phone number available for this prospect.]';
        if (useDeepSeek) callDeepSeekStreaming(errMsg);
        else sendUserMessage(errMsg);
      } else {
        try {
          const s = getSettings();
          const effectiveAgent = activeCampaign?.aiProfile?.agentName || s.agentName;
          const effectiveCompany = activeCampaign?.aiProfile?.companyName || s.companyName;
          const textBody = `Hi ${prospectName}, it's ${effectiveAgent} from ${effectiveCompany}! Here's a link to learn more about what we do and schedule a meeting with one of our Agency Lead Reps: https://quotingfast.com/schedule — Pick a time that works for you and we'll walk you through everything. Talk soon!`;

          const result = await sendSms(targetPhone, textBody);
          logSms({
            phone: targetPhone,
            direction: 'outbound',
            status: 'sent',
            body: textBody,
            twilioSid: result.sid,
            leadName: prospectName,
            triggerReason: 'zoom_scheduling',
          });
          addLeadNote(targetPhone, `Zoom scheduling text sent during call`);

          if (!useDeepSeek) {
            sendFunctionOutput(call_id, { status: 'sent', message: 'Scheduling text sent successfully' });
          }

          if (analytics) analytics.addTag('scheduling_text_sent');

          // Fire notification (async, don't block)
          notifySchedulingTextSent(targetPhone, prospectName).catch(err =>
            logger.error('stream', 'Notification error', { error: String(err) })
          );

          logger.info('stream', 'Scheduling text sent', { sessionId, targetPhone, sid: result.sid });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('stream', 'Failed to send scheduling text', { sessionId, error: errMsg });
          if (!useDeepSeek) {
            sendFunctionOutput(call_id, { status: 'error', reason: errMsg });
          }
          const failMsg = '[System: The text failed to send. Let the prospect know you\'ll send it shortly after the call.]';
          if (useDeepSeek) callDeepSeekStreaming(failMsg);
          else sendUserMessage(failMsg);
        }
      }
    } else if (name === 'send_scheduling_email') {
      // Send a scheduling email to the prospect
      const prospectName = args.prospect_name || leadData.first_name || 'there';
      const prospectEmail = args.prospect_email || '';

      logger.info('stream', 'Sending scheduling email', { sessionId, prospectName, prospectEmail });

      if (!prospectEmail) {
        if (!useDeepSeek) {
          sendFunctionOutput(call_id, { status: 'error', reason: 'no_email_provided' });
        }
        const errMsg = '[System: No email address was provided. Ask the prospect for their email address.]';
        if (useDeepSeek) callDeepSeekStreaming(errMsg);
        else sendUserMessage(errMsg);
      } else {
        try {
          const s = getSettings();
          const emailSubject = 'Learn More About Quoting Fast — Schedule a Meeting';
          const emailBody = `<p>Hi ${prospectName},</p>
<p>Great chatting with you! As promised, here's a link to learn more about Quoting Fast and schedule a meeting with one of our Agency Lead Reps:</p>
<p style="text-align:center;margin:20px 0;">
  <a href="https://quotingfast.com/schedule" style="background-color:#2563eb;color:white;padding:12px 28px;text-decoration:none;border-radius:6px;font-size:16px;font-weight:bold;">Schedule Your Meeting</a>
</p>
<p>Or copy this link: <a href="https://quotingfast.com/schedule">https://quotingfast.com/schedule</a></p>
<p>Here's a quick look at what we can help with:</p>
<ul>
<li>Connecting you with high-quality auto insurance leads</li>
<li>Flexible delivery options that fit your workflow</li>
<li>Targeting by geography, volume, and your ideal customer profile</li>
<li>Transparent pricing and performance guarantees</li>
</ul>
<p>Check out <a href="https://quotingfast.com">quotingfast.com</a> for more details, or pick a meeting time and we'll walk you through everything personally.</p>
<p>Best,<br>${s.agentName}<br>Agency Lead Rep<br>Quoting Fast<br><a href="https://quotingfast.com">quotingfast.com</a></p>`;

          const sent = await sendProspectEmail(prospectEmail, emailSubject, emailBody);

          if (!useDeepSeek) {
            sendFunctionOutput(call_id, {
              status: sent ? 'sent' : 'queued',
              message: sent ? 'Email sent successfully' : 'Email queued (will be sent when email service is configured)',
            });
          }

          if (callerNumber) {
            addLeadNote(callerNumber, `Zoom scheduling email sent to ${prospectEmail}`);
          }
          if (analytics) analytics.addTag('scheduling_email_sent');

          // Fire notification (async, don't block)
          notifySchedulingEmailSent(callerNumber || 'unknown', prospectName, prospectEmail).catch(err =>
            logger.error('stream', 'Notification error', { error: String(err) })
          );

          logger.info('stream', 'Scheduling email processed', { sessionId, prospectEmail, sent });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('stream', 'Failed to send scheduling email', { sessionId, error: errMsg });
          if (!useDeepSeek) {
            sendFunctionOutput(call_id, { status: 'error', reason: errMsg });
          }
          const failMsg = '[System: The email failed to send. Let the prospect know you\'ll send it shortly after the call.]';
          if (useDeepSeek) callDeepSeekStreaming(failMsg);
          else sendUserMessage(failMsg);
        }
      }
    } else if (name === 'schedule_callback') {
      // Schedule a callback to call the prospect back later
      const callbackTime = args.callback_time || '';
      const prospectName = args.prospect_name || leadData.first_name || 'Unknown';
      const reason = args.reason || '';
      const targetPhone = callerNumber;

      logger.info('stream', 'Scheduling callback', { sessionId, prospectName, callbackTime, targetPhone });

      if (!targetPhone) {
        if (!useDeepSeek) {
          sendFunctionOutput(call_id, { status: 'error', reason: 'no_phone_number' });
        }
        const errMsg = '[System: Could not schedule the callback — no phone number available for this prospect.]';
        if (useDeepSeek) callDeepSeekStreaming(errMsg);
        else sendUserMessage(errMsg);
      } else if (!callbackTime) {
        if (!useDeepSeek) {
          sendFunctionOutput(call_id, { status: 'error', reason: 'no_time_specified' });
        }
        const errMsg = '[System: No callback time was specified. Ask the prospect when they would like to be called back.]';
        if (useDeepSeek) callDeepSeekStreaming(errMsg);
        else sendUserMessage(errMsg);
      } else {
        try {
          // Parse the callback time — the scheduler handles flexible time parsing
          // For now, try to create a reasonable ISO timestamp
          let scheduledAt: string;
          const now = new Date();

          // Simple time parsing for common patterns
          const lowerTime = callbackTime.toLowerCase().trim();
          if (lowerTime.includes('tomorrow')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            // Extract hour if mentioned
            const hourMatch = lowerTime.match(/(\d{1,2})\s*(am|pm)/i);
            if (hourMatch) {
              let hour = parseInt(hourMatch[1], 10);
              if (hourMatch[2].toLowerCase() === 'pm' && hour < 12) hour += 12;
              if (hourMatch[2].toLowerCase() === 'am' && hour === 12) hour = 0;
              tomorrow.setHours(hour, 0, 0, 0);
            } else {
              tomorrow.setHours(10, 0, 0, 0); // Default 10am
            }
            scheduledAt = tomorrow.toISOString();
          } else if (lowerTime.includes('hour')) {
            const hoursMatch = lowerTime.match(/(\d+)\s*hour/);
            const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 1;
            scheduledAt = new Date(now.getTime() + hours * 3600_000).toISOString();
          } else if (lowerTime.includes('minute')) {
            const minsMatch = lowerTime.match(/(\d+)\s*minute/);
            const mins = minsMatch ? parseInt(minsMatch[1], 10) : 30;
            scheduledAt = new Date(now.getTime() + mins * 60_000).toISOString();
          } else {
            // Try to parse as a date/time string directly
            const parsed = new Date(callbackTime);
            if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
              scheduledAt = parsed.toISOString();
            } else {
              // Default: schedule for next business day at 10am
              const nextDay = new Date(now);
              nextDay.setDate(nextDay.getDate() + 1);
              nextDay.setHours(10, 0, 0, 0);
              scheduledAt = nextDay.toISOString();
            }
          }

          const cb = scheduleCallbackTimer({
            phone: targetPhone,
            leadName: prospectName,
            state: leadData.state,
            reason: reason || `Callback requested during call: ${callbackTime}`,
            scheduledAt,
          });

          if (!useDeepSeek) {
            sendFunctionOutput(call_id, {
              status: 'scheduled',
              callbackId: cb.id,
              scheduledAt: cb.scheduledAt,
              message: `Callback scheduled for ${callbackTime}`,
            });
          }

          if (callerNumber) {
            addLeadNote(callerNumber, `Callback scheduled for ${callbackTime} (${cb.scheduledAt}). Reason: ${reason || 'requested during call'}`);
          }
          if (analytics) analytics.addTag('callback_scheduled');

          // Fire notification (async, don't block)
          notifyCallbackScheduled(targetPhone, prospectName, callbackTime).catch(err =>
            logger.error('stream', 'Notification error', { error: String(err) })
          );

          logger.info('stream', 'Callback scheduled', { sessionId, callbackId: cb.id, scheduledAt: cb.scheduledAt, callbackTime });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('stream', 'Failed to schedule callback', { sessionId, error: errMsg });
          if (!useDeepSeek) {
            sendFunctionOutput(call_id, { status: 'error', reason: errMsg });
          }
          const failMsg = '[System: Failed to schedule the callback. Apologize and let the prospect know your team will reach out at the requested time.]';
          if (useDeepSeek) callDeepSeekStreaming(failMsg);
          else sendUserMessage(failMsg);
        }
      }
    }
  }

  // --- Helpers ---

  function sendFunctionOutput(callId: string, output: any): void {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    }));

    openaiWs.send(JSON.stringify({ type: 'response.create' }));
  }

  function sendUserMessage(text: string): void {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    }));

    openaiWs.send(JSON.stringify({ type: 'response.create' }));
  }

  function sendAudioToTwilio(base64Audio: string): void {
    if (twilioWs.readyState !== WebSocket.OPEN) return;

    let payload = base64Audio;

    // Inject background noise if enabled
    const s = getSettings();
    if (s.backgroundNoiseEnabled) {
      try {
        const audioBuffer = Buffer.from(base64Audio, 'base64');
        const mixed = mixNoiseIntoAudio(audioBuffer, s.backgroundNoiseVolume);
        payload = mixed.toString('base64');
      } catch {
        // On any error, send original audio
      }
    }

    // Check call duration limits
    if (s.maxCallDurationSec > 0 && callStartedAt > 0 && !durationLimitReached) {
      const elapsedSec = (Date.now() - callStartedAt) / 1000;
      const warnThreshold = s.maxCallDurationSec * (s.callDurationWarnPct / 100);

      if (elapsedSec >= s.maxCallDurationSec) {
        durationLimitReached = true;
        logger.warn('stream', 'Call duration limit reached, ending call', { sessionId, callSid, elapsedSec });
        const limitMsg = '[System: Call has reached the maximum allowed duration. Wrap up and say goodbye now.]';
        if (useDeepSeek) {
          callDeepSeekStreaming(limitMsg);
        } else {
          sendUserMessage(limitMsg);
        }
        // Force end after 10s grace period
        setTimeout(async () => {
          try { await endCall(callSid); } catch {}
        }, 10_000);
      } else if (!durationWarningFired && elapsedSec >= warnThreshold) {
        durationWarningFired = true;
        logger.info('stream', 'Call duration warning', { sessionId, elapsedSec, maxSec: s.maxCallDurationSec });
        const warnMsg = `[System: You are at ${Math.round(s.callDurationWarnPct)}% of the maximum call duration. Start wrapping up the conversation.]`;
        if (useDeepSeek) {
          callDeepSeekStreaming(warnMsg);
        } else {
          sendUserMessage(warnMsg);
        }
      }
    }

    twilioWs.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload },
    }));
  }

  function sendClearToTwilio(): void {
    if (twilioWs.readyState !== WebSocket.OPEN) return;

    twilioWs.send(JSON.stringify({
      event: 'clear',
      streamSid,
    }));
    logger.debug('stream', 'Sent clear to Twilio', { sessionId });
  }

  function emitTranscript(role: string, text: string): void {
    const listener = liveTranscriptListeners.get(callSid);
    if (listener) {
      listener({ role, text, timestamp: Date.now() });
    }
  }

  function cleanup(): void {
    if (silenceCheckInterval) {
      clearInterval(silenceCheckInterval);
      silenceCheckInterval = null;
    }
    if (openaiWs) {
      openaiWs.close();
      openaiWs = null;
    }
    if (elevenLabsWs) {
      elevenLabsWs.close();
      elevenLabsWs = null;
    }
    if (deepseekAbortController) {
      deepseekAbortController.abort();
      deepseekAbortController = null;
    }

    // Finalize analytics and run post-call workflows
    if (callSid) {
      if (analytics && analytics.getData().outcome === 'in_progress') {
        analytics.setOutcome('dropped', 'Connection closed without explicit end');
      }

      const analyticsData = finalizeCallAnalytics(callSid);

      if (analyticsData) {
        const s = getSettings();

        // Record to lead memory
        recordCallToLead(callerNumber, {
          callSid,
          timestamp: new Date().toISOString(),
          durationMs: analyticsData.durationMs || 0,
          outcome: analyticsData.outcome,
          score: analyticsData.score || 0,
          agentName: s.agentName,
          voiceProvider: s.voiceProvider,
          keyMoments: analyticsData.tags,
          sentimentOverall: analyticsData.sentiment.length > 0
            ? analyticsData.sentiment[analyticsData.sentiment.length - 1].sentiment
            : 'neutral',
        });

        // Run post-call workflow (async, don't block cleanup)
        runPostCallWorkflow(analyticsData, callerNumber, leadData.first_name, s.agentName, s.companyName)
          .catch(err => logger.error('stream', 'Post-call workflow error', { error: String(err) }));

        // Quality alerts (async, don't block cleanup)
        if (s.qualityAlertsEnabled) {
          const frustrated = (analyticsData.sentiment || []).filter(
            (se: { sentiment: string }) => se.sentiment === 'frustrated'
          );
          if (frustrated.length >= 2) {
            notifyHighFrustration(callerNumber, leadData.first_name || 'Unknown', callSid)
              .catch(err => logger.error('stream', 'Frustration alert error', { error: String(err) }));
          }
          if (analyticsData.avgLatencyMs > (s.latencyAlertThresholdMs || 2000)) {
            notifyHighLatency(callerNumber, leadData.first_name || 'Unknown', callSid, analyticsData.avgLatencyMs)
              .catch(err => logger.error('stream', 'Latency alert error', { error: String(err) }));
          }
        }
      }

      removeSession(callSid);
      removeTranscriptListener(callSid);
      onSessionFreed();
    }
  }
}
