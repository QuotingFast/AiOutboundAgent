import { config } from './index';
import { loadData, scheduleSave } from '../db/persistence';

export interface RuntimeSettings {
      // Voice provider: 'openai' = Realtime speech-to-speech, 'elevenlabs' = OpenAI LLM + EL TTS, 'deepseek' = DeepSeek LLM + EL TTS, 'deepgram' = OpenAI LLM + Deepgram Aura TTS
  voiceProvider: 'openai' | 'elevenlabs' | 'deepseek' | 'deepgram';

  // Voice & Model (OpenAI)
  voice: string;
      realtimeModel: string;
      temperature: number;

  // ElevenLabs settings
  elevenlabsVoiceId: string;
      elevenlabsModelId: string;
      elevenlabsStability: number;
      elevenlabsSimilarityBoost: number;
      elevenlabsStyle: number;
      elevenlabsUseSpeakerBoost: boolean;
      elevenlabsSpeed: number;

  // DeepSeek settings
  deepseekModel: string;

  // Deepgram TTS settings
  deepgramTtsModel: string;

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

  // Whether weblead auto-dial is enabled. Defaults to true: this app exists to
  // dial inbound webleads, so the toggle being off was a frequent footgun —
  // every weblead silently fell through to "Weblead stored (no auto-dial)" and
  // the phone never rang.
  webleadAutoDialEnabled?: boolean;

  // One-shot migration flag: ensures the false-by-default → true-by-default
  // upgrade only flips a persisted explicit `false` once. After that, the user
  // can turn auto-dial off in the dashboard and it stays off across restarts.
  webleadAutoDialMigrated?: boolean;

  // Master pause — halts all automatic dialing (callbacks, retries, weblead auto-dial)
  autoProcessingPaused: boolean;

  // TCPA time-of-day override (bypass 8am-9pm restriction when true).
  // This is a power-user override and is force-reset to false on load —
  // it must never be left on accidentally. For routine testing of one
  // specific number outside hours, use tcpaWhitelist instead.
  tcpaOverride: boolean;

  // Phone numbers (E.164) that bypass TCPA hours regardless of override.
  // Intended for the developer's own cell so internal testing isn't
  // restricted to 8am-9pm. Real lead numbers must NEVER be added here.
  tcpaWhitelist: string[];

  // Transfer numbers
  allstateNumber: string;
      nonAllstateNumber: string;

  // Test call defaults
  defaultFromNumber: string;
      defaultToNumber: string;

  // Background noise injection
  backgroundNoiseEnabled: boolean;
  backgroundNoiseVolume: number; // 0.0 - 1.0 (default 0.12 = 12%)

  // Voicemail / AMD detection
  amdEnabled: boolean;
  amdAction: 'hangup' | 'leave_message';
  amdMessage: string; // Pre-recorded message to leave on voicemail

  // Call duration limits
  maxCallDurationSec: number;     // 0 = unlimited
  callDurationWarnPct: number;    // Warn agent at this % of limit (default 80)

  // Silence (dead air) timeout — disconnect if no speech from either party for this many seconds
  silenceTimeoutSec: number;      // 0 = disabled, default 30

  // Call retry
  autoRetryEnabled: boolean;
  autoRetryMaxAttempts: number;

  // SMS
  smsEnabled: boolean;
  autoSmsOnMissedCall: boolean;
  autoSmsOnCallback: boolean;
  autoSmsOnTransfer: boolean;
  autoSmsOnTextRequest: boolean;

  // Per-phone rate limiting
  maxCallsPerPhonePerDay: number;  // 0 = unlimited

  // Auto-DNC on verbal request
  autoDncEnabled: boolean;

  // Retry delays (in minutes)
  retryDelay1Min: number;  // Default: 30 minutes
  retryDelay2Min: number;  // Default: 120 minutes (2 hours)
  retryDelay3Min: number;  // Default: 1440 minutes (24 hours)

  // Quality alerts
  qualityAlertsEnabled: boolean;
  latencyAlertThresholdMs: number;  // Default: 2000

