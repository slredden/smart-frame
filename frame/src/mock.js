// Example data for `?mock=1` (local development and the Chromium 106 smoke test).
// Everything here is made up; no real calendar, photos or reflection text.
import { ymdIn, addDays, startOfDayUtc } from '../../shared/time.js';
import { describeWeather } from '../../shared/weather-codes.js';

const at = (ymd, tz, h, m) => new Date(startOfDayUtc(ymd, tz) + (h * 60 + m) * 60000).toISOString();

// Tiny solid-color blur placeholders (real ones are 32×20 JPEG thumbnails from the Worker).
const blur = (c) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="' + c + '"/></svg>');

export function mockState(nowMs, tz, base = '') {
  const today = ymdIn(nowMs, tz);
  const tomorrow = addDays(today, 1);
  const fetchedAt = new Date(nowMs - 120000).toISOString();
  const now = describeWeather(2, true);
  const dow = (n) => addDays(today, n);
  return {
    build: 'dev',
    serverTime: new Date(nowMs).toISOString(),
    config: { idleMinutes: 10, photoIntervalSec: 60, timeZone: tz },
    weather: {
      fetchedAt,
      stale: false,
      now: { tempF: 54, code: 2, isDay: true, label: now.label, icon: now.icon },
      today: { hi: 61, lo: 38 },
      next3: [
        { ymd: dow(1), hi: 58, lo: 36, code: 1, icon: 'partly' },
        { ymd: dow(2), hi: 49, lo: 31, code: 71, icon: 'snow' },
        { ymd: dow(3), hi: 62, lo: 40, code: 0, icon: 'clear' },
      ],
    },
    calendar: {
      fetchedAt,
      stale: false,
      today: {
        allDay: [{ title: 'Example all-day event' }],
        timed: [
          { title: 'Morning walk', start: at(today, tz, 7, 30), end: at(today, tz, 8, 15) },
          { title: 'Example meeting', start: at(today, tz, 9, 0), end: at(today, tz, 10, 0) },
          { title: 'Lunch out', start: at(today, tz, 12, 30), end: at(today, tz, 13, 30) },
          { title: 'Family dinner', start: at(today, tz, 18, 0), end: at(today, tz, 19, 30) },
        ],
      },
      tomorrowFirst: { title: 'Example appointment', start: at(tomorrow, tz, 8, 30) },
    },
    reflection: { n: 1, theme: 'Example theme for the week', practice: 'An example practice line, short enough to read from across the room.' },
    photos: {
      setId: 'mock',
      items: [
        { id: '1', url: base + 'mock/1.svg', blur: blur('#8a6a6a'), orient: 'l', taken: '2019-06' },
        { id: '2', url: base + 'mock/2.svg', blur: blur('#6f8f5a'), orient: 'p', taken: '2021-09-14' },
        { id: '3', url: base + 'mock/3.svg', blur: blur('#a16c9f'), orient: 'l', taken: '2015-12' },
        { id: '4', url: base + 'mock/4.svg', blur: blur('#b58a3a'), orient: 'p', taken: '' },
        { id: '5', url: base + 'mock/5.svg', blur: blur('#3f8784'), orient: 'l', taken: '2023-03' },
        { id: '6', url: base + 'mock/6.svg', blur: blur('#808080'), orient: 'l', taken: '2010-07' },
      ],
    },
  };
}
