// P2 Ring cameras via Home Assistant (PLAN-v2.md §11.3, §11.6, §11.7). HA is a mocked `HA` binding.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { route } from '../../worker/src/index.js';
import { resetJwksCache } from '../../worker/src/auth/access.js';
import { buildHealth } from '../../worker/src/health.js';
import { saveCams, updatedAt } from '../../worker/src/controls.js';
import { haMissing } from '../../worker/src/ha.js';
import { putSetting } from '../../worker/src/settings.js';
import { testEnv, setup, req, auth, accessKeys } from './helpers.js';

const TOKEN = 'f'.repeat(40);
const TS = 1792000000; // ring-mqtt snapshot time, Unix seconds
const CAMS = [
  { entityId: 'camera.living_room_snapshot', label: 'Living room', indoor: true },
  { entityId: 'camera.front_door_snapshot', label: 'Front door', indoor: false },
  { entityId: 'camera.driveway_snapshot', label: 'Driveway', indoor: false },
];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A fake HA behind the binding. `down` makes every call throw (tunnel gone). */
function fakeHA(opts = {}) {
  const calls = [];
  const ha = {
    down: false,
    async fetch(u, init = {}) {
      const url = new URL(String(u));
      calls.push({ method: init.method || 'GET', path: url.pathname, auth: init.headers && init.headers.Authorization });
      if (ha.down) throw new Error('connect failed');
      const p = url.pathname;
      if (p === '/api/config') return Response.json({ version: '2026.10.1', location_name: 'Home' });
      if (p === '/api/states') return Response.json([{ entity_id: 'camera.front_door_snapshot', state: 'idle', attributes: { friendly_name: 'Front Door snapshot', timestamp: TS } }, { entity_id: 'light.kitchen', state: 'on', attributes: {} }]);
      let m = /^\/api\/states\/(camera\.[a-z_]+)$/.exec(p);
      if (m) {
        if (m[1] === 'camera.driveway_snapshot' && opts.drivewayGone) return Response.json({ message: 'Entity not found.' }, { status: 404 });
        return Response.json({ entity_id: m[1], state: 'idle', last_updated: '2026-10-24T18:00:00+00:00', attributes: { timestamp: TS } });
      }
      m = /^\/api\/camera_proxy\/(camera\.[a-z_]+)$/.exec(p);
      if (m) return new Response(opts.html ? '<html>' : JPEG, { headers: { 'content-type': opts.html ? 'text/html' : 'image/jpeg' } });
      return new Response('nope', { status: 404 });
    },
  };
  return { ha, calls };
}

let logs;
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

async function ready(opts = {}, withCams = true) {
  const { ha, calls } = fakeHA(opts);
  const env = testEnv({ HA: ha, HA_TOKEN: TOKEN });
  const dev = await setup(env);
  if (withCams) expect((await saveCams(env.FRAME_DB, CAMS)).ok).toBe(true);
  const call = (path) => route(req(path, auth(dev.token)), env);
  return { env, ha, calls, call, dev };
}

