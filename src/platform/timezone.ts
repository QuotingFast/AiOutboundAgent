// ── Timezone resolution for compliance windows ─────────────────────
// Resolves a lead's local timezone from state (preferred) or phone
// area code, and computes local hour/day for contact-window checks.

export const STATE_TIMEZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago',
  ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York',
  MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York',
  NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York',
  ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York',
  VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
};

// Condensed area-code map: only codes whose timezone is NOT Eastern.
// Anything absent resolves to America/New_York (conservative for the
// 8am floor; the 9pm ceiling errs early for the few unlisted codes).
const AREA_CODE_TZ: Record<string, string> = {
  // Pacific
  '206': 'America/Los_Angeles', '209': 'America/Los_Angeles', '213': 'America/Los_Angeles',
  '253': 'America/Los_Angeles', '279': 'America/Los_Angeles', '310': 'America/Los_Angeles',
  '323': 'America/Los_Angeles', '341': 'America/Los_Angeles', '360': 'America/Los_Angeles',
  '408': 'America/Los_Angeles', '415': 'America/Los_Angeles', '424': 'America/Los_Angeles',
  '425': 'America/Los_Angeles', '442': 'America/Los_Angeles', '458': 'America/Los_Angeles',
  '503': 'America/Los_Angeles', '509': 'America/Los_Angeles', '510': 'America/Los_Angeles',
  '530': 'America/Los_Angeles', '541': 'America/Los_Angeles', '559': 'America/Los_Angeles',
  '562': 'America/Los_Angeles', '619': 'America/Los_Angeles', '626': 'America/Los_Angeles',
  '628': 'America/Los_Angeles', '650': 'America/Los_Angeles', '657': 'America/Los_Angeles',
  '661': 'America/Los_Angeles', '669': 'America/Los_Angeles', '702': 'America/Los_Angeles',
  '707': 'America/Los_Angeles', '714': 'America/Los_Angeles', '725': 'America/Los_Angeles',
  '747': 'America/Los_Angeles', '760': 'America/Los_Angeles', '775': 'America/Los_Angeles',
  '805': 'America/Los_Angeles', '818': 'America/Los_Angeles', '820': 'America/Los_Angeles',
  '831': 'America/Los_Angeles', '858': 'America/Los_Angeles', '909': 'America/Los_Angeles',
  '916': 'America/Los_Angeles', '925': 'America/Los_Angeles', '949': 'America/Los_Angeles',
  '951': 'America/Los_Angeles', '971': 'America/Los_Angeles',
  // Mountain
  '208': 'America/Boise', '303': 'America/Denver', '307': 'America/Denver',
  '385': 'America/Denver', '406': 'America/Denver', '435': 'America/Denver',
  '480': 'America/Phoenix', '505': 'America/Denver', '520': 'America/Phoenix',
  '575': 'America/Denver', '602': 'America/Phoenix', '623': 'America/Phoenix',
  '719': 'America/Denver', '720': 'America/Denver', '801': 'America/Denver',
  '928': 'America/Phoenix', '970': 'America/Denver', '983': 'America/Denver',
  // Central
  '205': 'America/Chicago', '210': 'America/Chicago', '214': 'America/Chicago',
  '218': 'America/Chicago', '224': 'America/Chicago', '225': 'America/Chicago',
  '228': 'America/Chicago', '251': 'America/Chicago', '254': 'America/Chicago',
  '256': 'America/Chicago', '262': 'America/Chicago', '281': 'America/Chicago',
  '308': 'America/Chicago', '312': 'America/Chicago', '314': 'America/Chicago',
  '316': 'America/Chicago', '318': 'America/Chicago', '319': 'America/Chicago',
  '320': 'America/Chicago', '331': 'America/Chicago', '334': 'America/Chicago',
  '337': 'America/Chicago', '346': 'America/Chicago', '361': 'America/Chicago',
  '402': 'America/Chicago', '405': 'America/Chicago', '409': 'America/Chicago',
  '414': 'America/Chicago', '417': 'America/Chicago', '430': 'America/Chicago',
  '432': 'America/Chicago', '469': 'America/Chicago', '479': 'America/Chicago',
  '501': 'America/Chicago', '504': 'America/Chicago', '507': 'America/Chicago',
  '512': 'America/Chicago', '515': 'America/Chicago', '531': 'America/Chicago',
  '563': 'America/Chicago', '573': 'America/Chicago', '580': 'America/Chicago',
  '601': 'America/Chicago', '605': 'America/Chicago', '608': 'America/Chicago',
  '612': 'America/Chicago', '615': 'America/Chicago', '618': 'America/Chicago',
  '620': 'America/Chicago', '630': 'America/Chicago', '636': 'America/Chicago',
  '641': 'America/Chicago', '651': 'America/Chicago', '660': 'America/Chicago',
  '662': 'America/Chicago', '682': 'America/Chicago', '708': 'America/Chicago',
  '712': 'America/Chicago', '713': 'America/Chicago', '715': 'America/Chicago',
  '731': 'America/Chicago', '736': 'America/Chicago', '737': 'America/Chicago',
  '769': 'America/Chicago', '773': 'America/Chicago', '779': 'America/Chicago',
  '785': 'America/Chicago', '806': 'America/Chicago', '815': 'America/Chicago',
  '816': 'America/Chicago', '817': 'America/Chicago', '830': 'America/Chicago',
  '832': 'America/Chicago', '847': 'America/Chicago', '870': 'America/Chicago',
  '901': 'America/Chicago', '903': 'America/Chicago', '913': 'America/Chicago',
  '915': 'America/Denver', '918': 'America/Chicago', '920': 'America/Chicago',
  '936': 'America/Chicago', '940': 'America/Chicago', '945': 'America/Chicago',
  '956': 'America/Chicago', '972': 'America/Chicago', '979': 'America/Chicago',
  '985': 'America/Chicago',
  // Alaska / Hawaii
  '907': 'America/Anchorage', '808': 'Pacific/Honolulu',
};

