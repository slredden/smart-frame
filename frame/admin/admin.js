// Admin page (behind Cloudflare Access). Talks to /admin/api/* on the same origin.
const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch('./api/' + path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
  return data;
}

let pollTimer = 0;
let polling = '';

async function loadStatus() {
  try {
    const s = await api('GET', 'status');
    if (s.job && !polling) pollJob(s.job.id); // resume an unfinished copy after a reload
    $('who').textContent = s.admin ? 'Signed in as ' + s.admin : '';
    $('status').textContent = JSON.stringify(s.health, null, 2);
    const ul = $('devices');
    ul.textContent = '';
    for (const d of s.devices || []) {
      const li = document.createElement('li');
      li.textContent = d.name + ' (' + d.id + ') last seen ' + (d.lastSeen || 'never') + (d.revokedAt ? ' · revoked' : '');
      if (!d.revokedAt) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Revoke';
        b.onclick = async () => {
          if (!window.confirm('Revoke ' + d.name + '? It stops working at once.')) return;
          await api('POST', 'devices/' + encodeURIComponent(d.id) + '/revoke');
          loadStatus();
        };
        li.appendChild(document.createTextNode(' '));
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
  } catch (e) {
    $('status').textContent = 'Could not load status: ' + e.message;
  }
}

$('pair').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const r = await api('POST', 'devices', { name: $('pair-name').value });
    $('pair-out').innerHTML = '';
    const p = document.createElement('p');
    p.textContent = 'Pairing link (shown once; put it in the frame kiosk URL):';
    const c = document.createElement('code');
    c.textContent = r.pairingUrl;
    $('pair-out').appendChild(p);
    $('pair-out').appendChild(c);
    loadStatus();
  } catch (e) {
    $('pair-out').textContent = 'Failed: ' + e.message;
  }
});

async function pollJob(id) {
  polling = id;
  try {
    const j = await api('POST', 'picker/' + encodeURIComponent(id) + '/step');
    $('pick-status').textContent = j.message || j.status;
    if (j.status === 'done' || j.status === 'failed') {
      polling = '';
      return loadStatus();
    }
  } catch (e) {
    $('pick-status').textContent = 'Failed: ' + e.message;
    polling = '';
    return undefined;
  }
  pollTimer = setTimeout(() => pollJob(id), 5000);
  return undefined;
}

$('pick').addEventListener('click', async () => {
  clearTimeout(pollTimer);
  try {
    const j = await api('POST', 'picker');
    $('pick-status').textContent = 'Picker opened in a new tab. Choose photos there, then press Done.';
    window.open(j.pickerUri, '_blank', 'noopener');
    pollJob(j.id);
  } catch (e) {
    $('pick-status').textContent = 'Failed: ' + e.message;
  }
});

for (const b of document.querySelectorAll('[data-disconnect]')) {
  b.addEventListener('click', async () => {
    const g = b.getAttribute('data-disconnect');
    if (!window.confirm('Disconnect ' + g + '? The frame keeps cached data until you reconnect.')) return;
    try {
      await api('POST', 'grants/' + g + '/disconnect');
      $('grant-out').textContent = g + ' disconnected.';
      loadStatus();
    } catch (e) {
      $('grant-out').textContent = 'Failed: ' + e.message;
    }
  });
}

const CAL_ERRORS = {
  reconnect_calendar: 'Click Connect calendar first (Google needs one more permission to list your calendars).',
  too_many_calendars: 'Too many calendars selected.',
};

function renderCalendars(r) {
  $('cal-max').textContent = String(r.max);
  const ul = $('cal-list');
  ul.textContent = '';
  for (const c of r.calendars || []) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = c.id;
    box.checked = c.selected;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    if (c.color) sw.style.backgroundColor = c.color;
    label.appendChild(box);
    label.appendChild(sw);
    label.appendChild(document.createTextNode(c.summary + (c.primary ? ' (primary)' : '')));
    li.appendChild(label);
    const al = document.createElement('label');
    al.className = 'cal-alert';
    const abox = document.createElement('input');
    abox.type = 'checkbox';
    abox.value = c.id;
    abox.checked = c.alert !== false;
    abox.setAttribute('data-alert', '1');
    al.appendChild(abox);
    al.appendChild(document.createTextNode(' alerts'));
    li.appendChild(al);
    ul.appendChild(li);
  }
  if (!(r.calendars || []).length) $('cal-out').textContent = 'No calendars loaded yet.';
}

async function loadCalendars() {
  try {
    renderCalendars(await api('GET', 'calendars'));
  } catch (e) {
    $('cal-out').textContent = 'Failed: ' + e.message;
  }
}

