import { describe, it, expect } from 'vitest';
import { startAuth, finishAuth, accessToken, grantStatuses } from '../../worker/src/google/oauth.js';
import { startPicker, stepPicker, KV_DAILY_BUDGET } from '../../worker/src/google/picker.js';
import { refreshCalendar, cachedCalendar, syncCalendarList, listCalendars, setSelection, calendarPayload, MAX_SELECTED } from '../../worker/src/google/calendar.js';
import { photoManifest } from '../../worker/src/photos.js';
import { testEnv, setup, ORIGIN } from './helpers.js';

const CAL_SCOPES = 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

async function connect(env, grant, scope) {
  const url = new URL(await startAuth(env, grant, ORIGIN));
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('access_type')).toBe('offline');
  const state = url.searchParams.get('state');
  const fetchImpl = async (u, init) => {
    expect(String(u)).toBe('https://oauth2.googleapis.com/token');
    expect(String(init.body)).toContain('code_verifier=');
    return json({ access_token: 'at-' + grant, refresh_token: 'rt-' + grant, expires_in: 3600, scope });
  };
  return finishAuth(env, new URL(ORIGIN + '/admin/oauth/callback?state=' + state + '&code=c1'), { fetchImpl });
}

describe('oauth', () => {
  it('connects, stores tokens encrypted, and refuses replayed state', async () => {
    const env = testEnv();
    await setup(env);
    const r = await connect(env, 'calendar', CAL_SCOPES);
    expect(r.ok).toBe(true);
    const row = await env.FRAME_DB.prepare("SELECT refresh_enc, access_enc FROM grants WHERE name = 'calendar'").first();
    expect(row.refresh_enc).not.toContain('rt-calendar');
    expect(row.access_enc).not.toContain('at-calendar');
    expect(await accessToken(env, 'calendar', { fetchImpl: () => { throw new Error('should use cache'); } })).toBe('at-calendar');
    expect((await grantStatuses(env.FRAME_DB)).calendar.status).toBe('ok');
    const replay = await finishAuth(env, new URL(ORIGIN + '/admin/oauth/callback?state=bogus&code=c1'));
    expect(replay).toMatchObject({ ok: false, error: 'bad_state' });
  });

  it('refuses a grant missing its scope', async () => {
    const env = testEnv();
    await setup(env);
    const r = await connect(env, 'photos', 'openid');
    expect(r.ok).toBe(false);
  });

  it('marks needs_reconsent on invalid_grant', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    const later = Date.now() + 2 * 3600000;
    const t = await accessToken(env, 'calendar', { nowMs: later, fetchImpl: async () => json({ error: 'invalid_grant' }, 400) });
    expect(t).toBe(null);
    expect((await grantStatuses(env.FRAME_DB)).calendar.status).toBe('needs_reconsent');
  });
});

describe('calendar refresh', () => {
  it('caches normalized events only', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    const fetchImpl = async (u) => {
      expect(String(u)).toContain('/calendars/primary/events');
      return json({ items: [{ summary: 'Dentist', description: 'private', start: { dateTime: '2026-10-24T09:00:00-06:00' }, end: { dateTime: '2026-10-24T10:00:00-06:00' } }] });
    };
    expect((await refreshCalendar(env, { fetchImpl, nowMs: Date.parse('2026-10-24T14:00:00Z') })).ok).toBe(true);
    const c = await cachedCalendar(env.FRAME_DB);
    expect(JSON.stringify(c.value)).not.toContain('private');
    expect(c.value.events[0].title).toBe('Dentist');
  });
});

