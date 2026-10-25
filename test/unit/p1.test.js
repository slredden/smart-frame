import { describe, it, expect } from 'vitest';
import { DEFAULTS, BOUNDS, SETTING_KEYS, validateSetting, mergeSettings, minutesLabel } from '../../shared/settings.js';
import { weekStart, viewWindow, stepAnchor, tint, layoutDay, agendaDays, dayLabel, agendaTime, DAY_GRID, MAX_COLS } from '../../frame/src/calendar-layout.js';
import { IDLE_STEPS, stepList, errorText, scheduleText } from '../../frame/src/screens/settings.js';
import { hm12, hourLabel, updatedLabel } from '../../frame/src/screens/weather.js';
import { createTapFilter, MOVE_SLOP } from '../../frame/src/idle.js';
import { startOfDayUtc } from '../../shared/time.js';

const TZ = 'America/Denver';

describe('settings validation (PLAN-v2.md §7.2)', () => {
  it('rejects unknown keys and fields, and non-object patches', () => {
    expect(validateSetting('secrets', { a: 1 }).error).toBe('unknown_key');
    expect(validateSetting('night', { dimPct: 30, extra: 1 }).error).toBe('unknown_field');
    expect(validateSetting('night', null).error).toBe('bad_value');
    expect(validateSetting('night', []).error).toBe('bad_value');
    expect(validateSetting('night', {}).error).toBe('bad_value');
  });

  it('merges a partial patch over the current value', () => {
    const cur = { dayStart: 420, nightStart: 1260 };
    expect(validateSetting('schedule', { nightStart: 1320 }, cur)).toEqual({ ok: true, value: { dayStart: 420, nightStart: 1320 } });
    expect(cur.nightStart).toBe(1260);
  });

  it('enforces every bound', () => {
    expect(validateSetting('schedule', { dayStart: 225 }).error).toBe('schedule_day_start');
    expect(validateSetting('schedule', { dayStart: 365 }).error).toBe('schedule_day_start'); // not a 15-min step
    expect(validateSetting('schedule', { nightStart: 1065 }).error).toBe('schedule_night_start');
    expect(validateSetting('schedule', { nightStart: 1455 }).error).toBe('schedule_night_start');
    expect(validateSetting('schedule', { dayStart: 600, nightStart: 1065 }).ok).toBe(false);
    expect(validateSetting('schedule', { dayStart: 600, nightStart: 1080 }).ok).toBe(true); // exactly 8 h
    expect(validateSetting('schedule', { dayStart: 615, nightStart: 1080 }).ok).toBe(false);
    expect(validateSetting('night', { dimPct: 14 }).error).toBe('night_dim_pct');
    expect(validateSetting('night', { dimPct: 61 }).error).toBe('night_dim_pct');
    expect(validateSetting('night', { dimPct: 15 }).ok).toBe(true);
    expect(validateSetting('idle', { minutes: 0 }).error).toBe('idle_minutes');
    expect(validateSetting('idle', { minutes: 61 }).error).toBe('idle_minutes');
    expect(validateSetting('idle', { minutes: 2.5 }).error).toBe('idle_minutes');
    expect(validateSetting('calendar', { view: 'month' }).error).toBe('calendar_view');
    expect(validateSetting('weather', { name: ' ' }).error).toBe('weather_name');
    expect(validateSetting('weather', { lat: 91 }).error).toBe('weather_lat');
    expect(validateSetting('weather', { lon: -181 }).error).toBe('weather_lon');
    expect(validateSetting('weather', { timeZone: '../etc' }).error).toBe('weather_time_zone');
  });

  it('can never lock the frame out: the worst valid schedule still has an 8-hour day', () => {
    const b = BOUNDS.schedule;
    for (let d = b.dayStart[0]; d <= b.dayStart[1]; d += b.step) {
      for (let n = b.nightStart[0]; n <= b.nightStart[1]; n += b.step) {
        const r = validateSetting('schedule', { dayStart: d, nightStart: n });
        if (r.ok) expect(n - d).toBeGreaterThanOrEqual(480);
      }
    }
  });

  it('rounds a weather location to city level (2 decimals)', () => {
    const r = validateSetting('weather', { name: ' Boulder ', lat: 40.014986, lon: -105.270546, timeZone: 'America/Denver' });
    expect(r.value).toEqual({ name: 'Boulder', lat: 40.01, lon: -105.27, timeZone: 'America/Denver' });
  });

  it('mergeSettings fills defaults and drops stored values that no longer validate', () => {
    const s = mergeSettings({ night: { dimPct: 99 }, idle: { minutes: 5, junk: 1 } });
    expect(Object.keys(s)).toEqual(SETTING_KEYS);
    expect(s.night).toEqual(DEFAULTS.night);
    expect(s.idle).toEqual({ minutes: 5 });
    expect(mergeSettings(null)).toEqual(DEFAULTS);
  });

  it('labels minutes past midnight', () => {
    expect(minutesLabel(360)).toBe('6:00 AM');
    expect(minutesLabel(1305)).toBe('9:45 PM');
    expect(minutesLabel(1440)).toBe('12:00 AM');
    expect(scheduleText({ dayStart: 360, nightStart: 1320 })).toBe('6:00 AM – 10:00 PM');
  });
});

