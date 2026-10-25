// v2 P1b (PLAN-v2.md §4, §6, §8, §9): Tasks, Reflection history, photo flags, per-calendar alerts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { route, runCron } from '../../worker/src/index.js';
import { startAuth, finishAuth } from '../../worker/src/google/oauth.js';
import { refreshTasks, syncTaskLists, MAX_LISTS, TASKS_KEY } from '../../worker/src/google/tasks.js';
import { calendarPayload } from '../../worker/src/google/calendar.js';
import { getCache, setMeta } from '../../worker/src/db.js';
import { encryptText } from '../../worker/src/crypto.js';
import { photoKey } from '../../worker/src/photos.js';
import { ymdIn } from '../../shared/time.js';
import { testEnv, setup, req, auth, ORIGIN, HEALTH, PUBLISH } from './helpers.js';

const CAL = 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const TASKS = 'https://www.googleapis.com/auth/tasks';
const TZ = 'America/Denver';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const dayOff = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function connect(env, scope) {
  const url = new URL(await startAuth(env, 'calendar', ORIGIN));
  const state = url.searchParams.get('state');
  const fetchImpl = async () => json({ access_token: 'at-c', refresh_token: 'rt-c', expires_in: 3600, scope });
  return finishAuth(env, new URL(ORIGIN + '/admin/oauth/callback?state=' + state + '&code=c1'), { fetchImpl });
}

/** Fake Google Tasks API. `lists` = [{id,title}], `tasks` = {listId: items}. Records every call. */
function fakeTasks({ lists = [{ id: 'L1', title: 'Example list' }, { id: 'L2', title: 'Example chores' }], tasks = {}, defaultId = 'L1', patchStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (u, init = {}) => {
    const s = String(u);
    calls.push({ url: s, method: init.method || 'GET', body: init.body });
    if (s.includes('/users/@me/lists/@default')) return defaultId ? json({ id: defaultId }) : json({ error: {} }, 404);
    if (s.includes('/users/@me/lists?')) return json({ items: lists });
    let m = /\/lists\/([^/]+)\/tasks\/([^/?]+)/.exec(s);
    if (m && init.method === 'PATCH') return json({ id: m[2], status: 'completed' }, patchStatus);
    m = /\/lists\/([^/]+)\/tasks\?/.exec(s);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (id === '@default' && !defaultId) return json({ error: {} }, 404);
      return json({ items: tasks[id === '@default' ? defaultId : id] || [] });
    }
    if (s.includes('googleapis.com/calendar')) return json({ items: [] });
    if (s.includes('open-meteo.com')) return json({});
    return new Response('nope', { status: 404 });
  };
  return { calls, fetchImpl };
}

const dev = (token, init = {}) => Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, init.headers || {}) });

