// P2 Spotify (PLAN-v2.md §11.5, §13 P2 acceptance): OAuth, state, actions, health. Spotify is mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { route } from '../../worker/src/index.js';
import { resetJwksCache } from '../../worker/src/auth/access.js';
import { startAuth, finishAuth, accessToken, SCOPES, TOKEN_URL } from '../../worker/src/spotify/oauth.js';
import { buildHealth } from '../../worker/src/health.js';
import { getMeta, setMeta } from '../../worker/src/db.js';
import { testEnv, setup, req, auth, accessKeys, ORIGIN } from './helpers.js';

const SECRET = 'f'.repeat(32);
const NOW = Date.parse('2026-10-24T18:00:00Z');
const DAY = 86400000;
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers) });
const spEnv = (extra = {}) => testEnv(Object.assign({ SPOTIFY_CLIENT_SECRET: SECRET }, extra));

const ECHO = { id: 'dev-echo', name: "Stephen's Office", type: 'Speaker', is_active: false, volume_percent: 40 };
const TV = { id: 'dev-tv', name: 'Living Room TV', type: 'TV', is_active: true, volume_percent: 20 };
const PLAYER = {
  is_playing: true,
  device: { id: 'dev-tv', name: 'Living Room TV', type: 'TV', volume_percent: 20 },
  item: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'https://i.scdn.co/image/big', width: 640 }, { url: 'https://i.scdn.co/image/mid', width: 300 }, { url: 'https://i.scdn.co/image/small', width: 64 }] } },
};

/** A fake accounts + Web API. `api` maps "METHOD /path" to a reply; anything else is 204. */
function fakeSpotify(api = {}) {
  const calls = [];
  const tokenCalls = [];
  let refreshReply = { access_token: 'sp-at-2', refresh_token: 'sp-rt-2', expires_in: 3600, scope: SCOPES.join(' ') };
  let grantScope = SCOPES.join(' ');
  const fetchImpl = async (u, init = {}) => {
    const url = String(u);
    if (url === TOKEN_URL) {
      const body = new URLSearchParams(String(init.body));
      tokenCalls.push({ auth: init.headers.Authorization, body: Object.fromEntries(body) });
      if (body.get('grant_type') === 'authorization_code') return json({ access_token: 'sp-at-1', refresh_token: 'sp-rt-1', expires_in: 3600, scope: grantScope });
      return typeof refreshReply === 'function' ? refreshReply() : json(refreshReply);
    }
    if (!url.startsWith('https://api.spotify.com/v1/')) throw new Error('unexpected fetch ' + url);
    const key = init.method + ' ' + url.slice('https://api.spotify.com/v1'.length);
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.Authorization });
    const r = api[key];
    if (typeof r === 'function') return r();
    if (r) return json(r);
    return new Response(null, { status: 204 });
  };
  return {
    fetchImpl,
    calls,
    tokenCalls,
    setRefresh: (r) => (refreshReply = r),
    setScope: (s) => (grantScope = s),
  };
}

async function connect(env, net, nowMs = NOW) {
  const url = new URL(await startAuth(env, ORIGIN, nowMs));
  const state = url.searchParams.get('state');
  return finishAuth(env, new URL(ORIGIN + '/admin/spotify/callback?state=' + state + '&code=c1'), { fetchImpl: net.fetchImpl, nowMs });
}

const basicFor = (env) => 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + SECRET);

let logs;
beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

