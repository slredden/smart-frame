import { describe, it, expect } from 'vitest';
import { startAuth, finishAuth, accessToken, grantStatuses } from '../../worker/src/google/oauth.js';
import { startPicker, stepPicker, KV_DAILY_BUDGET } from '../../worker/src/google/picker.js';
import { refreshCalendar, cachedCalendar } from '../../worker/src/google/calendar.js';
import { photoManifest } from '../../worker/src/photos.js';
import { testEnv, setup, ORIGIN } from './helpers.js';

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
    const r = await connect(env, 'calendar', 'https://www.googleapis.com/auth/calendar.events.readonly');
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
    await connect(env, 'calendar', 'https://www.googleapis.com/auth/calendar.events.readonly');
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
    await connect(env, 'calendar', 'https://www.googleapis.com/auth/calendar.events.readonly');
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
