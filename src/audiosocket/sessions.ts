/**
 * AudioSocket session registry.
 *
 * Before connecting via AudioSocket, the AGI script (or any client) calls
 *   POST /audiosocket/session
 * with lead data and receives back a UUID.  The AGI then passes that UUID
 * to Asterisk's AudioSocket() application.  When the TCP connection arrives,
 * the server looks up the UUID here to resolve lead context.
 */

import { v4 as uuidv4 } from 'uuid';

export interface AudioSocketSessionData {
  leadFirstName: string;
  leadState?: string;
  leadCurrentInsurer?: string;
  leadVehicleYear?: string;
  leadVehicleMake?: string;
  leadVehicleModel?: string;
  campaignId?: string;
  direction?: 'outbound' | 'inbound';
  callerNumber?: string;
  /** Arbitrary metadata the AGI wants to pass through */
  meta?: Record<string, string>;
  /** When this session was registered */
  createdAt: number;
  /** Outcome set by the AI when the AudioSocket closes */
  outcome?: 'transfer' | 'hangup' | 'callback' | 'voicemail';
  /** Transfer target (for AGI to read back after disconnect) */
  transferTarget?: string;
}

const sessions = new Map<string, AudioSocketSessionData>();

// Auto-expire sessions after 5 minutes to prevent leaks
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Register a new AudioSocket session. Returns the UUID to pass to Asterisk.
 */
export function createAudioSocketSession(data: Omit<AudioSocketSessionData, 'createdAt'>): string {
  const uuid = uuidv4();
  sessions.set(uuid, { ...data, createdAt: Date.now() });

  // Auto-cleanup
  setTimeout(() => {
    sessions.delete(uuid);
  }, SESSION_TTL_MS);

  return uuid;
}

/**
 * Look up (and optionally consume) session data by UUID.
 */
export function getAudioSocketSession(uuid: string): AudioSocketSessionData | undefined {
  return sessions.get(uuid);
}

/**
 * Update session with outcome data (called by AI service when call ends).
 */
export function updateAudioSocketSession(uuid: string, updates: Partial<AudioSocketSessionData>): void {
  const existing = sessions.get(uuid);
  if (existing) {
    Object.assign(existing, updates);
  }
}

/**
 * Remove a session.
 */
export function deleteAudioSocketSession(uuid: string): void {
  sessions.delete(uuid);
}
