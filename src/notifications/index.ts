// ── Notification Service ───────────────────────────────────────────
// Sends internal notifications when key events happen:
// - SMS notification to owner phone (9547905093) on text, email, or callback events
// - Email notification to info@quotingfast.com on callback scheduled
// - Uses Twilio for SMS and SendGrid (if configured) for email

import { logger } from '../utils/logger';
import { sendSms } from '../twilio/client';
import { logSms } from '../sms';
import { config } from '../config';

// ── Configuration ─────────────────────────────────────────────────

export interface NotificationConfig {
  ownerPhone: string;           // Phone number to receive all notification texts
  ownerEmail: string;           // Email to receive callback notifications
  sendgridApiKey: string;       // SendGrid API key (optional, for email)
  senderEmail: string;          // From email for SendGrid
  enabled: boolean;             // Master enable/disable
}

const notificationConfig: NotificationConfig = {
  ownerPhone: process.env.NOTIFICATION_PHONE || '+19547905093',
  ownerEmail: process.env.NOTIFICATION_EMAIL || 'info@quotingfast.com',
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  senderEmail: process.env.NOTIFICATION_SENDER_EMAIL || 'notifications@quotingfast.com',
  enabled: true,
};

// ── Notification Types ────────────────────────────────────────────

export type NotificationEventType =
  | 'scheduling_text_sent'
  | 'scheduling_email_sent'
  | 'callback_scheduled'
  | 'callback_executing'
  | 'callback_failed';

export interface NotificationLogEntry {
  id: string;
  eventType: NotificationEventType;
  prospectPhone: string;
  prospectName: string;
  message: string;
  smsNotificationSent: boolean;
  emailNotificationSent: boolean;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ── Store ─────────────────────────────────────────────────────────

const notificationLog: NotificationLogEntry[] = [];
const MAX_LOG = 500;

export function getNotificationLog(limit = 50): NotificationLogEntry[] {
  return notificationLog.slice(0, limit);
}

export function getNotificationConfig(): NotificationConfig {
  return { ...notificationConfig };
}

export function updateNotificationConfig(updates: Partial<NotificationConfig>): NotificationConfig {
  Object.assign(notificationConfig, updates);
  return { ...notificationConfig };
}

// ── SMS Notification ──────────────────────────────────────────────

async function sendNotificationSms(body: string): Promise<boolean> {
  if (!notificationConfig.enabled || !notificationConfig.ownerPhone) {
    logger.info('notifications', 'SMS notification skipped (disabled or no phone)', { body: body.substring(0, 80) });
    return false;
  }

  try {
    const result = await sendSms(notificationConfig.ownerPhone, body);
    logSms({
      phone: notificationConfig.ownerPhone,
      direction: 'outbound',
      status: 'sent',
      body,
      twilioSid: result.sid,
      triggerReason: 'internal_notification',
    });
    logger.info('notifications', 'SMS notification sent', { to: notificationConfig.ownerPhone, sid: result.sid });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('notifications', 'SMS notification failed', { error: msg });
    return false;
  }
}

// ── Email Notification ────────────────────────────────────────────

async function sendNotificationEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!notificationConfig.enabled) {
    logger.info('notifications', 'Email notification skipped (disabled)');
    return false;
  }

  if (!notificationConfig.sendgridApiKey) {
    logger.info('notifications', 'Email notification logged (SendGrid not configured)', { to, subject, body: body.substring(0, 100) });
    // Still return true as the intent was recorded
    return false;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notificationConfig.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: notificationConfig.senderEmail, name: 'Quoting Fast Notifications' },
        subject,
        content: [{ type: 'text/plain', value: body }],
      }),
    });

    if (response.ok || response.status === 202) {
      logger.info('notifications', 'Email notification sent via SendGrid', { to, subject });
      return true;
    } else {
      const errText = await response.text();
      logger.error('notifications', 'SendGrid email failed', { status: response.status, error: errText });
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('notifications', 'Email notification error', { error: msg });
    return false;
  }
}

