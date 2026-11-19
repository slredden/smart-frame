import { zonedParts, ymdIn } from '../../shared/time.js';
import { getMeta, setMeta } from './db.js';
import { buildHealth } from './health.js';
import { log } from './http.js';
import { buildHealthMail, sendAgentMail } from './mail.js';

const RUN_HOURS = new Set([7, 9, 11, 13, 15, 17, 19, 21]);

/** The two-strike state machine. Problem sets must already be sorted and joined. */
export function decide(state, problems) {
  const last = state.last || '';
  const alerted = state.alerted || '';
  if (!problems) return alerted ? { action: 'recovered', next: { last: '', alerted: '' } } : { action: 'none', next: { last: '', alerted: '' } };
  if (!last) return { action: 'warn', next: { last: problems, alerted } };
  if (problems === alerted) return { action: 'none', next: { last: problems, alerted } };
  return { action: 'alert', next: { last: problems, alerted: problems } };
}

async function claimSlot(db, slot) {
  if ((await getMeta(db, 'health_job_slot')) === slot) return false;
  // The conditional upsert closes the race left by the cheap read above.
  const r = await db.prepare("INSERT INTO meta (key, value) VALUES ('health_job_slot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE meta.value <> excluded.value").bind(slot).run();
  return r.meta.changes === 1;
}

/** Runs at most once in each selected local hour. Dependencies keep the D1 worker test hermetic. */
export async function runHealthJob(env, nowMs = Date.now(), { buildHealthImpl = buildHealth, fetchImpl = fetch } = {}) {
  const tz = env.TIME_ZONE || 'America/Denver';
  const parts = zonedParts(nowMs, tz);
  if (!RUN_HOURS.has(parts.hour)) return { skipped: 'hour' };
  const slot = `${ymdIn(nowMs, tz)}@${String(parts.hour).padStart(2, '0')}`;
  if (!(await claimSlot(env.FRAME_DB, slot))) return { skipped: 'slot' };
  let codes;
  try {
    const health = await buildHealthImpl(env, nowMs);
    codes = Array.from(new Set(health.problems || [])).sort();
  } catch {
    codes = ['health_check_error'];
  }
  const problems = codes.join(' ');
  const state = { last: (await getMeta(env.FRAME_DB, 'health_job_last')) || '', alerted: (await getMeta(env.FRAME_DB, 'health_job_alerted')) || '' };
  const decision = decide(state, problems);
  if (decision.action === 'alert' || decision.action === 'recovered') {
    const sent = await sendAgentMail(env, buildHealthMail(decision.action, codes), { fetchImpl });
    if (!sent.ok) {
      await setMeta(env.FRAME_DB, 'health_job_last', decision.next.last);
      log('health_job_mail_failed', { action: decision.action, reason: sent.reason });
      return { action: decision.action, sent: false };
    }
  }
  await setMeta(env.FRAME_DB, 'health_job_last', decision.next.last);
  await setMeta(env.FRAME_DB, 'health_job_alerted', decision.next.alerted);
  log('health_job', { action: decision.action, problems: codes.length });
  return { action: decision.action, sent: decision.action === 'alert' || decision.action === 'recovered' };
}
