import { describe, it, expect, vi } from 'vitest';
import { seededShuffle } from '../../frame/src/shuffle.js';
import { takeToken, backoffMs, createClient, TOKEN_KEY } from '../../frame/src/api.js';
import { buildChanged, dailyReloadDue, quietMoment } from '../../frame/src/version.js';
import { describeWeather } from '../../shared/weather-codes.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe('shuffle', () => {
  it('is stable per seed and keeps every item', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = seededShuffle(items, 'set1|2026-10-24');
    expect(seededShuffle(items, 'set1|2026-10-24')).toEqual(a);
    expect(seededShuffle(items, 'set1|2026-10-25')).not.toEqual(a);
    expect(a.slice().sort((x, y) => x - y)).toEqual(items);
  });
});

describe('device token', () => {
  it('takes the fragment token once and strips it from the URL', () => {
    const storage = memStorage();
    const hist = { replaceState: vi.fn() };
    const tok = 'abcd1234.' + 'x'.repeat(43);
    expect(takeToken({ hash: '#d=' + tok, pathname: '/', search: '' }, storage, hist)).toBe(tok);
    expect(storage.getItem(TOKEN_KEY)).toBe(tok);
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(takeToken({ hash: '', pathname: '/', search: '' }, storage, hist)).toBe(tok);
  });

  it('rejects malformed fragments', () => {
    expect(takeToken({ hash: '#d=<script>', pathname: '/', search: '' }, memStorage(), null)).toBe(null);
  });
});

describe('backoff and client', () => {
  it('doubles from 5 s to a 5 min cap', () => {
    const mid = () => 0.5;
    expect(backoffMs(0, mid)).toBe(0);
    expect(backoffMs(1, mid)).toBe(5000);
    expect(backoffMs(3, mid)).toBe(20000);
    expect(backoffMs(20, mid)).toBe(300000);
    expect(backoffMs(1, () => 0)).toBe(4000);
  });

  it('never throws', async () => {
    const c = createClient('t', () => Promise.reject(new Error('offline')));
    expect(await c.state()).toEqual({ status: 0, data: null });
  });

  it('sends the bearer token', async () => {
    const f = vi.fn(async () => new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } }));
    const r = await createClient('tok', f).state();
    expect(r).toEqual({ status: 200, data: { ok: 1 } });
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
});

describe('reload rules', () => {
  it('build changes, ignoring dev', () => {
    expect(buildChanged('abc', 'def')).toBe(true);
    expect(buildChanged('abc', 'abc')).toBe(false);
    expect(buildChanged('dev', 'def')).toBe(false);
    expect(buildChanged('abc', null)).toBe(false);
  });

  it('daily reload window', () => {
    expect(dailyReloadDue(3 * 60 + 5, '2026-10-24', '2026-10-23', 7200000)).toBe(true);
    expect(dailyReloadDue(3 * 60 + 5, '2026-10-24', '2026-10-24', 7200000)).toBe(false);
    expect(dailyReloadDue(3 * 60 + 45, '2026-10-24', null, 7200000)).toBe(false);
    expect(dailyReloadDue(3 * 60 + 5, '2026-10-24', null, 60000)).toBe(false);
    expect(quietMoment({ overrideActive: false, crossfading: true })).toBe(false);
  });
});

describe('weather codes', () => {
  it('maps codes to labels and icons', () => {
    expect(describeWeather(0, true).icon).toBe('clear');
    expect(describeWeather(0, false).icon).toBe('clear-night');
    expect(describeWeather(95, true).icon).toBe('storm');
    expect(describeWeather(999, true).label).toBeTruthy();
  });
});