// ── Send Email to Prospect ────────────────────────────────────────

export async function sendProspectEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!notificationConfig.sendgridApiKey) {
    logger.info('notifications', 'Prospect email logged (SendGrid not configured)', { to, subject });
    return false;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notificationConfig.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: notificationConfig.senderEmail, name: 'Quoting Fast' },
        subject,
        content: [{ type: 'text/html', value: body }],
      }),
    });

    if (response.ok || response.status === 202) {
      logger.info('notifications', 'Prospect email sent', { to, subject });
      return true;
    } else {
      const errText = await response.text();
      logger.error('notifications', 'Prospect email failed', { status: response.status, error: errText });
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('notifications', 'Prospect email error', { error: msg });
    return false;
  }
}

// ── Public Notification Functions ─────────────────────────────────

/**
 * Notify when a scheduling text was sent to a prospect.
 */
export async function notifySchedulingTextSent(prospectPhone: string, prospectName: string): Promise<void> {
  const smsBody = `[Quoting Fast] Scheduling text sent to ${prospectName} (${prospectPhone}). They were invited to learn more and schedule a meeting at quotingfast.com.`;

  const smsSent = await sendNotificationSms(smsBody);

  const emailSubject = `Scheduling Text Sent: ${prospectName} (${prospectPhone})`;
  const emailBody = `A scheduling text was sent to a prospect.\n\nProspect: ${prospectName}\nPhone: ${prospectPhone}\nAction: Sent text with quotingfast.com scheduling link\nTime: ${new Date().toISOString()}\n\n-- Quoting Fast AI Agent`;
  const emailSent = await sendNotificationEmail(notificationConfig.ownerEmail, emailSubject, emailBody);

  const entry: NotificationLogEntry = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    eventType: 'scheduling_text_sent',
    prospectPhone,
    prospectName,
    message: smsBody,
    smsNotificationSent: smsSent,
    emailNotificationSent: emailSent,
    timestamp: new Date().toISOString(),
  };
  notificationLog.unshift(entry);
  if (notificationLog.length > MAX_LOG) notificationLog.length = MAX_LOG;
}

/**
 * Notify when a scheduling email was sent to a prospect.
 */
export async function notifySchedulingEmailSent(prospectPhone: string, prospectName: string, prospectEmail: string): Promise<void> {
  const smsBody = `[Quoting Fast] Scheduling email sent to ${prospectName} (${prospectEmail}). They were invited to learn more and schedule a meeting at quotingfast.com.`;

  const smsSent = await sendNotificationSms(smsBody);

  const emailSubject = `Scheduling Email Sent: ${prospectName} (${prospectEmail})`;
  const emailBody = `A scheduling email was sent to a prospect.\n\nProspect: ${prospectName}\nPhone: ${prospectPhone}\nEmail: ${prospectEmail}\nAction: Sent email with quotingfast.com scheduling link\nTime: ${new Date().toISOString()}\n\n-- Quoting Fast AI Agent`;
  const emailSent = await sendNotificationEmail(notificationConfig.ownerEmail, emailSubject, emailBody);

  const entry: NotificationLogEntry = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    eventType: 'scheduling_email_sent',
    prospectPhone,
    prospectName,
    message: smsBody,
    smsNotificationSent: smsSent,
    emailNotificationSent: emailSent,
    timestamp: new Date().toISOString(),
    details: { prospectEmail },
  };
  notificationLog.unshift(entry);
  if (notificationLog.length > MAX_LOG) notificationLog.length = MAX_LOG;
}

/**
 * Notify when a callback was scheduled.
 * Sends SMS to owner phone AND email to owner email.
 */
