/**
 * AudioSocket TCP server for Asterisk / VICIdial integration.
 *
 * Asterisk's AudioSocket application connects via TCP and streams raw audio
 * using a simple frame protocol:
 *   [type: 1 byte] [length: 2 bytes big-endian] [payload: length bytes]
 *
 * Frame types:
 *   0x00  UUID   — 16-byte raw UUID identifying the session
 *   0x01  Hangup — connection is ending (no payload or zero-length)
 *   0x02  Error  — error message (UTF-8 payload)
 *   0x10  Audio  — signed-linear 16-bit 8 kHz mono PCM
 *
 * This module wraps each TCP connection in a WebSocket-compatible adapter
 * so the existing handleMediaStream() pipeline works unchanged.
 */

import net from 'net';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { slin16ToMulaw, mulawToSlin16 } from './codec';
import { getAudioSocketSession, updateAudioSocketSession } from './sessions';
import { handleMediaStream } from '../audio/stream';
import { logger } from '../utils/logger';

// ── AudioSocket frame constants ──────────────────────────────────────────
const FRAME_TYPE_UUID = 0x00;
const FRAME_TYPE_HANGUP = 0x01;
const FRAME_TYPE_ERROR = 0x02;
const FRAME_TYPE_AUDIO = 0x10;

const FRAME_HEADER_SIZE = 3; // 1 byte type + 2 bytes length

// ── WebSocket-compatible adapter ─────────────────────────────────────────

/**
 * Wraps a raw TCP socket carrying the AudioSocket protocol and exposes
 * the subset of the WebSocket API that handleMediaStream() relies on:
 *   - .readyState
 *   - .send(jsonString)
 *   - .on('message' | 'close' | 'error', cb)
 */
class AudioSocketAdapter extends EventEmitter {
  readyState: number = WebSocket.OPEN;

