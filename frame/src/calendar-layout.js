// Pure layout for the Calendar screen (PLAN-v2.md §3.2). No DOM here, so it is unit-tested.
import { addDays, minutesOfDay, ymdIn, weekdayOf, startOfDayUtc } from '../../shared/time.js';

export const VIEWS = ['agenda', 'day', 'week'];
export const DAY_GRID = { startH: 6, endH: 22, pxPer30: 44 };
export const WEEK_GRID = { startH: 7, endH: 21 };
export const MAX_COLS = 3;
export const NEUTRAL = '#8a96a3';

/** Monday of the week holding `ymd` (weekdayOf: 0 = Sunday). */
export function weekStart(ymd) {
  const wd = weekdayOf(ymd);
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

/** The window each view asks the Worker for. */
export function viewWindow(view, anchor) {
  if (view === 'day') return { from: anchor, days: 1 };
  if (view === 'week') return { from: weekStart(anchor), days: 7 };
  return { from: anchor, days: 14 };
}

/** Where prev/next go: a day, a week, or two weeks. */
export function stepAnchor(view, anchor, dir) {
  return addDays(anchor, dir * (view === 'day' ? 1 : view === 'week' ? 7 : 14));
}

/** '#rrggbb' at `alpha` over `bg`, as rgb() (no 8-digit hex or color-mix on Chrome 106). */
export function tint(hex, alpha, bg = '#16161a') {
  const p = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const c = /^#[0-9a-f]{6}$/i.test(hex || '') ? p(hex) : p(NEUTRAL);
  const b = p(bg);
  const m = c.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return 'rgb(' + m.join(', ') + ')';
}

/**
 * Timed events of one day as blocks on a grid from startH to endH: minute offsets clipped to the grid,
 * overlapping events side by side in up to MAX_COLS columns; the rest counted as `more` on their cluster.
 * Events entirely outside the grid hours are returned in `outside` (so the screen can say "+2 earlier").
 */
export function layoutDay(timed, ymd, tz, grid) {
  const lo = grid.startH * 60;
  const hi = grid.endH * 60;
  const dayStart = startOfDayUtc(ymd, tz);
  const dayEnd = startOfDayUtc(addDays(ymd, 1), tz);
  const items = [];
  const outside = { before: 0, after: 0 };
  for (const e of timed || []) {
    const s = Date.parse(e.start);
    const en = Date.parse(e.end);
    let a = s <= dayStart ? 0 : minutesOfDay(s, tz);
    let b = en >= dayEnd ? 1440 : minutesOfDay(en, tz);
    if (b <= a) b = a + 15;
    if (b <= lo) {
      outside.before++;
      continue;
    }
    if (a >= hi) {
      outside.after++;
      continue;
    }
    a = Math.max(a, lo);
    b = Math.min(Math.max(b, a + 20), hi);
    items.push({ e, a, b });
  }
  items.sort((x, y) => x.a - y.a || y.b - x.b);
  const blocks = [];
  const more = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    let hidden = 0;
    const placed = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => end <= it.a);
      if (col < 0) col = colEnds.length;
      if (col >= MAX_COLS) {
        hidden++;
        continue;
      }
      colEnds[col] = it.b;
      placed.push(Object.assign({ col }, it));
    }
    const cols = Math.min(colEnds.length, MAX_COLS);
    for (const p of placed) blocks.push({ title: p.e.title, color: p.e.color || null, start: p.e.start, end: p.e.end, top: p.a - lo, height: p.b - p.a, col: p.col, cols });
    if (hidden) more.push({ top: cluster[0].a - lo, n: hidden });
    cluster = [];
    clusterEnd = -1;
  };
  for (const it of items) {
    if (it.a >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.b);
  }
  flush();
  return { blocks, more, outside, minutes: hi - lo };
}

/** Agenda days: only days with something on them, plus whether any requested day isn't loaded. */
export function agendaDays(win) {
  const days = (win && win.days) || [];
  return {
    days: days.filter((d) => d.loaded && (d.allDay.length || d.timed.length)),
    unloaded: days.some((d) => !d.loaded),
  };
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Today', 'Tomorrow', or 'Sat Oct 24'. */
export function dayLabel(ymd, todayYmd) {
  if (ymd === todayYmd) return 'Today';
  if (ymd === addDays(todayYmd, 1)) return 'Tomorrow';
  return DOW[weekdayOf(ymd)] + ' ' + MON[Number(ymd.slice(5, 7)) - 1] + ' ' + Number(ymd.slice(8, 10));
}

export const shortDow = (ymd) => DOW[weekdayOf(ymd)];
export const monthDay = (ymd) => MON[Number(ymd.slice(5, 7)) - 1] + ' ' + Number(ymd.slice(8, 10));

/** '9:30 AM' for an ISO instant in tz. */
export function clockLabel(iso, tz) {
  const m = minutesOfDay(Date.parse(iso), tz);
  const h = Math.floor(m / 60);
  return (h % 12 || 12) + ':' + String(m % 60).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}

/** Time column text for an agenda row: '9:30 AM', or 'until 11 AM' for an event that started before the day. */
export function agendaTime(e, ymd, tz) {
  if (ymdIn(Date.parse(e.start), tz) < ymd) return 'until ' + clockLabel(e.end, tz);
  return clockLabel(e.start, tz);
}
