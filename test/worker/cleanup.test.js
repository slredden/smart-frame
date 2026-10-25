// P1c photo-set cleanup (PLAN-v2.md §13.1): what is kept, the daily delete budget, KV before D1,
// resuming, restore, and the admin and health surfaces.
import { describe, it, expect, beforeEach } from 'vitest';
import { route } from '../../worker/src/index.js';
import { photoKey } from '../../worker/src/photos.js';
import { goLive } from '../../worker/src/google/picker.js';
import { migrate, setMeta } from '../../worker/src/db.js';
import { runCleanup, restorePrevious, photoSummary, cleanupQueue, kvDeletesToday, KV_DELETE_BUDGET } from '../../worker/src/cleanup.js';
import { buildHealth } from '../../worker/src/health.js';
import { handleAdmin } from '../../worker/src/admin.js';
import { testEnv, setup, req, HEALTH, auth } from './helpers.js';

const NOW = Date.parse('2026-10-25T20:00:00Z');
const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();

/** A set with `rows` D1 rows and KV keys 1..keys (keys may exceed rows for a half-copied set). */
async function seed(env, setId, status, { rows = 3, keys = rows, count = status === 'building' ? 0 : rows, ageH = 48, job = status === 'building' ? 'ingesting' : 'done', jobAgeH = ageH, size = null } = {}) {
  const db = env.FRAME_DB;
  await db.prepare('INSERT INTO photo_sets (set_id, created_at, count, status) VALUES (?, ?, ?, ?)').bind(setId, iso(NOW - ageH * HOUR), count, status).run();
  if (job) {
    await db
      .prepare('INSERT INTO picker_jobs (id, session_id, set_id, status, count, skipped, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .bind('j' + setId, 'sess', setId, job, rows, iso(NOW - ageH * HOUR), iso(NOW - jobAgeH * HOUR))
      .run();
  }
  for (let n = 1; n <= rows; n++) {
    await db.prepare("INSERT INTO photos (set_id, n, w, h, orient, taken, blur, size) VALUES (?, ?, 4, 3, 'l', '', '', ?)").bind(setId, n, size).run();
  }
  for (let n = 1; n <= keys; n++) await env.FRAME_PHOTOS.put(photoKey(setId, n), new Uint8Array([n]));
}

const keysLeft = async (env, setId) => (await env.FRAME_PHOTOS.list({ prefix: 'p:' + setId + ':' })).keys.length;
const rowsLeft = async (env, setId) => (await env.FRAME_DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE set_id = ?').bind(setId).first()).n;
const statusOf = async (env, setId) => (await env.FRAME_DB.prepare('SELECT status FROM photo_sets WHERE set_id = ?').bind(setId).first()).status;

// KV is shared by the tests in a file, so each test starts with an empty namespace.
beforeEach(async () => {
  const env = testEnv();
  const l = await env.FRAME_PHOTOS.list();
  await Promise.all(l.keys.map((k) => env.FRAME_PHOTOS.delete(k.name)));
});

async function drain(env, nowMs = NOW, opts = {}) {
  for (let i = 0; i < 50; i++) {
    const r = await runCleanup(env, Object.assign({ nowMs }, opts));
    if (r.stopped === 'empty' || r.stopped === 'budget') return r;
  }
  throw new Error('cleanup never settled');
}

describe('P1c photo-set cleanup', () => {
  it('never deletes the active, previous or a live building set; purges retired, failed and stuck sets', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 4, ageH: 72 });
    await seed(env, 'sOld02', 'retired', { rows: 5, ageH: 60 });
    await seed(env, 'sPrev1', 'previous', { rows: 3, ageH: 40 });
    await seed(env, 'sAct01', 'active', { rows: 6, ageH: 20 });
    await seed(env, 'sBld01', 'building', { rows: 2, ageH: 30, jobAgeH: 1 }); // old, but its job moved an hour ago
    await seed(env, 'sBld02', 'building', { rows: 1, ageH: 1, jobAgeH: 0.1 }); // copying right now
    await seed(env, 'sFail1', 'building', { rows: 2, keys: 3, ageH: 2, job: 'failed' }); // failed job, one orphan key
    await seed(env, 'sStk01', 'building', { rows: 0, ageH: 30, job: 'picking' }); // abandoned picker

    expect((await cleanupQueue(env.FRAME_DB, NOW)).map((s) => s.set_id)).toEqual(['sOld01', 'sOld02', 'sStk01', 'sFail1']);
    await drain(env);
    for (const s of ['sOld01', 'sOld02', 'sFail1', 'sStk01']) {
      expect(await keysLeft(env, s)).toBe(0);
      expect(await rowsLeft(env, s)).toBe(0);
      expect(await statusOf(env, s)).toBe('purged');
    }
    expect(await keysLeft(env, 'sPrev1')).toBe(3);
    expect(await keysLeft(env, 'sAct01')).toBe(6);
    expect(await keysLeft(env, 'sBld01')).toBe(2);
    expect(await keysLeft(env, 'sBld02')).toBe(1);
    expect(await statusOf(env, 'sBld01')).toBe('building');
    expect(await rowsLeft(env, 'sAct01')).toBe(6);
    // The abandoned job no longer shows up as a copy to resume on /admin.
    const j = await env.FRAME_DB.prepare("SELECT status, error FROM picker_jobs WHERE set_id = 'sStk01'").first();
    expect(j).toEqual({ status: 'failed', error: 'purged' });
    expect(await cleanupQueue(env.FRAME_DB, NOW)).toEqual([]);
  });

  it('keeps the new active and previous sets when a set goes live mid-run, and queues the old previous', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 6, ageH: 72 });
    await seed(env, 'sPrev1', 'previous', { rows: 3, ageH: 40 });
    await seed(env, 'sAct01', 'active', { rows: 4, ageH: 20 });
    await seed(env, 'sNew01', 'building', { rows: 5, ageH: 1, jobAgeH: 0 });
    let swapped = false;
    const hooks = {
      beforeDelete: async () => {
        if (swapped) return;
        swapped = true;
        await env.FRAME_DB.batch([goLive(env.FRAME_DB, 'sNew01', 5)]);
      },
    };
    await runCleanup(env, { nowMs: NOW, batch: 2, hooks });
    expect(await statusOf(env, 'sNew01')).toBe('active');
    expect(await statusOf(env, 'sAct01')).toBe('previous');
    expect(await statusOf(env, 'sPrev1')).toBe('retired'); // joined the queue
    await drain(env);
    expect(await statusOf(env, 'sOld01')).toBe('purged');
    expect(await statusOf(env, 'sPrev1')).toBe('purged');
    expect(await keysLeft(env, 'sNew01')).toBe(5);
    expect(await keysLeft(env, 'sAct01')).toBe(4);
    expect(await rowsLeft(env, 'sAct01')).toBe(4);
  });

  it('a set claimed by the cleanup can never go live', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sAct01', 'active', { rows: 2 });
    await env.FRAME_DB.prepare("INSERT INTO photo_sets (set_id, created_at, count, status) VALUES ('sGone1', ?, 0, 'purging')").bind(iso(NOW)).run();
    const r = await env.FRAME_DB.batch([goLive(env.FRAME_DB, 'sGone1', 3)]);
    expect(r[0].meta.changes).toBe(0);
    expect(await statusOf(env, 'sAct01')).toBe('active');
  });

  it('caps KV deletes at 900 per UTC day and resumes the next day', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sAct01', 'active', { rows: 1 });
    await seed(env, 'sOld01', 'retired', { rows: 40, ageH: 72 });
    await env.FRAME_DB.prepare('INSERT INTO kv_deletes (day, count) VALUES (?, ?)').bind('2026-10-25', KV_DELETE_BUDGET - 15).run();
    const r1 = await drain(env);
    expect(r1.stopped).toBe('budget');
    expect(await kvDeletesToday(env.FRAME_DB, NOW)).toBe(KV_DELETE_BUDGET);
    expect(await keysLeft(env, 'sOld01')).toBe(25);
    expect(await rowsLeft(env, 'sOld01')).toBe(40); // D1 rows wait for every KV key
    const r2 = await runCleanup(env, { nowMs: NOW + HOUR }); // 21:00 UTC, same day
    expect(r2).toMatchObject({ deleted: 0, stopped: 'budget' });
    const tomorrow = Date.parse('2026-10-26T00:05:00Z');
    await drain(env, tomorrow);
    expect(await keysLeft(env, 'sOld01')).toBe(0);
    expect(await statusOf(env, 'sOld01')).toBe('purged');
    expect(await kvDeletesToday(env.FRAME_DB, tomorrow)).toBe(25);
  });

  it('a run never goes over the budget, even across several sets', async () => {
    const env = testEnv();
    await setup(env);
    for (let i = 1; i <= 3; i++) await seed(env, 'sOld0' + i, 'retired', { rows: 30, ageH: 80 - i });
    await env.FRAME_DB.prepare('INSERT INTO kv_deletes (day, count) VALUES (?, ?)').bind('2026-10-25', KV_DELETE_BUDGET - 40).run();
    await drain(env);
    expect(await kvDeletesToday(env.FRAME_DB, NOW)).toBe(KV_DELETE_BUDGET);
    expect(await statusOf(env, 'sOld01')).toBe('purged');
    expect(await keysLeft(env, 'sOld02')).toBe(20);
    expect(await statusOf(env, 'sOld02')).toBe('purging');
    expect(await statusOf(env, 'sOld03')).toBe('retired');
  });

  it('clears KV before D1: rows stay until the last key is gone', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 7 });
    const seen = [];
    const hooks = { beforeDelete: async (setId) => seen.push(await rowsLeft(env, setId)) };
    await runCleanup(env, { nowMs: NOW, batch: 3, hooks });
    expect(await keysLeft(env, 'sOld01')).toBe(4);
    expect(await rowsLeft(env, 'sOld01')).toBe(7);
    await drain(env, NOW, { batch: 3, hooks });
    expect(seen.every((n) => n === 7)).toBe(true);
    expect(await rowsLeft(env, 'sOld01')).toBe(0);
  });

  it('an interrupted purge resumes where it stopped', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 9 });
    let calls = 0;
    const hooks = {
      beforeDelete: async () => {
        calls++;
        if (calls === 2) throw new Error('worker killed');
      },
    };
    await runCleanup(env, { nowMs: NOW, batch: 4, hooks });
    await expect(runCleanup(env, { nowMs: NOW, batch: 4, hooks })).rejects.toThrow('worker killed');
    expect(await statusOf(env, 'sOld01')).toBe('purging');
    expect(await keysLeft(env, 'sOld01')).toBe(5);
    await drain(env, NOW, { batch: 4 });
    expect(await keysLeft(env, 'sOld01')).toBe(0);
    expect(await rowsLeft(env, 'sOld01')).toBe(0);
    expect(await statusOf(env, 'sOld01')).toBe('purged');
  });

  it('the cron runs the cleanup after the other refreshes', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 3 });
    const { runCron } = await import('../../worker/src/index.js');
    await runCron(env, NOW, async () => new Response('down', { status: 503 }));
    expect(await statusOf(env, 'sOld01')).toBe('purged');
    expect(await kvDeletesToday(env.FRAME_DB, NOW)).toBe(3);
  });
});

