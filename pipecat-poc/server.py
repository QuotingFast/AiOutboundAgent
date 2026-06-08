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
import time
import urllib.parse
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
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    LLMRunFrame,
    StartFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.turns.user_mute import AlwaysUserMuteStrategy
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams, FunctionCallResultProperties
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.tts import OpenAITTSService
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
# TTS provider: 'openai' (natural, works on existing key), 'elevenlabs'
# (most human, needs a PAID ElevenLabs account), or 'deepgram'.
TTS_PROVIDER = os.getenv("TTS_PROVIDER", "openai").lower()
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "ash")
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
OPENAI_TTS_INSTRUCTIONS = os.getenv(
    "OPENAI_TTS_INSTRUCTIONS",
    "Speak like a warm, upbeat, natural human salesperson on a phone call — "
    "conversational and friendly with relaxed, real pacing. Not robotic, not formal, "
    "not announcer-like.",
)
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "jn34bTlmmOgOJU9XfPuy")  # Steve
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")
AGENT_NAME = os.getenv("AGENT_NAME", "Steve")
COMPANY_NAME = os.getenv("COMPANY_NAME", "Smart Quotes")
TRANSFER_NUMBER = os.getenv("TRANSFER_NUMBER", "9548182888")
SCHEDULE_LINK = os.getenv("SCHEDULE_LINK", "https://quotingfast.com/schedule")
# Production Node service — used to record scheduled callbacks in the real system.
NODE_API = os.getenv("NODE_API", "https://ai-outbound-agent-florida.onrender.com")
# Auto-hangup guards (stop wasting credits on dead air / time-wasters).
MAX_CALL_SECS = int(os.getenv("MAX_CALL_SECS", "180"))   # hard cap on call length
SILENCE_SECS = int(os.getenv("SILENCE_SECS", "15"))       # dead-air cutoff

SYSTEM_PROMPT = (
    f"You are {AGENT_NAME}, a friendly, upbeat auto-insurance agent at {COMPANY_NAME}. "
    "You are on a phone call. Keep replies short and natural — usually one sentence, two at the "
    "key sales moments below. Sound human and genuinely excited to help; never say you are an AI.\n\n"
    "CALL FLOW:\n"
    "1) Confirm they requested an AUTO insurance quote. Always say 'auto insurance', never just "
    "'insurance', so they know exactly what this call is about.\n"
    "2) Ask who their current auto insurance carrier is.\n"
    "3) When they tell you their carrier and seem unsure about continuing, win them over with "
    "confident excitement. Example (swap in their ACTUAL carrier name): \"Wow, this call just got "
    "a lot better — we have been absolutely killing State Farm rates lately! How long have you "
    "been with them?\" If they're uninsured, get excited that you can likely get them covered for "
    "less than they expect.\n"
    "4) Ask a couple quick qualifying questions (how long with that carrier, how many vehicles).\n"
    "5) Once they're qualified, pitch the hand-off naturally. Example: \"From what you're telling "
    "me, it sounds like we'll be able to show you a ton of savings. What I'd like to do is very "
    "quickly bring a licensed agent on the line so they can show you the final numbers — it only "
    "takes a few minutes. Is that okay with you?\"\n"
    "These wordings are examples; use them or close, natural variations.\n\n"
    "Use your tools to take real action — do NOT just say you will do something:\n"
    "- When the caller agrees to be connected/transferred, call the transfer_call function and "
    "pass the current_carrier, tenure, and vehicle_count you gathered (so the agent gets a warm "
    "intro before they pick up). Say one short bridge line like 'Perfect, connecting you now' and "
    "the transfer happens automatically. After calling transfer_call, do NOT call any other tool.\n"
    "- If the caller would rather be called back later, call schedule_callback with their preferred time.\n"
    "- If the caller would rather get the info by text, call send_text.\n"
    "- When it's time to end (caller not interested, rude, disengaged, wasting time, or you've "
    "wrapped up), call end_call IMMEDIATELY. Do NOT say goodbye in your own words and do NOT "
    "keep talking — end_call says one goodbye and hangs up for you. Never repeat goodbyes, never "
    "say 'bye' and then keep talking, and never re-ask a question you already asked.\n"
    "Only transfer, text, or schedule after the caller clearly agrees. "
    "Your output is spoken aloud over the phone, so no lists, markdown, or special characters."
)


