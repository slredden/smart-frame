// Alerts (PLAN-v2.md §9): computed on the frame from cached data, so they work while the Worker is
// unreachable. Pure: state in, state out; main.js renders banners and plays the chime.
//
// - Event banner `leadMin` (0 = off) before each timed event from a calendar with alerts on, shown until 5 min
//   after it starts. All-day events never alert (the Worker's `soon` list has timed events only).
// - Daily tasks banner at `tasksAt` when anything is due today or overdue, shown for 30 min.
// - Quiet hours (the night window, or a custom range): no chime; events starting inside them are
//   skipped; a tasks alert that falls inside them fires when they end. The night screen shows no banners.
// - Each alert fires once: keys are remembered (localStorage) for 2 days. A moved event gets a new key.
import { minutesOfDay, ymdIn } from '../../shared/time.js';
import { scheduled, NIGHT } from './schedule.js';
import { hashString } from './shuffle.js';

export const EVENT_AFTER_MS = 5 * 60000;
export const TASKS_SHOW_MS = 30 * 60000;
export const KEEP_MS = 2 * 86400000;
export const MAX_BANNERS = 2;
export const STORE_KEY = 'sf.alerts';

/** True when `minutes` (past local midnight) is inside quiet hours. */
export function inQuiet(minutes, alerts, schedule) {
  const q = alerts.quiet;
  if (q === 'night') return scheduled(minutes, schedule) === NIGHT;
  if (!q || q.start === q.end) return false;
  return q.start < q.end ? minutes >= q.start && minutes < q.end : minutes >= q.start || minutes < q.end;
}

/** The first minute at or after `m` that isn't quiet (same day; null if quiet till midnight). */
export function firstAwakeMinute(m, alerts, schedule) {
  for (let x = m; x < 1440; x += 1) if (!inQuiet(x, alerts, schedule)) return x;
  return null;
}

export const eventKey = (e) => 'event:' + hashString(String(e.title || '')).toString(36) + ':' + e.start;

/**
 * The alerts that should be up now. Returns [{key, kind, title, start?, until, firedAt?}] in time order.
 * input: {nowMs, tz, soon, tasks, settings: {alerts, schedule}}
 */
export function activeAlerts(input) {
  const { nowMs, tz, settings } = input;
  const a = settings.alerts;
  const sch = settings.schedule;
  const out = [];
  // leadMin 0 turns event alerts off (PLAN-v2.md §9.5).
  for (const e of a.leadMin > 0 ? input.soon || [] : []) {
    if (!e || e.na || !e.start) continue;
    const start = Date.parse(e.start);
    if (!isFinite(start)) continue;
    const from = start - a.leadMin * 60000;
    const until = start + EVENT_AFTER_MS;
    if (nowMs < from || nowMs >= until) continue;
    if (inQuiet(minutesOfDay(start, tz), a, sch)) continue;
    out.push({ key: eventKey(e), kind: 'event', title: e.title, start: e.start, color: e.color || null, until, sortAt: start });
  }
  const t = input.tasks;
  if (a.tasks && t && t.scope && (t.dueCount > 0 || t.overdue > 0)) {
    const today = ymdIn(nowMs, tz);
    const fireMin = inQuiet(a.tasksAt, a, sch) ? firstAwakeMinute(a.tasksAt, a, sch) : a.tasksAt;
    if (fireMin !== null) {
      const fireAt = Math.floor(nowMs / 60000) * 60000 - (minutesOfDay(nowMs, tz) - fireMin) * 60000;
      const until = fireAt + TASKS_SHOW_MS;
      if (nowMs >= fireAt && nowMs < until) out.push({ key: 'tasks:' + today, kind: 'tasks', title: tasksText(t), until, sortAt: fireAt });
    }
  }
  out.sort((x, y) => x.sortAt - y.sortAt);
  return out;
}

/** '2 tasks due today · 1 overdue' */
export function tasksText(t) {
  const n = t.dueCount || 0;
  const parts = [];
  if (n) parts.push(n === 1 ? '1 task due today' : n + ' tasks due today');
  if (t.overdue) parts.push(t.overdue + ' overdue');
  return parts.join(' · ');
}

/**
 * One evaluation step. `memory` = {key: {at, dismissed}} (persisted by the caller).
 * Returns {memory, banners (≤ MAX_BANNERS), more, chime}. `chime` is true when a new alert fired
 * outside quiet hours with the chime on. On the night screen nothing is shown or fired.
 */
export function step(memory, input) {
  const mem = prune(memory, input.nowMs);
  if (input.screen === NIGHT) return { memory: mem, banners: [], more: 0, chime: false };
  const act = activeAlerts(input);
  let fresh = false;
  for (const x of act) {
    if (!mem[x.key]) {
      mem[x.key] = { at: input.nowMs, dismissed: false };
      fresh = true;
    }
  }
  const shown = act.filter((x) => !mem[x.key].dismissed);
  const quietNow = inQuiet(minutesOfDay(input.nowMs, input.tz), input.settings.alerts, input.settings.schedule);
  return {
    memory: mem,
    banners: shown.slice(0, MAX_BANNERS),
    more: Math.max(0, shown.length - MAX_BANNERS),
    chime: fresh && input.settings.alerts.chime && !quietNow,
  };
}

export function dismiss(memory, key, nowMs) {
  const mem = Object.assign({}, memory);
  mem[key] = { at: (mem[key] && mem[key].at) || nowMs, dismissed: true };
  return mem;
}

export function prune(memory, nowMs) {
  const out = {};
  for (const k of Object.keys(memory || {})) {
    const v = memory[k];
    if (v && typeof v.at === 'number' && nowMs - v.at < KEEP_MS) out[k] = v;
  }
  return out;
}

export function loadMemory(storage) {
  try {
    const v = JSON.parse(storage.getItem(STORE_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function saveMemory(storage, mem) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(mem));
  } catch {
    // ignore
  }
}
