// Spotify Web API calls for the Controls screen (PLAN-v2.md §11.5). Each frame action maps to exactly one
// player call (Play with no active device adds one device-list read). Nothing free-form passes through.
import { getMeta, setMeta } from '../db.js';
import { log } from '../http.js';
import { accessToken, spotifyStatus } from './oauth.js';

export const API = 'https://api.spotify.com/v1';
export const ACTIONS = ['play', 'pause', 'next', 'prev', 'volume', 'transfer'];
// Q18: at the office it's mostly this Echo Dot. Replaced by the last device picked on the frame.
export const DEFAULT_DEVICE = "Stephen's Office";
const DEVICES_KEY = 'spotify_devices';
const LAST_KEY = 'spotify_last_device';

const fail = (status, error, extra = {}) => Object.assign({ ok: false, status, error }, extra);
export { fail };

/** Maps a non-2xx Spotify reply to the frame's error. */
async function failure(res) {
  let reason = '';
  try {
    const b = await res.json();
    // Spotify's reason is a short enum (PREMIUM_REQUIRED, NO_ACTIVE_DEVICE...); safe to log, never shown.
    if (b && b.error && typeof b.error.reason === 'string') reason = b.error.reason.slice(0, 40);
  } catch {
    // no body
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get('retry-after'));
    const retryAfter = Number.isFinite(ra) && ra > 0 ? Math.min(3600, Math.ceil(ra)) : reason === 'QUOTA_EXCEEDED' ? 60 : 30;
    return fail(429, 'spotify_busy', { retryAfter, spStatus: 429, reason });
  }
  const extra = { spStatus: res.status, reason };
  if (res.status === 403) return fail(403, 'premium_needed', extra);
  if (res.status === 404) return fail(409, 'no_active_device', extra);
  if (res.status === 401) return fail(502, 'spotify_unauthorized', extra);
  return fail(502, 'spotify_error', extra);
}

export async function call(token, method, path, body, fetchImpl) {
  const init = { method, headers: { Authorization: 'Bearer ' + token } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (method !== 'GET') {
    init.headers['Content-Length'] = '0';
  }
  let res;
  try {
    res = await fetchImpl(API + path, init);
  } catch {
    return fail(502, 'spotify_unreachable');
  }
  if (res.status === 204) return { ok: true, data: null };
  if (!res.ok) return failure(res);
  if (method !== 'GET') return { ok: true, data: null };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: true, data: null };
  }
}

