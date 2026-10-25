import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractGuide, parseRange, summary, dateLineText } from '../../tools/lib/reflection-parse.mjs';
import { parseArgs, baseUrl } from '../../tools/lib/cli.mjs';
import { scrubLine } from '../../tools/deploy-worker.mjs';

const html = readFileSync(new URL('../fixtures/guide-synthetic.html', import.meta.url), 'utf8');
// Same synthetic guide in the layout the private hub publishes (p.meta spans instead of div.date).
const published = readFileSync(new URL('../fixtures/guide-synthetic-published.html', import.meta.url), 'utf8');

describe('reflection extractor (synthetic guide)', () => {
  it('extracts 7-day weeks from the start; the last week runs to the end date', () => {
    const { guide, problems } = extractGuide(html);
    expect(problems).toEqual([]);
    expect(guide.guide).toMatchObject({ title: 'Lorem Ipsum Guide', start: '2026-10-21', end: '2026-11-25' });
    expect(guide.weeks.map((w) => [w.n, w.start, w.end])).toEqual([
      [1, '2026-10-21', '2026-10-27'],
      [2, '2026-10-28', '2026-11-03'],
      [3, '2026-11-04', '2026-11-10'],
      [4, '2026-11-11', '2026-11-17'],
      [5, '2026-11-18', '2026-11-25'],
    ]);
    expect(guide.weeks[0].theme).toBe('Lorem ipsum dolor');
    expect(guide.weeks[4].theme).toBe('Excepteur sint');
    expect(guide.weeks[1].practice).toBe('Tempor incididunt ut labore.');
  });

  it('summary carries dates and lengths, never text', () => {
    const s = summary(extractGuide(html).guide);
    expect(s).toContain('week 5: 2026-11-18 → 2026-11-25');
    expect(s).not.toMatch(/Lorem|Tempor|Excepteur/);
  });

  it('refuses when weeks do not tile the range', () => {
    const r = extractGuide(html, { end: '2026-12-31' });
    expect(r.guide).toBeNull();
    expect(r.problems).toContain('week_5_length');
  });

  it('refuses without a date range, and accepts overrides', () => {
    const noDate = html.replace(/<div class="date">.*?<\/div>/, '');
    expect(extractGuide(noDate).problems).toEqual(['date_range_unparsed']);
    expect(extractGuide(noDate, { start: '2026-10-21', end: '2026-11-25' }).problems).toEqual([]);
  });

  it('reads the published layout date line (p.meta spans) without flags', () => {
    expect(dateLineText(published)).toBe('A lorem-style guide · October 21 – November 25, 2026 · drawn from Month 2, "Lorem"');
    const { guide, problems } = extractGuide(published);
    expect(problems).toEqual([]);
    expect(guide.guide).toMatchObject({ start: '2026-10-21', end: '2026-11-25' });
    expect(guide.weeks.map((w) => [w.n, w.start, w.end])).toEqual([
      [1, '2026-10-21', '2026-10-27'],
      [2, '2026-10-28', '2026-11-03'],
      [3, '2026-11-04', '2026-11-10'],
      [4, '2026-11-11', '2026-11-17'],
      [5, '2026-11-18', '2026-11-25'],
    ]);
  });

  it('reads the draft layout date line with a prefix and suffix', () => {
    const draft = html.replace(/<div class="date">.*?<\/div>/, '<div class="date">A lorem-style guide · October 21 – November 25, 2026 · drawn from Month 2, "Lorem"</div>');
    expect(extractGuide(draft).guide.guide).toMatchObject({ start: '2026-10-21', end: '2026-11-25' });
  });

  it('ignores dates outside the date line', () => {
    const noDate = published.replace(/<p class="meta">.*?<\/p>/, '<h2>Praxis day · Thursday, October 22</h2>');
    expect(extractGuide(noDate).problems).toEqual(['date_range_unparsed']);
  });

  it('parses common date-line shapes', () => {
    expect(parseRange('October 21 – November 25, 2026')).toEqual({ start: '2026-10-21', end: '2026-11-25' });
    expect(parseRange('Dec 28, 2026 to Jan 31, 2027')).toEqual({ start: '2026-12-28', end: '2027-01-31' });
    expect(parseRange('Dec 28 – Jan 31, 2027')).toEqual({ start: '2026-12-28', end: '2027-01-31' });
    expect(parseRange('no dates here')).toBeNull();
  });
});

