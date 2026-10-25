// P1c photo-set cleanup (PLAN-v2.md §13.1, docs/runbook-photos.md). Keeps the active set and the
// 'previous' one; every older set, and any failed or stuck 'building' set, is purged by the cron:
// KV keys first (oldest set first, under a daily delete budget), then the D1 rows, then 'purged'.
// Set statuses: building → active → previous → retired (queued) → purging → purged.
import { nowIso } from './db.js';
import { photoKey } from './photos.js';
import { log } from './http.js';

export const KV_DELETE_BUDGET = 900; // of the free 1,000 KV deletes a UTC day
export const PURGE_BATCH = 50; // KV deletes per cron run (KV allows 1,000 operations per invocation)
export const MAX_STEPS = 3; // sets touched per cron run
export const STUCK_MS = 24 * 3600000; // a 'building' set whose job is this quiet is abandoned
// Bytes per photo when no size was recorded (sets copied before P1c): a 1280×800 JPEG is ~200–300 KB.
export const APPROX_PHOTO_BYTES = 250 * 1024;

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function kvDeletesToday(db, nowMs = Date.now()) {
  const r = await db.prepare('SELECT count FROM kv_deletes WHERE day = ?').bind(utcDay(nowMs)).first();
  return r ? r.count : 0;
}

// A 'building' set may be purged when its job failed, or it is older than STUCK_MS and its job hasn't
// moved for STUCK_MS (an ingest paused on the KV write budget keeps moving daily, so it is kept).
// Used inside SQL so the check and the status change happen in one statement.
const STUCK_SQL = `(s.status = 'building'
  AND NOT EXISTS (SELECT 1 FROM picker_jobs j WHERE j.set_id = s.set_id AND j.status IN ('picking', 'ingesting') AND j.updated_at >= ?1)
  AND (s.created_at < ?1 OR EXISTS (SELECT 1 FROM picker_jobs j WHERE j.set_id = s.set_id AND j.status = 'failed')))`;

/** Sets waiting for cleanup, oldest first. Never 'active', 'previous' or a live 'building' set. */
export async function cleanupQueue(db, nowMs = Date.now()) {
  const cutoff = nowIso(nowMs - STUCK_MS);
  const r = await db
    .prepare(`SELECT s.set_id, s.status, s.created_at FROM photo_sets s WHERE s.status IN ('retired', 'purging') OR ${STUCK_SQL} ORDER BY s.created_at, s.set_id`)
    .bind(cutoff)
    .all();
  return r.results || [];
}

/**
 * The set's status and cursor, re-read right before any KV delete, plus the highest KV index it may
 * have written. A set that was still building can hold one key past its last D1 row.
 */
async function purgeState(db, setId) {
  const r = await db
    .prepare(
      "SELECT s.status, s.purge_next, s.count AS c, (SELECT MAX(n) FROM photos WHERE set_id = s.set_id) AS m, (SELECT MAX(count) FROM picker_jobs WHERE set_id = s.set_id) AS j, (SELECT COUNT(*) FROM picker_jobs WHERE set_id = s.set_id AND status <> 'done') AS open FROM photo_sets s WHERE s.set_id = ?",
    )
    .bind(setId)
    .first();
  if (!r) return null;
  const top = Math.max(r.c || 0, r.m || 0, r.j || 0);
  return { status: r.status, from: r.purge_next || 1, upper: r.open ? top + 1 : top };
}

/**
 * One cron pass. Every step is idempotent: KV deletes of missing keys are no-ops, the budget is
 * reserved before deleting (an interrupted run can only under-spend), and the cursor (purge_next)
 * moves only after the batch. Returns what it did, for logs and tests.
 */
