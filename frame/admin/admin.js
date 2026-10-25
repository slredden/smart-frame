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
  const selected = Array.prototype.map.call(document.querySelectorAll('#cal-list input:checked'), (b) => b.value);
  try {
    const r = await api('PUT', 'calendars', { selected });
    $('cal-out').textContent = 'Saved ' + r.selected + ' calendar(s).' + (r.refreshed ? ' The frame updates within a minute.' : ' The frame updates at the next refresh.');
  } catch (e) {
    $('cal-out').textContent = CAL_ERRORS[e.message] || 'Failed: ' + e.message;
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

const oauth = new URLSearchParams(location.search).get('oauth');
if (oauth) $('grant-out').textContent = oauth === 'ok' ? 'Google connected.' : 'Google sign-in failed: ' + oauth;

loadStatus();
loadCalendars();
loadSettings();
