// Touch, idle and navigation state (PLAN-v2.md §2.2-2.5). Pure: no DOM, no timers; idle and the rail
// peek use a monotonic clock. main.js turns DOM taps into targets and renders whatever this says.
import { HOME, NIGHT, scheduled, DEFAULT_SCHEDULE } from './schedule.js';

/** Rail order (§2.2). A screen joins the rail when its `features.<name>` flag is on. */
export const RAIL = ['home', 'calendar', 'tasks', 'weather', 'photos', 'reflection', 'controls'];
/** Always on the rail, below the clock, so Settings can never be hidden (§7.4 lock-out guard). */
export const SETTINGS = 'settings';
/** The rail hides this long after the last touch, on every screen (rail auto-hide, 2026-10-24). */
export const RAIL_PEEK_S = 10;
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

/**
 * Screens the idle return to Home never applies to (2026-10-25): Photos stays up until someone leaves
 * it, so the frame can work as a plain photo frame. The schedule doesn't take over either, so Photos
 * stays up through night mode too. `awake` still means "touched lately" (reloads wait for it to end).
 */
export const NO_IDLE = ['photos'];
export const keepsAwake = (view) => NO_IDLE.indexOf(view) >= 0;

/** The screen to show now: the touched view while awake (or Photos, always), otherwise the schedule. */
export function screenAt(state, minutes, mono, idleMs, schedule = DEFAULT_SCHEDULE) {
  if (keepsAwake(state.view) && state.lastTouchMono !== null) return state.view;
  return awake(state, mono, idleMs) ? state.view : scheduled(minutes, schedule);
}

/** The rail shows for RAIL_PEEK_S after the last touch that showed or used it, never at night. */
export function railShown(state, screen, mono) {
  if (screen === NIGHT) return false;
  return state.peekUntilMono !== null && mono >= state.peekUntilMono - PEEK_MS && mono < state.peekUntilMono;
}

/** Milliseconds until the rail hides, or null when it isn't showing. */
export function msUntilRailHides(state, screen, mono) {
  return railShown(state, screen, mono) ? state.peekUntilMono - mono : null;
}

/**
 * One tap. `target` is {rail: view} for a rail item, {go: view} for a Home widget whose screen is
 * built, {control: true} for any other button or interactive row, or null for empty space.
 * `screen` is what was showing when the finger went down.
 * - Night: wake to Home with the rail showing. Never opens a widget, whatever was under the finger.
 * - A rail item (only reachable while the rail shows) opens its screen; the rail stays for 10 s.
 * - On Home, a widget opens its screen.
 * - A control works as usual: if the rail is up its 10 s restart, if it's hidden it stays hidden.
 * - Empty space (any screen) shows the rail for 10 s; again restarts the 10 s.
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
  const keep = railUp ? mono + PEEK_MS : null;
  if (target && target.rail && railUp) {
    next.view = target.rail;
    next.peekUntilMono = keep;
  } else if (next.view === HOME && target && target.go) {
    next.view = target.go;
    next.peekUntilMono = keep;
  } else if (target && (target.control || target.go)) {
    next.peekUntilMono = keep;
  } else {
    next.peekUntilMono = mono + PEEK_MS;
  }
  return next;
}

/** Milliseconds until the frame falls back to the schedule, or null when it isn't awake or never will. */
export function msUntilIdle(state, mono, idleMs) {
  if (keepsAwake(state.view)) return null;
  return awake(state, mono, idleMs) ? idleMs - (mono - state.lastTouchMono) : null;
}

export { HOME, NIGHT };
