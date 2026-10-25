// Settings screen (PLAN-v2.md §7.1): the everyday knobs, each edited in a sheet with steppers and
// saved with one PUT on Done. Bounds come from shared/settings.js, so nothing here can lock the
// frame out. Secrets, Google connect and pairing stay on /admin.
import { h, btn, clear } from '../dom.js';
import { BOUNDS, validateSetting, minutesLabel } from '../../../shared/settings.js';

export const IDLE_STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];

/** Next value in a list of steps (for idle minutes), clamped to the ends. */
export function stepList(list, v, dir) {
  if (dir > 0) {
    for (const x of list) if (x > v) return x;
    return list[list.length - 1];
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i] < v) return list[i];
  return list[0];
}

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

const ERRORS = {
  schedule_day_too_short: 'Day needs to be at least 8 hours.',
  schedule_day_start: 'Day can start between 4:00 AM and 10:00 AM.',
  schedule_night_start: 'Night can start between 6:00 PM and midnight.',
  too_many_writes: 'Too many changes this hour. Try again later.',
  too_many_calendars: 'That is the most calendars the frame can show.',
  alerts_quiet: 'Quiet hours need a start and an end that differ.',
  reconnect_calendar: 'Reconnect Google on the admin page to list calendars.',
  no_grant: 'Connect Google on the admin page first.',
};
export const errorText = (code) => ERRORS[code] || "Couldn't save. Try again.";

export const scheduleText = (s) => minutesLabel(s.dayStart) + ' – ' + minutesLabel(s.nightStart);

/** 'Off' / 'At start' never happens: 0 means off (PLAN-v2.md §9.5). */
export const leadText = (m) => (m ? m + ' min before' : 'Off');

/** Settings row value: '10 min · chime 60%' / 'Off'. */
export function alertsSummary(a) {
  if (!a.leadMin && !a.tasks) return 'Off';
  return (a.leadMin ? a.leadMin + ' min' : 'Tasks only') + ' · ' + (a.chime ? 'chime ' + a.volume + '%' : 'no chime');
}

/** Settings row value for Controls (PLAN-v2.md §11.7): 'Off' / 'Shown 45 s per tap'. */
export const controlsSummary = (c) => (c && c.indoor ? 'Shown ' + c.revealSec + ' s per tap' : 'Off');

