import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getSettings } from '../config/runtime';
import { buildSystemPrompt, getRealtimeTools, LeadData, TransferConfig } from '../agent/prompts';
import { executeWarmTransfer } from '../twilio/transfer';
import { endCall } from '../twilio/client';
import { logger } from '../utils/logger';

// Map of callSid -> session data for passing lead/transfer info
const pendingSessions = new Map<string, { lead: LeadData; transfer?: TransferConfig }>();

export function registerPendingSession(callSid: string, lead: LeadData, transfer?: TransferConfig): void {
  pendingSessions.set(callSid, { lead, transfer });
}

export function handleMediaStream(twilioWs: WebSocket): void {
  const sessionId = uuidv4().slice(0, 8);
  let streamSid = '';
  let callSid = '';
  let openaiWs: WebSocket | null = null;
  let transferConfig: TransferConfig | undefined;
  let leadData: LeadData = { first_name: 'there' };

  // Voice provider determined at call start
  let useElevenLabs = false;
  let elevenLabsWs: WebSocket | null = null;

  // Barge-in state (thresholds read from runtime settings at call start)
  let bargeInDebounceMs = 250;
  let echoSuppressionMs = 100;
  let bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  let responseIsPlaying = false;
  let lastAudioSentAt = 0;

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
          logger.info('stream', 'Stream started', { sessionId, streamSid, callSid });

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

          connectToOpenAIRealtime();
          break;
        }

        case 'media':
          // Forward raw g711_ulaw audio to OpenAI Realtime (already base64)
          if (msg.media?.payload && openaiWs?.readyState === WebSocket.OPEN) {
            openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: msg.media.payload,
            }));
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
    } else {
      instructions = buildSystemPrompt(leadData, { agentName: s.agentName, companyName: s.companyName });
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
      // ElevenLabs mode: text-only output from OpenAI, audio routed through ElevenLabs
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
      // OpenAI mode: full speech-to-speech
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

    logger.info('stream', 'Triggering greeting', { sessionId, lead: leadData.first_name });

    openaiWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `[The outbound call to ${leadData.first_name} has just connected. Greet them now. Start with: "Hey — is this ${leadData.first_name}?"]`,
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
      // Send initial config (BOS - beginning of stream)
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
          // ElevenLabs sends base64-encoded ulaw_8000 audio
          responseIsPlaying = true;
          lastAudioSentAt = Date.now();
          sendAudioToTwilio(msg.audio);
        }
        if (msg.isFinal) {
          responseIsPlaying = false;
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
  }

  function flushElevenLabs(): void {
    if (!elevenLabsWs || elevenLabsWs.readyState !== WebSocket.OPEN) return;
    // Send empty text to signal EOS (end of stream) and flush remaining audio
    elevenLabsWs.send(JSON.stringify({ text: '' }));
  }

  function resetElevenLabs(): void {
    // Close current connection and open a fresh one for the next utterance
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
        // Connect ElevenLabs if in that mode
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
        }
        break;

      case 'response.audio.done':
      case 'response.output_audio.done':
        responseIsPlaying = false;
        break;

      // --- Text output (only fires in ElevenLabs mode) ---
      case 'response.text.delta':
        if (useElevenLabs && event.delta) {
          responseIsPlaying = true;
          sendTextToElevenLabs(event.delta);
        }
        break;

      case 'response.text.done':
        if (useElevenLabs) {
          flushElevenLabs();
          logger.info('stream', 'Agent said', { sessionId, transcript: event.text });
        }
        break;

      // --- Barge-in handling (works for both modes) ---
      case 'input_audio_buffer.speech_started':
        if (!responseIsPlaying) break;

        if (Date.now() - lastAudioSentAt < echoSuppressionMs) {
          logger.debug('stream', 'Speech detected within echo window — suppressing', { sessionId });
          break;
        }

        if (bargeInTimer) clearTimeout(bargeInTimer);
        logger.debug('stream', 'Potential barge-in — starting debounce', { sessionId });
        bargeInTimer = setTimeout(() => {
          bargeInTimer = null;
          logger.info('stream', 'Barge-in confirmed — canceling response', { sessionId });

          if (openaiWs?.readyState === WebSocket.OPEN) {
            openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          // In ElevenLabs mode, reset the WS to stop audio generation
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
          logger.debug('stream', 'Speech stopped before debounce — ignored as echo/noise', { sessionId });
        }
        break;

      case 'response.done':
        // In ElevenLabs mode, reset the WS for the next turn
        if (useElevenLabs && elevenLabsWs) {
          // Give ElevenLabs time to finish flushing audio, then reset for next turn
          setTimeout(() => resetElevenLabs(), 500);
        }
        if (!useElevenLabs) {
          responseIsPlaying = false;
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
        break;

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        if (!useElevenLabs) {
          logger.info('stream', 'Agent said', { sessionId, transcript: event.transcript });
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        logger.info('stream', 'User said', { sessionId, transcript: event.transcript });
        break;

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

      if (targetNumber) {
        await new Promise(r => setTimeout(r, 1500));
        logger.info('stream', 'Executing warm transfer', { sessionId, route, target: targetNumber });
        const success = await executeWarmTransfer(callSid, targetNumber);
        if (!success) {
          logger.error('stream', 'Transfer failed', { sessionId, route });
          sendUserMessage('[System: The transfer failed. The line did not connect. Let the caller know and ask if they want to try again.]');
        }
      } else {
        logger.error('stream', 'No transfer number configured', { sessionId, route });
        sendUserMessage('[System: No transfer number is configured for this route. Apologize and say someone will call them back shortly.]');
      }
    } else if (name === 'end_call') {
      logger.info('stream', 'Call ending via function', { sessionId, reason: args.reason });
      sendFunctionOutput(call_id, { status: 'ending' });

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

  function cleanup(): void {
    if (openaiWs) {
      openaiWs.close();
      openaiWs = null;
    }
    if (elevenLabsWs) {
      elevenLabsWs.close();
      elevenLabsWs = null;
    }
  }
}