describe('tasks: lists, selection and refresh', () => {
  let env;
  let device;
  let logs;
  const now = Date.now();
  const today = ymdIn(now, TZ);
  beforeEach(async () => {
    env = testEnv();
    device = await setup(env);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((s) => logs.push(String(s)));
  });
  afterEach(() => vi.restoreAllMocks());

  it('without the Tasks scope the screen says so and nothing is fetched', async () => {
    await connect(env, CAL);
    const net = fakeTasks();
    const t = await (await route(req('/api/tasks', auth(device.token)), env, { fetchImpl: net.fetchImpl, nowMs: now })).json();
    expect(t).toMatchObject({ scope: false, tasks: [] });
    expect((await refreshTasks(env, { fetchImpl: net.fetchImpl, nowMs: now })).reason).toBe('no_scope');
    const r = await route(req('/api/tasklists/sync', dev(device.token, { method: 'POST' })), env, { fetchImpl: net.fetchImpl, nowMs: now });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('tasks_scope_missing');
    expect(net.calls).toHaveLength(0);
  });

  it('syncs lists (default selected first time), caps the selection at 10 and only known ids', async () => {
    await connect(env, CAL + ' ' + TASKS);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 'L' + (i + 1), title: 'Example list ' + (i + 1) }));
    const net = fakeTasks({ lists: many });
    const r = await (await route(req('/api/tasklists/sync', dev(device.token, { method: 'POST' })), env, { fetchImpl: net.fetchImpl, nowMs: now })).json();
    expect(r.max).toBe(MAX_LISTS);
    expect(r.lists).toHaveLength(12);
    expect(r.lists.filter((l) => l.selected).map((l) => l.id)).toEqual(['L1']);
    expect(r.lists[0].default).toBe(true);
    const put = (selected) => route(req('/api/tasklists/selection', dev(device.token, { method: 'PUT', body: JSON.stringify({ selected }) })), env, { fetchImpl: net.fetchImpl, nowMs: now });
    expect((await put(many.slice(0, 11).map((l) => l.id))).status).toBe(400);
    expect((await put(['L1', 'nope'])).status).toBe(400);
    const ok = await put(many.slice(0, 10).map((l) => l.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).selected).toBe(10);
    // A resync keeps the selection.
    await syncTaskLists(env, { fetchImpl: net.fetchImpl, nowMs: now });
    const g = await (await route(req('/api/tasklists', auth(device.token)), env)).json();
    expect(g.lists.filter((l) => l.selected)).toHaveLength(10);
  });

  it('refresh: one request per selected list, ≤ 37 subrequests per cron, 15-min skip, unchanged skips the cache write', async () => {
    await connect(env, CAL + ' ' + TASKS);
    const lists = Array.from({ length: 10 }, (_, i) => ({ id: 'L' + (i + 1), title: 'Example list ' + (i + 1) }));
    const tasks = { L1: [{ id: 't1', title: 'Example task', due: today + 'T00:00:00.000Z', status: 'needsAction', position: '1', notes: 'never kept' }] };
    const net = fakeTasks({ lists, tasks });
    await syncTaskLists(env, { fetchImpl: net.fetchImpl, nowMs: now });
    await env.FRAME_DB.prepare('UPDATE tasklists SET selected = 1').run();
    net.calls.length = 0;
    await runCron(env, now, net.fetchImpl);
    const taskCalls = net.calls.filter((c) => c.url.includes('tasks.googleapis.com'));
    expect(taskCalls).toHaveLength(10);
    expect(taskCalls.every((c) => c.url.includes('showCompleted=false') && !c.url.includes('notes'))).toBe(true);
    // Calendar (up to 25) + weather (1) + token (≤1) + tasks (10) stays well under 50.
    expect(net.calls.length).toBeLessThanOrEqual(37);
    const cached = await getCache(env.FRAME_DB, TASKS_KEY);
    expect(cached.value.tasks).toEqual([{ id: 't1', list: 'L1', title: 'Example task', due: today, pos: '1' }]);

    net.calls.length = 0;
    expect((await refreshTasks(env, { fetchImpl: net.fetchImpl, nowMs: now + 5 * 60000 })).skipped).toBe(true);
    expect(net.calls).toHaveLength(0);
    const r = await refreshTasks(env, { fetchImpl: net.fetchImpl, nowMs: now + 16 * 60000 });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(logs.some((l) => l.includes('Example'))).toBe(false);
  });

  it('state carries the due-today summary; /api/tasks marks stale after an hour', async () => {
    await connect(env, CAL + ' ' + TASKS);
    const tasks = {
      L1: [
        { id: 't1', title: 'Example due', due: today + 'T00:00:00.000Z', status: 'needsAction' },
        { id: 't2', title: 'Example late', due: dayOff(today, -2) + 'T00:00:00.000Z', status: 'needsAction' },
        { id: 't3', title: 'Example someday', status: 'needsAction' },
        { id: 't4', title: 'Example sub', parent: 't3', status: 'needsAction' },
      ],
    };
    const net = fakeTasks({ tasks });
    await syncTaskLists(env, { fetchImpl: net.fetchImpl, nowMs: now });
    await refreshTasks(env, { fetchImpl: net.fetchImpl, nowMs: now, force: true });
    const s = await (await route(req('/api/state', auth(device.token)), env, { nowMs: now })).json();
    expect(s.tasks).toMatchObject({ scope: true, dueToday: ['Example due'], dueCount: 1, overdue: 1 });
    const t = await (await route(req('/api/tasks', auth(device.token)), env, { nowMs: now + 61 * 60000 })).json();
    expect(t.stale).toBe(true);
    expect(t.tasks.find((x) => x.id === 't4').parent).toBe('t3');
  });

  it('health: tasks_lists_empty when Google has no lists; tasks_stale when refreshes stop', async () => {
    await connect(env, CAL + ' ' + TASKS);
    const empty = fakeTasks({ lists: [], defaultId: null });
    const r = await syncTaskLists(env, { fetchImpl: empty.fetchImpl, nowMs: now });
    expect(r.error).toBe('no_task_lists');
    let h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).toContain('tasks_lists_empty');
    expect(h.problems.filter((p) => p.startsWith('tasks_')).every((p) => !p.startsWith('frame_') && !p.startsWith('grant_'))).toBe(true);
    expect(h.tasks).toMatchObject({ scope: true, listsEmpty: true, lists: 0 });
    // Lists appear: the signal clears; then no refresh for > 60 min is tasks_stale (soft).
    const net = fakeTasks();
    await syncTaskLists(env, { fetchImpl: net.fetchImpl, nowMs: now });
    await setMeta(env.FRAME_DB, 'tasks_ok_at', new Date(Date.now() - 2 * 3600000).toISOString());
    h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).not.toContain('tasks_lists_empty');
    expect(h.problems).toContain('tasks_stale');
    expect(h.problems.filter((p) => p.startsWith('tasks_')).every((p) => !p.startsWith('frame_') && !p.startsWith('grant_'))).toBe(true);
  });

  it('the cron marks tasks_lists_empty when the default list 404s with no selection', async () => {
    await connect(env, CAL + ' ' + TASKS);
    const net = fakeTasks({ lists: [], defaultId: null });
    expect((await refreshTasks(env, { fetchImpl: net.fetchImpl, nowMs: now })).ok).toBe(false);
    let h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).toContain('tasks_lists_empty');
    // The default list comes back: the next good refresh clears the signal without a sync.
    const ok = fakeTasks();
    expect((await refreshTasks(env, { fetchImpl: ok.fetchImpl, nowMs: now + 16 * 60000, force: true })).ok).toBe(true);
    h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.problems).not.toContain('tasks_lists_empty');
  });
});