describe('spotify oauth', () => {
  it('asks for exactly the two playback scopes, on its own callback path', async () => {
    const env = spEnv();
    await setup(env);
    const url = new URL(await startAuth(env, ORIGIN, NOW));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('scope')).toBe('user-read-playback-state user-modify-playback-state');
    expect(url.searchParams.get('redirect_uri')).toBe(ORIGIN + '/admin/spotify/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(env.SPOTIFY_CLIENT_ID);
    const row = await env.FRAME_DB.prepare('SELECT grant_name FROM oauth_state WHERE state = ?').bind(url.searchParams.get('state')).first();
    expect(row.grant_name).toBe('spotify');
  });

  it('checks state, exchanges with Basic auth, and stores tokens encrypted', async () => {
    const env = spEnv();
    await setup(env);
    const net = fakeSpotify();
    expect(await finishAuth(env, new URL(ORIGIN + '/admin/spotify/callback?state=bogus&code=c1'), { fetchImpl: net.fetchImpl })).toEqual({ ok: false, error: 'bad_state' });
    expect(net.tokenCalls).toHaveLength(0);
    expect(await connect(env, net)).toEqual({ ok: true });
    expect(net.tokenCalls[0].auth).toBe(basicFor(env));
    expect(net.tokenCalls[0].body).toMatchObject({ grant_type: 'authorization_code', code: 'c1', redirect_uri: ORIGIN + '/admin/spotify/callback' });
    expect(net.tokenCalls[0].body.client_secret).toBeUndefined();
    const row = await env.FRAME_DB.prepare("SELECT refresh_enc, access_enc, status FROM grants WHERE name = 'spotify'").first();
    expect(row.status).toBe('ok');
    expect(row.refresh_enc).not.toContain('sp-rt-1');
    expect(row.access_enc).not.toContain('sp-at-1');
    expect(await getMeta(env.FRAME_DB, 'spotify_connected_at')).toBe(new Date(NOW).toISOString());
    // A Google state can't finish a Spotify sign-in.
    await env.FRAME_DB.prepare("INSERT INTO oauth_state (state, grant_name, verifier, created_at) VALUES ('g1', 'calendar', 'v', ?)").bind(NOW).run();
    expect((await finishAuth(env, new URL(ORIGIN + '/admin/spotify/callback?state=g1&code=c1'), { fetchImpl: net.fetchImpl, nowMs: NOW })).error).toBe('bad_state');
    expect(logs.join('\n')).not.toMatch(/sp-at|sp-rt|ffffffff/);
  });

  it('refuses a consent without the playback scopes', async () => {
    const env = spEnv();
    await setup(env);
    const net = fakeSpotify();
    net.setScope('user-read-playback-state');
    expect(await connect(env, net)).toEqual({ ok: false, error: 'scope_missing' });
  });

  it('refreshes with Basic auth and keeps a rotated refresh token', async () => {
    const env = spEnv();
    await setup(env);
    const net = fakeSpotify();
    await connect(env, net);
    expect(await accessToken(env, { fetchImpl: net.fetchImpl, nowMs: NOW + 60000 })).toBe('sp-at-1'); // cached
    expect(net.tokenCalls).toHaveLength(1);
    expect(await accessToken(env, { fetchImpl: net.fetchImpl, nowMs: NOW + 2 * 3600000 })).toBe('sp-at-2');
    expect(net.tokenCalls[1].auth).toBe(basicFor(env));
    expect(net.tokenCalls[1].body).toEqual({ grant_type: 'refresh_token', refresh_token: 'sp-rt-1' });
    // Next refresh must send the rotated token, then keep it when Spotify sends none back.
    net.setRefresh({ access_token: 'sp-at-3', expires_in: 3600 });
    expect(await accessToken(env, { fetchImpl: net.fetchImpl, nowMs: NOW + 4 * 3600000 })).toBe('sp-at-3');
    expect(net.tokenCalls[2].body.refresh_token).toBe('sp-rt-2');
    net.setRefresh({ access_token: 'sp-at-4', expires_in: 3600 });
    await accessToken(env, { fetchImpl: net.fetchImpl, nowMs: NOW + 6 * 3600000 });
    expect(net.tokenCalls[3].body.refresh_token).toBe('sp-rt-2');
    expect(logs.join('\n')).not.toMatch(/sp-at|sp-rt/);
  });

  it('marks needs_reconsent on invalid_grant, which alerts', async () => {
    const env = spEnv();
    await setup(env);
    const net = fakeSpotify();
    await connect(env, net);
    net.setRefresh(() => json({ error: 'invalid_grant' }, 400));
    expect(await accessToken(env, { fetchImpl: net.fetchImpl, nowMs: NOW + 2 * 3600000 })).toBe(null);
    const h = await buildHealth(env, NOW + 2 * 3600000);
    expect(h.problems).toContain('grant_spotify_needs_reconsent');
    expect(h.alert).toBe(true);
    expect(h.spotify.status).toBe('needs_reconsent');
  });
});

