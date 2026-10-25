import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../../shared/settings.js';
import { activeAlerts, step, dismiss, prune, inQuiet, tasksText, eventKey, loadMemory, saveMemory, KEEP_MS, STORE_KEY } from '../../frame/src/alerts.js';
import { groupTasks, dueTodayLine, dueLabel, sectionOf } from '../../frame/src/tasks-view.js';
import { photoOrder } from '../../frame/src/photos.js';
import { createChime } from '../../frame/src/chime.js';
import { chimeSamples, wav, RATE, SECONDS } from '../../tools/make-chime.mjs';
import { rangeLabel } from '../../frame/src/screens/reflection.js';
import { intervalLabel } from '../../frame/src/screens/photos.js';
import { alertsSummary } from '../../frame/src/screens/settings.js';

const TZ = 'America/Denver';
const settings = (alerts) => ({ alerts: Object.assign({}, DEFAULTS.alerts, alerts || {}), schedule: DEFAULTS.schedule });
const ev = (start, title) => ({ title: title || 'Example meeting', start, color: '#4285f4' });
const at = (iso) => Date.parse(iso);
const run = (nowIso, extra) =>
  activeAlerts(Object.assign({ nowMs: at(nowIso), tz: TZ, soon: [], tasks: null, settings: settings() }, extra || {}));

describe('event alerts (PLAN-v2.md §9)', () => {
  // 2026-10-24 09:00 MDT = 15:00Z
  const soon = [ev('2026-10-24T15:00:00Z')];
  it('shows from leadMin before until 5 min after the start', () => {
    expect(run('2026-10-24T14:49:59Z', { soon })).toHaveLength(0);
    expect(run('2026-10-24T14:50:00Z', { soon })).toHaveLength(1);
    expect(run('2026-10-24T15:04:59Z', { soon })).toHaveLength(1);
    expect(run('2026-10-24T15:05:00Z', { soon })).toHaveLength(0);
  });
  it('leadMin 0 turns event alerts off', () => {
    expect(run('2026-10-24T14:59:00Z', { soon, settings: settings({ leadMin: 0 }) })).toHaveLength(0);
  });
  it('skips all-day (no start / na) entries and events starting in quiet hours', () => {
    expect(run('2026-10-24T14:55:00Z', { soon: [{ title: 'Example all-day', na: true }, { title: 'x' }] })).toHaveLength(0);
    // 23:00 MDT = 05:00Z next day: inside the night window.
    expect(run('2026-10-25T04:55:00Z', { soon: [ev('2026-10-25T05:00:00Z')] })).toHaveLength(0);
  });
  it('handles both DST changes (America/Denver)', () => {
    // 2026-11-01 09:00 MST = 16:00Z
    expect(run('2026-11-01T15:50:00Z', { soon: [ev('2026-11-01T16:00:00Z')] })).toHaveLength(1);
    // 2027-03-14 09:00 MDT = 15:00Z
    expect(run('2027-03-14T14:50:00Z', { soon: [ev('2027-03-14T15:00:00Z')] })).toHaveLength(1);
    expect(run('2027-03-14T14:49:00Z', { soon: [ev('2027-03-14T15:00:00Z')] })).toHaveLength(0);
  });
  it('keys change when an event moves, not when it is re-fetched', () => {
    expect(eventKey(ev('2026-10-24T15:00:00Z'))).toBe(eventKey(ev('2026-10-24T15:00:00Z')));
    expect(eventKey(ev('2026-10-24T15:00:00Z'))).not.toBe(eventKey(ev('2026-10-24T15:30:00Z')));
    expect(eventKey(ev('2026-10-24T15:00:00Z'))).not.toContain('Example');
  });
});

