// Guide HTML → reflection JSON (PLAN.md §9.4). Pure, no I/O, so it can be unit-tested on a synthetic guide.
// Expected structure: <h1>title</h1>, <div class="date">overall range</div>, and one <div class="week">
// per week holding <h3>Week N · theme</h3> and <p class="practice">…</p>. Weeks are 7-day blocks from
// the guide's start; the last week ends on the guide's end date.
import { validateGuide } from '../../shared/reflection.js';
import { addDays } from '../../shared/time.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function text(html) {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html, re) {
  const m = re.exec(html);
  return m ? m[1] : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** "Oct 21 – Nov 25, 2026", "October 21, 2026 to November 25, 2026", … → {start, end} as YYYY-MM-DD. */
export function parseRange(s) {
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/gi;
  const found = [...s.matchAll(re)].map((m) => ({ mon: MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1, day: Number(m[2]), year: m[3] ? Number(m[3]) : null }));
  if (found.length < 2) return null;
  const a = found[0];
  const b = found[found.length - 1];
  const anyYear = (s.match(/\b(20\d{2})\b/) || [])[1];
  b.year = b.year ?? (anyYear ? Number(anyYear) : null);
  if (!b.year) return null;
  a.year = a.year ?? (a.mon > b.mon ? b.year - 1 : b.year);
  return { start: a.year + '-' + pad(a.mon) + '-' + pad(a.day), end: b.year + '-' + pad(b.mon) + '-' + pad(b.day) };
}

/**
 * Returns { guide, problems }. `overrides` may supply {start, end} when the date line can't be parsed.
 * Never includes the input in errors.
 */
export function extractGuide(html, overrides = {}) {
  const problems = [];
  const title = text(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || '');
  const dateLine = text(firstMatch(html, /<div[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || '');
  const range = parseRange(dateLine) || {};
  const start = overrides.start || range.start;
  const end = overrides.end || range.end;
  if (!start || !end) problems.push('date_range_unparsed');

  // Split on each week block's opening tag; each chunk runs to the next block.
  const chunks = html.split(/<div[^>]*class="[^"]*\bweek\b[^"]*"[^>]*>/i).slice(1);
  const weeks = [];
  chunks.forEach((chunk, i) => {
    const h3 = text(firstMatch(chunk, /<h3[^>]*>([\s\S]*?)<\/h3>/i) || '');
    const m = /^week\s+(\d+)\s*[·:\-–—]\s*(.+)$/i.exec(h3);
    if (!m) {
      problems.push('week_' + (i + 1) + '_heading');
      return;
    }
    const theme = m[2].replace(/\s*\((?:to|through|until|thru)\b[^)]*\)\s*$/i, '').trim();
    const practice = text(firstMatch(chunk, /<p[^>]*class="[^"]*\bpractice\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || '');
    weeks.push({ n: Number(m[1]), theme, practice });
  });
  if (!weeks.length) problems.push('no_weeks');
  if (problems.length) return { guide: null, problems };

  const out = {
    guide: { title, start, end },
    weeks: weeks.map((w, i) => ({
      n: w.n,
      start: addDays(start, 7 * i),
      end: i === weeks.length - 1 ? end : addDays(start, 7 * i + 6),
      theme: w.theme,
      practice: w.practice,
    })),
  };
  const invalid = validateGuide(out);
  return invalid.length ? { guide: null, problems: invalid } : { guide: out, problems: [] };
}

/** Structure-only summary, safe to print: week numbers, dates and text lengths. */
export function summary(g) {
  return [
    'guide ' + g.guide.start + ' → ' + g.guide.end + ', ' + g.weeks.length + ' weeks',
    ...g.weeks.map((w) => '  week ' + w.n + ': ' + w.start + ' → ' + w.end + '  (theme ' + w.theme.length + ' chars, practice ' + w.practice.length + ' chars)'),
  ].join('\n');
}