export function createSettingsScreen(root, ctx) {
  const list = h('div', 'set-list');
  root.appendChild(h('div', 'set-head', 'Settings'));
  root.appendChild(list);
  root.appendChild(h('div', 'set-foot', 'Pairing, Google connect and other account settings are on the admin page.'));

  let calSummary = '';
  let listSummary = '';

  /** '3 shown' from a calendars list (selected, or the primary one when nothing is selected). */
  function summarize(cals) {
    const n = (cals || []).filter((c) => c.selected).length;
    calSummary = n ? n + ' shown' : cals && cals.length ? 'Primary only' : 'Not loaded';
  }

  async function loadCals() {
    const r = await ctx.client.calendars();
    if (r.status === 200 && r.data) {
      summarize(r.data.calendars);
      render();
    }
  }

  /** '2 shown' / 'Default list' / 'Not connected' for the Task lists row. */
  function summarizeLists(d) {
    if (d.scope === false) listSummary = 'Not connected';
    else {
      const n = (d.lists || []).filter((l) => l.selected).length;
      listSummary = n ? n + ' shown' : 'Default list';
    }
  }

  async function loadLists() {
    const r = await ctx.client.tasklists();
    if (r.status === 200 && r.data) {
      summarizeLists(r.data);
      render();
    }
  }

  function row(label, value, act) {
    const b = h('button', 'set-row tap-row', '', [h('span', 'set-label', label), h('span', 'set-value', value), h('span', 'set-chev', '›')]);
    b.type = 'button';
    b.setAttribute('data-act', act);
    return b;
  }

  function render() {
    const s = ctx.settings();
    clear(list);
    list.appendChild(row('Day and night', scheduleText(s.schedule), 'set-schedule'));
    list.appendChild(row('Night clock brightness', s.night.dimPct + '%', 'set-night'));
    list.appendChild(row('Back to Home after', s.idle.minutes + ' min', 'set-idle'));
    list.appendChild(row('Weather location', s.weather.name, 'set-weather'));
    list.appendChild(row('Calendars', calSummary, 'set-calendars'));
    list.appendChild(row('Task lists', listSummary, 'set-tasklists'));
    list.appendChild(row('Tasks on Home', s.tasks.onHome ? 'On' : 'Off', 'set-tasks-home'));
    list.appendChild(row('Alerts', alertsSummary(s.alerts), 'set-alerts'));
    list.appendChild(row('Indoor cameras', controlsSummary(s.controls), 'set-controls'));
  }

  /** Saves through the Worker; returns true or the error text for the sheet. */
  async function save(key, patch) {
    const local = validateSetting(key, patch, ctx.settings()[key]);
    if (!local.ok) return errorText(local.error);
    const r = await ctx.saveSetting(key, patch);
    return r === true ? true : errorText(r);
  }

  function stepper(label, get, onStep) {
    const val = h('span', 'step-val', get());
    const wrap = h('div', 'stepper', '', [h('span', 'step-label', label), btn('–', 'step', 'step-btn', { dir: '-1', f: label }), val, btn('+', 'step', 'step-btn', { dir: '1', f: label })]);
    return { el: wrap, refresh: () => (val.textContent = get()), label, onStep };
  }

  function openSteppers(title, key, steppers, extra) {
    ctx.sheet.open({
      title,
      build(body) {
        for (const s of steppers) body.appendChild(s.el);
        if (extra) body.appendChild(extra.el);
        return {
          onTap(el, act) {
            if (act !== 'step') return;
            const s = steppers.find((x) => x.label === el.getAttribute('data-f'));
            if (!s) return;
            s.onStep(Number(el.getAttribute('data-dir')));
            for (const x of steppers) x.refresh();
            if (extra) extra.refresh();
          },
        };
      },
      onDone: () => save(key, steppers.patch()),
    });
  }

  function editSchedule() {
    const b = BOUNDS.schedule;
    const v = Object.assign({}, ctx.settings().schedule);
    const st = [
      stepper('Day starts', () => minutesLabel(v.dayStart), (d) => (v.dayStart = clamp(v.dayStart + d * b.step, b.dayStart))),
      stepper('Night starts', () => minutesLabel(v.nightStart), (d) => (v.nightStart = clamp(v.nightStart + d * b.step, b.nightStart))),
    ];
    st.patch = () => ({ dayStart: v.dayStart, nightStart: v.nightStart });
    openSteppers('Day and night', 'schedule', st);
  }

  function editNight() {
    const b = BOUNDS.night;
    const v = { dimPct: ctx.settings().night.dimPct };
    const preview = h('div', 'dim-preview', '12:00');
    const extra = { el: preview, refresh: () => (preview.style.opacity = String(v.dimPct / 100)) };
    extra.refresh();
    const st = [stepper('Brightness', () => v.dimPct + '%', (d) => (v.dimPct = clamp(v.dimPct + d * b.step, b.dimPct)))];
    st.patch = () => ({ dimPct: v.dimPct });
    openSteppers('Night clock brightness', 'night', st, extra);
  }

  function editIdle() {
    const v = { minutes: ctx.settings().idle.minutes };
    const st = [stepper('Minutes', () => v.minutes + ' min', (d) => (v.minutes = stepList(IDLE_STEPS, v.minutes, d)))];
    st.patch = () => ({ minutes: v.minutes });
    openSteppers('Back to Home after', 'idle', st);
  }

  function editWeather() {
    let picked = null;
    let results = [];
    ctx.sheet.open({
      title: 'Weather location',
      build(body, setMsg) {
        const input = h('input', 'wx-input');
        input.type = 'text';
        input.maxLength = 60;
        input.placeholder = 'City name';
        input.setAttribute('autocomplete', 'off');
        const form = h('form', 'wx-form', '', [input, btn('Search', 'wx-search')]);
        const out = h('div', 'wx-results');
        body.appendChild(form);
        body.appendChild(out);
        const show = () => {
          clear(out);
          results.forEach((p, i) => {
            const b = h('button', 'place-row tap-row' + (picked === p ? ' on' : ''), [p.name, p.admin1, p.country].filter(Boolean).join(', '));
            b.type = 'button';
            b.setAttribute('data-act', 'wx-pick');
            b.setAttribute('data-i', String(i));
            out.appendChild(b);
          });
        };
        const search = async () => {
          const q = input.value.trim();
          if (q.length < 2) {
            setMsg('Type at least two letters.');
            return;
          }
          input.blur();
          setMsg('Searching…');
          const r = await ctx.client.searchPlaces(q);
          if (r.status === 200 && r.data) {
            results = r.data.places || [];
            picked = null;
            setMsg(results.length ? 'Pick one, then Done.' : 'No places found.');
            show();
          } else setMsg(r.data && r.data.error === 'too_many_writes' ? errorText('too_many_writes') : "Couldn't search right now.");
        };
        form.addEventListener('submit', (ev) => {
          ev.preventDefault();
          search();
        });
        return {
          onTap(el, act) {
            if (act === 'wx-search') search();
            else if (act === 'wx-pick') {
              picked = results[Number(el.getAttribute('data-i'))] || null;
              show();
            }
          },
        };
      },
      onDone: async () => {
        if (!picked) return true; // nothing picked: Done just closes
        return save('weather', { name: picked.name, lat: picked.lat, lon: picked.lon, timeZone: picked.timeZone || null });
      },
    });
  }

  function editAlerts() {
    const b = BOUNDS.alerts;
    const v = JSON.parse(JSON.stringify(ctx.settings().alerts));
    const sch = ctx.settings().schedule;
    if (v.quiet !== 'night') v.custom = v.quiet;
    const box = h('div', 'alert-opts');
    const colA = h('div', 'alert-col');
    const colB = h('div', 'alert-col');
    box.appendChild(colA);
    box.appendChild(colB);
    const draw = () => {
      clear(colA);
      clear(colB);
      const step = (label, f, text) => h('div', 'stepper', '', [h('span', 'step-label', label), btn('–', 'step', 'step-btn', { dir: '-1', f }), h('span', 'step-val', text), btn('+', 'step', 'step-btn', { dir: '1', f })]);
      const seg = (label, f, choices) =>
        h('div', 'opt-row', '', [h('span', 'step-label', label), h('div', 'seg', '', choices.map(([val, text, on]) => btn(text, 'opt', 'seg-btn opt-btn' + (on ? ' on' : ''), { f, v: String(val) })))]);
      colA.appendChild(step('Event alert', 'leadMin', leadText(v.leadMin)));
      colA.appendChild(seg('Chime', 'chime', [[true, 'On', v.chime], [false, 'Off', !v.chime]]));
      colA.appendChild(step('Chime volume', 'volume', v.volume + '%'));
      colA.appendChild(btn('Play test chime', 'test-chime', 'wide test-chime'));
      colB.appendChild(seg('Tasks alert', 'tasks', [[true, 'On', v.tasks], [false, 'Off', !v.tasks]]));
      colB.appendChild(step('Tasks alert at', 'tasksAt', minutesLabel(v.tasksAt)));
      colB.appendChild(seg('Quiet hours', 'quiet', [['night', 'Night', v.quiet === 'night'], ['custom', 'Custom', v.quiet !== 'night']]));
      if (v.quiet === 'night') colB.appendChild(h('div', 'opt-note', 'Quiet from ' + minutesLabel(sch.nightStart) + ' to ' + minutesLabel(sch.dayStart) + ' (the night clock).'));
      else {
        colB.appendChild(step('Quiet from', 'qStart', minutesLabel(v.quiet.start)));
        colB.appendChild(step('Quiet until', 'qEnd', minutesLabel(v.quiet.end)));
      }
    };
    draw();
    ctx.sheet.open({
      title: 'Alerts',
      wide: true,
      build(body, setMsg) {
        body.appendChild(box);
        return {
          onTap(el, act) {
            const f = el.getAttribute('data-f');
            const dir = Number(el.getAttribute('data-dir'));
            if (act === 'step') {
              if (f === 'leadMin') v.leadMin = stepList(b.leads, v.leadMin, dir);
              else if (f === 'volume') v.volume = clamp(v.volume + dir * b.volumeStep, b.volume);
              else if (f === 'tasksAt') v.tasksAt = clamp(v.tasksAt + dir * b.step, b.tasksAt);
              else if (f === 'qStart' || f === 'qEnd') {
                const k = f === 'qStart' ? 'start' : 'end';
                const q = Object.assign({}, v.quiet);
                q[k] = (q[k] + dir * b.step + 1440) % 1440;
                if (q.start === q.end) q[k] = (q[k] + dir * b.step + 1440) % 1440;
                v.quiet = q;
                v.custom = q;
              }
            } else if (act === 'opt') {
              const raw = el.getAttribute('data-v');
              if (f === 'quiet') v.quiet = raw === 'night' ? 'night' : v.custom || { start: sch.nightStart % 1440, end: sch.dayStart };
              else v[f] = raw === 'true';
            } else if (act === 'test-chime') {
              setMsg('Playing at ' + v.volume + '%…');
              ctx.testChime(v.volume).then((ok) => setMsg(ok ? 'Played at ' + v.volume + '%. Not loud enough? Raise the media volume on the frame.' : 'Audio is blocked. Tap once more to hear it.'));
              return;
            }
            setMsg('');
            draw();
          },
        };
      },
      onDone: () => save('alerts', { leadMin: v.leadMin, chime: v.chime, volume: v.volume, quiet: v.quiet, tasksAt: v.tasksAt, tasks: v.tasks }),
    });
  }

  /** Settings › Controls (§11.7): indoor cameras off by default; a tap shows one for 30-60 s. */
  function editControls() {
    const b = BOUNDS.controls;
    const v = Object.assign({}, ctx.settings().controls);
    const box = h('div', 'alert-col');
    const draw = () => {
      clear(box);
      box.appendChild(
        h('div', 'opt-row', '', [
          h('span', 'step-label', 'Show indoor cameras'),
          h('div', 'seg', '', [btn('On', 'opt', 'seg-btn opt-btn' + (v.indoor ? ' on' : ''), { v: 'true' }), btn('Off', 'opt', 'seg-btn opt-btn' + (v.indoor ? '' : ' on'), { v: 'false' })]),
        ]),
      );
      box.appendChild(h('div', 'stepper', '', [h('span', 'step-label', 'Show for'), btn('–', 'step', 'step-btn', { dir: '-1' }), h('span', 'step-val', v.revealSec + ' s'), btn('+', 'step', 'step-btn', { dir: '1' })]));
      box.appendChild(h('div', 'opt-note', 'Indoor cameras stay covered until tapped, then cover again. Never at night or on Home.'));
    };
    draw();
    ctx.sheet.open({
      title: 'Indoor cameras',
      build(body) {
        body.appendChild(box);
        return {
          onTap(el, act) {
            if (act === 'opt') v.indoor = el.getAttribute('data-v') === 'true';
            else if (act === 'step') v.revealSec = clamp(v.revealSec + Number(el.getAttribute('data-dir')) * b.step, b.revealSec);
            else return;
            draw();
          },
        };
      },
      onDone: () => save('controls', { indoor: v.indoor, revealSec: v.revealSec }),
    });
  }

  return {
    show() {
      render();
      loadCals();
      loadLists();
    },
    render,
    calendarsSaved(data) {
      summarize(data.calendars);
      render();
    },
    listsSaved(data) {
      summarizeLists(data);
      render();
    },
    onTap(el, act) {
      if (act === 'set-schedule') editSchedule();
      else if (act === 'set-night') editNight();
      else if (act === 'set-idle') editIdle();
      else if (act === 'set-weather') editWeather();
      else if (act === 'set-calendars') ctx.openCalendars();
      else if (act === 'set-tasklists') ctx.openTaskLists();
      else if (act === 'set-tasks-home') save('tasks', { onHome: !ctx.settings().tasks.onHome }).then((r) => r !== true && ctx.toast.show({ text: r, ms: 4000 }));
      else if (act === 'set-alerts') editAlerts();
      else if (act === 'set-controls') editControls();
    },
  };
}