describe('ha module', () => {
  it('reports what is missing', () => {
    expect(haMissing({})).toBe('no_binding');
    expect(haMissing({ HA: {} })).toBe('no_binding');
    expect(haMissing({ HA: { fetch() {} } })).toBe('no_token');
    expect(haMissing({ HA: { fetch() {} }, HA_TOKEN: TOKEN })).toBe(null);
  });

  it('prefers the ring-mqtt snapshot timestamp over last_updated', () => {
    expect(updatedAt({ attributes: { timestamp: TS }, last_updated: '2026-01-01T00:00:00Z' })).toBe(new Date(TS * 1000).toISOString());
    expect(updatedAt({ attributes: {}, last_updated: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00.000Z');
    expect(updatedAt({ attributes: { timestamp: 'x' } })).toBe(null);
  });
});

describe('controls state', () => {
  it('needs a device token', async () => {
    const { env } = await ready();
    expect((await route(req('/api/controls/state'), env)).status).toBe(401);
    expect((await route(req('/api/controls/cam/c2'), env)).status).toBe(401);
  });

  it('degrades to "not connected" with no binding or no token, and never throws', async () => {
    for (const extra of [{}, { HA_TOKEN: TOKEN }, { HA: fakeHA().ha }]) {
      const env = testEnv(extra);
      const dev = await setup(env);
      await saveCams(env.FRAME_DB, CAMS);
      const r = await route(req('/api/controls/state', auth(dev.token)), env);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ connected: false, reason: 'not_connected', cams: [], indoorOn: false, revealSec: 45 });
      const img = await route(req('/api/controls/cam/c2', auth(dev.token)), env);
      expect(img.status).toBe(409);
    }
  });

  it('lists outdoor first with updated times, and skips indoor while the setting is off', async () => {
    const { call, calls } = await ready();
    const r = await call('/api/controls/state');
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.connected).toBe(true);
    expect(b.cams.map((c) => c.label)).toEqual(['Front door', 'Driveway', 'Living room']);
    expect(b.cams[0]).toEqual({ id: 'c2', label: 'Front door', indoor: false, updated: new Date(TS * 1000).toISOString(), available: true });
    expect(b.cams[2]).toEqual({ id: 'c1', label: 'Living room', indoor: true, off: true });
    expect(calls.map((c) => c.path).sort()).toEqual(['/api/states/camera.driveway_snapshot', '/api/states/camera.front_door_snapshot']);
    expect(calls.every((c) => c.method === 'GET' && c.auth === 'Bearer ' + TOKEN)).toBe(true);
  });

  it('asks about indoor cameras once the setting is on', async () => {
    const { env, call } = await ready();
    await putSetting(env, 'controls', { indoor: true, revealSec: 30 }, 'test');
    const b = await (await call('/api/controls/state')).json();
    expect(b).toMatchObject({ indoorOn: true, revealSec: 30 });
    expect(b.cams[2]).toMatchObject({ id: 'c1', available: true });
    expect(b.cams[2].off).toBeUndefined();
  });

  it('marks a missing entity unavailable without failing the rest', async () => {
    const { call } = await ready({ drivewayGone: true });
    const b = await (await call('/api/controls/state')).json();
    expect(b.cams[1]).toMatchObject({ id: 'c3', available: false, updated: null });
    expect(b.cams[0].available).toBe(true);
  });

  it('is 503 ha_unreachable when the tunnel is down, and health notices', async () => {
    const { env, ha, call } = await ready();
    ha.down = true;
    const r = await call('/api/controls/state');
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe('ha_unreachable');
    let h = await buildHealth(env);
    expect(h.problems).toContain('controls_ha_unreachable');
    expect(h.controls).toEqual({ connected: true, reachable: false, cameras: 3 });
    ha.down = false;
    await call('/api/controls/state');
    h = await buildHealth(env);
    expect(h.problems.filter((p) => p.startsWith('controls_'))).toEqual([]);
  });

  it('writes no KV and logs no token or entity names', async () => {
    const { env, call } = await ready();
    const before = await env.FRAME_DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM kv_writes').first();
    await call('/api/controls/state');
    await call('/api/controls/cam/c2');
    const after = await env.FRAME_DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM kv_writes').first();
    expect(after.n).toBe(before.n);
    const all = logs.join('\n');
    expect(all).toContain('controls_cam');
    expect(all).not.toMatch(/ffffffff|camera\.|front_door|Front door/);
  });
});

