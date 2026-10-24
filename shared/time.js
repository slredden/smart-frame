// Time-zone math without libraries. Shared by the frame (Chrome 106) and the Worker.
// All wall-clock decisions (schedule, "today", reflection week) use an explicit IANA zone,
// so a frame whose own zone setting drifts still behaves.

const partsCache = new Map();

function partsFormatter(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of instant `ms` in zone `tz`. */
export function zonedParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type === 'weekday') out.weekday = WEEKDAYS[p.value];
    else if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Minutes since local midnight (0..1439) in zone `tz`. */
export function minutesOfDay(ms, tz) {
  const p = zonedParts(ms, tz);
  return p.hour * 60 + p.minute;
}

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date 'YYYY-MM-DD' in zone `tz`. */
export function ymdIn(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings (zone-free). */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from ymd `a` to ymd `b`. */
export function daysBetween(a, b) {
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

/** Offset of zone `tz` from UTC at instant `ms`, in ms (Denver summer = -6h). */
export function zoneOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local 00:00 on `ymd` in zone `tz`. */
export function startOfDayUtc(ymd, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffsetMs(guess, tz);
  // A second pass settles days where the offset at the guess differs from the offset at midnight.
  t = guess - zoneOffsetMs(t, tz);
  return t;
}

/** Day of week (0 = Sunday) of a ymd string. */
export function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