describe('tasks alert', () => {
  const tasks = { scope: true, dueCount: 2, overdue: 1 };
  it('fires at tasksAt (09:00) for 30 min, including overdue-only days', () => {
    expect(run('2026-10-24T14:59:00Z', { tasks })).toHaveLength(0);
    const a = run('2026-10-24T15:00:00Z', { tasks });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'tasks', key: 'tasks:2026-10-24', title: '2 tasks due today · 1 overdue' });
    expect(run('2026-10-24T15:29:00Z', { tasks })).toHaveLength(1);
    expect(run('2026-10-24T15:30:00Z', { tasks })).toHaveLength(0);
    expect(run('2026-10-24T15:10:00Z', { tasks: { scope: true, dueCount: 0, overdue: 3 } })).toHaveLength(1);
  });
  it('is silent with nothing due, no scope, or tasks off', () => {
    expect(run('2026-10-24T15:10:00Z', { tasks: { scope: true, dueCount: 0, overdue: 0 } })).toHaveLength(0);
    expect(run('2026-10-24T15:10:00Z', { tasks: { scope: false, dueCount: 2 } })).toHaveLength(0);
    expect(run('2026-10-24T15:10:00Z', { tasks, settings: settings({ tasks: false }) })).toHaveLength(0);
  });
  it('fires when custom quiet hours end if tasksAt falls inside them', () => {
    const s = settings({ quiet: { start: 480, end: 600 } });
    expect(run('2026-10-24T15:10:00Z', { tasks, settings: s })).toHaveLength(0);
    expect(run('2026-10-24T16:00:00Z', { tasks, settings: s })).toHaveLength(1);
  });
  it('fires at 09:00 local on DST days', () => {
    expect(run('2026-11-01T16:00:00Z', { tasks })).toHaveLength(1);
    expect(run('2026-11-01T15:30:00Z', { tasks })).toHaveLength(0);
    expect(run('2027-03-14T15:00:00Z', { tasks })).toHaveLength(1);
  });
  it('tasksText', () => {
    expect(tasksText({ dueCount: 1 })).toBe('1 task due today');
    expect(tasksText({ dueCount: 0, overdue: 2 })).toBe('2 overdue');
  });
});

describe('alert step: once-only, dismiss, quiet, night', () => {
  const base = { tz: TZ, soon: [ev('2026-10-24T15:00:00Z')], tasks: null, settings: settings(), screen: 'home' };
  it('chimes once per alert and remembers dismissals', () => {
    const s1 = step({}, Object.assign({ nowMs: at('2026-10-24T14:52:00Z') }, base));
    expect(s1.banners).toHaveLength(1);
    expect(s1.chime).toBe(true);
    const s2 = step(s1.memory, Object.assign({ nowMs: at('2026-10-24T14:53:00Z') }, base));
    expect(s2.chime).toBe(false);
    expect(s2.banners).toHaveLength(1);
    const d = dismiss(s2.memory, s1.banners[0].key, at('2026-10-24T14:53:00Z'));
    expect(step(d, Object.assign({ nowMs: at('2026-10-24T14:54:00Z') }, base)).banners).toHaveLength(0);
  });
  it('a moved event alerts again', () => {
    const s1 = step({}, Object.assign({ nowMs: at('2026-10-24T14:52:00Z') }, base));
    const moved = Object.assign({}, base, { soon: [ev('2026-10-24T15:05:00Z')] });
    expect(step(s1.memory, Object.assign({ nowMs: at('2026-10-24T14:56:00Z') }, moved)).chime).toBe(true);
  });
  it('no chime with chime off; nothing on the night screen', () => {
    const off = Object.assign({}, base, { settings: settings({ chime: false }) });
    const s = step({}, Object.assign({ nowMs: at('2026-10-24T14:52:00Z') }, off));
    expect(s.banners).toHaveLength(1);
    expect(s.chime).toBe(false);
    const n = step({}, Object.assign({ nowMs: at('2026-10-24T14:52:00Z') }, base, { screen: 'night' }));
    expect(n.banners).toHaveLength(0);
    expect(n.chime).toBe(false);
  });
  it('caps banners at 2 with a +N count', () => {
    const many = Object.assign({}, base, {
      soon: [ev('2026-10-24T15:00:00Z', 'Example a'), ev('2026-10-24T15:01:00Z', 'Example b'), ev('2026-10-24T15:02:00Z', 'Example c')],
    });
    const s = step({}, Object.assign({ nowMs: at('2026-10-24T14:55:00Z') }, many));
    expect(s.banners).toHaveLength(2);
    expect(s.more).toBe(1);
  });
  it('prunes memory after 2 days and survives bad storage', () => {
    const now = at('2026-10-24T15:00:00Z');
    expect(Object.keys(prune({ a: { at: now - KEEP_MS }, b: { at: now - 1000 }, c: null }, now))).toEqual(['b']);
    const store = { v: {}, getItem: (k) => store.v[k] || null, setItem: (k, v) => (store.v[k] = v) };
    saveMemory(store, { x: { at: 1 } });
    expect(loadMemory(store)).toEqual({ x: { at: 1 } });
    store.v[STORE_KEY] = '{bad';
    expect(loadMemory(store)).toEqual({});
    store.v[STORE_KEY] = '[1]';
    expect(loadMemory(store)).toEqual({});
  });
  it('inQuiet: night window, custom wrap, empty range', () => {
    const sch = DEFAULTS.schedule;
    expect(inQuiet(23 * 60, { quiet: 'night' }, sch)).toBe(true);
    expect(inQuiet(12 * 60, { quiet: 'night' }, sch)).toBe(false);
    expect(inQuiet(30, { quiet: { start: 1380, end: 60 } }, sch)).toBe(true);
    expect(inQuiet(120, { quiet: { start: 1380, end: 60 } }, sch)).toBe(false);
    expect(inQuiet(120, { quiet: { start: 60, end: 60 } }, sch)).toBe(false);
  });
});

