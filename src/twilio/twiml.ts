import { config } from '../config';

// Build raw TwiML strings to avoid version-specific API issues with the Twilio helper lib

export function buildMediaStreamTwiml(
  direction: 'outbound' | 'inbound' = 'outbound',
  callerNumber?: string,
  extraParams?: Record<string, string | undefined>,
): string {
  const wsUrl = config.baseUrl.replace(/^http/, 'ws') + '/twilio/stream';

  const params = [
    `      <Parameter name="direction" value="${direction}" />`,
  ];
  if (callerNumber) {
    params.push(`      <Parameter name="callerNumber" value="${escapeXml(callerNumber)}" />`);
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v && String(v).trim().length > 0) {
        params.push(`      <Parameter name="${escapeXml(k)}" value="${escapeXml(String(v))}" />`);
      }
    }
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

export function buildTransferTwiml(
  targetNumber: string,
  bridgePhrase: string,
  whisperUrl?: string,
): string {
  const numberAttrs = whisperUrl ? ` url="${escapeXml(whisperUrl)}" method="POST"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${escapeXml(bridgePhrase)}</Say>
  <Dial timeout="40" callerId="${escapeXml(config.twilio.fromNumber)}" answerOnBridge="true">
    <Number${numberAttrs}>${escapeXml(targetNumber)}</Number>
  </Dial>
  <Say voice="Polly.Matthew">It looks like the line didn't connect. We'll try to reach you again shortly. Goodbye.</Say>
</Response>`;
}

export function buildTransferWhisperTwiml(briefing: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Matthew">${escapeXml(briefing)}</Say>
</Response>`;
}

export function buildConferenceProspectTwiml(confName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference startConferenceOnEnter="false" endConferenceOnExit="false" beep="false">${escapeXml(confName)}</Conference>
  </Dial>
  <Say voice="Polly.Matthew">We were unable to connect you with an agent. Someone will reach out to you shortly. Goodbye.</Say>
</Response>`;
}

export function buildAgentIntroTwiml(
  confName: string,
  firstname: string,
  carrier: string,
  years: string,
  vehicleCount: string,
): string {
  const yearsPhrase = years ? ` for ${escapeXml(years)} year${years === '1' ? '' : 's'}` : '';
  const intro = `Hi, I have ${escapeXml(firstname)} on the line. They've been with ${escapeXml(carrier)}${yearsPhrase} and have ${escapeXml(vehicleCount)} vehicle${vehicleCount === '1' ? '' : 's'} they'd like a quote for. Thanks!`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${intro}</Say>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">${escapeXml(confName)}</Conference>
  </Dial>
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
