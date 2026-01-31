#!/usr/bin/env node

/**
 * Smoke test for the AI Outbound Agent service.
 *
 * Usage:
 *   node scripts/smoke.js [BASE_URL]
 *
 * If BASE_URL is not provided, defaults to http://localhost:3000
 */

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  console.log(`Smoke testing against: ${BASE}\n`);

  // 1) Health check
  console.log('--- Health Check ---');
  try {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json();
    console.log(`  Status: ${res.status}`);
    console.log(`  Body:   ${JSON.stringify(body)}`);
    if (res.status !== 200 || body.status !== 'ok') {
      throw new Error('Health check failed');
    }
    console.log('  PASS\n');
  } catch (err) {
    console.error(`  FAIL: ${err.message}\n`);
    process.exit(1);
  }

  // 2) POST /call/start — validation (should fail with 400 if no "to" field)
  console.log('--- POST /call/start (missing "to") ---');
  try {
    const res = await fetch(`${BASE}/call/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead: { first_name: 'Test' } }),
    });
    const body = await res.json();
    console.log(`  Status: ${res.status}`);
    console.log(`  Body:   ${JSON.stringify(body)}`);
    if (res.status === 400) {
      console.log('  PASS (correctly rejected)\n');
    } else {
      console.log('  WARN: Expected 400, got ' + res.status + '\n');
    }
  } catch (err) {
    console.error(`  FAIL: ${err.message}\n`);
  }

  // 3) POST /twilio/voice — should return TwiML
  console.log('--- POST /twilio/voice ---');
  try {
    const res = await fetch(`${BASE}/twilio/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'CallSid=CAtesttest&From=%2B15551234567',
    });
    const body = await res.text();
    console.log(`  Status: ${res.status}`);
    console.log(`  Content-Type: ${res.headers.get('content-type')}`);
    console.log(`  Body (first 200 chars): ${body.substring(0, 200)}`);
    if (res.status === 200 && body.includes('<Response>') && body.includes('<Stream')) {
      console.log('  PASS\n');
    } else {
      console.log('  FAIL: TwiML not as expected\n');
    }
  } catch (err) {
    console.error(`  FAIL: ${err.message}\n`);
  }

  // 4) Check WebSocket endpoint is listening
  console.log('--- WebSocket /twilio/stream ---');
  const wsUrl = BASE.replace(/^http/, 'ws') + '/twilio/stream';
  console.log(`  URL: ${wsUrl}`);
  try {
    // Use dynamic import for environments that might not have ws
    const { WebSocket: WS } = await import('ws');
    const ws = new WS(wsUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timed out'));
      }, 5000);
      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('  Connected successfully');
        ws.close();
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    console.log('  PASS\n');
  } catch (err) {
    console.error(`  FAIL: ${err.message}\n`);
  }

  console.log('Smoke test complete.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
