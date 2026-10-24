import { describe, it, expect } from 'vitest';
import { A, B, NIGHT, scheduled, initialState, screenAt, tap, expire, msUntilIdle } from '../../frame/src/schedule.js';
import { minutesOfDay } from '../../shared/time.js';

const TZ = 'America/Denver';
const IDLE = 10 * 60000;
const m = (h, mm = 0) => h * 60 + mm;

describe('scheduled', () => {
  it('follows the day plan', () => {
    expect(scheduled(m(0))).toBe(NIGHT);
    expect(scheduled(m(5, 59))).toBe(NIGHT);
    expect(scheduled(m(6))).toBe(B);
    expect(scheduled(m(6, 59))).toBe(B);
    expect(scheduled(m(7))).toBe(A);
    expect(scheduled(m(21, 59))).toBe(A);
    expect(scheduled(m(22))).toBe(NIGHT);
  });

  it('uses Denver wall time across both DST changes', () => {
    // 2026-11-01: clocks fall back at 2:00 MDT. 6:00 AM MST = 13:00 UTC.
    expect(scheduled(minutesOfDay(Date.parse('2026-11-01T12:59:00Z'), TZ))).toBe(NIGHT);
    expect(scheduled(minutesOfDay(Date.parse('2026-11-01T13:00:00Z'), TZ))).toBe(B);
    expect(scheduled(minutesOfDay(Date.parse('2026-11-01T14:00:00Z'), TZ))).toBe(A);
    // 2027-03-14: spring forward. 6:00 AM MDT = 12:00 UTC.
    expect(scheduled(minutesOfDay(Date.parse('2027-03-14T11:59:00Z'), TZ))).toBe(NIGHT);
    expect(scheduled(minutesOfDay(Date.parse('2027-03-14T12:00:00Z'), TZ))).toBe(B);
    expect(scheduled(minutesOfDay(Date.parse('2027-03-15T04:00:00Z'), TZ))).toBe(NIGHT); // 10 PM MDT
  });
});

describe('taps and idle', () => {
  it('day: taps swap A and B', () => {
    let s = initialState();
    s = tap(s, m(12), 1000, IDLE);
    expect(screenAt(s, m(12), 1000, IDLE)).toBe(B);
    s = tap(s, m(12), 2000, IDLE);
    expect(screenAt(s, m(12), 2000, IDLE)).toBe(A);
  });

  it('morning: tap on B shows A', () => {
    const s = tap(initialState(), m(6, 30), 0, IDLE);
    expect(screenAt(s, m(6, 30), 0, IDLE)).toBe(A);
  });

  it('night: first tap wakes to A, second swaps to B', () => {
    let s = tap(initialState(), m(23), 0, IDLE);
    expect(screenAt(s, m(23), 0, IDLE)).toBe(A);
    s = tap(s, m(23), 5000, IDLE);
    expect(screenAt(s, m(23), 5000, IDLE)).toBe(B);
  });

  it('returns to the schedule after idle, and each tap restarts the timer', () => {
    let s = tap(initialState(), m(12), 0, IDLE);
    s = tap(s, m(12), IDLE - 1000, IDLE); // back to A, timer restarted
    s = tap(s, m(12), IDLE + 1000, IDLE); // B again
    expect(screenAt(s, m(12), IDLE + 1000 + IDLE - 1, IDLE)).toBe(B);
    expect(screenAt(s, m(12), IDLE + 1000 + IDLE, IDLE)).toBe(A);
    expect(msUntilIdle(s, IDLE + 1000, IDLE)).toBe(IDLE);
    expect(expire(s, IDLE * 5, IDLE)).toEqual(initialState());
  });

  it('an override expiring at night drops back to the night screen', () => {
    const s = tap(initialState(), m(23), 0, IDLE);
    expect(screenAt(s, m(23, 10), IDLE, IDLE)).toBe(NIGHT);
  });

  it('a monotonic clock going backwards cancels the override', () => {
    const s = tap(initialState(), m(12), 5000, IDLE);
    expect(screenAt(s, m(12), 1000, IDLE)).toBe(A);
  });
});
