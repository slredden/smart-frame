import { describe, it, expect } from 'vitest';
import { HOME, NIGHT, SETTINGS, RAIL_PEEK_S, NO_IDLE, keepsAwake, initialState, railItems, viewEnabled, awake, screenAt, railShown, msUntilRailHides, tap, msUntilIdle } from '../../frame/src/nav.js';
import { minutesOfDay } from '../../shared/time.js';

const IDLE = 10 * 60000;
const PEEK = RAIL_PEEK_S * 1000;
const m = (h, mm = 0) => h * 60 + mm;
const P1 = { calendar: true, weather: true };

describe('rail items', () => {
  it('shows Home, the built screens in rail order, and Settings last', () => {
    expect(railItems({})).toEqual(['home', SETTINGS]);
    expect(railItems(P1)).toEqual(['home', 'calendar', 'weather', SETTINGS]);
    const all = { calendar: true, tasks: true, weather: true, photos: true, reflection: true, controls: true };
    expect(railItems(all)).toEqual(['home', 'calendar', 'tasks', 'weather', 'photos', 'reflection', 'controls', SETTINGS]);
  });

  it('only counts flags that are exactly true, and Settings can never be hidden', () => {
    expect(railItems({ calendar: 'yes', weather: 1, settings: false })).toEqual(['home', SETTINGS]);
    expect(viewEnabled(SETTINGS, { settings: false })).toBe(true);
    expect(viewEnabled('reflection', P1)).toBe(false);
    expect(viewEnabled('calendar', P1)).toBe(true);
  });
});