_WORD_NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
             "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "fifteen": 15,
             "twenty": 20, "thirty": 30, "forty": 40, "forty-five": 45, "sixty": 60}


def parse_callback_time(text: str) -> datetime.datetime:
    """Best-effort parse of a spoken callback time into a UTC datetime.
    Handles 'in N minutes/hours/days' (digit or word), 'tomorrow', 'tonight',
    'this afternoon/evening', and an hour-from-now default."""
    import re
    now = datetime.datetime.utcnow()
    t = (text or "").lower().strip()
    m = re.search(r"in\s+([a-z0-9\-]+)\s*(minute|min|hour|hr|day)", t)
    if m:
        tok = m.group(1)
        n = int(tok) if tok.isdigit() else _WORD_NUM.get(tok)
        unit = m.group(2)
        if n:
            if unit.startswith("min"):
                return now + datetime.timedelta(minutes=n)
            if unit.startswith("hour") or unit == "hr":
                return now + datetime.timedelta(hours=n)
            if unit == "day":
                return now + datetime.timedelta(days=n)
    if "tomorrow" in t:
        return now + datetime.timedelta(days=1)
    if "tonight" in t or "evening" in t:
        return now.replace(hour=23, minute=0, second=0, microsecond=0)  # ~7pm ET
    if "afternoon" in t:
        return now.replace(hour=19, minute=0, second=0, microsecond=0)  # ~3pm ET
    if "hour" in t:
        return now + datetime.timedelta(hours=1)
    if "minute" in t or "few min" in t:
        return now + datetime.timedelta(minutes=5)
    return now + datetime.timedelta(hours=1)


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
        "tts_provider": TTS_PROVIDER,
        "voice": OPENAI_TTS_VOICE if TTS_PROVIDER == "openai" else (ELEVENLABS_VOICE_ID if TTS_PROVIDER == "elevenlabs" else DEEPGRAM_VOICE),
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
        f'<Parameter name="host" value="{host}"/>'
        "</Stream>"
        "</Connect></Response>"
    )
    return Response(content=xml, media_type="application/xml")


@app.post("/whisper")
async def whisper(request: Request):
    """Warm-transfer whisper: TwiML played to the licensed agent BEFORE the
    caller is bridged in. Briefs them on the lead and requires pressing 1 to
    accept the connection (the prospect never hears this)."""
    text = request.query_params.get("text", "You have a warm transfer coming in.")
    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    host = _host(request)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Gather numDigits="1" action="https://{host}/whisper-accept" method="GET" timeout="12">'
        f'<Say voice="Polly.Matthew">{safe} Press 1 to connect with the prospect.</Say>'
        "</Gather>"
        '<Say voice="Polly.Matthew">No input received. Goodbye.</Say><Hangup/>'
        "</Response>"
    )
    return Response(content=xml, media_type="application/xml")