describe('spotify health', () => {
  it('is soft spotify_not_connected until connected, with no secret', async () => {
    const env = testEnv();
    await setup(env);
    const h = await buildHealth(env, NOW);
    expect(h.problems).toContain('spotify_not_connected');
    expect(h.spotify).toEqual({ configured: false, status: 'not_connected', connectedAt: null, reconnectBy: null });
  });

  it('adds alerting spotify_reauth_due from day 168', async () => {
    const env = spEnv();
    await setup(env);
    await connect(env, fakeSpotify());
    // A paired, recently seen frame so only Spotify can raise the alert.
    await env.FRAME_DB.prepare('UPDATE devices SET last_heartbeat = ?').bind(new Date(NOW + 167 * DAY).toISOString()).run();
    let h = await buildHealth(env, NOW + 167 * DAY);
    expect(h.problems).not.toContain('spotify_reauth_due');
    expect(h.problems).not.toContain('spotify_not_connected');
    expect(h.spotify.reconnectBy).toBe(new Date(NOW + 182 * DAY).toISOString());
    await env.FRAME_DB.prepare('UPDATE devices SET last_heartbeat = ?').bind(new Date(NOW + 168 * DAY).toISOString()).run();
    h = await buildHealth(env, NOW + 168 * DAY);
    expect(h.problems).toContain('spotify_reauth_due');
    expect(h.alert).toBe(true);
  });
});

