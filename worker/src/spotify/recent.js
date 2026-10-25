// P2.1 Recent picker (PLAN-v2.md §11.5, P2.1 row): GET /api/spotify/recent for the Controls sheet.
// Recent = distinct play contexts (playlist, album, artist) from /me/player/recently-played, newest
// first, ≤ 10, filled from his playlists; Playlists = /me/playlists?limit=20 in Spotify's order.
// Cached in Worker memory for 60 s: no KV writes, no D1 rows. Logs carry counts and status codes only,
// never names or listening history.
import { log } from '../http.js';
import { getMeta } from '../db.js';
import { accessToken, spotifyStatus, hasRecentScopes } from './oauth.js';
import { call, fail, CONTEXT_RE } from './api.js';

export const RECENT_MAX = 10;
export const PLAYLISTS_MAX = 20;
export const CACHE_MS = 60000;
// Free plan: 50 subrequests per request. 1 token + 2 lists + ≤ 15 lookups stays well under.
export const MAX_LOOKUPS = 15;
const TYPES = ['playlist', 'album', 'artist'];
const ART_RE = /^https:\/\/i\.scdn\.co\//;

let cache = null; // {key, at, body}
let busyUntil = 0; // 429 back-off (ms), shared by this isolate
export function resetRecentCache() {
  cache = null;
  busyUntil = 0;
}

/** Smallest image at least ~64 px wide (Spotify lists largest first); i.scdn.co only (the frame's img-src). */
export function pickImage(images) {
  const list = (Array.isArray(images) ? images : []).filter((i) => i && typeof i.url === 'string' && ART_RE.test(i.url));
  const sized = list.filter((i) => typeof i.width === 'number' && i.width >= 64).sort((a, b) => a.width - b.width);
  if (sized.length) return sized[0].url;
  const unsized = list.filter((i) => typeof i.width !== 'number');
  return unsized.length ? unsized[unsized.length - 1].url : null;
}

const item = (uri, type, name, images) => ({ uri, type, name: String(name || '').slice(0, 120), image: pickImage(images) });

/**
 * Distinct contexts from recently-played items, newest first. Each is {uri, type, name?, images?}: the
 * album's name and art come with the track; playlists and artists need a lookup.
 */
export function recentContexts(items) {
  const out = [];
  const seen = {};
  for (const it of Array.isArray(items) ? items : []) {
    const t = it && it.track;
    if (!t || t.type !== 'track') continue; // skip episodes and shows
    const ctx = it.context;
    let c = null;
    if (ctx && TYPES.indexOf(ctx.type) >= 0 && typeof ctx.uri === 'string' && CONTEXT_RE.test(ctx.uri)) {
      c = { uri: ctx.uri, type: ctx.type };
      if (ctx.type === 'album' && t.album && t.album.uri === ctx.uri) Object.assign(c, { name: t.album.name, images: t.album.images });
    } else if (t.album && typeof t.album.uri === 'string' && CONTEXT_RE.test(t.album.uri) && t.album.uri.indexOf('spotify:album:') === 0) {
      // No context (or liked songs, a radio...): the track's album stands in.
      c = { uri: t.album.uri, type: 'album', name: t.album.name, images: t.album.images };
    }
    if (!c || seen[c.uri]) continue;
    seen[c.uri] = true;
    out.push(c);
  }
  return out;
}

const LOOKUP = { playlist: (id) => '/playlists/' + id + '?fields=name,images', album: (id) => '/albums/' + id, artist: (id) => '/artists/' + id };

async function build(token, fetchImpl) {
  const rp = await call(token, 'GET', '/me/player/recently-played?limit=50', undefined, fetchImpl);
  if (!rp.ok) return rp;
  const pl = await call(token, 'GET', '/me/playlists?limit=' + PLAYLISTS_MAX, undefined, fetchImpl);
  if (!pl.ok) return pl;
  const playlists = ((pl.data && pl.data.items) || [])
    .filter((p) => p && typeof p.uri === 'string' && /^spotify:playlist:[A-Za-z0-9]{22}$/.test(p.uri))
    .slice(0, PLAYLISTS_MAX)
    .map((p) => item(p.uri, 'playlist', p.name, p.images));

  const recent = [];
  let lookups = 0;
  let skipped = 0;
  for (const c of recentContexts(rp.data && rp.data.items)) {
    if (recent.length >= RECENT_MAX) break;
    if (c.name) {
      recent.push(item(c.uri, c.type, c.name, c.images));
      continue;
    }
    // A playlist he has saved needs no lookup.
    const known = playlists.find((p) => p.uri === c.uri);
    if (known) {
      recent.push(known);
      continue;
    }
    if (lookups >= MAX_LOOKUPS) continue;
    lookups++;
    const r = await call(token, 'GET', LOOKUP[c.type](c.uri.split(':')[2]), undefined, fetchImpl);
    if (!r.ok) {
      // Spotify-owned playlists (Daily Mix, Discover Weekly) are 404/403 for dev-mode apps: skip them.
      if (r.spStatus === 404 || r.spStatus === 403) {
        skipped++;
        continue;
      }
      return r;
    }
    if (!r.data || !r.data.name) {
      skipped++;
      continue;
    }
    recent.push(item(c.uri, c.type, r.data.name, r.data.images));
  }
  // Short list: fill from his playlists, skipping repeats.
  let filled = 0;
  for (const p of playlists) {
    if (recent.length >= RECENT_MAX) break;
    if (recent.some((x) => x.uri === p.uri)) continue;
    recent.push(p);
    filled++;
  }
  return { ok: true, body: { connected: true, recent, playlists }, stats: { recent: recent.length, playlists: playlists.length, lookups, skipped, filled } };
}

/** GET /api/spotify/recent. */
export async function spotifyRecent(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const token = await accessToken(env, { fetchImpl, nowMs });
  if (!token) {
    const s = await spotifyStatus(env, nowMs);
    return { ok: true, body: { connected: false, reason: !s.configured ? 'not_configured' : s.status } };
  }
  if (!(await hasRecentScopes(db))) return fail(409, 'needs_consent');
  if (nowMs < busyUntil) return fail(429, 'spotify_busy', { retryAfter: Math.max(1, Math.ceil((busyUntil - nowMs) / 1000)) });
  // A reconnect (new connected_at) starts a fresh cache.
  const key = (await getMeta(db, 'spotify_connected_at')) || '';
  if (cache && cache.key === key && nowMs - cache.at < CACHE_MS) return { ok: true, body: cache.body };
  const r = await build(token, fetchImpl);
  if (!r.ok) {
    if (r.status === 429) busyUntil = nowMs + r.retryAfter * 1000;
    log('spotify_recent', { status: r.status, error: r.error, spStatus: r.spStatus, reason: r.reason || undefined });
    return r;
  }
  cache = { key, at: nowMs, body: r.body };
  log('spotify_recent', Object.assign({ status: 200 }, r.stats));
  return { ok: true, body: r.body };
}
