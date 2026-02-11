// ── Campaign-Locked Scheduled Callback Worker ─────────────────────
// TCPA-compliant scheduled callback system.
// Every callback is locked to campaign_id + ai_profile_id + voice_id.
// Background worker runs every 60 seconds.

import { logger } from '../utils/logger';
import { CampaignScheduledCallback } from './types';
import {
  getDueScheduledCallbacks,
  updateScheduledCallback,
  getCampaign,
  isFeatureFlagEnabled,
  logEnforcement,
  createScheduledCallback,
} from './store';
import { enforceScheduledCallback } from './middleware';

type CampaignDialFn = (params: {
  phone: string;
  campaignId: string;
  aiProfileId: string;
  voiceId: string;
  leadId: string | null;
}) => Promise<boolean>;

let dialFunction: CampaignDialFn | null = null;
let workerHandle: ReturnType<typeof setInterval> | null = null;
let processing = false;

// ── US Area Code -> Timezone (simplified, common mappings) ────────

const AREA_CODE_TIMEZONES: Record<string, string> = {
  // Eastern
  '201': 'America/New_York', '202': 'America/New_York', '203': 'America/New_York',
  '207': 'America/New_York', '212': 'America/New_York', '215': 'America/New_York',
  '216': 'America/New_York', '239': 'America/New_York', '240': 'America/New_York',
  '301': 'America/New_York', '302': 'America/New_York', '305': 'America/New_York',
  '312': 'America/Chicago', '313': 'America/New_York', '314': 'America/Chicago',
  '315': 'America/New_York', '321': 'America/New_York', '330': 'America/New_York',
  '336': 'America/New_York', '347': 'America/New_York', '352': 'America/New_York',
  '386': 'America/New_York', '401': 'America/New_York', '404': 'America/New_York',
  '407': 'America/New_York', '410': 'America/New_York', '412': 'America/New_York',
  '413': 'America/New_York', '414': 'America/Chicago', '415': 'America/Los_Angeles',
  '417': 'America/Chicago', '419': 'America/New_York', '423': 'America/New_York',
  '424': 'America/Los_Angeles', '425': 'America/Los_Angeles',
  '443': 'America/New_York', '470': 'America/New_York',
  '480': 'America/Phoenix', '484': 'America/New_York',
  // Central
  '501': 'America/Chicago', '502': 'America/New_York', '504': 'America/Chicago',
  '507': 'America/Chicago', '512': 'America/Chicago', '513': 'America/New_York',
  '515': 'America/Chicago', '516': 'America/New_York', '517': 'America/New_York',
  '518': 'America/New_York', '520': 'America/Phoenix',
  '563': 'America/Chicago', '567': 'America/New_York',
  '585': 'America/New_York', '586': 'America/New_York',
  // Mountain
  '303': 'America/Denver', '307': 'America/Denver', '385': 'America/Denver',
  '406': 'America/Denver', '435': 'America/Denver', '505': 'America/Denver',
  '575': 'America/Denver', '602': 'America/Phoenix', '623': 'America/Phoenix',
  // Pacific
  '206': 'America/Los_Angeles', '209': 'America/Los_Angeles',
  '213': 'America/Los_Angeles', '253': 'America/Los_Angeles',
  '310': 'America/Los_Angeles', '323': 'America/Los_Angeles',
  '360': 'America/Los_Angeles', '408': 'America/Los_Angeles',
  '503': 'America/Los_Angeles', '509': 'America/Los_Angeles',
  '510': 'America/Los_Angeles', '530': 'America/Los_Angeles',
  '541': 'America/Los_Angeles', '559': 'America/Los_Angeles',
  '562': 'America/Los_Angeles', '571': 'America/New_York',
  '600': 'America/Chicago', '601': 'America/Chicago',
  '603': 'America/New_York', '605': 'America/Chicago',
  '606': 'America/New_York', '607': 'America/New_York',
  '608': 'America/Chicago', '609': 'America/New_York',
  '610': 'America/New_York', '612': 'America/Chicago',
  '614': 'America/New_York', '615': 'America/Chicago',
  '616': 'America/New_York', '617': 'America/New_York',
  '618': 'America/Chicago', '619': 'America/Los_Angeles',
  '620': 'America/Chicago',
  '626': 'America/Los_Angeles', '630': 'America/Chicago',
  '631': 'America/New_York', '636': 'America/Chicago',
  '646': 'America/New_York', '650': 'America/Los_Angeles',
  '651': 'America/Chicago', '657': 'America/Los_Angeles',
  '660': 'America/Chicago', '661': 'America/Los_Angeles',
  '678': 'America/New_York', '702': 'America/Los_Angeles',
  '703': 'America/New_York', '704': 'America/New_York',
  '706': 'America/New_York', '707': 'America/Los_Angeles',
  '708': 'America/Chicago', '713': 'America/Chicago',
  '714': 'America/Los_Angeles', '715': 'America/Chicago',
  '716': 'America/New_York', '717': 'America/New_York',
  '718': 'America/New_York', '719': 'America/Denver',
  '720': 'America/Denver', '724': 'America/New_York',
  '727': 'America/New_York', '731': 'America/Chicago',
  '732': 'America/New_York', '734': 'America/New_York',
  '740': 'America/New_York', '747': 'America/Los_Angeles',
  '754': 'America/New_York', '757': 'America/New_York',
  '760': 'America/Los_Angeles', '763': 'America/Chicago',
  '765': 'America/New_York', '770': 'America/New_York',
  '772': 'America/New_York', '773': 'America/Chicago',
  '774': 'America/New_York', '775': 'America/Los_Angeles',
  '786': 'America/New_York', '801': 'America/Denver',
  '802': 'America/New_York', '803': 'America/New_York',
  '804': 'America/New_York', '805': 'America/Los_Angeles',
  '806': 'America/Chicago', '808': 'Pacific/Honolulu',
  '810': 'America/New_York', '812': 'America/New_York',
  '813': 'America/New_York', '814': 'America/New_York',
  '815': 'America/Chicago', '816': 'America/Chicago',
  '817': 'America/Chicago', '818': 'America/Los_Angeles',
  '828': 'America/New_York', '830': 'America/Chicago',
  '831': 'America/Los_Angeles', '832': 'America/Chicago',
  '843': 'America/New_York', '845': 'America/New_York',
  '847': 'America/Chicago', '848': 'America/New_York',
  '850': 'America/Chicago', '856': 'America/New_York',
  '857': 'America/New_York', '858': 'America/Los_Angeles',
  '859': 'America/New_York', '860': 'America/New_York',
  '862': 'America/New_York', '863': 'America/New_York',
  '864': 'America/New_York', '865': 'America/New_York',
  '870': 'America/Chicago', '872': 'America/Chicago',
  '878': 'America/New_York', '901': 'America/Chicago',
  '903': 'America/Chicago', '904': 'America/New_York',
  '907': 'America/Anchorage', '908': 'America/New_York',
  '909': 'America/Los_Angeles', '910': 'America/New_York',
  '912': 'America/New_York', '913': 'America/Chicago',
  '914': 'America/New_York', '915': 'America/Denver',
  '916': 'America/Los_Angeles', '917': 'America/New_York',
  '918': 'America/Chicago', '919': 'America/New_York',
  '920': 'America/Chicago', '925': 'America/Los_Angeles',
  '928': 'America/Phoenix', '929': 'America/New_York',
  '931': 'America/Chicago', '936': 'America/Chicago',
  '937': 'America/New_York', '938': 'America/Chicago',
  '940': 'America/Chicago', '941': 'America/New_York',
  '947': 'America/New_York', '949': 'America/Los_Angeles',
  '951': 'America/Los_Angeles', '952': 'America/Chicago',
  '954': 'America/New_York', '956': 'America/Chicago',
  '959': 'America/New_York', '970': 'America/Denver',
  '971': 'America/Los_Angeles', '972': 'America/Chicago',
  '973': 'America/New_York', '978': 'America/New_York',
  '979': 'America/Chicago', '980': 'America/New_York',
  '984': 'America/New_York', '985': 'America/Chicago',
};

