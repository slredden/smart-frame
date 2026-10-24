// When to reload the page: a new build on the server, or the daily 3 AM refresh (PLAN.md §11-12).
// Reloads wait for a quiet moment: nobody touching the frame and no crossfade running.

export const RELOAD_KEY = 'sf.reloadDay';
const DAILY_START = 3 * 60; // 3:00 AM Denver, inside night mode
const DAILY_END = 3 * 60 + 30;

/** True when it's safe to swap the page out from under the viewer. */
export function quietMoment({ overrideActive, crossfading }) {
  return !overrideActive && !crossfading;
}

/** A newer build is deployed. Ignores 'dev' builds and missing values. */
export function buildChanged(localBuild, serverBuild) {
  return !!serverBuild && !!localBuild && serverBuild !== localBuild && localBuild !== 'dev';
}

/**
 * Daily reload once per date between 3:00 and 3:30 AM, and only if the page has been up for an hour
 * (avoids loops if the clock is off).
 */
export function dailyReloadDue(minutes, today, lastReloadDay, uptimeMs) {
  return minutes >= DAILY_START && minutes < DAILY_END && lastReloadDay !== today && uptimeMs > 3600000;
}
