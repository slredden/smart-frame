// /admin/api/* handlers. The router has already verified Access before calling these.
import { json, error, readJson, redirect } from './http.js';
import { createDevice, listDevices, revokeDevice } from './auth/device.js';
import { startAuth, finishAuth, disconnect, GRANTS } from './google/oauth.js';
import { startPicker, stepPicker } from './google/picker.js';
import { buildHealth } from './health.js';
import { syncCalendarList, listCalendars, setSelection, refreshCalendar, MAX_SELECTED } from './google/calendar.js';
import { publishReflection } from './reflection.js';
import { syncTaskLists, listTaskLists, setTaskListSelection, refreshTasks, tasksScope, MAX_LISTS } from './google/tasks.js';
import { hiddenCount, unhideAll } from './photos.js';
import { settingsWithHistory, putSetting, resetSettings } from './settings.js';
import { refreshWeather, searchPlaces } from './weather.js';
import * as spotify from './spotify/oauth.js';
import { adminControls, haCameras, saveCams } from './controls.js';

export async function handleAdmin(request, env, url, admin, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const path = url.pathname;
  const method = request.method;
  const db = env.FRAME_DB;

  if (path === '/admin/oauth/start' && method === 'GET') {
    const grant = url.searchParams.get('grant') || '';
    if (!GRANTS[grant]) return error(400, 'unknown_grant');
    try {
      return redirect(await startAuth(env, grant, url.origin));
    } catch (e) {
      return error(500, e.message === 'google_client_missing' ? 'google_client_missing' : 'oauth_start_failed');
    }
  }
  if (path === '/admin/oauth/callback' && method === 'GET') {
    const r = await finishAuth(env, url);
    return redirect('/admin/?oauth=' + (r.ok ? 'ok' : r.error) + (r.grant ? '&grant=' + r.grant : ''));
  }
  // P2 Spotify connect (PLAN-v2.md §11.5). Its own callback path, so the Google flow is untouched.
  if (path === '/admin/spotify/start' && method === 'GET') {
    if (!spotify.configured(env)) return redirect('/admin/?spotify=spotify_client_missing');
    return redirect(await spotify.startAuth(env, url.origin));
  }
  if (path === '/admin/spotify/callback' && method === 'GET') {
    const r = await spotify.finishAuth(env, url, { fetchImpl });
    return redirect('/admin/?spotify=' + (r.ok ? 'ok' : r.error));
  }
  if (path === '/admin/api/spotify' && method === 'GET') return json(await spotify.spotifyStatus(env));
  if (path === '/admin/api/spotify/disconnect' && method === 'POST') {
    await spotify.disconnect(env);
    return json({ ok: true });
  }
  // P2 Controls (PLAN-v2.md §11.3): HA status, HA's camera list, and the camera allowlist.
  if (path === '/admin/api/controls' && method === 'GET') return json(await adminControls(env));
  if (path === '/admin/api/controls/cameras' && method === 'GET') {
    const r = await haCameras(env);
    return json(r.body, r.status);
  }
  if (path === '/admin/api/controls/cams' && method === 'PUT') {
    const body = await readJson(request, 8 * 1024);
    if (body.error) return error(400, body.error);
    const r = await saveCams(db, body.value && body.value.cams);
    return r.ok ? json(r) : error(400, r.error);
  }
  if (path === '/admin/api/status' && method === 'GET') {
    // An unfinished picker job (e.g. paused on the KV budget) so the page can resume it after a reload.
    const job = await db
      .prepare("SELECT id, status, count FROM picker_jobs WHERE status IN ('picking', 'ingesting') ORDER BY created_at DESC LIMIT 1")
      .first();
    return json({ admin: admin.email, health: await buildHealth(env), devices: await listDevices(db), job: job || null });
  }
  if (path === '/admin/api/devices' && method === 'POST') {
    const body = await readJson(request, 4096);
    const d = await createDevice(db, body.value && body.value.name);
    // Shown once. The fragment never reaches the server when the frame loads it.
    return json({ id: d.id, name: d.name, pairingUrl: url.origin + '/#d=' + d.token });
  }
  let m = /^\/admin\/api\/devices\/([A-Za-z0-9_-]{4,64})\/revoke$/.exec(path);
  if (m && method === 'POST') return json({ revoked: await revokeDevice(db, m[1]) });

  m = /^\/admin\/api\/grants\/(calendar|photos)\/disconnect$/.exec(path);
  if (m && method === 'POST') {
    await disconnect(env, m[1]);
    return json({ ok: true });
  }
  if (path === '/admin/api/picker' && method === 'POST') {
    const r = await startPicker(env);
    return r.ok ? json(r) : error(409, r.error);
  }
  m = /^\/admin\/api\/picker\/([A-Za-z0-9_-]{4,40})\/step$/.exec(path);
  if (m && method === 'POST') return json(await stepPicker(env, m[1]));

  // v1.1 calendar selection. GET lists what D1 has; POST .../sync re-reads the list from Google.
  if (path === '/admin/api/calendars' && method === 'GET') {
    return json({ calendars: await listCalendars(db), max: MAX_SELECTED });
  }
  if (path === '/admin/api/calendars/sync' && method === 'POST') {
    const r = await syncCalendarList(env, { fetchImpl });
    return r.ok ? json({ calendars: await listCalendars(db), max: MAX_SELECTED }) : error(409, r.error);
  }
  if (path === '/admin/api/calendars' && method === 'PUT') {
    const body = await readJson(request, 16384);
    if (body.error) return error(400, body.error);
    const r = await setSelection(db, body.value && body.value.selected, body.value && body.value.alertsOff);
    if (!r.ok) return error(400, r.error);
    // Refresh now so the frame picks the new selection up on its next poll, not the next cron.
    const c = await refreshCalendar(env, { fetchImpl });
    return json({ ok: true, selected: r.selected, refreshed: !!c.ok });
  }

  // P1b task lists (PLAN-v2.md §4.2), same shape as calendars.
  if (path === '/admin/api/tasklists' && method === 'GET') {
    return json({ lists: await listTaskLists(db), max: MAX_LISTS, scope: await tasksScope(db) });
  }
  if (path === '/admin/api/tasklists/sync' && method === 'POST') {
    const r = await syncTaskLists(env, { fetchImpl });
    return r.ok ? json({ lists: await listTaskLists(db), max: MAX_LISTS }) : error(409, r.error);
  }
  if (path === '/admin/api/tasklists' && method === 'PUT') {
    const body = await readJson(request, 8192);
    if (body.error) return error(400, body.error);
    const r = await setTaskListSelection(db, body.value && body.value.selected);
    if (!r.ok) return error(400, r.error);
    const t = await refreshTasks(env, { fetchImpl, force: true });
    return json({ ok: true, selected: r.selected, refreshed: !!t.ok });
  }

  // P1b photo flags: hidden count and "Unhide all" (PLAN-v2.md §6).
  if (path === '/admin/api/photos' && method === 'GET') return json({ hidden: await hiddenCount(db) });
  if (path === '/admin/api/photos/unhide-all' && method === 'POST') return json({ ok: true, unhidden: await unhideAll(db) });

  // v2 frame settings (PLAN-v2.md §7.2): view with history, reset, and the weather fallback.
  if (path === '/admin/api/settings' && method === 'GET') return json({ settings: await settingsWithHistory(env) });
  if (path === '/admin/api/settings/reset' && method === 'POST') {
    await resetSettings(env);
    await refreshWeather(env, { fetchImpl });
    return json({ ok: true, settings: await settingsWithHistory(env) });
  }
  if (path === '/admin/api/settings/weather/search' && method === 'GET') {
    const r = await searchPlaces(url.searchParams.get('q'), { fetchImpl });
    return r.ok ? json({ places: r.places }) : error(r.error === 'bad_query' ? 400 : 502, r.error);
  }
  m = /^\/admin\/api\/settings\/([a-z]{1,20})$/.exec(path);
  if (m && method === 'PUT') {
    const body = await readJson(request, 4096);
    if (body.error) return error(400, body.error);
    const r = await putSetting(env, m[1], body.value, 'admin:' + admin.email);
    if (!r.ok) return error(400, r.error);
    if (m[1] === 'weather') await refreshWeather(env, { force: true, fetchImpl });
    return json({ ok: true, settings: await settingsWithHistory(env) });
  }

  // Fallback form for the reflection (same validation as Chief's publish endpoint).
  if (path === '/admin/api/reflection' && method === 'PUT') {
    const body = await readJson(request);
    if (body.error) return error(400, body.error);
    const r = await publishReflection(env, body.value);
    return r.ok ? json(r) : json({ error: 'invalid_guide', problems: r.problems }, 400);
  }
  return null;
}
