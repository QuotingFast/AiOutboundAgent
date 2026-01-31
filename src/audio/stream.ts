import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { transcribeAudio } from './stt-openai';
import { streamTTS } from './tts-router';
import { AgentStateMachine, AgentTurn } from '../agent/state-machine';
import { buildGreetingText, LeadData, TransferConfig } from '../agent/prompts';
import { executeWarmTransfer } from '../twilio/transfer';
import { logger } from '../utils/logger';

// Map of callSid -> session data for passing lead/transfer info
const pendingSessions = new Map<string, { lead: LeadData; transfer?: TransferConfig }>();

export function registerPendingSession(callSid: string, lead: LeadData, transfer?: TransferConfig): void {
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
 * Decode mu-law byte to linear sample.
 * Twilio sends inverted mu-law (each byte is bitwise complemented).
 */
function mulawToLinear(muByte: number): number {
  // Twilio mu-law is complemented on the wire
  muByte = ~muByte & 0xff;

  const sign = muByte & 0x80;
  const exponent = (muByte >> 4) & 0x07;
  const mantissa = muByte & 0x0f;
  let magnitude = ((mantissa << 1) | 0x21) << (exponent + 2);
  magnitude -= 33; // Remove mu-law bias

  return sign ? -magnitude : magnitude;
}

/**
 * Energy detection for VAD / barge-in.
 * Returns RMS energy level of the audio chunk.
 */
function getAudioEnergy(mulawPayload: Buffer): number {
  if (mulawPayload.length === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < mulawPayload.length; i++) {
    const sample = mulawToLinear(mulawPayload[i]);
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / mulawPayload.length);
}

export function handleMediaStream(ws: WebSocket): void {
  const sessionId = uuidv4().slice(0, 8);
  let streamSid = '';
  let callSid = '';
  let agent: AgentStateMachine | null = null;
  let transferConfig: TransferConfig | undefined;

  // Audio buffering for STT
  let inboundAudioBuffer = Buffer.alloc(0);
  let silenceFrames = 0;
  let speechFrames = 0;
  let totalMediaFrames = 0;

  // Tuning constants
  const ENERGY_THRESHOLD = 200;          // Minimum RMS energy to count as speech
  const SPEECH_START_FRAMES = 5;         // ~100ms of speech to start recording
  const SILENCE_END_FRAMES = 40;         // ~800ms of silence to end utterance
  const BARGE_IN_FRAMES = 8;             // ~160ms of speech during TTS to trigger barge-in
  const MAX_UTTERANCE_MS = 15000;        // 15s max utterance before forced processing
  const MIN_AUDIO_FOR_STT = 3200;        // ~200ms of audio minimum for STT

  // State
  let isSpeaking = false;
  let abortTTS = false;
  let isProcessing = false;
  let greetingSent = false;
  let greetingComplete = false;
  let utteranceStartTime = 0;
  let utteranceTimer: ReturnType<typeof setTimeout> | null = null;

  logger.info('stream', 'WS opened', { sessionId });

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const msg: TwilioMediaMessage = JSON.parse(data.toString());

      switch (msg.event) {
        case 'connected':
          logger.info('stream', 'Twilio connected', { sessionId });
          break;

        case 'start': {
          streamSid = msg.start?.streamSid || '';
          callSid = msg.start?.callSid || '';
          logger.info('stream', 'Stream started', { sessionId, streamSid, callSid });

          const sessionData = pendingSessions.get(callSid);
          if (sessionData) {
            agent = new AgentStateMachine(sessionData.lead);
            transferConfig = sessionData.transfer;
            pendingSessions.delete(callSid);
            logger.info('stream', 'Session found for callSid', { sessionId, leadName: sessionData.lead.first_name });
            setTimeout(() => sendGreeting(sessionData.lead), 800);
          } else {
            logger.warn('stream', 'No session found, using default', { sessionId, callSid, pendingKeys: [...pendingSessions.keys()] });
            const defaultLead: LeadData = { first_name: 'there' };
            agent = new AgentStateMachine(defaultLead);
            setTimeout(() => sendGreeting(defaultLead), 800);
          }
          break;
        }

        case 'media': {
          if (!msg.media?.payload) break;
          totalMediaFrames++;

          const audioChunk = Buffer.from(msg.media.payload, 'base64');
          const energy = getAudioEnergy(audioChunk);
          const hasSpeech = energy > ENERGY_THRESHOLD;

          // Log energy periodically for debugging
          if (totalMediaFrames % 50 === 0) {
            logger.debug('stream', 'Audio stats', {
              sessionId,
              frame: totalMediaFrames,
              energy: Math.round(energy),
              hasSpeech,
              speechFrames,
              silenceFrames,
              bufferBytes: inboundAudioBuffer.length,
              isSpeaking,
              isProcessing,
              greetingComplete,
            });
          }

          // During greeting playback, only check for barge-in — don't process utterances
          if (isSpeaking) {
            if (hasSpeech) {
              speechFrames++;
              if (speechFrames >= BARGE_IN_FRAMES && greetingComplete) {
                // Only allow barge-in after first greeting is fully played
                logger.info('stream', 'Barge-in detected', { sessionId, energy: Math.round(energy) });
                abortTTS = true;
                sendClearMessage();
                inboundAudioBuffer = Buffer.concat([inboundAudioBuffer, audioChunk]);
              }
            } else {
              speechFrames = 0;
            }
            silenceFrames = 0;
            break;
          }

          // Normal listening mode (agent is not speaking)
          if (hasSpeech) {
            speechFrames++;
            silenceFrames = 0;

            if (speechFrames >= SPEECH_START_FRAMES) {
              // We're recording speech
              inboundAudioBuffer = Buffer.concat([inboundAudioBuffer, audioChunk]);

              // Start utterance timer on first buffered speech
              if (!utteranceStartTime) {
                utteranceStartTime = Date.now();
                startUtteranceTimer();
              }
            }
          } else {
            // Silence
            if (speechFrames >= SPEECH_START_FRAMES && inboundAudioBuffer.length > 0) {
              // We were in speech, now silence
              silenceFrames++;
              inboundAudioBuffer = Buffer.concat([inboundAudioBuffer, audioChunk]);

              if (silenceFrames >= SILENCE_END_FRAMES && !isProcessing) {
                // End of utterance
                logger.info('stream', 'Utterance ended (silence)', {
                  sessionId,
                  bufferBytes: inboundAudioBuffer.length,
                  speechFrames,
                  silenceFrames,
                });
                flushAndProcess();
              }
            } else {
              // Not in speech, reset
              speechFrames = 0;
              silenceFrames = 0;
            }
          }
          break;
        }

        case 'stop':
          logger.info('stream', 'Stream stopped', { sessionId, callSid });
          clearUtteranceTimer();
          break;

        default:
          logger.debug('stream', 'Unknown event', { event: msg.event });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Message processing error', { sessionId, error: errMsg });
    }
  });

  ws.on('close', () => {
    logger.info('stream', 'WS closed', { sessionId, callSid });
    clearUtteranceTimer();
  });

  ws.on('error', (err) => {
    logger.error('stream', 'WS error', { sessionId, error: err.message });
  });

  // --- Helper functions ---

  function startUtteranceTimer(): void {
    clearUtteranceTimer();
    utteranceTimer = setTimeout(() => {
      if (inboundAudioBuffer.length > MIN_AUDIO_FOR_STT && !isProcessing) {
        logger.info('stream', 'Utterance timeout — forcing processing', { sessionId, bufferBytes: inboundAudioBuffer.length });
        flushAndProcess();
      }
    }, MAX_UTTERANCE_MS);
  }

  function clearUtteranceTimer(): void {
    if (utteranceTimer) {
      clearTimeout(utteranceTimer);
      utteranceTimer = null;
    }
  }

  function flushAndProcess(): void {
    const audioToProcess = inboundAudioBuffer;
    inboundAudioBuffer = Buffer.alloc(0);
    speechFrames = 0;
    silenceFrames = 0;
    utteranceStartTime = 0;
    clearUtteranceTimer();
    processUtterance(audioToProcess);
  }

  async function sendGreeting(lead: LeadData): Promise<void> {
    if (greetingSent) return;
    greetingSent = true;

    const greetingText = buildGreetingText(lead);
    logger.info('stream', 'Sending greeting', { sessionId, streamSid, text: greetingText });
    try {
      await speakText(greetingText);
      greetingComplete = true;
      logger.info('stream', 'Greeting complete', { sessionId });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Greeting TTS FAILED', { sessionId, error: errMsg });
      greetingComplete = true; // Allow conversation to continue even if greeting fails
    }
  }

  async function processUtterance(audioBuffer: Buffer): Promise<void> {
    if (!agent || isProcessing) return;
    if (audioBuffer.length < MIN_AUDIO_FOR_STT) {
      logger.debug('stream', 'Audio too short, skipping', { sessionId, bytes: audioBuffer.length });
      return;
    }

    isProcessing = true;
    logger.info('stream', 'Processing utterance', { sessionId, bytes: audioBuffer.length });

    try {
      const transcript = await transcribeAudio(audioBuffer);
      if (!transcript) {
        logger.info('stream', 'Empty transcript, skipping', { sessionId });
        return;
      }

      logger.info('stream', 'User said', { sessionId, transcript });

      const turn: AgentTurn = await agent.processUserInput(transcript);

      logger.info('stream', 'Agent response', {
        sessionId,
        action: turn.action,
        text: turn.text,
        state: agent.getState(),
      });

      if (turn.text) {
        await speakText(turn.text);
      }

      // Resolve transfer target based on routing decision
      const isTransfer = turn.action === 'transfer_allstate' || turn.action === 'transfer_other' || turn.action === 'transfer';
      if (isTransfer && transferConfig) {
        let targetNumber: string | undefined;

        if (turn.action === 'transfer_allstate' && transferConfig.allstate_number) {
          targetNumber = transferConfig.allstate_number;
        } else if (turn.action === 'transfer_other' && transferConfig.non_allstate_number) {
          targetNumber = transferConfig.non_allstate_number;
        } else if (transferConfig.target_number) {
          // Legacy fallback or if specific route number not set
          targetNumber = transferConfig.target_number;
        } else {
          // Use non-allstate as default fallback
          targetNumber = transferConfig.non_allstate_number || transferConfig.allstate_number;
        }

        if (targetNumber) {
          logger.info('stream', 'Executing transfer', { sessionId, route: turn.action, target: targetNumber });
          const success = await executeWarmTransfer(callSid, targetNumber);
          if (!success) {
            const recovery = await agent.processUserInput('[system: transfer failed, line did not connect]');
            if (recovery.text) {
              await speakText(recovery.text);
            }
          }
        } else {
          logger.error('stream', 'No transfer number configured', { sessionId, route: turn.action });
        }
      } else if (turn.action === 'end') {
        logger.info('stream', 'Call ending', { sessionId });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'Utterance processing error', { sessionId, error: errMsg });
    } finally {
      isProcessing = false;
    }
  }

  async function speakText(text: string): Promise<void> {
    isSpeaking = true;
    abortTTS = false;
    speechFrames = 0; // Reset so barge-in detection starts fresh

    try {
      logger.info('stream', 'TTS starting', { sessionId, textLength: text.length });
      const ttsStream = streamTTS(text);

      for await (const chunk of ttsStream) {
        if (abortTTS) {
          logger.info('stream', 'TTS aborted by barge-in', { sessionId });
          break;
        }

        sendAudioToTwilio(chunk);

        // Yield to event loop so barge-in detection can run
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      if (!abortTTS) {
        logger.info('stream', 'TTS finished normally', { sessionId });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('stream', 'TTS error', { sessionId, error: errMsg });
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

    const message = JSON.stringify({
      event: 'clear',
      streamSid,
    });
    ws.send(message);
    logger.debug('stream', 'Sent clear to Twilio', { sessionId });
  }
}
