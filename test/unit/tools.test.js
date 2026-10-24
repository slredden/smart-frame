import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractGuide, parseRange, summary } from '../../tools/lib/reflection-parse.mjs';
import { parseArgs, baseUrl } from '../../tools/lib/cli.mjs';
import { scrubLine } from '../../tools/deploy-worker.mjs';

const html = readFileSync(new URL('../fixtures/guide-synthetic.html', import.meta.url), 'utf8');

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