describe('controls camera image', () => {
  it('streams the image with no-store, private', async () => {
    const { call, calls } = await ready();
    const r = await call('/api/controls/cam/c2');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toBe('no-store, private');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(JPEG);
    expect(calls).toEqual([{ method: 'GET', path: '/api/camera_proxy/camera.front_door_snapshot', auth: 'Bearer ' + TOKEN }]);
  });

  it('refuses indoor cameras while off, and without a reveal tap while on', async () => {
    const { env, call, calls } = await ready();
    let r = await call('/api/controls/cam/c1?reveal=1');
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('indoor_off');
    await putSetting(env, 'controls', { indoor: true, revealSec: 45 }, 'test');
    r = await call('/api/controls/cam/c1');
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('reveal_required');
    expect(calls).toEqual([]);
    r = await call('/api/controls/cam/c1?reveal=1');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store, private');
  });

  it('404s unknown cameras and never asks HA about them', async () => {
    const { call, calls } = await ready();
    expect((await call('/api/controls/cam/c4')).status).toBe(404);
    expect((await call('/api/controls/cam/camera.x')).status).toBe(404);
    expect((await call('/api/controls/cam/zz')).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('503 when HA is unreachable, 502 when HA answers with something not an image', async () => {
    let s = await ready();
    s.ha.down = true;
    expect((await s.call('/api/controls/cam/c2')).status).toBe(503);
    s = await ready({ html: true });
    expect((await s.call('/api/controls/cam/c2')).status).toBe(502);
  });

  it('is GET only', async () => {
    const { env, dev } = await ready();
    const r = await route(req('/api/controls/cam/c2', { method: 'POST', headers: { Authorization: 'Bearer ' + dev.token } }), env);
    expect(r.status).not.toBe(200);
  });
});

describe('controls admin', () => {
  beforeEach(() => resetJwksCache());

  async function admin(env) {
    const { sign, fetchImpl } = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const jwt = await sign({ aud: ['test-aud'], iss: env.ACCESS_TEAM_DOMAIN, email: 'admin@example.com', exp: now + 600, iat: now });
    return (path, method = 'GET', body) =>
      route(req(path, { method, headers: { 'cf-access-jwt-assertion': jwt, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { fetchImpl });
  }

  it('is behind Access', async () => {
    const { env } = await ready();
    expect((await route(req('/admin/api/controls'), env)).status).toBe(403);
    expect((await route(req('/admin/api/controls/cams', { method: 'PUT', body: '{}' }), env)).status).toBe(403);
  });

  it('shows what is missing before the binding exists', async () => {
    const env = testEnv();
    await setup(env);
    const go = await admin(env);
    const s = await (await go('/admin/api/controls')).json();
    expect(s).toEqual({ connected: false, missing: 'no_binding', ha: null, cams: [] });
    expect((await go('/admin/api/controls/cameras')).status).toBe(409);
    const h = await buildHealth(env);
    expect(h.problems).toContain('controls_not_connected');
    expect(h.problems.filter((p) => p.startsWith('controls_'))).toEqual(['controls_not_connected']);
  });

  it('reports the HA version, lists camera entities, and saves the allowlist', async () => {
    const { env, calls } = await ready({}, false);
    const go = await admin(env);
    expect((await (await go('/admin/api/controls')).json()).ha).toEqual({ ok: true, version: '2026.10.1' });
    expect((await buildHealth(env)).problems).toContain('controls_no_cameras');
    const list = await (await go('/admin/api/controls/cameras')).json();
    expect(list.cameras).toEqual([{ entityId: 'camera.front_door_snapshot', name: 'Front Door snapshot', updated: new Date(TS * 1000).toISOString() }]);
    const r = await go('/admin/api/controls/cams', 'PUT', { cams: CAMS });
    expect(r.status).toBe(200);
    expect((await r.json()).cams.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('validates the allowlist', async () => {
    const { env } = await ready({}, false);
    const go = await admin(env);
    const bad = async (cams) => (await (await go('/admin/api/controls/cams', 'PUT', { cams })).json()).error;
    expect(await bad([{ entityId: 'light.kitchen', label: 'x', indoor: false }])).toBe('bad_entity');
    expect(await bad([{ entityId: 'camera.a', label: '', indoor: false }])).toBe('bad_label');
    expect(await bad([{ entityId: 'camera.a', label: 'x'.repeat(41), indoor: false }])).toBe('bad_label');
    expect(await bad([{ entityId: 'camera.a', label: 'x', indoor: 'yes' }])).toBe('bad_indoor');
    expect(await bad([{ entityId: 'camera.a', label: 'x', indoor: false }, { entityId: 'camera.a', label: 'y', indoor: false }])).toBe('duplicate_entity');
    expect(await bad(new Array(5).fill(0).map((_, i) => ({ entityId: 'camera.c' + i, label: 'x', indoor: false })))).toBe('too_many_cams');
    expect(await bad('nope')).toBe('too_many_cams');
    expect((await go('/admin/api/controls/cams', 'PUT', { cams: [] })).status).toBe(200);
  });
});