/**
 * Infer timezone from US phone number area code.
 */
export function inferTimezoneFromPhone(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, '');
  let areaCode: string;
  if (digits.startsWith('1') && digits.length >= 4) {
    areaCode = digits.substring(1, 4);
  } else if (digits.length >= 3) {
    areaCode = digits.substring(0, 3);
  } else {
    return null;
  }
  return AREA_CODE_TIMEZONES[areaCode] || null;
}

/**
 * Check if a datetime is within the TCPA calling window.
 */
export function isWithinTcpaWindow(
  utcDatetime: string,
  timezone: string,
  windowStart: number,
  windowEnd: number
): boolean {
  try {
    const date = new Date(utcDatetime);
    // Use Intl to get the hour in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const localHour = parseInt(formatter.format(date), 10);
    return localHour >= windowStart && localHour < windowEnd;
  } catch {
    // If timezone is invalid, reject
    return false;
  }
}

/**
 * Find the nearest compliant time for a callback.
 */
export function findNearestCompliantTime(
  requestedUtc: string,
  timezone: string,
  windowStart: number,
  windowEnd: number
): string {
  const date = new Date(requestedUtc);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const localHour = parseInt(formatter.format(date), 10);

    if (localHour < windowStart) {
      // Move forward to windowStart
      date.setUTCHours(date.getUTCHours() + (windowStart - localHour));
    } else if (localHour >= windowEnd) {
      // Move to next day at windowStart
      date.setUTCDate(date.getUTCDate() + 1);
      date.setUTCHours(date.getUTCHours() - localHour + windowStart);
    }
  } catch {
    // Default: push to next day 9am UTC
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(14, 0, 0, 0);
  }
  return date.toISOString();
}