describe('taps (PLAN-v2.md §2.3)', () => {
  it('night: a tap wakes to Home with the rail peeking, never a widget or rail item', () => {
    for (const target of [null, { go: 'weather' }, { rail: 'calendar' }]) {
      const s = tap(initialState(), 0, NIGHT, target);
      expect(screenAt(s, m(23), 0, IDLE)).toBe(HOME);
      expect(railShown(s, HOME, 0)).toBe(true);
    }
  });

  it('Home: a widget opens its screen; the rail stays as it was', () => {
    const s = tap(initialState(), 0, HOME, { go: 'weather' });
    expect(screenAt(s, m(12), 0, IDLE)).toBe('weather');
    expect(railShown(s, 'weather', 0)).toBe(false);
    const c = tap(initialState(), 0, HOME, { go: 'calendar' });
    expect(screenAt(c, m(12), 0, IDLE)).toBe('calendar');
    // With the rail up, the widget tap restarts its 10 s.
    let u = tap(initialState(), 0, HOME, null);
    u = tap(u, 4000, HOME, { go: 'weather' });
    expect(railShown(u, 'weather', 4000 + PEEK - 1)).toBe(true);
    expect(railShown(u, 'weather', 4000 + PEEK)).toBe(false);
  });

  it('the rail hides after 10 s', () => {
    expect(RAIL_PEEK_S).toBe(10);
  });

  it('empty space shows the rail for 10 s on every screen, and another tap restarts it', () => {
    for (const scr of [HOME, 'calendar', 'tasks', 'weather', 'photos', 'reflection', 'settings', 'controls']) {
      let s = { view: scr, lastTouchMono: 0, peekUntilMono: null };
      expect(railShown(s, scr, 0)).toBe(false);
      s = tap(s, 1000, scr, null);
      expect(screenAt(s, m(12), 1000, IDLE)).toBe(scr);
      expect(railShown(s, scr, 1000 + PEEK - 1)).toBe(true);
      expect(railShown(s, scr, 1000 + PEEK)).toBe(false);
      expect(msUntilRailHides(s, scr, 1000)).toBe(PEEK);
      s = tap(s, 8000, scr, null);
      expect(railShown(s, scr, 8000 + PEEK - 1)).toBe(true);
      expect(msUntilRailHides(s, scr, 8000 + PEEK)).toBe(null);
    }
  });

  it('a control works without toggling the rail: it restarts a showing rail and leaves a hidden one hidden', () => {
    let s = tap({ view: 'tasks', lastTouchMono: 0, peekUntilMono: null }, 0, 'tasks', null);
    s = tap(s, 9000, 'tasks', { control: true });
    expect(screenAt(s, m(12), 9000, IDLE)).toBe('tasks');
    expect(railShown(s, 'tasks', 9000 + PEEK - 1)).toBe(true);
    expect(railShown(s, 'tasks', 9000 + PEEK)).toBe(false);
    s = tap(s, 30000, 'tasks', { control: true });
    expect(railShown(s, 'tasks', 30000)).toBe(false);
    expect(msUntilIdle(s, 30000, IDLE)).toBe(IDLE);
    // On Home too: a control (e.g. a disabled widget's banner button) doesn't peek.
    const hm = tap(initialState(), 0, HOME, { control: true });
    expect(railShown(hm, HOME, 0)).toBe(false);
  });

  it('a rail item works only while the rail shows, and the rail stays 10 s after it', () => {
    // Rail hidden on Home: the tap shows the rail instead of navigating.
    const hidden = tap(initialState(), 0, HOME, { rail: 'calendar' });
    expect(screenAt(hidden, m(12), 0, IDLE)).toBe(HOME);
    expect(railShown(hidden, HOME, 0)).toBe(true);
    const s = tap(hidden, 1000, HOME, { rail: 'calendar' });
    expect(screenAt(s, m(12), 1000, IDLE)).toBe('calendar');
    expect(railShown(s, 'calendar', 1000 + PEEK - 1)).toBe(true);
    expect(railShown(s, 'calendar', 1000 + PEEK)).toBe(false);
    const w = tap(s, 2000, 'calendar', { rail: 'weather' });
    expect(screenAt(w, m(12), 2000, IDLE)).toBe('weather');
    const h = tap(w, 3000, 'weather', { rail: 'home' });
    expect(screenAt(h, m(12), 3000, IDLE)).toBe(HOME);
    expect(railShown(h, HOME, 3000)).toBe(true);
    expect(railShown(h, HOME, 3000 + PEEK)).toBe(false);
    // A hidden rail can't be used on another screen either.
    const late = tap(w, 2000 + PEEK, 'weather', { rail: 'calendar' });
    expect(screenAt(late, m(12), 2000 + PEEK, IDLE)).toBe('weather');
    expect(railShown(late, 'weather', 2000 + PEEK)).toBe(true);
  });

  it('on another screen any tap keeps it open and restarts the idle timer', () => {
    let s = tap(initialState(), 0, HOME, { go: 'calendar' });
    s = tap(s, 5000, 'calendar', null);
    expect(screenAt(s, m(12), 5000, IDLE)).toBe('calendar');
    expect(msUntilIdle(s, 5000, IDLE)).toBe(IDLE);
  });

  it('never shows the rail at night', () => {
    const s = { view: HOME, lastTouchMono: 0, peekUntilMono: PEEK };
    expect(railShown(s, NIGHT, 0)).toBe(false);
  });
});

