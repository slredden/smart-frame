// Example data for `?mock=1` (local development and the Chromium 106 smoke test).
// Everything here is made up; no real calendar, photos or reflection text.
import { ymdIn, addDays, startOfDayUtc, minutesOfDay } from '../../shared/time.js';
import { describeWeather } from '../../shared/weather-codes.js';
import { DEFAULTS, validateSetting } from '../../shared/settings.js';
import { weekStart } from './calendar-layout.js';
import { reflectionView } from '../../shared/reflection.js';

const at = (ymd, tz, h, m) => new Date(startOfDayUtc(ymd, tz) + (h * 60 + m) * 60000).toISOString();

// Tiny solid-color blur placeholders (real ones are 32×20 JPEG thumbnails from the Worker).
const blur = (c) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="' + c + '"/></svg>');

// Mock settings live in memory so the Settings sheets can be exercised end to end.
let mockSettings = JSON.parse(JSON.stringify(DEFAULTS));

/** Mock switches set by main.js from the URL (?tasks=noscope) and a log of writes for the e2e test. */
export const mockConfig = {
  tasksScope: true,
  calls: [],
  // P2 Controls: ?spotify=off|idle, ?cams=off|offline|none; spotifyFail makes the next Spotify write fail;
  // camAt holds each camera's last picture time (the e2e test moves it to make a new picture).
  spotify: 'on',
  cams: 'on',
  spotifyFail: null,
  camAt: {},
  // P2.1 Recent sheet: ?recent=consent|short|busy (default: 10 recent, 20 playlists); ?sheetidle=ms
  // shortens the sheet's 30 s auto-close for the e2e test.
  recent: 'on',
};

const LISTS = [
  { id: 'l1', title: 'Example list', selected: true, default: true },
  { id: 'l2', title: 'Example errands', selected: true, default: false },
  { id: 'l3', title: 'Example someday', selected: false, default: false },
];
const done = {}; // 'list/task' marked complete in this session
const flags = {}; // photo id -> {favorite, hidden}
flags['3'] = { favorite: true, hidden: false };

/** Made-up tasks relative to today: overdue, today (with a subtask), upcoming, no date. */
export function mockTasks(nowMs, tz) {
  const today = ymdIn(nowMs, tz);
  const d = (n) => addDays(today, n);
  const all = [
    { id: 't1', list: 'l1', title: 'Example overdue task', due: d(-2), pos: '001' },
    { id: 't2', list: 'l1', title: 'Example task due today', due: today, pos: '002' },
    { id: 't3', list: 'l1', title: 'Example subtask', due: today, pos: '000', parent: 't2' },
    { id: 't4', list: 'l2', title: 'Example errand today', due: today, pos: '001' },
    { id: 't5', list: 'l2', title: 'Example errand in two days', due: d(2), pos: '002' },
    { id: 't6', list: 'l1', title: 'Example task next month', due: d(12), pos: '003' },
    { id: 't7', list: 'l1', title: 'Example task with no date', due: null, pos: '004' },
    { id: 't8', list: 'l2', title: 'Example errand with no date', due: null, pos: '003' },
  ];
  const shown = {};
  for (const l of LISTS) if (l.selected) shown[l.id] = true;
  return all.filter((t) => shown[t.list] && !done[t.list + '/' + t.id]);
}

function mockTasksSummary(nowMs, tz) {
  if (!mockConfig.tasksScope) return { scope: false, dueToday: [], dueCount: 0, overdue: 0, fetchedAt: null };
  const today = ymdIn(nowMs, tz);
  const t = mockTasks(nowMs, tz);
  const due = t.filter((x) => x.due === today);
  return { scope: true, dueToday: due.slice(0, 5).map((x) => x.title), dueCount: due.length, overdue: t.filter((x) => x.due && x.due < today).length, fetchedAt: new Date(nowMs - 120000).toISOString() };
}