describe('tasks: check-off', () => {
  let env;
  let device;
  let net;
  let logs;
  const now = Date.now();
  beforeEach(async () => {
    env = testEnv();
    device = await setup(env);
    await connect(env, CAL + ' ' + TASKS);
    net = fakeTasks({ tasks: { L1: [{ id: 't1', title: 'Example task', status: 'needsAction' }], L2: [{ id: 'u1', title: 'Example other', status: 'needsAction' }] } });
    await syncTaskLists(env, { fetchImpl: net.fetchImpl, nowMs: now });
    await refreshTasks(env, { fetchImpl: net.fetchImpl, nowMs: now, force: true });
    net.calls.length = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((s) => logs.push(String(s)));
  });
  afterEach(() => vi.restoreAllMocks());
  const post = (path, token, body) => route(req(path, { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body }), env, { fetchImpl: net.fetchImpl, nowMs: now });

  it('needs the device token', async () => {
    expect((await post('/api/tasks/L1/t1/complete')).status).toBe(401);
    expect((await post('/api/tasks/L1/t1/complete', 'nope.' + 'x'.repeat(20))).status).toBe(401);
    expect(net.calls).toHaveLength(0);
  });

  it('completes a cached task in a shown list with one PATCH, and drops it from the cache', async () => {
    const r = await post('/api/tasks/L1/t1/complete', device.token, '{"status":"completed"}');
    expect(r.status).toBe(200);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].method).toBe('PATCH');
    expect(JSON.parse(net.calls[0].body)).toEqual({ status: 'completed' });
    expect((await getCache(env.FRAME_DB, TASKS_KEY)).value.tasks).toHaveLength(0);
    expect(logs.some((l) => l.includes('Example') || l.includes('t1'))).toBe(false);
  });

  it('refuses tasks not in the cache, lists not shown, and any other body', async () => {
    expect((await post('/api/tasks/L1/zzz/complete', device.token)).status).toBe(404);
    expect((await post('/api/tasks/L2/u1/complete', device.token)).status).toBe(403); // L2 not selected
    expect((await post('/api/tasks/L1/t1/complete', device.token, '{"status":"needsAction"}')).status).toBe(400);
    expect((await post('/api/tasks/L1/t1/complete', device.token, '{"title":"x"}')).status).toBe(400);
    expect((await post('/api/tasks/L1/t1/complete', device.token, '[1]')).status).toBe(400);
    expect((await post('/api/tasks/L1/t%ZZ/complete', device.token)).status).toBe(400);
    expect(net.calls).toHaveLength(0);
  });

  it('counts against the hourly write budget', async () => {
    const { WRITES_PER_HOUR } = await import('../../worker/src/settings.js');
    for (let i = 0; i < WRITES_PER_HOUR; i++) await post('/api/tasks/L1/zzz/complete', device.token);
    expect((await post('/api/tasks/L1/t1/complete', device.token)).status).toBe(429);
    expect(net.calls).toHaveLength(0);
  });
});

