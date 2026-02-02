import { logger } from '../utils/logger';
import { config } from '../config';
import { CallAnalyticsData } from '../analytics';

// ── Webhook System ──────────────────────────────────────────────────

export interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  headers?: Record<string, string>;
  secret?: string;
}

export type WebhookEvent =
  | 'call.started'
  | 'call.ended'
  | 'call.transferred'
  | 'call.scored'
  | 'transcript.complete'
  | 'objection.detected'
  | 'callback.requested'
  | 'dnc.requested';

const webhookConfigs: WebhookConfig[] = [];

export function registerWebhook(webhook: WebhookConfig): void {
  const existing = webhookConfigs.findIndex(w => w.id === webhook.id);
  if (existing >= 0) {
    webhookConfigs[existing] = webhook;
  } else {
    webhookConfigs.push(webhook);
  }
  logger.info('workflows', 'Webhook registered', { id: webhook.id, events: webhook.events });
}

export function removeWebhook(id: string): boolean {
  const idx = webhookConfigs.findIndex(w => w.id === id);
  if (idx >= 0) {
    webhookConfigs.splice(idx, 1);
    return true;
  }
  return false;
}

export function getWebhooks(): WebhookConfig[] {
  return [...webhookConfigs];
}

export async function fireWebhook(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  const targets = webhookConfigs.filter(w => w.active && w.events.includes(event));
  if (targets.length === 0) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  for (const webhook of targets) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(webhook.headers || {}),
      };
      if (webhook.secret) {
        headers['X-Webhook-Secret'] = webhook.secret;
      }

      const res = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      logger.info('workflows', 'Webhook fired', {
        id: webhook.id,
        event,
        status: res.status,
        ok: res.ok,
      });
    } catch (err) {
      logger.error('workflows', 'Webhook failed', {
        id: webhook.id,
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Call Scoring ─────────────────────────────────────────────────────

export interface ScoringRule {
  id: string;
  name: string;
  condition: (data: CallAnalyticsData) => boolean;
  points: number;
}

const defaultScoringRules: ScoringRule[] = [
  {
    id: 'transferred',
    name: 'Call transferred to agent',
    condition: (d) => d.outcome === 'transferred',
    points: 30,
  },
  {
    id: 'duration_30s',
    name: 'Call lasted 30+ seconds',
    condition: (d) => (d.durationMs || 0) > 30000,
    points: 10,
  },
  {
    id: 'duration_60s',
    name: 'Call lasted 60+ seconds',
    condition: (d) => (d.durationMs || 0) > 60000,
    points: 10,
  },
  {
    id: 'multi_turn',
    name: '4+ turn conversation',
    condition: (d) => d.turnCount >= 4,
    points: 10,
  },
  {
    id: 'low_interruptions',
    name: 'Few interruptions (<3)',
    condition: (d) => d.interruptions < 3,
    points: 5,
  },
  {
    id: 'positive_sentiment',
    name: 'Mostly positive sentiment',
    condition: (d) => {
      const last3 = d.sentiment.slice(-3);
      return last3.filter(s => s.sentiment === 'positive').length >= 2;
    },
    points: 15,
  },
  {
    id: 'low_latency',
    name: 'Average latency under 500ms',
    condition: (d) => d.avgLatencyMs < 500 && d.avgLatencyMs > 0,
    points: 5,
  },
  {
    id: 'no_anger',
    name: 'No frustrated/angry sentiment',
    condition: (d) => !d.sentiment.some(s => s.sentiment === 'frustrated'),
    points: 10,
  },
  {
    id: 'insurer_captured',
    name: 'Current insurer identified',
    condition: (d) => d.tags.includes('insurer_captured'),
    points: 5,
  },
];

export function scoreCall(data: CallAnalyticsData): { score: number; breakdown: { rule: string; points: number; passed: boolean }[] } {
  let score = 0;
  const breakdown: { rule: string; points: number; passed: boolean }[] = [];

  for (const rule of defaultScoringRules) {
    const passed = rule.condition(data);
    if (passed) score += rule.points;
    breakdown.push({ rule: rule.name, points: passed ? rule.points : 0, passed });
  }

  return { score: Math.min(100, score), breakdown };
}

// ── Call Tagging ─────────────────────────────────────────────────────

export interface TagRule {
  tag: string;
  condition: (data: CallAnalyticsData) => boolean;
}

const autoTagRules: TagRule[] = [
  { tag: 'hot_lead', condition: (d) => d.outcome === 'transferred' },
  { tag: 'callback_requested', condition: (d) => d.tags.includes('callback_requested') },
  { tag: 'objection_handled', condition: (d) => d.tags.includes('objection_handled') },
  { tag: 'short_call', condition: (d) => (d.durationMs || 0) < 15000 },
  { tag: 'long_call', condition: (d) => (d.durationMs || 0) > 120000 },
  { tag: 'high_latency', condition: (d) => d.avgLatencyMs > 1000 },
  { tag: 'dropped', condition: (d) => d.outcome === 'dropped' },
  { tag: 'dnc_request', condition: (d) => d.tags.includes('dnc_request') },
  { tag: 'not_interested', condition: (d) => d.endReason?.includes('not interested') || false },
  { tag: 'angry_caller', condition: (d) => d.sentiment.some(s => s.sentiment === 'frustrated') },
];

export function autoTagCall(data: CallAnalyticsData): string[] {
  const tags: string[] = [...data.tags];
  for (const rule of autoTagRules) {
    if (rule.condition(data) && !tags.includes(rule.tag)) {
      tags.push(rule.tag);
    }
  }
  return tags;
}

// ── SMS Follow-up (via Twilio) ──────────────────────────────────────

export interface SMSFollowUp {
  to: string;
  body: string;
  trigger: 'post_call' | 'callback' | 'not_interested' | 'transferred';
  delayMs: number;
}

const smsTemplates: Record<string, string> = {
  post_call: 'Hey {{name}}! Thanks for chatting with us at {{company}}. If you have any questions about your auto insurance quote, feel free to text us back here!',
  callback: 'Hey {{name}}, this is {{agent}} from {{company}}. Looks like we missed you earlier — feel free to call us back at your convenience, or reply here and I can set up a time!',
  transferred: 'Hey {{name}}! Just wanted to follow up — our licensed agent should have everything squared away. Reach out if you need anything!',
  not_interested: 'No worries {{name}}! If you ever change your mind about auto insurance savings, we\'re here to help. -{{company}}',
};

const pendingSMS: SMSFollowUp[] = [];

export async function sendSMS(to: string, body: string, from?: string): Promise<boolean> {
  try {
    const twilio = (await import('twilio')).default;
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);
    const fromNumber = from || config.twilio.fromNumber;

    if (!fromNumber) {
      logger.warn('workflows', 'No FROM number for SMS', { to });
      return false;
    }

    await client.messages.create({
      to,
      from: fromNumber,
      body,
    });

    logger.info('workflows', 'SMS sent', { to, bodyLength: body.length });
    return true;
  } catch (err) {
    logger.error('workflows', 'SMS failed', {
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function scheduleSMS(sms: SMSFollowUp): void {
  pendingSMS.push(sms);
  setTimeout(async () => {
    await sendSMS(sms.to, sms.body);
    const idx = pendingSMS.indexOf(sms);
    if (idx >= 0) pendingSMS.splice(idx, 1);
  }, sms.delayMs);
  logger.info('workflows', 'SMS scheduled', { to: sms.to, trigger: sms.trigger, delayMs: sms.delayMs });
}

export function formatSMSTemplate(
  template: string,
  vars: { name?: string; agent?: string; company?: string }
): string {
  return template
    .replace(/\{\{name\}\}/g, vars.name || 'there')
    .replace(/\{\{agent\}\}/g, vars.agent || 'Alex')
    .replace(/\{\{company\}\}/g, vars.company || 'QuotingFast');
}

export function getSMSTemplate(trigger: string): string | undefined {
  return smsTemplates[trigger];
}

// ── Post-call Workflow Runner ───────────────────────────────────────

export interface PostCallWorkflowConfig {
  enableWebhooks: boolean;
  enableSMS: boolean;
  enableAutoTag: boolean;
  enableScoring: boolean;
  smsFollowUpDelayMs: number;
  smsFollowUpTriggers: string[];
}

const workflowConfig: PostCallWorkflowConfig = {
  enableWebhooks: true,
  enableSMS: false,    // Off by default, needs explicit enable
  enableAutoTag: true,
  enableScoring: true,
  smsFollowUpDelayMs: 30000,  // 30 seconds after call
  smsFollowUpTriggers: ['transferred', 'callback'],
};

export function getWorkflowConfig(): PostCallWorkflowConfig {
  return { ...workflowConfig };
}

export function updateWorkflowConfig(updates: Partial<PostCallWorkflowConfig>): PostCallWorkflowConfig {
  Object.assign(workflowConfig, updates);
  return { ...workflowConfig };
}

export async function runPostCallWorkflow(
  analyticsData: CallAnalyticsData,
  leadPhone: string,
  leadName: string,
  agentName: string,
  companyName: string,
): Promise<void> {
  logger.info('workflows', 'Running post-call workflow', {
    callSid: analyticsData.callSid,
    outcome: analyticsData.outcome,
  });

  // Auto-tag
  if (workflowConfig.enableAutoTag) {
    const tags = autoTagCall(analyticsData);
    analyticsData.tags = tags;
  }

  // Score
  if (workflowConfig.enableScoring) {
    const { score } = scoreCall(analyticsData);
    analyticsData.score = score;
  }

  // Webhooks
  if (workflowConfig.enableWebhooks) {
    await fireWebhook('call.ended', {
      callSid: analyticsData.callSid,
      outcome: analyticsData.outcome,
      duration: analyticsData.durationMs,
      score: analyticsData.score,
      tags: analyticsData.tags,
      cost: analyticsData.costEstimate,
    });

    if (analyticsData.outcome === 'transferred') {
      await fireWebhook('call.transferred', {
        callSid: analyticsData.callSid,
        route: analyticsData.transferRoute,
        leadPhone,
        leadName,
      });
    }

    await fireWebhook('transcript.complete', {
      callSid: analyticsData.callSid,
      transcript: analyticsData.transcript,
    });
  }

  // SMS follow-up
  if (workflowConfig.enableSMS && workflowConfig.smsFollowUpTriggers.includes(analyticsData.outcome)) {
    const template = getSMSTemplate(analyticsData.outcome);
    if (template) {
      const body = formatSMSTemplate(template, {
        name: leadName,
        agent: agentName,
        company: companyName,
      });
      scheduleSMS({
        to: leadPhone,
        body,
        trigger: analyticsData.outcome as SMSFollowUp['trigger'],
        delayMs: workflowConfig.smsFollowUpDelayMs,
      });
    }
  }
}
