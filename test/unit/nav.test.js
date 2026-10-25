import { describe, it, expect } from 'vitest';
import { HOME, NIGHT, initialState, awake, screenAt, tap, msUntilIdle } from '../../frame/src/nav.js';

const IDLE = 10 * 60000;
const m = (h, mm = 0) => h * 60 + mm;

describe('taps and idle (v1.2: one Home layout, no A/B swap)', () => {
  it('day: a tap keeps Home and only restarts the idle timer', () => {
    let s = tap(initialState(), 1000);
    expect(screenAt(s, m(12), 1000, IDLE)).toBe(HOME);
    s = tap(s, 2000);
    expect(screenAt(s, m(12), 2000, IDLE)).toBe(HOME);
    expect(msUntilIdle(s, 2000, IDLE)).toBe(IDLE);
  });

  it('the 6-7 AM slot is plain Home, and a tap there changes nothing', () => {
    expect(screenAt(initialState(), m(6, 30), 0, IDLE)).toBe(HOME);
    expect(screenAt(tap(initialState(), 0), m(6, 30), 0, IDLE)).toBe(HOME);
  });

  it('night: a tap wakes to Home, and another tap stays on Home', () => {
    expect(screenAt(initialState(), m(23), 0, IDLE)).toBe(NIGHT);
    let s = tap(initialState(), 0);
    expect(screenAt(s, m(23), 0, IDLE)).toBe(HOME);
    s = tap(s, 5000);
    expect(screenAt(s, m(23), 5000, IDLE)).toBe(HOME);
  });

  it('falls back to the night clock after the idle timeout, and each tap restarts it', () => {
    let s = tap(initialState(), 0);
    s = tap(s, IDLE - 1000);
    expect(screenAt(s, m(23), IDLE - 1000 + IDLE - 1, IDLE)).toBe(HOME);
    expect(screenAt(s, m(23), IDLE - 1000 + IDLE, IDLE)).toBe(NIGHT);
    expect(awake(s, IDLE - 1000 + IDLE, IDLE)).toBe(false);
    expect(msUntilIdle(s, IDLE * 5, IDLE)).toBe(null);
  });

  it('is not awake before any touch', () => {
    expect(awake(initialState(), 0, IDLE)).toBe(false);
    expect(msUntilIdle(initialState(), 0, IDLE)).toBe(null);
  });

  it('a monotonic clock going backwards counts as idle', () => {
    const s = tap(initialState(), 5000);
    expect(awake(s, 1000, IDLE)).toBe(false);
    expect(screenAt(s, m(23), 1000, IDLE)).toBe(NIGHT);
  });

  it('uses the configured schedule when idle', () => {
    const sched = { dayStart: m(8), nightStart: m(20) };
    expect(screenAt(initialState(), m(7), 0, IDLE, sched)).toBe(NIGHT);
    expect(screenAt(initialState(), m(8), 0, IDLE, sched)).toBe(HOME);
  });
});