describe('tasks view', () => {
  const today = '2026-10-24';
  const t = (id, list, due, extra) => Object.assign({ id, list, due, title: 'Example ' + id, pos: id }, extra || {});
  const tasks = [
    t('a', 'L1', '2026-10-22'),
    t('b', 'L1', today),
    t('c', 'L1', today, { parent: 'b' }),
    t('d', 'L2', '2026-10-26'),
    t('e', 'L2', null),
    t('f', 'L2', '2026-10-30', { parent: 'zz' }),
  ];
  it('groups into Overdue / Today / Upcoming / No date with subtasks under parents', () => {
    const g = groupTasks(tasks, 'all', today);
    expect(g.map((s) => s.key)).toEqual(['overdue', 'today', 'upcoming', 'nodate']);
    expect(g[1].rows.map((r) => [r.task.id, r.depth])).toEqual([['b', 0], ['c', 1]]);
    expect(g[2].rows.map((r) => [r.task.id, r.depth])).toEqual([['d', 0], ['f', 0]]);
  });
  it('filters by list tab and hidden (checked-off) tasks', () => {
    expect(groupTasks(tasks, 'L2', today).map((s) => s.key)).toEqual(['upcoming', 'nodate']);
    const g = groupTasks(tasks, 'L1', today, { 'L1/a': true });
    expect(g.map((s) => s.key)).toEqual(['today']);
  });
  it('sectionOf and dueLabel', () => {
    expect(sectionOf({ due: null }, today)).toBe('nodate');
    expect(dueLabel(today, today)).toBe('Today');
    expect(dueLabel('2026-10-22', today)).toBe('Overdue · Oct 22');
    expect(dueLabel('2026-10-26', today)).toBe('Mon');
    expect(dueLabel('2026-11-05', today)).toBe('Nov 5');
    expect(dueLabel(null, today)).toBe('');
  });
  it('dueTodayLine', () => {
    expect(dueTodayLine(null)).toBe('');
    expect(dueTodayLine({ scope: false, dueCount: 2 })).toBe('');
    expect(dueTodayLine({ scope: true, dueCount: 3, overdue: 1, dueToday: ['Example A', 'Example B'] })).toBe('Due today: Example A, Example B · +2');
    expect(dueTodayLine({ scope: true, dueCount: 1, overdue: 0, dueToday: ['Example A'] })).toBe('Due today: Example A');
    expect(dueTodayLine({ scope: true, dueCount: 0, overdue: 1 })).toBe('1 overdue task');
    expect(dueTodayLine({ scope: true, dueCount: 0, overdue: 0 })).toBe('');
  });
});