describe('calendar selection (v1.1)', () => {
  const NOW = Date.parse('2026-10-24T14:00:00Z'); // 8:00 AM Denver
  const list = {
    items: [
      { id: 'me@example.com', summary: 'me@example.com', backgroundColor: '#9fe1e7', primary: true },
      { id: 'family@group.calendar.google.com', summary: 'Family', backgroundColor: '#F83A22' },
      { id: 'trash#import@group.v.calendar.google.com', summary: 'Trash', summaryOverride: 'Trash pickup', backgroundColor: 'red' },
    ],
  };

  it('asks for the calendar list scope on new consents and refuses a consent without it', async () => {
    const env = testEnv();
    await setup(env);
    const url = new URL(await startAuth(env, 'calendar', ORIGIN));
    expect(url.searchParams.get('scope')).toBe(CAL_SCOPES);
    const r = await connect(env, 'calendar', 'https://www.googleapis.com/auth/calendar.events.readonly');
    expect(r).toMatchObject({ ok: false, error: 'scope_missing' });
  });

  it('a v1 grant (events scope only) keeps working for the primary calendar but must reconnect to list', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    await env.FRAME_DB.prepare("UPDATE grants SET scope = 'https://www.googleapis.com/auth/calendar.events.readonly' WHERE name = 'calendar'").run();
    expect(await syncCalendarList(env, { fetchImpl: () => { throw new Error('no fetch'); } })).toEqual({ ok: false, error: 'reconnect_calendar' });
    const seen = [];
    const fetchImpl = async (u) => {
      seen.push(String(u));
      return json({ items: [] });
    };
    expect((await refreshCalendar(env, { fetchImpl, nowMs: NOW })).ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/calendars/primary/events');
  });

  it('syncs the list, keeps selections across syncs, and selects only primary on the first sync', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    let reply = list;
    const fetchImpl = async (u) => {
      expect(String(u)).toContain('/users/me/calendarList?');
      return json(reply);
    };
    expect((await syncCalendarList(env, { fetchImpl })).ok).toBe(true);
    let cals = await listCalendars(env.FRAME_DB);
    expect(cals.map((c) => [c.summary, c.selected, c.color])).toEqual([
      ['me@example.com', true, '#9fe1e7'],
      ['Family', false, '#f83a22'],
      ['Trash pickup', false, null],
    ]);
    expect((await setSelection(env.FRAME_DB, ['family@group.calendar.google.com', 'trash#import@group.v.calendar.google.com'])).ok).toBe(true);
    reply = { items: list.items.slice(1) }; // primary gone from the list (edge case); others keep their selection
    expect((await syncCalendarList(env, { fetchImpl })).ok).toBe(true);
    cals = await listCalendars(env.FRAME_DB);
    expect(cals.map((c) => [c.summary, c.selected])).toEqual([['Family', true], ['Trash pickup', true]]);
    reply = { items: [] };
    expect(await syncCalendarList(env, { fetchImpl })).toEqual({ ok: false, error: 'no_calendars' });
    expect(await listCalendars(env.FRAME_DB)).toHaveLength(2);
  });

  it('refuses unknown ids and selections over the cap', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    await syncCalendarList(env, { fetchImpl: async () => json(list) });
    expect(await setSelection(env.FRAME_DB, ['nope'])).toEqual({ ok: false, error: 'unknown_calendar' });
    expect(await setSelection(env.FRAME_DB, 'x')).toEqual({ ok: false, error: 'bad_selection' });
    expect((await setSelection(env.FRAME_DB, Array.from({ length: MAX_SELECTED + 1 }, (_, i) => 'c' + i))).error).toBe('too_many_calendars');
  });

  it('fetches every selected calendar, merges with colors, skips a failing one, and keeps one look-ahead event', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    await syncCalendarList(env, { fetchImpl: async () => json(list) });
    await setSelection(env.FRAME_DB, list.items.map((c) => c.id));
    let calls = 0;
    const fetchImpl = async (u) => {
      calls++;
      const s = String(u);
      expect(s).not.toContain('#'); // ids are URL-encoded
      if (s.includes('/calendars/' + encodeURIComponent('me@example.com') + '/events')) return json({ items: [] });
      if (s.includes('/calendars/' + encodeURIComponent('family@group.calendar.google.com') + '/events')) {
        expect(new URL(s).searchParams.get('timeMax')).toBe('2026-11-23T07:00:00.000Z'); // 30 days ahead, Denver midnight
        return json({
          items: [
            { summary: 'Soccer', start: { dateTime: '2026-11-02T17:00:00-07:00' }, end: { dateTime: '2026-11-02T18:00:00-07:00' } },
            { summary: 'Later thing', start: { dateTime: '2026-11-09T17:00:00-07:00' }, end: { dateTime: '2026-11-09T18:00:00-07:00' } },
          ],
        });
      }
      return new Response('gone', { status: 404 });
    };
    const r = await refreshCalendar(env, { fetchImpl, nowMs: NOW });
    expect(r).toMatchObject({ ok: true, calendars: 3, failed: 1 });
    expect(calls).toBe(3);
    const c = await cachedCalendar(env.FRAME_DB);
    expect(c.value.events.map((e) => e.title)).toEqual(['Soccer']); // only the first event after tomorrow is kept
    const p = calendarPayload(c.value.events, NOW, 'America/Denver');
    expect(p.today.timed).toEqual([]);
    expect(p.tomorrowFirst).toBe(null);
    expect(p.ahead).toEqual({ title: 'Soccer', start: '2026-11-02T17:00:00-07:00', allDay: false, color: '#f83a22' });
  });

  it('keeps the old cache when every calendar fails', async () => {
    const env = testEnv();
    await setup(env);
    await connect(env, 'calendar', CAL_SCOPES);
    expect((await refreshCalendar(env, { fetchImpl: async () => json({ items: [{ summary: 'A', start: { dateTime: '2026-10-24T09:00:00-06:00' }, end: { dateTime: '2026-10-24T10:00:00-06:00' } }] }), nowMs: NOW })).ok).toBe(true);
    expect((await refreshCalendar(env, { fetchImpl: async () => new Response('x', { status: 500 }), nowMs: NOW })).ok).toBe(false);
    expect((await cachedCalendar(env.FRAME_DB)).value.events[0].title).toBe('A');
  });
});

