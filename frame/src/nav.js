// Touch, idle and navigation state (PLAN-v2.md §2.2-2.5). Pure: no DOM, no timers; idle and the rail
// peek use a monotonic clock. main.js turns DOM taps into targets and renders whatever this says.
import { HOME, NIGHT, scheduled, DEFAULT_SCHEDULE } from './schedule.js';

/** Rail order (§2.2). A screen joins the rail when its `features.<name>` flag is on. */
export const RAIL = ['home', 'calendar', 'tasks', 'weather', 'photos', 'reflection', 'controls'];
/** Always on the rail, below the clock, so Settings can never be hidden (§7.4 lock-out guard). */
export const SETTINGS = 'settings';
export const RAIL_PEEK_S = 30;
const PEEK_MS = RAIL_PEEK_S * 1000;

export function initialState() {
  return { view: HOME, lastTouchMono: null, peekUntilMono: null };
}

/** The rail items to draw, in order. Home and Settings are always there. */
export function railItems(features) {
  const f = features || {};
  return RAIL.filter((v) => v === HOME || f[v] === true).concat([SETTINGS]);
}

/** True when `view` can be opened: Home, Settings, or a screen whose feature flag is on. */
export function viewEnabled(view, features) {
  return railItems(features).indexOf(view) >= 0;
}

/** True while the last touch is inside the idle window. A clock going backwards counts as idle. */
export function awake(state, mono, idleMs) {
  return state.lastTouchMono !== null && mono >= state.lastTouchMono && mono - state.lastTouchMono < idleMs;
}

/** The screen to show now: the touched view while awake, otherwise the schedule (Home or night). */
export function screenAt(state, minutes, mono, idleMs, schedule = DEFAULT_SCHEDULE) {
  return awake(state, mono, idleMs) ? state.view : scheduled(minutes, schedule);
}

/** The rail shows on every screen but Home and night, and on Home during a peek. */
export function railShown(state, screen, mono) {
  if (screen === NIGHT) return false;
  if (screen !== HOME) return true;
  return state.peekUntilMono !== null && mono >= state.peekUntilMono - PEEK_MS && mono < state.peekUntilMono;
}

/**
 * One tap. `target` is {rail: view} for a rail item, {go: view} for a Home widget whose screen is
 * built, or null for anywhere else. `screen` is what was showing when the finger went down.
 * - Night: wake to Home with the rail peeking. Never opens a widget, whatever was under the finger.
 * - A rail item (only reachable while the rail shows) opens its screen.
 * - On Home, a widget opens its screen; anywhere else peeks the rail (again restarts the 30 s).
 * - On other screens a tap just keeps the frame awake.
 */
export function tap(state, mono, screen, target) {
  const next = { view: state.view, lastTouchMono: mono, peekUntilMono: state.peekUntilMono };
  if (screen === NIGHT) {
    next.view = HOME;
    next.peekUntilMono = mono + PEEK_MS;
    return next;
  }
  // When the frame was idle the schedule was showing Home, whatever view was left open.
  if (screen === HOME) next.view = HOME;
  const railUp = railShown(state, screen, mono);
  if (target && target.rail && railUp) {
    next.view = target.rail;
    next.peekUntilMono = null;
  } else if (next.view === HOME && target && target.go) {
    next.view = target.go;
    next.peekUntilMono = null;
  } else if (next.view === HOME) {
    next.peekUntilMono = mono + PEEK_MS;
  }
  return next;
}

/** Milliseconds until the frame falls back to the schedule, or null when it isn't awake. */
export function msUntilIdle(state, mono, idleMs) {
  return awake(state, mono, idleMs) ? idleMs - (mono - state.lastTouchMono) : null;
}

export { HOME, NIGHT };
