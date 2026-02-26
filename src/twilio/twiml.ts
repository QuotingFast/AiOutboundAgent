import { config } from '../config';

// Build raw TwiML strings to avoid version-specific API issues with the Twilio helper lib

export function buildMediaStreamTwiml(direction: 'outbound' | 'inbound' = 'outbound', callerNumber?: string): string {
  const wsUrl = config.baseUrl.replace(/^http/, 'ws') + '/twilio/stream';

  const params = [
    `      <Parameter name="direction" value="${direction}" />`,
  ];
  if (callerNumber) {
    params.push(`      <Parameter name="callerNumber" value="${escapeXml(callerNumber)}" />`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
${params.join('\n')}
    </Stream>
  </Connect>
</Response>`;
}

export function buildTransferTwiml(targetNumber: string, bridgePhrase: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${escapeXml(bridgePhrase)}</Say>
  <Dial timeout="40" callerId="${escapeXml(config.twilio.fromNumber)}">
    <Number>${escapeXml(targetNumber)}</Number>
  </Dial>
  <Say voice="Polly.Matthew">It looks like the line didn't connect. We'll try to reach you again shortly. Goodbye.</Say>
</Response>`;
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