describe('idle', () => {
  it('returns to Home by day after the timeout', () => {
    const s = tap(initialState(), 0, HOME, { go: 'weather' });
    expect(screenAt(s, m(12), IDLE - 1, IDLE)).toBe('weather');
    expect(screenAt(s, m(12), IDLE, IDLE)).toBe(HOME);
  });

  it('returns to the night clock at night after the timeout', () => {
    let s = tap(initialState(), 0, NIGHT, null);
    s = tap(s, 1000, HOME, { go: 'calendar' });
    expect(screenAt(s, m(23), 1000 + IDLE - 1, IDLE)).toBe('calendar');
    expect(screenAt(s, m(23), 1000 + IDLE, IDLE)).toBe(NIGHT);
    expect(awake(s, 1000 + IDLE, IDLE)).toBe(false);
    expect(msUntilIdle(s, 1000 + IDLE, IDLE)).toBe(null);
  });

  it('a tap after idling starts from Home, not the screen left open', () => {
    let s = tap(initialState(), 0, HOME, { go: 'calendar' });
    // Idle: the schedule showed Home, so this tap is a Home tap (peek), not a calendar tap.
    s = tap(s, IDLE * 2, HOME, null);
    expect(screenAt(s, m(12), IDLE * 2, IDLE)).toBe(HOME);
    expect(railShown(s, HOME, IDLE * 2)).toBe(true);
  });

  it('follows the configured idle minutes and schedule', () => {
    const s = tap(initialState(), 0, HOME, { go: 'weather' });
    expect(screenAt(s, m(12), 60000, 60000)).toBe(HOME);
    const sched = { dayStart: m(8), nightStart: m(20) };
    expect(screenAt(initialState(), m(7), 0, IDLE, sched)).toBe(NIGHT);
    expect(screenAt(initialState(), m(8), 0, IDLE, sched)).toBe(HOME);
  });

  it('is not awake before any touch, and a clock going backwards counts as idle', () => {
    expect(awake(initialState(), 0, IDLE)).toBe(false);
    const s = tap(initialState(), 5000, HOME, { go: 'weather' });
    expect(screenAt(s, m(23), 1000, IDLE)).toBe(NIGHT);
  });

  it('never times out on Photos (plain photo frame), while every other screen still returns to Home', () => {
    expect(NO_IDLE).toEqual(['photos']);
    const DAYS = 3 * 86400000;
    let p = tap(initialState(), 0, HOME, null);
    p = tap(p, 1000, HOME, { rail: 'photos' });
    expect(screenAt(p, m(12), 1000, IDLE)).toBe('photos');
    for (const t of [IDLE + 1000, 10 * IDLE, DAYS]) {
      expect(screenAt(p, m(12), t, IDLE)).toBe('photos');
      expect(screenAt(p, m(12), t, 60000)).toBe('photos'); // any idle setting
      expect(msUntilIdle(p, t, IDLE)).toBe(null);
    }
    // Still "not touched lately", so build and 3 AM reloads can wait for a quiet moment.
    expect(awake(p, IDLE + 1000, IDLE)).toBe(false);
    // Night mode doesn't take over Photos either (decided 2026-10-25: leave it so).
    expect(screenAt(p, m(23), DAYS, IDLE)).toBe('photos');
    // Leaving Photos brings the timeout back.
    let c = tap(p, DAYS, 'photos', null);
    c = tap(c, DAYS + 1000, 'photos', { rail: 'calendar' });
    expect(screenAt(c, m(12), DAYS + 1000 + IDLE - 1, IDLE)).toBe('calendar');
    expect(screenAt(c, m(12), DAYS + 1000 + IDLE, IDLE)).toBe(HOME);
    for (const v of ['calendar', 'tasks', 'weather', 'reflection', 'controls', 'settings', HOME]) {
      expect(keepsAwake(v)).toBe(false);
      const s = { view: v, lastTouchMono: 0, peekUntilMono: null };
      expect(screenAt(s, m(12), DAYS, IDLE)).toBe(HOME);
      expect(screenAt(s, m(23), DAYS, IDLE)).toBe(NIGHT);
    }
    // Before any touch Photos isn't showing at all: the schedule decides.
    expect(screenAt({ view: 'photos', lastTouchMono: null, peekUntilMono: null }, m(12), DAYS, IDLE)).toBe(HOME);
  });

  it('uses Denver wall time on both DST change days', () => {
    const tz = 'America/Denver';
    const s = tap(initialState(), 0, HOME, { go: 'weather' });
    // 2026-11-01 (fall back): 10:30 PM MST is night once idle.
    expect(screenAt(s, minutesOfDay(Date.parse('2026-11-02T05:30:00Z'), tz), IDLE, IDLE)).toBe(NIGHT);
    // 2027-03-14 (spring forward): 6:30 AM MDT is Home once idle.
    expect(screenAt(s, minutesOfDay(Date.parse('2027-03-14T12:30:00Z'), tz), IDLE, IDLE)).toBe(HOME);
    expect(screenAt(s, minutesOfDay(Date.parse('2027-03-14T11:30:00Z'), tz), IDLE, IDLE)).toBe(NIGHT);
  });
});
