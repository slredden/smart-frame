// The navigation rail (PLAN-v2.md §2): 96 px on the left. On every screen but Night it shows on a tap
// on empty space and hides 10 s after the last touch. Unbuilt screens are hidden by `features`, so P1 shows
// Home, Calendar, Weather and Settings; the slots keep their order as later phases switch on.
import { h, icon, clear } from './dom.js';
import { railItems } from './nav.js';

export const ICONS = {
  home: 'M4 13 L14 4 L24 13 M7 11 V24 H21 V11 M12 24 V17 H16 V24',
  calendar: 'M5 7 H23 V24 H5 Z M5 12 H23 M10 4 V9 M18 4 V9 M9 16 H12 M16 16 H19 M9 20 H12',
  tasks: 'M5 6 H11 V12 H5 Z M7 9 L8.5 10.5 L11.5 7 M5 17 H11 V23 H5 Z M15 9 H24 M15 20 H24',
  weather: 'M10 4 V6 M4 10 H6 M5.8 5.8 L7.2 7.2 M14.2 5.8 L12.8 7.2 M7.5 12 A3.5 3.5 0 0 1 13 8 M9 23 H21 A4 4 0 0 0 20 15 A6 6 0 0 0 9 16 A3.5 3.5 0 0 0 9 23 Z',
  photos: 'M4 6 H24 V22 H4 Z M4 19 L10 13 L15 18 L18 15 L24 20 M18 10.5 A1.5 1.5 0 1 0 18 10.4',
  reflection: 'M14 7 C10 4 6 5 4 6 V22 C6 21 10 20 14 23 C18 20 22 21 24 22 V6 C22 5 18 4 14 7 Z M14 7 V23',
  controls: 'M6 5 V23 M14 5 V23 M22 5 V23 M3 9 H9 M11 18 H17 M19 12 H25',
  settings: 'M14 10 A4 4 0 1 0 14 18 A4 4 0 1 0 14 10 Z M14 3 V6 M14 22 V25 M3 14 H6 M22 14 H25 M6.2 6.2 L8.3 8.3 M19.7 19.7 L21.8 21.8 M6.2 21.8 L8.3 19.7 M19.7 8.3 L21.8 6.2',
};

export const LABELS = {
  home: 'Home',
  calendar: 'Calendar',
  tasks: 'Tasks',
  weather: 'Weather',
  photos: 'Photos',
  reflection: 'Reflection',
  controls: 'Controls',
  settings: 'Settings',
};

export function createRail(el) {
  let key = '';
  const items = {};
  const top = h('div', 'rail-top');
  const clock = h('div', 'rail-clock');
  const bottom = h('div', 'rail-bottom');
  el.appendChild(top);
  el.appendChild(clock);
  el.appendChild(bottom);

  function item(view) {
    const b = h('button', 'rail-item', '', [icon(ICONS[view]), h('span', 'rail-label', LABELS[view])]);
    b.type = 'button';
    b.setAttribute('data-rail', view);
    return b;
  }

  return {
    /** Rebuilds the item list when the enabled set changes. */
    setFeatures(features) {
      const list = railItems(features);
      const k = list.join(',');
      if (k === key) return;
      key = k;
      clear(top);
      clear(bottom);
      for (const v of list) {
        items[v] = item(v);
        (v === 'settings' ? bottom : top).appendChild(items[v]);
      }
    },
    setActive(view) {
      for (const v of Object.keys(items)) items[v].classList.toggle('active', v === view);
    },
    setClock(text) {
      if (clock.textContent !== text) clock.textContent = text;
    },
  };
}
