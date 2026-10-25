// Example data for `?mock=1` (local development and the Chromium 106 smoke test).
// Everything here is made up; no real calendar, photos or reflection text.
import { ymdIn, addDays, startOfDayUtc, minutesOfDay } from '../../shared/time.js';
import { describeWeather } from '../../shared/weather-codes.js';
import { DEFAULTS, validateSetting } from '../../shared/settings.js';
import { weekStart } from './calendar-layout.js';

const at = (ymd, tz, h, m) => new Date(startOfDayUtc(ymd, tz) + (h * 60 + m) * 60000).toISOString();

// Tiny solid-color blur placeholders (real ones are 32×20 JPEG thumbnails from the Worker).
const blur = (c) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="' + c + '"/></svg>');

// Mock settings live in memory so the Settings sheets can be exercised end to end.
let mockSettings = JSON.parse(JSON.stringify(DEFAULTS));

export function mockState(nowMs, tz, base = '') {
  const today = ymdIn(nowMs, tz);
  const tomorrow = addDays(today, 1);
  const fetchedAt = new Date(nowMs - 120000).toISOString();
  const now = describeWeather(2, true);
  const dow = (n) => addDays(today, n);
  return {
    build: 'dev',
    serverTime: new Date(nowMs).toISOString(),
    config: { idleMinutes: mockSettings.idle.minutes, photoIntervalSec: 60, timeZone: tz },
    features: { calendar: true, tasks: false, weather: true, photos: false, reflection: false, controls: false },
    settings: JSON.parse(JSON.stringify(mockSettings)),
    weather: {
      fetchedAt,
      stale: false,
      now: { tempF: 54, code: 2, isDay: true, label: now.label, icon: now.icon },
      today: { hi: 61, lo: 38 },
      place: { name: mockSettings.weather.name, lat: mockSettings.weather.lat, lon: mockSettings.weather.lon, timeZone: mockSettings.weather.timeZone },
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

const CALS = [
  { id: 'c1', summary: 'Example personal', color: '#4285f4', primary: true, selected: true },
  { id: 'c2', summary: 'Example family', color: '#33b679', primary: false, selected: true },
  { id: 'c3', summary: 'Example holidays', color: '#f6bf26', primary: false, selected: false },
];

/** Made-up events from a week ago to 3 weeks out, with overlaps for the Day/Week layout. */
export function mockEvents(nowMs, tz) {
  const today = ymdIn(nowMs, tz);
  const ev = [];
  const timed = (d, h, m, mins, title, cal) => {
    const s = startOfDayUtc(d, tz) + (h * 60 + m) * 60000;
    ev.push({ title, start: new Date(s).toISOString(), end: new Date(s + mins * 60000).toISOString(), allDay: false, color: CALS[cal].color });
  };
  for (let i = -7; i < 21; i++) {
    const d = addDays(today, i);
    if (i % 7 === 0) ev.push({ title: 'Example all-day event', start: d, end: addDays(d, 1), allDay: true, color: CALS[1].color });
    if (i % 2 === 0) timed(d, 7, 30, 45, 'Morning walk', 1);
    timed(d, 9, 0, 60, 'Example meeting', 0);
    if (i % 3 === 0) timed(d, 9, 30, 60, 'Overlapping call', 0);
    if (i % 3 === 0) timed(d, 9, 45, 30, 'Third overlap', 1);
    if (i % 6 === 0) timed(d, 9, 50, 20, 'Fourth overlap', 1);
    timed(d, 12, 30, 60, 'Lunch out', 1);
    if (i % 2 === 1) timed(d, 15, 0, 90, 'Example appointment', 0);
    timed(d, 18, 0, 90, 'Family dinner', 1);
  }
  ev.sort((a, b) => (a.start < b.start ? -1 : 1));
  return ev;
}

function mockWindow(nowMs, tz, from, days) {
  const today = ymdIn(nowMs, tz);
  const loadedFrom = weekStart(today);
  const loadedTo = addDays(today, 30);
  const all = mockEvents(nowMs, tz);
  const out = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDays(from, i);
    const loaded = ymd >= loadedFrom && ymd < loadedTo;
    const s0 = startOfDayUtc(ymd, tz);
    const s1 = startOfDayUtc(addDays(ymd, 1), tz);
    out.push({
      ymd,
      loaded,
      allDay: loaded ? all.filter((e) => e.allDay && e.start <= ymd && e.end > ymd).map((e) => ({ title: e.title, color: e.color })) : [],
      timed: loaded ? all.filter((e) => !e.allDay && Date.parse(e.start) < s1 && Date.parse(e.end) > s0).map((e) => ({ title: e.title, start: e.start, end: e.end, color: e.color })) : [],
    });
  }
  return { from, days: out, loadedFrom, loadedTo, next: null };
}

function mockWeather(nowMs, tz) {
  const base = mockState(nowMs, tz).weather;
  const icons = ['clear', 'partly', 'cloud', 'rain', 'snow', 'partly', 'clear', 'fog', 'storm', 'cloud'];
  const today = ymdIn(nowMs, tz);
  const h0 = Math.floor(minutesOfDay(nowMs, tz) / 60);
  const hourly = [];
  for (let i = 0; i < 24; i++) {
    const hh = (h0 + i) % 24;
    const d = addDays(today, Math.floor((h0 + i) / 24));
    hourly.push({ t: d + 'T' + String(hh).padStart(2, '0') + ':00', f: 40 + Math.round(14 * Math.sin((hh - 9) / 4)), p: (i * 7) % 60, i: hh < 7 || hh > 18 ? 'clear-night' : icons[i % 4], w: 4 + (i % 9) });
  }
  const daily = [];
  for (let i = 0; i < 10; i++) daily.push({ ymd: addDays(today, i), hi: 50 + ((i * 5) % 17), lo: 30 + ((i * 3) % 11), i: icons[i], p: (i * 13) % 90, w: 8 + i, rise: '07:2' + (i % 10), set: '18:0' + (i % 10) });
  return Object.assign(base, { hourly, daily });
}

const PLACES = [
  { name: 'Boulder', admin1: 'Colorado', country: 'United States', lat: 40.01, lon: -105.27, timeZone: 'America/Denver' },
  { name: 'Boulder City', admin1: 'Nevada', country: 'United States', lat: 35.98, lon: -114.83, timeZone: 'America/Los_Angeles' },
];

/** Same surface as api.createClient, answered from memory (for ?mock=1 and the e2e test). */
export function createMockClient(now, tz) {
  const ok = (data) => Promise.resolve({ status: 200, data });
  return {
    state: () => ok(mockState(now(), tz)),
    heartbeat: () => ok({ ok: true }),
    calendar: (from, days) => ok(mockWindow(now(), tz, from, days)),
    weather: () => ok({ weather: mockWeather(now(), tz) }),
    calendars: () => ok({ calendars: CALS.map((c) => Object.assign({}, c)), max: 10 }),
    syncCalendars: () => ok({ calendars: CALS.map((c) => Object.assign({}, c)), max: 10 }),
    saveSelection: (ids) => {
      for (const c of CALS) c.selected = ids.indexOf(c.id) >= 0;
      return ok({ ok: true, selected: ids.length, refreshed: true, calendars: CALS.map((c) => Object.assign({}, c)) });
    },
    saveSetting: (key, patch) => {
      const r = validateSetting(key, patch, mockSettings[key]);
      if (!r.ok) return Promise.resolve({ status: 400, data: { error: r.error } });
      mockSettings[key] = r.value;
      return ok({ ok: true, settings: JSON.parse(JSON.stringify(mockSettings)) });
    },
    searchPlaces: (q) => ok({ places: PLACES.filter((p) => p.name.toLowerCase().indexOf(q.toLowerCase()) === 0) }),
  };
}
