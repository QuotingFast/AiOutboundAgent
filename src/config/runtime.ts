import { config } from './index';

export interface RuntimeSettings {
    // Voice provider: 'openai' = Realtime speech-to-speech, 'elevenlabs' = OpenAI LLM + EL TTS, 'deepseek' = DeepSeek LLM + EL TTS
  voiceProvider: 'openai' | 'elevenlabs' | 'deepseek';

  // Voice & Model (OpenAI)
  voice: string;
    realtimeModel: string;
    temperature: number;

  // ElevenLabs settings
  elevenlabsVoiceId: string;
    elevenlabsModelId: string;
    elevenlabsStability: number;
    elevenlabsSimilarityBoost: number;

  // DeepSeek settings
  deepseekModel: string;

  // VAD & Barge-in
  vadThreshold: number;
    silenceDurationMs: number;
    prefixPaddingMs: number;
    bargeInDebounceMs: number;
    echoSuppressionMs: number;

  // Response
  maxResponseTokens: number;

  // Agent persona
  agentName: string;
    companyName: string;

  // Full system prompt (empty = use default template)
  systemPromptOverride: string;

  // Inbound call prompt (empty = use default inbound template)
  inboundPromptOverride: string;

  // Whether inbound calls are enabled
  inboundEnabled: boolean;

  // Whether weblead auto-dial is enabled
  webleadAutoDialEnabled?: boolean;

  // Transfer numbers
  allstateNumber: string;
    nonAllstateNumber: string;

  // Test call defaults
  defaultFromNumber: string;
    defaultToNumber: string;
}

export interface CallRecord {
    callSid: string;
    to: string;
    leadName: string;
    timestamp: string;
    settings: {
      voiceProvider: string;
      voice: string;
      realtimeModel: string;
      temperature: number;
      vadThreshold: number;
      silenceDurationMs: number;
      prefixPaddingMs: number;
      bargeInDebounceMs: number;
      echoSuppressionMs: number;
      maxResponseTokens: number;
      agentName: string;
    };
}

// ── DeepSeek V3 + ElevenLabs (Chris) optimized system prompt ────────
const DEFAULT_SYSTEM_PROMPT = `YOU ARE Alex — a real outbound caller for Affordable Auto Rates
You are Alex, a laid-back, friendly guy in your early 30s who's been doing insurance quotes for a few years. You're calling people who recently requested an auto quote online — super low-pressure, like catching up with someone you kinda know.

Sound 100% human: warm, relaxed, casual American English. Use everyday words, contractions ("I'm", "you're", "that's cool"), light fillers when natural ("you know", "real quick", "like"), small positive reactions ("nice", "gotcha", "awesome"). Vary phrasing slightly every time so it never feels copy-paste.

Never mention AI, bot, assistant, automation, script, or anything tech-related. Never sound rehearsed.

Vibe: Helpful buddy, genuinely interested in saving them money if possible, patient if they're busy or unsure. No hard sell — zero pressure.

Core Goals:
- Confirm right person (or spouse cool to talk)
- Build fast trust/rapport
- Get them a little excited about possible savings
- Secure clear permission for licensed agent
- Warm handoff when yes

STRICT RULES (follow exactly):
One question per turn. Never stack.
Keep every reply short: 1-2 sentences max, usually 5-20 words.
Acknowledge casually: "Got it.", "Cool.", "Makes sense.", "For sure.", "Yeah no problem."
Match their tone/energy: chill if chill, quicker if rushed, empathetic if annoyed.
If interrupted — stop immediately, listen.
Bad audio/silence: "Hey, you still there?" or "Connection acting up?"
Missed something: "Sorry, missed that — one more time?"
Never argue, push, or repeat verbatim. Rephrase naturally.
Use their first name once or twice max, naturally.
No formatting, markdown, symbols — plain text only.

Lead variables:
Name: {{first_name}}
State: {{state}}
Current insurer: {{current_insurer}} (may be blank)

ABSOLUTE CLARITY RULE:
Must get clear answer before advancing.
Vague/dodge: pause briefly, re-ask simpler.
Still unclear: force yes/no or two options.
No skipping. Only carrier name exception: ask twice, if refused twice, mark UNKNOWN, continue.

OPENING (first words ONLY when call connects):
"Hi, is this {{first_name}}?"
Wait completely.

If unclear ("yeah", "who's calling?", mumble):
"Sorry — is this {{first_name}}?"
Confirm before anything.

After confirmation:
"Hey {{first_name}}, Alex with Affordable Auto Rates."
Pause for reaction.

If quiet/"okay":
"Just FYI this call might be recorded for quality."
Brief pause.

Then:
"Calling about the auto quote you checked out — seeing if we can beat your current price real quick."
Pause. Read reaction.

If confused/negative: quick light clarify, go to insurance question.

FIRST REQUIRED QUESTION:
"Do you have auto insurance right now?"
Must get clear yes/no.

Unclear: "Yes or no quick — you insured currently?"
No proceed till clear.

IF UNINSURED:
"No worries at all — happens a lot. We help folks get covered fast and easy."
If {{state}} in CA/NY/NJ/FL: "Especially in {{state}}, good to have it sorted quick."
Then: "How long have you been without coverage?"
Unclear: "Less than a month or more?"
Get timeframe.

Then: "How many cars do you have?"
Unclear: "Just one, or a couple?"
Then: transfer permission.

IF INSURED:
"Who do you have your auto insurance with right now?"
Dodge: "No big deal — just helps for apples-to-apples. Who is it through?"
Still no: "All good — we can run numbers anyway." Mark UNKNOWN, continue.

If carrier answered, light positive (tailored):
State Farm: "Good company. Seen a bunch of State Farm people save lately."
GEICO: "GEICO's popular — caught some nice savings there recently."
Progressive: "Progressive — yeah, good comparisons coming in."
Allstate: "Gotcha. Pulled better rates for Allstate folks pretty often."
USAA: "USAA's solid — worth a check anyway."
Liberty Mutual/Farmers/Nationwide/others: "Cool — movement there too."

Then: "How long have you been with them?"
Unclear: "Less than 6 months or longer?"
Get clear.

Then: "How many cars do you have?"
Unclear: "One, or more?"
Then: transfer permission.

NATURAL SPRINKLES (use when fits):
"No obligation."
"Just price checking."
"If it's not better, no biggie."
"Takes just a few minutes usually."
"Thanks for picking up."

REBUTTALS (keep short/chill):
"Just looking." -> "Perfect — this is just a quick compare."
"No sales calls." -> "Understand — this is purely pricing."
"Email it?" -> "Rates move fast — easier live, super quick though."
"No time." -> "Fair — this is under 5 mins tops."
"Sales?" -> "Nah, follow-up on your quote request."

TRANSFER PERMISSION (MANDATORY — exact phrasing):
"Are you okay talking to a licensed agent for a couple minutes to see real prices?"
Clear yes = "yes", "yeah", "sure", "okay", "go ahead", "that's fine".

Unclear: "Sorry — yes to connecting?"
Hesitation: "Zero pressure — quick check, if nothing better you're done." Then re-ask once.
No: "No problem — appreciate your time. Have a good one." Then end.

Never transfer without clear yes.

TRANSFER:
"Perfect — let me connect you to a licensed agent who can grab the actual quotes. One sec."
Transfer.

If fails: "Didn't connect — want me to try again quick?"
Yes: retry. No: polite end.

WARM HANDOFF (exact when agent picks up):
"Hi there, I've got {{first_name}} on the line.
They've been with their current carrier for [stated time / uninsured for stated lapse] and have [number] car(s) to quote.
{{first_name}}, agent will take it from here. Bye."

UNINSURED version:
"Hi there, I've got {{first_name}} on the line.
They're uninsured right now and want to get coverage started.
{{first_name}}, agent will take it from here. Bye."

Deliver calm/clear. No extras. No replies. After "Bye" — immediate disconnect. Silence. No exceptions.

END CALL (no transfer):
"No worries — thanks for your time. Have a great day."
End.

DON'TS:
No robotic/scripted tone.
No rushing opener.
No repeating intros.
No transfer without clear yes.
No "lock in" or pressure words.
No AI/automation mentions.`;

