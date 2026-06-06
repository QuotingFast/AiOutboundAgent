"""
Pipecat POC voice bot — Twilio Media Streams + Smart Turn v3.

A standalone Python service (separate from the Node app) used to evaluate
Pipecat's semantic end-of-turn detection on a single test number, over the
existing Twilio Media Streams protocol. It does NOT modify the production
Node pipeline.

  - POST /call    place an outbound Twilio call whose answer webhook is /twiml
  - POST /twiml   return TwiML <Connect><Stream> pointing at /ws
  - WS   /ws      run the Pipecat pipeline over Twilio Media Streams
  - GET  /health  health check

Pipeline (Pipecat 1.3.0):
  Twilio(8k mulaw) -> VAD (Silero) -> Deepgram STT -> OpenAI LLM
                   -> Deepgram Aura-2 TTS -> Twilio
  User turn-taking: Smart Turn v3 (the default user-turn-stop strategy in
  Pipecat 1.3.0) + VAD/transcription start strategies -> human-like, semantic
  end-of-turn detection and barge-in.
"""

import json
import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from loguru import logger
from twilio.rest import Client as TwilioClient

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

load_dotenv()

PORT = int(os.getenv("PORT", "8080"))
BASE_URL = os.getenv("BASE_URL", "").rstrip("/")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DEEPGRAM_VOICE = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-arcas-en")
AGENT_NAME = os.getenv("AGENT_NAME", "Steve")
COMPANY_NAME = os.getenv("COMPANY_NAME", "Smart Quotes")

SYSTEM_PROMPT = (
    f"You are {AGENT_NAME}, a friendly auto-insurance agent at {COMPANY_NAME}. "
    "You are on a phone call. Keep replies to ONE short sentence, occasionally two — "
    "never three. Sound natural and human, not scripted. Your goal: confirm the person "
    "requested an auto-insurance quote, ask a couple of quick qualifying questions "
    "(current carrier, how long, number of vehicles), and offer to connect them to a "
    "licensed agent. Never say you are an AI. If they're not interested, thank them warmly "
    "and end the call. Your output is spoken aloud over the phone, so do not use lists, "
    "markdown, or special characters."
)

app = FastAPI()

twilio_rest = (
    TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN
    else None
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "pipecat-poc",
        "base_url": BASE_URL,
        "model": OPENAI_MODEL,
        "voice": DEEPGRAM_VOICE,
        "turn": "smart-turn-v3",
        "ready": bool(OPENAI_API_KEY and DEEPGRAM_API_KEY),
    }


def _host(request: Request) -> str:
    """Public hostname of this service. Prefer the inbound request host (works
    on Render without any config); fall back to BASE_URL if set."""
    h = request.headers.get("host") or request.url.hostname or ""
    if h:
        return h
    return BASE_URL.replace("https://", "").replace("http://", "")


@app.post("/twiml")
async def twiml(request: Request):
    """Answer webhook: connect the call's audio to our /ws media stream."""
    host = _host(request)
    lead_name = request.query_params.get("name", "there")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="wss://{host}/ws">'
        f'<Parameter name="leadName" value="{lead_name}"/>'
        "</Stream>"
        "</Connect></Response>"
    )
    return Response(content=xml, media_type="application/xml")


@app.post("/call")
async def place_call(request: Request):
    """Place an outbound test call. Body: {"to": "+1...", "name": "Tom"}."""
    if not twilio_rest:
        return JSONResponse({"error": "Twilio not configured"}, status_code=500)
    body = await request.json()
    to = body.get("to")
    name = body.get("name", "there")
    if not to:
        return JSONResponse({"error": "missing 'to'"}, status_code=400)

    answer_url = f"https://{_host(request)}/twiml?name={name}"
    call = twilio_rest.calls.create(
        to=to,
        from_=TWILIO_FROM_NUMBER,
        url=answer_url,
        method="POST",
    )
    logger.info(f"Placed POC call sid={call.sid} to={to} answer_url={answer_url}")
    return {"call_sid": call.sid, "status": call.status, "answer_url": answer_url}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # Twilio sends 'connected' then 'start' before media frames.
    stream = websocket.iter_text()
    await stream.__anext__()  # 'connected'
    start = json.loads(await stream.__anext__())  # 'start'
    stream_sid = start["start"]["streamSid"]
    call_sid = start["start"]["callSid"]
    params = start["start"].get("customParameters", {}) or {}
    lead_name = params.get("leadName", "there")
    logger.info(f"WS start stream_sid={stream_sid} call_sid={call_sid} lead={lead_name}")

    serializer = TwilioFrameSerializer(
        stream_sid=stream_sid,
        call_sid=call_sid,
        account_sid=TWILIO_ACCOUNT_SID,
        auth_token=TWILIO_AUTH_TOKEN,
    )

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
        ),
    )

    stt = DeepgramSTTService(api_key=DEEPGRAM_API_KEY)
    llm = OpenAILLMService(api_key=OPENAI_API_KEY, model=OPENAI_MODEL)
    tts = DeepgramTTSService(api_key=DEEPGRAM_API_KEY, voice=DEEPGRAM_VOICE, sample_rate=8000)

    # VADProcessor feeds the default user-turn-start strategy; Smart Turn v3 is
    # the default user-turn-stop strategy in the context aggregator pair.
    vad = VADProcessor(vad_analyzer=SileroVADAnalyzer())

    context = LLMContext([{"role": "system", "content": SYSTEM_PROMPT}])
    aggregators = LLMContextAggregatorPair(context)

    pipeline = Pipeline(
        [
            transport.input(),
            vad,
            stt,
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
            allow_interruptions=True,
            enable_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        # Greet immediately (outbound) — this is a test number.
        context.add_message(
            {
                "role": "system",
                "content": (
                    f"The call just connected. Greet {lead_name} now in one sentence, "
                    f'starting with: "Hey {lead_name}, it\'s {AGENT_NAME} over at '
                    f'{COMPANY_NAME} — you put in a car insurance quote request recently, right?"'
                ),
            }
        )
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        await task.queue_frames([EndFrame()])

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
