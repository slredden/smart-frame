// Google Photos Picker ingest (PLAN.md §7.4). Driven step by step from /admin so each request stays
// under the free plan's 50 subrequests.
import { accessToken } from './oauth.js';
import { randomToken } from '../crypto.js';
import { nowIso, setMeta } from '../db.js';
import { photoKey } from '../photos.js';
import { log } from '../http.js';

const API = 'https://photospicker.googleapis.com/v1';
export const BATCH = 20; // 20 photos × 2 fetches + list + token ≤ 50 subrequests
export const KV_DAILY_BUDGET = 900; // of the free 1,000 writes a day

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function kvWritesToday(db, nowMs) {
  const r = await db.prepare('SELECT count FROM kv_writes WHERE day = ?').bind(utcDay(nowMs)).first();
  return r ? r.count : 0;
}

async function addKvWrites(db, n, nowMs) {
  await db
    .prepare('INSERT INTO kv_writes (day, count) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET count = count + excluded.count')
    .bind(utcDay(nowMs), n)
    .run();
}

/** Orientation and a short 'YYYY-MM' style date from a PickedMediaItem. */
export function describeItem(item) {
  const meta = (item.mediaFile && item.mediaFile.mediaFileMetadata) || {};
  const w = Number(meta.width) || 0;
  const h = Number(meta.height) || 0;
  const taken = typeof item.createTime === 'string' ? item.createTime.slice(0, 7) : '';
  return { w, h, orient: h > w ? 'p' : 'l', taken: /^\d{4}-\d{2}$/.test(taken) ? taken : '' };
}

function bytesToDataUrl(buf, type) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return 'data:' + type + ';base64,' + btoa(s);
}

/** Creates a Picker session and a job row. Refuses when today's KV write budget can't fit a full set. */
export async function startPicker(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const max = Number(env.PHOTO_SET_MAX) || 300;
  if ((await kvWritesToday(db, nowMs)) + max > KV_DAILY_BUDGET) return { ok: false, error: 'kv_budget_today' };
  const token = await accessToken(env, 'photos', { fetchImpl, nowMs });
  if (!token) return { ok: false, error: 'photos_not_connected' };
  const res = await fetchImpl(API + '/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pickingConfig: { maxItemCount: String(max) } }),
  });
  if (!res.ok) {
    log('picker_session_failed', { status: res.status });
    return { ok: false, error: 'session_failed' };
  }
  const s = await res.json();
  const id = randomToken(9);
  const setId = 's' + randomToken(6);
  const t = nowIso(nowMs);
  await db
    .prepare("INSERT INTO picker_jobs (id, session_id, set_id, status, cursor, count, skipped, created_at, updated_at) VALUES (?, ?, ?, 'picking', NULL, 0, 0, ?, ?)")
    .bind(id, s.id, setId, t, t)
    .run();
  await db.prepare("INSERT INTO photo_sets (set_id, created_at, count, status) VALUES (?, ?, 0, 'building')").bind(setId, t).run();
  return { ok: true, id, pickerUri: String(s.pickerUri || '') + '/autoclose', pollSeconds: parseFloat((s.pollingConfig && s.pollingConfig.pollInterval) || '5') || 5 };
}

