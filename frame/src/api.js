// Talking to the Worker: device token, /api/state polling with backoff, last-good snapshot, heartbeat.

export const TOKEN_KEY = 'sf.device';
export const SNAPSHOT_KEY = 'sf.state';
const TOKEN_RE = /(?:^#|&)d=([A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{16,128})(?:&|$)/;

/**
 * Takes the pairing token from the URL fragment (#d=<id>.<secret>) once, stores it, and strips it from
 * the address bar so it doesn't linger in history. Returns the token or null.
 */
export function takeToken(loc, storage, hist) {
  const m = TOKEN_RE.exec(loc.hash || '');
  if (m) {
    try {
      storage.setItem(TOKEN_KEY, m[1]);
    } catch {
      // storage full or disabled: still usable for this page load
    }
    if (hist && hist.replaceState) hist.replaceState(null, '', loc.pathname + loc.search);
    return m[1];
  }
  try {
    return storage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Backoff after `failures` consecutive failures: 5 s doubling to 5 min, with ±20% jitter. */
export function backoffMs(failures, rand = Math.random) {
  if (failures <= 0) return 0;
  const base = Math.min(5000 * Math.pow(2, failures - 1), 300000);
  return Math.round(base * (0.8 + 0.4 * rand()));
}

export function saveSnapshot(storage, state) {
  try {
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors; the snapshot is a convenience
  }
}

export function loadSnapshot(storage) {
  try {
    const raw = storage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Minimal client. `fetchImpl` is injectable for tests. Resolves {status, data}. Never throws. */
export function createClient(token, fetchImpl, base = '') {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  async function call(method, path, body) {
    try {
      const init = { method, headers: Object.assign({}, headers), cache: 'no-store' };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetchImpl(base + path, init);
      let data = null;
      if ((res.headers.get('content-type') || '').indexOf('application/json') === 0) data = await res.json();
      return { status: res.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }
  return {
    state: () => call('GET', '/api/state'),
    heartbeat: (info) => call('POST', '/api/heartbeat', info),
    // v2 P1 screens (PLAN-v2.md §3, §5, §7)
    calendar: (from, days) => call('GET', '/api/calendar?from=' + from + '&days=' + days),
    weather: () => call('GET', '/api/weather'),
    calendars: () => call('GET', '/api/calendars'),
    syncCalendars: () => call('POST', '/api/calendars/sync'),
    saveSelection: (ids, alertsOff) => call('PUT', '/api/calendars/selection', alertsOff ? { selected: ids, alertsOff } : { selected: ids }),
    saveSetting: (key, patch) => call('PUT', '/api/settings/' + key, patch),
    searchPlaces: (q) => call('GET', '/api/settings/weather/search?q=' + encodeURIComponent(q)),
    // P1b (PLAN-v2.md §4, §6, §8)
    tasks: () => call('GET', '/api/tasks'),
    tasklists: () => call('GET', '/api/tasklists'),
    syncTaskLists: () => call('POST', '/api/tasklists/sync'),
    saveTaskLists: (ids) => call('PUT', '/api/tasklists/selection', { selected: ids }),
    completeTask: (list, task) => call('POST', '/api/tasks/' + encodeURIComponent(list) + '/' + encodeURIComponent(task) + '/complete', { status: 'completed' }),
    reflection: () => call('GET', '/api/reflection'),
    photoFlag: (setId, n, patch) => call('PUT', '/api/photos/' + encodeURIComponent(setId) + '/' + encodeURIComponent(n), patch),
    // P2 Controls (PLAN-v2.md §11.4-§11.7)
    spotifyState: (devices) => call('GET', '/api/spotify/state' + (devices ? '?devices=1' : '')),
    spotifyAction: (action, body) => call('POST', '/api/spotify/' + action, body || {}),
    controlsState: () => call('GET', '/api/controls/state'),
    /** A camera picture as a Blob (it needs the device token, so no plain <img src>). */
    async camImage(id, reveal) {
      try {
        const res = await fetchImpl(base + '/api/controls/cam/' + encodeURIComponent(id) + (reveal ? '?reveal=1' : ''), { method: 'GET', headers: Object.assign({}, headers), cache: 'no-store' });
        if (!res.ok || (res.headers.get('content-type') || '').indexOf('image/') !== 0) return { status: res.ok ? 502 : res.status, blob: null };
        return { status: 200, blob: await res.blob() };
      } catch {
        return { status: 0, blob: null };
      }
    },
  };
}
