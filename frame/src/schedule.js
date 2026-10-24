// Pure layout state machine (PLAN.md §8). No DOM, no timers, so it is easy to test.
// Wall time comes in as Denver minutes-of-day; idle time is measured on a monotonic clock.

export const A = 'a';
export const B = 'b';
export const NIGHT = 'night';

export const MORNING_START = 6 * 60; // 6:00 AM: B
export const DAY_START = 7 * 60; // 7:00 AM: A
export const NIGHT_START = 22 * 60; // 10:00 PM: night

/** The screen the schedule wants at `minutes` past local midnight. */
export function scheduled(minutes) {
  if (minutes >= NIGHT_START || minutes < MORNING_START) return NIGHT;
  if (minutes < DAY_START) return B;
  return A;
}

export function initialState() {
  return { override: null, lastTouch: null };
}

/** True while a touch override is still inside its idle window. */
export function overrideActive(state, mono, idleMs) {
  return state.override !== null && state.lastTouch !== null && mono - state.lastTouch < idleMs && mono >= state.lastTouch;
}

/** The screen to show now. */
export function screenAt(state, minutes, mono, idleMs) {
  return overrideActive(state, mono, idleMs) ? state.override : scheduled(minutes);
}

/**
 * A single tap. Night: the first tap wakes to A; once woken, taps swap A and B (decided 2026-10-24).
 * Day: swaps A and B. Every tap restarts the idle timer.
 */
export function tap(state, minutes, mono, idleMs) {
  const shown = screenAt(state, minutes, mono, idleMs);
  const next = shown === NIGHT ? A : shown === A ? B : A;
  return { override: next, lastTouch: mono };
}

/** Clears an expired override so later logic (e.g. safe reload) sees a clean state. */
export function expire(state, mono, idleMs) {
  return overrideActive(state, mono, idleMs) ? state : initialState();
}

/** Milliseconds until the override expires, or null when there is none. */
export function msUntilIdle(state, mono, idleMs) {
  return overrideActive(state, mono, idleMs) ? idleMs - (mono - state.lastTouch) : null;
}