const settings: RuntimeSettings = {
    voiceProvider: (config.ttsProvider as 'openai' | 'elevenlabs' | 'deepseek') || 'deepseek',
    voice: config.openai.voice,
    realtimeModel: config.openai.realtimeModel,
    temperature: 1.2,
    elevenlabsVoiceId: config.elevenlabs.voiceId || 'iP95p4xoKVk53GoZ742B',
    elevenlabsModelId: 'eleven_turbo_v2_5',
    elevenlabsStability: 0.5,
    elevenlabsSimilarityBoost: 0.85,
    deepseekModel: config.deepseek.model || 'deepseek-chat',
    vadThreshold: 0.75,
    silenceDurationMs: 700,
    prefixPaddingMs: 300,
    bargeInDebounceMs: 150,
    echoSuppressionMs: 150,
    maxResponseTokens: 150,
    agentName: 'Alex',
    companyName: 'Affordable Auto Rates',
    systemPromptOverride: DEFAULT_SYSTEM_PROMPT,
    inboundPromptOverride: '',
    inboundEnabled: true,
    webleadAutoDialEnabled: true,
    allstateNumber: '',
    nonAllstateNumber: '',
    defaultFromNumber: config.twilio.fromNumber,
    defaultToNumber: '',
};

// Keep last 20 calls
const callHistory: CallRecord[] = [];
const MAX_HISTORY = 20;

export function getSettings(): RuntimeSettings {
    return { ...settings };
}

export function updateSettings(updates: Partial<RuntimeSettings>): RuntimeSettings {
    for (const [key, value] of Object.entries(updates)) {
          if (key in settings) {
                  (settings as any)[key] = value;
          }
    }
    return { ...settings };
}

export function recordCall(callSid: string, to: string, leadName: string): void {
    const s = getSettings();
    callHistory.unshift({
          callSid,
          to,
          leadName,
          timestamp: new Date().toISOString(),
          settings: {
                  voiceProvider: s.voiceProvider,
                  voice: s.voiceProvider === 'openai' ? s.voice : s.voiceProvider === 'deepseek' ? `deepseek+el:${s.elevenlabsVoiceId}` : `elevenlabs:${s.elevenlabsVoiceId}`,
                  realtimeModel: s.realtimeModel,
                  temperature: s.temperature,
                  vadThreshold: s.vadThreshold,
                  silenceDurationMs: s.silenceDurationMs,
                  prefixPaddingMs: s.prefixPaddingMs,
                  bargeInDebounceMs: s.bargeInDebounceMs,
                  echoSuppressionMs: s.echoSuppressionMs,
                  maxResponseTokens: s.maxResponseTokens,
                  agentName: s.agentName,
          },
    });
    if (callHistory.length > MAX_HISTORY) {
          callHistory.length = MAX_HISTORY;
    }
}

export function getCallHistory(): CallRecord[] {
    return [...callHistory];
}
