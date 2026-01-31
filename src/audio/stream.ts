import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { transcribeAudio } from './stt-openai';
import { streamTTS } from './tts-router';
import { AgentStateMachine, AgentTurn } from '../agent/state-machine';
import { buildGreetingText, LeadData } from '../agent/prompts';
import { executeWarmTransfer } from '../twilio/transfer';
import { logger } from '../utils/logger';

// Map of streamSid -> session data for passing lead/transfer info
const pendingSessions = new Map<string, { lead: LeadData; transfer?: { mode: string; target_number: string } }>();

export function registerPendingSession(callSid: string, lead: LeadData, transfer?: { mode: string; target_number: string }): void {
  pendingSessions.set(callSid, { lead, transfer });
}

interface TwilioMediaMessage {
  event: string;
  sequenceNumber?: string;
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
    mediaFormat?: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
  streamSid?: string;
  stop?: {
    callSid: string;
  };
}

/**
 * Energy detection for barge-in.
 * Calculates RMS energy of mulaw audio and returns true if above threshold.
 */
function detectSpeechEnergy(mulawPayload: Buffer, threshold: number = 30): boolean {
  if (mulawPayload.length === 0) return false;

  let sumSquares = 0;
  for (let i = 0; i < mulawPayload.length; i++) {
    // Convert mulaw byte to approximate linear amplitude
    const mulaw = mulawPayload[i];
    const sign = mulaw & 0x80 ? -1 : 1;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0f;
    const magnitude = ((mantissa << 1) | 0x21) << (exponent + 2);
    const sample = sign * magnitude;
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / mulawPayload.length);
  return rms > threshold;
}

