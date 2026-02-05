# AI Outbound Agent — Realtime Voice Caller

Standalone realtime voice agent service for outbound insurance calls. Handles Twilio outbound dialing, streaming audio via WebSocket, speech-to-text, AI conversation, text-to-speech, barge-in (interruption), and warm transfer.

## Architecture

```
POST /call/start  ──>  Twilio REST API  ──>  Outbound call
                                                  │
                                          Call answered
                                                  │
                                          POST /twilio/voice
                                          (returns TwiML with <Stream>)
                                                  │
                                          WS /twilio/stream
                                          ┌───────┴───────┐
                                     Inbound audio    Outbound audio
                                          │                 │
                                     STT (Whisper)    TTS (ElevenLabs/OpenAI)
                                          │                 │
                                     Agent State Machine ───┘
                                          │
                                     [TRANSFER_NOW] ──> Twilio warm transfer
```

## Prerequisites

- Node.js 20+
- Twilio account with a phone number
- OpenAI API key
- ElevenLabs API key + voice ID (if using ElevenLabs TTS)
- A public URL (ngrok, localtunnel, or deployed host)

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all values. See the Environment Variables section below.

### 3. Expose your local server

Use ngrok to get a public URL:

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`) and set it as `BASE_URL` in your `.env`.

Alternatively, use localtunnel:

```bash
npx localtunnel --port 3000
```

### 4. Start the server

Development (with ts-node):
```bash
npm run dev
```

Production (build + run):
```bash
npm run build
npm start
```

### 5. Run the smoke test

```bash
npm run smoke
# or
node scripts/smoke.js http://localhost:3000
```

## Twilio Console Configuration

You do **not** need to set voice webhook URLs in the Twilio console for outbound calls. The `/call/start` endpoint programmatically tells Twilio which webhook URL to hit when the call connects.

However, if you want to also receive inbound calls:

1. Go to Twilio Console > Phone Numbers > Your number
2. Set Voice "A call comes in" webhook to: `https://YOUR_BASE_URL/twilio/voice`
3. Method: POST

## Making a Test Call

```bash
curl -X POST http://localhost:3000/call/start \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "from": "+15559876543",
    "lead": {
      "first_name": "Tom",
      "state": "FL",
      "current_insurer": "GEICO",
      "insured": true
    },
    "transfer": {
      "mode": "warm",
      "target_number": "+15550001111"
    }
  }'
```

Response:
```json
{
  "call_sid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "initiated"
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/call/start` | Start an outbound call |
| POST | `/twilio/voice` | Twilio webhook (returns TwiML) |
| POST | `/twilio/transfer` | Transfer TwiML endpoint |
| POST | `/twilio/status` | Call status callbacks |
| WS | `/twilio/stream` | Twilio Media Stream WebSocket |
| GET | `/health` | Health check |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `BASE_URL` | Yes | — | Public URL of this service |
| `TWILIO_ACCOUNT_SID` | Yes | — | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | — | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | No | — | Default caller ID (can also pass per-call) |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key (used for STT + agent reasoning) |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model for conversation |
| `ELEVENLABS_API_KEY` | Conditional | — | Required if `TTS_PROVIDER=elevenlabs` |
| `ELEVENLABS_VOICE_ID` | Conditional | — | Required if `TTS_PROVIDER=elevenlabs` |
| `TTS_PROVIDER` | No | `elevenlabs` | `elevenlabs` or `openai` |
| `STT_PROVIDER` | No | `openai` | `openai` (Whisper) |
| `DEBUG` | No | `false` | Enable verbose logging |

## How It Works

### Call Flow

1. **`POST /call/start`** — Your system sends lead data. The service calls Twilio's REST API to place an outbound call, pointing the answer webhook at `/twilio/voice`.

2. **`POST /twilio/voice`** — When the prospect picks up, Twilio hits this webhook. It returns TwiML with `<Connect><Stream>` which opens a bidirectional WebSocket at `/twilio/stream`.

3. **`WS /twilio/stream`** — Twilio streams raw audio (mulaw 8kHz) in both directions. The service:
   - Buffers inbound audio and runs VAD (voice activity detection via energy threshold)
   - When an utterance ends (silence after speech), sends audio to OpenAI Whisper for transcription
   - Feeds the transcript into the agent state machine (GPT-4o)
   - Streams the agent's response through TTS (ElevenLabs or OpenAI)
   - Sends the TTS audio back to Twilio in real-time

### Barge-In

If the prospect speaks while the agent is talking:
- The energy detector flags inbound speech
- The TTS stream is immediately aborted
- A `clear` event is sent to Twilio to flush its audio buffer
- The prospect's speech is captured and processed normally

### Warm Transfer

When the agent decides to transfer:
1. The agent says a bridging phrase ("Connecting you now...")
2. The service calls `twilioClient.calls(callSid).update()` to redirect the call to a new TwiML URL
3. That TwiML uses `<Dial>` to connect to the target number
4. If the dial fails, a fallback message plays

## Docker

```bash
docker build -t ai-outbound-agent .
docker run -p 3000:3000 --env-file .env ai-outbound-agent
```

## Deploy to Render

1. Push this repo to GitHub
2. Connect to Render
3. The `render.yaml` will auto-configure the service
4. Set environment variables in the Render dashboard
5. Set `BASE_URL` to your Render service URL

## Project Structure

```
src/
  config/index.ts        — Environment variable loading
  server/
    index.ts             — Express + WebSocket server setup
    routes.ts            — HTTP route handlers
  twilio/
    client.ts            — Twilio REST API client
    twiml.ts             — TwiML generation
    transfer.ts          — Warm transfer logic
  audio/
    stream.ts            — WebSocket media stream handler + barge-in
    stt-openai.ts        — OpenAI Whisper transcription
    tts-elevenlabs.ts    — ElevenLabs TTS streaming
    tts-openai.ts        — OpenAI TTS streaming
    tts-router.ts        — TTS provider router
  agent/
    state-machine.ts     — Conversation state machine (GPT-4o)
    prompts.ts           — System prompts + greeting text
  utils/
    logger.ts            — Structured JSON logger
  index.ts               — Entry point
scripts/
  smoke.js               — Smoke test script
```