export async function runCleanup(env, { nowMs = Date.now(), batch = PURGE_BATCH, hooks = {} } = {}) {
  const db = env.FRAME_DB;
  const out = { deleted: 0, purged: [], stopped: null };
  let left = KV_DELETE_BUDGET - (await kvDeletesToday(db, nowMs));
  let runLeft = batch;
  // At most MAX_STEPS sets per run: each step is ~6 D1 queries and the free plan allows 50 per invocation.
  for (let step = 0; runLeft > 0 && step < MAX_STEPS; step++) {
    const queue = await cleanupQueue(db, nowMs);
    if (!queue.length) {
      out.stopped = 'empty';
      break;
    }
    const target = queue[0];
    if (target.status !== 'purging') {
      // Claim it with a guarded update: only a still-queued set moves to 'purging'.
      const cutoff = nowIso(nowMs - STUCK_MS);
      const claim = await db
        .prepare(`UPDATE photo_sets AS s SET status = 'purging', purge_next = COALESCE(purge_next, 1) WHERE s.set_id = ?2 AND (s.status = 'retired' OR ${STUCK_SQL})`)
        .bind(cutoff, target.set_id)
        .run();
      if (!claim.meta || !claim.meta.changes) continue; // changed under us; look again
      if (target.status === 'building') {
        await db.prepare("UPDATE picker_jobs SET status = 'failed', error = 'purged', updated_at = ? WHERE set_id = ? AND status IN ('picking', 'ingesting')").bind(nowIso(nowMs), target.set_id).run();
      }
    }
    // Re-check right before touching KV: the set must still be 'purging' (never active/previous/building).
    const st = await purgeState(db, target.set_id);
    if (!st || st.status !== 'purging') continue;
    const { from, upper } = st;
    if (from <= upper) {
      if (left <= 0) {
        out.stopped = 'budget';
        break;
      }
      const to = Math.min(upper, from + Math.min(runLeft, left) - 1);
      const n = to - from + 1;
      await db
        .prepare('INSERT INTO kv_deletes (day, count) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET count = count + excluded.count')
        .bind(utcDay(nowMs), n)
        .run();
      left -= n;
      runLeft -= n;
      if (hooks.beforeDelete) await hooks.beforeDelete(target.set_id, from, to);
      const keys = [];
      for (let i = from; i <= to; i++) keys.push(photoKey(target.set_id, i));
      await Promise.all(keys.map((k) => env.FRAME_PHOTOS.delete(k)));
      out.deleted += n;
      await db.prepare("UPDATE photo_sets SET purge_next = ? WHERE set_id = ? AND status = 'purging'").bind(to + 1, target.set_id).run();
      if (to < upper) continue;
    }
    // Every KV key is gone: now the D1 rows, then mark the set purged (one batch).
    await db.batch([
      db.prepare("DELETE FROM photos WHERE set_id = ? AND EXISTS (SELECT 1 FROM photo_sets WHERE set_id = ? AND status = 'purging')").bind(target.set_id, target.set_id),
      db.prepare("UPDATE photo_sets SET status = 'purged' WHERE set_id = ? AND status = 'purging'").bind(target.set_id),
    ]);
    out.purged.push(target.set_id);
  }
  if (!out.stopped) out.stopped = left <= 0 ? 'budget' : 'batch';
  if (out.deleted || out.purged.length) log('photo_cleanup', { deleted: out.deleted, purged: out.purged.length, stopped: out.stopped });
  return out;
}

/**
 * /admin › Photos: swap 'active' and 'previous' in one statement. Pressing it again flips back.
 * Does nothing (swapped: false) unless both exist.
 */
export async function restorePrevious(db) {
  const r = await db
    .prepare(
      "UPDATE photo_sets SET status = CASE status WHEN 'active' THEN 'previous' ELSE 'active' END WHERE status IN ('active', 'previous') AND (SELECT COUNT(*) FROM photo_sets WHERE status = 'active') = 1 AND (SELECT COUNT(*) FROM photo_sets WHERE status = 'previous') = 1",
    )
    .run();
  return { swapped: !!(r.meta && r.meta.changes === 2) };
}

/** The admin Photos line and the health block. Sizes are summed where recorded, else estimated. */
export async function photoSummary(db, nowMs = Date.now()) {
  const sets = (
    await db
      .prepare("SELECT s.set_id, s.status, s.created_at, s.count, (SELECT COUNT(size) FROM photos WHERE set_id = s.set_id) AS sized, (SELECT COALESCE(SUM(size), 0) FROM photos WHERE set_id = s.set_id) AS bytes, (SELECT COUNT(*) FROM photos WHERE set_id = s.set_id) AS rows FROM photo_sets s WHERE s.status <> 'purged'")
      .all()
  ).results || [];
  const pick = (st) => {
    const s = sets.find((x) => x.status === st);
    return s ? { setId: s.set_id, count: s.count, rows: s.rows, date: s.created_at } : null;
  };
  const sized = sets.reduce((a, s) => a + s.sized, 0);
  const known = sets.reduce((a, s) => a + s.bytes, 0);
  const avg = sized ? known / sized : APPROX_PHOTO_BYTES;
  const unsized = sets.reduce((a, s) => a + Math.max(0, s.rows - s.sized), 0);
  const queue = await cleanupQueue(db, nowMs);
  const deletedToday = await kvDeletesToday(db, nowMs);
  return {
    current: pick('active'),
    previous: pick('previous'),
    queued: queue.length,
    deletedToday,
    deletesLeft: Math.max(0, KV_DELETE_BUDGET - deletedToday),
    storage: { bytes: Math.round(known + unsized * avg), approx: unsized > 0 },
  };
}
