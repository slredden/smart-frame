// Google Calendar (PLAN.md §9.3, v1.1 in PLAN-v2.md): events from the calendars Stephen selected on
// /admin (the primary calendar until he picks), merged. Only {title, start, end, allDay, color} survive;
// everything else is dropped here, on the server. Calendar names and event titles are never logged.
import { startOfDayUtc, ymdIn, addDays } from '../../../shared/time.js';
import { getCache, putCache, setMeta, nowIso } from '../db.js';
import { accessToken, grantHasScope, CALENDAR_LIST_SCOPE } from './oauth.js';
import { log } from '../http.js';

/**
 * Free-plan Workers allow 50 subrequests per invocation. A cron run spends 1 on a token refresh (at
 * most), 1 on weather, and 1 per selected calendar, so selection is capped well under that.
 */
export const MAX_SELECTED = 25;
/** How far ahead the look-ahead searches when today and tomorrow are empty. */
export const LOOKAHEAD_DAYS = 30;

const FIELDS = 'items(summary,start,end,status,transparency,eventType,attendees(self,responseStatus))';

export function eventsUrl(timeMin, timeMax, tz, calendarId = 'primary') {
  const q = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    timeZone: tz,
    fields: FIELDS,
  });
  return 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?' + q.toString();
}

/** Keeps what the frame shows and drops cancelled, declined, "free" and working-location events. */
export function normalizeEvents(items, color = null, noAlert = false) {
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
    const e = { title: String(ev.summary || 'Busy').slice(0, 80), start, end, allDay };
    if (color) e.color = color;
    if (noAlert) e.na = true; // P1b: this calendar's alerts are off (PLAN-v2.md §9.1)
    out.push(e);
  }
  return out;
}

const withColor = (o, e) => (e.color ? Object.assign(o, { color: e.color }) : o);

/** Sort key for an event: all-day dates sort at local midnight. */
const startMs = (e, tz) => (e.allDay ? startOfDayUtc(e.start, tz) : Date.parse(e.start));

/** Splits one day's events: all-day ones that cover `ymd`, and timed ones overlapping that day. */
export function dayView(events, ymd, tz) {
  const dayStart = startOfDayUtc(ymd, tz);
  const dayEnd = startOfDayUtc(addDays(ymd, 1), tz);
  const allDay = [];
  const timed = [];
  for (const e of events) {
    if (e.allDay) {
      if (e.start <= ymd && e.end > ymd) allDay.push(withColor({ title: e.title }, e));
    } else {
      const s = Date.parse(e.start);
      const en = Date.parse(e.end);
      if (s < dayEnd && en > dayStart) timed.push(withColor({ title: e.title, start: new Date(s).toISOString(), end: new Date(en).toISOString() }, e));
    }
  }
  timed.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { allDay, timed };
}

/**
 * The frame payload: today's view, tomorrow's first timed event, and (v1.1) `ahead`, the first event
 * after tomorrow, for when today and tomorrow have nothing left.
 */
export function calendarPayload(events, nowMs, tz) {
  const today = ymdIn(nowMs, tz);
  const tomorrow = addDays(today, 1);
  const t = dayView(events, today, tz);
  const tm = dayView(events, tomorrow, tz);
  const tomorrowStart = startOfDayUtc(tomorrow, tz);
  const first = tm.timed.find((e) => Date.parse(e.start) >= tomorrowStart);
  const afterTomorrow = startOfDayUtc(addDays(today, 2), tz);
  let ahead = null;
  for (const e of events) {
    const s = startMs(e, tz);
    if (s >= afterTomorrow && (!ahead || s < startMs(ahead, tz))) ahead = e;
  }
  // P1b alerts (§9): timed events starting in the next 24 h (or up to 5 min ago), for the frame's banners.
  const soon = [];
  for (const e of events) {
    if (e.allDay) continue;
    const s = Date.parse(e.start);
    if (s >= nowMs - SOON_BEFORE_MS && s <= nowMs + SOON_AHEAD_MS && soon.length < SOON_MAX) {
      const o = withColor({ title: e.title, start: new Date(s).toISOString() }, e);
      if (e.na) o.na = true;
      soon.push(o);
    }
  }
  return {
    today: t,
    soon,
    tomorrowFirst: first ? withColor({ title: first.title, start: first.start }, first) : null,
    ahead: ahead ? withColor({ title: ahead.title, start: ahead.start, allDay: ahead.allDay }, ahead) : null,
  };
}

