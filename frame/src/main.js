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
import { mockState, createMockClient, mockConfig } from './mock.js';
import { mergeSettings } from '../../shared/settings.js';
import { createRail } from './rail.js';
import { createSheet } from './sheet.js';
import { createCalendarScreen } from './screens/calendar.js';
import { createWeatherScreen } from './screens/weather.js';
import { createSettingsScreen, openCalendarsSheet } from './screens/settings.js';
import { createTasksScreen, openTaskListsSheet } from './screens/tasks.js';
import { createReflectionScreen } from './screens/reflection.js';
import { createPhotosScreen } from './screens/photos.js';
import { createControlsScreen } from './screens/controls.js';
import { dueTodayLine } from './tasks-view.js';
import { step as alertStep, dismiss as alertDismiss, loadMemory, saveMemory } from './alerts.js';
import { renderBanners } from './banner.js';
import { createChime } from './chime.js';
import { createToast } from './toast.js';

const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const TZ = 'America/Denver';
const params = new URLSearchParams(location.search);
const MOCK = params.get('mock') === '1';
const ICON_BASE = './icons/';

// Mock-only test hooks: freeze the clock (?at=ISO), force Home or night (?screen=home|night), open
// a screen at boot (?screen=calendar|weather|settings), peek the rail (?peek=1), show all 8 rail
// items (?rail=all), Tasks without the Google scope (?tasks=noscope).
const frozenAt = MOCK && params.get('at') ? Date.parse(params.get('at')) : NaN;
const forcedScreen = MOCK ? params.get('screen') : null;
const ALL_FEATURES = { calendar: true, tasks: true, weather: true, photos: true, reflection: true, controls: true };
const bootMono = performance.now();
if (MOCK) {
  if (params.get('tasks') === 'noscope') mockConfig.tasksScope = false;
  if (params.get('spotify')) mockConfig.spotify = params.get('spotify');
  if (params.get('cams')) mockConfig.cams = params.get('cams');
  if (params.get('recent')) mockConfig.recent = params.get('recent');
  window.__sfMock = mockConfig;
}

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
  const c = Number(settings().photos.intervalSec) || (data && data.config && Number(data.config.photoIntervalSec));
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
  options: () => settings().photos,
  onChange: () => {
    if (lastScreen === 'photos' && screens.photos) screens.photos.refresh();
  },
});

// ----- alerts (PLAN-v2.md §9): computed here from cached data, one bundled chime -----
const memStore = { v: {}, getItem: (k) => memStore.v[k] || null, setItem: (k, v) => (memStore.v[k] = v) };
const alertStore = MOCK ? memStore : localStorage;
let alertMem = loadMemory(alertStore);
let alertMemJson = JSON.stringify(alertMem);
const alertsRoot = document.getElementById('alerts');
const chime = createChime('./chime.wav');
const toast = createToast(document.getElementById('toast'));

function runAlerts() {
  const ms = nowMs();
  const c = data && data.calendar;
  const res = alertStep(alertMem, { nowMs: ms, tz: TZ, soon: (c && c.soon) || [], tasks: data && data.tasks, settings: settings(), screen: lastScreen });
  alertMem = res.memory;
  const j = JSON.stringify(alertMem);
  if (j !== alertMemJson) {
    alertMemJson = j;
    saveMemory(alertStore, alertMem);
  }
  const stale = !!(c && c.fetchedAt && ms - Date.parse(c.fetchedAt) > 30 * 60000);
  renderBanners(alertsRoot, res, ms, TZ, stale);
  if (res.chime) chime.play(settings().alerts.volume);
}

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

