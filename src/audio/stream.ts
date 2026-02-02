import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getSettings } from '../config/runtime';
import { buildSystemPrompt, buildInboundSystemPrompt, buildInboundGreetingText, getRealtimeTools, LeadData, TransferConfig } from '../agent/prompts';
import { executeWarmTransfer } from '../twilio/transfer';
import { endCall } from '../twilio/client';
import { logger } from '../utils/logger';
import { createCallAnalytics, finalizeCallAnalytics, CallAnalytics } from '../analytics';
import { ConversationIntelligence } from '../conversation/intelligence';
import { registerSession, removeSession, updateSessionStatus, onSessionFreed } from '../performance';
import { buildLeadContext, recordCallToLead } from '../memory';
import { runPostCallWorkflow } from '../workflows';
import { redactPII } from '../security';

// Map of callSid -> session data for passing lead/transfer info
const pendingSessions = new Map<string, { lead: LeadData; transfer?: TransferConfig }>();

// Active live transcript listeners (callSid -> callback)
const liveTranscriptListeners = new Map<string, (entry: { role: string; text: string; timestamp: number }) => void>();

export function registerPendingSession(callSid: string, lead: LeadData, transfer?: TransferConfig): void {
  pendingSessions.set(callSid, { lead, transfer });
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

  // Voice provider determined at call start
  let useElevenLabs = false;
  let elevenLabsWs: WebSocket | null = null;

  // Barge-in state
  let bargeInDebounceMs = 250;
  let echoSuppressionMs = 100;
  let bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  let responseIsPlaying = false;
  let lastAudioSentAt = 0;

  // Module instances (created when call starts)
  let analytics: CallAnalytics | null = null;
  let conversation: ConversationIntelligence | null = null;

  // Latency tracking
  let responseRequestedAt = 0;
  let firstAudioAt = 0;
  let audioChunkCount = 0;
  let currentAgentText = '';
  let currentElevenLabsText = '';

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
            logger.info('stream', 'Inbound call connected', { sessionId, callerNumber });
          } else {
            // Outbound call — look up pending session
            const session = pendingSessions.get(callSid);
            if (session) {
              leadData = session.lead;
              transferConfig = session.transfer;
              pendingSessions.delete(callSid);
              logger.info('stream', 'Session found', { sessionId, lead: leadData.first_name });
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
          registerSession(callSid, callerNumber, leadData.first_name);

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
    const model = s.realtimeModel;
    useElevenLabs = s.voiceProvider === 'elevenlabs';
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

    let instructions: string;
    if (s.systemPromptOverride) {
      instructions = s.systemPromptOverride
        .replace(/\{\{first_name\}\}/g, leadData.first_name)
        .replace(/\{\{state\}\}/g, leadData.state || 'unknown')
        .replace(/\{\{current_insurer\}\}/g, leadData.current_insurer || 'unknown');
    } else if (callDirection === 'inbound') {
      instructions = s.inboundPromptOverride
        ? s.inboundPromptOverride
            .replace(/\{\{caller_number\}\}/g, callerNumber)
            .replace(/\{\{agent_name\}\}/g, s.agentName)
            .replace(/\{\{company_name\}\}/g, s.companyName)
        : buildInboundSystemPrompt(callerNumber, { agentName: s.agentName, companyName: s.companyName });
    } else {
      instructions = buildSystemPrompt(leadData, { agentName: s.agentName, companyName: s.companyName });
    }

    // Inject lead memory context if available
    const leadContext = buildLeadContext(callerNumber);
    if (leadContext) {
      instructions += '\n\n' + leadContext;
    }

    if (!transferConfig) {
      if (s.allstateNumber || s.nonAllstateNumber) {
        transferConfig = {
          allstate_number: s.allstateNumber || undefined,
          non_allstate_number: s.nonAllstateNumber || undefined,
        };
      }
    }

    logger.info('stream', 'Configuring session', {
      sessionId,
      voiceProvider: s.voiceProvider,
      voice: useElevenLabs ? `elevenlabs:${s.elevenlabsVoiceId}` : s.voice,
      model: s.realtimeModel,
      vadThreshold: s.vadThreshold,
      silenceDurationMs: s.silenceDurationMs,
      maxTokens: s.maxResponseTokens,
    });

    if (useElevenLabs) {
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
          max_response_output_tokens: s.maxResponseTokens,
          temperature: s.temperature,
        },
      }));
    } else {
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions,
          voice: s.voice,
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
          max_response_output_tokens: s.maxResponseTokens,
          temperature: s.temperature,
        },
      }));
    }
  }

  function triggerGreeting(): void {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    const s = getSettings();
    logger.info('stream', 'Triggering greeting', { sessionId, direction: callDirection, lead: leadData.first_name });
    responseRequestedAt = Date.now();

    let greetingInstruction: string;
    if (callDirection === 'inbound') {
      const greetingText = buildInboundGreetingText({ agentName: s.agentName, companyName: s.companyName });
      greetingInstruction = `[An inbound call has just connected. Someone is calling your company. Answer the phone warmly. Start with: "${greetingText}"]`;
    } else {
      greetingInstruction = `[The outbound call to ${leadData.first_name} has just connected. Greet them now. Start with: "Hey — is this ${leadData.first_name}?"]`;
    }

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
    if (!config.elevenlabs.apiKey || !s.elevenlabsVoiceId) {
      logger.error('stream', 'ElevenLabs API key or voice ID not configured', { sessionId });
      return;
    }

    const voiceId = s.elevenlabsVoiceId;
    const modelId = s.elevenlabsModelId || 'eleven_turbo_v2_5';
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${modelId}&output_format=ulaw_8000`;

    logger.info('stream', 'Connecting to ElevenLabs WS', { sessionId, voiceId, modelId });

    elevenLabsWs = new WebSocket(url);

    elevenLabsWs.on('open', () => {
      logger.info('stream', 'ElevenLabs WS connected', { sessionId });
      elevenLabsWs!.send(JSON.stringify({
        text: ' ',
        voice_settings: {
          stability: s.elevenlabsStability,
          similarity_boost: s.elevenlabsSimilarityBoost,
        },
        xi_api_key: config.elevenlabs.apiKey,
      }));
    });

    elevenLabsWs.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.audio) {
          responseIsPlaying = true;
          lastAudioSentAt = Date.now();
          sendAudioToTwilio(msg.audio);

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
          if (analytics) analytics.agentFinishedSpeaking(currentElevenLabsText);
          currentElevenLabsText = '';
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('stream', 'ElevenLabs message error', { sessionId, error: errMsg });
      }
    });

    elevenLabsWs.on('close', () => {
      logger.debug('stream', 'ElevenLabs WS closed', { sessionId });
      elevenLabsWs = null;
    });

    elevenLabsWs.on('error', (err) => {
      logger.error('stream', 'ElevenLabs WS error', { sessionId, error: err.message });
    });
  }

  function sendTextToElevenLabs(text: string): void {
    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) return;
    elevenLabsWs.send(JSON.stringify({ text }));
    currentElevenLabsText += text;
    if (analytics) analytics.addElevenLabsCharacters(text.length);
  }

  function flushElevenLabs(): void {
    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) return;
    elevenLabsWs.send(JSON.stringify({ text: '' }));
  }

  function resetElevenLabs(): void {
    if (elevenLabsWs) {
      elevenLabsWs.close();
      elevenLabsWs = null;
    }
    connectElevenLabs();
  }

  // --- OpenAI event handling ---

  function handleOpenAIEvent(event: any): void {
    switch (event.type) {
      case 'session.created':
        logger.info('stream', 'Realtime session created', { sessionId });
        break;

      case 'session.updated':
        logger.info('stream', 'Realtime session configured', { sessionId });
        if (useElevenLabs) {
          connectElevenLabs();
        }
        setTimeout(() => triggerGreeting(), 300);
        break;

      // --- OpenAI voice output (only fires in OpenAI mode) ---
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        responseIsPlaying = true;
        lastAudioSentAt = Date.now();
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
        responseIsPlaying = false;
        break;

      // --- Text output (for ElevenLabs mode + transcript) ---
      case 'response.text.delta':
        if (useElevenLabs && event.delta) {
          responseIsPlaying = true;
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
        if (useElevenLabs) {
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
        if (analytics) analytics.userStartedSpeaking();

        if (!responseIsPlaying) break;

        if (Date.now() - lastAudioSentAt < echoSuppressionMs) {
          logger.debug('stream', 'Speech within echo window — suppressing', { sessionId });
          break;
        }

        if (bargeInTimer) clearTimeout(bargeInTimer);
        logger.debug('stream', 'Potential barge-in — starting debounce', { sessionId });
        bargeInTimer = setTimeout(() => {
          bargeInTimer = null;
          logger.info('stream', 'Barge-in confirmed — canceling response', { sessionId });

          if (analytics) analytics.recordInterruption();

          if (openaiWs?.readyState === WebSocket.OPEN) {
            openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          if (useElevenLabs) {
            resetElevenLabs();
          }
          sendClearToTwilio();
          responseIsPlaying = false;
        }, bargeInDebounceMs);
        break;

      case 'input_audio_buffer.speech_stopped':
        if (bargeInTimer) {
          clearTimeout(bargeInTimer);
          bargeInTimer = null;
          logger.debug('stream', 'Speech stopped before debounce — ignored', { sessionId });
        }
        responseRequestedAt = Date.now(); // Mark when user stopped = when we expect response
        firstAudioAt = 0;
        audioChunkCount = 0;
        break;

      case 'response.done':
        if (useElevenLabs && elevenLabsWs) {
          setTimeout(() => resetElevenLabs(), 500);
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
              handleFunctionCall(item);
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
        logger.info('stream', 'User said', { sessionId, transcript: redactPII(userText) });

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

      sendFunctionOutput(call_id, { status: 'transferring', target: targetNumber ? 'found' : 'not_configured' });

      if (analytics) {
        analytics.setOutcome('transferred', `Route: ${route}`);
        analytics.setTransferRoute(route);
      }
      if (callSid) updateSessionStatus(callSid, 'transferring');

      if (targetNumber) {
        await new Promise(r => setTimeout(r, 1500));
        logger.info('stream', 'Executing warm transfer', { sessionId, route, target: targetNumber });
        const success = await executeWarmTransfer(callSid, targetNumber);
        if (!success) {
          logger.error('stream', 'Transfer failed', { sessionId, route });
          if (analytics) analytics.setOutcome('ended', 'Transfer failed');
          sendUserMessage('[System: The transfer failed. The line did not connect. Let the caller know and ask if they want to try again.]');
        }
      } else {
        logger.error('stream', 'No transfer number configured', { sessionId, route });
        sendUserMessage('[System: No transfer number is configured for this route. Apologize and say someone will call them back shortly.]');
      }
    } else if (name === 'end_call') {
      logger.info('stream', 'Call ending via function', { sessionId, reason: args.reason });
      sendFunctionOutput(call_id, { status: 'ending' });

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

    twilioWs.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: base64Audio },
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
    if (openaiWs) {
      openaiWs.close();
      openaiWs = null;
    }
    if (elevenLabsWs) {
      elevenLabsWs.close();
      elevenLabsWs = null;
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
      }

      removeSession(callSid);
      removeTranscriptListener(callSid);
      onSessionFreed();
    }
  }
}
