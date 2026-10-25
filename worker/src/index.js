// smart-frame Worker: routes, auth gates, and the cron (PLAN.md §5, §7).
import { ensureSchema } from './db.js';
import { json, error, empty, unauthorized, forbidden, notFound, readJson, redirect, log } from './http.js';
import { authDevice, rateLimited, touchDevice, recordHeartbeat } from './auth/device.js';
import { checkHashedToken } from './auth/tokens.js';
import { verifyAccess } from './auth/access.js';
import { buildState } from './state.js';
import { buildHealth } from './health.js';
import { servePhoto, setPhotoFlags } from './photos.js';
import { publishReflection, loadGuides } from './reflection.js';
import { reflectionView } from '../../shared/reflection.js';
import { refreshTasks, syncTaskLists, listTaskLists, setTaskListSelection, cachedTasks, completeTask, tasksScope, MAX_LISTS } from './google/tasks.js';
import { handleAdmin } from './admin.js';
import { refreshWeather, searchPlaces, WEATHER_KEY } from './weather.js';
import { refreshCalendar, calendarWindow, listCalendars, setSelection, syncCalendarList, cachedCalendar, MAX_SELECTED, MAX_WINDOW_DAYS } from './google/calendar.js';
import { getSettings, putSetting, overWriteBudget } from './settings.js';
import { getCache } from './db.js';
import { ymdIn } from '../../shared/time.js';

export async function route(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.FRAME_DB;

  if (path.startsWith('/p/')) {
    if (method !== 'GET' && method !== 'HEAD') return empty(405);
    await ensureSchema(db);
    return servePhoto(env, url);
  }

  if (path === '/api/health') {
    if (!(await checkHashedToken(request, env.HEALTH_TOKEN_HASH))) return unauthorized();
    if (method !== 'GET') return empty(405);
    await ensureSchema(db);
    return json(await buildHealth(env));
  }

  if (path === '/api/publish/reflection') {
    if (!(await checkHashedToken(request, env.PUBLISH_TOKEN_HASH))) return unauthorized();
    if (method !== 'PUT') return empty(405);
    await ensureSchema(db);
    const body = await readJson(request);
    if (body.error) return error(400, body.error);
    const r = await publishReflection(env, body.value);
    log('reflection_publish', { ok: r.ok, weeks: r.ok ? r.weeks.length : 0 });
    return r.ok ? json(r) : json({ error: 'invalid_guide', problems: r.problems }, 400);
  }

  if (path.startsWith('/api/')) {
    await ensureSchema(db);
    const device = await authDevice(request, db);
    if (!device) return unauthorized();
    if (rateLimited(device.id)) return empty(429);
    if (path === '/api/state' && method === 'GET') {
      await touchDevice(db, device.id, request.headers.get('x-frame-build'));
      return json(await buildState(env, device, deps.nowMs || Date.now()));
    }
    if (path === '/api/heartbeat' && method === 'POST') {
      const body = await readJson(request, 8192);
      await recordHeartbeat(db, device.id, body.value || {});
      return empty(204);
    }
    return deviceApi(request, env, url, device, deps);
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    const admin = await verifyAccess(request, env, deps.fetchImpl || fetch);
    if (!admin) return forbidden();
    if (path === '/admin') return redirect('/admin/');
    await ensureSchema(db);
    const r = await handleAdmin(request, env, url, admin, deps);
    if (r) return r;
    if (path.startsWith('/admin/api/')) return notFound();
    // The admin page itself (static), only after Access passes.
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  }

  return env.ASSETS.fetch(request);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}
const HOUR_MS = 3600000;

