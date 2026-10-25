// Calendar screen (PLAN-v2.md §3): Agenda (default), Day and Week over the selected calendars,
// in their Google colors. Read-only; data comes from GET /api/calendar (the Worker's cached window).
import { h, btn, clear } from '../dom.js';
import { ymdIn, minutesOfDay, addDays } from '../../../shared/time.js';
import {
  VIEWS, DAY_GRID, WEEK_GRID, viewWindow, stepAnchor, layoutDay, agendaDays, dayLabel, shortDow, monthDay,
  clockLabel, agendaTime, tint, NEUTRAL, weekStart,
} from '../calendar-layout.js';

const CACHE_MS = 60000;
const VIEW_LABEL = { agenda: 'Agenda', day: 'Day', week: 'Week' };

export function createCalendarScreen(root, ctx) {
  let view = null;
  let anchor = null;
  let win = null;
  let winKey = '';
  let fetchedAt = 0;
  let loading = false;
  let failed = false;

  const seg = h('div', 'seg', '', VIEWS.map((v) => btn(VIEW_LABEL[v], 'cal-view', 'seg-btn', { v })));
  const title = h('div', 'cal-title');
  const toolbar = h('div', 'toolbar', '', [
    seg,
    btn('‹', 'cal-prev', 'icon-btn'),
    btn('Today', 'cal-today'),
    btn('›', 'cal-next', 'icon-btn'),
    title,
    btn('Calendars', 'cal-cals'),
  ]);
  const body = h('div', 'cal-body');
  root.appendChild(toolbar);
  root.appendChild(body);

  const today = () => ymdIn(ctx.now(), ctx.tz);

  async function load(force) {
    const w = viewWindow(view, anchor);
    const key = w.from + ':' + w.days;
    if (!force && key === winKey && ctx.now() - fetchedAt < CACHE_MS) return;
    loading = true;
    if (key !== winKey) {
      win = null;
      render();
    }
    const res = await ctx.client.calendar(w.from, w.days);
    loading = false;
    const now = viewWindow(view, anchor);
    if (now.from + ':' + now.days !== key) return; // the user moved on while this loaded
    if (res.status === 200 && res.data) {
      win = res.data;
      winKey = key;
      fetchedAt = ctx.now();
      failed = false;
    } else {
      failed = true;
    }
    render();
  }

  function setView(v) {
    if (VIEWS.indexOf(v) < 0 || v === view) return;
    view = v;
    const s = ctx.settings();
    if (s.calendar.view !== v) ctx.saveSetting('calendar', { view: v });
    load(false);
    render();
  }

  function renderTitle() {
    const t = today();
    if (view === 'day') title.textContent = dayLabel(anchor, t);
    else if (view === 'week') {
      const ws = weekStart(anchor);
      title.textContent = monthDay(ws) + ' – ' + monthDay(addDays(ws, 6));
    } else title.textContent = anchor === t ? 'Next two weeks' : 'From ' + monthDay(anchor);
  }

  function note(text) {
    body.appendChild(h('div', 'cal-note', text));
  }

  function chip(e, cls) {
    const c = h('div', cls || 'cal-chip', e.title);
    c.style.backgroundColor = tint(e.color || NEUTRAL, 0.32);
    c.style.borderLeftColor = e.color || NEUTRAL;
    return c;
  }

  function renderAgenda() {
    const scroll = h('div', 'cal-scroll');
    body.appendChild(scroll);
    const { days, unloaded } = agendaDays(win);
    const t = today();
    for (const d of days) {
      scroll.appendChild(h('div', 'ag-day' + (d.ymd === t ? ' today' : ''), dayLabel(d.ymd, t)));
      for (const e of d.allDay) scroll.appendChild(agRow(e, 'All day'));
      for (const e of d.timed) scroll.appendChild(agRow(e, agendaTime(e, d.ymd, ctx.tz)));
    }
    if (!days.length && !unloaded) scroll.appendChild(h('div', 'cal-note', 'Nothing on these calendars for two weeks.'));
    if (unloaded) scroll.appendChild(h('div', 'cal-note', earlierOrLater()));
    if (win.next && !unloaded) scroll.appendChild(h('div', 'cal-note', 'Next: ' + dayLabel(win.next.allDay ? win.next.start : ymdIn(Date.parse(win.next.start), ctx.tz), t) + ', ' + win.next.title));
  }

  function agRow(e, time) {
    const bar = h('span', 'ag-bar');
    bar.style.backgroundColor = e.color || NEUTRAL;
    return h('div', 'ag-row', '', [bar, h('span', 'ag-t', time), h('span', 'ag-title', e.title)]);
  }

  function earlierOrLater() {
    return win.loadedFrom && win.days[0].ymd < win.loadedFrom ? "Earlier weeks aren't loaded. The frame keeps this week onward." : "Days this far ahead aren't loaded yet.";
  }

  function hourLabel(hh) {
    return (hh % 12 || 12) + (hh < 12 ? ' AM' : ' PM');
  }

  function renderDay() {
    const d = win.days[0];
    if (!d.loaded) {
      note(earlierOrLater());
      return;
    }
    if (d.allDay.length) body.appendChild(h('div', 'allday-strip', '', d.allDay.map((e) => chip(e))));
    const lay = layoutDay(d.timed, d.ymd, ctx.tz, DAY_GRID);
    const px = DAY_GRID.pxPer30 / 30;
    const scroll = h('div', 'cal-scroll grid-scroll');
    const grid = h('div', 'day-grid');
    grid.style.height = Math.round(lay.minutes * px) + 'px';
    for (let hh = DAY_GRID.startH; hh <= DAY_GRID.endH; hh++) {
      const y = (hh - DAY_GRID.startH) * 60 * px;
      const line = h('div', 'hour-line');
      line.style.top = y + 'px';
      grid.appendChild(line);
      const lab = h('div', 'hour-label', hourLabel(hh));
      lab.style.top = y + 'px';
      grid.appendChild(lab);
    }
    const cols = h('div', 'day-cols');
    grid.appendChild(cols);
    for (const b of lay.blocks) {
      const el = h('div', 'blk', '', [h('div', 'blk-title', b.title), h('div', 'blk-time', clockLabel(b.start, ctx.tz) + ' – ' + clockLabel(b.end, ctx.tz))]);
      place(el, b, px);
      cols.appendChild(el);
    }
    for (const m of lay.more) {
      const el = h('div', 'blk-more', '+' + m.n);
      el.style.top = Math.round(m.top * px) + 'px';
      cols.appendChild(el);
    }
    if (d.ymd === today()) nowLine(cols, DAY_GRID, px);
    scroll.appendChild(grid);
    body.appendChild(scroll);
    const extra = [];
    if (lay.outside.before) extra.push(lay.outside.before + ' before 6 AM');
    if (lay.outside.after) extra.push(lay.outside.after + ' after 10 PM');
    if (extra.length) note('Also ' + extra.join(', ') + '.');
    else if (!d.allDay.length && !d.timed.length) note('Nothing on this day.');
    // Start the scroll an hour before now (today) or at the first event.
    const first = d.ymd === today() ? minutesOfDay(ctx.now(), ctx.tz) - 60 - DAY_GRID.startH * 60 : lay.blocks.length ? lay.blocks[0].top - 30 : 0;
    scroll.scrollTop = Math.max(0, Math.round(first * px));
  }

  function place(el, b, px) {
    el.style.top = Math.round(b.top * px) + 'px';
    el.style.height = Math.max(18, Math.round(b.height * px) - 2) + 'px';
    el.style.left = (b.col * 100) / b.cols + '%';
    el.style.width = 'calc(' + 100 / b.cols + '% - 4px)';
    el.style.backgroundColor = tint(b.color || NEUTRAL, 0.32);
    el.style.borderLeftColor = b.color || NEUTRAL;
    if (b.height * px < 40) el.classList.add('short');
  }

  function nowLine(container, grid, px) {
    const m = minutesOfDay(ctx.now(), ctx.tz) - grid.startH * 60;
    if (m < 0 || m > (grid.endH - grid.startH) * 60) return;
    const line = h('div', 'now-line');
    line.style.top = Math.round(m * px) + 'px';
    container.appendChild(line);
  }

  function renderWeek() {
    const t = today();
    const px = 540 / ((WEEK_GRID.endH - WEEK_GRID.startH) * 60);
    const head = h('div', 'wk-head');
    const all = h('div', 'wk-all');
    const grid = h('div', 'wk-grid');
    grid.style.height = '540px';
    for (let hh = WEEK_GRID.startH; hh <= WEEK_GRID.endH; hh += 2) {
      const y = (hh - WEEK_GRID.startH) * 60 * px;
      const line = h('div', 'hour-line');
      line.style.top = y + 'px';
      grid.appendChild(line);
      const lab = h('div', 'hour-label', hourLabel(hh));
      lab.style.top = y + 'px';
      grid.appendChild(lab);
    }
    const cols = h('div', 'wk-cols');
    grid.appendChild(cols);
    let unloaded = false;
    let hidden = 0;
    for (const d of win.days) {
      head.appendChild(h('div', 'wk-day' + (d.ymd === t ? ' today' : ''), shortDow(d.ymd) + ' ' + Number(d.ymd.slice(8, 10))));
      const cell = h('div', 'wk-all-cell');
      const col = h('div', 'wk-col' + (d.loaded ? '' : ' unloaded'));
      if (!d.loaded) unloaded = true;
      else {
        for (const e of d.allDay.slice(0, 2)) cell.appendChild(chip(e, 'cal-chip small'));
        if (d.allDay.length > 2) cell.appendChild(h('div', 'chip-more', '+' + (d.allDay.length - 2)));
        const lay = layoutDay(d.timed, d.ymd, ctx.tz, WEEK_GRID);
        for (const b of lay.blocks) {
          const el = h('div', 'blk small', '', [h('div', 'blk-title', b.title)]);
          place(el, b, px);
          col.appendChild(el);
        }
        for (const m of lay.more) {
          const el = h('div', 'blk-more small', '+' + m.n);
          el.style.top = Math.round(m.top * px) + 'px';
          col.appendChild(el);
        }
        hidden += lay.outside.before + lay.outside.after;
        if (d.ymd === t) nowLine(col, WEEK_GRID, px);
      }
      all.appendChild(cell);
      cols.appendChild(col);
    }
    body.appendChild(head);
    body.appendChild(all);
    body.appendChild(grid);
    if (unloaded) note(earlierOrLater());
    else if (hidden) note(hidden + ' event' + (hidden === 1 ? '' : 's') + ' outside 7 AM – 9 PM; open Day to see them.');
  }

  function render() {
    if (!view) return;
    for (const b of seg.children) b.classList.toggle('on', b.getAttribute('data-v') === view);
    renderTitle();
    clear(body);
    body.className = 'cal-body view-' + view;
    if (!win) {
      note(failed ? "Can't reach the calendar right now. It will retry." : loading ? 'Loading…' : '');
      return;
    }
    if (view === 'day') renderDay();
    else if (view === 'week') renderWeek();
    else renderAgenda();
  }

  return {
    show() {
      view = ctx.settings().calendar.view || 'agenda';
      anchor = today();
      render();
      load(false);
    },
    tick() {
      if (view && !loading && ctx.now() - fetchedAt > 5 * CACHE_MS) load(true);
    },
    invalidate() {
      winKey = '';
      if (view) load(true);
    },
    onTap(el, act) {
      if (act === 'cal-view') setView(el.getAttribute('data-v'));
      else if (act === 'cal-prev' || act === 'cal-next') {
        anchor = stepAnchor(view, anchor, act === 'cal-prev' ? -1 : 1);
        render();
        load(false);
      } else if (act === 'cal-today') {
        anchor = today();
        render();
        load(false);
      } else if (act === 'cal-cals') ctx.openCalendars();
    },
  };
}