  private socket: net.Socket;
  private sessionUuid = '';
  private streamSid = '';
  private callSid = '';
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    this.streamSid = 'AS-' + uuidv4().slice(0, 12);
    this.callSid = 'AS-' + uuidv4().slice(0, 12);

    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', (err: Error) => this.onError(err));
  }

  /**
   * Receives JSON strings from handleMediaStream and translates them
   * into AudioSocket frames sent back over the TCP socket.
   */
  send(data: string): void {
    if (this.closed) return;
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'media' && msg.media?.payload) {
        // Decode mulaw from base64, convert to slin16, wrap in AudioSocket frame
        const mulaw = Buffer.from(msg.media.payload, 'base64');
        const slin = mulawToSlin16(mulaw);
        this.sendAudioFrame(slin);
      }
      // 'clear' events have no AudioSocket equivalent — just discard.
    } catch {
      // Non-JSON or unrecognized — ignore
    }
  }

  /**
   * Explicitly close the connection (called when the AI ends the call).
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    // Send a hangup frame before closing
    try {
      const frame = Buffer.alloc(FRAME_HEADER_SIZE);
      frame.writeUInt8(FRAME_TYPE_HANGUP, 0);
      frame.writeUInt16BE(0, 1);
      this.socket.write(frame);
    } catch { /* ignore write-after-close */ }
    this.socket.end();
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drainFrames();
  }

  private drainFrames(): void {
    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      const type = this.buffer.readUInt8(0);
      const length = this.buffer.readUInt16BE(1);
      const totalFrameSize = FRAME_HEADER_SIZE + length;
      if (this.buffer.length < totalFrameSize) break; // wait for more data

      const payload = this.buffer.subarray(FRAME_HEADER_SIZE, totalFrameSize);
      this.buffer = this.buffer.subarray(totalFrameSize);

      this.handleFrame(type, payload);
    }
  }

  private handleFrame(type: number, payload: Buffer): void {
    switch (type) {
      case FRAME_TYPE_UUID: {
        // Parse the 16-byte UUID
        const hex = payload.toString('hex');
        this.sessionUuid = [
          hex.slice(0, 8),
          hex.slice(8, 12),
          hex.slice(12, 16),
          hex.slice(16, 20),
          hex.slice(20),
        ].join('-');
        this.callSid = 'AS-' + this.sessionUuid.slice(0, 12);
        logger.info('audiosocket', 'Received UUID', { uuid: this.sessionUuid, callSid: this.callSid });

        // Resolve session data and emit the synthetic Twilio 'start' event
        this.emitStart();
        break;
      }

      case FRAME_TYPE_HANGUP:
        logger.info('audiosocket', 'Received hangup frame', { callSid: this.callSid });
        this.onClose();
        break;

      case FRAME_TYPE_ERROR:
        logger.error('audiosocket', 'Received error frame', {
          callSid: this.callSid,
          message: payload.toString('utf-8'),
        });
        break;

      case FRAME_TYPE_AUDIO: {
        if (payload.length === 0) break;
        // Convert slin16 → mulaw → base64 and emit as Twilio-style media event
        const mulaw = slin16ToMulaw(payload);
        const b64 = mulaw.toString('base64');
        const msg = JSON.stringify({
          event: 'media',
          media: { payload: b64 },
        });
        this.emit('message', msg);
        break;
      }

      default:
        logger.debug('audiosocket', `Unknown frame type 0x${type.toString(16)}`, { callSid: this.callSid });
    }
  }

  private emitStart(): void {
    const session = getAudioSocketSession(this.sessionUuid);

    // Build custom parameters from session data (mirrors Twilio's customParameters)
    const customParameters: Record<string, string> = {
      direction: session?.direction || 'outbound',
      callerNumber: session?.callerNumber || '',
      campaignId: session?.campaignId || '',
      leadFirstName: session?.leadFirstName || 'there',
      leadState: session?.leadState || '',
      leadCurrentInsurer: session?.leadCurrentInsurer || '',
      leadVehicleYear: session?.leadVehicleYear || '',
      leadVehicleMake: session?.leadVehicleMake || '',
      leadVehicleModel: session?.leadVehicleModel || '',
    };

    // First emit 'connected'
    this.emit('message', JSON.stringify({ event: 'connected' }));

    // Then emit 'start' with session context
    this.emit('message', JSON.stringify({
      event: 'start',
      start: {
        streamSid: this.streamSid,
        callSid: this.callSid,
        customParameters,
      },
    }));
  }

  private sendAudioFrame(slinData: Buffer): void {
    if (this.closed || this.socket.destroyed) return;
    const header = Buffer.alloc(FRAME_HEADER_SIZE);
    header.writeUInt8(FRAME_TYPE_AUDIO, 0);
    header.writeUInt16BE(slinData.length, 1);
    this.socket.write(Buffer.concat([header, slinData]));
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = WebSocket.CLOSED;

    // Emit the Twilio-style 'stop' event
    this.emit('message', JSON.stringify({ event: 'stop' }));
    this.emit('close');
    this.socket.destroy();
  }

  private onError(err: Error): void {
    logger.error('audiosocket', 'TCP socket error', { callSid: this.callSid, error: err.message });
    this.emit('error', err);
    this.onClose();
  }

  /** Expose the session UUID so callers can update session outcome. */
  getSessionUuid(): string {
    return this.sessionUuid;
  }
}

// ── TCP server ───────────────────────────────────────────────────────────

let server: net.Server | null = null;

/**
 * Start the AudioSocket TCP server.
 * @param port TCP port to listen on (default 9092)
 * @param host Bind address (default 0.0.0.0)
 */
export function startAudioSocketServer(port = 9092, host = '0.0.0.0'): net.Server {
  server = net.createServer((socket: net.Socket) => {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    logger.info('audiosocket', `New TCP connection from ${remoteAddr}`);

    // Keepalive to detect dead peers
    socket.setKeepAlive(true, 30000);
    socket.setNoDelay(true);

    // Wrap the TCP socket in our WebSocket-compatible adapter
    const adapter = new AudioSocketAdapter(socket);

    // Feed it into the existing media stream pipeline
    handleMediaStream(adapter as unknown as WebSocket);
  });

  server.on('error', (err: Error) => {
    logger.error('audiosocket', 'Server error', { error: err.message });
  });

  server.listen(port, host, () => {
    logger.info('audiosocket', `AudioSocket server listening on ${host}:${port}`);
  });

  return server;
}

/**
 * Stop the AudioSocket server gracefully.
 */
export function stopAudioSocketServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