/** Timed events in the next 24 h (the Worker's `soon` list); `na` when the calendar's alerts are off. */
function mockSoon(nowMs, tz) {
  const byColor = {};
  for (const c of CALS) byColor[c.color] = c;
  return mockEvents(nowMs, tz)
    .filter((e) => !e.allDay && Date.parse(e.end) > nowMs && Date.parse(e.start) < nowMs + 86400000)
    .filter((e) => byColor[e.color] && byColor[e.color].selected)
    .map((e) => {
      const o = { title: e.title, start: e.start, end: e.end, color: e.color };
      if (byColor[e.color].alert === false) o.na = true;
      return o;
    });
}

/** Made-up guides: the current one (started two weeks before this week) and two earlier ones. */
function mockGuides(nowMs, tz) {
  const ws = weekStart(ymdIn(nowMs, tz));
  const guide = (start, label) => ({
    guide: { start, end: addDays(start, 34) },
    weeks: [1, 2, 3, 4, 5].map((n) => ({
      n,
      start: addDays(start, (n - 1) * 7),
      end: addDays(start, n * 7 - 1),
      theme: 'Example theme ' + label + n,
      practice: 'Example practice for week ' + n + '. A few made-up sentences so the screen can show a longer practice, wrapped across lines the way a real one would be.',
    })),
  });
  return [guide(addDays(ws, -14), ''), guide(addDays(ws, -49), 'B'), guide(addDays(ws, -84), 'C')];
}

export function mockState(nowMs, tz, base = '') {
  const today = ymdIn(nowMs, tz);
  const tomorrow = addDays(today, 1);
  const fetchedAt = new Date(nowMs - 120000).toISOString();
  const now = describeWeather(2, true);
  const dow = (n) => addDays(today, n);
  return {
    build: 'dev',
    serverTime: new Date(nowMs).toISOString(),
    config: { idleMinutes: mockSettings.idle.minutes, photoIntervalSec: mockSettings.photos.intervalSec, timeZone: tz },
    features: { calendar: true, tasks: true, weather: true, photos: true, reflection: true, controls: true },
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
      soon: mockSoon(nowMs, tz),
    },
    tasks: mockTasksSummary(nowMs, tz),
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
      ]
        .filter((it) => !(flags[it.id] && flags[it.id].hidden))
        .map((it) => (flags[it.id] && flags[it.id].favorite ? Object.assign(it, { fav: true }) : it)),
    },
  };
}

const CALS = [
  { id: 'c1', summary: 'Example personal', color: '#4285f4', primary: true, selected: true, alert: true },
  { id: 'c2', summary: 'Example family', color: '#33b679', primary: false, selected: true, alert: true },
  { id: 'c3', summary: 'Example holidays', color: '#f6bf26', primary: false, selected: false, alert: true },
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

// ----- P2 Controls (made-up speakers and cameras) -----
const SPEAKERS = [
  { id: 'd1', name: 'Example speaker', type: 'Speaker' },
  { id: 'd2', name: 'Example office', type: 'Speaker' },
  { id: 'd3', name: 'Example TV', type: 'TV' },
];
const SONGS = [
  { title: 'Example song', artists: 'Example artist' },
  { title: 'Another example', artists: 'Example band' },
  { title: 'Third example', artists: 'Example trio' },
];
const sp = { playing: true, song: 0, device: 'd1', volume: 40, last: 'Example office' };
// Outdoor first in the reply (the Worker sorts by indoor, then position); ages in seconds.
const CAMS = [
  { id: 'c1', label: 'Front door', indoor: false, age: 40 },
  { id: 'c2', label: 'Driveway', indoor: false, age: 1500 },
  { id: 'c3', label: 'Living room', indoor: true, age: 20 },
  { id: 'c4', label: 'Basement', indoor: true, age: 70 },
];

function spotifyStateMock(devices) {
  if (mockConfig.spotify === 'off') return { connected: false, reason: 'not_connected' };
  const idle = mockConfig.spotify === 'idle';
  const dev = idle ? null : SPEAKERS.find((d) => d.id === sp.device);
  const list = (idle ? SPEAKERS.slice(0, 1) : SPEAKERS).map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!dev && dev.id === d.id, remembered: d.name === sp.last }));
  return {
    connected: true,
    playing: !idle && sp.playing,
    item: idle ? null : { title: SONGS[sp.song].title, artists: SONGS[sp.song].artists, art: null },
    device: dev ? { id: dev.id, name: dev.name, type: dev.type, volume: sp.volume } : null,
    devices: list,
    lastDevice: sp.last,
    fresh: !!devices,
  };
}

