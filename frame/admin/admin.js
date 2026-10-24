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

const oauth = new URLSearchParams(location.search).get('oauth');
if (oauth) $('grant-out').textContent = oauth === 'ok' ? 'Google connected.' : 'Google sign-in failed: ' + oauth;

loadStatus();