async function storedDevices(db) {
  try {
    const v = JSON.parse((await getMeta(db, DEVICES_KEY)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** GET /me/player/devices, saved (only when changed) as the list `transfer` may pick from. */
async function fetchDevices(env, token, fetchImpl) {
  const r = await call(token, 'GET', '/me/player/devices', undefined, fetchImpl);
  if (!r.ok) return r;
  const list = ((r.data && r.data.devices) || [])
    .filter((d) => d && typeof d.id === 'string' && d.id && typeof d.name === 'string')
    .slice(0, 20)
    .map((d) => ({ id: d.id.slice(0, 80), name: d.name.slice(0, 80), type: String(d.type || '').slice(0, 20), active: !!d.is_active, volume: typeof d.volume_percent === 'number' ? d.volume_percent : null }));
  const slim = JSON.stringify(list.map((d) => ({ id: d.id, name: d.name, type: d.type })));
  if (slim !== ((await getMeta(env.FRAME_DB, DEVICES_KEY)) || '[]')) await setMeta(env.FRAME_DB, DEVICES_KEY, slim);
  return { ok: true, devices: list };
}

const sameName = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export async function lastDevice(db) {
  return (await getMeta(db, LAST_KEY)) || DEFAULT_DEVICE;
}

function nowPlaying(p) {
  const it = p && p.item;
  if (!it) return null;
  const images = (it.album && it.album.images) || it.images || [];
  // Spotify lists images largest first; pick the smallest that's still ≥ 300 px for a ~240 px tile.
  const fit = images.filter((i) => i && i.width >= 300);
  const img = fit.length ? fit[fit.length - 1] : images[0];
  const artists = it.artists ? it.artists.map((a) => a.name).join(', ') : it.show ? it.show.name : '';
  return { title: String(it.name || '').slice(0, 200), artists: String(artists).slice(0, 200), art: img && /^https:\/\/i\.scdn\.co\//.test(img.url) ? img.url : null };
}

/**
 * GET /api/spotify/state. `devices` asks for a fresh device list (first poll, "Play on…" opened);
 * otherwise the last saved list is returned with the active one marked.
 */
export async function spotifyState(env, { fetchImpl = fetch, nowMs = Date.now(), devices = false } = {}) {
  const db = env.FRAME_DB;
  const token = await accessToken(env, { fetchImpl, nowMs });
  if (!token) {
    const s = await spotifyStatus(env, nowMs);
    return { ok: true, body: { connected: false, reason: !s.configured ? 'not_configured' : s.status } };
  }
  const p = await call(token, 'GET', '/me/player?additional_types=episode', undefined, fetchImpl);
  if (!p.ok) return p;
  const player = p.data;
  let list;
  const saved = await storedDevices(db);
  if (devices || !saved.length) {
    const d = await fetchDevices(env, token, fetchImpl);
    if (!d.ok) return d;
    list = d.devices;
  } else list = saved;
  const dev = player && player.device;
  const last = await lastDevice(db);
  return {
    ok: true,
    body: {
      connected: true,
      playing: !!(player && player.is_playing),
      item: nowPlaying(player),
      device: dev ? { id: dev.id || null, name: String(dev.name || '').slice(0, 80), type: String(dev.type || '').slice(0, 20), volume: typeof dev.volume_percent === 'number' ? dev.volume_percent : null } : null,
      devices: list.map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!(dev && dev.id === d.id), remembered: sameName(d.name, last) })),
      lastDevice: last,
    },
  };
}

/** P2.1: a playlist, album or artist from the Recent sheet. Spotify ids are 22 base-62 characters. */
export const CONTEXT_RE = /^spotify:(playlist|album|artist):[A-Za-z0-9]{22}$/;

/** The /me/player/play body for a context: from the beginning (playlists and albums), shuffle untouched. */
export function contextBody(uri) {
  const type = CONTEXT_RE.exec(uri)[1];
  return type === 'artist' ? { context_uri: uri } : { context_uri: uri, offset: { position: 0 }, position_ms: 0 };
}

/**
 * Play with no active device: the remembered device by name (ignoring case), or 409 device_absent.
 * With a context (P2.1) it plays that context on the device; without one it transfers and resumes.
 */
async function playOnRemembered(env, token, fetchImpl, playBody) {
  const d = await fetchDevices(env, token, fetchImpl);
  if (!d.ok) return d;
  const name = await lastDevice(env.FRAME_DB);
  const hit = d.devices.find((x) => sameName(x.name, name));
  if (!hit) return fail(409, 'device_absent', { name, devices: d.devices.map((x) => ({ id: x.id, name: x.name, type: x.type })) });
  const r = playBody
    ? await call(token, 'PUT', '/me/player/play?device_id=' + encodeURIComponent(hit.id), playBody, fetchImpl)
    : await call(token, 'PUT', '/me/player', { device_ids: [hit.id], play: true }, fetchImpl);
  return r.ok ? { ok: true, body: { ok: true, device: hit.name } } : r;
}

/** POST /api/spotify/:action. */
export async function spotifyAction(env, action, body, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  if (ACTIONS.indexOf(action) < 0) return fail(404, 'not_found');
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  let volume = null;
  let target = null;
  let playBody;
  if (action === 'play' && b.context_uri !== undefined) {
    if (typeof b.context_uri !== 'string' || !CONTEXT_RE.test(b.context_uri)) return fail(400, 'bad_context');
    playBody = contextBody(b.context_uri);
  }
  if (action === 'volume') {
    volume = b.volume;
    if (typeof volume !== 'number' || !Number.isInteger(volume) || volume < 0 || volume > 100) return fail(400, 'bad_volume');
  }
  if (action === 'transfer') {
    if (typeof b.device_id !== 'string') return fail(400, 'unknown_device');
    target = (await storedDevices(env.FRAME_DB)).find((d) => d.id === b.device_id);
    if (!target) return fail(400, 'unknown_device');
  }
  const token = await accessToken(env, { fetchImpl, nowMs });
  if (!token) return fail(409, 'not_connected');
  let r;
  if (action === 'play') {
    r = await call(token, 'PUT', '/me/player/play', playBody, fetchImpl);
    if (!r.ok && r.error === 'no_active_device') r = await playOnRemembered(env, token, fetchImpl, playBody);
  } else if (action === 'pause') r = await call(token, 'PUT', '/me/player/pause', undefined, fetchImpl);
  else if (action === 'next') r = await call(token, 'POST', '/me/player/next', undefined, fetchImpl);
  else if (action === 'prev') r = await call(token, 'POST', '/me/player/previous', undefined, fetchImpl);
  else if (action === 'volume') r = await call(token, 'PUT', '/me/player/volume?volume_percent=' + volume, undefined, fetchImpl);
  else {
    r = await call(token, 'PUT', '/me/player', { device_ids: [target.id] }, fetchImpl);
    if (r.ok && (await getMeta(env.FRAME_DB, LAST_KEY)) !== target.name) await setMeta(env.FRAME_DB, LAST_KEY, target.name);
  }
  log('spotify_action', { action, context: playBody ? true : undefined, status: r.ok ? 200 : r.status, error: r.ok ? undefined : r.error });
  return r.ok ? { ok: true, body: r.body || { ok: true } } : r;
}
