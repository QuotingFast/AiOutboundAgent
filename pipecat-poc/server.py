"""
Pipecat POC voice bot — Twilio Media Streams + Smart Turn v3 + tools.

A standalone Python service (separate from the Node app) to evaluate Pipecat's
semantic end-of-turn detection on a single test number, over Twilio Media
Streams. It does NOT modify the production Node pipeline.

  - POST /call    place an outbound Twilio call whose answer webhook is /twiml
  - POST /twiml   return TwiML <Connect><Stream> pointing at /ws
  - WS   /ws      run the Pipecat pipeline over Twilio Media Streams
  - GET  /health  health check

Pipeline (Pipecat 1.3.0):
  Twilio(8k mulaw) -> Silero VAD -> Deepgram STT -> OpenAI LLM (+tools)
                   -> Deepgram Aura-2 TTS -> Twilio
  Turn-taking: Smart Turn v3 (the 1.3.0 default user-turn-stop strategy).

Tools (real actions):
  transfer_call     -> redirect the live Twilio call to a licensed agent (<Dial>)
  schedule_callback -> record a callback request in the production system
  send_text         -> SMS the scheduling link to the caller's number
  end_call          -> say goodbye and hang up the Twilio call
"""

import asyncio
import datetime
import json
import os
import urllib.request

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from loguru import logger
from twilio.rest import Client as TwilioClient

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import EndFrame, LLMRunFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.llm_service import FunctionCallParams, FunctionCallResultProperties
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

load_dotenv()

