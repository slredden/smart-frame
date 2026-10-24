import { describe, it, expect } from 'vitest';
import { createTapFilter, inMenuZone, DEBOUNCE_MS } from '../../frame/src/idle.js';

const tapAt = (f, t, x = 600, y = 400) => {
  f({ type: 'start', touches: 1, t });
  return f({ type: 'end', touches: 0, changed: 1, x, y, t: t + 80 });
};

describe('tap filter', () => {
  it('counts a single tap', () => {
    expect(tapAt(createTapFilter(), 0)).toBe(true);
  });

  it('debounces rapid taps', () => {
    const f = createTapFilter();
    expect(tapAt(f, 0)).toBe(true);
    expect(tapAt(f, DEBOUNCE_MS - 200)).toBe(false);
    expect(tapAt(f, DEBOUNCE_MS + 200)).toBe(true);
  });

  it('ignores two-finger gestures (the kiosk menu)', () => {
    const f = createTapFilter();
    f({ type: 'start', touches: 1, t: 0 });
    f({ type: 'start', touches: 2, t: 10 });
    expect(f({ type: 'end', touches: 1, changed: 1, x: 600, y: 400, t: 3000 })).toBe(false);
    expect(f({ type: 'end', touches: 0, changed: 1, x: 600, y: 400, t: 3010 })).toBe(false);
    expect(tapAt(f, 5000)).toBe(true); // resets afterwards
  });

  it('ignores taps in the menu button corner', () => {
    expect(inMenuZone(20, 780, 800)).toBe(true);
    expect(inMenuZone(200, 780, 800)).toBe(false);
    expect(tapAt(createTapFilter(800), 0, 20, 780)).toBe(false);
  });
});
