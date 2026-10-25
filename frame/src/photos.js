// Photo slideshow: two stacked layers, one 600 ms opacity crossfade per change, next image preloaded.
// Fit/fill and captions are CSS classes on the stage, so switching screens needs no re-layout here.
// P1b (PLAN-v2.md §6): order (daily shuffle or picked order), favorites only, captions on/off,
// fit/fill, pause, next/prev, and dropping a photo the moment it is hidden.
import { seededShuffle } from './shuffle.js';
import { photoCaption } from './format.js';

export const FADE_MS = 600;

export const DEFAULT_OPTIONS = { order: 'shuffle', favoritesOnly: false, captions: true, fit: 'fit' };

/**
 * The play order for `items` ([{id, fav?}]). Favorites only falls back to every photo when none is a
 * favorite (`fallback: true`), so the frame never goes blank. Pure.
 */
export function photoOrder(items, options, seed) {
  const o = Object.assign({}, DEFAULT_OPTIONS, options || {});
  const all = (items || []).map((it) => ({ id: String(it.id != null ? it.id : it.url), fav: !!it.fav }));
  // Order everything first, then filter, so hiding or favoriting one photo doesn't reshuffle the rest.
  let ids = all.map((x) => x.id);
  if (o.order === 'picked') ids.sort((a, b) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0));
  else ids = seededShuffle(ids, seed);
  const favs = {};
  for (const x of all) if (x.fav) favs[x.id] = true;
  const only = o.favoritesOnly ? ids.filter((id) => favs[id]) : ids;
  const fallback = o.favoritesOnly && !only.length && ids.length > 0;
  return { ids: fallback ? ids : only, fallback };
}

export function createSlideshow(stage, opts) {
  const layers = [0, 1].map(() => {
    const layer = document.createElement('div');
    layer.className = 'layer';
    const blur = document.createElement('div');
    blur.className = 'blur';
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    layer.appendChild(blur);
    layer.appendChild(img);
    stage.appendChild(layer);
    return { layer, blur, img };
  });
  const caption = document.createElement('div');
  caption.className = 'caption';
  stage.appendChild(caption);

  const options = () => Object.assign({}, DEFAULT_OPTIONS, (opts.options && opts.options()) || {});
  let order = [];
  let byId = new Map();
  let orderKey = '';
  let seed = '';
  let pos = -1;
  let curId = null;
  let front = 0;
  let timer = 0;
  let running = false;
  let paused = false;
  let fading = false;
  let failures = 0;
  let fallback = false;
  const removed = {};

  function rebuild() {
    const o = options();
    stage.classList.toggle('fill', o.fit === 'fill');
    stage.classList.toggle('no-captions', !o.captions);
    const items = Array.from(byId.values()).filter((it) => !removed[it.id]);
    const favs = items.filter((it) => it.fav).map((it) => it.id).join(',');
    const key = seed + '|' + o.order + '|' + o.favoritesOnly + '|' + items.map((it) => it.id).join(',') + '|' + (o.favoritesOnly ? favs : '');
    if (key === orderKey) return false;
    orderKey = key;
    // Order the whole set (removed ones too) so the rest keep their places.
    const r = photoOrder(Array.from(byId.values()), o, seed);
    order = r.ids.filter((id) => !removed[id]);
    fallback = r.fallback;
    if (!order.length && r.ids.length) {
      // Every favorite is hidden: fall back to the whole set.
      order = photoOrder(items, Object.assign({}, o, { favoritesOnly: false }), seed).ids;
      fallback = o.favoritesOnly;
    }
    // Keep showing the same photo when the order changes under it (hide, favorite, options).
    const keep = curId !== null ? order.indexOf(curId) : -1;
    pos = keep;
    stage.classList.toggle('empty', order.length === 0);
    return keep < 0;
  }

  function setItems(items, setId, day) {
    byId = new Map();
    for (const it of items || []) byId.set(String(it.id != null ? it.id : it.url), Object.assign({}, it, { id: String(it.id != null ? it.id : it.url) }));
    const newSeed = setId + '|' + day;
    const seedChanged = newSeed !== seed;
    seed = newSeed;
    const lost = rebuild();
    if (running && (seedChanged || (lost && curId !== null) || curId === null)) {
      if (seedChanged) pos = -1;
      advance();
    }
  }

  function show(item) {
    const back = layers[1 - front];
    back.img.onload = () => {
      failures = 0;
      back.blur.style.backgroundImage = item.blur ? 'url("' + item.blur + '")' : '';
      back.layer.className = 'layer ' + (item.orient === 'p' ? 'p' : 'l');
      fading = true;
      back.layer.style.opacity = '1';
      layers[front].layer.style.opacity = '0';
      caption.textContent = photoCaption(item.taken);
      front = 1 - front;
      setTimeout(() => {
        fading = false;
      }, FADE_MS + 50);
    };
    back.img.onerror = () => {
      failures++;
      if (opts.onError) opts.onError();
      if (failures < Math.min(order.length, 5)) advance();
    };
    back.img.src = item.url;
  }

  function go(dir) {
    clearTimeout(timer);
    if (!running) return;
    if (order.length) {
      pos = pos < 0 ? (dir > 0 ? 0 : order.length - 1) : (pos + dir + order.length) % order.length;
      curId = order[pos];
      const it = byId.get(curId);
      if (it) show(it);
      if (opts.onChange) opts.onChange(it || null);
    }
    if (!paused) timer = setTimeout(advance, opts.intervalMs());
  }

  function advance() {
    go(1);
  }

  return {
    setItems,
    start() {
      if (running) return;
      running = true;
      advance();
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    next: () => go(1),
    prev: () => go(-1),
    pause() {
      paused = true;
      clearTimeout(timer);
    },
    resume() {
      if (!paused) return;
      paused = false;
      clearTimeout(timer);
      if (running) timer = setTimeout(advance, opts.intervalMs());
    },
    isPaused: () => paused,
    /** Re-reads the options (order, favorites only, fit, captions). */
    applyOptions() {
      if (rebuild() && running) advance();
    },
    /** Drops photo `id` now (hidden) and moves on when it is on screen; `restore` brings it back. */
    remove(id) {
      removed[String(id)] = true;
      const wasCurrent = curId === String(id);
      const oldPos = pos;
      if (wasCurrent) curId = null;
      rebuild();
      if (wasCurrent && running) {
        pos = oldPos - 1;
        advance();
      }
    },
    restore(id) {
      delete removed[String(id)];
      rebuild();
    },
    /** Updates one item's favorite flag locally (the next poll confirms it). */
    setFav(id, fav) {
      const it = byId.get(String(id));
      if (!it) return;
      if (fav) it.fav = true;
      else delete it.fav;
      rebuild();
    },
    current: () => (curId !== null ? byId.get(curId) || null : null),
    isFallback: () => fallback,
    count: () => order.length,
    isFading: () => fading,
    position: () => pos,
  };
}