const guideAt = (start, label) => {
  const weeks = [0, 1, 2, 3].map((i) => ({ n: i + 1, start: dayOff(start, i * 7), end: dayOff(start, i * 7 + 6), theme: label + ' theme ' + (i + 1), practice: label + ' practice ' + (i + 1) }));
  return { guide: { start, end: dayOff(start, 27) }, weeks };
};

describe('reflection guides', () => {
  let env;
  let device;
  beforeEach(async () => {
    env = testEnv();
    device = await setup(env);
  });
  const publish = (g) => route(req('/api/publish/reflection', { method: 'PUT', headers: { Authorization: 'Bearer ' + PUBLISH, 'content-type': 'application/json' }, body: JSON.stringify(g) }), env);

  it('needs the device token', async () => {
    expect((await route(req('/api/reflection'), env)).status).toBe(401);
  });

  it('migrates the v1 id = 1 row on first read', async () => {
    const g = guideAt('2026-10-18', 'Synthetic');
    const boxed = await encryptText(env.TOKEN_ENC_KEY, JSON.stringify(g), 'reflection');
    await env.FRAME_DB.prepare("INSERT INTO reflection (id, data_enc, updated_at) VALUES (1, ?, '2026-10-18T00:00:00Z')").bind(boxed).run();
    const r = await (await route(req('/api/reflection', auth(device.token)), env, { nowMs: Date.parse('2026-10-26T18:00:00Z') })).json();
    expect(r.current.start).toBe('2026-10-18');
    expect(r.week).toBe(2);
    const n = await env.FRAME_DB.prepare('SELECT COUNT(*) AS n FROM reflection_guides').first();
    expect(n.n).toBe(1);
  });

  it('keeps 6 guides, republish replaces, future weeks show the theme only, future guides hidden', async () => {
    const starts = ['2026-05-03', '2026-05-31', '2026-06-28', '2026-07-26', '2026-08-23', '2026-09-20', '2026-10-18'];
    for (const s of starts) expect((await publish(guideAt(s, 'Synthetic ' + s))).status).toBe(200);
    expect((await publish(guideAt('2026-10-18', 'Synthetic again'))).status).toBe(200);
    const rows = (await env.FRAME_DB.prepare('SELECT start FROM reflection_guides ORDER BY start').all()).results.map((r) => r.start);
    expect(rows).toEqual(starts.slice(1));
    // A guide that starts next month is stored but not shown yet.
    expect((await publish(guideAt('2026-11-15', 'Synthetic next'))).status).toBe(200);
    const r = await (await route(req('/api/reflection', auth(device.token)), env, { nowMs: Date.parse('2026-10-26T18:00:00Z') })).json();
    expect(r.current.start).toBe('2026-10-18');
    expect(r.current.weeks[0].theme).toBe('Synthetic again theme 1');
    expect(r.current.weeks[1].practice).toBe('Synthetic again practice 2');
    expect(r.current.weeks[2]).toEqual({ n: 3, start: '2026-11-01', end: '2026-11-07', theme: 'Synthetic again theme 3', future: true });
    expect(r.history.map((h) => h.start)).toEqual(['2026-09-20', '2026-08-23', '2026-07-26', '2026-06-28']);
    // Health counts every stored guide.
    const h = await (await route(req('/api/health', auth(HEALTH)), env)).json();
    expect(h.reflection.guides).toBe(6);
  });

  it('never logs reflection text', async () => {
    const logs = [];
    vi.spyOn(console, 'log').mockImplementation((s) => logs.push(String(s)));
    await publish(guideAt('2026-10-18', 'Synthetic'));
    await route(req('/api/reflection', auth(device.token)), env);
    vi.restoreAllMocks();
    expect(logs.some((l) => l.includes('Synthetic'))).toBe(false);
  });
});