  // Daily report
  dailyReportEnabled: boolean;
  dailyReportHour: number;  // 0-23, default: 18 (6PM)
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

const settings: RuntimeSettings = {
      voiceProvider: 'openai',
      voice: config.openai.voice,
      realtimeModel: config.openai.realtimeModel,
      // OpenAI Realtime requires temperature >= 0.6; values below that are
      // silently rejected and the API falls back to pcm16 audio output,
      // which Twilio can't play (mulaw expected) — call goes silent.
      temperature: 0.6,
      elevenlabsVoiceId: config.elevenlabs.voiceId || 'jn34bTlmmOgOJU9XfPuy', // Steve
      elevenlabsModelId: 'eleven_flash_v2_5',
      elevenlabsStability: 0.45,
      elevenlabsSimilarityBoost: 0.78,
      elevenlabsStyle: 0.10,
      elevenlabsUseSpeakerBoost: true,
      elevenlabsSpeed: 0.97,
      deepseekModel: config.deepseek.model || 'deepseek-chat',
      deepgramTtsModel: config.deepgram?.ttsModel || 'aura-2-thalia-en',
      // VAD tuning. With the GA gpt-realtime model the agent uses semantic_vad
      // and silenceDurationMs / prefixPaddingMs are unused — they only matter
      // on the legacy server_vad path. bargeInDebounceMs and echoSuppressionMs
      // apply on every model. The values below are tuned for snappy turn-
      // taking; each one was a deliberate latency cut.
      vadThreshold: 0.55,
      // 300ms post-utterance silence before the model decides the user is done
      // (legacy server_vad only). Was 500ms; saves ~200ms per turn on that
      // path while still tolerating natural mid-sentence pauses.
      silenceDurationMs: 300,
      // 100ms of pre-speech audio buffered for cleaner VAD onset (legacy
      // server_vad only). Was 200ms.
      prefixPaddingMs: 100,
      // Aggressive barge-in for snappy turn-taking. With semantic_vad handling
      // phantom-speech rejection at the model level we don't need long
      // debounces as a defensive moat. Was 150ms; 100ms is the sweet spot
      // before false-positive interruptions creep in.
      bargeInDebounceMs: 100,
      // Post-playback rejection window — speech captured within this many ms
      // of the bot's last audio frame is treated as echo. Was 250ms; lowering
      // to 150ms accepts real fast user answers ("yes", "Toyota") sooner
      // without re-introducing the echo bug we saw before. The harder rule —
      // reject any transcript while responseIsPlaying is true — still holds.
      echoSuppressionMs: 150,
      // Voice = fragments. The system prompt says "1 sentence, sometimes 2,
      // never 3." Backing it up at the API level prevents the model from
      // ever generating a long response when reasoning gets verbose.
      // 250 covers a 2-sentence response with comfortable margin; the model
      // will naturally stay shorter most of the time. Bumping above ~400
      // starts to risk monologue-style turns that ruin the conversational
      // rhythm. Increase only for very specific use cases (e.g. an explainer
      // workflow where the agent legitimately needs to read out longer info).
      maxResponseTokens: 250,
      agentName: 'Steve',
      companyName: 'Smart Quotes',
      systemPromptOverride: '',
      inboundPromptOverride: '',
      inboundEnabled: true,
      webleadAutoDialEnabled: true,
      webleadAutoDialMigrated: false,
      autoProcessingPaused: false,
      tcpaOverride: false,
      tcpaWhitelist: ['+19547905093'],
      allstateNumber: '',
      nonAllstateNumber: '',
      defaultFromNumber: config.twilio.fromNumber,
      defaultToNumber: '',

      // Background noise
      // Default ON so a freshly deployed instance (or one with no persisted
      // settings yet) plays the office ambience that's bundled in assets/.
      // Existing deployments keep whatever value is persisted.
      backgroundNoiseEnabled: false,
      backgroundNoiseVolume: 0.04,

      // AMD / Voicemail detection
      // Answering machine detection: ON by default. The bot rambling
      // into voicemail thinking it was a person was a real production
      // problem; Twilio's AMD + the /twilio/amd-status hangup is the
      // safe default.
      amdEnabled: true,
      amdAction: 'hangup',
      amdMessage: 'Hi, this is {{agent_name}} from {{company_name}}. We were calling about your auto insurance quote. Please call us back at your convenience. Thank you!',

      // Call duration limits
      maxCallDurationSec: 180,
      callDurationWarnPct: 80,

      // Silence (dead air) timeout
      silenceTimeoutSec: 30,

      // Call retry
      autoRetryEnabled: false,
      autoRetryMaxAttempts: 3,

      // SMS
      smsEnabled: false,
      autoSmsOnMissedCall: true,
      autoSmsOnCallback: true,
      autoSmsOnTransfer: true,
      autoSmsOnTextRequest: true,

      // Per-phone rate limiting
      maxCallsPerPhonePerDay: 3,

      // Auto-DNC
      autoDncEnabled: true,

      // Retry delays (minutes)
      retryDelay1Min: 30,
      retryDelay2Min: 120,
      retryDelay3Min: 1440,

      // Quality alerts
      qualityAlertsEnabled: true,
      latencyAlertThresholdMs: 2000,

      // Daily report
      dailyReportEnabled: false,
      dailyReportHour: 18,
};

// Keep last 20 calls
const callHistory: CallRecord[] = [];
const MAX_HISTORY = 20;

const CALL_HISTORY_KEY = 'call_history';
const SETTINGS_KEY = 'settings';

function persistCallHistory(): void {
  scheduleSave(CALL_HISTORY_KEY, () => callHistory);
}

function persistSettings(): void {
  scheduleSave(SETTINGS_KEY, () => settings);
}

export function loadRuntimeFromDisk(): void {
  const savedHistory = loadData<CallRecord[]>(CALL_HISTORY_KEY);
  if (savedHistory) {
    callHistory.push(...savedHistory);
  }

  const savedSettings = loadData<Partial<RuntimeSettings>>(SETTINGS_KEY);
  if (savedSettings) {
    for (const [key, value] of Object.entries(savedSettings)) {
      if (key in settings) {
        (settings as any)[key] = value;
      }
    }
    if (typeof settings.temperature === 'number' && settings.temperature < 0.6) {
      settings.temperature = 0.6;
      persistSettings();
    }
    // Heal old 45-token limit set for ElevenLabs text mode — audio mode needs much more.
    if (typeof settings.maxResponseTokens === 'number' && settings.maxResponseTokens < 200) {
      settings.maxResponseTokens = 1024;
      persistSettings();
    }
    // Bump legacy preview-alias model to the GA 'gpt-realtime'.
    if (settings.realtimeModel === 'gpt-4o-realtime-preview') {
      settings.realtimeModel = 'gpt-realtime';
      persistSettings();
    }
    // Heal pathological VAD thresholds. The previous 0.92 default was too
    // strict and made the agent unable to hear normal phone speech; the
    // older 0.85 was too eager. Anything outside [0.5, 0.85] gets reset to
    // the safe 0.65 default. Note: only applies when the legacy server_vad
    // path is used (preview models); gpt-realtime ignores this entirely
    // and uses semantic_vad instead.
    let vadMigrated = false;
    if (typeof settings.vadThreshold === 'number' && (settings.vadThreshold < 0.4 || settings.vadThreshold > 0.85)) {
      settings.vadThreshold = 0.55;
      vadMigrated = true;
    }
    // Heal sluggish persisted silence_duration values down to the current
    // default. Older defaults were 1400ms then 500ms; 300ms is snappier while
    // still tolerating natural pauses on the legacy server_vad path.
    if (typeof settings.silenceDurationMs === 'number' && settings.silenceDurationMs > 400) {
      settings.silenceDurationMs = 300;
      vadMigrated = true;
    }
    // Heal sluggish prefix-padding from the older 200ms default down to 100ms.
    if (typeof settings.prefixPaddingMs === 'number' && settings.prefixPaddingMs > 150) {
      settings.prefixPaddingMs = 100;
      vadMigrated = true;
    }
    // Heal sluggish barge-in/echo windows down to the current defaults.
    if (typeof settings.bargeInDebounceMs === 'number' && settings.bargeInDebounceMs > 130) {
      settings.bargeInDebounceMs = 100;
      vadMigrated = true;
    }
    if (typeof settings.echoSuppressionMs === 'number' && settings.echoSuppressionMs > 200) {
      settings.echoSuppressionMs = 150;
      vadMigrated = true;
    }
    // One-shot weblead auto-dial heal: the toggle used to default to false,
    // which silently dropped every weblead at the "Weblead stored (no auto-
    // dial)" branch — phones never rang. Flip a persisted explicit `false`
    // exactly once so existing deployments get the new default-on behavior.
    // After this runs, webleadAutoDialMigrated stays true forever and the
    // user's dashboard toggle is the source of truth.
    if (settings.webleadAutoDialMigrated !== true) {
      if (settings.webleadAutoDialEnabled !== true) {
        settings.webleadAutoDialEnabled = true;
      }
      settings.webleadAutoDialMigrated = true;
      vadMigrated = true;
    }
    // Force-heal TCPA override: this MUST be off across restarts. We had
    // a production incident where it was left on overnight and bots
    // dialed leads at 2am. Real numbers go through the normal 8am-9pm
    // gate; the test number lives in tcpaWhitelist.
    if (settings.tcpaOverride === true) {
      settings.tcpaOverride = false;
      vadMigrated = true;
    }
    // Ensure the developer test number is always whitelisted so
    // internal testing isn't blocked, even if persistence drops it.
    const TEST_PHONE = '+19547905093';
    if (!Array.isArray(settings.tcpaWhitelist)) {
      settings.tcpaWhitelist = [TEST_PHONE];
      vadMigrated = true;
    } else if (!settings.tcpaWhitelist.includes(TEST_PHONE)) {
      settings.tcpaWhitelist = [TEST_PHONE, ...settings.tcpaWhitelist];
      vadMigrated = true;
    }
    // AMD must default ON for outbound — bot rambling into voicemail
    // was a real production problem. amdEnabled was previously false.
    if (settings.amdEnabled !== true) {
      settings.amdEnabled = true;
      vadMigrated = true;
    }
    if (settings.amdAction !== 'hangup' && settings.amdAction !== 'leave_message') {
      settings.amdAction = 'hangup';
      vadMigrated = true;
    }
    if (vadMigrated) persistSettings();
  }
}

export function getSettings(): RuntimeSettings {
      return { ...settings };
}

export function updateSettings(updates: Partial<RuntimeSettings>): RuntimeSettings {
      for (const [key, value] of Object.entries(updates)) {
              if (key in settings) {
                        (settings as any)[key] = value;
              }
      }
      persistSettings();
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
      persistCallHistory();
}

export function getCallHistory(): CallRecord[] {
      return [...callHistory];
}
