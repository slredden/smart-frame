// Per-device bearer tokens (PLAN.md §7.1). Only SHA-256 hashes are stored.
import { randomToken, sha256Hex, safeEqual } from '../crypto.js';
import { bearer } from '../http.js';
import { nowIso } from '../db.js';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

export async function createDevice(db, name) {
  const id = randomToken(6);
  const secret = randomToken(32);
  const clean = String(name || 'frame').replace(/[^\w .-]/g, '').slice(0, 40) || 'frame';
  await db
    .prepare('INSERT INTO devices (id, token_hash, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, await sha256Hex(secret), clean, nowIso())
    .run();
  return { id, token: id + '.' + secret, name: clean };
}

export function parseDeviceToken(raw) {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const id = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return null;
  return { id, secret };
}

// A rough per-isolate limiter (≈120 requests/min per device). Isolates are short-lived; this only
// blunts a runaway client or a leaked token being hammered from one place.
const windows = new Map();
export function rateLimited(id, nowMs = Date.now(), limit = 120) {
  const minute = Math.floor(nowMs / 60000);
  const w = windows.get(id);
  if (!w || w.minute !== minute) {
    windows.set(id, { minute, n: 1 });
    if (windows.size > 1000) windows.clear();
    return false;
  }
  w.n++;
  return w.n > limit;
}

/** Returns the device row for a valid, unrevoked token, else null. */
export async function authDevice(request, db) {
  const parsed = parseDeviceToken(bearer(request));
  if (!parsed) return null;
  const row = await db.prepare('SELECT id, name, token_hash, revoked_at FROM devices WHERE id = ?').bind(parsed.id).first();
  const hash = await sha256Hex(parsed.secret);
  // Compare even when the row is missing so timing doesn't reveal which ids exist.
  const ok = safeEqual(hash, row ? row.token_hash : '0'.repeat(64));
  if (!row || !ok || row.revoked_at) return null;
  return { id: row.id, name: row.name };
}

export async function touchDevice(db, id, build, ms = Date.now()) {
  await db.prepare('UPDATE devices SET last_seen = ? , build = COALESCE(?, build) WHERE id = ?').bind(nowIso(ms), build || null, id).run();
}

export async function recordHeartbeat(db, id, info, ms = Date.now()) {
  const build = typeof info.build === 'string' ? info.build.slice(0, 40) : null;
  const uptime = Number.isFinite(info.uptimeSec) ? Math.max(0, Math.floor(info.uptimeSec)) : null;
  const errors = Array.isArray(info.jsErrors) ? JSON.stringify(info.jsErrors.slice(0, 5).map((e) => String(e).slice(0, 120))) : null;
  const t = nowIso(ms);
  await db
    .prepare('UPDATE devices SET last_heartbeat = ?, last_seen = ?, build = COALESCE(?, build), uptime_sec = ?, js_errors = ? WHERE id = ?')
    .bind(t, t, build, uptime, errors, id)
    .run();
}

export async function listDevices(db) {
  const { results } = await db.prepare('SELECT id, name, created_at, last_seen, last_heartbeat, build, revoked_at FROM devices ORDER BY created_at').all();
  return results.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen, lastHeartbeat: r.last_heartbeat, build: r.build, revokedAt: r.revoked_at }));
}

export async function revokeDevice(db, id) {
  const r = await db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(nowIso(), id).run();
  return r.meta.changes > 0;
}