describe('P1c restore previous set', () => {
  it('swaps active and previous in one statement; pressing again flips back', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sPrev1', 'previous', { rows: 3, ageH: 40 });
    await seed(env, 'sAct01', 'active', { rows: 4, ageH: 20 });
    expect(await restorePrevious(env.FRAME_DB)).toEqual({ swapped: true });
    expect(await statusOf(env, 'sPrev1')).toBe('active');
    expect(await statusOf(env, 'sAct01')).toBe('previous');
    expect(await restorePrevious(env.FRAME_DB)).toEqual({ swapped: true });
    expect(await statusOf(env, 'sPrev1')).toBe('previous');
    expect(await statusOf(env, 'sAct01')).toBe('active');
    await drain(env);
    expect(await keysLeft(env, 'sPrev1')).toBe(3);
  });

  it('does nothing without a previous set', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sAct01', 'active', { rows: 2 });
    expect(await restorePrevious(env.FRAME_DB)).toEqual({ swapped: false });
    expect(await statusOf(env, 'sAct01')).toBe('active');
    const res = await handleAdmin(req('/admin/api/photos/restore-previous', { method: 'POST' }), env, new URL(req('/admin/api/photos/restore-previous').url), { email: 'a@b.c' });
    expect(res.status).toBe(409);
  });

  it('the admin route swaps and returns the new line', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sPrev1', 'previous', { rows: 3, ageH: 40 });
    await seed(env, 'sAct01', 'active', { rows: 4, ageH: 20 });
    const u = new URL(req('/admin/api/photos/restore-previous').url);
    const res = await handleAdmin(req(u.pathname, { method: 'POST' }), env, u, { email: 'a@b.c' });
    const body = await res.json();
    expect(body.sets.current).toMatchObject({ setId: 'sPrev1', count: 3 });
    expect(body.sets.previous).toMatchObject({ setId: 'sAct01', count: 4 });
  });
});