describe('settings screen helpers', () => {
  it('steps idle minutes through the list, clamped at the ends', () => {
    expect(stepList(IDLE_STEPS, 10, 1)).toBe(15);
    expect(stepList(IDLE_STEPS, 10, -1)).toBe(5);
    expect(stepList(IDLE_STEPS, 7, 1)).toBe(10); // a value between steps snaps
    expect(stepList(IDLE_STEPS, 60, 1)).toBe(60);
    expect(stepList(IDLE_STEPS, 1, -1)).toBe(1);
  });

  it('has a plain-language error for every code, with a fallback', () => {
    expect(errorText('schedule_day_too_short')).toMatch(/8 hours/);
    expect(errorText('too_many_writes')).toMatch(/later/);
    expect(errorText('nope')).toBe("Couldn't save. Try again.");
  });
});

describe('calendar layout (PLAN-v2.md §3.2)', () => {
  const ev = (ymd, h, m, mins, title = 'Example') => {
    const s = startOfDayUtc(ymd, TZ) + (h * 60 + m) * 60000;
    return { title, start: new Date(s).toISOString(), end: new Date(s + mins * 60000).toISOString(), color: '#4285f4' };
  };

  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-24')).toBe('2026-10-19'); // Saturday
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
  });

  it('asks for the right window per view and steps by it', () => {
    expect(viewWindow('day', '2026-10-24')).toEqual({ from: '2026-10-24', days: 1 });
    expect(viewWindow('week', '2026-10-24')).toEqual({ from: '2026-10-19', days: 7 });
    expect(viewWindow('agenda', '2026-10-24')).toEqual({ from: '2026-10-24', days: 14 });
    expect(stepAnchor('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(stepAnchor('week', '2026-10-24', -1)).toBe('2026-10-17');
    expect(stepAnchor('agenda', '2026-10-24', 1)).toBe('2026-11-07');
  });

  it('tints Google colours as rgb() and falls back to neutral', () => {
    expect(tint('#ffffff', 1)).toBe('rgb(255, 255, 255)');
    expect(tint('#ffffff', 0, '#000000')).toBe('rgb(0, 0, 0)');
    expect(tint('#4285f4', 0.5, '#000000')).toBe('rgb(33, 67, 122)');
    expect(tint('red', 1)).toBe(tint('#8a96a3', 1));
  });

  it('puts overlapping events side by side and counts the rest as +n', () => {
    const d = '2026-10-24';
    const r = layoutDay([ev(d, 9, 0, 60), ev(d, 9, 30, 60), ev(d, 9, 45, 30), ev(d, 9, 50, 20), ev(d, 13, 0, 30)], d, TZ, DAY_GRID);
    const cluster = r.blocks.filter((b) => b.cols === MAX_COLS);
    expect(cluster.map((b) => b.col)).toEqual([0, 1, 2]);
    expect(r.more).toEqual([{ top: 9 * 60 - 360, n: 1 }]); // shown at the top of its cluster
    const lone = r.blocks.find((b) => b.top === 13 * 60 - 360);
    expect(lone.cols).toBe(1);
    expect(r.minutes).toBe(16 * 60);
  });

  it('reuses a free column, clips to the grid and counts events outside it', () => {
    const d = '2026-10-24';
    const r = layoutDay([ev(d, 9, 0, 30), ev(d, 9, 0, 120), ev(d, 9, 30, 30), ev(d, 5, 0, 30), ev(d, 5, 30, 60), ev(d, 22, 30, 30)], d, TZ, DAY_GRID);
    expect(r.outside).toEqual({ before: 1, after: 1 });
    const clipped = r.blocks.find((b) => b.top === 0);
    expect(clipped.height).toBe(30); // 5:30-6:30 clipped to 6:00
    const nine = r.blocks.filter((b) => b.top >= 180);
    expect(Math.max(...nine.map((b) => b.cols))).toBe(2);
  });

  it('handles the 25-hour fall-back day', () => {
    const d = '2026-11-01';
    const r = layoutDay([ev(d, 9, 0, 60)], d, TZ, DAY_GRID);
    // startOfDay + 9 h on a fall-back day is 8 AM wall time (the extra hour is at 1 AM).
    expect(r.blocks[0].top).toBe(8 * 60 - 360);
  });

  it('agenda keeps only loaded days with something on them', () => {
    const win = {
      days: [
        { ymd: '2026-10-24', loaded: true, allDay: [], timed: [{}] },
        { ymd: '2026-10-25', loaded: true, allDay: [], timed: [] },
        { ymd: '2026-10-26', loaded: false, allDay: [], timed: [] },
      ],
    };
    const r = agendaDays(win);
    expect(r.days.map((d) => d.ymd)).toEqual(['2026-10-24']);
    expect(r.unloaded).toBe(true);
    expect(agendaDays(null)).toEqual({ days: [], unloaded: false });
  });

  it('labels days and multi-day times', () => {
    expect(dayLabel('2026-10-24', '2026-10-24')).toBe('Today');
    expect(dayLabel('2026-10-25', '2026-10-24')).toBe('Tomorrow');
    expect(dayLabel('2026-10-27', '2026-10-24')).toBe('Tue Oct 27');
    const e = ev('2026-10-23', 22, 0, 13 * 60);
    expect(agendaTime(e, '2026-10-24', TZ)).toBe('until 11:00 AM');
    expect(agendaTime(e, '2026-10-23', TZ)).toBe('10:00 PM');
  });
});