describe('photos picker', () => {
  it('ingests in batches and swaps the active set atomically', async () => {
    const env = testEnv();
    const device = await setup(env);
    await connect(env, 'photos', 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly');
    let picked = false;
    let deleted = false;
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: 'm' + i,
      type: i === 3 ? 'VIDEO' : 'PHOTO',
      createTime: '2020-0' + ((i % 9) + 1) + '-01T00:00:00Z',
      mediaFile: { baseUrl: 'https://lh3.example/m' + i, mimeType: 'image/jpeg', mediaFileMetadata: { width: i % 2 ? 3000 : 4000, height: 3500 } },
    }));
    let subrequests = 0;
    const fetchImpl = async (u, init = {}) => {
      subrequests++;
      const s = String(u);
      if (s.endsWith('/v1/sessions') && init.method === 'POST') {
        expect(JSON.parse(init.body).pickingConfig.maxItemCount).toBe('300');
        return json({ id: 'sess1', pickerUri: 'https://photos.google.com/picker/x', pollingConfig: { pollInterval: '3s' } });
      }
      if (s.endsWith('/v1/sessions/sess1') && init.method === 'DELETE') {
        deleted = true;
        return json({});
      }
      if (s.endsWith('/v1/sessions/sess1')) return json({ id: 'sess1', mediaItemsSet: picked });
      if (s.includes('/v1/mediaItems?')) {
        const q = new URL(s).searchParams;
        const start = q.get('pageToken') ? Number(q.get('pageToken')) : 0;
        const size = Number(q.get('pageSize'));
        const page = items.slice(start, start + size);
        return json({ mediaItems: page, nextPageToken: start + size < items.length ? String(start + size) : undefined });
      }
      if (s.startsWith('https://lh3.example/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
      throw new Error('unexpected ' + s);
    };
    const st = await startPicker(env, { fetchImpl });
    expect(st.ok).toBe(true);
    expect(st.pickerUri).toMatch(/\/autoclose$/);
    expect((await stepPicker(env, st.id, { fetchImpl })).status).toBe('picking');
    picked = true;
    expect((await stepPicker(env, st.id, { fetchImpl })).status).toBe('ingesting');
    subrequests = 0;
    const s1 = await stepPicker(env, st.id, { fetchImpl });
    expect(subrequests).toBeLessThanOrEqual(45);
    expect(s1).toMatchObject({ status: 'ingesting', count: 19, skipped: 1 });
    expect((await photoManifest(env, device.id)).setId).toBe(null); // not active until done
    const s2 = await stepPicker(env, st.id, { fetchImpl });
    expect(s2).toMatchObject({ status: 'done', count: 24, skipped: 1 });
    expect(deleted).toBe(true);
    const m = await photoManifest(env, device.id);
    expect(m.items).toHaveLength(24);
    expect(m.items[1].orient).toBe('p');
    const w = await env.FRAME_DB.prepare('SELECT SUM(count) AS n FROM kv_writes').first();
    expect(w.n).toBe(24);
  });

  it('refuses to start when the KV budget cannot fit a full set', async () => {
    const env = testEnv();
    await setup(env);
    const day = new Date().toISOString().slice(0, 10);
    await env.FRAME_DB.prepare('INSERT INTO kv_writes (day, count) VALUES (?, ?)').bind(day, KV_DAILY_BUDGET - 100).run();
    expect(await startPicker(env, { fetchImpl: () => { throw new Error('no fetch'); } })).toEqual({ ok: false, error: 'kv_budget_today' });
  });
});
