import { describe, it, expect } from 'vitest';
import { HOME, NIGHT, scheduled, DEFAULT_SCHEDULE } from '../../frame/src/schedule.js';
import { minutesOfDay } from '../../shared/time.js';

const TZ = 'America/Denver';
const m = (h, mm = 0) => h * 60 + mm;

describe('scheduled', () => {
  it('follows the day plan: Home 6:00-22:00, night otherwise', () => {
    expect(DEFAULT_SCHEDULE).toEqual({ dayStart: m(6), nightStart: m(22) });
    expect(scheduled(m(0))).toBe(NIGHT);
    expect(scheduled(m(5, 59))).toBe(NIGHT);
    expect(scheduled(m(6))).toBe(HOME);
    expect(scheduled(m(6, 59))).toBe(HOME);
    expect(scheduled(m(7))).toBe(HOME);
    expect(scheduled(m(21, 59))).toBe(HOME);
    expect(scheduled(m(22))).toBe(NIGHT);
    expect(scheduled(m(23, 59))).toBe(NIGHT);
  });

  it('takes configurable bounds, including a window that wraps midnight', () => {
    const s = { dayStart: m(7, 30), nightStart: m(21) };
    expect(scheduled(m(7, 29), s)).toBe(NIGHT);
    expect(scheduled(m(7, 30), s)).toBe(HOME);
    expect(scheduled(m(20, 59), s)).toBe(HOME);
    expect(scheduled(m(21), s)).toBe(NIGHT);
    const wrap = { dayStart: m(20), nightStart: m(2) };
    expect(scheduled(m(23), wrap)).toBe(HOME);
    expect(scheduled(m(1, 59), wrap)).toBe(HOME);
    expect(scheduled(m(2), wrap)).toBe(NIGHT);
    expect(scheduled(m(19, 59), wrap)).toBe(NIGHT);
  });

  it('uses Denver wall time across both DST changes', () => {
    // 2026-11-01: clocks fall back at 2:00 MDT. 6:00 AM MST = 13:00 UTC.
    expect(scheduled(minutesOfDay(Date.parse('2026-11-01T12:59:00Z'), TZ))).toBe(NIGHT);
    expect(scheduled(minutesOfDay(Date.parse('2026-11-01T13:00:00Z'), TZ))).toBe(HOME);
    expect(scheduled(minutesOfDay(Date.parse('2026-11-02T04:59:00Z'), TZ))).toBe(HOME); // 9:59 PM MST
    expect(scheduled(minutesOfDay(Date.parse('2026-11-02T05:00:00Z'), TZ))).toBe(NIGHT); // 10 PM MST
    // 2027-03-14: spring forward. 6:00 AM MDT = 12:00 UTC.
    expect(scheduled(minutesOfDay(Date.parse('2027-03-14T11:59:00Z'), TZ))).toBe(NIGHT);
    expect(scheduled(minutesOfDay(Date.parse('2027-03-14T12:00:00Z'), TZ))).toBe(HOME);
    expect(scheduled(minutesOfDay(Date.parse('2027-03-15T04:00:00Z'), TZ))).toBe(NIGHT); // 10 PM MDT
  });
});
