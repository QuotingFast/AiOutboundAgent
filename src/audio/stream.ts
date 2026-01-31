import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { buildSystemPrompt, getRealtimeTools, LeadData, TransferConfig } from '../agent/prompts';
import { executeWarmTransfer } from '../twilio/transfer';
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
          cleanupOpenAI();
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
    cleanupOpenAI();
  });

  twilioWs.on('error', (err) => {
    logger.error('stream', 'Twilio WS error', { sessionId, error: err.message });
  });

  // --- OpenAI Realtime connection ---

  function connectToOpenAIRealtime(): void {
    const model = config.openai.realtimeModel;
    const url = `wss://api.openai.com/v1/realtime?model=${model}`;

    logger.info('stream', 'Connecting to OpenAI Realtime', { sessionId, model });

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

    const instructions = buildSystemPrompt(leadData);
    const voice = config.openai.voice;

    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions,
        voice,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.62,
          prefix_padding_ms: 250,
          silence_duration_ms: 400,
          create_response: true,
          interrupt_response: true,
        },
        tools: getRealtimeTools(),
        max_response_output_tokens: 100,
        temperature: 0.7,
      },
    }));
  }

  function triggerGreeting(): void {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

    logger.info('stream', 'Triggering greeting', { sessionId, lead: leadData.first_name });

    // Inject a user message to prompt the agent to greet the caller
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

  // --- OpenAI event handling ---

  function handleOpenAIEvent(event: any): void {
    switch (event.type) {
      case 'session.created':
        logger.info('stream', 'Realtime session created', { sessionId });
        break;

      case 'session.updated':
        logger.info('stream', 'Realtime session configured', { sessionId });
        // Trigger the greeting after session is ready
        setTimeout(() => triggerGreeting(), 300);
        break;

      case 'response.audio.delta':
        // Stream g711_ulaw audio directly to Twilio — zero transcoding
        if (event.delta) {
          sendAudioToTwilio(event.delta);
        }
        break;

      case 'input_audio_buffer.speech_started':
        // CRITICAL: Flush Twilio outbound audio queue immediately on user speech
        logger.info('stream', 'User speech started — flushing Twilio queue', { sessionId });
        sendClearToTwilio();
        break;

      case 'input_audio_buffer.speech_stopped':
        logger.debug('stream', 'User speech stopped', { sessionId });
        break;

      case 'response.done':
        // Check for function calls in the completed response
        if (event.response?.output) {
          for (const item of event.response.output) {
            if (item.type === 'function_call') {
              handleFunctionCall(item);
            }
          }
        }
        break;

      case 'response.audio_transcript.done':
        logger.info('stream', 'Agent said', { sessionId, transcript: event.transcript });
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
        // Only log non-streaming events at debug level
        if (!event.type.includes('.delta')) {
          logger.debug('stream', `OpenAI: ${event.type}`, { sessionId });
        }
        break;
    }
  }

  // --- Function call handling (transfers, end call) ---

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

      // Acknowledge the function call
      sendFunctionOutput(call_id, { status: 'transferring', target: targetNumber ? 'found' : 'not_configured' });

      if (targetNumber) {
        // Brief delay so the model's transfer message audio finishes playing
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
      // Acknowledge — the call will end naturally when audio finishes
      sendFunctionOutput(call_id, { status: 'ending' });
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

    // Let the model respond to the function result
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

  function cleanupOpenAI(): void {
    if (openaiWs) {
      openaiWs.close();
      openaiWs = null;
    }
  }
}
