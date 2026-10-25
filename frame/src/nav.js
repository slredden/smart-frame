// Touch and idle state (PLAN-v2.md §2.5). Pure: no DOM, no timers; idle uses a monotonic clock.
// v1.2 has one view (Home), so a tap only wakes the frame and restarts the idle timer. The v2 rail,
// widget taps and the 30 s rail peek build on this state in Phase 1.
import { HOME, NIGHT, scheduled, DEFAULT_SCHEDULE } from './schedule.js';

export function initialState() {
  return { view: HOME, lastTouchMono: null };
}

/** True while the last touch is inside the idle window. A clock going backwards counts as idle. */
export function awake(state, mono, idleMs) {
  return state.lastTouchMono !== null && mono >= state.lastTouchMono && mono - state.lastTouchMono < idleMs;
}

/** The screen to show now: the touched view while awake, otherwise the schedule. */
export function screenAt(state, minutes, mono, idleMs, schedule = DEFAULT_SCHEDULE) {
  return awake(state, mono, idleMs) ? state.view : scheduled(minutes, schedule);
}

/** A single tap: at night it wakes to Home; by day it keeps Home. Either way the idle timer restarts. */
export function tap(state, mono) {
  return { view: HOME, lastTouchMono: mono };
}

/** Milliseconds until the frame falls back to the schedule, or null when it isn't awake. */
export function msUntilIdle(state, mono, idleMs) {
  return awake(state, mono, idleMs) ? idleMs - (mono - state.lastTouchMono) : null;
}

export { HOME, NIGHT };
