// Frame entry point. Wires the pure modules to the DOM and timers.
import { minutesOfDay, ymdIn } from '../../shared/time.js';
import * as nav from './nav.js';
import { attachTaps } from './idle.js';
import { setBacklight } from './backlight.js';
import { clockParts, longDate, temp, weekdayShort, staleLabel } from './format.js';
import { nextLine, allDayLine, agendaRows } from './agenda.js';
import { takeToken, createClient, backoffMs, saveSnapshot, loadSnapshot } from './api.js';
import { buildChanged, quietMoment, dailyReloadDue, RELOAD_KEY } from './version.js';
import { createSlideshow } from './photos.js';
import { mockState, createMockClient } from './mock.js';
import { mergeSettings } from '../../shared/settings.js';
import { createRail } from './rail.js';
import { createSheet } from './sheet.js';
import { createCalendarScreen } from './screens/calendar.js';
import { createWeatherScreen } from './screens/weather.js';
import { createSettingsScreen, openCalendarsSheet } from './screens/settings.js';

const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const TZ = 'America/Denver';
const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1';
const ICON_BASE = './icons/';

// Mock-only test hooks: freeze the clock (?at=ISO), force Home or night (?screen=home|night), open
// a screen at boot (?screen=calendar|weather|settings), peek the rail (?peek=1), show all 8 rail
// items (?rail=all).
const frozenAt = MOCK && params.get('at') ? Date.parse(params.get('at')) : NaN;
const forcedScreen = MOCK ? params.get('screen') : null;
const ALL_FEATURES = { calendar: true, tasks: true, weather: true, photos: true, reflection: true, controls: true };
const bootMono = performance.now();

let clockOffset = 0; // server-corrected offset when the frame clock is off by > 2 min
const nowMs = () => (isFinite(frozenAt) ? frozenAt + (performance.now() - bootMono) : Date.now() + clockOffset);

let data = loadSnapshot(localStorage);
let ui = nav.initialState();
let lastScreen = '';
let lastRail = null;
let lastMinute = -1;
let paired = true;
let serverBuild = '';

const settings = () => mergeSettings(data && data.settings);
const features = () => (MOCK && params.get('rail') === 'all' ? ALL_FEATURES : (data && data.features) || {});

function idleMs() {
  const q = Number(params.get('idle'));
  if (q > 0) return q * 60000;
  return settings().idle.minutes * 60000;
}

function intervalMs() {
  const c = data && data.config && Number(data.config.photoIntervalSec);
  return (c >= 5 ? c : 60) * 1000;
}

const binds = {};
for (const el of document.querySelectorAll('[data-bind]')) {
  const k = el.getAttribute('data-bind');
  (binds[k] = binds[k] || []).push(el);
}
function setText(k, v) {
  for (const el of binds[k] || []) if (el.textContent !== v) el.textContent = v;
}
function setSrc(k, v) {
  for (const el of binds[k] || []) if (el.getAttribute('src') !== v) el.setAttribute('src', v);
}

const rail = createRail(document.getElementById('nav-rail'));

const slideshow = createSlideshow(document.getElementById('stage'), {
  intervalMs,
  onError: () => schedulePoll(1000),
});

function renderClock(ms) {
  const [time, ampm] = clockParts(ms, TZ);
  setText('time', time);
  setText('ampm', ampm);
  setText('longDate', longDate(ms, TZ));
  // Night burn-in guard: move the clock ±8 px on a 10-minute step.
  const step = Math.floor(minutesOfDay(ms, TZ) / 10);
  const dx = ((step % 3) - 1) * 8;
  const dy = ((Math.floor(step / 3) % 3) - 1) * 8;
  for (const el of binds.nightClock || []) {
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    el.style.opacity = String(settings().night.dimPct / 100);
  }
  rail.setClock(time + ' ' + ampm);
}

function renderWeather(ms) {
  const w = data && data.weather;
  if (!w || !w.now) {
    setText('wxNow', '');
    setSrc('wxIcon', '');
    setText('hilo', '');
    setText('wxStale', '');
    for (const el of binds.days || []) el.textContent = '';
    return;
  }
  const ageMin = w.fetchedAt ? (ms - Date.parse(w.fetchedAt)) / 60000 : 0;
  setText('wxNow', temp(w.now.tempF) + ' ' + (w.now.label || ''));
  setSrc('wxIcon', w.now.icon ? ICON_BASE + w.now.icon + '.svg' : '');
  setText('hilo', w.today ? 'H ' + temp(w.today.hi) + '  L ' + temp(w.today.lo) : '');
  setText('wxStale', staleLabel(w.fetchedAt, ms));
  for (const el of binds.days || []) {
    el.textContent = '';
    if (ageMin > 360) continue; // hide the forecast once it's 6 h old
    for (const d of w.next3 || []) {
      const day = document.createElement('div');
      day.className = 'day';
      const dow = document.createElement('span');
      dow.className = 'dow';
      if (d.icon) {
        const ic = document.createElement('img');
        ic.src = ICON_BASE + d.icon + '.svg';
        ic.alt = '';
        dow.appendChild(ic);
      }
      dow.appendChild(document.createTextNode(weekdayShort(d.ymd)));
      const hl = document.createElement('span');
      hl.textContent = temp(d.hi) + ' / ' + temp(d.lo);
      day.appendChild(dow);
      day.appendChild(hl);
      el.appendChild(day);
    }
  }
}

