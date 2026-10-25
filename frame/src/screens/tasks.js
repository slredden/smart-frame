// Tasks screen (PLAN-v2.md §4.3, §4.4): tabs ("All" + one per selected list), Overdue / Today /
// Upcoming / No date, subtasks indented. The check circle strikes a row at once and shows a 10 s
// "Done · Undo" toast; the Worker is called only when the toast ends. GET /api/tasks on open, then
// every 5 min while open.
import { h, btn, clear } from '../dom.js';
import { staleLabel } from '../format.js';
import { groupTasks, dueLabel } from '../tasks-view.js';
import { ymdIn } from '../../../shared/time.js';
import { errorText } from './settings.js';

const REFETCH_MS = 5 * 60000;
export const UNDO_MS = 10000;
export const NO_SCOPE_TEXT = 'Connect calendar on /admin to enable Tasks';

const keyOf = (t) => t.list + '/' + t.id;

export function createTasksScreen(root, ctx) {
  let data = null;
  let failed = false;
  let loading = false;
  let fetchedAt = 0;
  let tab = 'all';
  const pending = {}; // key -> true while its toast is up
  const gone = {}; // key -> true once the Worker said done (until the next fetch drops it)

  const bar = h('div', 'toolbar tasks-bar');
  const tabs = h('div', 'task-tabs');
  bar.appendChild(tabs);
  bar.appendChild(btn('Lists', 'task-lists', 'tasks-lists-btn'));
  const meta = h('div', 'tasks-meta');
  const body = h('div', 'tasks-scroll');
  root.appendChild(bar);
  root.appendChild(meta);
  root.appendChild(body);

  async function load() {
    loading = true;
    const r = await ctx.client.tasks();
    loading = false;
    fetchedAt = ctx.now();
    if (r.status === 200 && r.data) {
      data = r.data;
      failed = false;
      for (const k of Object.keys(gone)) if (!data.tasks.some((t) => keyOf(t) === k)) delete gone[k];
    } else failed = true;
    render();
  }

  function renderTabs() {
    clear(tabs);
    const lists = (data && data.lists) || [];
    if (tab !== 'all' && !lists.some((l) => l.id === tab)) tab = 'all';
    const add = (id, label) => tabs.appendChild(btn(label, 'task-tab', 'seg-btn task-tab' + (tab === id ? ' on' : ''), { l: id }));
    add('all', 'All');
    for (const l of lists) add(l.id, l.title || 'List');
  }

  function render() {
    renderTabs();
    clear(body);
    meta.textContent = '';
    if (!data) {
      body.appendChild(h('div', 'cal-note', failed ? "Can't reach tasks right now. It will retry." : loading ? 'Loading…' : ''));
      return;
    }
    if (!data.scope) {
      body.appendChild(h('div', 'cal-note tasks-empty', NO_SCOPE_TEXT));
      return;
    }
    const ms = ctx.now();
    const today = ymdIn(ms, ctx.tz);
    meta.textContent = staleLabel(data.fetchedAt, ms, 60);
    const sections = groupTasks(data.tasks, tab, today, gone);
    if (!sections.length) {
      body.appendChild(h('div', 'cal-note tasks-empty', 'Nothing to do'));
      return;
    }
    for (const s of sections) {
      body.appendChild(h('div', 'task-sec' + (s.key === 'overdue' ? ' overdue' : ''), s.label));
      for (const r of s.rows) {
        const t = r.task;
        const k = keyOf(t);
        const isDone = !!pending[k];
        const check = btn(isDone ? '✓' : '', 'task-check', 'task-check' + (isDone ? ' on' : ''), { k });
        const row = h('div', 'task-row' + (r.depth ? ' sub' : '') + (isDone ? ' done' : '') + (s.key === 'overdue' ? ' overdue' : ''), '', [
          check,
          h('span', 'task-title', t.title),
          h('span', 'task-due', dueLabel(t.due, today)),
        ]);
        body.appendChild(row);
      }
    }
  }

  function check(k) {
    if (!data || !data.scope || pending[k] || gone[k]) return;
    const t = data.tasks.find((x) => keyOf(x) === k);
    if (!t) return;
    pending[k] = true;
    render();
    ctx.toast.show({
      text: 'Done',
      undo: true,
      ms: UNDO_MS,
      onUndo() {
        delete pending[k];
        render();
      },
      async onCommit() {
        const r = await ctx.client.completeTask(t.list, t.id);
        delete pending[k];
        if (r.status === 200 && r.data && r.data.ok) {
          gone[k] = true;
          ctx.tasksChanged();
        } else {
          const code = r.data && r.data.error;
          ctx.toast.show({ text: code === 'too_many_writes' ? errorText(code) : "Couldn't mark that done. Try again.", ms: 4000 });
        }
        render();
      },
    });
  }

  return {
    show() {
      render();
      load();
    },
    tick() {
      if (!loading && ctx.now() - fetchedAt > REFETCH_MS) load();
    },
    invalidate() {
      fetchedAt = 0;
    },
    reload: load,
    onTap(el, act) {
      if (act === 'task-tab') {
        tab = el.getAttribute('data-l') || 'all';
        render();
      } else if (act === 'task-check') check(el.getAttribute('data-k'));
      else if (act === 'task-lists') ctx.openTaskLists();
    },
  };
}

