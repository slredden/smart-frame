import { describe, it, expect } from 'vitest';
import { normalizeEvents, calendarPayload } from '../../worker/src/google/calendar.js';
import { normalizeWeather } from '../../worker/src/weather.js';
import { validateGuide, currentWeek } from '../../shared/reflection.js';
import { describeItem } from '../../worker/src/google/picker.js';

const TZ = 'America/Denver';

describe('calendar normalize', () => {
  const items = [
    { summary: 'Keep', start: { dateTime: '2026-10-24T09:00:00-06:00' }, end: { dateTime: '2026-10-24T10:00:00-06:00' }, description: 'secret notes', location: 'somewhere' },
    { summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2026-10-24T11:00:00-06:00' }, end: { dateTime: '2026-10-24T12:00:00-06:00' } },
    { summary: 'Free', transparency: 'transparent', start: { dateTime: '2026-10-24T11:00:00-06:00' }, end: { dateTime: '2026-10-24T12:00:00-06:00' } },
    { summary: 'Declined', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-24T13:00:00-06:00' }, end: { dateTime: '2026-10-24T14:00:00-06:00' } },
    { summary: 'Office', eventType: 'workingLocation', start: { date: '2026-10-24' }, end: { date: '2026-10-25' } },
    { summary: 'Holiday', start: { date: '2026-10-24' }, end: { date: '2026-10-25' } },
    { start: { dateTime: '2026-10-25T08:30:00-06:00' }, end: { dateTime: '2026-10-25T09:00:00-06:00' } },
  ];

  it('keeps only title/start/end/allDay and drops hidden events', () => {
    const ev = normalizeEvents(items);
    expect(ev.map((e) => e.title)).toEqual(['Keep', 'Holiday', 'Busy']);
    for (const e of ev) expect(Object.keys(e).sort()).toEqual(['allDay', 'end', 'start', 'title']);
  });

  it('builds today plus tomorrow first', () => {
    const p = calendarPayload(normalizeEvents(items), Date.parse('2026-10-24T20:00:00Z'), TZ);
    expect(p.today.allDay).toEqual([{ title: 'Holiday' }]);
    expect(p.today.timed.map((e) => e.title)).toEqual(['Keep']);
    expect(p.tomorrowFirst).toEqual({ title: 'Busy', start: '2026-10-25T14:30:00.000Z' });
  });
});

describe('weather normalize', () => {
  it('shapes Open-Meteo data', () => {
    const w = normalizeWeather({
      current: { temperature_2m: 53.6, weather_code: 2, is_day: 1 },
      daily: { time: ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'], weather_code: [2, 61, 0, 71], temperature_2m_max: [60, 50, 62, 40], temperature_2m_min: [40, 35, 38, 25] },
    });
    expect(w.now.tempF).toBe(54);
    expect(w.today).toEqual({ hi: 60, lo: 40 });
    expect(w.next3).toHaveLength(3);
    expect(w.next3[0].icon).toBe('rain');
  });

  it('throws on a malformed body', () => {
    expect(() => normalizeWeather({})).toThrow();
  });
});

describe('reflection guide (synthetic)', () => {
  const g = {
    guide: { start: '2026-11-01', end: '2026-11-30' },
    weeks: [
      { n: 1, start: '2026-11-01', end: '2026-11-07', theme: 'Theme one', practice: 'Practice one' },
      { n: 2, start: '2026-11-08', end: '2026-11-14', theme: 'Theme two', practice: '' },
      { n: 3, start: '2026-11-15', end: '2026-11-21', theme: 'Theme three', practice: '' },
      { n: 4, start: '2026-11-22', end: '2026-11-30', theme: 'Theme four', practice: '' },
    ],
  };

  it('accepts 7-day blocks with a longer last week', () => {
    expect(validateGuide(g)).toEqual([]);
  });

  it('rejects gaps and bad numbering', () => {
    const bad = JSON.parse(JSON.stringify(g));
    bad.weeks[1].start = '2026-11-09';
    bad.weeks[2].n = 7;
    expect(validateGuide(bad)).toEqual(expect.arrayContaining(['week_2_start', 'week_3_number']));
  });

  it('picks the current week', () => {
    expect(currentWeek(g, '2026-11-29').n).toBe(4);
    expect(currentWeek(g, '2026-12-01')).toBe(null);
  });
});

describe('picker item', () => {
  it('orientation and month', () => {
    expect(describeItem({ createTime: '2019-06-02T10:00:00Z', mediaFile: { mediaFileMetadata: { width: 3000, height: 4000 } } })).toEqual({ w: 3000, h: 4000, orient: 'p', taken: '2019-06' });
  });
});