function renderTasksLine() {
  const t = data && data.tasks;
  setText('tasksLine', t && t.scope && settings().tasks.onHome ? dueTodayLine(t) : '');
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
  renderTasksLine();
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
  const prev = lastScreen;
  lastScreen = screen;
  lastRail = railOn;
  document.body.className = 'screen-' + screen + (railOn ? ' rail-on' : '');
  rail.setFeatures(features());
  rail.setActive(screen);
  if (!changed) return;
  if (ctx.sheet.isOpen()) ctx.sheet.close();
  if (screens[prev] && screens[prev].hide) screens[prev].hide();
  setBacklight(screen === nav.NIGHT ? 'night' : 'day');
  // Photos run behind Home and on the Photos screen; every other screen covers them.
  if (screen === nav.HOME || screen === 'photos') slideshow.start();
  else slideshow.stop();
  const scr = screens[screen];
  if (scr) scr.show();
  runAlerts();
}

function tick() {
  const ms = nowMs();
  const mono = performance.now();
  const screen = currentScreen(ms, mono);
  ui = nav.settle(ui, screen);
  applyScreen(screen);
  const scr = screens[lastScreen];
  if (scr && scr.tick) scr.tick();
  runAlerts();
  const minute = Math.floor(ms / 60000);
  if (minute !== lastMinute) {
    lastMinute = minute;
    renderAll();
    maybeReload(ms, mono);
  }
}

// A reload (new build, 3 AM) on a screen that never idles (Photos) comes back to it, not to Home.
const RESUME_KEY = 'sf.resumeView';
function reloadKeepingView() {
  try {
    if (nav.keepsAwake(ui.view) && lastScreen === ui.view && lastScreen !== nav.NIGHT) localStorage.setItem(RESUME_KEY, JSON.stringify({ view: ui.view, at: Date.now() }));
  } catch {
    // ignore
  }
  location.reload();
}

function resumeView() {
  let r;
  try {
    r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    localStorage.removeItem(RESUME_KEY);
  } catch {
    r = null;
  }
  // Never at night: the 3 AM reload on Photos must not bring Photos back over the night clock.
  const ms = Date.now();
  const next = nav.resumeState(r, ms, minutesOfDay(ms, TZ), performance.now(), settings().schedule);
  if (next) ui = next;
}

