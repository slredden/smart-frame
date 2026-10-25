// Reflection screen (PLAN-v2.md §8.1): this week (theme + full practice), this guide's weeks, and up to
// 5 earlier guides. Only already-published fields, from GET /api/reflection (device token). Fetched on
// open, not polled. Past weeks open to their practice; future weeks show the theme only (Q4).
import { h, btn, clear } from '../dom.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct 4–10' / 'Oct 28 – Nov 3' for two ymds. */
export function rangeLabel(a, b) {
  const [, am, ad] = a.split('-').map(Number);
  const [, bm, bd] = b.split('-').map(Number);
  return am === bm ? MONTHS[am - 1] + ' ' + ad + '–' + bd : MONTHS[am - 1] + ' ' + ad + ' – ' + MONTHS[bm - 1] + ' ' + bd;
}

export function createReflectionScreen(root, ctx) {
  let view = null;
  let failed = false;
  let loading = false;

  async function load() {
    loading = true;
    render();
    const r = await ctx.client.reflection();
    loading = false;
    if (r.status === 200 && r.data) {
      view = r.data;
      failed = false;
    } else failed = true;
    render();
  }

  function weekRows(g, src, currentN) {
    const box = h('div', 'refl-weeks');
    for (const w of g.weeks) {
      const label = 'Week ' + w.n + ' · ' + rangeLabel(w.start, w.end);
      const cls = 'refl-week tap-row' + (w.n === currentN ? ' current' : '') + (w.future ? ' future' : '');
      const b = h('button', cls, '', [h('span', 'rw-label', label), h('span', 'rw-theme', w.theme || '')]);
      b.type = 'button';
      if (!w.future) {
        b.setAttribute('data-act', 'refl-week');
        b.setAttribute('data-src', src);
        b.setAttribute('data-n', String(w.n));
      }
      box.appendChild(b);
    }
    return box;
  }

  function render() {
    clear(root);
    if (!view) {
      root.appendChild(h('div', 'cal-note', failed ? "Can't reach the reflection right now." : loading ? 'Loading…' : ''));
      return;
    }
    const g = view.current;
    const wk = g && g.weeks.find((w) => w.n === view.week);
    const left = h('div', 'refl-now');
    if (wk) {
      left.appendChild(h('div', 'refl-kicker', 'Week ' + wk.n + ' of ' + g.weeks.length + ' · ' + rangeLabel(wk.start, wk.end)));
      left.appendChild(h('div', 'refl-big-theme', wk.theme || ''));
      left.appendChild(h('div', 'refl-full-practice', wk.practice || ''));
    } else left.appendChild(h('div', 'refl-empty', 'No reflection for this week yet.'));
    const right = h('div', 'refl-side');
    if (g) {
      right.appendChild(h('div', 'refl-sec', 'This guide · ' + rangeLabel(g.start, g.end)));
      right.appendChild(weekRows(g, 'current', view.week));
    }
    if (view.history && view.history.length) {
      right.appendChild(h('div', 'refl-sec', 'Recent guides'));
      const hist = h('div', 'refl-hist');
      view.history.forEach((x, i) => hist.appendChild(btn(rangeLabel(x.start, x.end), 'refl-guide', 'refl-guide-btn', { i: String(i) })));
      right.appendChild(hist);
    }
    root.appendChild(h('div', 'refl-wrap', '', [left, right]));
  }

  function guideFor(src) {
    if (src === 'current') return view && view.current;
    return view && view.history[Number(src)];
  }

  function openWeek(src, n) {
    const g = guideFor(src);
    const w = g && g.weeks.find((x) => x.n === n);
    if (!w || w.future) return;
    ctx.sheet.open({
      title: 'Week ' + w.n + ' · ' + rangeLabel(w.start, w.end),
      doneLabel: 'Close',
      noCancel: true,
      build(body) {
        body.appendChild(h('div', 'refl-big-theme', w.theme || ''));
        body.appendChild(h('div', 'refl-full-practice', w.practice || ''));
      },
    });
  }

  function openGuide(i) {
    const g = guideFor(String(i));
    if (!g) return;
    ctx.sheet.open({
      title: 'Guide · ' + rangeLabel(g.start, g.end),
      doneLabel: 'Close',
      noCancel: true,
      build(body) {
        body.appendChild(weekRows(g, String(i), null));
        return {
          onTap(el, act) {
            if (act === 'refl-week') openWeek(el.getAttribute('data-src'), Number(el.getAttribute('data-n')));
          },
        };
      },
    });
  }

  return {
    show() {
      load();
    },
    onTap(el, act) {
      if (act === 'refl-week') openWeek(el.getAttribute('data-src'), Number(el.getAttribute('data-n')));
      else if (act === 'refl-guide') openGuide(Number(el.getAttribute('data-i')));
    },
  };
}
