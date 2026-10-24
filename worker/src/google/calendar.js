// Google Calendar: today's and tomorrow's events from the primary calendar (PLAN.md §9.3).
// Only {title, start, end, allDay} survive; everything else is dropped here, on the server.
import { startOfDayUtc, ymdIn, addDays } from '../../../shared/time.js';
import { getCache, putCache, setMeta, nowIso } from '../db.js';
import { accessToken } from './oauth.js';
import { log } from '../http.js';

const FIELDS = 'items(summary,start,end,status,transparency,eventType,attendees(self,responseStatus))';

export function eventsUrl(timeMin, timeMax, tz) {
  const q = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    timeZone: tz,
    fields: FIELDS,
  });
  return 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q.toString();
}

/** Keeps what the frame shows and drops cancelled, declined, "free" and working-location events. */
export function normalizeEvents(items) {
  const out = [];
  for (const ev of items || []) {
    if (!ev || ev.status === 'cancelled') continue;
    if (ev.transparency === 'transparent') continue;
    if (ev.eventType === 'workingLocation') continue;
    const me = (ev.attendees || []).find((a) => a && a.self);
    if (me && me.responseStatus === 'declined') continue;
    const allDay = !!(ev.start && ev.start.date && !ev.start.dateTime);
    const start = allDay ? ev.start.date : ev.start && ev.start.dateTime;
    const end = allDay ? ev.end && ev.end.date : ev.end && ev.end.dateTime;
    if (!start || !end) continue;
    out.push({ title: String(ev.summary || 'Busy').slice(0, 80), start, end, allDay });
  }
  return out;
}

/** Splits one day's events: all-day ones that cover `ymd`, and timed ones overlapping that day. */
export function dayView(events, ymd, tz) {
  const dayStart = startOfDayUtc(ymd, tz);
  const dayEnd = startOfDayUtc(addDays(ymd, 1), tz);
  const allDay = [];
  const timed = [];
  for (const e of events) {
    if (e.allDay) {
      if (e.start <= ymd && e.end > ymd) allDay.push({ title: e.title });
    } else {
      const s = Date.parse(e.start);
      const en = Date.parse(e.end);
      if (s < dayEnd && en > dayStart) timed.push({ title: e.title, start: new Date(s).toISOString(), end: new Date(en).toISOString() });
    }
  }
  timed.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { allDay, timed };
}

/** The frame payload: today's view plus tomorrow's first timed event. */
export function calendarPayload(events, nowMs, tz) {
  const today = ymdIn(nowMs, tz);
  const tomorrow = addDays(today, 1);
  const t = dayView(events, today, tz);
  const tm = dayView(events, tomorrow, tz);
  const tomorrowStart = startOfDayUtc(tomorrow, tz);
  const first = tm.timed.find((e) => Date.parse(e.start) >= tomorrowStart);
  return { today: t, tomorrowFirst: first ? { title: first.title, start: first.start } : null };
}

export const CAL_KEY = 'calendar';

/** Cron step: fetch today+tomorrow, cache the normalized events. Keeps the old cache on failure. */
export async function refreshCalendar(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const today = ymdIn(nowMs, tz);
  const token = await accessToken(env, 'calendar', { fetchImpl, nowMs });
  if (!token) return { ok: false, reason: 'no_grant' };
  const url = eventsUrl(new Date(startOfDayUtc(today, tz)).toISOString(), new Date(startOfDayUtc(addDays(today, 2), tz)).toISOString(), tz);
  try {
    const res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (!res.ok) throw new Error('calendar_http_' + res.status);
    const body = await res.json();
    await putCache(db, CAL_KEY, { events: normalizeEvents(body.items), day: today }, nowMs);
    await setMeta(db, 'calendar_ok_at', nowIso(nowMs));
    return { ok: true };
  } catch (e) {
    log('calendar_error', { code: String(e.message).slice(0, 40) });
    return { ok: false };
  }
}

export async function cachedCalendar(db) {
  return getCache(db, CAL_KEY);
}
