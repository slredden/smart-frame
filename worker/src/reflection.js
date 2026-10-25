// Reflection storage: encrypted at rest, never logged (PLAN.md §9.4, PLAN-v2.md §8.2).
// P1b keeps up to KEEP_GUIDES published guides, one row per guide start, so the frame can show history.
import { validateGuide, cleanGuide, pickGuide, currentWeek } from '../../shared/reflection.js';
import { encryptText, decryptText } from './crypto.js';
import { nowIso, setMeta } from './db.js';
import { log } from './http.js';

const LEGACY_AAD = 'reflection';
const aad = (start) => 'reflection:' + start;
export const KEEP_GUIDES = 6;

async function boxGuide(env, g) {
  return encryptText(env.TOKEN_ENC_KEY, JSON.stringify(g), aad(g.guide.start));
}

function upsert(db, g, boxed, ts) {
  return db
    .prepare('INSERT INTO reflection_guides (start, end, data_enc, published_at) VALUES (?, ?, ?, ?) ON CONFLICT(start) DO UPDATE SET end = excluded.end, data_enc = excluded.data_enc, published_at = excluded.published_at')
    .bind(g.guide.start, g.guide.end, boxed, ts);
}

const PRUNE = 'DELETE FROM reflection_guides WHERE start NOT IN (SELECT start FROM reflection_guides ORDER BY start DESC LIMIT ' + KEEP_GUIDES + ')';

/**
 * Chief's publish (and the /admin fallback). Republishing a guide with the same start replaces it; the
 * oldest guides past KEEP_GUIDES are pruned. The v1 id = 1 row is still written for one release, so a
 * rollback to P1 keeps showing the newest guide.
 */
export async function publishReflection(env, body, nowMs = Date.now()) {
  const problems = validateGuide(body);
  if (problems.length) return { ok: false, problems };
  const db = env.FRAME_DB;
  await migrateLegacy(env);
  const g = cleanGuide(body);
  const ts = nowIso(nowMs);
  const boxed = await boxGuide(env, g);
  const legacy = await encryptText(env.TOKEN_ENC_KEY, JSON.stringify(g), LEGACY_AAD);
  await db.batch([
    upsert(db, g, boxed, ts),
    db.prepare(PRUNE),
    db.prepare('INSERT INTO reflection (id, data_enc, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_enc = excluded.data_enc, updated_at = excluded.updated_at').bind(legacy, ts),
  ]);
  await setMeta(db, 'reflection_published_at', ts);
  return { ok: true, weeks: g.weeks.map((w) => ({ n: w.n, start: w.start, end: w.end })), start: g.guide.start, end: g.guide.end };
}

/** One-time move of the v1 single guide (reflection id = 1) into reflection_guides. */
async function migrateLegacy(env) {
  const db = env.FRAME_DB;
  const have = await db.prepare('SELECT COUNT(*) AS n FROM reflection_guides').first();
  if (have && have.n) return false;
  const row = await db.prepare('SELECT data_enc, updated_at FROM reflection WHERE id = 1').first();
  if (!row) return false;
  let g;
  try {
    g = JSON.parse(await decryptText(env.TOKEN_ENC_KEY, row.data_enc, LEGACY_AAD));
  } catch {
    return false;
  }
  if (validateGuide(g).length) return false;
  await upsert(db, g, await boxGuide(env, g), row.updated_at).run();
  log('reflection_migrated', { guides: 1 });
  return true;
}

/** Every stored guide, newest start first. Rows that fail to decrypt are skipped. */
export async function loadGuides(env) {
  const db = env.FRAME_DB;
  let { results } = await db.prepare('SELECT start, data_enc FROM reflection_guides ORDER BY start DESC').all();
  if (!results.length && (await migrateLegacy(env))) ({ results } = await db.prepare('SELECT start, data_enc FROM reflection_guides ORDER BY start DESC').all());
  const out = [];
  for (const r of results) {
    try {
      out.push(JSON.parse(await decryptText(env.TOKEN_ENC_KEY, r.data_enc, aad(r.start))));
    } catch {
      log('reflection_decrypt_failed', {});
    }
  }
  return out;
}

/** Home's "This week": the current week of the guide in force today. */
export async function reflectionFor(env, ymd, guides) {
  return currentWeek(pickGuide(guides || (await loadGuides(env)), ymd), ymd);
}
