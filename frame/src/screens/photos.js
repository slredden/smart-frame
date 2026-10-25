// Photos screen (PLAN-v2.md §6): the full 1184 × 800 photo area beside the rail, with a bottom
// toolbar that hides after 5 s (any tap brings it back): Prev · Pause/Play · Next · Favorite · Hide ·
// Options. Options live here only and drive the Home photo pane too (settings.photos in D1).
import { h, btn, clear } from '../dom.js';
import { BOUNDS } from '../../../shared/settings.js';
import { errorText, stepList } from './settings.js';

export const TOOLBAR_MS = 5000;
export const HIDE_UNDO_MS = 5000;

export function intervalLabel(sec) {
  return sec < 60 ? sec + ' s' : sec / 60 + ' min';
}

export function createPhotosScreen(root, ctx) {
  const ss = ctx.slideshow;
  let timer = 0;
  const bar = h('div', 'ph-bar');
  const note = h('div', 'ph-note');
  root.appendChild(note);
  root.appendChild(bar);

  function renderBar() {
    clear(bar);
    const cur = ss.current();
    bar.appendChild(btn('‹', 'ph-prev', 'ph-btn icon-btn'));
    bar.appendChild(btn(ss.isPaused() ? 'Play' : 'Pause', 'ph-pause', 'ph-btn ph-wide'));
    bar.appendChild(btn('›', 'ph-next', 'ph-btn icon-btn'));
    bar.appendChild(btn(cur && cur.fav ? '♥' : '♡', 'ph-fav', 'ph-btn icon-btn' + (cur && cur.fav ? ' on' : '')));
    bar.appendChild(btn('Hide', 'ph-hide', 'ph-btn ph-wide'));
    bar.appendChild(btn('Options', 'ph-options', 'ph-btn ph-wide'));
    const parts = [];
    if (ss.isPaused()) parts.push('Paused');
    if (ss.isFallback()) parts.push('No favorites yet: showing all photos');
    if (!ss.count()) parts.push('No photos yet. Pick some on the admin page.');
    note.textContent = parts.join(' · ');
  }

  function wake() {
    root.classList.add('bar-on');
    renderBar();
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove('bar-on'), TOOLBAR_MS);
  }

  async function toggleFav() {
    const cur = ss.current();
    const setId = ctx.photoSet();
    if (!cur || !setId) return;
    const fav = !cur.fav;
    ss.setFav(cur.id, fav);
    renderBar();
    const r = await ctx.client.photoFlag(setId, cur.id, { favorite: fav });
    if (!(r.status === 200 && r.data && r.data.ok)) {
      ss.setFav(cur.id, !fav);
      renderBar();
      ctx.toast.show({ text: r.data && r.data.error === 'too_many_writes' ? errorText('too_many_writes') : "Couldn't save that. Try again.", ms: 4000 });
    }
  }

  function hide() {
    const cur = ss.current();
    const setId = ctx.photoSet();
    if (!cur || !setId) return;
    const id = cur.id;
    ss.remove(id);
    renderBar();
    ctx.toast.show({
      text: 'Photo hidden',
      undo: true,
      ms: HIDE_UNDO_MS,
      onUndo() {
        ss.restore(id);
        renderBar();
      },
      async onCommit() {
        const r = await ctx.client.photoFlag(setId, id, { hidden: true });
        if (!(r.status === 200 && r.data && r.data.ok)) {
          ss.restore(id);
          renderBar();
          ctx.toast.show({ text: r.data && r.data.error === 'too_many_writes' ? errorText('too_many_writes') : "Couldn't hide that photo. Try again.", ms: 4000 });
        } else ctx.photosChanged();
      },
    });
  }

  function options() {
    const b = BOUNDS.photos;
    const v = Object.assign({}, ctx.settings().photos);
    const val = h('span', 'step-val');
    const groups = h('div', 'ph-opts');
    const draw = () => {
      val.textContent = intervalLabel(v.intervalSec);
      clear(groups);
      const seg = (label, field, choices) =>
        h('div', 'opt-row', '', [
          h('span', 'step-label', label),
          h(
            'div',
            'seg',
            '',
            choices.map(([value, text]) => btn(text, 'opt', 'seg-btn opt-btn' + (v[field] === value ? ' on' : ''), { f: field, v: String(value) })),
          ),
        ]);
      groups.appendChild(seg('Order', 'order', [['shuffle', 'Shuffle'], ['picked', 'Picked']]));
      groups.appendChild(seg('Fit', 'fit', [['fit', 'Fit'], ['fill', 'Fill']]));
      groups.appendChild(seg('Captions', 'captions', [[true, 'On'], [false, 'Off']]));
      groups.appendChild(seg('Favorites only', 'favoritesOnly', [[true, 'On'], [false, 'Off']]));
    };
    draw();
    ctx.sheet.open({
      title: 'Photo options',
      build(body) {
        body.appendChild(h('div', 'stepper', '', [h('span', 'step-label', 'Change every'), btn('–', 'step', 'step-btn', { dir: '-1' }), val, btn('+', 'step', 'step-btn', { dir: '1' })]));
        body.appendChild(groups);
        return {
          onTap(el, act) {
            if (act === 'step') v.intervalSec = stepList(b.intervals, v.intervalSec, Number(el.getAttribute('data-dir')));
            else if (act === 'opt') {
              const f = el.getAttribute('data-f');
              const raw = el.getAttribute('data-v');
              v[f] = raw === 'true' ? true : raw === 'false' ? false : raw;
            }
            draw();
          },
        };
      },
      onDone: async () => {
        const r = await ctx.saveSetting('photos', { intervalSec: v.intervalSec, order: v.order, fit: v.fit, captions: v.captions, favoritesOnly: v.favoritesOnly });
        return r === true ? true : errorText(r);
      },
    });
  }

  return {
    show() {
      ss.resume();
      wake();
    },
    hide() {
      clearTimeout(timer);
      root.classList.remove('bar-on');
      // Pause holds only until the photos leave this screen (PLAN-v2.md §6).
      ss.resume();
    },
    refresh: renderBar,
    onBlankTap: wake,
    onTap(el, act) {
      wake();
      if (act === 'ph-prev') ss.prev();
      else if (act === 'ph-next') ss.next();
      else if (act === 'ph-pause') {
        if (ss.isPaused()) ss.resume();
        else ss.pause();
      } else if (act === 'ph-fav') toggleFav();
      else if (act === 'ph-hide') hide();
      else if (act === 'ph-options') options();
      renderBar();
    },
  };
}
