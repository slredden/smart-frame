// Frame settings in D1 (PLAN-v2.md §7). JSON values per key, merged over the defaults; bounds live in
// shared/settings.js. Writes are device-authed (or /admin) and capped per device per hour.
import { DEFAULTS, DEFAULT_WEATHER, BOUNDS, SETTING_KEYS, validateSetting, mergeSettings } from '../../shared/settings.js';
import { nowIso, getMeta, setMeta } from './db.js';
import { log } from './http.js';

export const WRITES_PER_HOUR = 60;

/** Defaults, with the v1 env vars (IDLE_MINUTES, WEATHER_LAT/LON) as the fallback under D1. */
export function envDefaults(env) {
  const d = JSON.parse(JSON.stringify(DEFAULTS));
  const idle = Number(env.IDLE_MINUTES);
  if (Number.isInteger(idle) && idle >= 1 && idle <= 60) d.idle.minutes = idle;
  const iv = Number(env.PHOTO_INTERVAL_SEC);
  if (BOUNDS.photos.intervals.indexOf(iv) >= 0) d.photos.intervalSec = iv;
  const lat = Number(env.WEATHER_LAT);
  const lon = Number(env.WEATHER_LON);
  if (env.WEATHER_LAT && env.WEATHER_LON && isFinite(lat) && isFinite(lon) && (lat !== DEFAULT_WEATHER.lat || lon !== DEFAULT_WEATHER.lon)) {
    d.weather = { name: 'Weather location', lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, timeZone: null };
  }
  return d;
}

async function storedRows(db) {
  const { results } = await db.prepare('SELECT key, value, updated_at, updated_by FROM settings').all();
  return results;
}

/** Every setting, merged over the defaults. */
export async function getSettings(env) {
  const stored = {};
  for (const r of await storedRows(env.FRAME_DB)) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      // a bad row falls back to the default
    }
  }
  return mergeSettings(stored, envDefaults(env));
}

/** For /admin: each key's value plus who changed it last and when. */
export async function settingsWithHistory(env) {
  const values = await getSettings(env);
  const rows = await storedRows(env.FRAME_DB);
  return SETTING_KEYS.map((key) => {
    const r = rows.find((x) => x.key === key);
    return { key, value: values[key], updatedAt: r ? r.updated_at : null, updatedBy: r ? r.updated_by : null };
  });
}

/** Validates, merges over the current value and stores. Returns {ok, value} or {ok:false, error}. */
export async function putSetting(env, key, patch, by, nowMs = Date.now()) {
  const current = await getSettings(env);
  const r = validateSetting(key, patch, current[key]);
  if (!r.ok) return r;
  await env.FRAME_DB
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(key, JSON.stringify(r.value), nowIso(nowMs), String(by).slice(0, 120))
    .run();
  log('setting_changed', { key, by: String(by).split(':')[0] });
  return r;
}

/** /admin "Reset frame settings to defaults". */
export async function resetSettings(env) {
  await env.FRAME_DB.prepare('DELETE FROM settings').run();
  log('settings_reset', {});
}

/**
 * Counts one frame write against the device's hourly budget (one meta row per device). Returns true
 * when the write is over the limit and must be refused with 429.
 */
export async function overWriteBudget(db, deviceId, nowMs = Date.now()) {
  const hour = Math.floor(nowMs / 3600000);
  const key = 'writes:' + deviceId;
  let w;
  try {
    w = JSON.parse((await getMeta(db, key)) || 'null');
  } catch {
    w = null;
  }
  const n = w && w.hour === hour ? w.n + 1 : 1;
  if (n > WRITES_PER_HOUR) return true;
  await setMeta(db, key, JSON.stringify({ hour, n }));
  return false;
}
