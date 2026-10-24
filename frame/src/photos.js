// Photo slideshow: two stacked layers, one 600 ms opacity crossfade per change, next image preloaded.
// Fit is done in CSS (object-fit) so switching screens needs no re-layout here.
import { seededShuffle } from './shuffle.js';
import { photoCaption } from './format.js';

export const FADE_MS = 600;

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

  let order = [];
  let byId = new Map();
  let setKey = '';
  let pos = -1;
  let front = 0;
  let timer = 0;
  let running = false;
  let fading = false;
  let failures = 0;

  function setItems(items, setId, day) {
    byId = new Map();
    for (const it of items || []) byId.set(String(it.id != null ? it.id : it.url), it);
    const key = setId + '|' + day;
    if (key !== setKey) {
      setKey = key;
      order = seededShuffle(Array.from(byId.keys()), key);
      pos = -1;
      if (running) advance();
    }
    stage.classList.toggle('empty', byId.size === 0);
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

  function advance() {
    clearTimeout(timer);
    if (!running) return;
    if (order.length) {
      pos = (pos + 1) % order.length;
      const it = byId.get(order[pos]);
      if (it) show(it);
    }
    timer = setTimeout(advance, opts.intervalMs());
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
    isFading: () => fading,
    position: () => pos,
  };
}
