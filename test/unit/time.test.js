import { describe, it, expect } from 'vitest';
import { ymdIn, minutesOfDay, addDays, daysBetween, startOfDayUtc, zoneOffsetMs } from '../../shared/time.js';

const TZ = 'America/Denver';

describe('time', () => {
  it('local date and minutes in Denver', () => {
    const t = Date.parse('2026-10-25T04:30:00Z'); // 10:30 PM MDT on the 24th
    expect(ymdIn(t, TZ)).toBe('2026-10-24');
    expect(minutesOfDay(t, TZ)).toBe(22 * 60 + 30);
  });

  it('offsets', () => {
    expect(zoneOffsetMs(Date.parse('2026-07-01T12:00:00Z'), TZ)).toBe(-6 * 3600000);
    expect(zoneOffsetMs(Date.parse('2026-12-01T12:00:00Z'), TZ)).toBe(-7 * 3600000);
  });

  it('start of day across DST', () => {
    expect(new Date(startOfDayUtc('2026-11-01', TZ)).toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(new Date(startOfDayUtc('2026-11-02', TZ)).toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(new Date(startOfDayUtc('2027-03-14', TZ)).toISOString()).toBe('2027-03-14T07:00:00.000Z');
    expect(new Date(startOfDayUtc('2027-03-15', TZ)).toISOString()).toBe('2027-03-15T06:00:00.000Z');
  });

  it('date arithmetic', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-10-24', '2026-11-07')).toBe(14);
  });
});
