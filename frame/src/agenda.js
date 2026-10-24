// Pure helpers for the calendar slots (PLAN.md §9.3).
import { eventTime } from './format.js';

/**
 * The "Next" line for screen A.
 * calendar: { today: {allDay:[{title}], timed:[{title,start,end}]}, tomorrowFirst: {title,start}|null }
 */
export function nextLine(calendar, nowMs, tz) {
  if (!calendar || !calendar.today) return '';
  const timed = calendar.today.timed || [];
  for (const ev of timed) {
    const start = Date.parse(ev.start);
    const end = Date.parse(ev.end);
    if (end <= nowMs) continue;
    if (start <= nowMs) return 'Now: ' + ev.title + ', until ' + eventTime(ev.end, tz);
    return 'Next: ' + ev.title + ', ' + eventTime(ev.start, tz);
  }
  const t = calendar.tomorrowFirst;
  if (t && t.start) return 'Tomorrow ' + eventTime(t.start, tz) + ' · ' + t.title;
  return '';
}

/** The all-day top line: 'All day: A · B', or ''. */
export function allDayLine(calendar) {
  const list = (calendar && calendar.today && calendar.today.allDay) || [];
  if (!list.length) return '';
  return 'All day: ' + list.map((e) => e.title).join(' · ');
}

/** Agenda rows for screen B: remaining timed events, at most `max`, plus a '+N more' count. */
export function agendaRows(calendar, nowMs, tz, max = 5) {
  const timed = (calendar && calendar.today && calendar.today.timed) || [];
  const upcoming = timed.filter((e) => Date.parse(e.end) > nowMs);
  const rows = upcoming.slice(0, max).map((e) => ({ time: eventTime(e.start, tz), title: e.title, now: Date.parse(e.start) <= nowMs }));
  return { rows, more: Math.max(0, upcoming.length - max) };
}
