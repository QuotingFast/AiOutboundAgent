import { logger } from '../utils/logger';
import { resolveFeatureFlag, FEATURE_WARM_HANDOFF } from './flags';
import { config } from '../config';

// ── FEATURE_WARM_HANDOFF ───────────────────────────────────────────
// When enabled, transfer flow becomes:
//   1) Call the agent first
//   2) Play a private whisper summary to the agent
//   3) Bridge the prospect only after the agent answers
// Preserves existing routing and fallback logic.

export interface WhisperContent {
  leadName: string;
  keyQualifications: string[];
  transferReason: string;
}

/**
 * Build the whisper text that is played to the agent before bridging.
 */
export function buildWhisperText(content: WhisperContent): string {
  const quals = content.keyQualifications.length > 0
    ? content.keyQualifications.join('. ')
    : 'No qualifications captured';

  return `Incoming transfer. Lead name: ${content.leadName}. ${quals}. Transfer reason: ${content.transferReason}. Press any key to accept.`;
}

/**
 * Build TwiML for the enhanced warm handoff.
 * When the feature is enabled, this replaces the simple Dial TwiML.
 * Flow:
 *   1) <Dial> calls the agent with a whisper URL
 *   2) Agent hears the whisper (via <Gather> + <Say>)
 *   3) If agent presses a key, the prospect is bridged in
 *   4) If agent doesn't answer, fallback message plays for the prospect
 */
export function buildWarmHandoffTwiml(
  targetNumber: string,
  whisperContent: WhisperContent,
  workspaceId?: string,
  campaignId?: string,
): string {
  // If feature is not enabled, fall back to simple transfer TwiML
  if (!resolveFeatureFlag(FEATURE_WARM_HANDOFF, workspaceId, campaignId)) {
    return buildSimpleTransferTwiml(targetNumber);
  }

  const whisperText = buildWhisperText(whisperContent);
  const whisperUrl = `${config.baseUrl}/twilio/warm-handoff-whisper?whisper=${encodeURIComponent(whisperText)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" callerId="${escapeXml(config.twilio.fromNumber)}" action="${escapeXml(config.baseUrl)}/twilio/warm-handoff-status">
    <Number url="${escapeXml(whisperUrl)}" method="POST">${escapeXml(targetNumber)}</Number>
  </Dial>
  <Say voice="Polly.Matthew">It looks like the line didn't connect. We'll try to reach you again shortly. Goodbye.</Say>
</Response>`;
}

/**
 * Build TwiML for the whisper played to the agent when they pick up.
 * The agent hears the lead summary and presses any key to accept.
 */
export function buildWhisperTwiml(whisperText: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${escapeXml(config.baseUrl)}/twilio/warm-handoff-accept" method="POST">
    <Say voice="Polly.Matthew">${escapeXml(whisperText)}</Say>
  </Gather>
  <Say voice="Polly.Matthew">No response received. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

/**
 * Build TwiML for after the agent accepts (presses a key).
 * This simply returns empty Response to proceed with the bridge.
 */
export function buildAcceptTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`;
}

/**
 * Simple transfer TwiML — used when FEATURE_WARM_HANDOFF is disabled.
 * This preserves existing behavior exactly.
 */
function buildSimpleTransferTwiml(targetNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Connecting you now — one moment please.</Say>
  <Dial timeout="30" callerId="${escapeXml(config.twilio.fromNumber)}">
    <Number>${escapeXml(targetNumber)}</Number>
  </Dial>
  <Say voice="Polly.Matthew">It looks like the line didn't connect. We'll try to reach you again shortly. Goodbye.</Say>
</Response>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