describe('spotify frame routes', () => {
  async function ready(api) {
    const env = spEnv();
    const dev = await setup(env);
    const net = fakeSpotify(api);
    await connect(env, net);
    const call = (path, init = {}) => route(req(path, Object.assign({}, init, auth(dev.token))), env, { fetchImpl: net.fetchImpl, nowMs: NOW + 60000 });
    const post = (action, body) => call('/api/spotify/' + action, { method: 'POST', body: body === undefined ? '' : JSON.stringify(body) });
    return { env, net, call, post };
  }

  it('needs a device token', async () => {
    const env = spEnv();
    await setup(env);
    expect((await route(req('/api/spotify/state'), env)).status).toBe(401);
    expect((await route(req('/api/spotify/play', { method: 'POST' }), env)).status).toBe(401);
  });

  it('says not connected without a grant (and without the secret)', async () => {
    for (const env of [spEnv(), testEnv()]) {
      const dev = await setup(env);
      const r = await route(req('/api/spotify/state', auth(dev.token)), env, { fetchImpl: () => { throw new Error('no fetch'); } });
      expect(r.status).toBe(200);
      expect((await r.json()).connected).toBe(false);
      expect((await route(req('/api/spotify/play', Object.assign({ method: 'POST' }, auth(dev.token))), env)).status).toBe(409);
    }
  });

  it('returns now playing; devices on the first poll and on request only', async () => {
    const { net, call } = await ready({ 'GET /me/player?additional_types=episode': PLAYER, 'GET /me/player/devices': { devices: [TV, ECHO] } });
    let r = await call('/api/spotify/state');
    expect(r.status).toBe(200);
    const s = await r.json();
    expect(s).toEqual({
      connected: true,
      playing: true,
      item: { title: 'Song', artists: 'A, B', art: 'https://i.scdn.co/image/mid' },
      device: { id: 'dev-tv', name: 'Living Room TV', type: 'TV', volume: 20 },
      devices: [
        { id: 'dev-tv', name: 'Living Room TV', type: 'TV', active: true, remembered: false },
        { id: 'dev-echo', name: "Stephen's Office", type: 'Speaker', active: false, remembered: true },
      ],
      lastDevice: "Stephen's Office",
    });
    expect(net.calls.map((c) => c.key)).toEqual(['GET /me/player?additional_types=episode', 'GET /me/player/devices']);
    expect(net.calls[0].auth).toBe('Bearer sp-at-1');
    r = await call('/api/spotify/state');
    expect((await r.json()).devices).toHaveLength(2);
    expect(net.calls.filter((c) => c.key === 'GET /me/player/devices')).toHaveLength(1);
    await call('/api/spotify/state?devices=1');
    expect(net.calls.filter((c) => c.key === 'GET /me/player/devices')).toHaveLength(2);
  });

  it('nothing playing (204) is connected with no item', async () => {
    const { call } = await ready({ 'GET /me/player/devices': { devices: [ECHO] } });
    const s = await (await call('/api/spotify/state')).json();
    expect(s).toMatchObject({ connected: true, playing: false, item: null, device: null });
  });

  it('maps each action to exactly one Web API call', async () => {
    const { net, post } = await ready();
    for (const a of ['play', 'pause', 'next', 'prev']) expect((await post(a)).status).toBe(200);
    expect((await post('volume', { volume: 55 })).status).toBe(200);
    expect(net.calls.map((c) => c.key)).toEqual(['PUT /me/player/play', 'PUT /me/player/pause', 'POST /me/player/next', 'POST /me/player/previous', 'PUT /me/player/volume?volume_percent=55']);
    for (const v of [-1, 101, 5.5, '50', null]) expect((await post('volume', { volume: v })).status).toBe(400);
    expect((await post('shuffle')).status).toBe(404);
    expect(net.calls).toHaveLength(5);
  });

  it('refuses a transfer to an id not in the last device list, and remembers the name after one', async () => {
    const { env, net, call, post } = await ready({ 'GET /me/player?additional_types=episode': PLAYER, 'GET /me/player/devices': { devices: [TV, ECHO] } });
    expect((await post('transfer', { device_id: 'dev-echo' })).status).toBe(400); // no list yet
    await call('/api/spotify/state');
    let r = await post('transfer', { device_id: 'dev-other' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'unknown_device' });
    r = await post('transfer', { device_id: 'dev-tv' });
    expect(r.status).toBe(200);
    expect(net.calls.at(-1)).toMatchObject({ key: 'PUT /me/player', body: { device_ids: ['dev-tv'] } });
    expect(await getMeta(env.FRAME_DB, 'spotify_last_device')).toBe('Living Room TV');
    const s = await (await call('/api/spotify/state')).json();
    expect(s.devices.find((d) => d.remembered).id).toBe('dev-tv');
  });

  it('play with no active device moves to the remembered device by name, ignoring case', async () => {
    const noActive = () => json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404);
    const { env, net, post } = await ready({ 'PUT /me/player/play': noActive, 'GET /me/player/devices': { devices: [Object.assign({}, ECHO, { name: "STEPHEN'S OFFICE" })] } });
    const r = await post('play');
    expect(r.status).toBe(200);
    expect(net.calls.map((c) => c.key)).toEqual(['PUT /me/player/play', 'GET /me/player/devices', 'PUT /me/player']);
    expect(net.calls[2].body).toEqual({ device_ids: ['dev-echo'], play: true });
    await setMeta(env.FRAME_DB, 'spotify_last_device', 'Kitchen Echo');
    const r2 = await post('play');
    expect(r2.status).toBe(409);
    expect(await r2.json()).toEqual({ error: 'device_absent', name: 'Kitchen Echo', devices: [{ id: 'dev-echo', name: "STEPHEN'S OFFICE", type: 'Speaker' }] });
    expect(net.calls.at(-1).key).toBe('GET /me/player/devices'); // never plays elsewhere
  });

  it('403 is "Premium needed"', async () => {
    const { post } = await ready({ 'PUT /me/player/pause': () => json({ error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } }, 403) });
    const r = await post('pause');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'premium_needed' });
  });

  it('429 passes Retry-After back; QUOTA_EXCEEDED without one backs off 60 s', async () => {
    const { post, call } = await ready({
      'POST /me/player/next': () => json({ error: { status: 429, message: 'busy' } }, 429, { 'Retry-After': '7' }),
      'GET /me/player?additional_types=episode': () => json({ error: { status: 429, message: 'quota', reason: 'QUOTA_EXCEEDED' } }, 429),
    });
    let r = await post('next');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('7');
    expect(await r.json()).toEqual({ error: 'spotify_busy', retryAfter: 7 });
    r = await call('/api/spotify/state');
    expect(r.status).toBe(429);
    expect((await r.json()).retryAfter).toBe(60);
  });

  it('logs no tokens, secret or track names', async () => {
    const { post, call } = await ready({ 'GET /me/player?additional_types=episode': PLAYER, 'GET /me/player/devices': { devices: [TV, ECHO] } });
    await call('/api/spotify/state');
    await post('transfer', { device_id: 'dev-echo' });
    await post('volume', { volume: 30 });
    const all = logs.join('\n');
    expect(all).toContain('spotify_action');
    expect(all).not.toMatch(/sp-at|sp-rt|ffffffff|Song|Stephen's Office|dev-echo/);
  });
});

