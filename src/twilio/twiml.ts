import { config } from '../config';

// Build raw TwiML strings to avoid version-specific API issues with the Twilio helper lib

export function buildMediaStreamTwiml(): string {
  const wsUrl = config.baseUrl.replace(/^http/, 'ws') + '/twilio/stream';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="direction" value="outbound" />
    </Stream>
  </Connect>
</Response>`;
}

export function buildTransferTwiml(targetNumber: string, bridgePhrase: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${escapeXml(bridgePhrase)}</Say>
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