@app.get("/whisper-accept")
async def whisper_accept(request: Request):
    """Agent pressed a key after the whisper. '1' bridges them to the prospect;
    anything else drops the agent leg (no connection)."""
    digits = request.query_params.get("Digits", "")
    if digits == "1":
        # Empty TwiML → the agent leg bridges to the waiting prospect.
        xml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    else:
        xml = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<Response><Say voice="Polly.Matthew">Okay, goodbye.</Say><Hangup/></Response>')
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
    public_host = params.get("host", "") or "pipecat-poc.onrender.com"
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
    if TTS_PROVIDER == "elevenlabs" and ELEVENLABS_API_KEY:
        tts = ElevenLabsTTSService(
            api_key=ELEVENLABS_API_KEY,
            voice_id=ELEVENLABS_VOICE_ID,
            model=ELEVENLABS_MODEL,
            sample_rate=8000,
            params=ElevenLabsTTSService.InputParams(
                stability=0.45, similarity_boost=0.78, style=0.10,
                use_speaker_boost=True, speed=0.97, auto_mode=True,
            ),
        )
    elif TTS_PROVIDER == "deepgram":
        tts = DeepgramTTSService(api_key=DEEPGRAM_API_KEY, voice=DEEPGRAM_VOICE, sample_rate=8000)
    else:  # default: OpenAI TTS — natural, runs on the existing OpenAI key.
        # 24kHz native; the transport/serializer downsamples to 8k mulaw for Twilio.
        tts = OpenAITTSService(
            api_key=OPENAI_API_KEY,
            voice=OPENAI_TTS_VOICE,
            model=OPENAI_TTS_MODEL,
            instructions=OPENAI_TTS_INSTRUCTIONS,
            sample_rate=24000,
        )
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
                description=(
                    "Warm-transfer the caller to a live licensed agent. Call only after the caller "
                    "agrees to be connected. Populate the fields from what you learned so the agent "
                    "gets a proper warm hand-off before they pick up."
                ),
                properties={
                    "current_carrier": {"type": "string", "description": "Caller's current auto insurance carrier as they stated it; 'uninsured' if none; leave empty if unknown"},
                    "tenure": {"type": "string", "description": "How long they've had that carrier, e.g. '3 years', '6 months'"},
                    "vehicle_count": {"type": "string", "description": "Number of vehicles to quote"},
                    "reason": {"type": "string", "description": "Brief reason for the transfer"},
                },
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
    # Mute the caller's audio while the bot is speaking so the bot never
    # transcribes its own voice echoing back down the phone line ("hearing
    # things") or false-interrupts itself.
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(user_mute_strategies=[AlwaysUserMuteStrategy()]),
    )

    # ── Call guard state + activity tracker ───────────────────────────────
    # Without this the call runs forever (burning credits) if the caller goes
    # quiet or just messes around. CallGuard observes speaking activity; a
    # monitor task force-ends the call on dead air (SILENCE_SECS) or at the
    # hard time cap (MAX_CALL_SECS). Disabled once a transfer hands the leg
    # off to <Dial>.
    session_state = {"transferring": False}
    guard = {"start": None, "last": None, "ended": False,
             "bot_speaking": False, "user_speaking": False, "monitor": None}

    class CallGuard(FrameProcessor):
        async def process_frame(self, frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            now = time.time()
            if isinstance(frame, StartFrame):
                guard["start"] = now
                guard["last"] = now
            elif isinstance(frame, UserStartedSpeakingFrame):
                guard["user_speaking"] = True
                guard["last"] = now
            elif isinstance(frame, UserStoppedSpeakingFrame):
                guard["user_speaking"] = False
                guard["last"] = now
            elif isinstance(frame, BotStartedSpeakingFrame):
                guard["bot_speaking"] = True
                guard["last"] = now
            elif isinstance(frame, BotStoppedSpeakingFrame):
                guard["bot_speaking"] = False
                guard["last"] = now
            elif isinstance(frame, TranscriptionFrame):
                guard["last"] = now
            await self.push_frame(frame, direction)

    call_guard = CallGuard()

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
            call_guard,
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
    def _twilio_update(**kwargs):
        twilio_rest.calls(call_sid).update(**kwargs)

    async def _force_end(reason: str):
        """Hard hangup driven by the guards (independent of the model)."""
        if guard["ended"]:
            return
        guard["ended"] = True
        logger.info(f"[guard] ending call ({reason}) call={call_sid}")
        try:
            if reason == "max_duration":
                await task.queue_frames([TTSSpeakFrame(
                    "I want to be respectful of your time, so I'll let you go for now — "
                    "we'll follow up. Take care!")])
                await asyncio.sleep(5)
            await asyncio.to_thread(_twilio_update, status="completed")
        except Exception as e:
            logger.error(f"[guard] force end failed: {e}")

    async def _monitor():
        while not guard["ended"]:
            await asyncio.sleep(3)
            if session_state["transferring"]:
                return  # leg handed off to <Dial>; stop guarding
            now = time.time()
            if guard["start"] is None:
                continue
            if now - guard["start"] > MAX_CALL_SECS:
                await _force_end("max_duration")
                return
            speaking = guard["bot_speaking"] or guard["user_speaking"]
            if not speaking and guard["last"] and (now - guard["last"]) > SILENCE_SECS:
                await _force_end("silence")
                return

    async def handle_transfer(p: FunctionCallParams):
        if session_state["transferring"]:
            await p.result_callback(
                {"status": "already_transferring"},
                properties=FunctionCallResultProperties(run_llm=False),
            )
            return
        session_state["transferring"] = True
        target = normalize_e164(TRANSFER_NUMBER)

        # Build the warm-transfer whisper briefing from what we learned.
        carrier = (p.arguments.get("current_carrier") or "").strip()
        tenure = (p.arguments.get("tenure") or "").strip()
        vehicles = (p.arguments.get("vehicle_count") or "").strip()
        insured = bool(carrier) and carrier.lower() not in (
            "uninsured", "none", "no", "n/a", "na", "unknown", "")
        if insured:
            briefing = f"I have {lead_name} on the line, and they have been with {carrier}"
            briefing += f" for {tenure}." if tenure else "."
        else:
            v = vehicles if vehicles else "a few"
            plural = "" if v == "1" else "s"
            briefing = (f"I have {lead_name} on the line. They are currently uninsured and have "
                        f"{v} vehicle{plural} to quote.")
        whisper_url = f"https://{public_host}/whisper?text=" + urllib.parse.quote(briefing)
        logger.info(f"[tool] transfer_call -> {target} (call {call_sid}) whisper={briefing!r}")

        await task.queue_frames([TTSSpeakFrame("Perfect — connecting you to a licensed agent now, one moment.")])
        # Don't let the LLM speak again; the redirect takes over.
        await p.result_callback({"status": "transferring"}, properties=FunctionCallResultProperties(run_llm=False))

        async def _redirect():
            await asyncio.sleep(5)  # let the bridge line finish playing
            # answerOnBridge keeps the caller hearing ringback while the agent
            # hears the whisper; <Number url=...> plays the briefing to the
            # agent only, then Twilio bridges the caller in.
            dial = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                f'<Response><Dial answerOnBridge="true" callerId="{TWILIO_FROM_NUMBER}">'
                f'<Number url="{whisper_url}" method="POST">{target}</Number></Dial>'
                '<Say voice="Polly.Matthew">Sorry, the line did not connect. Goodbye.</Say></Response>'
            )
            try:
                await asyncio.to_thread(_twilio_update, twiml=dial)
                logger.info(f"[tool] warm transfer redirect sent for {call_sid}")
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
        guard["ended"] = True  # stop the silence/duration monitor from racing
        await task.queue_frames([TTSSpeakFrame("Thanks so much for your time — have a great day!")])
        await p.result_callback({"status": "ending"}, properties=FunctionCallResultProperties(run_llm=False))

        async def _hangup():
            # Wait for the goodbye to actually finish, then hang up promptly.
            # The old fixed 4s delay felt like the bot couldn't end the call.
            await asyncio.sleep(1.0)
            deadline = time.time() + 12
            while guard["bot_speaking"] and time.time() < deadline:
                await asyncio.sleep(0.3)
            await asyncio.sleep(0.6)
            try:
                await asyncio.to_thread(_twilio_update, status="completed")
                logger.info(f"[tool] hung up call {call_sid}")
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
        # Record in the production Node system so it actually gets dialed, at the
        # time the caller asked for (parsed from natural language).
        scheduled_at = parse_callback_time(when).isoformat() + "Z"
        logger.info(f"[tool] callback scheduled_at={scheduled_at}")

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
                    f'{COMPANY_NAME} — you put in an auto insurance quote request recently, right?"'
                ),
            }
        )
        guard["start"] = time.time()
        guard["last"] = time.time()
        guard["monitor"] = asyncio.create_task(_monitor())
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        guard["ended"] = True
        if guard["monitor"]:
            guard["monitor"].cancel()
        await task.queue_frames([EndFrame()])

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
