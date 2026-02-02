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

  // Pending text buffer for ElevenLabs lazy reconnect
  let elevenLabsPendingText: string[] = [];

  // DeepSeek state
  let useDeepSeek = false;
  let deepseekHistory: Array<any> = [];
  let deepseekInstructions = '';
  let deepseekAbortController: AbortController | null = null;

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
    useDeepSeek = s.voiceProvider === 'deepseek';

    // Fall back to ElevenLabs mode if DeepSeek selected but API key missing
    if (useDeepSeek && !config.deepseek.apiKey) {
      logger.warn('stream', 'DeepSeek selected but no API key configured — falling back to ElevenLabs mode', { sessionId });
      useDeepSeek = false;
    }

    useElevenLabs = s.voiceProvider === 'elevenlabs' || useDeepSeek;
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
    if (!config.elevenlabs.apiKey || !s.elevenlabsVoiceId) {
      logger.error('stream', 'ElevenLabs MISSING config', {
        sessionId,
        hasApiKey: !!config.elevenlabs.apiKey,
        voiceId: s.elevenlabsVoiceId || '(empty)',
      });
      return;
    }

    const voiceId = s.elevenlabsVoiceId;
    logger.info('stream', 'ElevenLabs connecting', { sessionId, voiceId });
    const modelId = s.elevenlabsModelId || 'eleven_turbo_v2_5';
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
          stability: s.elevenlabsStability,
          similarity_boost: s.elevenlabsSimilarityBoost,
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

  // --- OpenAI event handling ---

  function handleOpenAIEvent(event: any): void {
    switch (event.type) {
      case 'session.created':
        logger.info('stream', 'Realtime session created', { sessionId });
        break;

      case 'session.updated':
        logger.info('stream', 'Realtime session configured', { sessionId, useElevenLabs });
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
        logger.info('stream', 'Executing warm transfer', { sessionId, route, target: targetNumber });
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
      }

      removeSession(callSid);
      removeTranscriptListener(callSid);
      onSessionFreed();
    }
  }
}
