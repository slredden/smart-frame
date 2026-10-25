// GET /api/health for Chief's monitor (PLAN.md §13). No personal content.
import { ymdIn } from '../../shared/time.js';
import { getMeta } from './db.js';
import { grantStatuses, grantHasScope, TASKS_SCOPE } from './google/oauth.js';
import { activeSet } from './photos.js';
import { loadGuide } from './reflection.js';
import { currentWeek, reflectionFreshness } from '../../shared/reflection.js';

export const OFFLINE_MINUTES = 60;

const ageMin = (iso, nowMs) => (iso ? Math.floor((nowMs - Date.parse(iso)) / 60000) : null);

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
  const guide = await loadGuide(env);
  const today = ymdIn(nowMs, tz);
  const week = currentWeek(guide, today);
  // v1 stores one guide (id = 1), so "all published guides" is that one (PLAN-v2.md §8.5).
  const fresh = reflectionFreshness(guide ? [guide] : [], today);
  const publishedAt = await getMeta(db, 'reflection_published_at');

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
  if (!week) problems.push('reflection_no_current_week');
  if (fresh.weekly.stale) problems.push('reflection_weekly_stale');
  if (fresh.monthly.stale) problems.push('reflection_monthly_stale');

  // Chief emails Stephen only for these: frame offline > 1 h, or a Google sign-in that needs fixing.
  const alert = problems.some((p) => p.startsWith('frame_') || p.startsWith('grant_'));
  return {
    ok: problems.length === 0,
    alert,
    build: env.BUILD_ID || 'dev',
    now: new Date(nowMs).toISOString(),
    frame: { lastHeartbeat, ageMinutes: frameAge, offline, build: frameBuild },
    grants: { calendar: { status: grants.calendar.status, tasksScope }, photos: { status: grants.photos.status } },
    photos: { lastSync: photoSync, count: set ? set.count : 0 },
    weather: { lastFetch: weatherOk, ageMinutes: wAge },
    calendar: { lastFetch: calendarOk },
    reflection: { currentWeek: week ? week.n : null, weekly: fresh.weekly, monthly: fresh.monthly, publishedAt: publishedAt || null },
    problems,
  };
}