// Offline art for the e2e test (the Worker only ever sends https://i.scdn.co/ art).
const mockArt = (hue) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(' + hue + ',45%,45%)"/></svg>');
const MOCK_TYPES = ['playlist', 'album', 'artist', 'album', 'playlist'];
const mockId = (tag, n) => (tag + String(n).padStart(4, '0')).padEnd(22, 'x');
function spotifyRecentMock() {
  mockConfig.calls.push({ m: 'spotifyRecent' });
  if (mockConfig.spotify === 'off') return { status: 200, data: { connected: false, reason: 'not_connected' } };
  if (mockConfig.recent === 'consent') return { status: 409, data: { error: 'needs_consent' } };
  if (mockConfig.recent === 'busy') return { status: 429, data: { error: 'spotify_busy', retryAfter: 7 } };
  const playlists = Array.from({ length: 20 }, (_, i) => ({ uri: 'spotify:playlist:' + mockId('pl', i + 1), type: 'playlist', name: 'Example playlist ' + (i + 1), image: i % 4 === 3 ? null : mockArt(i * 17) }));
  const n = mockConfig.recent === 'short' ? 3 : 10;
  const recent = Array.from({ length: n }, (_, i) => {
    const type = MOCK_TYPES[i % MOCK_TYPES.length];
    return { uri: 'spotify:' + type + ':' + mockId(type.slice(0, 2), i + 1), type, name: 'Example ' + type + ' ' + (i + 1) + (i === 1 ? ' with a much longer name that has to wrap or clip' : ''), image: mockArt(200 + i * 13) };
  });
  return { status: 200, data: { connected: true, recent, playlists } };
}

function spotifyActionMock(action, body) {
  mockConfig.calls.push({ m: 'spotify', action, body });
  if (mockConfig.spotify === 'off') return { status: 409, data: { error: 'not_connected' } };
  if (mockConfig.spotifyFail) {
    const e = mockConfig.spotifyFail;
    mockConfig.spotifyFail = null;
    return { status: e === 'spotify_busy' ? 429 : 403, data: { error: e } };
  }
  if (mockConfig.spotify === 'idle' && action === 'play') return { status: 409, data: { error: 'device_absent', name: sp.last, devices: SPEAKERS.slice(0, 1).map((d) => ({ id: d.id, name: d.name, type: d.type })) } };
  if (action === 'play') sp.playing = true;
  else if (action === 'pause') sp.playing = false;
  else if (action === 'next') sp.song = (sp.song + 1) % SONGS.length;
  else if (action === 'prev') sp.song = (sp.song + SONGS.length - 1) % SONGS.length;
  else if (action === 'volume') sp.volume = body.volume;
  else if (action === 'transfer') {
    const d = SPEAKERS.find((x) => x.id === body.device_id);
    if (!d) return { status: 400, data: { error: 'unknown_device' } };
    sp.device = d.id;
    sp.last = d.name;
    if (mockConfig.spotify === 'idle') mockConfig.spotify = 'on';
  }
  return { status: 200, data: { ok: true } };
}

function camAt(c, nowMs) {
  if (!mockConfig.camAt[c.id]) mockConfig.camAt[c.id] = new Date(nowMs - c.age * 1000).toISOString();
  return mockConfig.camAt[c.id];
}

function controlsStateMock(nowMs) {
  mockConfig.calls.push({ m: 'controlsState' });
  if (mockConfig.cams === 'off') return { status: 200, data: { connected: false, reason: 'not_connected', cams: [] } };
  if (mockConfig.cams === 'offline') return { status: 503, data: { error: 'ha_unreachable' } };
  const indoorOn = !!mockSettings.controls.indoor;
  const cams = mockConfig.cams === 'none' ? [] : CAMS.map((c) => (c.indoor && !indoorOn ? { id: c.id, label: c.label, indoor: true, off: true } : { id: c.id, label: c.label, indoor: c.indoor, updated: camAt(c, nowMs), available: true }));
  return { status: 200, data: { connected: true, indoorOn, revealSec: mockSettings.controls.revealSec, cams } };
}

