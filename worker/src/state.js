// GET /api/state: everything the frame renders, in one call (PLAN.md §9.1).
import { ymdIn } from '../../shared/time.js';
import { getCache } from './db.js';
import { WEATHER_KEY } from './weather.js';
import { cachedCalendar, calendarPayload } from './google/calendar.js';
import { reflectionFor } from './reflection.js';
import { photoManifest } from './photos.js';

const HOUR = 3600000;

export async function buildState(env, device, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const tz = env.TIME_ZONE || 'America/Denver';
  const [w, cal, refl, photos] = await Promise.all([
    getCache(db, WEATHER_KEY),
    cachedCalendar(db),
    reflectionFor(env, ymdIn(nowMs, tz)),
    photoManifest(env, device.id, nowMs),
  ]);
  const weather = w ? Object.assign({ fetchedAt: w.fetchedAt, stale: nowMs - Date.parse(w.fetchedAt) > HOUR }, w.value) : null;
  const calendar = cal
    ? Object.assign({ fetchedAt: cal.fetchedAt, stale: nowMs - Date.parse(cal.fetchedAt) > HOUR }, calendarPayload(cal.value.events || [], nowMs, tz))
    : null;
  return {
    build: env.BUILD_ID || 'dev',
    serverTime: new Date(nowMs).toISOString(),
    config: {
      idleMinutes: Number(env.IDLE_MINUTES) || 10,
      photoIntervalSec: Number(env.PHOTO_INTERVAL_SEC) || 60,
      timeZone: tz,
    },
    weather,
    calendar,
    reflection: refl,
    photos,
  };
}
