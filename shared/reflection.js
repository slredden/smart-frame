// Reflection guide shape, validation and the current-week picker. Pure; shared by the Worker and CLIs.
import { addDays, daysBetween } from './time.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_THEME = 160;
export const MAX_PRACTICE = 1200; // the frame clamps long practice text to a few lines

/**
 * Validates a guide: weeks are 7-day blocks from guide.start (the last may be shorter or longer up to
 * guide.end), numbered 1..n, contiguous, and exactly tile [start, end]. Returns a list of problems.
 */
export function validateGuide(g) {
  const errs = [];
  if (!g || typeof g !== 'object') return ['not_an_object'];
  const guide = g.guide || {};
  if (!YMD.test(guide.start || '') || !YMD.test(guide.end || '')) errs.push('guide_dates');
  if (!Array.isArray(g.weeks) || g.weeks.length < 1 || g.weeks.length > 8) errs.push('weeks_count');
  if (errs.length) return errs;
  let expect = guide.start;
  g.weeks.forEach((w, i) => {
    const n = i + 1;
    if (w.n !== n) errs.push('week_' + n + '_number');
    if (w.start !== expect) errs.push('week_' + n + '_start');
    const last = i === g.weeks.length - 1;
    const wantEnd = last ? guide.end : addDays(w.start, 6);
    if (w.end !== wantEnd) errs.push('week_' + n + '_end');
    if (last && (daysBetween(w.start, w.end) < 0 || daysBetween(w.start, w.end) > 13)) errs.push('week_' + n + '_length');
    if (typeof w.theme !== 'string' || !w.theme.trim() || w.theme.length > MAX_THEME) errs.push('week_' + n + '_theme');
    if (typeof w.practice !== 'string' || w.practice.length > MAX_PRACTICE) errs.push('week_' + n + '_practice');
    expect = addDays(w.end, 1);
  });
  return errs;
}

/** The week covering `ymd`, as {n, theme, practice}, or null. */
export function currentWeek(g, ymd) {
  if (!g || !Array.isArray(g.weeks)) return null;
  for (const w of g.weeks) {
    if (w.start <= ymd && ymd <= w.end) return { n: w.n, theme: w.theme, practice: w.practice };
  }
  return null;
}

/** Keeps only the fields the frame needs, trimmed. */
export function cleanGuide(g) {
  return {
    guide: { start: g.guide.start, end: g.guide.end },
    weeks: g.weeks.map((w) => ({ n: w.n, start: w.start, end: w.end, theme: w.theme.trim(), practice: (w.practice || '').trim() })),
  };
}

export const WEEKLY_STALE_DAYS = 8;
export const MONTHLY_STALE_DAYS = 35;

/**
 * Reflection freshness for /api/health (PLAN-v2.md §8.5). Dates only, never text.
 * `guides` is every published guide ({guide:{start,end}, weeks:[{start,end}]}); `today` is the Denver ymd.
 * - Newest guide: the greatest guide.start <= today (future-start guides are ignored).
 * - Newest weekly: across all guides, the week with the greatest start <= today.
 * - Weekly stale: no newest weekly, or today - anchor > 8, anchor = max(week.start, week.end - 6).
 * - Monthly stale: no newest guide, or today - guide.start > max(35, guide.end - guide.start + 1).
 */
export function reflectionFreshness(guides, today) {
  let guide = null;
  let week = null;
  for (const g of guides || []) {
    if (!g || !g.guide) continue;
    if (g.guide.start <= today && (!guide || g.guide.start > guide.start)) guide = g.guide;
    for (const w of g.weeks || []) {
      if (w.start <= today && (!week || w.start > week.start)) week = w;
    }
  }
  let weekly = { start: null, ageDays: null, stale: true };
  if (week) {
    const shifted = addDays(week.end, -6);
    const anchor = shifted > week.start ? shifted : week.start;
    const age = daysBetween(anchor, today);
    weekly = { start: week.start, ageDays: Math.max(0, age), stale: age > WEEKLY_STALE_DAYS };
  }
  let monthly = { start: null, end: null, ageDays: null, stale: true };
  if (guide) {
    const age = daysBetween(guide.start, today);
    const guideDays = daysBetween(guide.start, guide.end) + 1;
    monthly = { start: guide.start, end: guide.end, ageDays: age, stale: age > Math.max(MONTHLY_STALE_DAYS, guideDays) };
  }
  return { weekly, monthly };
}

/** The guide in force on `ymd`: the one with the latest start <= ymd (guides may overlap). */
export function pickGuide(guides, ymd) {
  let best = null;
  for (const g of guides || []) {
    if (g && g.guide && g.guide.start <= ymd && (!best || g.guide.start > best.guide.start)) best = g;
  }
  return best;
}

export const HISTORY_GUIDES = 5;

/**
 * GET /api/reflection (PLAN-v2.md §8.1): the current guide plus up to 5 earlier ones. Only weeks that
 * have started carry their practice; future weeks show the theme only (Q4). Guides that start after
 * today aren't shown at all.
 */
export function reflectionView(guides, ymd) {
  const current = pickGuide(guides, ymd);
  const shape = (g) => ({
    start: g.guide.start,
    end: g.guide.end,
    weeks: g.weeks.map((w) => (w.start <= ymd ? { n: w.n, start: w.start, end: w.end, theme: w.theme, practice: w.practice } : { n: w.n, start: w.start, end: w.end, theme: w.theme, future: true })),
  });
  const history = (guides || [])
    .filter((g) => g && g.guide && current && g.guide.start < current.guide.start)
    .sort((a, b) => (a.guide.start < b.guide.start ? 1 : -1))
    .slice(0, HISTORY_GUIDES)
    .map(shape);
  const week = current ? currentWeek(current, ymd) : null;
  return { today: ymd, current: current ? shape(current) : null, week: week ? week.n : null, history };
}
