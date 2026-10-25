import { describe, it, expect } from 'vitest';
import { nextLine, allDayLine, agendaRows } from '../../frame/src/agenda.js';

const TZ = 'America/Denver';
const cal = {
  today: {
    allDay: [{ title: 'Holiday' }, { title: 'Trip' }],
    timed: [
      { title: 'Standup', start: '2026-10-24T15:00:00Z', end: '2026-10-24T15:30:00Z' },
      { title: 'Lunch', start: '2026-10-24T18:00:00Z', end: '2026-10-24T19:00:00Z' },
      { title: 'Dinner', start: '2026-10-25T00:00:00Z', end: '2026-10-25T01:30:00Z' },
    ],
  },
  tomorrowFirst: { title: 'Run', start: '2026-10-25T14:30:00Z' },
};

describe('agenda', () => {
  it('next line: upcoming, in progress, then tomorrow', () => {
    expect(nextLine(cal, Date.parse('2026-10-24T14:00:00Z'), TZ)).toBe('Next: Standup, 9:00 AM');
    expect(nextLine(cal, Date.parse('2026-10-24T18:15:00Z'), TZ)).toBe('Now: Lunch, until 1:00 PM');
    expect(nextLine(cal, Date.parse('2026-10-25T02:00:00Z'), TZ)).toBe('Tomorrow 8:30 AM · Run');
    expect(nextLine({ today: { allDay: [], timed: [] }, tomorrowFirst: null }, 0, TZ)).toBe('');
  });

  it('looks ahead past tomorrow when today and tomorrow are empty (v1.1)', () => {
    const empty = { today: { allDay: [], timed: [] }, tomorrowFirst: null };
    const now = Date.parse('2026-10-24T20:00:00Z');
    expect(nextLine(Object.assign({ ahead: { title: 'Dentist', start: '2026-11-03T16:00:00Z', allDay: false } }, empty), now, TZ)).toBe('Next: Tue, Nov 3, 9:00 AM · Dentist');
    expect(nextLine(Object.assign({ ahead: { title: 'Trip', start: '2026-11-01', allDay: true } }, empty), now, TZ)).toBe('Next: Sun, Nov 1 · Trip');
    // tomorrow still wins over the look-ahead
    expect(nextLine(Object.assign({}, empty, { tomorrowFirst: { title: 'Run', start: '2026-10-25T14:30:00Z' }, ahead: { title: 'X', start: '2026-11-03T16:00:00Z' } }), now, TZ)).toBe('Tomorrow 8:30 AM · Run');
  });

  it('all-day line', () => {
    expect(allDayLine(cal)).toBe('All day: Holiday · Trip');
    expect(allDayLine({ today: { allDay: [] } })).toBe('');
  });

  it('agenda rows with a +N more count', () => {
    const r = agendaRows(cal, Date.parse('2026-10-24T15:10:00Z'), TZ, 2);
    expect(r.rows.map((x) => x.title)).toEqual(['Standup', 'Lunch']);
    expect(r.rows[0].now).toBe(true);
    expect(r.more).toBe(1);
  });
});