export async function notifyCallbackScheduled(
  prospectPhone: string,
  prospectName: string,
  callbackTime: string,
): Promise<void> {
  const smsBody = `[Quoting Fast] Callback scheduled! ${prospectName} (${prospectPhone}) requested a callback for ${callbackTime}. The system will call them back automatically.`;

  const smsSent = await sendNotificationSms(smsBody);

  const emailSubject = `Callback Scheduled: ${prospectName} (${prospectPhone})`;
  const emailBody = `A callback has been scheduled on the Quoting Fast system.\n\nProspect: ${prospectName}\nPhone: ${prospectPhone}\nRequested Time: ${callbackTime}\n\nThe system will automatically call them back at the scheduled time.\n\n-- Quoting Fast AI Outbound Agent`;

  const emailSent = await sendNotificationEmail(notificationConfig.ownerEmail, emailSubject, emailBody);

  const entry: NotificationLogEntry = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    eventType: 'callback_scheduled',
    prospectPhone,
    prospectName,
    message: smsBody,
    smsNotificationSent: smsSent,
    emailNotificationSent: emailSent,
    timestamp: new Date().toISOString(),
    details: { callbackTime },
  };
  notificationLog.unshift(entry);
  if (notificationLog.length > MAX_LOG) notificationLog.length = MAX_LOG;
}

/**
 * Notify when a scheduled callback is being executed (dialing the prospect).
 */
export async function notifyCallbackExecuting(
  prospectPhone: string,
  prospectName: string,
  attempt: number,
  maxAttempts: number,
): Promise<void> {
  const smsBody = `[Quoting Fast] Callback executing: Dialing ${prospectName} (${prospectPhone}) now. Attempt ${attempt} of ${maxAttempts}.`;
  const smsSent = await sendNotificationSms(smsBody);

  const emailSubject = `Callback Executing: ${prospectName} (${prospectPhone})`;
  const emailBody = `A scheduled callback is now being executed.\n\nProspect: ${prospectName}\nPhone: ${prospectPhone}\nAttempt: ${attempt} of ${maxAttempts}\nTime: ${new Date().toISOString()}\n\n-- Quoting Fast AI Agent`;
  const emailSent = await sendNotificationEmail(notificationConfig.ownerEmail, emailSubject, emailBody);

  const entry: NotificationLogEntry = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    eventType: 'callback_executing',
    prospectPhone,
    prospectName,
    message: smsBody,
    smsNotificationSent: smsSent,
    emailNotificationSent: emailSent,
    timestamp: new Date().toISOString(),
    details: { attempt, maxAttempts },
  };
  notificationLog.unshift(entry);
  if (notificationLog.length > MAX_LOG) notificationLog.length = MAX_LOG;
}

/**
 * Notify when a callback has failed after exhausting all attempts.
 */
export async function notifyCallbackFailed(
  prospectPhone: string,
  prospectName: string,
  totalAttempts: number,
): Promise<void> {
  const smsBody = `[Quoting Fast] CALLBACK FAILED: Could not reach ${prospectName} (${prospectPhone}) after ${totalAttempts} attempts. Manual follow-up may be needed.`;
  const smsSent = await sendNotificationSms(smsBody);

  const emailSubject = `CALLBACK FAILED: ${prospectName} (${prospectPhone})`;
  const emailBody = `A scheduled callback has failed after exhausting all retry attempts.\n\nProspect: ${prospectName}\nPhone: ${prospectPhone}\nTotal Attempts: ${totalAttempts}\nStatus: FAILED — manual follow-up recommended\nTime: ${new Date().toISOString()}\n\n-- Quoting Fast AI Agent`;
  const emailSent = await sendNotificationEmail(notificationConfig.ownerEmail, emailSubject, emailBody);

  const entry: NotificationLogEntry = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    eventType: 'callback_failed',
    prospectPhone,
    prospectName,
    message: smsBody,
    smsNotificationSent: smsSent,
    emailNotificationSent: emailSent,
    timestamp: new Date().toISOString(),
    details: { totalAttempts },
  };
  notificationLog.unshift(entry);
  if (notificationLog.length > MAX_LOG) notificationLog.length = MAX_LOG;
}