/** v2 P1 device routes: Calendar, Weather and Settings screens (PLAN-v2.md §3, §5, §7). */
async function deviceApi(request, env, url, device, deps) {
  const path = url.pathname;
  const method = request.method;
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const fetchImpl = deps.fetchImpl || fetch;
  const nowMs = deps.nowMs || Date.now();

  if (path === '/api/calendar' && method === 'GET') {
    const from = url.searchParams.get('from') || ymdIn(nowMs, tz);
    const days = Number(url.searchParams.get('days') || 14);
    if (!YMD_RE.test(from) || !Number.isInteger(days) || days < 1 || days > MAX_WINDOW_DAYS) return error(400, 'bad_window');
    const cal = await cachedCalendar(db);
    const win = calendarWindow(cal && cal.value, from, days, tz);
    return json(Object.assign({ fetchedAt: cal ? cal.fetchedAt : null, stale: !cal || nowMs - Date.parse(cal.fetchedAt) > HOUR_MS }, win));
  }
  if (path === '/api/weather' && method === 'GET') {
    const w = await getCache(db, WEATHER_KEY);
    if (!w) return json({ weather: null });
    return json({ weather: Object.assign({ fetchedAt: w.fetchedAt, stale: nowMs - Date.parse(w.fetchedAt) > HOUR_MS }, w.value) });
  }
  if (path === '/api/calendars' && method === 'GET') {
    return json({ calendars: await listCalendars(db), max: MAX_SELECTED });
  }
  // P1b (PLAN-v2.md §4, §8): Tasks and Reflection screens, read-only from cache / D1.
  if (path === '/api/tasks' && method === 'GET') {
    return json(await cachedTasks(env, nowMs));
  }
  if (path === '/api/tasklists' && method === 'GET') {
    return json({ lists: await listTaskLists(db), max: MAX_LISTS, scope: await tasksScope(db) });
  }
  if (path === '/api/reflection' && method === 'GET') {
    return json(reflectionView(await loadGuides(env), ymdIn(nowMs, tz)));
  }
  if (path === '/api/settings/weather/search' && method === 'GET') {
    if (await overWriteBudget(db, device.id, nowMs)) return error(429, 'too_many_writes');
    const r = await searchPlaces(url.searchParams.get('q'), { fetchImpl });
    return r.ok ? json({ places: r.places }) : error(r.error === 'bad_query' ? 400 : 502, r.error);
  }

  // Everything below writes, so it counts against the device's hourly budget.
  const writes = method === 'PUT' || method === 'POST';
  const settingMatch = /^\/api\/settings\/([a-z]{1,20})$/.exec(path);
  const completeMatch = /^\/api\/tasks\/([^/]{1,128})\/([^/]{1,128})\/complete$/.exec(path);
  const photoMatch = /^\/api\/photos\/([A-Za-z0-9_-]{4,40})\/(\d{1,4})$/.exec(path);
  const isWrite =
    writes &&
    (settingMatch ||
      completeMatch ||
      photoMatch ||
      path === '/api/calendars/selection' ||
      path === '/api/calendars/sync' ||
      path === '/api/tasklists/selection' ||
      path === '/api/tasklists/sync');
  if (!isWrite) return notFound();
  if (await overWriteBudget(db, device.id, nowMs)) return error(429, 'too_many_writes');
  const by = 'frame:' + device.id;

  if (settingMatch && method === 'PUT') {
    const body = await readJson(request, 4096);
    if (body.error) return error(400, body.error);
    const key = settingMatch[1];
    const r = await putSetting(env, key, body.value, by, nowMs);
    if (!r.ok) return error(400, r.error);
    // A new weather location gets fresh weather now, not at the next cron.
    if (key === 'weather') await refreshWeather(env, { force: true, fetchImpl, nowMs });
    return json({ ok: true, settings: await getSettings(env) });
  }
  if (path === '/api/calendars/selection' && method === 'PUT') {
    const body = await readJson(request, 16384);
    if (body.error) return error(400, body.error);
    const r = await setSelection(db, body.value && body.value.selected, body.value && body.value.alertsOff);
    if (!r.ok) return error(400, r.error);
    const c = await refreshCalendar(env, { fetchImpl, nowMs });
    return json({ ok: true, selected: r.selected, refreshed: !!c.ok, calendars: await listCalendars(db) });
  }
  if (path === '/api/calendars/sync' && method === 'POST') {
    const r = await syncCalendarList(env, { fetchImpl, nowMs });
    return r.ok ? json({ calendars: await listCalendars(db), max: MAX_SELECTED }) : error(409, r.error);
  }
  if (path === '/api/tasklists/sync' && method === 'POST') {
    const r = await syncTaskLists(env, { fetchImpl, nowMs });
    return r.ok ? json({ lists: await listTaskLists(db), max: MAX_LISTS }) : error(409, r.error);
  }
  if (path === '/api/tasklists/selection' && method === 'PUT') {
    const body = await readJson(request, 8192);
    if (body.error) return error(400, body.error);
    const r = await setTaskListSelection(db, body.value && body.value.selected);
    if (!r.ok) return error(400, r.error);
    const t = await refreshTasks(env, { fetchImpl, nowMs, force: true });
    return json({ ok: true, selected: r.selected, refreshed: !!t.ok, lists: await listTaskLists(db) });
  }
  if (completeMatch && method === 'POST') {
    const text = await request.text();
    if (text.length > 512) return error(400, 'too_large');
    let body;
    try {
      body = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      return error(400, 'bad_json');
    }
    const r = await completeTask(env, safeDecode(completeMatch[1]), safeDecode(completeMatch[2]), body, { fetchImpl, nowMs });
    return r.ok ? json({ ok: true }) : error(r.status, r.error);
  }
  if (photoMatch && method === 'PUT') {
    const body = await readJson(request, 512);
    if (body.error) return error(400, body.error);
    const r = await setPhotoFlags(db, photoMatch[1], Number(photoMatch[2]), body.value);
    return r.ok ? json({ ok: true }) : error(r.status, r.error);
  }
  return notFound();
}

export async function runCron(env, nowMs = Date.now(), fetchImpl = fetch) {
  await ensureSchema(env.FRAME_DB);
  const [w, c] = await Promise.all([refreshWeather(env, { fetchImpl, nowMs }), refreshCalendar(env, { fetchImpl, nowMs })]);
  // Tasks after calendar, so a token refresh happens once (both use the calendar grant). Subrequests:
  // ≤ 1 token + 1 weather + 25 calendars + 10 task lists = 37 of the free plan's 50.
  let t;
  try {
    t = await refreshTasks(env, { fetchImpl, nowMs });
  } catch {
    t = { ok: false, reason: 'error' };
  }
  log('cron', {
    weather: w.skipped ? 'skip' : w.ok ? 'ok' : 'fail',
    calendar: c.ok ? 'ok' : c.reason || 'fail',
    tasks: t.skipped ? 'skip' : t.ok ? (t.changed ? 'ok' : 'same') : t.reason || 'fail',
  });
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      log('unhandled', { name: e && e.name ? String(e.name).slice(0, 40) : 'Error' });
      return error(500, 'internal');
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(env, controller.scheduledTime || Date.now()));
  },
};