describe('weather screen labels', () => {
  it('formats Open-Meteo local times', () => {
    expect(hm12('06:05')).toBe('6:05 AM');
    expect(hm12('18:00')).toBe('6:00 PM');
    expect(hm12(null)).toBe('–');
    expect(hourLabel('2026-10-24T00:00')).toBe('12 AM');
    expect(hourLabel('2026-10-24T13:00')).toBe('1 PM');
  });

  it('says how old the forecast is', () => {
    const now = Date.parse('2026-10-24T18:42:00Z');
    expect(updatedLabel(new Date(now - 30000).toISOString(), now)).toMatch(/just now/i);
    expect(updatedLabel(new Date(now - 120000).toISOString(), now)).toBe('Updated 2 min ago');
  });
});

describe('tap filter: drags are not taps', () => {
  const run = (dx) => {
    const f = createTapFilter();
    f({ type: 'start', touches: 1, x: 600, y: 400, t: 0 });
    return f({ type: 'end', touches: 0, changed: 1, x: 600 + dx, y: 400, t: 120 });
  };
  it('allows a little wobble but not a scroll', () => {
    expect(run(MOVE_SLOP)).toBe(true);
    expect(run(MOVE_SLOP + 1)).toBe(false);
    expect(run(-40)).toBe(false);
  });
});
