// Alert banners (PLAN-v2.md §9.3): 88 px rows over the top of any screen, right of the rail.
// Color, "In 10 min · 9:00 AM · Title", then Open and Dismiss (72 × 72). At most two, then "+n".
import { h, btn, clear } from './dom.js';
import { eventTime } from './format.js';

/** 'In 8 min' / 'Now' / 'Started 3 min ago' for an event start. */
export function whenText(startIso, nowMs) {
  const min = Math.round((Date.parse(startIso) - nowMs) / 60000);
  if (min > 0) return 'In ' + min + ' min';
  if (min === 0) return 'Now';
  return 'Started ' + -min + ' min ago';
}

export function bannerText(b, nowMs, tz) {
  if (b.kind === 'event') return whenText(b.start, nowMs) + ' · ' + eventTime(b.start, tz) + ' · ' + (b.title || '');
  return b.title;
}

export function renderBanners(root, res, nowMs, tz, stale) {
  clear(root);
  for (const b of res.banners) {
    const chip = h('span', 'alert-chip' + (b.kind === 'tasks' ? ' tasks' : ''));
    if (b.color) chip.style.backgroundColor = b.color;
    const text = h('span', 'alert-text', bannerText(b, nowMs, tz) + (stale ? ' (may be out of date)' : ''));
    root.appendChild(
      h('div', 'alert', '', [
        chip,
        text,
        btn('Open', 'alert-open', 'alert-btn', { k: b.key, kind: b.kind }),
        btn('✕', 'alert-dismiss', 'alert-btn icon-btn', { k: b.key }),
      ]),
    );
  }
  if (res.more > 0) root.appendChild(h('div', 'alert-more', '+' + res.more + ' more'));
  root.classList.toggle('open', res.banners.length > 0);
}
