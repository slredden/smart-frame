// Hook for real backlight dimming later (decided 2026-10-24: not built now).
// The kiosk has no JS bridge, so the page can't change the backlight today. A future frame-side
// change (for example a tiny local endpoint on the frame) would be called from here.
// Levels: 'night' | 'day'.

let current = null;

export function setBacklight(level) {
  if (level === current) return false;
  current = level;
  return true; // no-op today; returns whether the level changed, for tests
}

export function backlightLevel() {
  return current;
}