PORT = int(os.getenv("PORT", "8080"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DEEPGRAM_VOICE = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-apollo-en")
AGENT_NAME = os.getenv("AGENT_NAME", "Steve")
COMPANY_NAME = os.getenv("COMPANY_NAME", "Smart Quotes")
TRANSFER_NUMBER = os.getenv("TRANSFER_NUMBER", "9548182888")
SCHEDULE_LINK = os.getenv("SCHEDULE_LINK", "https://quotingfast.com/schedule")
# Production Node service — used to record scheduled callbacks in the real system.
NODE_API = os.getenv("NODE_API", "https://ai-outbound-agent-florida.onrender.com")

SYSTEM_PROMPT = (
    f"You are {AGENT_NAME}, a friendly auto-insurance agent at {COMPANY_NAME}. "
    "You are on a phone call. Keep replies to ONE short sentence, occasionally two — "
    "never three. Sound natural and human, not scripted; never say you are an AI. "
    "Goal: confirm the person requested an auto-insurance quote, ask a couple of quick "
    "qualifying questions (current carrier, how long, number of vehicles), then offer to "
    "connect them to a licensed agent.\n\n"
    "Use your tools to take real action — do NOT just say you will do something:\n"
    "- When the caller agrees to be connected/transferred, call the transfer_call function. "
    "Say one short bridge line like 'Perfect, connecting you now' and the transfer happens automatically. "
    "After calling transfer_call, do NOT call any other tool — the hand-off is automatic.\n"
    "- If the caller would rather be called back later, call schedule_callback with their preferred time.\n"
    "- If the caller would rather get the info by text, call send_text.\n"
    "- When the conversation is over or they're not interested, call end_call.\n"
    "Only transfer, text, or schedule after the caller clearly agrees. "
    "Your output is spoken aloud over the phone, so no lists, markdown, or special characters."
)


def normalize_e164(num: str) -> str:
    digits = "".join(c for c in num if c.isdigit() or c == "+")
    if digits.startswith("+"):
        return digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return digits


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
        "model": OPENAI_MODEL,
        "voice": DEEPGRAM_VOICE,
        "turn": "smart-turn-v3",
        "tools": ["transfer_call", "schedule_callback", "send_text", "end_call"],
        "transfer_number": TRANSFER_NUMBER,
        "ready": bool(OPENAI_API_KEY and DEEPGRAM_API_KEY),
    }


def _host(request: Request) -> str:
    return request.headers.get("host") or request.url.hostname or ""


@app.post("/twiml")
async def twiml(request: Request):
    """Answer webhook: connect the call's audio to our /ws media stream."""
    host = _host(request)
    lead_name = request.query_params.get("name", "there")
    to = request.query_params.get("to", "")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="wss://{host}/ws">'
        f'<Parameter name="leadName" value="{lead_name}"/>'
        f'<Parameter name="to" value="{to}"/>'
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
    to = normalize_e164(body.get("to", ""))
    name = body.get("name", "there")
    if not to:
        return JSONResponse({"error": "missing 'to'"}, status_code=400)

    answer_url = f"https://{_host(request)}/twiml?name={name}&to={to}"
    call = twilio_rest.calls.create(to=to, from_=TWILIO_FROM_NUMBER, url=answer_url, method="POST")
    logger.info(f"Placed POC call sid={call.sid} to={to}")
    return {"call_sid": call.sid, "status": call.status, "answer_url": answer_url}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    stream = websocket.iter_text()
    await stream.__anext__()  # 'connected'
    start = json.loads(await stream.__anext__())  # 'start'
    stream_sid = start["start"]["streamSid"]
    call_sid = start["start"]["callSid"]
    params = start["start"].get("customParameters", {}) or {}
    lead_name = params.get("leadName", "there")
    phone = normalize_e164(params.get("to", ""))
    logger.info(f"WS start stream_sid={stream_sid} call_sid={call_sid} lead={lead_name} phone={phone}")

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
    # Less-twitchy VAD so telephone-line noise / the bot's own echo doesn't
    # trigger false barge-ins (which chopped the previous call's speech into
    # erratic fragments). Higher confidence + min_volume + a longer start
    # window mean only real, sustained speech interrupts the bot.
    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(confidence=0.8, start_secs=0.3, stop_secs=0.4, min_volume=0.7)
        )
    )

    # ── Tools ────────────────────────────────────────────────────────────
    tools = ToolsSchema(
        standard_tools=[
            FunctionSchema(
                name="transfer_call",
                description="Connect/transfer the caller to a live licensed agent. Call this only after the caller agrees to be connected.",
                properties={"reason": {"type": "string", "description": "Brief reason for the transfer"}},
                required=[],
            ),
            FunctionSchema(
                name="schedule_callback",
                description="Schedule a callback for later when the caller prefers to be called back instead of talking now.",
                properties={
                    "callback_time": {"type": "string", "description": "When to call back, as the caller said it (e.g. 'tomorrow at 2pm', 'this evening')"},
                    "reason": {"type": "string", "description": "Why they want a callback"},
                },
                required=["callback_time"],
            ),
            FunctionSchema(
                name="send_text",
                description="Send the caller a text message with the scheduling link and info. Call this only after the caller agrees to receive a text.",
                properties={},
                required=[],
            ),
            FunctionSchema(
                name="end_call",
                description="End the call politely, e.g. when the caller is not interested or the conversation is done.",
                properties={"reason": {"type": "string", "description": "Why the call is ending"}},
                required=[],
            ),
        ]
    )

    context = LLMContext([{"role": "system", "content": SYSTEM_PROMPT}], tools=tools)
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

    # ── Tool handlers ────────────────────────────────────────────────────
    # Once a transfer starts, the Twilio call leg is handed off to <Dial>.
    # Guard so a stray end_call (the model sometimes fires both in one turn)
    # doesn't hang up the call mid-transfer.
    session_state = {"transferring": False}

    def _twilio_update(**kwargs):
        twilio_rest.calls(call_sid).update(**kwargs)

    async def handle_transfer(p: FunctionCallParams):
        if session_state["transferring"]:
            await p.result_callback(
                {"status": "already_transferring"},
                properties=FunctionCallResultProperties(run_llm=False),
            )
            return
        session_state["transferring"] = True
        target = normalize_e164(TRANSFER_NUMBER)
        logger.info(f"[tool] transfer_call -> {target} (call {call_sid})")
        await task.queue_frames([TTSSpeakFrame("Perfect — connecting you to a licensed agent now, one moment.")])
        # Don't let the LLM speak again; the redirect takes over.
        await p.result_callback({"status": "transferring"}, properties=FunctionCallResultProperties(run_llm=False))

        async def _redirect():
            await asyncio.sleep(5)  # let the bridge line finish playing
            dial = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                f'<Response><Dial answerOnBridge="true" callerId="{TWILIO_FROM_NUMBER}">'
                f"<Number>{target}</Number></Dial>"
                '<Say voice="Polly.Matthew">Sorry, the line did not connect. Goodbye.</Say></Response>'
            )
            try:
                await asyncio.to_thread(_twilio_update, twiml=dial)
                logger.info(f"[tool] transfer redirect sent for {call_sid}")
            except Exception as e:
                logger.error(f"[tool] transfer failed: {e}")

        asyncio.create_task(_redirect())

    async def handle_end_call(p: FunctionCallParams):
        if session_state["transferring"]:
            logger.info("[tool] end_call ignored — transfer in progress")
            await p.result_callback(
                {"status": "transfer_in_progress"},
                properties=FunctionCallResultProperties(run_llm=False),
            )
            return
        logger.info(f"[tool] end_call (call {call_sid})")
        await task.queue_frames([TTSSpeakFrame("Thanks so much for your time — have a great day!")])
        await p.result_callback({"status": "ending"}, properties=FunctionCallResultProperties(run_llm=False))

        async def _hangup():
            await asyncio.sleep(4)
            try:
                await asyncio.to_thread(_twilio_update, status="completed")
            except Exception as e:
                logger.error(f"[tool] hangup failed: {e}")

        asyncio.create_task(_hangup())

    async def handle_send_text(p: FunctionCallParams):
        logger.info(f"[tool] send_text -> {phone}")
        if not phone:
            await p.result_callback({"status": "error", "reason": "no phone number on file"})
            return
        body = (
            f"Hi {lead_name}, it's {AGENT_NAME} from {COMPANY_NAME}! Here's the info and a link "
            f"to pick a time to chat: {SCHEDULE_LINK}"
        )
        try:
            await asyncio.to_thread(
                lambda: twilio_rest.messages.create(to=phone, from_=TWILIO_FROM_NUMBER, body=body)
            )
            await p.result_callback({"status": "sent"})
        except Exception as e:
            logger.error(f"[tool] send_text failed: {e}")
            await p.result_callback({"status": "error", "reason": str(e)})

    async def handle_schedule_callback(p: FunctionCallParams):
        when = p.arguments.get("callback_time", "")
        reason = p.arguments.get("reason", "")
        logger.info(f"[tool] schedule_callback when={when!r} phone={phone}")
        # Best-effort: record in the production Node system so it actually gets dialed.
        scheduled_at = (datetime.datetime.utcnow() + datetime.timedelta(hours=2)).isoformat() + "Z"

        def _post():
            payload = json.dumps({
                "phone": phone, "leadName": lead_name,
                "scheduledAt": scheduled_at, "reason": f"{when} {reason}".strip(),
            }).encode()
            req = urllib.request.Request(
                f"{NODE_API}/api/callbacks/schedule", data=payload,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            urllib.request.urlopen(req, timeout=15).read()

        try:
            if phone:
                await asyncio.to_thread(_post)
        except Exception as e:
            logger.error(f"[tool] schedule_callback record failed: {e}")
        await p.result_callback({"status": "scheduled", "when": when})

    llm.register_function("transfer_call", handle_transfer)
    llm.register_function("end_call", handle_end_call)
    llm.register_function("send_text", handle_send_text)
    llm.register_function("schedule_callback", handle_schedule_callback)

    # ── Greeting on connect ──────────────────────────────────────────────
    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
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
