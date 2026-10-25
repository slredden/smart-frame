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
  reconnect_calendar: 'Reconnect Google on the admin page to list calendars.',
  no_grant: 'Connect Google on the admin page first.',
};
export const errorText = (code) => ERRORS[code] || "Couldn't save. Try again.";

export const scheduleText = (s) => minutesLabel(s.dayStart) + ' – ' + minutesLabel(s.nightStart);

export function createSettingsScreen(root, ctx) {
  const list = h('div', 'set-list');
  root.appendChild(h('div', 'set-head', 'Settings'));
  root.appendChild(list);
  root.appendChild(h('div', 'set-foot', 'Pairing, Google connect and other account settings are on the admin page.'));

  let calSummary = '';

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

  return {
    show() {
      render();
      loadCals();
    },
    render,
    calendarsSaved(data) {
      summarize(data.calendars);
      render();
    },
    onTap(el, act) {
      if (act === 'set-schedule') editSchedule();
      else if (act === 'set-night') editNight();
      else if (act === 'set-idle') editIdle();
      else if (act === 'set-weather') editWeather();
      else if (act === 'set-calendars') ctx.openCalendars();
    },
  };
}

/** The Calendars picker (from Settings or the Calendar toolbar). Saves with PUT /api/calendars/selection. */
export function openCalendarsSheet(ctx, onSaved) {
  let cals = [];
  let max = 10;
  const chosen = {};
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
          out.appendChild(b);
        });
        if (!cals.length) out.appendChild(h('div', 'cal-note', 'No calendars loaded yet. Tap Refresh.'));
      };
      const take = (d) => {
        cals = d.calendars || [];
        max = d.max || max;
        for (const c of cals) chosen[c.id] = !!c.selected;
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
      const r = await ctx.client.saveSelection(ids);
      if (r.status === 200 && r.data && r.data.ok) {
        onSaved(r.data);
        return true;
      }
      return errorText(r.data && r.data.error);
    },
  });
}
