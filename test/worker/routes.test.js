import { describe, it, expect, beforeEach, vi } from 'vitest';
import { route } from '../../worker/src/index.js';
import { resetJwksCache } from '../../worker/src/auth/access.js';
import { revokeDevice } from '../../worker/src/auth/device.js';
import { testEnv, setup, req, auth, accessKeys, HEALTH, PUBLISH } from './helpers.js';

const guide = {
  guide: { start: '2026-10-18', end: '2026-11-14' },
  weeks: [
    { n: 1, start: '2026-10-18', end: '2026-10-24', theme: 'Synthetic theme one', practice: 'Synthetic practice' },
    { n: 2, start: '2026-10-25', end: '2026-10-31', theme: 'Synthetic theme two', practice: '' },
    { n: 3, start: '2026-11-01', end: '2026-11-07', theme: 'Synthetic theme three', practice: '' },
    { n: 4, start: '2026-11-08', end: '2026-11-14', theme: 'Synthetic theme four', practice: '' },
  ],
};

describe('auth gates', () => {
  let env;
  let device;
  beforeEach(async () => {
    env = testEnv();
    device = await setup(env);
    resetJwksCache();
  });

  it('device API needs a valid token', async () => {
    expect((await route(req('/api/state'), env)).status).toBe(401);
    expect((await route(req('/api/state', auth('nope.' + 'x'.repeat(20))), env)).status).toBe(401);
    expect((await route(req('/api/state', auth(device.token)), env)).status).toBe(200);
    expect((await route(req('/api/unknown', auth(device.token)), env)).status).toBe(404);
  });

  it('revoked devices are refused', async () => {
    await revokeDevice(env.FRAME_DB, device.id);
    expect((await route(req('/api/state', auth(device.token)), env)).status).toBe(401);
  });

  it('health and publish need their own tokens, not a device token', async () => {
    expect((await route(req('/api/health'), env)).status).toBe(401);
    expect((await route(req('/api/health', auth(device.token)), env)).status).toBe(401);
    expect((await route(req('/api/health', auth(PUBLISH)), env)).status).toBe(401);
    expect((await route(req('/api/publish/reflection', Object.assign({ method: 'PUT' }, auth(HEALTH))), env)).status).toBe(401);
  });

  it('health fails closed when its hash is unset', async () => {
    const e = testEnv({ HEALTH_TOKEN_HASH: '' });
    expect((await route(req('/api/health', auth(HEALTH)), e)).status).toBe(401);
  });

  it('admin is 403 without a valid Access JWT', async () => {
    const { sign, fetchImpl } = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const good = { aud: ['test-aud'], iss: env.ACCESS_TEAM_DOMAIN, email: 'admin@example.com', exp: now + 600, iat: now };
    const h = (jwt) => ({ headers: { 'cf-access-jwt-assertion': jwt } });
    expect((await route(req('/admin/'), env, { fetchImpl })).status).toBe(403);
    expect((await route(req('/admin/', h(await sign(Object.assign({}, good, { aud: ['other'] })))), env, { fetchImpl })).status).toBe(403);
    expect((await route(req('/admin/', h(await sign(Object.assign({}, good, { email: 'someone@example.com' })))), env, { fetchImpl })).status).toBe(403);
    expect((await route(req('/admin/', h(await sign(Object.assign({}, good, { exp: now - 120 })))), env, { fetchImpl })).status).toBe(403);
    expect((await route(req('/admin/', h(await sign(Object.assign({}, good, { iss: 'https://evil.cloudflareaccess.com' })))), env, { fetchImpl })).status).toBe(403);
    const ok = await route(req('/admin/', h(await sign(good))), env, { fetchImpl });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const st = await route(req('/admin/api/status', h(await sign(good))), env, { fetchImpl });
    expect(st.status).toBe(200);
    const sj = await st.json();
    expect(sj.admin).toBe('admin@example.com');
    expect(sj.job).toBeNull();
  });

  it('admin fails closed when ACCESS_AUD is unset', async () => {
    const { sign, fetchImpl } = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const e = testEnv({ ACCESS_AUD: '' });
    const jwt = await sign({ aud: [''], iss: e.ACCESS_TEAM_DOMAIN, email: 'admin@example.com', exp: now + 600 });
    expect((await route(req('/admin/', { headers: { 'cf-access-jwt-assertion': jwt } }), e, { fetchImpl })).status).toBe(403);
  });

  it('static files pass through to assets', async () => {
    const r = await route(req('/'), env);
    expect(await r.text()).toBe('static:/');
  });
});