// ── Registration ───────────────────────────────────────────────────

export function setCampaignDialFunction(fn: CampaignDialFn): void {
  dialFunction = fn;
}

// ── Schedule a Callback ────────────────────────────────────────────

export function scheduleCallbackRequest(params: {
  leadId: string | null;
  phone: string;
  campaignId: string;
  aiProfileId: string;
  voiceId: string;
  requestedLocalDatetime: string;
  requestedTimezone?: string;
  consentCapture: string;
}): { callback: CampaignScheduledCallback | null; adjusted: boolean; adjustedReason?: string } {
  const campaign = getCampaign(params.campaignId);
  if (!campaign) {
    return { callback: null, adjusted: false, adjustedReason: 'campaign_not_found' };
  }

  // Determine timezone
  let timezone = params.requestedTimezone || '';
  if (!timezone) {
    timezone = inferTimezoneFromPhone(params.phone) || 'America/New_York';
  }

  // Convert local datetime to UTC
  let requestedUtc: string;
  try {
    requestedUtc = new Date(params.requestedLocalDatetime).toISOString();
  } catch {
    requestedUtc = new Date().toISOString();
  }

  // TCPA window enforcement
  const rules = campaign.callbackRules;
  let adjusted = false;
  let adjustedReason: string | undefined;

  if (!isWithinTcpaWindow(requestedUtc, timezone, rules.tcpaWindowStart, rules.tcpaWindowEnd)) {
    const newUtc = findNearestCompliantTime(requestedUtc, timezone, rules.tcpaWindowStart, rules.tcpaWindowEnd);
    adjusted = true;
    adjustedReason = `Adjusted from ${requestedUtc} to ${newUtc} (outside ${rules.tcpaWindowStart}:00-${rules.tcpaWindowEnd}:00 ${timezone})`;
    requestedUtc = newUtc;
  }

  const cb: CampaignScheduledCallback = {
    id: `ccb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    leadId: params.leadId,
    phone: params.phone,
    campaignId: params.campaignId,
    aiProfileId: params.aiProfileId,
    voiceId: params.voiceId,
    requestedLocalDatetime: params.requestedLocalDatetime,
    requestedTimezone: timezone,
    requestedDatetimeUtc: requestedUtc,
    consentCapture: params.consentCapture,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    maxAttempts: rules.maxAttempts,
    lastAttemptAt: null,
    result: null,
  };

  createScheduledCallback(cb);
  return { callback: cb, adjusted, adjustedReason };
}

// ── Worker ─────────────────────────────────────────────────────────

async function processDueCallbacks(): Promise<void> {
  if (!dialFunction || processing) return;
  if (!isFeatureFlagEnabled('scheduled_callbacks')) return;

  processing = true;

  try {
    const dueCallbacks = getDueScheduledCallbacks();

    for (const cb of dueCallbacks) {
      // Enforce campaign context before calling
      const enforcement = enforceScheduledCallback({
        phone: cb.phone,
        campaignId: cb.campaignId,
        aiProfileId: cb.aiProfileId,
        voiceId: cb.voiceId,
      });

      if (!enforcement.allowed) {
        // FAIL CLOSED: do not call
        updateScheduledCallback(cb.id, {
          status: 'failed',
          result: `enforcement_blocked: ${enforcement.reason}`,
        });
        logger.warn('scheduled-callbacks', 'Callback blocked by enforcement', {
          id: cb.id,
          reason: enforcement.reason,
        });
        continue;
      }

      // Validate required fields
      if (!cb.campaignId || !cb.aiProfileId || !cb.voiceId) {
        updateScheduledCallback(cb.id, {
          status: 'failed',
          result: 'missing_required_fields',
        });
        logEnforcement({
          timestamp: new Date().toISOString(),
          eventType: 'scheduled_callback_blocked',
          phone: cb.phone,
          leadId: cb.leadId,
          campaignId: cb.campaignId,
          aiProfileId: cb.aiProfileId,
          voiceId: cb.voiceId,
          action: 'scheduled_callback_execute',
          allowed: false,
          reason: 'missing_required_fields',
        });
        continue;
      }

      // TCPA window check at execution time
      const campaign = getCampaign(cb.campaignId);
      if (campaign) {
        const tz = cb.requestedTimezone || 'America/New_York';
        const now = new Date().toISOString();
        if (!isWithinTcpaWindow(now, tz, campaign.callbackRules.tcpaWindowStart, campaign.callbackRules.tcpaWindowEnd)) {
          // Not within calling window — reschedule
          const nextTime = findNearestCompliantTime(now, tz, campaign.callbackRules.tcpaWindowStart, campaign.callbackRules.tcpaWindowEnd);
          updateScheduledCallback(cb.id, {
            requestedDatetimeUtc: nextTime,
            result: 'rescheduled_outside_tcpa_window',
          });
          logger.info('scheduled-callbacks', 'Callback rescheduled: outside TCPA window', {
            id: cb.id,
            nextTime,
          });
          continue;
        }
      }

      // Execute the callback
      updateScheduledCallback(cb.id, {
        status: 'processing',
        attempts: cb.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
      });

      try {
        const success = await dialFunction({
          phone: cb.phone,
          campaignId: cb.campaignId,
          aiProfileId: cb.aiProfileId,
          voiceId: cb.voiceId,
          leadId: cb.leadId,
        });

        if (success) {
          updateScheduledCallback(cb.id, {
            status: 'completed',
            result: 'connected',
          });
          logger.info('scheduled-callbacks', 'Callback completed', { id: cb.id });
        } else {
          // No answer — retry if within limits
          const newAttempts = cb.attempts + 1;
          if (newAttempts < cb.maxAttempts && campaign) {
            const delayMinutes = campaign.callbackRules.retryDelayMinutes[
              Math.min(newAttempts - 1, campaign.callbackRules.retryDelayMinutes.length - 1)
            ] || 30;
            const nextRetry = new Date(Date.now() + delayMinutes * 60_000).toISOString();
            updateScheduledCallback(cb.id, {
              status: 'scheduled',
              requestedDatetimeUtc: nextRetry,
              result: 'no_answer_retrying',
            });
            logger.info('scheduled-callbacks', 'Callback rescheduled after no answer', {
              id: cb.id,
              nextRetry,
              attempt: newAttempts,
            });
          } else {
            updateScheduledCallback(cb.id, {
              status: 'failed',
              result: 'max_attempts_exhausted',
            });
            logger.warn('scheduled-callbacks', 'Callback failed: max attempts', { id: cb.id });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const newAttempts = cb.attempts + 1;
        updateScheduledCallback(cb.id, {
          status: newAttempts < cb.maxAttempts ? 'scheduled' : 'failed',
          result: msg,
        });
        logger.error('scheduled-callbacks', 'Callback dial error', { id: cb.id, error: msg });
      }
    }
  } finally {
    processing = false;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────

export function startScheduledCallbackWorker(): void {
  if (workerHandle) return;
  logger.info('scheduled-callbacks', 'Scheduled callback worker started (60s interval)');
  workerHandle = setInterval(() => {
    processDueCallbacks().catch(err => {
      logger.error('scheduled-callbacks', 'Worker tick error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 60_000);
}

export function stopScheduledCallbackWorker(): void {
  if (workerHandle) {
    clearInterval(workerHandle);
    workerHandle = null;
    logger.info('scheduled-callbacks', 'Scheduled callback worker stopped');
  }
}
