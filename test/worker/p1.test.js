// v2 P1 (PLAN-v2.md §3, §5, §7, §8): settings, Calendar/Weather screen data, batched Google consent.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { route } from '../../worker/src/index.js';
import { resetJwksCache } from '../../worker/src/auth/access.js';
import { startAuth, finishAuth } from '../../worker/src/google/oauth.js';
import { refreshWeather, WEATHER_KEY } from '../../worker/src/weather.js';
import { putCache, getCache } from '../../worker/src/db.js';
import { WRITES_PER_HOUR } from '../../worker/src/settings.js';
import { DEFAULTS } from '../../shared/settings.js';
import { testEnv, setup, req, auth, accessKeys, ORIGIN, HEALTH } from './helpers.js';

const CAL = 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const TASKS = 'https://www.googleapis.com/auth/tasks';
const NOW = Date.parse('2026-10-24T18:42:00Z'); // 12:42 PM MDT
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const METEO = {
  current: { time: '2026-10-24T12:30', temperature_2m: 54, weather_code: 2, is_day: 1 },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => '2026-10-' + String(24 + Math.floor(i / 24)) + 'T' + String(i % 24).padStart(2, '0') + ':00'),
    temperature_2m: Array.from({ length: 48 }, (_, i) => 40 + (i % 24)),
    precipitation_probability: Array.from({ length: 48 }, () => 10),
    weather_code: Array.from({ length: 48 }, () => 3),
    is_day: Array.from({ length: 48 }, (_, i) => (i % 24 > 6 && i % 24 < 18 ? 1 : 0)),
    wind_speed_10m: Array.from({ length: 48 }, () => 5),
  },
  daily: {
    time: Array.from({ length: 10 }, (_, i) => '2026-' + (i < 8 ? '10-' + (24 + i) : '11-0' + (i - 7))),
    weather_code: Array.from({ length: 10 }, () => 1),
    temperature_2m_max: Array.from({ length: 10 }, () => 60),
    temperature_2m_min: Array.from({ length: 10 }, () => 35),
    precipitation_probability_max: Array.from({ length: 10 }, () => 20),
    wind_speed_10m_max: Array.from({ length: 10 }, () => 12),
    sunrise: Array.from({ length: 10 }, () => '2026-10-24T07:20'),
    sunset: Array.from({ length: 10 }, () => '2026-10-24T18:00'),
  },
};

const GEO = {
  results: [
    { name: 'Boulder', admin1: 'Colorado', country: 'United States', latitude: 40.01499, longitude: -105.27055, timezone: 'America/Denver' },
    { name: 'Boulder City', admin1: 'Nevada', country: 'United States', latitude: 35.97859, longitude: -114.83249, timezone: 'America/Los_Angeles' },
  ],
};

/** Fake outbound fetch: Open-Meteo forecast and geocoding; records the URLs it saw. */
function fakeNet() {
  const seen = [];
  const fetchImpl = async (u) => {
    const s = String(u);
    seen.push(s);
    if (s.startsWith('https://geocoding-api.open-meteo.com/')) return json(GEO);
    if (s.includes('open-meteo.com')) return json(METEO);
    return new Response('nope', { status: 404 });
  };
  return { seen, fetchImpl };
}

