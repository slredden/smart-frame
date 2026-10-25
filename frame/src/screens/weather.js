// Weather screen (PLAN-v2.md §5): now, the next 24 hours, and 10 days, from the one cached
// Open-Meteo call the Worker already makes (no extra writes). GET /api/weather.
import { h, clear, wxImg } from '../dom.js';
import { temp } from '../format.js';
import { dayLabel } from '../calendar-layout.js';
import { ymdIn } from '../../../shared/time.js';

const REFETCH_MS = 10 * 60000;

/** '7:05 AM' from 'HH:MM'. */
export function hm12(s) {
  if (!s || !/^\d{2}:\d{2}$/.test(s)) return '–';
  const hh = Number(s.slice(0, 2));
  return (hh % 12 || 12) + ':' + s.slice(3) + (hh < 12 ? ' AM' : ' PM');
}

/** '3 PM' from an hourly 'YYYY-MM-DDTHH:MM'. */
export function hourLabel(t) {
  const hh = Number(t.slice(11, 13));
  return (hh % 12 || 12) + (hh < 12 ? ' AM' : ' PM');
}

/** 'Updated just now' / 'Updated 12 min ago' / 'Updated 3 h ago'. */
export function updatedLabel(fetchedAt, nowMs) {
  if (!fetchedAt) return '';
  const min = Math.max(0, Math.floor((nowMs - Date.parse(fetchedAt)) / 60000));
  if (min < 1) return 'Updated just now';
  if (min < 90) return 'Updated ' + min + ' min ago';
  return 'Updated ' + Math.round(min / 60) + ' h ago';
}

const pct = (p) => (typeof p === 'number' ? Math.round(p) + '%' : '–');
const mph = (w) => (typeof w === 'number' ? Math.round(w) + ' mph' : '–');

export function createWeatherScreen(root, ctx) {
  let w = null;
  let fetchedAt = 0;
  let failed = false;
  let loading = false;

  async function load() {
    loading = true;
    const res = await ctx.client.weather();
    loading = false;
    if (res.status === 200 && res.data) {
      w = res.data.weather;
      failed = false;
    } else failed = true;
    fetchedAt = ctx.now();
    render();
  }

  function render() {
    clear(root);
    if (!w) {
      root.appendChild(h('div', 'cal-note', failed ? "Can't reach the weather right now. It will retry." : loading ? 'Loading…' : 'No weather yet.'));
      return;
    }
    const ms = ctx.now();
    const today = (w.daily && w.daily[0]) || {};
    const place = w.place || {};
    const nowBlock = h('div', 'wx-now', '', [
      wxImg(w.now && w.now.icon, 'wx-big'),
      h('div', 'wx-temp', temp(w.now && w.now.tempF)),
      h('div', 'wx-meta', '', [
        h('div', 'wx-label', (w.now && w.now.label) || ''),
        h('div', 'wx-hilo', 'H ' + temp(w.today && w.today.hi) + '   L ' + temp(w.today && w.today.lo)),
        h('div', 'wx-sun', 'Sunrise ' + hm12(today.rise) + '   Sunset ' + hm12(today.set)),
      ]),
      h('div', 'wx-place', '', [
        h('div', 'wx-place-name', place.name || ''),
        h('div', 'wx-upd' + (w.stale ? ' stale' : ''), updatedLabel(w.fetchedAt, ms)),
        place.timeZone && place.timeZone !== ctx.tz ? h('div', 'wx-tz', 'Times shown in Denver time') : null,
      ]),
    ]);
    root.appendChild(nowBlock);

    const strip = h('div', 'wx-hours');
    (w.hourly || []).forEach((x, i) => {
      strip.appendChild(h('div', 'wx-hour', '', [
        h('div', 'wh-t', i === 0 ? 'Now' : hourLabel(x.t)),
        wxImg(x.i, 'wh-i'),
        h('div', 'wh-f', temp(x.f)),
        h('div', 'wh-p', pct(x.p)),
        h('div', 'wh-w', mph(x.w)),
      ]));
    });
    root.appendChild(strip);

    const days = h('div', 'wx-days');
    const t = ymdIn(ms, ctx.tz);
    for (const d of w.daily || []) {
      days.appendChild(h('div', 'wx-day', '', [
        h('div', 'wd-d', dayLabel(d.ymd, t)),
        wxImg(d.i, 'wd-i'),
        h('div', 'wd-hl', temp(d.hi) + ' / ' + temp(d.lo)),
        h('div', 'wd-p', pct(d.p)),
      ]));
    }
    root.appendChild(days);
  }

  return {
    show() {
      render();
      if (!w || ctx.now() - fetchedAt > 60000) load();
    },
    tick() {
      if (!loading && ctx.now() - fetchedAt > REFETCH_MS) load();
    },
    invalidate() {
      fetchedAt = 0;
      load();
    },
  };
}