const CAM_COLORS = { c1: '#3b5d7a', c2: '#5c6b3a', c3: '#7a4f3b', c4: '#4f3b7a' };

function camImageMock(id, reveal) {
  mockConfig.calls.push({ m: 'camImage', id, reveal: !!reveal });
  const c = CAMS.find((x) => x.id === id);
  if (!c) return { status: 404, blob: null };
  if (c.indoor && (!mockSettings.controls.indoor || !reveal)) return { status: 403, blob: null };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="' + CAM_COLORS[id] + '"/><text x="32" y="64" font-size="36" fill="#fff" font-family="sans-serif">Example ' + c.label + '</text></svg>';
  return { status: 200, blob: new Blob([svg], { type: 'image/svg+xml' }) };
}

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
    saveSelection: (ids, alertsOff) => {
      mockConfig.calls.push({ m: 'saveSelection', ids, alertsOff: alertsOff || [] });
      for (const c of CALS) {
        c.selected = ids.indexOf(c.id) >= 0;
        c.alert = !(alertsOff && alertsOff.indexOf(c.id) >= 0);
      }
      return ok({ ok: true, selected: ids.length, refreshed: true, calendars: CALS.map((c) => Object.assign({}, c)) });
    },
    saveSetting: (key, patch) => {
      const r = validateSetting(key, patch, mockSettings[key]);
      if (!r.ok) return Promise.resolve({ status: 400, data: { error: r.error } });
      mockSettings[key] = r.value;
      return ok({ ok: true, settings: JSON.parse(JSON.stringify(mockSettings)) });
    },
    searchPlaces: (q) => ok({ places: PLACES.filter((p) => p.name.toLowerCase().indexOf(q.toLowerCase()) === 0) }),
    tasks: () =>
      ok(
        mockConfig.tasksScope
          ? { scope: true, lists: LISTS.filter((l) => l.selected).map((l) => ({ id: l.id, title: l.title })), tasks: mockTasks(now(), tz), fetchedAt: new Date(now() - 120000).toISOString(), stale: false }
          : { scope: false, lists: [], tasks: [], fetchedAt: null, stale: false },
      ),
    tasklists: () => ok({ lists: mockConfig.tasksScope ? LISTS.map((l) => Object.assign({}, l)) : [], max: 10, scope: mockConfig.tasksScope }),
    syncTaskLists: () => (mockConfig.tasksScope ? ok({ lists: LISTS.map((l) => Object.assign({}, l)), max: 10 }) : Promise.resolve({ status: 409, data: { error: 'tasks_scope_missing' } })),
    saveTaskLists: (ids) => {
      mockConfig.calls.push({ m: 'saveTaskLists', ids });
      if (ids.length > 10) return Promise.resolve({ status: 400, data: { error: 'too_many_lists' } });
      for (const l of LISTS) l.selected = ids.indexOf(l.id) >= 0;
      return ok({ ok: true, selected: ids.length, refreshed: true, lists: LISTS.map((l) => Object.assign({}, l)) });
    },
    completeTask: (list, task) => {
      mockConfig.calls.push({ m: 'completeTask', list, task });
      done[list + '/' + task] = true;
      return ok({ ok: true });
    },
    reflection: () => ok(reflectionView(mockGuides(now(), tz), ymdIn(now(), tz))),
    photoFlag: (setId, n, patch) => {
      mockConfig.calls.push({ m: 'photoFlag', setId, n: String(n), patch });
      const f = flags[String(n)] || (flags[String(n)] = { favorite: false, hidden: false });
      Object.assign(f, patch);
      return ok({ ok: true });
    },
    spotifyState: (devices) => ok(spotifyStateMock(devices)),
    spotifyAction: (action, body) => Promise.resolve(spotifyActionMock(action, body || {})),
    spotifyRecent: () => Promise.resolve(spotifyRecentMock()),
    controlsState: () => Promise.resolve(controlsStateMock(now())),
    camImage: (id, reveal) => Promise.resolve(camImageMock(id, reveal)),
  };
}