const put = (path, token, body) => req(path, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function connect(env, scope) {
  const url = new URL(await startAuth(env, 'calendar', ORIGIN));
  const state = url.searchParams.get('state');
  const fetchImpl = async () => json({ access_token: 'at-c', refresh_token: 'rt-c', expires_in: 3600, scope });
  return finishAuth(env, new URL(ORIGIN + '/admin/oauth/callback?state=' + state + '&code=c1'), { fetchImpl });
}

describe('device settings API', () => {
  let env;
  let device;
  beforeEach(async () => {
    env = testEnv();
    device = await setup(env);
  });

  it('needs the device token', async () => {
    expect((await route(req('/api/settings/night', { method: 'PUT', body: '{"dimPct":30}' }), env)).status).toBe(401);
    expect((await route(put('/api/settings/night', 'nope.' + 'x'.repeat(20), { dimPct: 30 }), env)).status).toBe(401);
  });

  it('state carries defaults, features and the idle minutes from settings', async () => {
    const s = await (await route(req('/api/state', auth(device.token)), env)).json();
    expect(s.settings).toEqual(DEFAULTS);
    expect(s.features).toEqual({ calendar: true, weather: true, tasks: true, photos: true, reflection: true, controls: true });
    expect(s.tasks).toEqual({ scope: false, dueToday: [], dueCount: 0, overdue: 0, fetchedAt: null });
    expect(s.config.idleMinutes).toBe(10);
  });

  it('refuses unknown keys, unknown fields and every out-of-bounds value', async () => {
    const bad = [
      ['/api/settings/secrets', { a: 1 }, 'unknown_key'],
      ['/api/settings/night', { dimPct: 30, x: 1 }, 'unknown_field'],
      ['/api/settings/night', { dimPct: 10 }, 'night_dim_pct'],
      ['/api/settings/idle', { minutes: 0 }, 'idle_minutes'],
      ['/api/settings/schedule', { dayStart: 660 }, 'schedule_day_start'],
      ['/api/settings/schedule', { nightStart: 1020 }, 'schedule_night_start'],
      ['/api/settings/schedule', { dayStart: 600, nightStart: 1065 }, 'schedule_night_start'],
      ['/api/settings/calendar', { view: 'month' }, 'calendar_view'],
      ['/api/settings/weather', { lat: 100 }, 'weather_lat'],
    ];
    for (const [path, body, code] of bad) {
      const r = await route(put(path, device.token, body), env);
      expect(r.status, path + ' ' + JSON.stringify(body)).toBe(400);
      expect((await r.json()).error).toBe(code);
    }
    const tooShort = await route(put('/api/settings/schedule', device.token, { dayStart: 600, nightStart: 1080 + 0 }), env);
    expect(tooShort.status).toBe(200); // exactly 8 h is allowed
    const r = await route(put('/api/settings/schedule', device.token, { dayStart: 615 }), env);
    expect((await r.json()).error).toBe('schedule_day_start'); // 10:15 AM is past the bound
  });

  it('merges a patch instead of replacing, and records who changed it', async () => {
    let r = await route(put('/api/settings/schedule', device.token, { nightStart: 1305 }), env);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.settings.schedule).toEqual({ dayStart: 360, nightStart: 1305 });
    r = await route(put('/api/settings/schedule', device.token, { dayStart: 420 }), env);
    expect((await r.json()).settings.schedule).toEqual({ dayStart: 420, nightStart: 1305 });
    const row = await env.FRAME_DB.prepare("SELECT updated_by FROM settings WHERE key = 'schedule'").first();
    expect(row.updated_by).toBe('frame:' + device.id);
    const s = await (await route(req('/api/state', auth(device.token)), env)).json();
    expect(s.settings.schedule).toEqual({ dayStart: 420, nightStart: 1305 });
  });

  it('caps writes at 60 per device per hour', async () => {
    for (let i = 0; i < WRITES_PER_HOUR; i++) {
      const r = await route(put('/api/settings/night', device.token, { dimPct: 15 + (i % 10) * 5 }), env, { nowMs: NOW });
      expect(r.status).toBe(200);
    }
    const over = await route(put('/api/settings/night', device.token, { dimPct: 40 }), env, { nowMs: NOW });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('too_many_writes');
    // The next hour starts a fresh budget.
    expect((await route(put('/api/settings/night', device.token, { dimPct: 40 }), env, { nowMs: NOW + 3600000 })).status).toBe(200);
  });

  it('weather search proxies Open-Meteo geocoding at city precision and never logs the query', async () => {
    const { seen, fetchImpl } = fakeNet();
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = await route(req('/api/settings/weather/search?q=Zzexampletown', auth(device.token)), env, { fetchImpl });
      expect(r.status).toBe(200);
      const { places } = await r.json();
      expect(places[0]).toMatchObject({ name: 'Boulder', lat: 40.01, lon: -105.27, timeZone: 'America/Denver' });
      expect(seen[0]).toContain('geocoding-api.open-meteo.com');
      expect(logs.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('Zzexampletown');
    } finally {
      logs.mockRestore();
    }
    expect((await route(req('/api/settings/weather/search?q=a', auth(device.token)), env, { fetchImpl })).status).toBe(400);
    const down = async () => new Response('x', { status: 503 });
    expect((await route(req('/api/settings/weather/search?q=Boulder', auth(device.token)), env, { fetchImpl: down })).status).toBe(502);
  });

  it('a new weather location refreshes the weather at once, rounded', async () => {
    const { seen, fetchImpl } = fakeNet();
    const r = await route(put('/api/settings/weather', device.token, { name: 'Boulder', lat: 40.01499, lon: -105.27055, timeZone: 'America/Denver' }), env, { fetchImpl, nowMs: NOW });
    expect(r.status).toBe(200);
    expect((await r.json()).settings.weather).toEqual({ name: 'Boulder', lat: 40.01, lon: -105.27, timeZone: 'America/Denver' });
    expect(seen.some((u) => u.includes('latitude=40.01') && u.includes('longitude=-105.27'))).toBe(true);
    const w = await (await route(req('/api/weather', auth(device.token)), env, { nowMs: NOW })).json();
    expect(w.weather.place).toMatchObject({ name: 'Boulder', lat: 40.01 });
  });
});