describe('reflection publish + state', () => {
  it('publishes, encrypts at rest, serves the current week, and never logs the text', async () => {
    const env = testEnv();
    const device = await setup(env);
    const logs = vi.spyOn(console, 'log');
    const r = await route(req('/api/publish/reflection', { method: 'PUT', headers: { Authorization: 'Bearer ' + PUBLISH, 'content-type': 'application/json' }, body: JSON.stringify(guide) }), env);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(JSON.stringify(body)).not.toContain('Synthetic theme');
    const row = await env.FRAME_DB.prepare('SELECT data_enc FROM reflection WHERE id = 1').first();
    expect(row.data_enc).not.toContain('Synthetic');
    for (const call of logs.mock.calls) expect(JSON.stringify(call)).not.toContain('Synthetic');

    vi.useFakeTimers({ now: Date.parse('2026-10-26T18:00:00Z'), toFake: ['Date'] });
    try {
      const s = await (await route(req('/api/state', auth(device.token)), env)).json();
      expect(s.reflection).toEqual({ n: 2, theme: 'Synthetic theme two', practice: '' });
      expect(s.build).toBe('test-build');
      expect(s.config).toEqual({ idleMinutes: 10, photoIntervalSec: 60, timeZone: 'America/Denver' });
      expect(s.photos).toEqual({ setId: null, items: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid guide with problems', async () => {
    const env = testEnv();
    await setup(env);
    const bad = JSON.parse(JSON.stringify(guide));
    bad.weeks[1].start = '2026-10-26';
    const r = await route(req('/api/publish/reflection', { method: 'PUT', headers: { Authorization: 'Bearer ' + PUBLISH }, body: JSON.stringify(bad) }), env);
    expect(r.status).toBe(400);
    expect((await r.json()).problems).toContain('week_2_start');
  });
});

describe('health', () => {
  it('reports problems and the alert flag without personal content', async () => {
    const env = testEnv();
    const device = await setup(env);
    let h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.ok).toBe(false);
    expect(h.alert).toBe(true);
    expect(h.problems).toEqual(expect.arrayContaining(['frame_never_seen', 'grant_calendar_not_connected', 'grant_photos_not_connected', 'weather_stale', 'reflection_no_current_week']));

    const hb = await route(req('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer ' + device.token }, body: JSON.stringify({ build: 'b1', uptimeSec: 60, jsErrors: [] }) }), env);
    expect(hb.status).toBe(204);
    h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.frame.offline).toBe(false);
    expect(h.problems).not.toContain('frame_never_seen');
    expect(Object.keys(h).sort()).toEqual(['alert', 'build', 'calendar', 'frame', 'grants', 'now', 'ok', 'photos', 'problems', 'reflection', 'spotify', 'tasks', 'weather']);
    expect(h.frame.build).toBe('b1');
  });

  it('flags a missing reflection as stale weekly and monthly, as soft problems', async () => {
    const env = testEnv();
    const device = await setup(env);
    await route(req('/api/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer ' + device.token }, body: JSON.stringify({ build: 'b1', uptimeSec: 60, jsErrors: [] }) }), env);
    const h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).toEqual(expect.arrayContaining(['reflection_no_current_week', 'reflection_weekly_stale', 'reflection_monthly_stale']));
    expect(h.reflection).toEqual({
      guides: 0,
      currentWeek: null,
      weekly: { start: null, ageDays: null, stale: true },
      monthly: { start: null, end: null, ageDays: null, stale: true },
      publishedAt: null,
    });
    // Soft: only the Google grants (not connected in tests) raise the alert, not the reflection.
    expect(h.problems.filter((p) => p.startsWith('frame_'))).toEqual([]);
  });

  it('reports freshness from guide dates only, and goes weekly-stale on day 9', async () => {
    const env = testEnv();
    await setup(env);
    vi.useFakeTimers({ now: Date.parse('2026-10-24T18:00:00Z'), toFake: ['Date'] });
    try {
      await route(req('/api/publish/reflection', { method: 'PUT', headers: { Authorization: 'Bearer ' + PUBLISH }, body: JSON.stringify(guide) }), env);
      // 2026-10-26 (Denver) is day 1 of week 2.
      vi.setSystemTime(Date.parse('2026-10-26T18:00:00Z'));
      let h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
      expect(h.problems).not.toContain('reflection_weekly_stale');
      expect(h.problems).not.toContain('reflection_monthly_stale');
      expect(h.reflection).toEqual({
        guides: 1,
        currentWeek: 2,
        weekly: { start: '2026-10-25', ageDays: 1, stale: false },
        monthly: { start: '2026-10-18', end: '2026-11-14', ageDays: 8, stale: false },
        publishedAt: '2026-10-24T18:00:00.000Z',
      });
      expect(JSON.stringify(h)).not.toContain('Synthetic');
      // Past the guide: week 4 (11-08) is 8 days old on 11-16 and 9 on 11-17 (Denver, 8 PM MST).
      vi.setSystemTime(Date.parse('2026-11-17T03:00:00Z'));
      h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
      expect(h.reflection.weekly).toEqual({ start: '2026-11-08', ageDays: 8, stale: false });
      vi.setSystemTime(Date.parse('2026-11-18T03:00:00Z'));
      h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
      expect(h.reflection.weekly).toEqual({ start: '2026-11-08', ageDays: 9, stale: true });
      expect(h.problems).toContain('reflection_weekly_stale');
      expect(h.problems).not.toContain('reflection_monthly_stale');
    } finally {
      vi.useRealTimers();
    }
  });
});
