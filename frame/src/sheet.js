// One modal sheet over the content area (the rail stays usable beside it). Settings and the
// Calendars picker open their editors here; nothing is saved until Done (PLAN-v2.md §7.1).
import { h, btn, clear } from './dom.js';

export function createSheet(root) {
  let cur = null;
  const title = h('div', 'sheet-title');
  const body = h('div', 'sheet-body');
  const msg = h('div', 'sheet-msg');
  const done = btn('Done', 'sheet-done', 'primary');
  const cancel = btn('Cancel', 'sheet-cancel');
  const foot = h('div', 'sheet-foot', '', [msg, cancel, done]);
  const panel = h('div', 'sheet-panel', '', [title, body, foot]);
  root.appendChild(panel);

  function close() {
    cur = null;
    root.classList.remove('open');
    clear(body);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  async function finish() {
    if (!cur || cur.busy) return;
    cur.busy = true;
    msg.textContent = 'Saving…';
    let r;
    try {
      r = cur.onDone ? await cur.onDone() : true;
    } catch {
      r = 'Something went wrong. Try again.';
    }
    if (!cur) return;
    cur.busy = false;
    if (r === true) close();
    else msg.textContent = typeof r === 'string' ? r : '';
  }

  return {
    /** spec: {title, build(body, setMsg) -> {onTap?(el)}, onDone() -> true | 'error text', doneLabel, noCancel, wide} */
    open(spec) {
      clear(body);
      msg.textContent = '';
      title.textContent = spec.title;
      panel.className = 'sheet-panel' + (spec.wide ? ' wide' : '');
      done.textContent = spec.doneLabel || 'Done';
      cancel.style.display = spec.noCancel ? 'none' : '';
      cur = { onDone: spec.onDone, busy: false, handlers: {} };
      cur.handlers = spec.build(body, (t) => (msg.textContent = t || '')) || {};
      root.classList.add('open');
    },
    close,
    isOpen: () => !!cur,
    /** Routes a tap inside the sheet. Returns true when the sheet consumed it. */
    onTap(el) {
      if (!cur) return false;
      const act = el && el.closest ? el.closest('[data-act]') : null;
      const a = act ? act.getAttribute('data-act') : '';
      if (a === 'sheet-done') finish();
      else if (a === 'sheet-cancel') close();
      else if (act && cur.handlers.onTap) cur.handlers.onTap(act, a);
      return true;
    },
  };
}
