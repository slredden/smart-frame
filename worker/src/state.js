// GET /api/state: everything the frame renders, in one call (PLAN.md §9.1).
import { ymdIn } from '../../shared/time.js';
import { getCache } from './db.js';
import { WEATHER_KEY, homeWeather } from './weather.js';
import { getSettings } from './settings.js';
import { cachedCalendar, calendarPayload } from './google/calendar.js';
import { reflectionFor } from './reflection.js';
import { photoManifest } from './photos.js';

const HOUR = 3600000;

export const FEATURES = { calendar: true, tasks: false, weather: true, photos: false, reflection: false, controls: false };

export async function buildState(env, device, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const [w, cal, refl, photos, settings] = await Promise.all([
    getCache(db, WEATHER_KEY),
    cachedCalendar(db),
    reflectionFor(env, ymdIn(nowMs, tz)),
    photoManifest(env, device.id, nowMs),
    getSettings(env),
  ]);
  const weather = w ? Object.assign({ fetchedAt: w.fetchedAt, stale: nowMs - Date.parse(w.fetchedAt) > HOUR }, homeWeather(w.value)) : null;
  const calendar = cal
    ? Object.assign({ fetchedAt: cal.fetchedAt, stale: nowMs - Date.parse(cal.fetchedAt) > HOUR }, calendarPayload(cal.value.events || [], nowMs, tz))
    : null;
  return {
    build: env.BUILD_ID || 'dev',
    serverTime: new Date(nowMs).toISOString(),
    config: {
      idleMinutes: settings.idle.minutes,
      photoIntervalSec: Number(env.PHOTO_INTERVAL_SEC) || 60,
      timeZone: tz,
    },
    // Which screens are built (PLAN-v2.md §2.2). A screen joins the frame's rail when its phase ships.
    features: FEATURES,
    settings,
    weather,
    calendar,
    reflection: refl,
    photos,
  };
}
