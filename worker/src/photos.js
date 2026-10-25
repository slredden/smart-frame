// Photo set manifest, signed photo URLs, and serving bytes from KV (PLAN.md §6, §7.1).
import { hmac, safeEqual } from './crypto.js';
import { empty } from './http.js';

const SET_RE = /^[A-Za-z0-9_-]{4,40}$/;

export const photoKey = (setId, n) => 'p:' + setId + ':' + n;

/** Expiry rounded to the hour so URLs stay identical (and browser-cacheable) for about an hour. */
export function signedExpiry(nowMs) {
  return Math.ceil(nowMs / 3600000) * 3600 + 3600;
}

export async function signPhotoPath(env, setId, n, deviceId, nowMs = Date.now()) {
  const path = '/p/' + setId + '/' + n + '.jpg';
  const exp = signedExpiry(nowMs);
  const sig = await hmac(env.URL_SIGNING_KEY, path + '|' + exp + '|' + deviceId);
  return path + '?d=' + encodeURIComponent(deviceId) + '&exp=' + exp + '&sig=' + sig;
}

export async function verifyPhotoUrl(env, url, nowMs = Date.now()) {
  if (!env.URL_SIGNING_KEY) return null;
  const m = /^\/p\/([A-Za-z0-9_-]{4,40})\/(\d{1,4})\.jpg$/.exec(url.pathname);
  if (!m) return null;
  const exp = Number(url.searchParams.get('exp'));
  const d = url.searchParams.get('d') || '';
  const sig = url.searchParams.get('sig') || '';
  if (!Number.isFinite(exp) || exp * 1000 < nowMs || exp * 1000 > nowMs + 3 * 3600000) return null;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(d)) return null;
  const want = await hmac(env.URL_SIGNING_KEY, url.pathname + '|' + exp + '|' + d);
  if (!safeEqual(sig, want)) return null;
  return { setId: m[1], n: Number(m[2]), deviceId: d };
}

export async function activeSet(db) {
  return db.prepare("SELECT set_id, created_at, count FROM photo_sets WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").first();
}

/** Manifest for /api/state with freshly signed URLs. */
export async function photoManifest(env, deviceId, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const set = await activeSet(db);
  if (!set) return { setId: null, items: [] };
  // P1b: hidden photos leave the manifest; favorites carry fav: true (PLAN-v2.md §6).
  const { results } = await db.prepare('SELECT n, orient, taken, blur, favorite FROM photos WHERE set_id = ? AND hidden = 0 ORDER BY n').bind(set.set_id).all();
  const items = [];
  for (const r of results) {
    const it = { id: String(r.n), url: await signPhotoPath(env, set.set_id, r.n, deviceId, nowMs), blur: r.blur || '', orient: r.orient || 'l', taken: r.taken || '' };
    if (r.favorite) it.fav = true;
    items.push(it);
  }
  return { setId: set.set_id, items, expiresAt: new Date(signedExpiry(nowMs) * 1000).toISOString() };
}

/**
 * PUT /api/photos/:set/:n from the frame: {favorite: bool} and/or {hidden: bool}. Only photos in the
 * active set. Returns {ok} or {ok:false, status, error}.
 */
export async function setPhotoFlags(db, setId, n, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, status: 400, error: 'bad_value' };
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((k) => (k !== 'favorite' && k !== 'hidden') || typeof patch[k] !== 'boolean')) return { ok: false, status: 400, error: 'bad_value' };
  const set = await activeSet(db);
  if (!set || set.set_id !== setId) return { ok: false, status: 409, error: 'set_changed' };
  const sets = keys.map((k) => k + ' = ?').join(', ');
  const r = await db.prepare('UPDATE photos SET ' + sets + ' WHERE set_id = ? AND n = ?').bind(...keys.map((k) => (patch[k] ? 1 : 0)), setId, n).run();
  if (!r.meta || !r.meta.changes) return { ok: false, status: 404, error: 'unknown_photo' };
  return { ok: true };
}

/** /admin: how many photos in the active set are hidden. */
export async function hiddenCount(db) {
  const set = await activeSet(db);
  if (!set) return 0;
  const r = await db.prepare('SELECT COUNT(*) AS n FROM photos WHERE set_id = ? AND hidden = 1').bind(set.set_id).first();
  return r ? r.n : 0;
}

/** /admin "Unhide all". */
export async function unhideAll(db) {
  const set = await activeSet(db);
  if (!set) return 0;
  const r = await db.prepare('UPDATE photos SET hidden = 0 WHERE set_id = ? AND hidden = 1').bind(set.set_id).run();
  return (r.meta && r.meta.changes) || 0;
}

/** GET /p/<set>/<n>.jpg */
export async function servePhoto(env, url, nowMs = Date.now()) {
  const ok = await verifyPhotoUrl(env, url, nowMs);
  if (!ok || !SET_RE.test(ok.setId)) return empty(403);
  const dev = await env.FRAME_DB.prepare('SELECT revoked_at FROM devices WHERE id = ?').bind(ok.deviceId).first();
  if (!dev || dev.revoked_at) return empty(403);
  const obj = await env.FRAME_PHOTOS.getWithMetadata(photoKey(ok.setId, ok.n), { type: 'stream' });
  if (!obj || !obj.value) return empty(404);
  const type = (obj.metadata && obj.metadata.type) || 'image/jpeg';
  return new Response(obj.value, {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
  });
}