export function handleMediaStream(ws: WebSocket): void {
  const sessionId = uuidv4();
  let streamSid = '';
  let callSid = '';
  let agent: AgentStateMachine | null = null;
  let transferConfig: { mode: string; target_number: string } | undefined;

  // Audio buffering for STT
  let inboundAudioBuffer = Buffer.alloc(0);
  let silenceFrames = 0;
  let speechFrames = 0;
  const SILENCE_THRESHOLD = 25; // Consecutive silent frames before we consider speech ended
  const SPEECH_START_THRESHOLD = 3; // Consecutive speech frames to start recording

  // Barge-in state
  let isSpeaking = false; // Is the agent currently sending TTS audio?
  let abortTTS = false;   // Flag to cancel current TTS stream
  let isProcessing = false; // Are we currently processing a turn?

  // Track greeting state
  let greetingSent = false;

  logger.info('stream', 'WebSocket connection opened', { sessionId });

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const msg: TwilioMediaMessage = JSON.parse(data.toString());

      switch (msg.event) {
        case 'connected':
          logger.info('stream', 'Twilio stream connected', { sessionId });
          break;

        case 'start': {
          streamSid = msg.start?.streamSid || '';
          callSid = msg.start?.callSid || '';
          logger.info('stream', 'Stream started', { sessionId, streamSid, callSid });

          // Look up session data — try callSid first, then iterate pending sessions
          const sessionData = pendingSessions.get(callSid);
          if (sessionData) {
            agent = new AgentStateMachine(sessionData.lead);
            transferConfig = sessionData.transfer as { mode: string; target_number: string } | undefined;
            pendingSessions.delete(callSid);

            // Send greeting after a short delay to let the audio path establish
            setTimeout(() => sendGreeting(sessionData.lead), 500);
          } else {
            // Fallback: use default lead data
            const defaultLead: LeadData = { first_name: 'there' };
            agent = new AgentStateMachine(defaultLead);
            setTimeout(() => sendGreeting(defaultLead), 500);
          }
          break;
        }

        case 'media': {
          if (!msg.media?.payload) break;

          const audioChunk = Buffer.from(msg.media.payload, 'base64');
          const hasSpeech = detectSpeechEnergy(audioChunk);

          if (hasSpeech) {
            speechFrames++;
            silenceFrames = 0;

            // Barge-in: if agent is speaking and we detect real speech, cancel TTS
            if (isSpeaking && speechFrames >= SPEECH_START_THRESHOLD) {
              logger.info('stream', 'Barge-in detected — canceling TTS', { sessionId });
              abortTTS = true;
              // Send clear message to Twilio to stop playing audio
              sendClearMessage();
            }

            // Buffer inbound audio for transcription
            inboundAudioBuffer = Buffer.concat([inboundAudioBuffer, audioChunk]);
          } else {
            if (speechFrames >= SPEECH_START_THRESHOLD) {
              // We were in speech, now silence
              silenceFrames++;

              // Still buffer during short pauses
              inboundAudioBuffer = Buffer.concat([inboundAudioBuffer, audioChunk]);

              if (silenceFrames >= SILENCE_THRESHOLD && !isProcessing) {
                // End of utterance detected
                const audioToProcess = inboundAudioBuffer;
                inboundAudioBuffer = Buffer.alloc(0);
                speechFrames = 0;
                silenceFrames = 0;

                // Process this utterance
                processUtterance(audioToProcess);
              }
            } else {
              speechFrames = 0;
              silenceFrames = 0;
            }
          }
          break;
        }

        case 'stop':
          logger.info('stream', 'Stream stopped', { sessionId, callSid });
          break;

        default:
          logger.debug('stream', 'Unknown event', { event: msg.event });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Error processing message', { sessionId, error: errMsg });
    }
  });

  ws.on('close', () => {
    logger.info('stream', 'WebSocket closed', { sessionId, callSid });
  });

  ws.on('error', (err) => {
    logger.error('stream', 'WebSocket error', { sessionId, error: err.message });
  });

  // --- Helper functions ---

  async function sendGreeting(lead: LeadData): Promise<void> {
    if (greetingSent) return;
    greetingSent = true;

    const greetingText = buildGreetingText(lead);
    logger.info('stream', 'Sending greeting', { sessionId, streamSid, text: greetingText });
    try {
      await speakText(greetingText);
      logger.info('stream', 'Greeting TTS complete', { sessionId });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Greeting TTS FAILED', { sessionId, error: errMsg });
    }
  }

  async function processUtterance(audioBuffer: Buffer): Promise<void> {
    if (!agent || isProcessing) return;
    isProcessing = true;

    try {
      // Transcribe
      const transcript = await transcribeAudio(audioBuffer);
      if (!transcript) {
        isProcessing = false;
        return;
      }

      logger.info('stream', 'User said', { sessionId, transcript });

      // Get agent response
      const turn: AgentTurn = await agent.processUserInput(transcript);

      logger.info('stream', 'Agent response', {
        sessionId,
        action: turn.action,
        text: turn.text,
        state: agent.getState(),
      });

      // Speak the response
      if (turn.text) {
        await speakText(turn.text);
      }

      // Handle actions
      if (turn.action === 'transfer' && transferConfig) {
        logger.info('stream', 'Executing transfer', { sessionId, target: transferConfig.target_number });
        const success = await executeWarmTransfer(callSid, transferConfig.target_number);
        if (!success) {
          // Transfer failed — agent recovers
          const recovery = await agent.processUserInput('[system: transfer failed, line did not connect]');
          if (recovery.text) {
            await speakText(recovery.text);
          }
        }
      } else if (turn.action === 'end') {
        // Let the TTS finish, then Twilio will eventually hang up
        logger.info('stream', 'Call ending', { sessionId });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Error processing utterance', { sessionId, error: errMsg });
    } finally {
      isProcessing = false;
    }
  }

  async function speakText(text: string): Promise<void> {
    isSpeaking = true;
    abortTTS = false;

    try {
      const ttsStream = streamTTS(text);

      for await (const chunk of ttsStream) {
        if (abortTTS) {
          logger.debug('stream', 'TTS aborted by barge-in', { sessionId });
          break;
        }

        // Send audio chunk to Twilio via WebSocket
        sendAudioToTwilio(chunk);

        // Small yield to allow barge-in detection between chunks
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'TTS streaming error', { sessionId, error: errMsg });
      throw err;
    } finally {
      isSpeaking = false;
      abortTTS = false;
    }
  }

  function sendAudioToTwilio(audioChunk: Buffer): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const payload = audioChunk.toString('base64');
    const message = JSON.stringify({
      event: 'media',
      streamSid,
      media: {
        payload,
      },
    });
    ws.send(message);
  }

  function sendClearMessage(): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    // Send clear event to tell Twilio to flush its audio buffer
    const message = JSON.stringify({
      event: 'clear',
      streamSid,
    });
    ws.send(message);
  }
}
