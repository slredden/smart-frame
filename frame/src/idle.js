// Touch handling: single taps only. Multi-touch is ignored so the kiosk's two-finger hold menu
// keeps working. Taps are debounced, and the kiosk's optional Menu button area is left alone.

export const DEBOUNCE_MS = 400;
// Bottom-left corner reserved for the kiosk's optional Menu button (72×48 dp, plus margin).
export const MENU_ZONE = { w: 96, h: 72 };

export function inMenuZone(x, y, viewportH) {
  return x <= MENU_ZONE.w && y >= viewportH - MENU_ZONE.h;
}

/**
 * Pure tap filter. Feed it touch events as plain objects; it returns true when a tap should count.
 * events: {type:'start'|'end', touches:number (still down), changed:number, x, y, t}
 */
export function createTapFilter(viewportH = 800) {
  let multi = false;
  let lastTap = -Infinity;
  return function onEvent(e) {
    if (e.type === 'start') {
      if (e.touches > 1) multi = true;
      return false;
    }
    if (e.type === 'cancel') {
      multi = false;
      return false;
    }
    // 'end'
    const allUp = e.touches === 0;
    const wasMulti = multi || e.changed > 1;
    if (allUp) multi = false;
    if (!allUp || wasMulti) return false;
    if (inMenuZone(e.x, e.y, viewportH)) return false;
    if (e.t - lastTap < DEBOUNCE_MS) return false;
    lastTap = e.t;
    return true;
  };
}

/** Wires the filter to a DOM element. Mouse clicks also count, for desktop testing. */
export function attachTaps(el, onTap, now = () => performance.now()) {
  const filter = createTapFilter(window.innerHeight || 800);
  let sawTouch = false;
  el.addEventListener('touchstart', (ev) => {
    sawTouch = true;
    filter({ type: 'start', touches: ev.touches.length, t: now() });
  }, { passive: true });
  el.addEventListener('touchcancel', () => filter({ type: 'cancel' }), { passive: true });
  el.addEventListener('touchend', (ev) => {
    const c = ev.changedTouches[0];
    if (filter({ type: 'end', touches: ev.touches.length, changed: ev.changedTouches.length, x: c ? c.clientX : 0, y: c ? c.clientY : 0, t: now() })) onTap();
  }, { passive: true });
  el.addEventListener('click', (ev) => {
    if (sawTouch) return; // touch devices also fire click; touchend already handled it
    if (filter({ type: 'end', touches: 0, changed: 1, x: ev.clientX, y: ev.clientY, t: now() })) onTap();
  });
}
