import { logger } from '../utils/logger';

// ── Conversation State Machine ──────────────────────────────────────

export type ConversationState =
  | 'greeting'
  | 'identity_check'
  | 'disclosure'
  | 'purpose'
  | 'qualifying'
  | 'insurance_question'
  | 'excitement_build'
  | 'objection_handling'
  | 'transfer_prep'
  | 'transferring'
  | 'farewell'
  | 'ended';

export interface ConversationContext {
  state: ConversationState;
  previousState: ConversationState;
  turnCount: number;
  identityConfirmed: boolean;
  disclosureGiven: boolean;
  currentInsurer?: string;
  insuranceDuration?: string;
  objectionCount: number;
  maxObjections: number;
  rebuttalHistory: RebuttalRecord[];
  intentHistory: IntentRecord[];
  sentimentHistory: SentimentRecord[];
  flags: Set<string>;
  questionAsked: boolean; // one-question-at-a-time enforcement
  lastAgentText: string;
  lastUserText: string;
  callerEnergy: CallerEnergy;
  consecutiveNegativeSentiments: number;
  frustrationEscalated: boolean;
}

export interface RebuttalRecord {
  turn: number;
  objection: string;
  rebuttalType: string;
  timestamp: number;
}

export interface IntentRecord {
  turn: number;
  intent: string;
  confidence: number;
  text: string;
  timestamp: number;
}

export interface SentimentRecord {
  turn: number;
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  confidence: number;
  timestamp: number;
}

// ── Filler words (context-aware) ────────────────────────────────────

const CONFIRMATION_FILLERS = ['Got it.', 'Perfect.', 'Okay.', 'For sure.', 'Gotcha.', 'Sounds good.', 'Nice.', 'Cool.'];
const TRANSITION_FILLERS = ['So,', 'Alright,', 'Okay so,', 'Cool,', 'Alright so,'];
const EMPATHY_FILLERS = ['Yeah, totally.', 'I hear you.', 'That makes sense.', 'Absolutely.', 'No, I totally get that.', 'Yeah, that\'s fair.'];
const EXCITEMENT_FILLERS = ['Oh nice!', 'That\'s awesome.', 'Love it.', 'Sweet!', 'Oh cool!'];
const THINKING_FILLERS = ['So basically,', 'Hmm, let me think...', 'Good question,', 'Yeah so,'];
const DE_ESCALATION_FILLERS = ['Hey, I totally understand.', 'No worries at all.', 'I hear you, and I respect that.', 'That\'s completely fair.'];

// ── Caller energy tracking ──────────────────────────────────────────

export type CallerEnergy = 'high' | 'medium' | 'low';

