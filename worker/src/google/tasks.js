// Google Tasks (PLAN-v2.md §4.1). Uses the calendar grant, which asks for the full `tasks` scope.
// Only {id, list, title, due, parent, position} survive; notes are never fetched. Titles and list names
// are never logged: log lines carry counts and HTTP status codes only.
import { ymdIn } from '../../../shared/time.js';
import { getCache, putCache, getMeta, setMeta, nowIso } from '../db.js';
import { accessToken, grantHasScope, TASKS_SCOPE } from './oauth.js';
import { log } from '../http.js';

/**
 * Free-plan budget (50 subrequests per invocation): a cron run spends at most 1 token refresh + 1 weather
 * + 25 calendars, so tasks get 1 request per selected list and the selection is capped at 10 (37 total).
 */
export const MAX_LISTS = 10;
/** The cron refreshes tasks when the last good fetch is older than this (D1 writes: ≤ 2 per refresh). */
export const REFRESH_MS = 15 * 60000;
export const TASKS_KEY = 'tasks';
/** Fallback when no list has been picked (or loaded) yet: Google's default list. */
export const DEFAULT_LIST = '@default';

const API = 'https://tasks.googleapis.com/tasks/v1';
const MAX_TITLE = 120;
const LIST_RE = /^[A-Za-z0-9_@-]{1,128}$/;
const TASK_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const validListId = (s) => typeof s === 'string' && LIST_RE.test(s);
export const validTaskId = (s) => typeof s === 'string' && TASK_RE.test(s);

const authHeaders = (token) => ({ Authorization: 'Bearer ' + token, Accept: 'application/json' });

export function tasksUrl(listId) {
  const q = new URLSearchParams({ showCompleted: 'false', showHidden: 'false', maxResults: '100', fields: 'items(id,title,due,status,parent,position)' });
  return API + '/lists/' + encodeURIComponent(listId) + '/tasks?' + q.toString();
}

/** Keeps open tasks with a title; `due` is a date only (Google drops the time). */
export function normalizeTasks(items, listId) {
  const out = [];
  for (const t of items || []) {
    if (!t || !validTaskId(t.id) || t.status === 'completed') continue;
    const title = String(t.title || '').trim();
    if (!title) continue;
    const due = typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? t.due.slice(0, 10) : null;
    const o = { id: t.id, list: listId, title: title.slice(0, MAX_TITLE), due, pos: String(t.position || '') };
    if (validTaskId(t.parent)) o.parent = t.parent;
    out.push(o);
  }
  return out;
}

export async function tasksScope(db) {
  return grantHasScope(db, 'calendar', TASKS_SCOPE);
}

/** The lists to fetch: the selected ones, or Google's default list when nothing is selected. */
export async function selectedLists(db) {
  const { results } = await db.prepare('SELECT id, title FROM tasklists WHERE selected = 1 ORDER BY position LIMIT ?').bind(MAX_LISTS).all();
  if (results.length) return results;
  const d = await db.prepare('SELECT id, title FROM tasklists WHERE is_default = 1').first();
  return [d || { id: DEFAULT_LIST, title: 'Tasks' }];
}

export async function listTaskLists(db) {
  const { results } = await db.prepare('SELECT id, title, selected, is_default FROM tasklists ORDER BY position').all();
  return results.map((r) => ({ id: r.id, title: r.title, selected: !!r.selected, default: !!r.is_default }));
}

/**
 * On demand (Settings or /admin): reads the account's task lists into D1, keeping the selection. The
 * first load selects the default list. Zero lists is recorded (meta tasks_lists_empty) for health.
 */