function renderCalendar(ms) {
  const c = data && data.calendar;
  setText('allDay', allDayLine(c));
  setText('calStale', c ? staleLabel(c.fetchedAt, ms) : '');
  const { rows, more } = agendaRows(c, ms, TZ, 4);
  for (const el of binds.agenda || []) {
    el.textContent = '';
    const add = (cls, t, title) => {
      const r = document.createElement('div');
      r.className = 'row ' + cls;
      const a = document.createElement('span');
      a.className = 't';
      a.textContent = t;
      const b = document.createElement('span');
      b.className = 'title';
      b.textContent = title;
      r.appendChild(a);
      r.appendChild(b);
      el.appendChild(r);
    };
    for (const r of rows) add(r.now ? 'now' : '', r.now ? 'Now' : r.time, r.title);
    if (more) add('more', '', '+' + more + ' more');
    if (!rows.length && c) {
      const t = nextLine(c, ms, TZ);
      add('empty', '', t ? 'Nothing else today. ' + t : 'Nothing else today');
    }
  }
}

function renderReflection() {
  if (!paired) {
    setText('reflTheme', 'Frame needs re-pairing');
    setText('reflPractice', '');
    return;
  }
  const r = data && data.reflection;
  setText('reflTheme', r && r.theme ? r.theme : '');
  setText('reflPractice', r && r.practice ? r.practice : '');
}

function renderAll() {
  const ms = nowMs();
  renderClock(ms);
  renderWeather(ms);
  renderCalendar(ms);
  renderReflection();
  if (data && data.photos) slideshow.setItems(data.photos.items, data.photos.setId, ymdIn(ms, TZ));
}

function currentScreen(ms, mono) {
  if (forcedScreen === 'home') return nav.HOME;
  if (forcedScreen === 'night') return nav.NIGHT;
  const s = nav.screenAt(ui, minutesOfDay(ms, TZ), mono, idleMs(), settings().schedule);
  return s === nav.HOME || s === nav.NIGHT || nav.viewEnabled(s, features()) ? s : nav.HOME;
}

function applyScreen(screen) {
  const mono = performance.now();
  const railOn = nav.railShown(ui, screen, mono);
  if (screen === lastScreen && railOn === lastRail) return;
  const changed = screen !== lastScreen;
  lastScreen = screen;
  lastRail = railOn;
  document.body.className = 'screen-' + screen + (railOn ? ' rail-on' : '');
  rail.setFeatures(features());
  rail.setActive(screen);
  if (!changed) return;
  if (ctx.sheet.isOpen()) ctx.sheet.close();
  setBacklight(screen === nav.NIGHT ? 'night' : 'day');
  // Photos only run behind Home; every other screen covers them.
  if (screen === nav.HOME) slideshow.start();
  else slideshow.stop();
  const scr = screens[screen];
  if (scr) scr.show();
}

function tick() {
  const ms = nowMs();
  const mono = performance.now();
  applyScreen(currentScreen(ms, mono));
  const scr = screens[lastScreen];
  if (scr && scr.tick) scr.tick();
  const minute = Math.floor(ms / 60000);
  if (minute !== lastMinute) {
    lastMinute = minute;
    renderAll();
    maybeReload(ms, mono);
  }
}

function maybeReload(ms, mono) {
  if (MOCK) return;
  const quiet = quietMoment({ awake: nav.awake(ui, mono, idleMs()), crossfading: slideshow.isFading() });
  if (!quiet) return;
  if (buildChanged(BUILD, serverBuild)) {
    location.reload();
    return;
  }
  const today = ymdIn(ms, TZ);
  let last;
  try {
    last = localStorage.getItem(RELOAD_KEY);
  } catch {
    last = null;
  }
  if (dailyReloadDue(minutesOfDay(ms, TZ), today, last, mono - bootMono)) {
    try {
      localStorage.setItem(RELOAD_KEY, today);
    } catch {
      // ignore
    }
    location.reload();
  }
}

// ----- data polling -----
const token = MOCK ? null : takeToken(location, localStorage, history);
const client = MOCK ? createMockClient(nowMs, TZ) : createClient(token, (u, i) => fetch(u, i));
let pollTimer = 0;
let failures = 0;

