// Frame settings (PLAN-v2.md §7.2): defaults, bounds and one pure validator, shared by the Worker
// (which enforces it) and the frame UI (so steppers can't go out of bounds).
// P1 keys only. P1b adds photos, tasks and alerts; phase D adds brightness.

export const SETTING_KEYS = ['schedule', 'night', 'idle', 'weather', 'calendar'];

export const DEFAULT_WEATHER = { name: 'Denver', lat: 39.74, lon: -104.99, timeZone: 'America/Denver' };

export const DEFAULTS = {
  schedule: { dayStart: 360, nightStart: 1320 }, // minutes past local midnight
  night: { dimPct: 35 },
  idle: { minutes: 10 },
  weather: DEFAULT_WEATHER,
  calendar: { view: 'agenda' },
};

export const BOUNDS = {
  schedule: { step: 15, dayStart: [240, 600], nightStart: [1080, 1440], minDay: 480 },
  night: { dimPct: [15, 60], step: 5 },
  idle: { minutes: [1, 60] },
  weather: { nameMax: 80 },
  calendar: { views: ['agenda', 'day', 'week'] },
};

const FIELDS = {
  schedule: ['dayStart', 'nightStart'],
  night: ['dimPct'],
  idle: ['minutes'],
  weather: ['name', 'lat', 'lon', 'timeZone'],
  calendar: ['view'],
};

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const inRange = (v, [lo, hi]) => isInt(v) && v >= lo && v <= hi;
const clone = (o) => JSON.parse(JSON.stringify(o));
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Validates a partial update for `key` and merges it over `current` (so a missing field can't reset
 * another). Returns {ok: true, value} or {ok: false, error}.
 */
export function validateSetting(key, patch, current) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return { ok: false, error: 'unknown_key' };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'bad_value' };
  const fields = Object.keys(patch);
  if (!fields.length) return { ok: false, error: 'bad_value' };
  if (fields.some((f) => FIELDS[key].indexOf(f) < 0)) return { ok: false, error: 'unknown_field' };
  const v = Object.assign(clone(current || DEFAULTS[key]), patch);
  const b = BOUNDS[key];
  if (key === 'schedule') {
    if (!inRange(v.dayStart, b.dayStart) || v.dayStart % b.step) return { ok: false, error: 'schedule_day_start' };
    if (!inRange(v.nightStart, b.nightStart) || v.nightStart % b.step) return { ok: false, error: 'schedule_night_start' };
    if (v.nightStart - v.dayStart < b.minDay) return { ok: false, error: 'schedule_day_too_short' };
  } else if (key === 'night') {
    if (!inRange(v.dimPct, b.dimPct)) return { ok: false, error: 'night_dim_pct' };
  } else if (key === 'idle') {
    if (!inRange(v.minutes, b.minutes)) return { ok: false, error: 'idle_minutes' };
  } else if (key === 'weather') {
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > b.nameMax) return { ok: false, error: 'weather_name' };
    if (typeof v.lat !== 'number' || !isFinite(v.lat) || v.lat < -90 || v.lat > 90) return { ok: false, error: 'weather_lat' };
    if (typeof v.lon !== 'number' || !isFinite(v.lon) || v.lon < -180 || v.lon > 180) return { ok: false, error: 'weather_lon' };
    if (v.timeZone !== undefined && v.timeZone !== null && (typeof v.timeZone !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v.timeZone))) {
      return { ok: false, error: 'weather_time_zone' };
    }
    // City level only: two decimals is about 1 km.
    v.name = v.name.trim();
    v.lat = round2(v.lat);
    v.lon = round2(v.lon);
  } else if (key === 'calendar') {
    if (b.views.indexOf(v.view) < 0) return { ok: false, error: 'calendar_view' };
  }
  return { ok: true, value: v };
}

/** Stored values merged over the defaults; anything that no longer validates falls back to the default. */
export function mergeSettings(stored, defaults = DEFAULTS) {
  const out = {};
  for (const key of SETTING_KEYS) {
    const s = stored && stored[key];
    const r = s ? validateSetting(key, pick(s, FIELDS[key]), defaults[key]) : null;
    out[key] = r && r.ok ? r.value : clone(defaults[key]);
  }
  return out;
}

function pick(o, fields) {
  const r = {};
  for (const f of fields) if (o[f] !== undefined) r[f] = o[f];
  return r;
}

/** '6:00 AM' for minutes past midnight (1440 → '12:00 AM'). */
export function minutesLabel(m) {
  const h24 = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h = h24 % 12 || 12;
  return h + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h24 < 12 ? 'AM' : 'PM');
}