function maybeReload(ms, mono) {
  if (MOCK) return;
  const quiet = quietMoment({ awake: nav.awake(ui, mono, idleMs()), crossfading: slideshow.isFading() });
  if (!quiet) return;
  if (buildChanged(BUILD, serverBuild)) {
    reloadKeepingView();
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
    reloadKeepingView();
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
    runAlerts();
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
    runAlerts();
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
  /** The Recent sheet's auto-close (30 s; ?sheetidle=ms in mock mode for the e2e test). */
  sheetIdleMs: MOCK && Number(params.get('sheetidle')) > 0 ? Number(params.get('sheetidle')) : 30000,
  toast,
  slideshow,
  photoSet: () => (data && data.photos && data.photos.setId) || null,
  photosChanged: () => schedulePoll(500),
  tasksChanged: () => schedulePoll(500),
  /** Settings › Alerts › Play test chime. Resolves false when audio is blocked (plays on the next tap). */
  testChime: (volume) => chime.play(volume),
  /** PUT one setting; true, or the error code. The reply carries all settings, applied at once. */
  async saveSetting(key, patch) {
    const r = await client.saveSetting(key, patch);
    if (r.status === 200 && r.data && r.data.ok) {
      data = Object.assign({}, data || {}, { settings: r.data.settings });
      if (!MOCK) saveSnapshot(localStorage, data);
      lastMinute = -1;
      tick();
      if (screens.settings) screens.settings.render();
      if (key === 'photos') slideshow.applyOptions();
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
  openTaskLists() {
    openTaskListsSheet(ctx, (d) => {
      screens.settings.listsSaved(d);
      screens.tasks.invalidate();
      if (lastScreen === 'tasks') screens.tasks.reload();
      schedulePoll(500);
    });
  },
};
ctx.sheet = createSheet(document.getElementById('sheet'));
const screens = {
  calendar: createCalendarScreen(document.getElementById('view-calendar'), ctx),
  weather: createWeatherScreen(document.getElementById('view-weather'), ctx),
  settings: createSettingsScreen(document.getElementById('view-settings'), ctx),
  tasks: createTasksScreen(document.getElementById('view-tasks'), ctx),
  photos: createPhotosScreen(document.getElementById('view-photos'), ctx),
  reflection: createReflectionScreen(document.getElementById('view-reflection'), ctx),
  controls: createControlsScreen(document.getElementById('view-controls'), ctx),
};

function goTarget(el) {
  if (!el || !el.closest) return null;
  const r = el.closest('[data-rail]');
  if (r) return { rail: r.getAttribute('data-rail') };
  const g = el.closest('[data-go]');
  const v = g && g.getAttribute('data-go');
  if (v && nav.viewEnabled(v, features())) return { go: v };
  // Any other control (and anything in an open sheet) works without showing or hiding the rail.
  if (el.closest(CONTROL_SEL) || (ctx.sheet.isOpen() && el.closest('#sheet'))) return { control: true };
  return null;
}

/** Interactive elements: a tap on one is a control tap; a tap anywhere else is empty space. */
const CONTROL_SEL = '[data-act], button, a[href], input, select, textarea, label, .tap-row';

// Hide the rail on time (the 2 s tick would be up to 2 s late).
let railTimer = 0;
function scheduleRailHide() {
  clearTimeout(railTimer);
  const mono = performance.now();
  const left = nav.msUntilRailHides(ui, currentScreen(nowMs(), mono), mono);
  if (left !== null) railTimer = setTimeout(tick, left + 20);
}

/** Banner and toast buttons: handled before navigation; they count as a touch but don't show the rail. */
function overlayTap(el, mono) {
  const act = el && el.closest ? el.closest('[data-act]') : null;
  if (!act) return false;
  // By data-act as well as by place: a button detached by a redraw mid-tap still counts.
  const kind = act.getAttribute('data-act');
  if (!act.closest('#alerts, #toast') && kind !== 'toast-undo' && kind !== 'alert-dismiss' && kind !== 'alert-open') return false;
  // A banner or toast button is a control: it restarts a showing rail's 10 s, never shows it.
  const up = nav.railShown(ui, currentScreen(nowMs(), mono), mono);
  ui = Object.assign({}, ui, { lastTouchMono: mono, peekUntilMono: up ? mono + nav.RAIL_PEEK_S * 1000 : ui.peekUntilMono });
  const a = act.getAttribute('data-act');
  if (a === 'toast-undo') toast.undo();
  else if (a === 'alert-dismiss' || a === 'alert-open') {
    alertMem = alertDismiss(alertMem, act.getAttribute('data-k'), nowMs());
    if (a === 'alert-open') {
      ui = nav.tap(ui, mono, currentScreen(nowMs(), mono), { go: act.getAttribute('data-kind') === 'tasks' ? 'tasks' : 'calendar' });
      applyScreen(currentScreen(nowMs(), mono));
    }
    runAlerts();
  }
  return true;
}

attachTaps(document.body, (el) => {
  const mono = performance.now();
  chime.onTap();
  try {
    onFrameTap(el, mono);
  } finally {
    scheduleRailHide();
  }
});

function onFrameTap(el, mono) {
  if (overlayTap(el, mono)) return;
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
      else if (!act && scr && scr.onBlankTap) scr.onBlankTap();
    }
  }
}

// A pinned screen starts as if just opened from the rail: the rail shows, then hides after 10 s.
if (!MOCK) resumeView();
if (MOCK && forcedScreen && screens[forcedScreen]) ui = { view: forcedScreen, lastTouchMono: performance.now(), peekUntilMono: performance.now() + nav.RAIL_PEEK_S * 1000 };
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
scheduleRailHide();
tick();
poll();
setTimeout(heartbeat, 10000);
