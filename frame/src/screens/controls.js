// Controls screen (PLAN-v2.md §11.4-§11.7): Spotify on the left, the Ring cameras on the right.
// Everything here polls only while the screen is showing and the page is visible; hide() (leaving
// Controls, idle return, night) stops the polls, covers indoor cameras and drops every picture.
// The Worker answers "not connected" until Spotify and Home Assistant are set up on /admin.
import { h, btn, clear, icon } from '../dom.js';

export const POLL_MS = 5000;
export const STALE_CAM_MS = 15 * 60000;
export const OFFLINE_RETRY_MS = 30000;
const REVERT_TOAST_MS = 3000;
const VOLUME_STEP = 10;

// 28 px line icons (dom.icon): no emoji, the frame's fonts may not have them.
const ICONS = {
  prev: 'M8 6 V22 M22 6 L11 14 L22 22 Z',
  next: 'M20 6 V22 M6 6 L17 14 L6 22 Z',
  play: 'M9 5 L23 14 L9 23 Z',
  pause: 'M9 6 V22 M19 6 V22',
};

function iconBtn(name, act, cls, extra, label) {
  const b = btn('', act, cls, extra);
  b.appendChild(icon(ICONS[name], 32));
  b.setAttribute('aria-label', label);
  return b;
}

const SPOTIFY_ERRORS = {
  premium_needed: 'Spotify Premium needed.',
  spotify_busy: 'Spotify busy, try again.',
  not_connected: 'Connect Spotify on /admin.',
  no_active_device: 'Nothing is playing. Pick a speaker below.',
  unknown_device: 'That speaker went away. Refresh the list.',
  spotify_unauthorized: 'Reconnect Spotify on /admin.',
  too_many_writes: 'Too many changes this hour. Try again later.',
};
export const spotifyErrorText = (code) => SPOTIFY_ERRORS[code] || "Spotify didn't answer. Try again.";

/** P2.1 Recent sheet. */
export const RECENT_NEEDS_CONSENT = 'Reconnect Spotify on /admin to see recent';
const TYPE_LABEL = { playlist: 'Playlist', album: 'Album', artist: 'Artist' };
const ART_OK = /^(https:\/\/i\.scdn\.co\/|data:image\/svg\+xml,)/;
export function recentErrorText(code) {
  if (code === 'needs_consent') return RECENT_NEEDS_CONSENT;
  return spotifyErrorText(code);
}

/** §11.5: the remembered device isn't in Spotify's list. */
export const absentText = (name) => (name || 'Your speaker') + ' not available; say "Alexa, Spotify Connect" or play once from the Spotify app';

/** 'updated 40 s ago' / 'updated 3 min ago' / 'updated 2 h ago'; '' when unknown. */
export function ageLabel(updatedIso, nowMs) {
  const t = Date.parse(updatedIso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 90) return 'updated ' + s + ' s ago';
  const m = Math.round(s / 60);
  if (m < 90) return 'updated ' + m + ' min ago';
  return 'updated ' + Math.round(m / 60) + ' h ago';
}

export const isStale = (updatedIso, nowMs) => {
  const t = Date.parse(updatedIso || '');
  return !Number.isFinite(t) || nowMs - t > STALE_CAM_MS;
};

