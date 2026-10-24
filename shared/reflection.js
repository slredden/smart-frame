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