function schedulePoll(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, ms);
}

async function poll() {
  if (MOCK) {
    data = mockState(nowMs(), TZ);
    lastRail = null;
    renderAll();
    applyScreen(currentScreen(nowMs(), performance.now()));
    schedulePoll(60000);
    return;
  }
  if (!token) {
    paired = false;
    renderReflection();
    schedulePoll(15 * 60000);
    return;
  }
  const res = await client.state();
  if (res.status === 200 && res.data) {
    failures = 0;
    paired = true;
    data = res.data;
    serverBuild = data.build || '';
    const drift = Date.parse(data.serverTime) - Date.now();
    clockOffset = Math.abs(drift) > 120000 ? drift : 0;
    saveSnapshot(localStorage, data);
    lastRail = null;
    renderAll();
    applyScreen(currentScreen(nowMs(), performance.now()));
    schedulePoll(60000);
  } else if (res.status === 401) {
    paired = false;
    renderReflection();
    schedulePoll(15 * 60000);
  } else {
    failures++;
    schedulePoll(backoffMs(failures));
  }
}

// ----- v2 screens (PLAN-v2.md §2-§7) -----
const ctx = {
  client,
  tz: TZ,
  now: nowMs,
  settings,
  sheet: null,
  /** PUT one setting; true, or the error code. The reply carries all settings, applied at once. */
  async saveSetting(key, patch) {
    const r = await client.saveSetting(key, patch);
    if (r.status === 200 && r.data && r.data.ok) {
      data = Object.assign({}, data || {}, { settings: r.data.settings });
      if (!MOCK) saveSnapshot(localStorage, data);
      lastMinute = -1;
      tick();
      if (screens.settings) screens.settings.render();
      if (key === 'weather') {
        screens.weather.invalidate();
        schedulePoll(500);
      }
      return true;
    }
    return (r.data && r.data.error) || 'offline';
  },
  openCalendars() {
    openCalendarsSheet(ctx, (d) => {
      screens.settings.calendarsSaved(d);
      screens.calendar.invalidate();
      schedulePoll(500);
    });
  },
};
ctx.sheet = createSheet(document.getElementById('sheet'));
const screens = {
  calendar: createCalendarScreen(document.getElementById('view-calendar'), ctx),
  weather: createWeatherScreen(document.getElementById('view-weather'), ctx),
  settings: createSettingsScreen(document.getElementById('view-settings'), ctx),
};

function goTarget(el) {
  if (!el || !el.closest) return null;
  const r = el.closest('[data-rail]');
  if (r) return { rail: r.getAttribute('data-rail') };
  const g = el.closest('[data-go]');
  const v = g && g.getAttribute('data-go');
  return v && nav.viewEnabled(v, features()) ? { go: v } : null;
}

attachTaps(document.body, (el) => {
  const mono = performance.now();
  const before = currentScreen(nowMs(), mono);
  const target = goTarget(el);
  ui = nav.tap(ui, mono, before, target);
  const after = currentScreen(nowMs(), mono);
  applyScreen(after);
  // A tap on a control inside the screen that was already showing (not a rail switch).
  if (after === before && !(target && target.rail)) {
    if (ctx.sheet.isOpen() && el.closest && el.closest('#sheet')) ctx.sheet.onTap(el);
    else {
      const act = el && el.closest ? el.closest('[data-act]') : null;
      const scr = screens[after];
      if (act && scr && scr.onTap) scr.onTap(act, act.getAttribute('data-act'));
    }
  }
});

if (MOCK && forcedScreen && screens[forcedScreen]) ui = { view: forcedScreen, lastTouchMono: performance.now(), peekUntilMono: null };
if (MOCK && params.get('peek') === '1') ui = { view: nav.HOME, lastTouchMono: performance.now(), peekUntilMono: performance.now() + nav.RAIL_PEEK_S * 1000 };

const jsErrors = [];
window.addEventListener('error', (ev) => {
  jsErrors.push(String((ev && ev.message) || 'error').slice(0, 120));
  if (jsErrors.length > 5) jsErrors.shift();
});

function heartbeat() {
  if (MOCK || !token) return;
  client.heartbeat({ build: BUILD, screen: lastScreen, uptimeSec: Math.round((performance.now() - bootMono) / 1000), jsErrors: jsErrors.slice() });
}

let lastWall = Date.now();
setInterval(() => {
  // Recompute at once if the wall clock jumped (NTP fix after boot).
  const w = Date.now();
  if (Math.abs(w - lastWall - 2000) > 120000) lastMinute = -1;
  lastWall = w;
  tick();
}, 2000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    lastMinute = -1;
    tick();
  }
});
setInterval(heartbeat, 10 * 60000);

renderAll();
tick();
poll();
setTimeout(heartbeat, 10000);
