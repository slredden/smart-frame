// Display formatting. Formatters are created once per zone and reused (building-for-the-frame.md).
import { ymdIn, addDays } from '../../shared/time.js';

const cache = new Map();
function fmt(tz, key, opts) {
  const k = tz + '|' + key;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts));
    cache.set(k, f);
  }
  return f;
}

/** 12-hour clock split into time and AM/PM: ['7:42', 'AM']. */
export function clockParts(ms, tz) {
  let ampm = '';
  let hour = '';
  let minute = '';
  for (const p of fmt(tz, 'clock', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))) {
    if (p.type === 'hour') hour = p.value;
    else if (p.type === 'minute') minute = p.value;
    else if (p.type === 'dayPeriod') ampm = p.value.toUpperCase();
  }
  return [hour + ':' + minute, ampm];
}

/** 'Sat, Oct 24' */
export function shortDate(ms, tz) {
  return fmt(tz, 'short', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

/** 'Saturday, October 24' */
export function longDate(ms, tz) {
  return fmt(tz, 'long', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(ms));
}

/** '6:00 PM' for an ISO instant. */
export function eventTime(iso, tz) {
  return fmt(tz, 'evt', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** 'Sun' for a 'YYYY-MM-DD' (zone-free). */
export function weekdayShort(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return fmt('UTC', 'dow', { weekday: 'short' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Photo caption from 'YYYY-MM' or 'YYYY-MM-DD': 'June 2019'. */
export function photoCaption(taken) {
  if (!taken || !/^\d{4}-\d{2}/.test(taken)) return '';
  const y = taken.slice(0, 4);
  const m = Number(taken.slice(5, 7));
  return m >= 1 && m <= 12 ? MONTHS[m - 1] + ' ' + y : '';
}

/** '54°' */
export function temp(f) {
  return typeof f === 'number' && isFinite(f) ? Math.round(f) + '°' : '–';
}

/** 'updated 42 min ago' style age label, or '' when fresh. */
export function staleLabel(fetchedAtIso, nowMs, thresholdMin = 30) {
  if (!fetchedAtIso) return '';
  const min = Math.floor((nowMs - Date.parse(fetchedAtIso)) / 60000);
  if (!(min >= thresholdMin)) return '';
  if (min < 120) return 'updated ' + min + ' min ago';
  const h = Math.floor(min / 60);
  return h < 48 ? 'updated ' + h + ' h ago' : 'updated ' + Math.floor(h / 24) + ' days ago';
}

/** Today's and tomorrow's ymd in tz. */
export function todayTomorrow(ms, tz) {
  const today = ymdIn(ms, tz);
  return [today, addDays(today, 1)];
}