describe('photo order', () => {
  const items = [{ id: 3 }, { id: 1, fav: true }, { id: 10 }, { id: 2 }];
  it('picked order is numeric; shuffle is stable per seed', () => {
    expect(photoOrder(items, { order: 'picked' }).ids).toEqual(['1', '2', '3', '10']);
    expect(photoOrder(items, {}, 'day1').ids).toEqual(photoOrder(items, {}, 'day1').ids);
    expect(photoOrder(items, {}, 'day1').ids.slice().sort()).toEqual(['1', '10', '2', '3']);
  });
  it('favorites only, with a fallback when there are none', () => {
    expect(photoOrder(items, { favoritesOnly: true }, 's')).toEqual({ ids: ['1'], fallback: false });
    const r = photoOrder([{ id: 1 }, { id: 2 }], { favoritesOnly: true, order: 'picked' });
    expect(r).toEqual({ ids: ['1', '2'], fallback: true });
    expect(photoOrder([], { favoritesOnly: true })).toEqual({ ids: [], fallback: false });
  });
  it('filtering keeps the relative shuffle order', () => {
    const all = photoOrder(items, {}, 'x').ids;
    const minus = photoOrder(items.filter((i) => i.id !== 10), {}, 'x').ids;
    expect(all.filter((id) => id !== '10').length).toBe(3);
    expect(minus.length).toBe(3);
  });
});

describe('chime fallback (PLAN-v2.md §9.3)', () => {
  const fake = (refuse) => {
    const a = { plays: [], refuse, pause() {}, play() {
      a.plays.push({ muted: a.muted, volume: a.volume });
      return a.refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
    } };
    return a;
  };
  it('plays at the set volume', async () => {
    const a = fake(false);
    const c = createChime('x', { make: () => a });
    expect(await c.play(60)).toBe(true);
    expect(a.plays).toEqual([{ muted: false, volume: 0.6 }]);
    expect(c.isBlocked()).toBe(false);
  });
  it('a refused chime plays on the next tap', async () => {
    const a = fake(true);
    const states = [];
    const c = createChime('x', { make: () => a, onState: (s) => states.push(s) });
    expect(await c.play(80)).toBe(false);
    expect(c.hasPending()).toBe(true);
    a.refuse = false;
    c.onTap();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.plays[1]).toEqual({ muted: false, volume: 0.8 });
    expect(c.hasPending()).toBe(false);
    expect(states).toEqual(['blocked', 'ok']);
    c.onTap();
    expect(a.plays).toHaveLength(2);
  });
  it('a tap with nothing pending only unlocks audio, muted', async () => {
    const a = fake(true);
    const c = createChime('x', { make: () => a });
    await c.play(50);
    c.drop();
    a.refuse = false;
    c.onTap();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.plays[1].muted).toBe(true);
  });
});

describe('chime asset', () => {
  it('is a short 8-bit mono WAV, matching the committed chime.wav', () => {
    const s = chimeSamples();
    expect(s.length).toBe(Math.round(RATE * SECONDS));
    const b = Buffer.from(wav(s));
    expect(b.toString('ascii', 0, 4)).toBe('RIFF');
    expect(b.toString('ascii', 8, 12)).toBe('WAVE');
    expect(b.readUInt16LE(22)).toBe(1);
    expect(b.readUInt32LE(24)).toBe(RATE);
    expect(b.readUInt16LE(34)).toBe(8);
    expect(b.equals(readFileSync(new URL('../../frame/public/chime.wav', import.meta.url)))).toBe(true);
    expect(b.length).toBeLessThan(20000);
  });
});

describe('labels', () => {
  it('rangeLabel', () => {
    expect(rangeLabel('2026-10-04', '2026-10-10')).toBe('Oct 4–10');
    expect(rangeLabel('2026-10-28', '2026-11-03')).toBe('Oct 28 – Nov 3');
  });
  it('intervalLabel', () => {
    expect(intervalLabel(15)).toBe('15 s');
    expect(intervalLabel(60)).toBe('1 min');
    expect(intervalLabel(300)).toBe('5 min');
  });
  it('alertsSummary', () => {
    expect(alertsSummary(DEFAULTS.alerts)).toBe('10 min · chime 60%');
    expect(alertsSummary(Object.assign({}, DEFAULTS.alerts, { leadMin: 0 }))).toBe('Tasks only · chime 60%');
    expect(alertsSummary(Object.assign({}, DEFAULTS.alerts, { leadMin: 0, tasks: false }))).toBe('Off');
    expect(alertsSummary(Object.assign({}, DEFAULTS.alerts, { chime: false }))).toBe('10 min · no chime');
  });
});
