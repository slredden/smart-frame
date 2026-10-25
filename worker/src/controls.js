// P2 Ring cameras on the Controls screen (PLAN-v2.md §11.3, §11.6, §11.7). The `controls_cams` table
// is the allowlist: the Worker only ever asks HA about the cameras on it, and only with GET.
import { haConfigured, haMissing, haGet, noteReachable } from './ha.js';
import { getSettings } from './settings.js';
import { log } from './http.js';

export const MAX_CAMS = 4;
const ENTITY_RE = /^camera\.[a-z0-9_]{1,80}$/;
const LABEL_MAX = 40;

/** The allowlist in display order: outdoor cameras first, then by position. */
export async function listCams(db) {
  const { results } = await db.prepare('SELECT id, entity_id, label, indoor, position FROM controls_cams ORDER BY indoor, position').all();
  return results.map((r) => ({ id: r.id, entityId: r.entity_id, label: r.label, indoor: !!r.indoor }));
}

/** Replaces the allowlist (from /admin). `cams` = [{entityId, label, indoor}], at most 4. */
export async function saveCams(db, cams) {
  if (!Array.isArray(cams) || cams.length > MAX_CAMS) return { ok: false, error: 'too_many_cams' };
  const seen = {};
  const rows = [];
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i] || {};
    const entityId = typeof c.entityId === 'string' ? c.entityId.trim() : '';
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    if (!ENTITY_RE.test(entityId)) return { ok: false, error: 'bad_entity' };
    if (!label || label.length > LABEL_MAX) return { ok: false, error: 'bad_label' };
    if (typeof c.indoor !== 'boolean') return { ok: false, error: 'bad_indoor' };
    if (seen[entityId]) return { ok: false, error: 'duplicate_entity' };
    seen[entityId] = true;
    rows.push({ id: 'c' + (i + 1), entityId, label, indoor: c.indoor ? 1 : 0, position: i });
  }
  const stmts = [db.prepare('DELETE FROM controls_cams')];
  for (const r of rows) {
    stmts.push(db.prepare('INSERT INTO controls_cams (id, entity_id, label, indoor, position) VALUES (?, ?, ?, ?, ?)').bind(r.id, r.entityId, r.label, r.indoor, r.position));
  }
  await db.batch(stmts);
  log('controls_cams_saved', { count: rows.length });
  return { ok: true, cams: await listCams(db) };
}

/**
 * When the camera's picture last changed. ring-mqtt's snapshot camera carries `timestamp` (Unix
 * seconds) in its attributes; HA's own Ring integration doesn't, so fall back to last_updated.
 */
export function updatedAt(stateObj) {
  const a = (stateObj && stateObj.attributes) || {};
  const t = Number(a.timestamp);
  if (isFinite(t) && t > 1e9 && t < 1e11) return new Date(t * 1000).toISOString();
  const lu = stateObj && Date.parse(stateObj.last_updated);
  return isFinite(lu) ? new Date(lu).toISOString() : null;
}

/** GET /api/controls/state. 200 {connected, indoorOn, revealSec, cams}, or 503 when HA is down. */
export async function controlsState(env) {
  const settings = (await getSettings(env)).controls;
  const base = { indoorOn: settings.indoor, revealSec: settings.revealSec };
  if (!haConfigured(env)) return { status: 200, body: Object.assign({ connected: false, reason: 'not_connected', cams: [] }, base) };
  const cams = await listCams(env.FRAME_DB);
  // Indoor cameras stay unasked while the setting is off.
  const asked = cams.filter((c) => !c.indoor || settings.indoor);
  const replies = await Promise.all(asked.map((c) => haGet(env, '/api/states/' + c.entityId, c.id)));
  const reached = replies.some((r) => r.status !== 0);
  if (asked.length) await noteReachable(env.FRAME_DB, reached);
  if (asked.length && !reached) return { status: 503, body: { error: 'ha_unreachable' } };
  const out = [];
  for (const c of cams) {
    const tile = { id: c.id, label: c.label, indoor: c.indoor };
    const i = asked.indexOf(c);
    if (i < 0) tile.off = true;
    else {
      const r = replies[i];
      let st = null;
      if (r.ok) {
        try {
          st = await r.res.json();
        } catch {
          st = null;
        }
      }
      tile.updated = st ? updatedAt(st) : null;
      tile.available = !!st && st.state !== 'unavailable';
    }
    out.push(tile);
  }
  return { status: 200, body: Object.assign({ connected: true, cams: out }, base) };
}

