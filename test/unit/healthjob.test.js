import { describe, expect, it } from 'vitest';
import { decide } from '../../worker/src/healthjob.js';
import { buildHealthMail } from '../../worker/src/mail.js';
import { previousFailures, watchdogDecision, checkHealth } from '../../tools/health-watchdog.mjs';

describe('health job state machine', () => {
  it('warns, alerts once, and then stays quiet for the same set', () => {
    let state = { last: '', alerted: '' };
    let r = decide(state, 'frame_offline');
    expect(r.action).toBe('warn'); state = r.next;
    r = decide(state, 'frame_offline');
    expect(r.action).toBe('alert'); state = r.next;
    expect(decide(state, 'frame_offline').action).toBe('none');
  });
  it('alerts when an alerted problem set changes', () => {
    const state = { last: 'grant_calendar_bad', alerted: 'grant_calendar_bad' };
    expect(decide(state, 'frame_offline').action).toBe('alert');
    expect(decide(state, 'frame_offline grant_calendar_bad').action).toBe('alert');
  });
  it('recovers only after an alert', () => {
    expect(decide({ last: 'x', alerted: 'x' }, '')).toEqual({ action: 'recovered', next: { last: '', alerted: '' } });
    expect(decide({ last: 'x', alerted: '' }, '').action).toBe('none');
  });
});

describe('health mail copy', () => {
  it('uses exact subjects and safe two or three sentence text', () => {
    for (const action of ['alert', 'recovered']) {
      const m = buildHealthMail(action, ['grant_calendar_needs_reconsent', 'weather_stale']);
      expect(m.subject).toBe(`Smart frame: ${action}`);
      expect(m.text.split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeGreaterThanOrEqual(2);
      expect(m.text.split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(3);
      expect(m.text.toLowerCase()).not.toMatch(/bearer|token|pair/);
    }
  });
});

describe('watchdog decisions', () => {
  it('counts failed scheduled runs until the first non-failure', () => {
    expect(previousFailures([{ id: 9, conclusion: 'failure' }, { id: 8, conclusion: 'failure' }, { id: 7, conclusion: 'success' }], 10)).toBe(2);
  });
  it('alerts on the second down run and recovers after an alerted outage', () => {
    expect(watchdogDecision(false, 0)).toEqual({ exitCode: 1, action: 'none' });
    expect(watchdogDecision(false, 1)).toEqual({ exitCode: 1, action: 'alert' });
    expect(watchdogDecision(true, 1)).toEqual({ exitCode: 0, action: 'none' });
    expect(watchdogDecision(true, 2)).toEqual({ exitCode: 0, action: 'recovered' });
  });
  it('accepts only a parseable 200 response', async () => {
    expect(await checkHealth('https://x', 'x', { tries: 1, fetchImpl: async () => Response.json({ problems: ['x'] }) })).toEqual({ up: true, reason: 'ok' });
    expect((await checkHealth('https://x', 'x', { tries: 1, fetchImpl: async () => new Response('bad', { status: 200 }) })).up).toBe(false);
  });
});
