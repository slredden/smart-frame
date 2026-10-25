// GET /api/health for Chief's monitor (PLAN.md §13). No personal content.
import { ymdIn } from '../../shared/time.js';
import { getMeta } from './db.js';
import { grantStatuses, grantHasScope, TASKS_SCOPE } from './google/oauth.js';
import { activeSet } from './photos.js';
import { spotifyStatus } from './spotify/oauth.js';
import { haConfigured, lastReachable } from './ha.js';
import { loadGuides } from './reflection.js';
import { currentWeek, pickGuide, reflectionFreshness } from '../../shared/reflection.js';

export const OFFLINE_MINUTES = 60;

const ageMin = (iso, nowMs) => (iso ? Math.floor((nowMs - Date.parse(iso)) / 60000) : null);

/** Problems that email Stephen; everything else is soft (shown on /api/health only). */
export const isAlert = (p) => p.startsWith('frame_') || p.startsWith('grant_') || p === 'spotify_reauth_due';

export async function buildHealth(env, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const dev = await db
    .prepare('SELECT build, MAX(COALESCE(last_heartbeat, \'\'), COALESCE(last_seen, \'\')) AS t FROM devices WHERE revoked_at IS NULL ORDER BY t DESC LIMIT 1')
    .first();
  const lastHeartbeat = dev && dev.t ? dev.t : null;
  const frameBuild = dev && dev.build ? dev.build : null;
  const frameAge = ageMin(lastHeartbeat, nowMs);
  const grants = await grantStatuses(db);
  const tasksScope = await grantHasScope(db, 'calendar', TASKS_SCOPE);
  const set = await activeSet(db);
  const photoSync = await getMeta(db, 'photo_sync_at');
  const weatherOk = await getMeta(db, 'weather_ok_at');
  const calendarOk = await getMeta(db, 'calendar_ok_at');
  const guides = await loadGuides(env);
  const today = ymdIn(nowMs, tz);
  const week = currentWeek(pickGuide(guides, today), today);
  // Freshness looks across every published guide (PLAN-v2.md §8.5); P1b keeps up to 6.
  const fresh = reflectionFreshness(guides, today);
  const tasksOk = await getMeta(db, 'tasks_ok_at');
  const tasksEmpty = await getMeta(db, 'tasks_lists_empty');
  const tl = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(selected), 0) AS s FROM tasklists').first();
  const publishedAt = await getMeta(db, 'reflection_published_at');
  const spotify = await spotifyStatus(env, nowMs);
  const haOn = haConfigured(env);
  const haOk = haOn ? await lastReachable(db) : null;
  const camCount = (await db.prepare('SELECT COUNT(*) AS n FROM controls_cams').first()).n;

  const problems = [];
  const offline = frameAge === null || frameAge > OFFLINE_MINUTES;
  if (offline) problems.push(lastHeartbeat ? 'frame_offline' : 'frame_never_seen');
  for (const name of ['calendar', 'photos']) {
    const s = grants[name].status;
    if (s !== 'ok') problems.push('grant_' + name + '_' + s);
  }
  const wAge = ageMin(weatherOk, nowMs);
  if (wAge === null || wAge > 60) problems.push('weather_stale');
  const cAge = ageMin(calendarOk, nowMs);
  if (grants.calendar.status === 'ok' && (cAge === null || cAge > 60)) problems.push('calendar_stale');
  // Soft (no alert): the calendar grant predates v2's batched consent, so P1b's Tasks can't load yet.
  if (grants.calendar.status === 'ok' && !tasksScope) problems.push('tasks_scope_missing');
  // Soft (P1b, Chief's Q11 check): Tasks is granted but the account has no task lists (e.g. the grant
  // went to an account without Google Tasks), or tasks haven't refreshed for an hour.
  const tAge = ageMin(tasksOk, nowMs);
  if (grants.calendar.status === 'ok' && tasksScope && tasksEmpty) problems.push('tasks_lists_empty');
  else if (grants.calendar.status === 'ok' && tasksScope && (tAge === null || tAge > 60)) problems.push('tasks_stale');
  if (!week) problems.push('reflection_no_current_week');
  if (fresh.weekly.stale) problems.push('reflection_weekly_stale');
  if (fresh.monthly.stale) problems.push('reflection_monthly_stale');
  // P2 Spotify (runbook-controls.md): soft until connected; alerting when it needs reconnecting.
  if (spotify.status === 'needs_reconsent') problems.push('grant_spotify_needs_reconsent');
  else if (spotify.status !== 'ok') problems.push('spotify_not_connected');
  else if (spotify.reauthDue) problems.push('spotify_reauth_due');
  // P2.1 (soft): the grant predates the Recent picker's optional scopes; Stephen reconnects on /admin.
  if (spotify.status === 'ok' && !spotify.recentScopes) problems.push('spotify_recent_needs_consent');
  // P2 Controls: all soft. Cameras are a nice-to-have; the frame says "Cameras offline" itself.
  if (!haOn) problems.push('controls_not_connected');
  else if (haOk === false) problems.push('controls_ha_unreachable');
  else if (!camCount) problems.push('controls_no_cameras');

  // Chief emails Stephen only for these: frame offline > 1 h, or a Google sign-in that needs fixing.
  const alert = problems.some(isAlert);
  return {
    ok: problems.length === 0,
    alert,
    build: env.BUILD_ID || 'dev',
    now: new Date(nowMs).toISOString(),
    frame: { lastHeartbeat, ageMinutes: frameAge, offline, build: frameBuild },
    grants: { calendar: { status: grants.calendar.status, tasksScope }, photos: { status: grants.photos.status } },
    controls: { connected: haOn, reachable: haOk, cameras: camCount },
    spotify: { configured: spotify.configured, status: spotify.status, connectedAt: spotify.connectedAt, reconnectBy: spotify.reconnectBy, recentScopes: spotify.recentScopes },
    photos: { lastSync: photoSync, count: set ? set.count : 0 },
    weather: { lastFetch: weatherOk, ageMinutes: wAge },
    calendar: { lastFetch: calendarOk },
    tasks: { scope: tasksScope, lastFetch: tasksOk || null, lists: tl ? tl.n : 0, selected: tl ? tl.s : 0, listsEmpty: !!tasksEmpty },
    reflection: { guides: guides.length, currentWeek: week ? week.n : null, weekly: fresh.weekly, monthly: fresh.monthly, publishedAt: publishedAt || null },
    problems,
  };
}
