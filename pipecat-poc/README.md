# Pipecat POC — Smart Turn v3 voice bot

A **standalone Python service** (separate from the Node `AiOutboundAgent` app)
used to evaluate [Pipecat](https://github.com/pipecat-ai/pipecat) and its
**Smart Turn v3** semantic end-of-turn model on a single test number, over the
existing Twilio Media Streams protocol.

It does **not** replace or modify the production Node pipeline. Only calls
explicitly placed through this service's `/call` endpoint use it.

## Pipeline

```
Twilio Media Streams (8k mulaw)
   → Silero VAD + Smart Turn v3 (turn taking / barge-in)
   → Deepgram STT
   → OpenAI LLM (gpt-4o-mini)
   → Deepgram Aura-2 TTS
   → back to Twilio
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/call` | Place an outbound test call. Body: `{"to":"+1...","name":"Tom"}` |
| POST | `/twiml` | Twilio answer webhook → `<Connect><Stream>` |
| WS | `/ws` | Twilio media stream → Pipecat pipeline |
| GET | `/health` | Health check |

## Run locally

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in keys + BASE_URL (ngrok/host)
python server.py
```

## Deploy (Render, Docker)

Deployed as its own Render web service with `rootDir: pipecat-poc` and the
included `Dockerfile`. Set the env vars from `.env.example` in the Render
dashboard, and set `BASE_URL` to the service's public URL.

## Placing a test call

```bash
curl -X POST https://<this-service>/call \
  -H "Content-Type: application/json" \
  -d '{"to":"+15555550123","name":"Tom"}'
```