function estimateCallerEnergy(text: string): CallerEnergy {
  const wordCount = text.split(/\s+/).length;
  const hasExclamation = text.includes('!');
  const hasMultipleSentences = (text.match(/[.!?]+/g) || []).length > 1;

  if (wordCount > 20 || hasExclamation || hasMultipleSentences) return 'high';
  if (wordCount < 5) return 'low';
  return 'medium';
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Intent Detection ────────────────────────────────────────────────

export type DetectedIntent =
  | 'confirm_identity'
  | 'deny_identity'
  | 'spouse_present'
  | 'interested'
  | 'not_interested'
  | 'busy'
  | 'question'
  | 'objection'
  | 'insurer_mention'
  | 'agreement'
  | 'confusion'
  | 'callback_request'
  | 'anger'
  | 'hang_up_intent'
  | 'small_talk'
  | 'unknown';

const INTENT_PATTERNS: { intent: DetectedIntent; patterns: RegExp[]; confidence: number }[] = [
  { intent: 'confirm_identity', patterns: [/^(yes|yeah|yep|yup|that'?s me|speaking|this is)/i], confidence: 0.9 },
  { intent: 'deny_identity', patterns: [/^(no|nope|wrong number|not me|who)/i], confidence: 0.85 },
  { intent: 'spouse_present', patterns: [/(wife|husband|spouse|partner|his wife|her husband)/i], confidence: 0.85 },
  { intent: 'not_interested', patterns: [/(not interested|no thanks|no thank you|don'?t want|stop calling|remove me|take me off)/i], confidence: 0.9 },
  { intent: 'busy', patterns: [/(busy|can'?t talk|bad time|call back|in a meeting|driving)/i], confidence: 0.85 },
  { intent: 'hang_up_intent', patterns: [/(hang up|goodbye|bye|gotta go|let me go|i'?m done)/i], confidence: 0.8 },
  { intent: 'anger', patterns: [/(stop|quit|shut up|leave me alone|damn|hell|pissed|scam)/i], confidence: 0.8 },
  { intent: 'callback_request', patterns: [/(call (me )?back|call later|another time|tomorrow|next week)/i], confidence: 0.85 },
  { intent: 'objection', patterns: [/(too expensive|can'?t afford|happy with|don'?t need|already have|not looking)/i], confidence: 0.8 },
  { intent: 'insurer_mention', patterns: [/(state farm|geico|progressive|allstate|usaa|liberty mutual|farmers|nationwide|esurance|mercury|aaa)/i], confidence: 0.9 },
  { intent: 'agreement', patterns: [/^(ok|okay|sure|alright|sounds good|go ahead|let'?s do it|yes please)/i], confidence: 0.85 },
  { intent: 'question', patterns: [/^(what|who|why|how|when|where|is this|are you|can you|do you)/i], confidence: 0.7 },
  { intent: 'confusion', patterns: [/(what do you mean|i don'?t understand|huh|what'?s this about|confused)/i], confidence: 0.75 },
  { intent: 'small_talk', patterns: [/(how are you|good morning|hello|hi there|hey)/i], confidence: 0.6 },
];

export function detectIntent(text: string): { intent: DetectedIntent; confidence: number } {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return { intent: 'unknown', confidence: 0 };

  for (const { intent, patterns, confidence } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(cleaned)) {
        return { intent, confidence };
      }
    }
  }
  return { intent: 'unknown', confidence: 0.3 };
}

// ── Sentiment Analysis (keyword-based) ──────────────────────────────

export function analyzeSentiment(text: string): { sentiment: SentimentRecord['sentiment']; confidence: number } {
  const cleaned = text.toLowerCase();

  const negativeWords = ['no', 'not', 'don\'t', 'won\'t', 'can\'t', 'stop', 'hate', 'terrible', 'horrible', 'bad', 'scam', 'annoying', 'waste', 'never', 'worst', 'sucks', 'awful', 'useless', 'pointless', 'bother'];
  const frustratedWords = ['frustrated', 'angry', 'pissed', 'ridiculous', 'damn', 'hell', 'stupid', 'leave me alone', 'sick of', 'tired of', 'fed up', 'give me a break', 'unbelievable', 'are you kidding', 'seriously', 'what the'];
  const positiveWords = ['yes', 'great', 'awesome', 'perfect', 'sure', 'love', 'sounds good', 'thank', 'please', 'definitely', 'absolutely', 'wonderful', 'excellent', 'fantastic', 'amazing', 'helpful', 'appreciate', 'sweet', 'nice', 'cool', 'that works', 'let\'s do it', 'go ahead', 'interested'];

  // Detect sarcasm indicators: positive words + negative context markers
  const sarcasmMarkers = ['yeah right', 'oh sure', 'oh great', 'yeah okay', 'oh wonderful', 'oh perfect'];
  const hasSarcasm = sarcasmMarkers.some(m => cleaned.includes(m));

  const frustrated = frustratedWords.filter(w => cleaned.includes(w)).length;
  if (frustrated > 0) return { sentiment: 'frustrated', confidence: Math.min(0.5 + frustrated * 0.2, 0.95) };

  // Short dismissive responses indicate negative sentiment
  const shortDismissals = ['whatever', 'fine', 'uh huh', 'mmm', 'k', 'okay bye'];
  const isDismissive = shortDismissals.some(d => cleaned.trim() === d || cleaned.trim() === d + '.');
  if (isDismissive) return { sentiment: 'negative', confidence: 0.6 };

  const negative = negativeWords.filter(w => cleaned.includes(w)).length;
  const positive = positiveWords.filter(w => cleaned.includes(w)).length;

  // Sarcasm flips positive to negative
  if (hasSarcasm) return { sentiment: 'negative', confidence: 0.7 };

  if (negative > positive + 1) return { sentiment: 'negative', confidence: Math.min(0.4 + negative * 0.15, 0.9) };
  if (positive > negative + 1) return { sentiment: 'positive', confidence: Math.min(0.4 + positive * 0.15, 0.9) };
  if (positive > negative) return { sentiment: 'positive', confidence: 0.55 };
  if (negative > positive) return { sentiment: 'negative', confidence: 0.55 };

  return { sentiment: 'neutral', confidence: 0.5 };
}

// ── Conversation Intelligence Engine ────────────────────────────────

export class ConversationIntelligence {
  private ctx: ConversationContext;
  private callSid: string;

  constructor(callSid: string, maxObjections = 3) {
    this.callSid = callSid;
    this.ctx = {
      state: 'greeting',
      previousState: 'greeting',
      turnCount: 0,
      identityConfirmed: false,
      disclosureGiven: false,
      objectionCount: 0,
      maxObjections: maxObjections,
      rebuttalHistory: [],
      intentHistory: [],
      sentimentHistory: [],
      flags: new Set(),
      questionAsked: false,
      lastAgentText: '',
      lastUserText: '',
      callerEnergy: 'medium',
      consecutiveNegativeSentiments: 0,
      frustrationEscalated: false,
    };
  }

  // Process user speech and return analysis
  processUserTurn(text: string): {
    intent: DetectedIntent;
    sentiment: SentimentRecord['sentiment'];
    suggestedState: ConversationState;
    fillerSuggestion?: string;
    warnings: string[];
  } {
    this.ctx.turnCount++;
    this.ctx.lastUserText = text;
    this.ctx.questionAsked = false;

    const { intent, confidence: intentConf } = detectIntent(text);
    const { sentiment, confidence: sentConf } = analyzeSentiment(text);

    this.ctx.intentHistory.push({
      turn: this.ctx.turnCount,
      intent,
      confidence: intentConf,
      text,
      timestamp: Date.now(),
    });

    this.ctx.sentimentHistory.push({
      turn: this.ctx.turnCount,
      sentiment,
      confidence: sentConf,
      timestamp: Date.now(),
    });

    const warnings: string[] = [];
    let fillerSuggestion: string | undefined;

    // Track caller energy level for adaptive pacing
    this.ctx.callerEnergy = estimateCallerEnergy(text);

    // Track consecutive negative sentiments for frustration escalation
    if (sentiment === 'negative' || sentiment === 'frustrated') {
      this.ctx.consecutiveNegativeSentiments++;
    } else {
      this.ctx.consecutiveNegativeSentiments = 0;
    }

    // Frustration escalation: flag when 2+ consecutive negative sentiments
    if (this.ctx.consecutiveNegativeSentiments >= 2 && !this.ctx.frustrationEscalated) {
      this.ctx.frustrationEscalated = true;
      this.ctx.flags.add('frustration_escalated');
      warnings.push('Caller showing sustained frustration. De-escalate: slow down, acknowledge feelings, offer to end or callback.');
    }

    // State transitions based on intent
    const suggestedState = this.transitionState(intent, text, warnings);

    // Context-aware filler suggestions
    if (this.ctx.frustrationEscalated || sentiment === 'frustrated') {
      fillerSuggestion = randomFrom(DE_ESCALATION_FILLERS);
    } else if (intent === 'agreement' || intent === 'confirm_identity') {
      fillerSuggestion = this.ctx.callerEnergy === 'high' ? randomFrom(EXCITEMENT_FILLERS) : randomFrom(CONFIRMATION_FILLERS);
    } else if (intent === 'objection') {
      fillerSuggestion = randomFrom(EMPATHY_FILLERS);
    } else if (intent === 'question') {
      fillerSuggestion = randomFrom(THINKING_FILLERS);
    } else if (sentiment === 'negative') {
      fillerSuggestion = randomFrom(EMPATHY_FILLERS);
    } else if (sentiment === 'positive') {
      fillerSuggestion = randomFrom(EXCITEMENT_FILLERS);
    }

    // Track objections
    if (intent === 'objection') {
      this.ctx.objectionCount++;
      this.ctx.rebuttalHistory.push({
        turn: this.ctx.turnCount,
        objection: text.substring(0, 200),
        rebuttalType: this.getRebuttalType(text),
        timestamp: Date.now(),
      });

      if (this.ctx.objectionCount >= this.ctx.maxObjections) {
        warnings.push(`Max objections reached (${this.ctx.maxObjections}). Consider wrapping up.`);
      }
    }

    // Insurer detection
    if (intent === 'insurer_mention') {
      const match = text.match(/(state farm|geico|progressive|allstate|usaa|liberty mutual|farmers|nationwide|esurance|mercury|aaa)/i);
      if (match) {
        this.ctx.currentInsurer = match[1];
        this.ctx.flags.add('insurer_captured');
      }
    }

    // Anger/hang-up escalation
    if (intent === 'anger' || intent === 'hang_up_intent') {
      warnings.push('Caller may hang up. De-escalate or end gracefully.');
    }

    logger.debug('conversation', 'User turn processed', {
      callSid: this.callSid,
      turn: this.ctx.turnCount,
      intent,
      sentiment,
      state: suggestedState,
      objections: this.ctx.objectionCount,
    });

    return { intent, sentiment, suggestedState, fillerSuggestion, warnings };
  }

  processAgentTurn(text: string): void {
    this.ctx.lastAgentText = text;
    // Track if agent asked a question
    if (text.includes('?')) {
      this.ctx.questionAsked = true;
    }
  }

  private transitionState(intent: DetectedIntent, text: string, warnings: string[]): ConversationState {
    const prev = this.ctx.state;
    let next = prev;

    switch (prev) {
      case 'greeting':
        if (intent === 'confirm_identity') {
          this.ctx.identityConfirmed = true;
          next = 'disclosure';
        } else if (intent === 'deny_identity') {
          next = 'identity_check';
        } else if (intent === 'not_interested' || intent === 'hang_up_intent') {
          next = 'farewell';
        }
        break;

      case 'identity_check':
        if (intent === 'confirm_identity' || intent === 'spouse_present' || intent === 'agreement') {
          this.ctx.identityConfirmed = true;
          next = 'disclosure';
        } else if (intent === 'not_interested' || intent === 'hang_up_intent') {
          next = 'farewell';
        }
        break;

      case 'disclosure':
        this.ctx.disclosureGiven = true;
        next = 'purpose';
        break;

      case 'purpose':
        if (intent === 'agreement' || intent === 'confirm_identity') {
          next = 'insurance_question';
        } else if (intent === 'objection' || intent === 'not_interested') {
          next = 'objection_handling';
        }
        break;

      case 'insurance_question':
        if (intent === 'insurer_mention') {
          next = 'excitement_build';
        } else if (intent === 'agreement') {
          next = 'qualifying';
        } else if (intent === 'objection') {
          next = 'objection_handling';
        }
        break;

      case 'excitement_build':
        next = 'qualifying';
        break;

      case 'qualifying':
        if (intent === 'agreement') {
          next = 'transfer_prep';
        } else if (intent === 'objection') {
          next = 'objection_handling';
        } else if (intent === 'not_interested' || intent === 'hang_up_intent') {
          next = this.ctx.objectionCount < this.ctx.maxObjections ? 'objection_handling' : 'farewell';
        }
        break;

      case 'objection_handling':
        if (intent === 'agreement') {
          next = this.ctx.currentInsurer ? 'qualifying' : 'insurance_question';
        } else if (intent === 'not_interested' || intent === 'hang_up_intent' || intent === 'anger') {
          if (this.ctx.objectionCount >= this.ctx.maxObjections) {
            next = 'farewell';
          }
        }
        break;

      case 'transfer_prep':
        next = 'transferring';
        break;

      case 'transferring':
        // Stay in transferring until explicitly ended
        break;

      case 'farewell':
        next = 'ended';
        break;
    }

    // Global overrides
    if ((intent === 'anger' || intent === 'hang_up_intent') && this.ctx.objectionCount >= this.ctx.maxObjections) {
      next = 'farewell';
    }
    if (intent === 'busy' || intent === 'callback_request') {
      warnings.push('Caller wants a callback. Consider scheduling.');
      this.ctx.flags.add('callback_requested');
    }

    if (next !== prev) {
      this.ctx.previousState = prev;
      this.ctx.state = next;
    }

    return next;
  }

  private getRebuttalType(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('expensive') || lower.includes('afford') || lower.includes('cost')) return 'price';
    if (lower.includes('happy with') || lower.includes('already have') || lower.includes('satisfied')) return 'satisfied';
    if (lower.includes('don\'t need') || lower.includes('not looking')) return 'no_need';
    if (lower.includes('busy') || lower.includes('time')) return 'timing';
    if (lower.includes('trust') || lower.includes('scam') || lower.includes('legitimate')) return 'trust';
    return 'general';
  }

  // ── Getters ──

  getState(): ConversationState { return this.ctx.state; }
  getContext(): Readonly<ConversationContext> { return this.ctx; }
  getObjectionCount(): number { return this.ctx.objectionCount; }
  getIntentHistory(): IntentRecord[] { return [...this.ctx.intentHistory]; }
  getSentimentHistory(): SentimentRecord[] { return [...this.ctx.sentimentHistory]; }
  isQuestionAsked(): boolean { return this.ctx.questionAsked; }
  getFlags(): string[] { return Array.from(this.ctx.flags); }
  getCurrentInsurer(): string | undefined { return this.ctx.currentInsurer; }
  getCallerEnergy(): CallerEnergy { return this.ctx.callerEnergy; }
  isFrustrationEscalated(): boolean { return this.ctx.frustrationEscalated; }
  getConsecutiveNegativeSentiments(): number { return this.ctx.consecutiveNegativeSentiments; }
}
