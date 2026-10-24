// Reflection storage: encrypted at rest, never logged (PLAN.md §9.4).
import { validateGuide, currentWeek, cleanGuide } from '../../shared/reflection.js';
import { encryptText, decryptText } from './crypto.js';
import { nowIso, setMeta } from './db.js';

const AAD = 'reflection';

export async function publishReflection(env, body, nowMs = Date.now()) {
  const problems = validateGuide(body);
  if (problems.length) return { ok: false, problems };
  const g = cleanGuide(body);
  const boxed = await encryptText(env.TOKEN_ENC_KEY, JSON.stringify(g), AAD);
  await env.FRAME_DB
    .prepare('INSERT INTO reflection (id, data_enc, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data_enc = excluded.data_enc, updated_at = excluded.updated_at')
    .bind(boxed, nowIso(nowMs))
    .run();
  await setMeta(env.FRAME_DB, 'reflection_published_at', nowIso(nowMs));
  return { ok: true, weeks: g.weeks.map((w) => ({ n: w.n, start: w.start, end: w.end })), start: g.guide.start, end: g.guide.end };
}

export async function loadGuide(env) {
  const row = await env.FRAME_DB.prepare('SELECT data_enc FROM reflection WHERE id = 1').first();
  if (!row) return null;
  try {
    return JSON.parse(await decryptText(env.TOKEN_ENC_KEY, row.data_enc, AAD));
  } catch {
    return null;
  }
}

export async function reflectionFor(env, ymd) {
  return currentWeek(await loadGuide(env), ymd);
}