describe('photo flags', () => {
  let env;
  let device;
  beforeEach(async () => {
    env = testEnv();
    device = await setup(env);
    await env.FRAME_DB.prepare("INSERT INTO photo_sets (set_id, created_at, count, status) VALUES ('sTest01', '2026-10-24T00:00:00Z', 2, 'active')").run();
    await env.FRAME_DB.batch([1, 2].map((n) => env.FRAME_DB.prepare("INSERT INTO photos (set_id, n, w, h, orient, taken, blur) VALUES ('sTest01', ?, 4, 3, 'l', '2019-06', '')").bind(n)));
    await env.FRAME_PHOTOS.put(photoKey('sTest01', 1), new Uint8Array([1]));
  });
  const flag = (n, body, token = device.token) => route(req('/api/photos/sTest01/' + n, { method: 'PUT', headers: token ? { Authorization: 'Bearer ' + token, 'content-type': 'application/json' } : {}, body: JSON.stringify(body) }), env);
  const state = async () => (await route(req('/api/state', auth(device.token)), env)).json();

  it('needs the device token', async () => {
    expect((await flag(1, { hidden: true }, null)).status).toBe(401);
  });

  it('favorite shows in the manifest; hidden leaves it until /admin unhides all', async () => {
    expect((await flag(1, { favorite: true })).status).toBe(200);
    expect((await flag(2, { hidden: true })).status).toBe(200);
    let s = await state();
    expect(s.photos.items.map((i) => [i.id, !!i.fav])).toEqual([['1', true]]);
    expect((await flag(1, { title: 'x' })).status).toBe(400);
    expect((await flag(1, { hidden: 'yes' })).status).toBe(400);
    expect((await flag(9, { hidden: true })).status).toBe(404);
    expect((await route(req('/api/photos/sOther1/1', { method: 'PUT', headers: { Authorization: 'Bearer ' + device.token }, body: '{"hidden":true}' }), env)).status).toBe(409);
    const { unhideAll, hiddenCount } = await import('../../worker/src/photos.js');
    expect(await hiddenCount(env.FRAME_DB)).toBe(1);
    expect(await unhideAll(env.FRAME_DB)).toBe(1);
    s = await state();
    expect(s.photos.items).toHaveLength(2);
  });
});

describe('per-calendar alerts and the soon list', () => {
  it('marks events from alert-off calendars and lists the next 24 h of timed events', () => {
    const now = Date.parse('2026-10-24T18:00:00Z');
    const ev = (title, start, extra = {}) => Object.assign({ title, start, end: start, allDay: false }, extra);
    const events = [
      ev('Example past', '2026-10-24T17:50:00Z'),
      ev('Example soon', '2026-10-24T18:20:00Z'),
      ev('Example muted', '2026-10-24T19:00:00Z', { na: true }),
      ev('Example tomorrow late', '2026-10-25T19:00:00Z'),
      { title: 'Example all day', start: '2026-10-24', end: '2026-10-25', allDay: true },
    ];
    const p = calendarPayload(events, now, 'America/Denver');
    expect(p.soon.map((e) => e.title)).toEqual(['Example soon', 'Example muted']);
    expect(p.soon[1].na).toBe(true);
  });
});
