// GET /api/state: everything the frame renders, in one call (PLAN.md §9.1).
import { ymdIn } from '../../shared/time.js';
import { getCache } from './db.js';
import { WEATHER_KEY, homeWeather } from './weather.js';
import { getSettings } from './settings.js';
import { cachedCalendar, calendarPayload } from './google/calendar.js';
import { reflectionFor, loadGuides } from './reflection.js';
import { cachedTasks, tasksSummary } from './google/tasks.js';
import { photoManifest } from './photos.js';

const HOUR = 3600000;

export const FEATURES = { calendar: true, tasks: true, weather: true, photos: true, reflection: true, controls: false };

export async function buildState(env, device, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const [w, cal, guides, photos, settings, tasks] = await Promise.all([
    getCache(db, WEATHER_KEY),
    cachedCalendar(db),
    loadGuides(env),
    photoManifest(env, device.id, nowMs),
    getSettings(env),
    cachedTasks(env, nowMs),
  ]);
  const refl = await reflectionFor(env, ymdIn(nowMs, tz), guides);
  const weather = w ? Object.assign({ fetchedAt: w.fetchedAt, stale: nowMs - Date.parse(w.fetchedAt) > HOUR }, homeWeather(w.value)) : null;
  const calendar = cal
    ? Object.assign({ fetchedAt: cal.fetchedAt, stale: nowMs - Date.parse(cal.fetchedAt) > HOUR }, calendarPayload(cal.value.events || [], nowMs, tz))
    : null;
  return {
    build: env.BUILD_ID || 'dev',
    serverTime: new Date(nowMs).toISOString(),
    config: {
      idleMinutes: settings.idle.minutes,
      photoIntervalSec: settings.photos.intervalSec,
      timeZone: tz,
    },
    // Which screens are built (PLAN-v2.md §2.2). A screen joins the frame's rail when its phase ships.
    features: FEATURES,
    settings,
    weather,
    calendar,
    reflection: refl,
    photos,
    // Home's "Due today" line and the 09:00 tasks alert (PLAN-v2.md §4.3, §9).
    tasks: tasksSummary(tasks, nowMs, tz),
  };
}