$('cal-sync').addEventListener('click', async () => {
  $('cal-out').textContent = 'Loading…';
  try {
    renderCalendars(await api('POST', 'calendars/sync'));
    $('cal-out').textContent = 'Loaded.';
  } catch (e) {
    $('cal-out').textContent = CAL_ERRORS[e.message] || 'Failed: ' + e.message;
  }
});

$('cal-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const selected = Array.prototype.map.call(document.querySelectorAll('#cal-list input:not([data-alert]):checked'), (b) => b.value);
  const alertsOff = Array.prototype.map.call(document.querySelectorAll('#cal-list input[data-alert]:not(:checked)'), (b) => b.value);
  try {
    const r = await api('PUT', 'calendars', { selected, alertsOff });
    $('cal-out').textContent = 'Saved ' + r.selected + ' calendar(s).' + (r.refreshed ? ' The frame updates within a minute.' : ' The frame updates at the next refresh.');
  } catch (e) {
    $('cal-out').textContent = CAL_ERRORS[e.message] || 'Failed: ' + e.message;
  }
});

// ----- Task lists (PLAN-v2.md §4.2) -----
const TL_ERRORS = {
  tasks_scope_missing: 'Click Connect calendar first and allow Google Tasks.',
  reconnect_calendar: 'Click Connect calendar again (the Google grant needs refreshing).',
  no_task_lists: 'Google returned no task lists for this account. Is Google Tasks enabled for it?',
  too_many_lists: 'Too many lists selected (10 at most).',
};

function renderTaskLists(r) {
  $('tl-max').textContent = String(r.max);
  const ul = $('tl-list');
  ul.textContent = '';
  for (const l of r.lists || []) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = l.id;
    box.checked = l.selected;
    label.appendChild(box);
    label.appendChild(document.createTextNode(' ' + l.title + (l.default ? ' (default)' : '')));
    li.appendChild(label);
    ul.appendChild(li);
  }
  if (!(r.lists || []).length) $('tl-out').textContent = r.scope === false ? TL_ERRORS.tasks_scope_missing : 'No task lists loaded yet.';
}

async function loadTaskLists() {
  try {
    renderTaskLists(await api('GET', 'tasklists'));
  } catch (e) {
    $('tl-out').textContent = 'Failed: ' + e.message;
  }
}

$('tl-sync').addEventListener('click', async () => {
  $('tl-out').textContent = 'Loading…';
  try {
    renderTaskLists(await api('POST', 'tasklists/sync'));
    $('tl-out').textContent = 'Loaded.';
  } catch (e) {
    $('tl-out').textContent = TL_ERRORS[e.message] || 'Failed: ' + e.message;
  }
});

$('tl-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const selected = Array.prototype.map.call(document.querySelectorAll('#tl-list input:checked'), (b) => b.value);
  try {
    const r = await api('PUT', 'tasklists', { selected });
    $('tl-out').textContent = 'Saved ' + r.selected + ' list(s).' + (r.refreshed ? ' The frame updates within a minute.' : ' The frame updates at the next refresh.');
  } catch (e) {
    $('tl-out').textContent = TL_ERRORS[e.message] || 'Failed: ' + e.message;
  }
});

// ----- Photos hidden on the frame -----
async function loadPhotos() {
  try {
    $('ph-hidden').textContent = String((await api('GET', 'photos')).hidden);
  } catch (e) {
    $('ph-out').textContent = 'Failed: ' + e.message;
  }
}

$('ph-unhide').addEventListener('click', async () => {
  try {
    const r = await api('POST', 'photos/unhide-all');
    $('ph-out').textContent = r.unhidden + ' photo(s) back in the slideshow.';
    loadPhotos();
  } catch (e) {
    $('ph-out').textContent = 'Failed: ' + e.message;
  }
});

// ----- Frame settings (PLAN-v2.md §7): view, reset, and a weather-location fallback -----
const fmtMin = (m) => {
  const h = Math.floor(m / 60) % 24;
  return (h % 12 || 12) + ':' + String(m % 60).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
};
const SETTING_TEXT = {
  schedule: (v) => 'Day ' + fmtMin(v.dayStart) + ' to ' + fmtMin(v.nightStart),
  night: (v) => 'Night clock at ' + v.dimPct + '%',
  idle: (v) => 'Back to Home after ' + v.minutes + ' min',
  weather: (v) => v.name + ' (' + v.lat + ', ' + v.lon + ')',
  calendar: (v) => 'Calendar opens in ' + v.view + ' view',
  photos: (v) => 'Every ' + v.intervalSec + ' s, ' + v.order + ', ' + v.fit + (v.captions ? ', captions' : '') + (v.favoritesOnly ? ', favorites only' : ''),
  tasks: (v) => (v.onHome ? 'Due today shown on Home' : 'Not on Home'),
  alerts: (v) =>
    'Events ' + v.leadMin + ' min before' + ', chime ' + (v.chime ? 'on at ' + v.volume + '%' : 'off') +
    ', tasks ' + (v.tasks ? 'at ' + fmtMin(v.tasksAt) : 'off') +
    ', quiet ' + (v.quiet === 'night' ? 'at night' : fmtMin(v.quiet.start) + ' to ' + fmtMin(v.quiet.end)),
  controls: (v) => 'Indoor cameras ' + (v.indoor ? 'on, reveal ' + v.revealSec + ' s' : 'off'),
};

