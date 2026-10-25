import { describe, it, expect } from 'vitest';
import { reflectionFreshness } from '../../shared/reflection.js';
import { addDays, ymdIn } from '../../shared/time.js';

// Synthetic guides: dates only (freshness never reads text).
function guideOf(start, weekLens) {
  const weeks = [];
  let s = start;
  weekLens.forEach((len, i) => {
    const end = addDays(s, len - 1);
    weeks.push({ n: i + 1, start: s, end });
    s = addDays(end, 1);
  });
  return { guide: { start, end: weeks[weeks.length - 1].end }, weeks };
}
const four = guideOf('2026-10-04', [7, 7, 7, 7]); // 10-04 .. 10-31, 28 days
const five = guideOf('2026-10-04', [7, 7, 7, 7, 7]); // 10-04 .. 11-07, 35 days
const eight = guideOf('2026-10-04', [7, 7, 7, 7, 7, 7, 7, 7]); // 10-04 .. 11-28, 56 days
const longLast = guideOf('2026-10-04', [7, 7, 7, 12]); // last week 10-25 .. 11-05

const at = (guides, today) => reflectionFreshness(guides, today);

describe('reflection freshness (PLAN-v2 §8.5)', () => {
  it('empty DB: both stale, nothing to report', () => {
    expect(at([], '2026-10-24')).toEqual({
      weekly: { start: null, ageDays: null, stale: true },
      monthly: { start: null, end: null, ageDays: null, stale: true },
    });
    expect(at(undefined, '2026-10-24').weekly.stale).toBe(true);
  });

  it('weekly: day 8 after the newest week start is fresh, day 9 is stale', () => {
    // Week 4 starts 10-25. Past the guide end (10-31) nothing newer starts.
    expect(at([four], '2026-11-02').weekly).toEqual({ start: '2026-10-25', ageDays: 8, stale: false });
    expect(at([four], '2026-11-03').weekly).toEqual({ start: '2026-10-25', ageDays: 9, stale: true });
    // Mid-guide the current week is always fresh.
    expect(at([four], '2026-10-20').weekly).toEqual({ start: '2026-10-18', ageDays: 2, stale: false });
  });

  it('a 12-day last week anchors on its final 7-day stretch', () => {
    // anchor = max(10-25, 11-05 - 6 = 10-30): fresh through 11-07, stale on 11-08.
    expect(at([longLast], '2026-11-04').weekly.stale).toBe(false); // 10 days after start, still in the week
    expect(at([longLast], '2026-11-07').weekly).toEqual({ start: '2026-10-25', ageDays: 8, stale: false });
    expect(at([longLast], '2026-11-08').weekly).toEqual({ start: '2026-10-25', ageDays: 9, stale: true });
  });

  it('monthly: 35 days for 4- and 5-week guides', () => {
    expect(at([four], '2026-11-08').monthly).toEqual({ start: '2026-10-04', end: '2026-10-31', ageDays: 35, stale: false });
    expect(at([four], '2026-11-09').monthly.stale).toBe(true);
    // 5-week (35-day) guide: still covers 11-07, and isn't monthly-stale until day 36.
    expect(at([five], '2026-11-07').monthly.stale).toBe(false);
    expect(at([five], '2026-11-07').weekly.stale).toBe(false);
    expect(at([five], '2026-11-08').monthly).toEqual({ start: '2026-10-04', end: '2026-11-07', ageDays: 35, stale: false });
    expect(at([five], '2026-11-09').monthly).toEqual({ start: '2026-10-04', end: '2026-11-07', ageDays: 36, stale: true });
  });

  it('monthly: an 8-week guide is not stale while it covers today', () => {
    expect(at([eight], '2026-11-28').monthly).toEqual({ start: '2026-10-04', end: '2026-11-28', ageDays: 55, stale: false });
    expect(at([eight], '2026-11-28').weekly.stale).toBe(false);
    expect(at([eight], '2026-11-29').monthly.stale).toBe(false); // 56 = guideDays
    expect(at([eight], '2026-11-30').monthly.stale).toBe(true);
  });

  it('a gap between guides goes weekly-stale before monthly-stale', () => {
    const next = guideOf('2026-11-15', [7, 7, 7, 7]);
    // Between 10-31 and 11-15 nothing covers today.
    expect(at([four, next], '2026-11-03').weekly.stale).toBe(true);
    expect(at([four, next], '2026-11-03').monthly.stale).toBe(false);
    expect(at([four, next], '2026-11-15').weekly).toEqual({ start: '2026-11-15', ageDays: 0, stale: false });
    expect(at([four, next], '2026-11-15').monthly.start).toBe('2026-11-15');
  });

  it('ignores a guide that starts in the future (published early)', () => {
    const early = guideOf('2026-11-01', [7, 7, 7, 7]);
    const r = at([four, early], '2026-10-27');
    expect(r.monthly.start).toBe('2026-10-04');
    expect(r.weekly.start).toBe('2026-10-25');
    expect(at([early], '2026-10-27')).toEqual({
      weekly: { start: null, ageDays: null, stale: true },
      monthly: { start: null, end: null, ageDays: null, stale: true },
    });
  });

  it('two overlapping guides: the newest start wins for both checks', () => {
    const overlap = guideOf('2026-10-20', [7, 7, 7, 7]);
    const r = at([overlap, four], '2026-10-22');
    expect(r.monthly.start).toBe('2026-10-20');
    expect(r.weekly.start).toBe('2026-10-20');
    expect(at([four, overlap], '2026-10-26').weekly.start).toBe('2026-10-25'); // four's week 4 starts later
  });

  it('counts Denver calendar days across the DST change', () => {
    // 2026-11-01 falls back. Week 4 of `four` starts 10-25; day 9 is 11-03 in Denver.
    const late = Date.parse('2026-11-03T06:30:00Z'); // 11:30 PM MST on 11-02
    expect(ymdIn(late, 'America/Denver')).toBe('2026-11-02');
    expect(at([four], ymdIn(late, 'America/Denver')).weekly.stale).toBe(false);
    const after = Date.parse('2026-11-03T07:00:00Z'); // 12:00 AM MST on 11-03
    expect(at([four], ymdIn(after, 'America/Denver')).weekly).toEqual({ start: '2026-10-25', ageDays: 9, stale: true });
  });
});