const SOON_BEFORE_MS = 5 * 60000;
const SOON_AHEAD_MS = 24 * 3600000;
const SOON_MAX = 30;

export const CAL_KEY = 'calendar';

/** The calendars to fetch: the selected ones, or the primary calendar when nothing is selected. */
export async function selectedCalendars(db) {
  const { results } = await db.prepare('SELECT id, color, alert FROM calendars WHERE selected = 1 ORDER BY position LIMIT ?').bind(MAX_SELECTED).all();
  if (results.length) return results;
  // Nothing picked yet: the primary calendar, with its stored alert flag if the list has been loaded.
  const p = await db.prepare('SELECT alert FROM calendars WHERE is_primary = 1').first();
  return [{ id: 'primary', color: null, alert: p ? p.alert : 1 }];
}

/**
 * Cron step: fetch this week's Monday through today + LOOKAHEAD_DAYS from each selected calendar (one request each, in
 * parallel), merge, and cache. A calendar that fails is skipped; if every one fails the old cache stays.
 */
export async function refreshCalendar(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const today = ymdIn(nowMs, tz);
  const token = await accessToken(env, 'calendar', { fetchImpl, nowMs });
  if (!token) return { ok: false, reason: 'no_grant' };
  const cals = await selectedCalendars(db);
  // From this week's Monday, so the Week view has the days already gone (same one request per calendar).
  const from = mondayOf(today);
  const timeMin = new Date(startOfDayUtc(from, tz)).toISOString();
  const timeMax = new Date(startOfDayUtc(addDays(today, LOOKAHEAD_DAYS), tz)).toISOString();
  const results = await Promise.all(
    cals.map(async (c) => {
      try {
        const res = await fetchImpl(eventsUrl(timeMin, timeMax, tz, c.id), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
        if (!res.ok) return { ok: false, code: 'calendar_http_' + res.status };
        const body = await res.json();
        return { ok: true, events: normalizeEvents(body.items, c.color, c.alert === 0) };
      } catch {
        return { ok: false, code: 'calendar_fetch' };
      }
    }),
  );
  const good = results.filter((r) => r.ok);
  const failed = results.length - good.length;
  if (failed) log('calendar_error', { failed, of: results.length, code: (results.find((r) => !r.ok) || {}).code });
  if (!good.length) return { ok: false };
  // v2: keep the whole window (today through LOOKAHEAD_DAYS) for the Calendar screen (PLAN-v2.md §3.4).
  const all = [].concat(...good.map((r) => r.events)).sort((a, b) => startMs(a, tz) - startMs(b, tz));
  await putCache(db, CAL_KEY, { events: all, day: today, from, calendars: cals.length, failed }, nowMs);
  await setMeta(db, 'calendar_ok_at', nowIso(nowMs));
  return { ok: true, calendars: cals.length, failed };
}

const LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const LIST_FIELDS = 'nextPageToken,items(id,summary,summaryOverride,backgroundColor,primary,deleted)';

/**
 * /admin: syncs the account's calendar list into D1, keeping existing selections. New calendars start
 * unselected, except the primary calendar on the first sync (so the frame keeps showing what v1 did).
 * Returns {ok} or {ok:false, error:'reconnect_calendar'} when the grant predates the list scope.
 */
export async function syncCalendarList(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  if (!(await grantHasScope(db, 'calendar', CALENDAR_LIST_SCOPE))) return { ok: false, error: 'reconnect_calendar' };
  const token = await accessToken(env, 'calendar', { fetchImpl, nowMs });
  if (!token) return { ok: false, error: 'reconnect_calendar' };
  const items = [];
  let pageToken = '';
  for (let page = 0; page < 4; page++) {
    const q = new URLSearchParams({ maxResults: '250', fields: LIST_FIELDS });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetchImpl(LIST_URL + '?' + q.toString(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'reconnect_calendar' };
    if (!res.ok) return { ok: false, error: 'calendar_list_http_' + res.status };
    const body = await res.json();
    for (const it of body.items || []) if (it && it.id && !it.deleted) items.push(it);
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }
  if (!items.length) return { ok: false, error: 'no_calendars' }; // never wipe the selection on an empty reply
  const had = await db.prepare('SELECT COUNT(*) AS n FROM calendars').first();
  const firstSync = !had || !had.n;
  const ts = nowIso(nowMs);
  const stmts = items.map((it, i) =>
    db
      .prepare(
        `INSERT INTO calendars (id, summary, color, is_primary, selected, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, color = excluded.color, is_primary = excluded.is_primary,
         position = excluded.position, updated_at = excluded.updated_at`,
      )
      .bind(
        it.id,
        String(it.summaryOverride || it.summary || it.id).slice(0, 120),
        /^#[0-9a-f]{6}$/i.test(it.backgroundColor || '') ? it.backgroundColor.toLowerCase() : null,
        it.primary ? 1 : 0,
        firstSync && it.primary ? 1 : 0,
        i,
        ts,
      ),
  );
  // Calendars no longer on the account's list are dropped (and so deselected).
  stmts.push(db.prepare('DELETE FROM calendars WHERE updated_at <> ?').bind(ts));
  await db.batch(stmts);
  return { ok: true, count: items.length };
}

export async function listCalendars(db) {
  const { results } = await db.prepare('SELECT id, summary, color, is_primary, selected, alert FROM calendars ORDER BY position').all();
  return results.map((r) => ({ id: r.id, summary: r.summary, color: r.color, primary: !!r.is_primary, selected: !!r.selected, alert: r.alert !== 0 }));
}

/**
 * Replaces the selection. Unknown ids are refused; more than MAX_SELECTED is refused. P1b: `alertsOff`
 * (optional) is the list of calendars whose event alerts are off; when given it replaces the old list.
 */
export async function setSelection(db, ids, alertsOff) {
  const bad = (a) => !Array.isArray(a) || a.length > 500 || a.some((x) => typeof x !== 'string');
  if (bad(ids) || (alertsOff !== undefined && bad(alertsOff))) return { ok: false, error: 'bad_selection' };
  const uniq = [...new Set(ids)];
  if (uniq.length > MAX_SELECTED) return { ok: false, error: 'too_many_calendars' };
  const known = new Set((await db.prepare('SELECT id FROM calendars').all()).results.map((r) => r.id));
  if (uniq.some((id) => !known.has(id))) return { ok: false, error: 'unknown_calendar' };
  const off = alertsOff === undefined ? null : [...new Set(alertsOff)];
  if (off && off.some((id) => !known.has(id))) return { ok: false, error: 'unknown_calendar' };
  const stmts = [db.prepare('UPDATE calendars SET selected = 0'), ...uniq.map((id) => db.prepare('UPDATE calendars SET selected = 1 WHERE id = ?').bind(id))];
  if (off) stmts.push(db.prepare('UPDATE calendars SET alert = 1'), ...off.map((id) => db.prepare('UPDATE calendars SET alert = 0 WHERE id = ?').bind(id)));
  await db.batch(stmts);
  return { ok: true, selected: uniq.length };
}

/** The Monday on or before a YYYY-MM-DD date. */
export function mondayOf(ymd) {
  const dow = new Date(ymd + 'T12:00:00Z').getUTCDay();
  return addDays(ymd, -((dow + 6) % 7));
}

/** Longest slice the frame can ask for in one call. */
export const MAX_WINDOW_DAYS = 14;

/**
 * GET /api/calendar: `days` days from `from`, each split like dayView. Days before the cached window
 * (the cron fetches from this week's Monday on) come back with `loaded: false` so the frame can say so.
 */
export function calendarWindow(cache, from, days, tz) {
  const events = (cache && cache.events) || [];
  const loadedFrom = cache ? cache.from || cache.day : null;
  const loadedTo = cache ? addDays(cache.day, LOOKAHEAD_DAYS) : null;
  const out = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDays(from, i);
    const loaded = !!loadedFrom && ymd >= loadedFrom && ymd < loadedTo;
    out.push(Object.assign({ ymd, loaded }, loaded ? dayView(events, ymd, tz) : { allDay: [], timed: [] }));
  }
  const end = startOfDayUtc(addDays(from, days), tz);
  let next = null;
  for (const e of events) {
    if (startMs(e, tz) >= end) {
      next = withColor({ title: e.title, start: e.start, allDay: e.allDay }, e);
      break;
    }
  }
  return { from, days: out, loadedFrom, loadedTo, next };
}

export async function cachedCalendar(db) {
  return getCache(db, CAL_KEY);
}
