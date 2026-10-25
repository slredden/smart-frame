// Home Assistant through the Workers VPC binding `HA` (PLAN-v2.md §11.3). GET only: this module has no
// way to send any other method, and the Worker never calls an HA service. Until the VPC Service and
// the binding exist (or HA_TOKEN isn't set) everything reports "not connected" and nothing throws.
import { log } from './http.js';
import { getMeta, setMeta } from './db.js';

// The VPC Service decides the real host and port; this only fills the Host header.
const BASE = 'http://127.0.0.1:8123';
const OK_KEY = 'ha_ok';
const TIMEOUT_MS = 8000;

/** True when the `HA` binding and HA_TOKEN are both there. */
export function haConfigured(env) {
  return !!(env.HA && typeof env.HA.fetch === 'function' && typeof env.HA_TOKEN === 'string' && env.HA_TOKEN);
}

/** Why HA isn't usable, for /admin: null when it is. */
export function haMissing(env) {
  if (!env.HA || typeof env.HA.fetch !== 'function') return 'no_binding';
  if (!env.HA_TOKEN) return 'no_token';
  return null;
}

/**
 * GET `path` from HA. Resolves {ok, status, res} and never throws: status 0 means HA (or the tunnel)
 * couldn't be reached. `tag` is what gets logged (a short camera id, never an entity id or token).
 */
export async function haGet(env, path, tag = '') {
  if (!haConfigured(env)) return { ok: false, status: 0, error: 'not_connected' };
  if (typeof path !== 'string' || path.charAt(0) !== '/' || path.indexOf('/api/') !== 0) throw new Error('bad_ha_path');
  let res;
  try {
    res = await env.HA.fetch(BASE + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + env.HA_TOKEN },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    log('ha_unreachable', { tag });
    return { ok: false, status: 0, error: 'ha_unreachable' };
  }
  if (!res.ok) {
    log('ha_error', { tag, status: res.status });
    return { ok: false, status: res.status, error: res.status === 401 || res.status === 403 ? 'ha_unauthorized' : 'ha_error', res };
  }
  return { ok: true, status: res.status, res };
}

/** Remembers whether the last HA state call reached HA, writing D1 only when that changes. */
export async function noteReachable(db, reachable) {
  const v = reachable ? '1' : '0';
  if ((await getMeta(db, OK_KEY)) !== v) await setMeta(db, OK_KEY, v);
}

export async function lastReachable(db) {
  const v = await getMeta(db, OK_KEY);
  return v === null ? null : v === '1';
}