describe('spotify admin', () => {
  beforeEach(() => resetJwksCache());

  async function admin(env) {
    const { sign, fetchImpl: jwks } = await accessKeys();
    const now = Math.floor(Date.now() / 1000);
    const jwt = await sign({ aud: ['test-aud'], iss: env.ACCESS_TEAM_DOMAIN, email: 'admin@example.com', exp: now + 600, iat: now });
    const net = fakeSpotify();
    const fetchImpl = async (u, init) => (String(u).endsWith('/cdn-cgi/access/certs') ? jwks(u, init) : net.fetchImpl(u, init));
    return (path, method = 'GET') => route(req(path, { method, headers: { 'cf-access-jwt-assertion': jwt } }), env, { fetchImpl });
  }

  it('is behind Access', async () => {
    const env = spEnv();
    await setup(env);
    expect((await route(req('/admin/spotify/start'), env)).status).toBe(403);
    expect((await route(req('/admin/spotify/callback?state=x&code=y'), env)).status).toBe(403);
    expect((await route(req('/admin/api/spotify/disconnect', { method: 'POST' }), env)).status).toBe(403);
  });

  it('connects through start + callback, shows reconnect-by, and disconnects', async () => {
    const env = spEnv();
    await setup(env);
    const go = await admin(env);
    const start = await go('/admin/spotify/start');
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get('location'));
    expect(to.host).toBe('accounts.spotify.com');
    const back = await go('/admin/spotify/callback?state=' + to.searchParams.get('state') + '&code=c1');
    expect(back.headers.get('location')).toBe('/admin/?spotify=ok');
    const s = await (await go('/admin/api/spotify')).json();
    expect(s.status).toBe('ok');
    expect(Date.parse(s.reconnectBy) - Date.parse(s.connectedAt)).toBe(182 * DAY);
    expect((await go('/admin/api/spotify/disconnect', 'POST')).status).toBe(200);
    expect((await (await go('/admin/api/spotify')).json()).status).toBe('disconnected');
  });

  it('start without the client secret explains instead of failing', async () => {
    const env = testEnv();
    await setup(env);
    const go = await admin(env);
    const r = await go('/admin/spotify/start');
    expect(r.headers.get('location')).toBe('/admin/?spotify=spotify_client_missing');
  });
});