async function loadSettings() {
  try {
    const r = await api('GET', 'settings');
    const t = $('set-table');
    t.textContent = '';
    for (const s of r.settings) {
      const tr = document.createElement('tr');
      for (const text of [s.key, SETTING_TEXT[s.key] ? SETTING_TEXT[s.key](s.value) : JSON.stringify(s.value), s.updatedAt ? new Date(s.updatedAt).toLocaleString() + ' by ' + s.updatedBy.split(':')[0] : 'default']) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
  } catch (e) {
    $('set-out').textContent = 'Failed: ' + e.message;
  }
}

$('wx-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ul = $('wx-results');
  ul.textContent = '';
  try {
    const r = await api('GET', 'settings/weather/search?q=' + encodeURIComponent($('wx-q').value));
    for (const p of r.places) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
      b.addEventListener('click', async () => {
        try {
          await api('PUT', 'settings/weather', { name: p.name, lat: p.lat, lon: p.lon, timeZone: p.timeZone });
          ul.textContent = '';
          $('set-out').textContent = 'Weather location saved.';
          loadSettings();
        } catch (e) {
          $('set-out').textContent = 'Failed: ' + e.message;
        }
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
    if (!r.places.length) $('set-out').textContent = 'No places found.';
  } catch (e) {
    $('set-out').textContent = 'Failed: ' + e.message;
  }
});

$('set-reset').addEventListener('click', async () => {
  if (!confirm('Reset every frame setting to its default?')) return;
  try {
    await api('POST', 'settings/reset');
    $('set-out').textContent = 'Reset. The frame picks it up within a minute.';
    loadSettings();
  } catch (e) {
    $('set-out').textContent = 'Failed: ' + e.message;
  }
});

const SPOTIFY_MSG = {
  ok: 'Spotify connected.',
  spotify_client_missing: 'Spotify isn\u2019t set up on the Worker yet (SPOTIFY_CLIENT_SECRET missing).',
  consent_denied: 'Spotify sign-in was cancelled.',
  scope_missing: 'Spotify didn\u2019t grant playback control. Try again and accept.',
};

async function loadSpotify() {
  try {
    const s = await api('GET', 'spotify');
    let t;
    if (!s.configured) t = 'Not set up: SPOTIFY_CLIENT_SECRET isn\u2019t on the Worker yet.';
    else if (s.status === 'ok') t = 'Connected. Reconnect Spotify by ' + (s.reconnectBy ? new Date(s.reconnectBy).toLocaleDateString() : '?') + ' (Spotify sign-ins last 6 months).';
    else if (s.status === 'needs_reconsent') t = 'Spotify needs reconnecting.';
    else t = 'Not connected.';
    $('sp-status').textContent = t;
    $('sp-connect').textContent = s.status === 'ok' || s.status === 'needs_reconsent' ? 'Reconnect Spotify' : 'Connect Spotify';
  } catch (e) {
    $('sp-status').textContent = 'Could not load: ' + e.message;
  }
}

$('sp-disconnect').addEventListener('click', async () => {
  if (!confirm('Disconnect Spotify? The frame\u2019s player stops until you reconnect.')) return;
  try {
    await api('POST', 'spotify/disconnect');
    $('sp-out').textContent = 'Disconnected.';
    loadSpotify();
  } catch (e) {
    $('sp-out').textContent = 'Failed: ' + e.message;
  }
});

const spotifyParam = new URLSearchParams(location.search).get('spotify');
if (spotifyParam) $('sp-out').textContent = SPOTIFY_MSG[spotifyParam] || 'Spotify sign-in failed: ' + spotifyParam;

// ----- Controls (PLAN-v2.md §11.3, §11.7): HA status, camera allowlist, indoor switch -----
const CTL_MISSING = {
  no_binding: 'Not connected: the Worker has no HA (Workers VPC) binding yet. Cameras show "not connected" on the frame.',
  no_token: 'Not connected: HA_TOKEN isn\u2019t on the Worker yet.',
};

function ctlInput(cls, value, attrs) {
  const i = document.createElement('input');
  i.className = cls;
  for (const k of Object.keys(attrs)) i.setAttribute(k, attrs[k]);
  if (attrs.type === 'checkbox') i.checked = !!value;
  else i.value = value;
  const td = document.createElement('td');
  td.appendChild(i);
  return td;
}

function ctlRows(cams) {
  const body = $('ctl-rows');
  body.textContent = '';
  for (let i = 0; i < 4; i++) {
    const c = cams[i] || { entityId: '', label: '', indoor: false };
    const tr = document.createElement('tr');
    const n = document.createElement('td');
    n.textContent = String(i + 1);
    tr.appendChild(n);
    tr.appendChild(ctlInput('ctl-entity', c.entityId, { list: 'ctl-entities', placeholder: 'camera.front_door_snapshot', maxlength: '87' }));
    tr.appendChild(ctlInput('ctl-label', c.label, { placeholder: 'Front door', maxlength: '40' }));
    tr.appendChild(ctlInput('ctl-indoor', c.indoor, { type: 'checkbox' }));
    body.appendChild(tr);
  }
}

async function loadControls() {
  try {
    const s = await api('GET', 'controls');
    let t;
    if (!s.connected) t = CTL_MISSING[s.missing] || 'Not connected.';
    else if (s.ha && s.ha.ok) t = 'HA reachable' + (s.ha.version ? ', version ' + s.ha.version : '') + '.';
    else t = 'HA not reachable (' + ((s.ha && s.ha.error) || 'error') + '). The frame shows "Cameras offline".';
    $('ctl-status').textContent = t + ' ' + s.cams.length + ' of 4 cameras set.';
    ctlRows(s.cams);
  } catch (e) {
    $('ctl-status').textContent = 'Could not load: ' + e.message;
  }
  try {
    const r = await api('GET', 'settings');
    const c = (r.settings.find((x) => x.key === 'controls') || {}).value || { indoor: false, revealSec: 45 };
    $('ctl-indoor').checked = !!c.indoor;
    const sel = $('ctl-reveal');
    sel.textContent = '';
    for (let v = 30; v <= 60; v += 5) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = String(v);
      if (v === c.revealSec) o.selected = true;
      sel.appendChild(o);
    }
  } catch {
    // the settings table shows its own error
  }
}

$('ctl-list').addEventListener('click', async () => {
  $('ctl-list-out').textContent = 'Asking Home Assistant…';
  try {
    const r = await api('GET', 'controls/cameras');
    const dl = $('ctl-entities');
    dl.textContent = '';
    for (const c of r.cameras) {
      const o = document.createElement('option');
      o.value = c.entityId;
      o.textContent = c.name;
      dl.appendChild(o);
    }
    $('ctl-list-out').textContent = r.cameras.length + ' cameras found. Pick them in the entity boxes (ring-mqtt\u2019s "…_snapshot" cameras).';
  } catch (e) {
    $('ctl-list-out').textContent = 'Failed: ' + e.message;
  }
});

$('ctl-save').addEventListener('click', async () => {
  const cams = [];
  for (const tr of $('ctl-rows').children) {
    const entityId = tr.querySelector('.ctl-entity').value.trim();
    if (!entityId) continue;
    cams.push({ entityId, label: tr.querySelector('.ctl-label').value.trim(), indoor: tr.querySelector('.ctl-indoor').checked });
  }
  try {
    await api('PUT', 'controls/cams', { cams });
    $('ctl-out').textContent = 'Saved.';
    loadControls();
  } catch (e) {
    $('ctl-out').textContent = 'Failed: ' + e.message;
  }
});

async function saveControlsSetting(patch) {
  try {
    await api('PUT', 'settings/controls', patch);
    $('ctl-set-out').textContent = 'Saved.';
    loadSettings();
  } catch (e) {
    $('ctl-set-out').textContent = 'Failed: ' + e.message;
  }
}
$('ctl-indoor').addEventListener('change', () => saveControlsSetting({ indoor: $('ctl-indoor').checked }));
$('ctl-reveal').addEventListener('change', () => saveControlsSetting({ revealSec: Number($('ctl-reveal').value) }));

const oauth = new URLSearchParams(location.search).get('oauth');
if (oauth) $('grant-out').textContent = oauth === 'ok' ? 'Google connected.' : 'Google sign-in failed: ' + oauth;

loadStatus();
loadSpotify();
loadControls();
loadCalendars();
loadTaskLists();
loadPhotos();
loadSettings();
