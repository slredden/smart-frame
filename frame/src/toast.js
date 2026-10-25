// One toast at a time at the bottom of the screen, with an optional Undo (PLAN-v2.md §4.4, §6).
// A toast with `onCommit` runs it when it times out, or at once when another toast replaces it,
// so an action is never lost by tapping fast. Undo runs `onUndo` and sends nothing.
import { h, btn, clear } from './dom.js';

export function createToast(root) {
  let cur = null;
  let timer = 0;

  function hide() {
    clearTimeout(timer);
    cur = null;
    root.classList.remove('open');
    clear(root);
  }

  function commit() {
    const c = cur;
    hide();
    if (c && c.onCommit) c.onCommit();
  }

  return {
    /** spec: {text, ms, undo?: true, onUndo?, onCommit?} */
    show(spec) {
      if (cur) commit();
      cur = spec;
      clear(root);
      root.appendChild(h('span', 'toast-text', spec.text));
      if (spec.undo) root.appendChild(btn('Undo', 'toast-undo', 'toast-btn'));
      root.classList.add('open');
      timer = setTimeout(commit, spec.ms || 4000);
    },
    undo() {
      const c = cur;
      hide();
      if (c && c.onUndo) c.onUndo();
    },
    flush: () => cur && commit(),
    isOpen: () => !!cur,
  };
}