export function createControlsScreen(root, ctx) {
  // ----- DOM -----
  const spCard = h('div', 'ctl-card sp-card');
  const camCard = h('div', 'ctl-card cam-card');
  root.appendChild(h('div', 'ctl-wrap', '', [spCard, camCard]));

  const art = h('div', 'sp-art');
  const artImg = h('img', 'sp-art-img');
  artImg.alt = '';
  art.appendChild(artImg);
  const title = h('div', 'sp-title');
  const artist = h('div', 'sp-artist');
  const device = h('div', 'sp-device');
  // P2.1: opens the Recent / Playlists sheet.
  const recentBtn = btn('Recent', 'sp-recent', 'sp-recent');
  const spMsg = h('div', 'sp-msg');
  const btns = h('div', 'sp-btns');
  const devHead = h('div', 'sp-devs-head', '', [h('span', 'sp-devs-title', 'Play on…'), btn('Refresh', 'sp-devices', 'sp-refresh')]);
  const devList = h('div', 'sp-devs');
  spCard.appendChild(h('div', 'sp-now', '', [art, h('div', 'sp-text', '', [title, artist, device, recentBtn])]));
  spCard.appendChild(btns);
  spCard.appendChild(spMsg);
  spCard.appendChild(devHead);
  spCard.appendChild(devList);
  spCard.appendChild(h('div', 'sp-note', 'Not listed? Start Spotify on it once from your phone.'));

  const camHead = h('div', 'cam-head', '', [h('span', 'cam-title', 'Cameras'), h('span', 'cam-msg')]);
  const camMsg = camHead.lastChild;
  const grid = h('div', 'cam-grid');
  const big = h('button', 'cam-big');
  big.type = 'button';
  big.setAttribute('data-act', 'cam-close');
  const bigImg = h('img', 'cam-big-img');
  bigImg.alt = '';
  const bigLabel = h('span', 'cam-big-label');
  big.appendChild(bigImg);
  big.appendChild(bigLabel);
  camCard.appendChild(camHead);
  camCard.appendChild(grid);
  camCard.appendChild(big);

  // ----- state -----
  let active = false;
  let timer = 0;
  let sp = null; // last /api/spotify/state body
  let spNote = ''; // message under the buttons
  let spAbsent = null; // {name, devices} after a 409 device_absent
  let spPauseUntil = 0; // 429 back-off (Date.now ms)
  let wantDevices = true; // ask for a fresh device list on the next poll
  let cams = null; // last /api/controls/state body
  let camPauseUntil = 0;
  const shown = {}; // cam id -> {updated, url, reveal}
  const revealUntil = {}; // cam id -> performance.now() deadline
  let enlarged = null; // cam id
  let tileKey = '';
  const tiles = {};

  // ----- Spotify -----
  function renderSpotify() {
    clear(btns);
    clear(devList);
    const connected = !!(sp && sp.connected);
    spCard.classList.toggle('off', !connected);
    recentBtn.style.display = 'none';
    if (!sp) {
      title.textContent = 'Spotify';
      artist.textContent = '';
      device.textContent = '';
      spMsg.textContent = spNote || 'Loading…';
      devHead.style.display = 'none';
      return;
    }
    if (!connected) {
      title.textContent = 'Spotify';
      artist.textContent = '';
      device.textContent = '';
      artImg.removeAttribute('src');
      art.classList.remove('has-art');
      spMsg.textContent = 'Connect Spotify on /admin';
      devHead.style.display = 'none';
      return;
    }
    const it = sp.item;
    title.textContent = it ? it.title : 'Nothing playing';
    artist.textContent = it ? it.artists : '';
    device.textContent = sp.device ? 'on ' + sp.device.name : '';
    const artUrl = it && it.art ? it.art : '';
    if (artUrl && artImg.getAttribute('src') !== artUrl) artImg.setAttribute('src', artUrl);
    if (!artUrl) artImg.removeAttribute('src');
    art.classList.toggle('has-art', !!artUrl);
    btns.appendChild(iconBtn('prev', 'sp-prev', 'sp-btn', null, 'Previous'));
    btns.appendChild(sp.playing ? iconBtn('pause', 'sp-pause', 'sp-btn sp-main', null, 'Pause') : iconBtn('play', 'sp-play', 'sp-btn sp-main', null, 'Play'));
    btns.appendChild(iconBtn('next', 'sp-next', 'sp-btn', null, 'Next'));
    const vol = sp.device && typeof sp.device.volume === 'number' ? sp.device.volume : null;
    btns.appendChild(btn('–', 'sp-vol', 'sp-btn sp-vol', { dir: '-1' }));
    btns.appendChild(h('span', 'sp-vol-val', vol === null ? '–' : vol + '%'));
    btns.appendChild(btn('+', 'sp-vol', 'sp-btn sp-vol', { dir: '1' }));
    recentBtn.style.display = '';
    spMsg.textContent = spAbsent ? absentText(spAbsent.name) : spNote || (it ? '' : 'Nothing playing');
    devHead.style.display = '';
    const list = spAbsent && spAbsent.devices ? spAbsent.devices : sp.devices || [];
    if (!list.length) devList.appendChild(h('div', 'sp-dev-empty', 'No speakers listed.'));
    for (const d of list) {
      const on = !!(sp.device && sp.device.id === d.id) || !!d.active;
      const row = h('button', 'sp-dev tap-row' + (on ? ' on' : ''), '', [h('span', 'sp-dev-name', d.name), h('span', 'sp-dev-mark', on ? 'Playing here' : d.remembered ? 'Last used' : '')]);
      row.type = 'button';
      row.setAttribute('data-act', 'sp-transfer');
      row.setAttribute('data-id', d.id);
      devList.appendChild(row);
    }
  }

  async function pollSpotify() {
    if (Date.now() < spPauseUntil) return;
    const r = await ctx.client.spotifyState(wantDevices);
    if (!active) return;
    if (r.status === 200 && r.data) {
      wantDevices = false;
      sp = r.data;
      if (spNote === spotifyErrorText('spotify_busy')) spNote = '';
    } else if (r.status === 429) {
      spPauseUntil = Date.now() + Math.max(5, Number((r.data && r.data.retryAfter) || 30)) * 1000;
      spNote = spotifyErrorText('spotify_busy');
    } else if (r.data && r.data.error) spNote = spotifyErrorText(r.data.error);
    else spNote = "Can't reach the frame server.";
    renderSpotify();
  }

  /** Optimistic: apply `change` now, send, and put the old state back (with a 3 s toast) on error. */
  async function spotify(action, body, change) {
    if (!sp || !sp.connected) return;
    const before = JSON.parse(JSON.stringify(sp));
    if (change) change(sp);
    spAbsent = action === 'transfer' ? null : spAbsent;
    renderSpotify();
    const r = await ctx.client.spotifyAction(action, body);
    if (!active) return;
    if (r.status === 200) {
      spNote = '';
      if (action === 'play') spAbsent = null;
      pollSoon(800);
      return;
    }
    sp = before;
    const code = (r.data && r.data.error) || '';
    if (code === 'device_absent') {
      spAbsent = { name: r.data.name, devices: r.data.devices || [] };
      wantDevices = true;
    } else {
      if (code === 'spotify_busy') spPauseUntil = Date.now() + Math.max(5, Number(r.data.retryAfter || 30)) * 1000;
      ctx.toast.show({ text: spotifyErrorText(code), ms: REVERT_TOAST_MS });
    }
    renderSpotify();
  }

  // ----- Recent sheet (P2.1) -----
  let pick = null; // {tab, data, error, timer}

  function pickTile(it) {
    const tile = h('button', 'sp-tile tap-row', '');
    tile.type = 'button';
    tile.setAttribute('data-act', 'sp-pick');
    tile.setAttribute('data-uri', it.uri);
    const artBox = h('div', 'sp-tile-art');
    if (it.image && ART_OK.test(it.image)) {
      const img = h('img', '');
      img.setAttribute('src', it.image);
      img.setAttribute('alt', '');
      artBox.appendChild(img);
    }
    tile.appendChild(artBox);
    tile.appendChild(h('div', 'sp-tile-text', '', [h('div', 'sp-tile-name', it.name || ''), h('div', 'sp-tile-type', TYPE_LABEL[it.type] || '')]));
    return tile;
  }

  function renderPick() {
    if (!pick) return;
    const { wrap } = pick;
    clear(wrap);
    const tabs = h('div', 'sp-tabs');
    for (const [k, label] of [['recent', 'Recent'], ['playlists', 'Playlists']]) {
      const t = btn(label, 'sp-tab', 'sp-tab' + (pick.tab === k ? ' on' : ''), { tab: k });
      tabs.appendChild(t);
    }
    wrap.appendChild(tabs);
    const list = h('div', 'sp-pick-list ' + (pick.tab === 'recent' ? 'sp-pick-recent' : 'sp-pick-playlists'));
    wrap.appendChild(list);
    if (pick.error) {
      list.appendChild(h('div', 'sp-pick-msg', recentErrorText(pick.error)));
      return;
    }
    if (!pick.data) {
      list.appendChild(h('div', 'sp-pick-msg', 'Loading…'));
      return;
    }
    const items = pick.tab === 'recent' ? pick.data.recent || [] : pick.data.playlists || [];
    if (!items.length) list.appendChild(h('div', 'sp-pick-msg', pick.tab === 'recent' ? 'Nothing played recently.' : 'No playlists.'));
    for (const it of items) list.appendChild(pickTile(it));
  }

  function pickTouched() {
    if (!pick) return;
    clearTimeout(pick.timer);
    pick.timer = setTimeout(() => ctx.sheet.close(), ctx.sheetIdleMs || 30000);
  }

  async function openRecent() {
    if (!sp || !sp.connected) return;
    ctx.sheet.open({
      title: 'Play from Spotify',
      cls: 'sp-pick',
      noCancel: true,
      doneLabel: 'Close',
      closeOnOutside: true,
      onClose() {
        if (pick) clearTimeout(pick.timer);
        pick = null;
      },
      build(body) {
        const wrap = h('div', 'sp-pick-wrap');
        // Scrolling the Playlists tab is a touch too (a drag never reaches the tap handler).
        for (const ev of ['pointerdown', 'scroll']) wrap.addEventListener(ev, pickTouched, true);
        body.appendChild(wrap);
        pick = { tab: 'recent', data: null, error: '', timer: 0, wrap };
        return {
          onTouch: pickTouched,
          onTap(el, act) {
            if (act === 'sp-tab') {
              pick.tab = el.getAttribute('data-tab') === 'playlists' ? 'playlists' : 'recent';
              renderPick();
            } else if (act === 'sp-pick') {
              const uri = el.getAttribute('data-uri');
              ctx.sheet.close();
              spotify('play', { context_uri: uri }, (s) => (s.playing = true));
            }
          },
        };
      },
    });
    pickTouched();
    renderPick();
    const mine = pick;
    const r = await ctx.client.spotifyRecent();
    if (!pick || pick !== mine) return;
    if (r.status === 200 && r.data && r.data.connected) pick.data = r.data;
    else if (r.status === 200 && r.data) pick.error = 'not_connected';
    else {
      pick.error = (r.data && r.data.error) || 'offline';
      if (pick.error === 'spotify_busy') spPauseUntil = Date.now() + Math.max(5, Number(r.data.retryAfter || 30)) * 1000;
    }
    renderPick();
  }

  // ----- Cameras -----
  function revealed(id) {
    return revealUntil[id] !== undefined && performance.now() < revealUntil[id];
  }

  function drop(id) {
    const s = shown[id];
    if (s && s.url) URL.revokeObjectURL(s.url);
    delete shown[id];
  }

  function cover(id) {
    delete revealUntil[id];
    drop(id);
    if (enlarged === id) enlarged = null;
  }

  function coverAll() {
    for (const id of Object.keys(revealUntil)) cover(id);
  }

  /** Fetch a picture only when the camera says it has a new one (or a reveal starts). */
  async function loadImage(c) {
    const reveal = c.indoor;
    const s = shown[c.id];
    if (s && s.updated === c.updated && s.reveal === reveal) return;
    const r = await ctx.client.camImage(c.id, reveal);
    if (!active) return;
    if (c.indoor && !revealed(c.id)) return; // covered again while loading
    if (r.status === 200 && r.blob) {
      drop(c.id);
      shown[c.id] = { updated: c.updated, url: URL.createObjectURL(r.blob), reveal };
    } else if (r.status === 503) camPauseUntil = Date.now() + OFFLINE_RETRY_MS;
  }

  function camText(c) {
    if (c.off) return 'Indoor cameras off';
    if (c.available === false) return 'Camera unavailable';
    if (c.indoor && !revealed(c.id)) return 'Tap to show';
    return '';
  }

  function renderCams() {
    const now = ctx.now();
    let msg = '';
    if (!cams) msg = 'Loading…';
    else if (cams.offline) msg = 'Cameras offline';
    else if (!cams.connected) msg = 'Cameras not connected';
    else if (!cams.cams.length) msg = 'No cameras chosen yet';
    camMsg.textContent = msg;
    const list = cams && cams.cams ? cams.cams : [];
    const key = list.map((c) => c.id + (c.off ? 'x' : '') + (c.indoor ? 'i' : '')).join(',') + '|' + (cams && cams.connected ? 1 : 0);
    if (key !== tileKey) {
      tileKey = key;
      clear(grid);
      for (const k of Object.keys(tiles)) delete tiles[k];
      for (const c of list) {
        const img = h('img', 'cam-img');
        img.alt = '';
        const t = c.off ? h('div', 'cam-tile off') : h('button', 'cam-tile');
        if (!c.off) {
          t.type = 'button';
          t.setAttribute('data-act', 'cam-tap');
          t.setAttribute('data-id', c.id);
        }
        const label = h('span', 'cam-label', c.label);
        const age = h('span', 'cam-age');
        const note = h('span', 'cam-note');
        t.appendChild(img);
        t.appendChild(note);
        t.appendChild(h('span', 'cam-cap', '', [label, age]));
        grid.appendChild(t);
        tiles[c.id] = { t, img, age, note };
      }
      if (cams && cams.connected) for (let i = list.length; i < 4; i++) grid.appendChild(h('div', 'cam-tile empty'));
    }
    for (const c of list) {
      const el = tiles[c.id];
      if (!el) continue;
      const s = shown[c.id];
      const url = s && !(c.indoor && !revealed(c.id)) ? s.url : '';
      if (url && el.img.getAttribute('src') !== url) el.img.setAttribute('src', url);
      if (!url) el.img.removeAttribute('src');
      el.t.classList.toggle('has-img', !!url);
      el.t.classList.toggle('covered', !!c.indoor && !revealed(c.id));
      el.t.classList.toggle('stale', !c.off && !!url && isStale(c.updated, now));
      el.note.textContent = camText(c);
      el.age.textContent = c.off || (c.indoor && !revealed(c.id)) ? '' : ageLabel(c.updated, now);
    }
    const bc = enlarged && list.find((c) => c.id === enlarged);
    const bs = bc && shown[bc.id];
    if (bc && bs && !(bc.indoor && !revealed(bc.id))) {
      if (bigImg.getAttribute('src') !== bs.url) bigImg.setAttribute('src', bs.url);
      bigLabel.textContent = bc.label + ' · ' + ageLabel(bc.updated, now);
      camCard.classList.add('big-on');
    } else {
      enlarged = null;
      bigImg.removeAttribute('src');
      camCard.classList.remove('big-on');
    }
  }

  async function pollCams() {
    if (Date.now() < camPauseUntil) return;
    const r = await ctx.client.controlsState();
    if (!active) return;
    if (r.status === 200 && r.data) {
      cams = { connected: !!r.data.connected, indoorOn: !!r.data.indoorOn, revealSec: r.data.revealSec || 45, cams: r.data.cams || [] };
      if (!cams.indoorOn) coverAll();
      const want = cams.cams.filter((c) => !c.off && c.available !== false && (!c.indoor || revealed(c.id)));
      await Promise.all(want.map(loadImage));
    } else if (r.status === 503) {
      cams = Object.assign({ cams: [] }, cams || {}, { offline: true, connected: true });
      camPauseUntil = Date.now() + OFFLINE_RETRY_MS;
    } else if (r.status === 429) camPauseUntil = Date.now() + OFFLINE_RETRY_MS;
    if (cams && r.status === 200) delete cams.offline;
    if (active) renderCams();
  }

  // ----- polling -----
  async function pollOnce() {
    timer = 0;
    if (!active) return;
    if (document.hidden) {
      coverAll();
      renderCams();
    } else await Promise.all([pollSpotify(), pollCams()]);
    if (active && !timer) timer = setTimeout(pollOnce, POLL_MS);
  }

  function pollSoon(ms) {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(pollOnce, ms);
  }

  function stop() {
    active = false;
    clearTimeout(timer);
    timer = 0;
    coverAll();
    for (const id of Object.keys(shown)) drop(id);
    enlarged = null;
    tileKey = '';
    clear(grid);
    bigImg.removeAttribute('src');
    camCard.classList.remove('big-on');
  }

  function tapCam(id) {
    const c = cams && cams.cams.find((x) => x.id === id);
    if (!c || c.off) return;
    if (c.indoor && !revealed(id)) {
      if (!cams.indoorOn) return;
      revealUntil[id] = performance.now() + (cams.revealSec || 45) * 1000;
      renderCams();
      loadImage(c).then(() => active && renderCams());
      return;
    }
    if (shown[id]) {
      enlarged = id;
      renderCams();
    }
  }

  return {
    show() {
      if (active) return;
      active = true;
      wantDevices = true;
      spAbsent = null;
      renderSpotify();
      renderCams();
      pollSoon(0);
    },
    hide: stop,
    /** Every 2 s from main.js: ages, and indoor reveals that ran out. */
    tick() {
      if (!active) return;
      const now = performance.now();
      for (const id of Object.keys(revealUntil)) if (now >= revealUntil[id] || document.hidden) cover(id);
      renderCams();
    },
    isPolling: () => active && !!timer,
    onTap(el, act) {
      if (act === 'sp-recent') openRecent();
      else if (act === 'sp-play') spotify('play', undefined, (s) => (s.playing = true));
      else if (act === 'sp-pause') spotify('pause', undefined, (s) => (s.playing = false));
      else if (act === 'sp-next') spotify('next');
      else if (act === 'sp-prev') spotify('prev');
      else if (act === 'sp-vol') {
        const v = sp && sp.device && typeof sp.device.volume === 'number' ? sp.device.volume : null;
        if (v === null) return;
        const next = Math.max(0, Math.min(100, v + Number(el.getAttribute('data-dir')) * VOLUME_STEP));
        spotify('volume', { volume: next }, (s) => (s.device.volume = next));
      } else if (act === 'sp-transfer') {
        const id = el.getAttribute('data-id');
        const d = ((spAbsent && spAbsent.devices) || (sp && sp.devices) || []).find((x) => x.id === id);
        if (!d) return;
        spotify('transfer', { device_id: id }, (s) => {
          s.device = { id: d.id, name: d.name, type: d.type, volume: s.device ? s.device.volume : null };
          for (const x of s.devices || []) x.active = x.id === id;
        });
      } else if (act === 'sp-devices') {
        wantDevices = true;
        spAbsent = null;
        pollSoon(0);
      } else if (act === 'cam-tap') tapCam(el.getAttribute('data-id'));
      else if (act === 'cam-close') {
        enlarged = null;
        renderCams();
      }
    },
  };
}