export async function syncTaskLists(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  if (!(await tasksScope(db))) return { ok: false, error: 'tasks_scope_missing' };
  const token = await accessToken(env, 'calendar', { fetchImpl, nowMs });
  if (!token) return { ok: false, error: 'reconnect_calendar' };
  const q = new URLSearchParams({ maxResults: '100', fields: 'items(id,title)' });
  let res;
  let def;
  try {
    [res, def] = await Promise.all([
      fetchImpl(API + '/users/@me/lists?' + q.toString(), { headers: authHeaders(token) }),
      fetchImpl(API + '/users/@me/lists/' + DEFAULT_LIST + '?fields=id', { headers: authHeaders(token) }),
    ]);
  } catch {
    return { ok: false, error: 'tasks_fetch' };
  }
  if (res.status === 401 || res.status === 403) {
    log('tasks_lists_error', { status: res.status });
    return { ok: false, error: res.status === 403 ? 'tasks_unavailable' : 'reconnect_calendar' };
  }
  if (!res.ok) {
    log('tasks_lists_error', { status: res.status });
    return { ok: false, error: 'tasks_http_' + res.status };
  }
  const body = await res.json();
  const items = (body.items || []).filter((l) => l && validListId(l.id));
  let defaultId = null;
  try {
    if (def.ok) defaultId = (await def.json()).id || null;
  } catch {
    defaultId = null;
  }
  if (!items.length) {
    await setMeta(db, 'tasks_lists_empty', nowIso(nowMs));
    log('tasks_lists', { count: 0 });
    return { ok: false, error: 'no_task_lists' }; // never wipe the selection on an empty reply
  }
  if (!defaultId) defaultId = items[0].id; // Google lists the default first
  const had = await db.prepare('SELECT COUNT(*) AS n FROM tasklists').first();
  const first = !had || !had.n;
  const ts = nowIso(nowMs);
  const stmts = items.map((l, i) =>
    db
      .prepare(
        `INSERT INTO tasklists (id, title, selected, position, is_default, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, position = excluded.position, is_default = excluded.is_default, updated_at = excluded.updated_at`,
      )
      .bind(l.id, String(l.title || 'Untitled list').slice(0, MAX_TITLE), first && l.id === defaultId ? 1 : 0, i, l.id === defaultId ? 1 : 0, ts),
  );
  stmts.push(db.prepare('DELETE FROM tasklists WHERE updated_at <> ?').bind(ts));
  stmts.push(db.prepare("DELETE FROM meta WHERE key = 'tasks_lists_empty'"));
  await db.batch(stmts);
  log('tasks_lists', { count: items.length });
  return { ok: true, count: items.length };
}

/** Replaces the list selection: known ids only, at most MAX_LISTS. */
export async function setTaskListSelection(db, ids) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some((x) => !validListId(x))) return { ok: false, error: 'bad_selection' };
  const uniq = [...new Set(ids)];
  if (uniq.length > MAX_LISTS) return { ok: false, error: 'too_many_lists' };
  const known = new Set((await db.prepare('SELECT id FROM tasklists').all()).results.map((r) => r.id));
  if (uniq.some((id) => !known.has(id))) return { ok: false, error: 'unknown_list' };
  await db.batch([db.prepare('UPDATE tasklists SET selected = 0'), ...uniq.map((id) => db.prepare('UPDATE tasklists SET selected = 1 WHERE id = ?').bind(id))]);
  return { ok: true, selected: uniq.length };
}

/**
 * Cron step (and after a selection change, with force): one tasks.list per selected list, in parallel.
 * Skipped while the last good fetch is < 15 min old. The cache row is only rewritten when the content
 * changed; meta tasks_ok_at is stamped on every good fetch (so ≤ 2 D1 writes per refresh).
 */
export async function refreshTasks(env, { fetchImpl = fetch, nowMs = Date.now(), force = false } = {}) {
  const db = env.FRAME_DB;
  if (!(await tasksScope(db))) return { ok: false, reason: 'no_scope' };
  if (!force) {
    const okAt = await getMeta(db, 'tasks_ok_at');
    if (okAt && nowMs - Date.parse(okAt) < REFRESH_MS) return { ok: true, skipped: true };
  }
  const token = await accessToken(env, 'calendar', { fetchImpl, nowMs });
  if (!token) return { ok: false, reason: 'no_grant' };
  const lists = await selectedLists(db);
  const results = await Promise.all(
    lists.map(async (l) => {
      try {
        const res = await fetchImpl(tasksUrl(l.id), { headers: authHeaders(token) });
        if (!res.ok) return { ok: false, status: res.status };
        const body = await res.json();
        return { ok: true, tasks: normalizeTasks(body.items, l.id) };
      } catch {
        return { ok: false, status: 0 };
      }
    }),
  );
  const good = results.filter((r) => r.ok);
  if (good.length < results.length) log('tasks_error', { failed: results.length - good.length, of: results.length, status: (results.find((r) => !r.ok) || {}).status });
  if (!good.length) {
    // The default list itself is missing: the account has no task lists (Chief's Q11 check).
    if (lists.length === 1 && lists[0].id === DEFAULT_LIST && results[0].status === 404) await setMeta(db, 'tasks_lists_empty', nowIso(nowMs));
    return { ok: false };
  }
  const value = {
    lists: lists.filter((l, i) => results[i].ok).map((l) => ({ id: l.id, title: l.title })),
    tasks: [].concat(...good.map((r) => r.tasks)),
    failed: results.length - good.length,
  };
  const old = await getCache(db, TASKS_KEY);
  const changed = !old || JSON.stringify(old.value) !== JSON.stringify(value);
  if (changed) await putCache(db, TASKS_KEY, value, nowMs);
  await setMeta(db, 'tasks_ok_at', nowIso(nowMs));
  // A good fetch means the account has lists again (read first, so the usual case writes nothing).
  if (await getMeta(db, 'tasks_lists_empty')) await db.prepare("DELETE FROM meta WHERE key = 'tasks_lists_empty'").run();
  log('tasks', { lists: lists.length, tasks: value.tasks.length, written: changed });
  return { ok: true, changed, lists: lists.length };
}

