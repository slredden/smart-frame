// Open-Meteo weather (no key). City-level coordinates only (2 decimals), never a home address.
// One forecast call per refresh feeds both Home (now, today, next3) and the v2 Weather screen
// (24 hours and 10 days, PLAN-v2.md §5). Still one cache write + one meta write per refresh.
import { describeWeather } from '../../shared/weather-codes.js';
import { getCache, putCache, setMeta, nowIso } from './db.js';
import { getSettings } from './settings.js';
import { log } from './http.js';

export const WEATHER_KEY = 'weather';
export const WEATHER_MIN_AGE_MS = 10 * 60 * 1000;

/** `place` is the Settings weather location {name, lat, lon}. Times come back in the frame's zone. */
export function weatherUrl(env, place) {
  const q = new URLSearchParams({
    latitude: String(place ? place.lat : env.WEATHER_LAT || '39.74'),
    longitude: String(place ? place.lon : env.WEATHER_LON || '-104.99'),
    current: 'temperature_2m,weather_code,is_day',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day,wind_speed_10m',
    forecast_hours: '24',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: env.TIME_ZONE || 'America/Denver',
    forecast_days: '10',
  });
  return 'https://api.open-meteo.com/v1/forecast?' + q.toString();
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
const at = (arr, i) => (Array.isArray(arr) && i < arr.length ? arr[i] : undefined);
/** 'HH:MM' from Open-Meteo's local 'YYYY-MM-DDTHH:MM', else null. */
const hhmm = (v) => (typeof v === 'string' && /T\d{2}:\d{2}/.test(v) ? v.slice(11, 16) : null);
const icon = (code, isDay) => (typeof code === 'number' ? describeWeather(code, isDay).icon : null);

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
  // Weather screen: the next 24 hours from the current hour (t = local 'YYYY-MM-DDTHH:00').
  const hourly = [];
  const h = body.hourly;
  if (h && Array.isArray(h.time)) {
    const from = typeof c.time === 'string' ? c.time.slice(0, 13) : '';
    for (let i = 0; i < h.time.length && hourly.length < 24; i++) {
      const t = String(h.time[i]);
      if (t.slice(0, 13) < from) continue;
      const day = at(h.is_day, i);
      hourly.push({ t: t.slice(0, 16), f: num(at(h.temperature_2m, i)), p: num(at(h.precipitation_probability, i)), i: icon(at(h.weather_code, i), day === 1 || day === true), w: num(at(h.wind_speed_10m, i)) });
    }
  }
  const daily = [];
  for (let i = 0; i < Math.min(d.time.length, 10); i++) {
    daily.push({
      ymd: d.time[i],
      hi: num(at(d.temperature_2m_max, i)),
      lo: num(at(d.temperature_2m_min, i)),
      i: icon(at(d.weather_code, i), true),
      p: num(at(d.precipitation_probability_max, i)),
      w: num(at(d.wind_speed_10m_max, i)),
      rise: hhmm(at(d.sunrise, i)),
      set: hhmm(at(d.sunset, i)),
    });
  }
  return {
    now: { tempF: num(c.temperature_2m), code: c.weather_code, isDay, label: nowDesc.label, icon: nowDesc.icon },
    today: { hi: num(d.temperature_2m_max[0]), lo: num(d.temperature_2m_min[0]) },
    next3,
    hourly,
    daily,
  };
}

/** What /api/state carries for Home: the v1 fields only (the screen fetches /api/weather). */
export function homeWeather(value) {
  return { now: value.now, today: value.today, next3: value.next3, place: value.place };
}

const samePlace = (a, b) => !!(a && b && a.lat === b.lat && a.lon === b.lon);

/**
 * Refreshes the cached weather if it's at least 10 min old, or at once when the Settings location
 * changed. Keeps the old value on failure.
 */
export async function refreshWeather(env, { force = false, fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const [cached, settings] = await Promise.all([getCache(db, WEATHER_KEY), getSettings(env)]);
  const loc = settings.weather;
  const place = { name: loc.name, lat: loc.lat, lon: loc.lon, timeZone: loc.timeZone || null };
  const moved = cached && !samePlace(cached.value.place, place) && cached.value.place !== undefined;
  if (!force && !moved && cached && nowMs - Date.parse(cached.fetchedAt) < WEATHER_MIN_AGE_MS) return { skipped: true };
  try {
    const res = await fetchImpl(weatherUrl(env, place), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('weather_http_' + res.status);
    const value = normalizeWeather(await res.json());
    value.place = place;
    await putCache(db, WEATHER_KEY, value, nowMs);
    await setMeta(db, 'weather_ok_at', nowIso(nowMs));
    return { ok: true };
  } catch (e) {
    log('weather_error', { code: String(e.message).slice(0, 40) });
    return { ok: false };
  }
}

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * Settings › Weather location search, proxied so the frame only talks to the Worker. The query is
 * never logged (only the status and result count). Returns up to 5 places at 2-decimal precision.
 */
export async function searchPlaces(q, { fetchImpl = fetch } = {}) {
  const query = String(q || '').trim();
  if (query.length < 2 || query.length > 60) return { ok: false, error: 'bad_query' };
  const u = GEO_URL + '?' + new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' }).toString();
  let res;
  try {
    res = await fetchImpl(u, { headers: { Accept: 'application/json' } });
  } catch {
    log('geocode', { status: 0, results: 0 });
    return { ok: false, error: 'geocode_failed' };
  }
  if (!res.ok) {
    log('geocode', { status: res.status, results: 0 });
    return { ok: false, error: 'geocode_failed' };
  }
  const body = await res.json().catch(() => ({}));
  const places = [];
  for (const r of (body && body.results) || []) {
    if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number' || !r.name) continue;
    places.push({
      name: String(r.name).slice(0, 80),
      admin1: r.admin1 ? String(r.admin1).slice(0, 60) : '',
      country: r.country ? String(r.country).slice(0, 60) : '',
      lat: Math.round(r.latitude * 100) / 100,
      lon: Math.round(r.longitude * 100) / 100,
      timeZone: typeof r.timezone === 'string' ? r.timezone.slice(0, 60) : null,
    });
    if (places.length >= 5) break;
  }
  log('geocode', { status: res.status, results: places.length });
  return { ok: true, places };
}
