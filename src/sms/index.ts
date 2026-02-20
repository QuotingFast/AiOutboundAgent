import { logger } from '../utils/logger';

// ── SMS Log & Management ───────────────────────────────────────────

export type SmsDirection = 'outbound' | 'inbound';
export type SmsStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'received';

export interface SmsLogEntry {
  id: string;
  phone: string;
  direction: SmsDirection;
  status: SmsStatus;
  body: string;
  templateId?: string;
  triggerReason?: string;    // e.g. 'missed_call', 'callback_reminder', 'post_transfer', 'manual'
  twilioSid?: string;
  leadName?: string;
  timestamp: string;
  error?: string;
}

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  category: 'missed_call' | 'callback_reminder' | 'post_transfer' | 'text_me_instead' | 'custom';
  active: boolean;
  createdAt: string;
}

// ── Store ──

const smsLog: SmsLogEntry[] = [];
const MAX_SMS_LOG = 5000;
const smsTemplates: SmsTemplate[] = [];

// Initialize default templates
function initDefaultTemplates(): void {
  if (smsTemplates.length > 0) return;

  smsTemplates.push(
    {
      id: 'tpl-missed-call',
      name: 'Missed Call Follow-up',
      body: 'Hi {{first_name}}, we just tried reaching you about your auto insurance quote. Call us back or reply to this text when you have a moment! - {{company_name}}',
      category: 'missed_call',
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'tpl-callback-reminder',
      name: 'Callback Reminder',
      body: 'Hi {{first_name}}, this is a reminder that we have a callback scheduled for {{callback_time}}. We\'ll be giving you a ring about your insurance quote! - {{company_name}}',
      category: 'callback_reminder',
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'tpl-post-transfer',
      name: 'Post-Transfer Confirmation',
      body: 'Thanks for your time, {{first_name}}! You\'ve been connected with a licensed agent who can finalize your quote. If you have any questions, just text back. - {{company_name}}',
      category: 'post_transfer',
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'tpl-text-me',
      name: 'Text Me Instead',
      body: 'No problem, {{first_name}}! Here\'s a quick summary: We found some great rates for auto insurance in {{state}}. When you\'re ready to chat, just call us or reply here. - {{company_name}}',
      category: 'text_me_instead',
      active: true,
      createdAt: new Date().toISOString(),
    },
  );
}

initDefaultTemplates();

// ── SMS Log ──

export function logSms(entry: Omit<SmsLogEntry, 'id' | 'timestamp'>): SmsLogEntry {
  const full: SmsLogEntry = {
    ...entry,
    id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  smsLog.push(full);
  if (smsLog.length > MAX_SMS_LOG) {
    smsLog.splice(0, smsLog.length - MAX_SMS_LOG);
  }
  logger.info('sms', `SMS logged: ${full.direction} to ${full.phone}`, { id: full.id, status: full.status });
  return full;
}

export function updateSmsStatus(id: string, status: SmsStatus, twilioSid?: string, error?: string): void {
  const entry = smsLog.find(s => s.id === id);
  if (entry) {
    entry.status = status;
    if (twilioSid) entry.twilioSid = twilioSid;
    if (error) entry.error = error;
  }
}

export function getSmsLog(opts?: { phone?: string; direction?: SmsDirection; limit?: number }): SmsLogEntry[] {
  let entries = [...smsLog];
  if (opts?.phone) entries = entries.filter(s => s.phone === opts.phone);
  if (opts?.direction) entries = entries.filter(s => s.direction === opts.direction);
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (opts?.limit) entries = entries.slice(0, opts.limit);
  return entries;
}

export function getSmsLogForLead(phone: string): SmsLogEntry[] {
  return smsLog
    .filter(s => s.phone === phone)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function getSmsStats(): { total: number; sent: number; received: number; failed: number } {
  return {
    total: smsLog.length,
    sent: smsLog.filter(s => s.direction === 'outbound' && s.status !== 'failed').length,
    received: smsLog.filter(s => s.direction === 'inbound').length,
    failed: smsLog.filter(s => s.status === 'failed').length,
  };
}

// ── Templates ──

export function getTemplates(category?: string): SmsTemplate[] {
  if (category) return smsTemplates.filter(t => t.category === category);
  return [...smsTemplates];
}

export function getTemplate(id: string): SmsTemplate | undefined {
  return smsTemplates.find(t => t.id === id);
}

export function createTemplate(opts: Omit<SmsTemplate, 'id' | 'createdAt'>): SmsTemplate {
  const tpl: SmsTemplate = {
    ...opts,
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };
  smsTemplates.push(tpl);
  return tpl;
}

export function updateTemplate(id: string, updates: Partial<Pick<SmsTemplate, 'name' | 'body' | 'active'>>): SmsTemplate | undefined {
  const tpl = smsTemplates.find(t => t.id === id);
  if (!tpl) return undefined;
  if (updates.name !== undefined) tpl.name = updates.name;
  if (updates.body !== undefined) tpl.body = updates.body;
  if (updates.active !== undefined) tpl.active = updates.active;
  return tpl;
}

export function deleteTemplate(id: string): boolean {
  const idx = smsTemplates.findIndex(t => t.id === id);
  if (idx >= 0) { smsTemplates.splice(idx, 1); return true; }
  return false;
}

/**
 * Render a template body with variable substitution.
 */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  let rendered = body;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return rendered;
}