/** The Calendars picker (from Settings or the Calendar toolbar). Saves with PUT /api/calendars/selection. */
export function openCalendarsSheet(ctx, onSaved) {
  let cals = [];
  let max = 10;
  const chosen = {};
  const alertOn = {};
  ctx.sheet.open({
    title: 'Calendars',
    build(body, setMsg) {
      const out = h('div', 'cal-picks');
      body.appendChild(out);
      body.appendChild(btn('Refresh list from Google', 'cals-sync', 'wide'));
      const show = () => {
        clear(out);
        cals.forEach((c, i) => {
          const sw = h('span', 'pick-chip');
          if (c.color) sw.style.backgroundColor = c.color;
          const b = h('button', 'cal-pick tap-row' + (chosen[c.id] ? ' on' : ''), '', [sw, h('span', 'pick-name', c.summary + (c.primary ? ' (primary)' : '')), h('span', 'pick-check', chosen[c.id] ? '✓' : '')]);
          b.type = 'button';
          b.setAttribute('data-act', 'cals-pick');
          b.setAttribute('data-i', String(i));
          // Per-calendar alerts (PLAN-v2.md §9.1): a separate 72 px bell beside the pick row.
          const bell = btn(alertOn[c.id] ? 'Alerts on' : 'Alerts off', 'cals-alert', 'cal-bell' + (alertOn[c.id] ? ' on' : ''), { i: String(i) });
          out.appendChild(h('div', 'cal-pick-row', '', [b, bell]));
        });
        if (!cals.length) out.appendChild(h('div', 'cal-note', 'No calendars loaded yet. Tap Refresh.'));
      };
      const take = (d) => {
        cals = d.calendars || [];
        max = d.max || max;
        for (const c of cals) {
          chosen[c.id] = !!c.selected;
          alertOn[c.id] = c.alert !== false;
        }
        show();
      };
      setMsg('Loading…');
      ctx.client.calendars().then((r) => {
        if (r.status === 200 && r.data) {
          take(r.data);
          setMsg('');
        } else setMsg("Couldn't load calendars.");
      });
      return {
        async onTap(el, act) {
          if (act === 'cals-pick') {
            const c = cals[Number(el.getAttribute('data-i'))];
            if (!c) return;
            const n = cals.filter((x) => chosen[x.id]).length;
            if (!chosen[c.id] && n >= max) {
              setMsg(errorText('too_many_calendars'));
              return;
            }
            chosen[c.id] = !chosen[c.id];
            setMsg('');
            show();
          } else if (act === 'cals-alert') {
            const c = cals[Number(el.getAttribute('data-i'))];
            if (!c) return;
            alertOn[c.id] = !alertOn[c.id];
            show();
          } else if (act === 'cals-sync') {
            setMsg('Refreshing…');
            const r = await ctx.client.syncCalendars();
            if (r.status === 200 && r.data) {
              take(r.data);
              setMsg('Up to date.');
            } else setMsg(errorText(r.data && r.data.error));
          }
        },
      };
    },
    onDone: async () => {
      if (!cals.length) return true;
      const ids = cals.filter((c) => chosen[c.id]).map((c) => c.id);
      const off = cals.filter((c) => !alertOn[c.id]).map((c) => c.id);
      const r = await ctx.client.saveSelection(ids, off);
      if (r.status === 200 && r.data && r.data.ok) {
        onSaved(r.data);
        return true;
      }
      return errorText(r.data && r.data.error);
    },
  });
}
