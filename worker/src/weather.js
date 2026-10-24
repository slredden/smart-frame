// Open-Meteo weather (no key). City-center coordinates only, never a home address.
import { describeWeather } from '../../shared/weather-codes.js';
import { getCache, putCache, setMeta, nowIso } from './db.js';
import { log } from './http.js';

export const WEATHER_KEY = 'weather';
export const WEATHER_MIN_AGE_MS = 10 * 60 * 1000;

export function weatherUrl(env) {
  const q = new URLSearchParams({
    latitude: String(env.WEATHER_LAT || '39.74'),
    longitude: String(env.WEATHER_LON || '-104.99'),
    current: 'temperature_2m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: env.TIME_ZONE || 'America/Denver',
    forecast_days: '4',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + q.toString();
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);

/** Open-Meteo response → the compact shape the frame renders. Throws on a malformed body. */
export function normalizeWeather(body) {
  const c = body && body.current;
  const d = body && body.daily;
  if (!c || !d || !Array.isArray(d.time) || d.time.length < 1) throw new Error('weather_shape');
  const isDay = c.is_day === 1 || c.is_day === true;
  const nowDesc = describeWeather(c.weather_code, isDay);
  const next3 = [];
  for (let i = 1; i < Math.min(d.time.length, 4); i++) {
    next3.push({ ymd: d.time[i], hi: num(d.temperature_2m_max[i]), lo: num(d.temperature_2m_min[i]), code: d.weather_code[i], icon: describeWeather(d.weather_code[i], true).icon });
  }
  return {
    now: { tempF: num(c.temperature_2m), code: c.weather_code, isDay, label: nowDesc.label, icon: nowDesc.icon },
    today: { hi: num(d.temperature_2m_max[0]), lo: num(d.temperature_2m_min[0]) },
    next3,
  };
}

/** Refreshes the cached weather if it's at least 10 min old. Keeps the old value on failure. */
export async function refreshWeather(env, { force = false, fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const cached = await getCache(db, WEATHER_KEY);
  if (!force && cached && nowMs - Date.parse(cached.fetchedAt) < WEATHER_MIN_AGE_MS) return { skipped: true };
  try {
    const res = await fetchImpl(weatherUrl(env), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('weather_http_' + res.status);
    const value = normalizeWeather(await res.json());
    await putCache(db, WEATHER_KEY, value, nowMs);
    await setMeta(db, 'weather_ok_at', nowIso(nowMs));
    return { ok: true };
  } catch (e) {
    log('weather_error', { code: String(e.message).slice(0, 40) });
    return { ok: false };
  }
}