export function resolveTimezone(state?: string, phone?: string): { tz: string; source: 'state' | 'area_code' | 'default' } {
  const st = (state || '').trim().toUpperCase();
  if (st && STATE_TIMEZONES[st]) return { tz: STATE_TIMEZONES[st], source: 'state' };
  const digits = (phone || '').replace(/\D/g, '');
  const area = digits.length === 11 && digits.startsWith('1') ? digits.slice(1, 4) : digits.slice(0, 3);
  if (area && AREA_CODE_TZ[area]) return { tz: AREA_CODE_TZ[area], source: 'area_code' };
  return { tz: 'America/New_York', source: 'default' };
}

export interface LocalTime {
  hour: number;       // 0-23 in the lead's local timezone
  minute: number;
  day: number;        // 0=Sunday … 6=Saturday
  dateKey: string;    // YYYY-MM-DD local
  tz: string;
}

export function localTimeIn(tz: string, at: Date = new Date()): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    hour: parseInt(get('hour'), 10) % 24,
    minute: parseInt(get('minute'), 10),
    day: days.indexOf(get('weekday')),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    tz,
  };
}

/**
 * Find the next UTC instant at which the lead-local hour falls inside
 * [startHour, endHour). Walks forward in 15-minute steps (DST-safe
 * because each step is re-evaluated with Intl) up to 8 days.
 */
export function nextTimeInWindow(
  tz: string,
  startHour: number,
  endHour: number,
  from: Date = new Date(),
  allowedDays?: number[],
): Date {
  const step = 15 * 60 * 1000;
  let t = from.getTime();
  for (let i = 0; i < (8 * 24 * 4); i++) {
    const lt = localTimeIn(tz, new Date(t));
    const dayOk = !allowedDays || allowedDays.length === 0 || allowedDays.includes(lt.day);
    if (dayOk && lt.hour >= startHour && lt.hour < endHour) return new Date(t);
    t += step;
  }
  return new Date(from.getTime() + 24 * 3600 * 1000); // defensive fallback
}