const LIST_ERRORS = {
  tasks_scope_missing: NO_SCOPE_TEXT + '.',
  reconnect_calendar: 'Reconnect Google on the admin page to list task lists.',
  no_task_lists: 'Google returned no task lists for this account.',
  too_many_lists: 'That is the most lists the frame can show.',
};
const listError = (code) => LIST_ERRORS[code] || errorText(code);

/** The task-list picker (Settings › Task lists, or "Lists" on the Tasks screen). PUT /api/tasklists/selection. */
export function openTaskListsSheet(ctx, onSaved) {
  let lists = [];
  let max = 10;
  let scope = true;
  const chosen = {};
  ctx.sheet.open({
    title: 'Task lists',
    build(sheetBody, setMsg) {
      const out = h('div', 'cal-picks');
      sheetBody.appendChild(out);
      sheetBody.appendChild(btn('Refresh lists from Google', 'tl-sync', 'wide'));
      const show = () => {
        clear(out);
        lists.forEach((l, i) => {
          const b = h('button', 'cal-pick tap-row' + (chosen[l.id] ? ' on' : ''), '', [h('span', 'pick-name', (l.title || 'List') + (l.default ? ' (default)' : '')), h('span', 'pick-check', chosen[l.id] ? '✓' : '')]);
          b.type = 'button';
          b.setAttribute('data-act', 'tl-pick');
          b.setAttribute('data-i', String(i));
          out.appendChild(b);
        });
        if (!scope) out.appendChild(h('div', 'cal-note', NO_SCOPE_TEXT + '.'));
        else if (!lists.length) out.appendChild(h('div', 'cal-note', 'No task lists loaded yet. Tap Refresh.'));
      };
      const take = (d) => {
        lists = d.lists || [];
        max = d.max || max;
        if (d.scope === false) scope = false;
        for (const l of lists) chosen[l.id] = !!l.selected;
        show();
      };
      setMsg('Loading…');
      ctx.client.tasklists().then((r) => {
        if (r.status === 200 && r.data) {
          take(r.data);
          setMsg('');
        } else setMsg("Couldn't load task lists.");
      });
      return {
        async onTap(el, act) {
          if (act === 'tl-pick') {
            const l = lists[Number(el.getAttribute('data-i'))];
            if (!l) return;
            const n = lists.filter((x) => chosen[x.id]).length;
            if (!chosen[l.id] && n >= max) {
              setMsg(listError('too_many_lists'));
              return;
            }
            chosen[l.id] = !chosen[l.id];
            setMsg('');
            show();
          } else if (act === 'tl-sync') {
            setMsg('Refreshing…');
            const r = await ctx.client.syncTaskLists();
            if (r.status === 200 && r.data) {
              scope = true;
              take(r.data);
              setMsg('Up to date.');
            } else setMsg(listError(r.data && r.data.error));
          }
        },
      };
    },
    onDone: async () => {
      if (!lists.length) return true;
      const ids = lists.filter((l) => chosen[l.id]).map((l) => l.id);
      const r = await ctx.client.saveTaskLists(ids);
      if (r.status === 200 && r.data && r.data.ok) {
        onSaved(r.data);
        return true;
      }
      return listError(r.data && r.data.error);
    },
  });
}
