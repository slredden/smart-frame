// The day plan (PLAN-v2.md §2.1). Pure: Denver minutes-of-day in, HOME or NIGHT out.
// v1.2 removed the A/B layouts and the 6-7 AM morning layout; touch and idle live in nav.js.

export const HOME = 'home';
export const NIGHT = 'night';

// Defaults until the v2 Settings screen makes them editable.
export const DEFAULT_SCHEDULE = { dayStart: 6 * 60, nightStart: 22 * 60 };

/** The screen the schedule wants at `minutes` past local midnight. */
export function scheduled(minutes, schedule = DEFAULT_SCHEDULE) {
  const { dayStart, nightStart } = schedule;
  if (dayStart <= nightStart) return minutes >= dayStart && minutes < nightStart ? HOME : NIGHT;
  // A day window that wraps past midnight (e.g. 20:00-02:00).
  return minutes >= dayStart || minutes < nightStart ? HOME : NIGHT;
}
