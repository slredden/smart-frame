// Tasks grouping (PLAN-v2.md §4.3). Pure: cached tasks in, sections out.
// Sections: Overdue, Today, Upcoming, No date. Within a section by due date, then Google's position.
// A subtask sits right under its parent (indented) when both land in the same section; otherwise it
// shows on its own, unindented, in its own section.

import { daysBetween, weekdayOf } from '../../shared/time.js';

export const SECTIONS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'nodate', label: 'No date' },
];

export function sectionOf(task, today) {
  if (!task.due) return 'nodate';
  if (task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  return 'upcoming';
}

const cmp = (a, b) => {
  if ((a.due || '') !== (b.due || '')) return (a.due || '') < (b.due || '') ? -1 : 1;
  const pa = String(a.pos || '');
  const pb = String(b.pos || '');
  return pa < pb ? -1 : pa > pb ? 1 : 0;
};

/**
 * Groups `tasks` for tab `listId` ('all' or a list id), skipping ids in `hidden`.
 * Returns [{key, label, rows: [{task, depth}]}] with empty sections left out.
 */
export function groupTasks(tasks, listId, today, hidden) {
  const skip = hidden || {};
  const mine = (tasks || []).filter((t) => (listId === 'all' || t.list === listId) && !skip[t.list + '/' + t.id]);
  const sec = {};
  for (const s of SECTIONS) sec[s.key] = [];
  for (const t of mine) sec[sectionOf(t, today)].push(t);
  const out = [];
  for (const s of SECTIONS) {
    const items = sec[s.key];
    if (!items.length) continue;
    const ids = {};
    for (const t of items) ids[t.list + '/' + t.id] = true;
    const tops = items.filter((t) => !t.parent || !ids[t.list + '/' + t.parent]).sort(cmp);
    const rows = [];
    for (const t of tops) {
      rows.push({ task: t, depth: 0 });
      if (!t.parent || !ids[t.list + '/' + t.parent]) {
        const kids = items.filter((k) => k.parent === t.id && k.list === t.list).sort(cmp);
        for (const k of kids) rows.push({ task: k, depth: 1 });
      }
    }
    out.push({ key: s.key, label: s.label, rows });
  }
  return out;
}

/**
 * The Home agenda line (PLAN-v2.md §4.3): 'Due today: Example A, Example B · +2', or
 * '2 overdue tasks' when only overdue ones are left; '' when nothing is due.
 */
export function dueTodayLine(summary) {
  if (!summary || !summary.scope) return '';
  const n = summary.dueCount || 0;
  const od = summary.overdue || 0;
  if (n) {
    const names = (summary.dueToday || []).slice(0, 2);
    const more = n - names.length + od;
    return 'Due today: ' + names.join(', ') + (more > 0 ? ' · +' + more : '');
  }
  if (od) return od === 1 ? '1 overdue task' : od + ' overdue tasks';
  return '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const md = (ymd) => {
  const [, m, d] = ymd.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + d;
};

/** 'Today', 'Fri' (within 6 days), 'Nov 3', 'Overdue · Oct 20', or '' with no date. */
export function dueLabel(ymd, today) {
  if (!ymd) return '';
  if (ymd === today) return 'Today';
  if (ymd < today) return 'Overdue · ' + md(ymd);
  const days = daysBetween(today, ymd);
  if (days <= 6) return DOW[weekdayOf(ymd)];
  return md(ymd);
}