describe('P1c admin line and health', () => {
  it('summarises current, previous, queue, deletes left and storage (approx. for unsized sets)', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 2, ageH: 72 });
    await seed(env, 'sPrev1', 'previous', { rows: 3, ageH: 40 });
    await seed(env, 'sAct01', 'active', { rows: 4, ageH: 20, size: 1000 });
    await env.FRAME_DB.prepare('INSERT INTO kv_deletes (day, count) VALUES (?, ?)').bind('2026-10-25', 100).run();
    const s = await photoSummary(env.FRAME_DB, NOW);
    expect(s.current).toMatchObject({ setId: 'sAct01', count: 4, date: iso(NOW - 20 * HOUR) });
    expect(s.previous).toMatchObject({ setId: 'sPrev1', count: 3 });
    expect(s).toMatchObject({ queued: 1, deletedToday: 100, deletesLeft: 800 });
    // 4 sized photos (4,000 bytes) plus 5 unsized ones at the sized average (1,000 each).
    expect(s.storage).toEqual({ bytes: 9000, approx: true });
    await drain(env);
    await env.FRAME_DB.prepare("UPDATE photos SET size = 2000 WHERE set_id = 'sPrev1'").run();
    expect((await photoSummary(env.FRAME_DB, NOW)).storage).toEqual({ bytes: 10000, approx: false });
  });

  it('health has a soft cleanup block and alerts only when the active set is missing photos', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 2 });
    await seed(env, 'sAct01', 'active', { rows: 4, ageH: 20 });
    let h = await buildHealth(env);
    expect(h.photos.cleanup).toEqual({ queued: 1, deletedToday: 0 });
    expect(h.photos.missing).toBe(0);
    expect(h.problems).not.toContain('photos_active_missing');
    await drain(env, Date.now());
    h = await buildHealth(env);
    expect(h.photos.cleanup).toEqual({ queued: 0, deletedToday: 2 });
    await env.FRAME_DB.prepare("DELETE FROM photos WHERE set_id = 'sAct01' AND n = 4").run();
    h = await buildHealth(env);
    expect(h.photos.missing).toBe(1);
    expect(h.problems).toContain('photos_active_missing');
    expect(h.alert).toBe(true);
    const res = await route(req('/api/health', auth(HEALTH)), env);
    expect((await res.json()).photos.cleanup.queued).toBe(0);
  });
});

describe('P1c schema v3', () => {
  it('makes the newest retired set previous once, leaving older ones queued', async () => {
    const env = testEnv();
    await setup(env);
    await seed(env, 'sOld01', 'retired', { rows: 1, ageH: 72 });
    await seed(env, 'sOld02', 'retired', { rows: 1, ageH: 60 });
    await seed(env, 'sOld03', 'retired', { rows: 1, ageH: 50 });
    await seed(env, 'sAct01', 'active', { rows: 1, ageH: 20 });
    await setMeta(env.FRAME_DB, 'schema_v', 2);
    await migrate(env.FRAME_DB);
    expect(await statusOf(env, 'sOld03')).toBe('previous');
    expect(await statusOf(env, 'sOld02')).toBe('retired');
    await setMeta(env.FRAME_DB, 'schema_v', 2);
    await migrate(env.FRAME_DB); // idempotent
    expect(await statusOf(env, 'sOld02')).toBe('retired');
    expect((await env.FRAME_DB.prepare("SELECT COUNT(*) AS n FROM photo_sets WHERE status = 'previous'").first()).n).toBe(1);
  });
});
