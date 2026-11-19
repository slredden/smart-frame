import { describe, it, expect } from 'vitest';
import { runHealthJob } from '../../worker/src/healthjob.js';
import { getMeta } from '../../worker/src/db.js';
import { testEnv, setup } from './helpers.js';

const at = (hour) => Date.parse(`2026-11-18T${String(hour + 7).padStart(2, '0')}:00:00Z`); // Denver is MST.
const bad = async () => ({ problems: ['frame_offline'] });

async function ready() {
  const env = testEnv({ AGENTMAIL_API_KEY: 'a'.repeat(20), ALERT_TO: 'test@example.com' });
  await setup(env);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response('', { status: 202 }); };
  return { env, calls, fetchImpl };
}

describe('Worker health job', () => {
  it('warns, alerts once, recovers once, and claims each slot once', async () => {
    const { env, calls, fetchImpl } = await ready();
    await runHealthJob(env, at(7), { buildHealthImpl: async () => ({ problems: [] }), fetchImpl });
    await runHealthJob(env, at(9), { buildHealthImpl: bad, fetchImpl });
    await runHealthJob(env, at(11), { buildHealthImpl: bad, fetchImpl });
    await runHealthJob(env, at(13), { buildHealthImpl: bad, fetchImpl });
    await runHealthJob(env, at(15), { buildHealthImpl: async () => ({ problems: [] }), fetchImpl });
    await runHealthJob(env, at(17), { buildHealthImpl: async () => ({ problems: [] }), fetchImpl });
    expect(calls.map((c) => JSON.parse(c.init.body).subject)).toEqual(['Smart frame: alert', 'Smart frame: recovered']);
    const again = await runHealthJob(env, at(17), { buildHealthImpl: bad, fetchImpl });
    expect(again).toEqual({ skipped: 'slot' });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers.Authorization).toBe('Bearer ' + env.AGENTMAIL_API_KEY);
    expect(calls[0].init.body).not.toContain(env.AGENTMAIL_API_KEY);
  });
  it('skips out-of-window and odd local hours', async () => {
    const { env, calls, fetchImpl } = await ready();
    expect(await runHealthJob(env, at(6), { buildHealthImpl: bad, fetchImpl })).toEqual({ skipped: 'hour' });
    expect(await runHealthJob(env, at(8), { buildHealthImpl: bad, fetchImpl })).toEqual({ skipped: 'hour' });
    expect(calls).toHaveLength(0);
  });
  it('retries alert delivery and keeps alert state untouched on missing mail configuration', async () => {
    const { env, calls, fetchImpl } = await ready();
    let fail = true;
    const flaky = async (url, init) => { calls.push({ url, init }); return new Response('', { status: fail ? 500 : 202 }); };
    await runHealthJob(env, at(7), { buildHealthImpl: bad, fetchImpl: flaky });
    await runHealthJob(env, at(9), { buildHealthImpl: bad, fetchImpl: flaky });
    expect(await getMeta(env.FRAME_DB, 'health_job_alerted')).toBe('');
    fail = false;
    await runHealthJob(env, at(11), { buildHealthImpl: bad, fetchImpl: flaky });
    expect(calls).toHaveLength(2);
    delete env.AGENTMAIL_API_KEY;
    await runHealthJob(env, at(13), { buildHealthImpl: async () => ({ problems: ['grant_calendar_bad'] }), fetchImpl });
    expect(await getMeta(env.FRAME_DB, 'health_job_alerted')).toBe('frame_offline');
  });
  it('turns a health exception into a handled problem and works with real health on an empty DB', async () => {
    const { env, calls, fetchImpl } = await ready();
    await runHealthJob(env, at(7), { buildHealthImpl: async () => { throw new Error('no'); }, fetchImpl });
    expect(await getMeta(env.FRAME_DB, 'health_job_last')).toBe('health_check_error');
    await runHealthJob(env, at(9), { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body).subject).toBe('Smart frame: alert');
  });
});