describe('weather screen data', () => {
  it('serves 24 hours and 10 days, and Home still gets only the v1 fields', async () => {
    const env = testEnv();
    const device = await setup(env);
    const { fetchImpl } = fakeNet();
    expect((await refreshWeather(env, { fetchImpl, nowMs: NOW })).ok).toBe(true);
    const w = (await (await route(req('/api/weather', auth(device.token)), env, { nowMs: NOW })).json()).weather;
    expect(w.hourly).toHaveLength(24);
    expect(w.hourly[0].t).toBe('2026-10-24T12:00');
    expect(w.daily).toHaveLength(10);
    expect(w.daily[0]).toMatchObject({ rise: '07:20', set: '18:00', p: 20 });
    expect(w.stale).toBe(false);
    const s = await (await route(req('/api/state', auth(device.token)), env)).json();
    expect(Object.keys(s.weather).sort()).toEqual(expect.arrayContaining(['next3', 'now', 'today']));
    expect(s.weather.hourly).toBeUndefined();
    expect(s.weather.daily).toBeUndefined();
  });

  it('a refresh costs exactly one cache write and one meta write', async () => {
    const env = testEnv();
    await setup(env);
    const writes = [];
    const db = env.FRAME_DB;
    const counted = new Proxy(db, {
      get(t, k) {
        if (k === 'prepare') {
          return (sql) => {
            if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
            return t.prepare(sql);
          };
        }
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const { fetchImpl } = fakeNet();
    expect((await refreshWeather(Object.assign({}, env, { FRAME_DB: counted }), { fetchImpl, nowMs: NOW })).ok).toBe(true);
    expect(writes).toEqual(['INSERT INTO cache', 'INSERT INTO meta']);
    // Within 10 minutes the cron skips without writing.
    writes.length = 0;
    expect((await refreshWeather(Object.assign({}, env, { FRAME_DB: counted }), { fetchImpl, nowMs: NOW + 60000 })).skipped).toBe(true);
    expect(writes).toEqual([]);
  });

  it('a failed refresh keeps the old forecast', async () => {
    const env = testEnv();
    await setup(env);
    await putCache(env.FRAME_DB, WEATHER_KEY, { now: { tempF: 1 }, place: { lat: 39.74, lon: -104.99 } }, NOW - 3600000);
    expect((await refreshWeather(env, { fetchImpl: async () => new Response('x', { status: 500 }), nowMs: NOW })).ok).toBe(false);
    expect((await getCache(env.FRAME_DB, WEATHER_KEY)).value.now.tempF).toBe(1);
  });
});

describe('calendar screen data', () => {
  it('returns a window of days, marks days outside the cache as not loaded, and bounds the request', async () => {
    const env = testEnv();
    const device = await setup(env);
    await putCache(
      env.FRAME_DB,
      'calendar',
      {
        day: '2026-10-24',
        from: '2026-10-19',
        events: [
          { title: 'Example A', start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z', allDay: false, color: '#4285f4' },
          { title: 'Example B', start: '2026-10-24', end: '2026-10-25', allDay: true, color: null },
          { title: 'Example C', start: '2026-11-02T17:00:00Z', end: '2026-11-02T18:00:00Z', allDay: false, color: null },
        ],
      },
      NOW,
    );
    const r = await (await route(req('/api/calendar?from=2026-10-12&days=14', auth(device.token)), env, { nowMs: NOW })).json();
    expect(r.days).toHaveLength(14);
    expect(r.days.filter((d) => !d.loaded).map((d) => d.ymd)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(r.days.find((d) => d.ymd === '2026-10-20').timed.map((e) => e.title)).toEqual(['Example A']);
    expect(r.days.find((d) => d.ymd === '2026-10-24').allDay.map((e) => e.title)).toEqual(['Example B']);
    expect(r.next.title).toBe('Example C');
    expect(r.stale).toBe(false);
    for (const q of ['from=2026-10-24&days=15', 'from=2026-10-24&days=0', 'from=24-10-2026&days=7', 'from=2026-10-24&days=1.5']) {
      expect((await route(req('/api/calendar?' + q, auth(device.token)), env)).status, q).toBe(400);
    }
  });

  it('lists calendars and saves a selection from the frame (refreshing the cache)', async () => {
    const env = testEnv();
    const device = await setup(env);
    await connect(env, CAL + ' ' + TASKS);
    const list = { items: [{ id: 'p@example.com', summary: 'Example personal', backgroundColor: '#4285f4', primary: true }, { id: 'fam@group.calendar.google.com', summary: 'Example family', backgroundColor: '#33b679' }] };
    let eventCalls = 0;
    const fetchImpl = async (u) => {
      const s = String(u);
      if (s.includes('/users/me/calendarList')) return json(list);
      if (s.includes('/events')) {
        eventCalls++;
        return json({ items: [] });
      }
      return new Response('nope', { status: 404 });
    };
    const sync = await route(req('/api/calendars/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + device.token } }), env, { fetchImpl });
    expect(sync.status).toBe(200);
    expect((await sync.json()).calendars).toHaveLength(2);
    const sel = await route(put('/api/calendars/selection', device.token, { selected: ['p@example.com', 'fam@group.calendar.google.com'] }), env, { fetchImpl, nowMs: NOW });
    expect(sel.status).toBe(200);
    const body = await sel.json();
    expect(body).toMatchObject({ ok: true, refreshed: true });
    expect(body.calendars.filter((c) => c.selected)).toHaveLength(2);
    expect(eventCalls).toBe(2);
    const bad = await route(put('/api/calendars/selection', device.token, { selected: ['nope'] }), env, { fetchImpl });
    expect(bad.status).toBe(400);
    const listed = await (await route(req('/api/calendars', auth(device.token)), env)).json();
    expect(listed.max).toBeGreaterThan(0);
  });

  it('sync without a Google grant is a 409 the frame can explain', async () => {
    const env = testEnv();
    const device = await setup(env);
    const r = await route(req('/api/calendars/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + device.token } }), env);
    expect(r.status).toBe(409);
  });
});

describe('batched Google consent (Tasks scope)', () => {
  it('asks for calendar and Tasks scopes in one consent', async () => {
    const env = testEnv();
    await setup(env);
    const scope = new URL(await startAuth(env, 'calendar', ORIGIN)).searchParams.get('scope').split(' ');
    expect(scope).toEqual([...CAL.split(' '), TASKS]);
  });

  it('connects without Tasks (unticked), and health shows only the soft tasks_scope_missing', async () => {
    const env = testEnv();
    await setup(env);
    expect((await connect(env, CAL)).ok).toBe(true);
    const h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems.filter((p) => p === 'tasks_scope_missing')).toHaveLength(1);
    expect(h.problems.some((p) => p.startsWith('grant_calendar'))).toBe(false);
    expect(h.grants.calendar).toEqual({ status: 'ok', tasksScope: false });
  });

  it('a reconnect with Tasks clears it, and a token refresh without a scope field keeps it', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, CAL);
    await connect(env, CAL + ' ' + TASKS);
    let h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).not.toContain('tasks_scope_missing');
    expect(h.grants.calendar.tasksScope).toBe(true);
    const { accessToken } = await import('../../worker/src/google/oauth.js');
    const t = await accessToken(env, 'calendar', { nowMs: Date.now() + 2 * 3600000, fetchImpl: async () => json({ access_token: 'at-2', expires_in: 3600 }) });
    expect(t).toBe('at-2');
    h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.grants.calendar.tasksScope).toBe(true);
  });

  it('no calendar grant: no tasks_scope_missing on top of the real problem', async () => {
    const env = testEnv();
    await setup(env);
    const h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).toContain('grant_calendar_not_connected');
    expect(h.problems).not.toContain('tasks_scope_missing');
  });
});

describe('admin settings', () => {
  beforeEach(() => resetJwksCache());

  async function admin() {
    const { sign, fetchImpl: jwks } = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const jwt = await sign({ aud: ['test-aud'], iss: testEnv().ACCESS_TEAM_DOMAIN, email: 'admin@example.com', exp: now + 600, iat: now });
    const net = fakeNet();
    const fetchImpl = async (u, init) => (String(u).endsWith('/cdn-cgi/access/certs') ? jwks(u, init) : net.fetchImpl(u, init));
    const h = (extra = {}) => ({ headers: Object.assign({ 'cf-access-jwt-assertion': jwt }, extra.headers || {}), method: extra.method, body: extra.body });
    return { h, fetchImpl, net };
  }

  it('is behind Access', async () => {
    const env = testEnv();
    await setup(env);
    expect((await route(req('/admin/api/settings'), env)).status).toBe(403);
    expect((await route(req('/admin/api/settings/night', { method: 'PUT', body: '{"dimPct":30}' }), env)).status).toBe(403);
  });

  it('reads with history, writes with the same bounds, and resets to defaults', async () => {
    const env = testEnv();
    await setup(env);
    const { h, fetchImpl } = await admin();
    let r = await route(req('/admin/api/settings', h()), env, { fetchImpl });
    expect(r.status).toBe(200);
    let s = (await r.json()).settings;
    expect(s.map((x) => x.key)).toEqual(['schedule', 'night', 'idle', 'weather', 'calendar', 'photos', 'tasks', 'alerts', 'controls']);
    expect(s.every((x) => x.updatedBy === null)).toBe(true);
    r = await route(req('/admin/api/settings/night', h({ method: 'PUT', body: JSON.stringify({ dimPct: 70 }) })), env, { fetchImpl });
    expect(r.status).toBe(400);
    r = await route(req('/admin/api/settings/night', h({ method: 'PUT', body: JSON.stringify({ dimPct: 50 }) })), env, { fetchImpl });
    expect(r.status).toBe(200);
    s = (await r.json()).settings;
    expect(s.find((x) => x.key === 'night')).toMatchObject({ value: { dimPct: 50 }, updatedBy: 'admin:admin@example.com' });
    r = await route(req('/admin/api/settings/weather/search?q=Boulder', h()), env, { fetchImpl });
    expect((await r.json()).places).toHaveLength(2);
    r = await route(req('/admin/api/settings/reset', h({ method: 'POST' })), env, { fetchImpl });
    expect(r.status).toBe(200);
    s = (await r.json()).settings;
    expect(s.find((x) => x.key === 'night')).toMatchObject({ value: DEFAULTS.night, updatedBy: null });
  });

  it('admin writes do not count against the frame budget', async () => {
    const env = testEnv();
    const device = await setup(env);
    const { h, fetchImpl } = await admin();
    for (let i = 0; i < WRITES_PER_HOUR + 1; i++) {
      const r = await route(req('/admin/api/settings/idle', h({ method: 'PUT', body: JSON.stringify({ minutes: 1 + (i % 60) }) })), env, { fetchImpl });
      expect(r.status).toBe(200);
    }
    expect((await route(put('/api/settings/idle', device.token, { minutes: 5 }), env)).status).toBe(200);
  });
});