const IMG_HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

/**
 * GET /api/controls/cam/:id. Streams HA's camera_proxy image straight through: nothing is stored or
 * cached anywhere. Indoor cameras need the setting on and `?reveal=1` (sent only after a tap).
 * Returns a Response, or {status, error} for the router to turn into JSON.
 */
export async function camImage(env, id, reveal) {
  if (!/^c[1-4]$/.test(id)) return { status: 404, error: 'unknown_camera' };
  const cam = await env.FRAME_DB.prepare('SELECT id, entity_id, indoor FROM controls_cams WHERE id = ?').bind(id).first();
  if (!cam) return { status: 404, error: 'unknown_camera' };
  if (cam.indoor) {
    const s = (await getSettings(env)).controls;
    if (!s.indoor) return { status: 403, error: 'indoor_off' };
    if (!reveal) return { status: 403, error: 'reveal_required' };
  }
  if (!haConfigured(env)) return { status: 409, error: 'not_connected' };
  const r = await haGet(env, '/api/camera_proxy/' + cam.entity_id, cam.id);
  if (r.status === 0) return { status: 503, error: 'ha_unreachable' };
  if (!r.ok) {
    if (r.res && r.res.body) r.res.body.cancel();
    return { status: 502, error: r.error };
  }
  const type = r.res.headers.get('content-type') || '';
  if (!/^image\/(jpeg|png|webp|gif)\b/.test(type)) {
    if (r.res.body) r.res.body.cancel();
    log('ha_error', { tag: cam.id, status: 'not_image' });
    return { status: 502, error: 'ha_error' };
  }
  log('controls_cam', { cam: cam.id, status: 200 });
  return new Response(r.res.body, { status: 200, headers: Object.assign({ 'Content-Type': type }, IMG_HEADERS) });
}

/** /admin › Controls status: binding, token, HA version, and the allowlist. */
export async function adminControls(env) {
  const missing = haMissing(env);
  const out = { connected: !missing, missing, ha: null, cams: await listCams(env.FRAME_DB) };
  if (!missing) {
    const r = await haGet(env, '/api/config', 'config');
    if (r.ok) {
      let cfg;
      try {
        cfg = await r.res.json();
      } catch {
        cfg = {};
      }
      out.ha = { ok: true, version: typeof cfg.version === 'string' ? cfg.version.slice(0, 20) : null };
    } else out.ha = { ok: false, error: r.error, status: r.status };
    await noteReachable(env.FRAME_DB, r.status !== 0);
  }
  return out;
}

/** /admin › Controls › "List cameras": HA's camera.* entities with their friendly names. */
export async function haCameras(env) {
  if (!haConfigured(env)) return { status: 409, body: { error: 'not_connected' } };
  const r = await haGet(env, '/api/states', 'states');
  if (!r.ok) return { status: r.status === 0 ? 503 : 502, body: { error: r.error } };
  let all;
  try {
    all = await r.res.json();
  } catch {
    return { status: 502, body: { error: 'ha_error' } };
  }
  const cams = (Array.isArray(all) ? all : [])
    .filter((s) => s && typeof s.entity_id === 'string' && ENTITY_RE.test(s.entity_id))
    .map((s) => ({ entityId: s.entity_id, name: String((s.attributes && s.attributes.friendly_name) || s.entity_id).slice(0, 80), updated: updatedAt(s) }))
    .slice(0, 100);
  return { status: 200, body: { cameras: cams } };
}