/** GET /api/tasks: the cached tasks, with when they were last fetched. */
export async function cachedTasks(env, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const scope = await tasksScope(db);
  if (!scope) return { scope: false, lists: [], tasks: [], fetchedAt: null, stale: false };
  const c = await getCache(db, TASKS_KEY);
  const okAt = await getMeta(db, 'tasks_ok_at');
  const v = c ? c.value : { lists: [], tasks: [] };
  return { scope: true, lists: v.lists || [], tasks: v.tasks || [], fetchedAt: okAt || null, stale: !okAt || nowMs - Date.parse(okAt) > 60 * 60000 };
}

/** /api/state summary for Home and the daily alert: titles due today (≤ 5), and counts. */
export function tasksSummary(t, nowMs, tz) {
  if (!t.scope) return { scope: false, dueToday: [], dueCount: 0, overdue: 0, fetchedAt: null };
  const today = ymdIn(nowMs, tz);
  const due = t.tasks.filter((x) => x.due === today);
  return {
    scope: true,
    dueToday: due.slice(0, 5).map((x) => x.title),
    dueCount: due.length,
    overdue: t.tasks.filter((x) => x.due && x.due < today).length,
    fetchedAt: t.fetchedAt,
  };
}

/**
 * POST /api/tasks/:list/:task/complete. Guards: the task must be in the cache and in a list the frame
 * shows; the body (if any) may only say {status:"completed"}. One tasks.patch; the cache row is
 * updated in place so the next poll doesn't bring the task back.
 */
export async function completeTask(env, listId, taskId, body, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  if (body !== undefined && body !== null) {
    const keys = typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : null;
    if (!keys || keys.some((k) => k !== 'status') || (keys.length && body.status !== 'completed')) return { ok: false, status: 400, error: 'only_complete' };
  }
  if (!validListId(listId) || !validTaskId(taskId)) return { ok: false, status: 400, error: 'bad_id' };
  if (!(await tasksScope(db))) return { ok: false, status: 409, error: 'tasks_scope_missing' };
  const shown = new Set((await selectedLists(db)).map((l) => l.id));
  if (!shown.has(listId)) return { ok: false, status: 403, error: 'list_not_shown' };
  const c = await getCache(db, TASKS_KEY);
  const tasks = (c && c.value.tasks) || [];
  if (!tasks.some((t) => t.list === listId && t.id === taskId)) return { ok: false, status: 404, error: 'unknown_task' };
  const token = await accessToken(env, 'calendar', { fetchImpl, nowMs });
  if (!token) return { ok: false, status: 409, error: 'reconnect_calendar' };
  let res;
  try {
    res = await fetchImpl(API + '/lists/' + encodeURIComponent(listId) + '/tasks/' + encodeURIComponent(taskId) + '?fields=id,status', {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
      body: JSON.stringify({ status: 'completed' }),
    });
  } catch {
    log('task_complete', { status: 0 });
    return { ok: false, status: 502, error: 'tasks_fetch' };
  }
  log('task_complete', { status: res.status });
  if (!res.ok) return { ok: false, status: res.status === 404 ? 404 : 502, error: res.status === 404 ? 'unknown_task' : 'tasks_http_' + res.status };
  // Google keeps subtasks open when a parent completes; the frame does the same.
  c.value.tasks = tasks.filter((t) => !(t.list === listId && t.id === taskId));
  await putCache(db, TASKS_KEY, c.value, nowMs);
  return { ok: true };
}