async function setJob(db, id, fields, nowMs) {
  const keys = Object.keys(fields);
  const sql = 'UPDATE picker_jobs SET ' + keys.map((k) => k + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?';
  await db.prepare(sql).bind(...keys.map((k) => fields[k]), nowIso(nowMs), id).run();
}

/**
 * One step of a job: while picking, check the session; once picked, ingest one batch; at the end,
 * swap the active set atomically and close the session.
 */
export async function stepPicker(env, id, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const job = await db.prepare('SELECT * FROM picker_jobs WHERE id = ?').bind(id).first();
  if (!job) return { status: 'missing' };
  if (job.status === 'done' || job.status === 'failed') return { status: job.status, count: job.count, skipped: job.skipped, message: job.error || '' };
  const token = await accessToken(env, 'photos', { fetchImpl, nowMs });
  if (!token) {
    await setJob(db, id, { status: 'failed', error: 'photos_not_connected' }, nowMs);
    return { status: 'failed', message: 'Photos sign-in needs reconnecting' };
  }
  const auth = { Authorization: 'Bearer ' + token };

  if (job.status === 'picking') {
    const r = await fetchImpl(API + '/sessions/' + encodeURIComponent(job.session_id), { headers: auth });
    if (!r.ok) return { status: 'picking', message: 'Waiting for the picker…' };
    const s = await r.json();
    if (!s.mediaItemsSet) return { status: 'picking', message: 'Waiting for you to finish picking…' };
    await setJob(db, id, { status: 'ingesting' }, nowMs);
    return { status: 'ingesting', count: job.count, message: 'Copying photos…' };
  }

  // ingesting
  const max = Number(env.PHOTO_SET_MAX) || 300;
  if ((await kvWritesToday(db, nowMs)) + BATCH > KV_DAILY_BUDGET) {
    return { status: 'ingesting', count: job.count, message: 'Paused: today’s storage write budget is used up. It resumes tomorrow.' };
  }
  const q = new URLSearchParams({ sessionId: job.session_id, pageSize: String(BATCH) });
  if (job.cursor) q.set('pageToken', job.cursor);
  const lr = await fetchImpl(API + '/mediaItems?' + q.toString(), { headers: auth });
  if (!lr.ok) {
    await setJob(db, id, { status: 'failed', error: 'list_http_' + lr.status }, nowMs);
    return { status: 'failed', message: 'Listing picked photos failed' };
  }
  const page = await lr.json();
  let count = job.count;
  let skipped = job.skipped;
  let writes = 0;
  for (const item of page.mediaItems || []) {
    const file = item.mediaFile || {};
    if (item.type !== 'PHOTO' || !file.baseUrl || count >= max) {
      skipped++;
      continue;
    }
    const d = describeItem(item);
    const big = await fetchImpl(file.baseUrl + '=w1280-h800', { headers: auth });
    if (!big.ok) {
      skipped++;
      continue;
    }
    const type = (big.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const bytes = await big.arrayBuffer();
    let blur = '';
    const small = await fetchImpl(file.baseUrl + '=w32-h20', { headers: auth });
    if (small.ok) blur = bytesToDataUrl(await small.arrayBuffer(), (small.headers.get('content-type') || 'image/jpeg').split(';')[0]);
    const n = count + 1;
    await env.FRAME_PHOTOS.put(photoKey(job.set_id, n), bytes, { metadata: { type } });
    writes++;
    await db
      .prepare('INSERT OR REPLACE INTO photos (set_id, n, w, h, orient, taken, blur) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(job.set_id, n, d.w, d.h, d.orient, d.taken, blur)
      .run();
    count = n;
  }
  if (writes) await addKvWrites(db, writes, nowMs);
  const next = page.nextPageToken || null;
  if (next && count < max) {
    await setJob(db, id, { cursor: next, count, skipped }, nowMs);
    return { status: 'ingesting', count, skipped, message: 'Copied ' + count + ' photos…' };
  }
  if (count === 0) {
    await setJob(db, id, { status: 'failed', count, skipped, error: 'no_photos' }, nowMs);
    return { status: 'failed', message: 'No photos were picked' };
  }
  // Atomic swap: the new set becomes active and any previous active set is retired, in one statement.
  await db.batch([
    db.prepare("UPDATE photo_sets SET status = CASE WHEN set_id = ?1 THEN 'active' ELSE 'retired' END, count = CASE WHEN set_id = ?1 THEN ?2 ELSE count END WHERE set_id = ?1 OR status = 'active'").bind(job.set_id, count),
    db.prepare("UPDATE picker_jobs SET status = 'done', cursor = NULL, count = ?, skipped = ?, updated_at = ? WHERE id = ?").bind(count, skipped, nowIso(nowMs), id),
  ]);
  await setMeta(db, 'photo_sync_at', nowIso(nowMs));
  try {
    await fetchImpl(API + '/sessions/' + encodeURIComponent(job.session_id), { method: 'DELETE', headers: auth });
  } catch {
    // the session expires on its own
  }
  log('photos_ingested', { count, skipped });
  return { status: 'done', count, skipped, message: 'Done: ' + count + ' photos' + (skipped ? ', ' + skipped + ' skipped' : '') };
}
