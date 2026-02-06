import { logger } from '../utils/logger';
import { resolveFeatureFlag, FEATURE_AI_CALL_NOTES } from './flags';
import { config } from '../config';

// ── FEATURE_AI_CALL_NOTES ──────────────────────────────────────────
// When enabled, AI-generated summaries, objections, and intent scores
// are produced asynchronously on call completion.
// Notes are stored per call, editable, and never block the call flow.

export interface CallNote {
  id: string;
  callSid: string;
  leadId: string;          // phone number
  summary: string;
  objections: string[];
  intentScore: number;      // 0-100, higher = more likely to convert
  keyTopics: string[];
  generatedAt: string;
  editedAt?: string;
  editedBy?: string;
  status: 'generating' | 'completed' | 'failed' | 'edited';
}

// In-memory store: callSid -> CallNote
const notesStore = new Map<string, CallNote>();
let noteSequence = 0;

// ── AI summary generation ──────────────────────────────────────────

/**
 * Generate AI call notes asynchronously. Never blocks call flow.
 * Uses OpenAI API to analyze the transcript and produce a summary.
 */
export async function generateCallNotes(params: {
  callSid: string;
  leadId: string;
  transcript: Array<{ role: string; text: string }>;
  outcome: string;
  tags: string[];
  workspaceId?: string;
  campaignId?: string;
}): Promise<CallNote | null> {
  // Feature flag check
  if (!resolveFeatureFlag(FEATURE_AI_CALL_NOTES, params.workspaceId, params.campaignId)) {
    return null;
  }

  if (!params.transcript || params.transcript.length === 0) {
    return null;
  }

  const noteId = `note-${++noteSequence}`;
  const placeholder: CallNote = {
    id: noteId,
    callSid: params.callSid,
    leadId: params.leadId,
    summary: '',
    objections: [],
    intentScore: 0,
    keyTopics: [],
    generatedAt: new Date().toISOString(),
    status: 'generating',
  };
  notesStore.set(params.callSid, placeholder);

  // Run generation asynchronously — never block
  generateNotesAsync(params, noteId).catch(err => {
    logger.error('features', 'Call notes generation failed', {
      callSid: params.callSid,
      error: err instanceof Error ? err.message : String(err),
    });
    const note = notesStore.get(params.callSid);
    if (note && note.status === 'generating') {
      note.status = 'failed';
    }
  });

  return placeholder;
}

async function generateNotesAsync(params: {
  callSid: string;
  leadId: string;
  transcript: Array<{ role: string; text: string }>;
  outcome: string;
  tags: string[];
}, noteId: string): Promise<void> {
  const transcriptText = params.transcript
    .map(t => `${t.role}: ${t.text}`)
    .join('\n');

  const prompt = `Analyze this outbound sales call transcript and provide a JSON response with:
1. "summary": A 2-3 sentence summary of the call
2. "objections": Array of specific objections raised by the prospect (empty array if none)
3. "intentScore": 0-100 score of how likely the prospect is to convert (0=not at all, 100=definitely)
4. "keyTopics": Array of key topics discussed

Call outcome: ${params.outcome}
Tags: ${params.tags.join(', ')}

Transcript:
${transcriptText}

Respond ONLY with valid JSON, no markdown.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON from the response
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Failed to parse AI response as JSON');
      }
    }

    const note = notesStore.get(params.callSid);
    if (note) {
      note.summary = parsed.summary || 'No summary generated';
      note.objections = Array.isArray(parsed.objections) ? parsed.objections : [];
      note.intentScore = typeof parsed.intentScore === 'number' ? Math.min(100, Math.max(0, parsed.intentScore)) : 0;
      note.keyTopics = Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [];
      note.status = 'completed';
      logger.info('features', 'Call notes generated', {
        callSid: params.callSid,
        intentScore: note.intentScore,
        objectionsCount: note.objections.length,
      });
    }
  } catch (err) {
    const note = notesStore.get(params.callSid);
    if (note) {
      note.status = 'failed';
      note.summary = `Generation failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    throw err;
  }
}

// ── Notes management ───────────────────────────────────────────────

/**
 * Get call notes for a specific call.
 */
export function getCallNotes(callSid: string): CallNote | undefined {
  return notesStore.get(callSid);
}

/**
 * Get all call notes, optionally filtered by lead.
 */
export function getAllCallNotes(leadId?: string): CallNote[] {
  const all = Array.from(notesStore.values());
  if (leadId) {
    const normalized = leadId.replace(/\D/g, '').replace(/^1/, '');
    return all.filter(n => n.leadId.replace(/\D/g, '').replace(/^1/, '') === normalized);
  }
  return all;
}

/**
 * Edit call notes manually. Preserves the original AI-generated content in history.
 */
export function editCallNotes(
  callSid: string,
  updates: { summary?: string; objections?: string[]; intentScore?: number; keyTopics?: string[] },
  editedBy?: string,
): CallNote | null {
  const note = notesStore.get(callSid);
  if (!note) return null;

  if (updates.summary !== undefined) note.summary = updates.summary;
  if (updates.objections !== undefined) note.objections = updates.objections;
  if (updates.intentScore !== undefined) note.intentScore = Math.min(100, Math.max(0, updates.intentScore));
  if (updates.keyTopics !== undefined) note.keyTopics = updates.keyTopics;

  note.editedAt = new Date().toISOString();
  note.editedBy = editedBy || 'manual';
  note.status = 'edited';

  logger.info('features', 'Call notes edited', { callSid, editedBy });
  return note;
}