describe('cli helpers', () => {
  it('parses flags', () => {
    expect(parseArgs(['g.html', '--dry-run', '--start', '2026-10-21', '--end=2026-11-25'])).toEqual({ _: ['g.html'], 'dry-run': true, start: '2026-10-21', end: '2026-11-25' });
  });
  it('requires https', () => {
    expect(() => baseUrl({ base: 'http://example.com' })).toThrow();
    expect(baseUrl({ base: 'http://127.0.0.1:8787/' })).toBe('http://127.0.0.1:8787');
  });
  it('deploy filter drops asset lines', () => {
    expect(scrubLine(' + /assets/index-abc.js')).toBeNull();
    expect(scrubLine('Uploaded 3 of 9 assets')).toBeNull();
    expect(scrubLine('Current Version ID: 123')).toBe('Current Version ID: 123');
  });
});

describe('set-worker-secrets', async () => {
  const { collectSecrets, scrub, SECRETS, OPTIONAL } = await import('../../tools/set-worker-secrets.mjs');
  const good = {
    URL_SIGNING_KEY: 'u'.repeat(43),
    TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
    HEALTH_TOKEN_HASH: 'a'.repeat(64),
    PUBLISH_TOKEN_HASH: 'b'.repeat(64),
    ADMIN_EMAILS: 'one@example.com, two@example.org',
    GOOGLE_CLIENT_SECRET: 'fake-client-secret-0000',
  };
  const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', 'x'.repeat(80), 'y'.repeat(43)].join('.');
  const optional = { HA_TOKEN: fakeJwt, SPOTIFY_CLIENT_SECRET: 'f'.repeat(32) };
  it('accepts a complete, well-formed set; optional Controls secrets are skipped while unset', () => {
    const { values, problems, skipped } = collectSecrets(good);
    expect(problems).toEqual([]);
    expect(Object.keys(values).sort()).toEqual(Object.keys(SECRETS).sort());
    expect(skipped).toEqual(['HA_TOKEN', 'SPOTIFY_CLIENT_SECRET']);
  });
  it('includes the optional secrets when present', () => {
    const { values, problems, skipped } = collectSecrets({ ...good, ...optional });
    expect(problems).toEqual([]);
    expect(skipped).toEqual([]);
    expect(Object.keys(values).sort()).toEqual([...Object.keys(SECRETS), ...Object.keys(OPTIONAL)].sort());
  });
  it('refuses a malformed optional secret, by name only', () => {
    const env = { ...good, HA_TOKEN: 'not a token', SPOTIFY_CLIENT_SECRET: 'ABC' };
    const { problems } = collectSecrets(env);
    expect(problems).toEqual([
      'HA_TOKEN: must be a Home Assistant long-lived access token (a JWT)',
      'SPOTIFY_CLIENT_SECRET: must be 32 lowercase hex characters',
    ]);
    expect(problems.join(' ')).not.toContain('not a token');
  });
  it('reports missing and malformed secrets by name only', () => {
    const env = { ...good, GOOGLE_CLIENT_SECRET: '', TOKEN_ENC_KEY: Buffer.alloc(16).toString('base64'), HEALTH_TOKEN_HASH: 'A'.repeat(64) };
    const { problems } = collectSecrets(env);
    expect(problems).toEqual([
      'TOKEN_ENC_KEY: must be 32 bytes, base64',
      'HEALTH_TOKEN_HASH: must be a lowercase SHA-256 hex digest',
      'GOOGLE_CLIENT_SECRET: missing',
    ]);
    expect(problems.join(' ')).not.toContain(env.TOKEN_ENC_KEY);
  });
  it('rejects a bad admin email list', () => {
    expect(collectSecrets({ ...good, ADMIN_EMAILS: 'not-an-email' }).problems).toEqual(['ADMIN_EMAILS: must be comma-separated email addresses']);
  });
  it('hides any line that contains a value', () => {
    expect(scrub('Uploaded secret ' + good.URL_SIGNING_KEY, good)).toBe('[line hidden]');
    expect(scrub('✨ 6 secrets successfully uploaded', good)).toBe('✨ 6 secrets successfully uploaded');
  });
});
