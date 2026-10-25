// Renders the built frame in a real Chromium 106 at 1280×800 in mock mode and checks each screen.
// Screenshots go to test/e2e/out/ (git-ignored; CI uploads them as an artifact).
//   CHROME_106=/path/to/chrome node test/e2e/run.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
// puppeteer-core is pinned to 19.x: newer releases use CDP calls Chromium 106 does not have and hang on launch.
import puppeteer from 'puppeteer-core';

process.env.PUPPETEER_DISABLE_HEADLESS_WARNING = 'true';

const DIST = resolve('frame/dist');
const OUT = resolve('test/e2e/out');
const CHROME = process.env.CHROME_106 || resolve('test/e2e/.browsers/chromium/linux-1036826/chrome-linux/chrome');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

if (!existsSync(join(DIST, 'index.html'))) throw new Error('Run `npm run build` first');
if (!existsSync(CHROME)) throw new Error('Chromium 106 not found; see docs/runbooks/deploy.md');

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(DIST, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const version = await browser.version();
const failures = [];
const AT = '2026-10-24T18:42:00Z'; // 12:42 PM MDT

const cases = [
  { name: 'home', screen: 'home', at: AT, check: ['.rail', '#home'] },
  { name: 'night', screen: 'night', at: '2026-10-25T05:10:00Z', check: ['.night-clock'] },
  { name: 'morning-scheduled', screen: '', at: '2026-10-24T12:30:00Z', expectBody: 'screen-home' },
  { name: 'night-scheduled', screen: '', at: '2026-10-25T05:10:00Z', expectBody: 'screen-night' },
  { name: 'home-rail', screen: '', extra: '&peek=1', at: AT, expectBody: 'rail-on', check: ['.nav-rail', '#home'], rail: 4, hits: true },
  { name: 'calendar-agenda', screen: 'calendar', at: AT, check: ['.nav-rail', '.toolbar', '.ag-row'], rail: 4, hits: true },
  { name: 'weather', screen: 'weather', at: AT, check: ['.nav-rail', '.wx-now', '.wx-hour', '.wx-day'], rail: 4, hits: true, count: { '.wx-hour': 24, '.wx-day': 10 } },
  { name: 'settings', screen: 'settings', at: AT, check: ['.nav-rail', '.set-row'], rail: 4, hits: true, count: { '.set-row': 5 } },
  { name: 'rail-all', screen: 'settings', extra: '&rail=all', at: AT, check: ['.nav-rail'], rail: 8, hits: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(c) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const q = '?mock=1&at=' + encodeURIComponent(c.at) + (c.screen ? '&screen=' + c.screen : '') + (c.extra || '');
  await page.goto(base + '/' + q, { waitUntil: 'networkidle0' });
  await sleep(900); // first crossfade, first screen fetch
  page.errors = errors;
  return page;
}

/**
 * Touch-target audit (PLAN-v2.md §13 P1): every visible [data-go], button and .tap-row is at least
 * 64×64 with 8 px between neighbours, and nothing tappable sits in the kiosk's Menu zone.
 * While a sheet is open only the sheet and the rail count (the rest is behind the overlay).
 */
async function auditHits(page, name) {
  const r = await page.evaluate(() => {
    const sheetOpen = document.querySelector('#sheet.open');
    const els = Array.prototype.filter.call(document.querySelectorAll('[data-go], button, .tap-row'), (el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
      if (b.right <= 0 || b.left >= 1280 || b.bottom <= 0 || b.top >= 800) return false;
      // Only what is inside its scroll container's visible area counts.
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(ps.overflowY + ps.overflowX)) {
          const pb = p.getBoundingClientRect();
          if (b.bottom <= pb.top || b.top >= pb.bottom || b.right <= pb.left || b.left >= pb.right) return false;
        }
      }
      if (sheetOpen && !el.closest('#sheet') && !el.closest('#nav-rail')) return false;
      return true;
    });
    const label = (el) => (el.getAttribute('data-go') || el.getAttribute('data-rail') || el.getAttribute('data-act') || el.className) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"';
    const out = [];
    const boxes = els.map((el) => ({ el, b: el.getBoundingClientRect() }));
    for (const { el, b } of boxes) {
      if (b.width < 63.5 || b.height < 63.5) out.push('small ' + label(el) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
      if (b.left < 96 && b.bottom > 728) out.push('in Menu zone ' + label(el));
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const c = boxes[j];
        if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
        const dx = Math.max(0, Math.max(a.b.left, c.b.left) - Math.min(a.b.right, c.b.right));
        const dy = Math.max(0, Math.max(a.b.top, c.b.top) - Math.min(a.b.bottom, c.b.bottom));
        if (Math.max(dx, dy) < 7.5) out.push('gap ' + Math.round(Math.max(dx, dy)) + ' px: ' + label(a.el) + ' / ' + label(c.el));
      }
    }
    return { n: els.length, out };
  });
  for (const f of r.out) failures.push(name + ': ' + f);
  return r.n;
}

async function auditRail(page, name, want) {
  const r = await page.evaluate(() => {
    const items = Array.prototype.map.call(document.querySelectorAll('.rail-item'), (el) => {
      const b = el.getBoundingClientRect();
      const l = el.querySelector('.rail-label');
      return { v: el.getAttribute('data-rail'), x: b.left, w: b.width, bottom: b.bottom, over: l.scrollWidth > l.clientWidth + 0.5 || l.getBoundingClientRect().right > 96.5 };
    });
    return items;
  });
  if (r.length !== want) failures.push(name + ': rail has ' + r.length + ' items, wanted ' + want);
  for (const it of r) {
    if (it.over) failures.push(name + ': rail label overflows for ' + it.v);
    if (it.bottom > 728.5) failures.push(name + ': rail item ' + it.v + ' reaches the Menu zone');
  }
  if (r.length && r[r.length - 1].v !== 'settings') failures.push(name + ': Settings is not last');
}

async function tapSel(page, sel) {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sel);
  if (!box) {
    failures.push('tap: ' + sel + ' not found');
    return;
  }
  await page.touchscreen.tap(box.x, box.y);
  await sleep(550); // past the 400 ms debounce, and the mock reply
}

const bodyOf = (page) => page.evaluate(() => document.body.className);
const textOf = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const countOf = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

function expectBody(name, body, want, not) {
  const cls = body.split(/\s+/);
  if (!cls.includes(want)) failures.push(name + ': body ' + body + ', wanted ' + want);
  if (not && cls.includes(not)) failures.push(name + ': body ' + body + ' should not have ' + not);
}

for (const c of cases) {
  const page = await open(c);
  const info = await page.evaluate((sels) => {
    const vis = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { x: r.x, y: r.y, w: r.width, h: r.height, display: s.display, visibility: s.visibility };
    };
    return {
      body: document.body.className,
      boxes: sels.map((s) => ({ sel: s, box: vis(document.querySelector(s)) })),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      overflowY: document.documentElement.scrollHeight > window.innerHeight,
    };
  }, c.check || []);
  await page.screenshot({ path: join(OUT, c.name + '.png') });
  expectBody(c.name, info.body, c.expectBody || 'screen-' + c.screen);
  for (const b of info.boxes) {
    if (!b.box || b.box.display === 'none' || b.box.w === 0) failures.push(c.name + ': ' + b.sel + ' not visible');
    else if (b.box.x < 0 || b.box.y < 0 || b.box.x + b.box.w > 1280.5 || b.box.y + b.box.h > 800.5) failures.push(c.name + ': ' + b.sel + ' outside the screen');
  }
  for (const sel of Object.keys(c.count || {})) {
    const n = await countOf(page, sel);
    if (n !== c.count[sel]) failures.push(c.name + ': ' + n + ' × ' + sel + ', wanted ' + c.count[sel]);
  }
  if (c.rail) await auditRail(page, c.name, c.rail);
  const hits = c.hits ? await auditHits(page, c.name) : 0;
  if (info.overflowX || info.overflowY) failures.push(c.name + ': page scrolls');
  if (page.errors.length) failures.push(c.name + ': JS errors: ' + page.errors.join(' | '));
  console.log(c.name.padEnd(18), info.body + (hits ? ' (' + hits + ' targets)' : ''));
  await page.close();
}

// Night: any tap wakes to Home with the rail peeking, never a widget (even on the weather widget).
{
  const page = await open({ at: '2026-10-25T05:10:00Z' });
  const before = await bodyOf(page);
  await page.touchscreen.tap(1000, 260);
  await sleep(550);
  const first = await bodyOf(page);
  await page.touchscreen.tap(400, 400);
  await sleep(550);
  const second = await bodyOf(page);
  expectBody('night tap before', before, 'screen-night');
  expectBody('night tap', first, 'screen-home');
  expectBody('night tap', first, 'rail-on');
  expectBody('second tap', second, 'screen-home');
  console.log('night taps'.padEnd(18), before, '→', first, '→', second);
  if (page.errors.length) failures.push('night taps: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Home: widgets open their screens; the reflection widget (not built yet) and the photo peek the rail.
{
  const page = await open({ at: AT });
  expectBody('home start', await bodyOf(page), 'screen-home', 'rail-on');
  await tapSel(page, '[data-go="weather"]');
  expectBody('weather widget', await bodyOf(page), 'screen-weather');
  await tapSel(page, '[data-rail="home"]');
  expectBody('rail home', await bodyOf(page), 'screen-home');
  await tapSel(page, '[data-go="calendar"]');
  expectBody('agenda widget', await bodyOf(page), 'screen-calendar');
  await tapSel(page, '[data-rail="home"]');
  await sleep(31000); // let the rail peek from the Home tap run out
  expectBody('peek ends', await bodyOf(page), 'screen-home', 'rail-on');
  await tapSel(page, '[data-go="reflection"]');
  expectBody('reflection widget', await bodyOf(page), 'screen-home');
  expectBody('reflection widget', await bodyOf(page), 'rail-on');
  await page.touchscreen.tap(400, 300);
  await sleep(550);
  expectBody('photo tap', await bodyOf(page), 'rail-on');
  await tapSel(page, '[data-rail="settings"]');
  expectBody('rail settings', await bodyOf(page), 'screen-settings');
  console.log('home taps'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('home taps: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Calendar: Day and Week views, screenshots and target audit.
{
  const page = await open({ screen: 'calendar', at: AT });
  await tapSel(page, '[data-act="cal-view"][data-v="day"]');
  await page.screenshot({ path: join(OUT, 'calendar-day.png') });
  if ((await countOf(page, '.day-grid .blk')) < 4) failures.push('calendar day: too few blocks');
  if ((await countOf(page, '.blk-more')) < 1) failures.push('calendar day: no "+n" for the 4-way overlap');
  await auditHits(page, 'calendar-day');
  await tapSel(page, '[data-act="cal-view"][data-v="week"]');
  await page.screenshot({ path: join(OUT, 'calendar-week.png') });
  if ((await countOf(page, '.wk-col')) !== 7) failures.push('calendar week: not 7 columns');
  if ((await countOf(page, '.wk-col .blk')) < 25) failures.push('calendar week: too few blocks');
  await auditHits(page, 'calendar-week');
  await tapSel(page, '[data-act="cal-prev"]');
  await tapSel(page, '[data-act="cal-prev"]');
  const note = await textOf(page, '.cal-note');
  if (!/aren't loaded/.test(note)) failures.push('calendar week: earlier weeks should say they are not loaded, got "' + note + '"');
  await page.screenshot({ path: join(OUT, 'calendar-week-earlier.png') });
  await tapSel(page, '[data-act="cal-cals"]');
  await page.screenshot({ path: join(OUT, 'sheet-calendars.png') });
  if ((await countOf(page, '.cal-pick')) !== 3) failures.push('calendars sheet: expected 3 calendars');
  await auditHits(page, 'sheet-calendars');
  await tapSel(page, '.cal-pick:nth-child(3)');
  await tapSel(page, '[data-act="sheet-done"]');
  if (await page.evaluate(() => !!document.querySelector('#sheet.open'))) failures.push('calendars sheet: Done did not close');
  console.log('calendar views'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('calendar views: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Settings: each sheet opens, steppers respect bounds, Done saves, the row shows the new value.
{
  const page = await open({ screen: 'settings', at: AT });
  await tapSel(page, '[data-act="set-schedule"]');
  await page.screenshot({ path: join(OUT, 'sheet-schedule.png') });
  await auditHits(page, 'sheet-schedule');
  await tapSel(page, '.stepper:nth-child(2) [data-dir="-1"]');
  await tapSel(page, '[data-act="sheet-done"]');
  const sched = await textOf(page, '[data-act="set-schedule"] .set-value');
  if (sched !== '6:00 AM – 9:45 PM') failures.push('schedule: row says "' + sched + '"');

  await tapSel(page, '[data-act="set-night"]');
  for (let i = 0; i < 6; i++) await tapSel(page, '[data-dir="1"]');
  await page.screenshot({ path: join(OUT, 'sheet-night.png') });
  const dim = await textOf(page, '.step-val');
  if (dim !== '60%') failures.push('night dim: stepper should stop at 60%, shows ' + dim);
  await tapSel(page, '[data-act="sheet-cancel"]');
  const dimRow = await textOf(page, '[data-act="set-night"] .set-value');
  if (dimRow !== '35%') failures.push('night dim: Cancel should keep 35%, row says ' + dimRow);

  await tapSel(page, '[data-act="set-idle"]');
  await tapSel(page, '[data-dir="-1"]');
  await tapSel(page, '[data-act="sheet-done"]');
  const idle = await textOf(page, '[data-act="set-idle"] .set-value');
  if (idle !== '5 min') failures.push('idle: row says ' + idle);

  await tapSel(page, '[data-act="set-weather"]');
  await page.type('.wx-input', 'Boul');
  await tapSel(page, '[data-act="wx-search"]');
  await page.screenshot({ path: join(OUT, 'sheet-weather.png') });
  await auditHits(page, 'sheet-weather');
  await tapSel(page, '.place-row');
  await tapSel(page, '[data-act="sheet-done"]');
  const place = await textOf(page, '[data-act="set-weather"] .set-value');
  if (place !== 'Boulder') failures.push('weather location: row says ' + place);
  await page.screenshot({ path: join(OUT, 'settings-after.png') });
  console.log('settings sheets'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('settings: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Idle: a screen falls back to the schedule (Home by day) after the idle timeout (?idle=0.05 → 3 s).
{
  const page = await open({ screen: 'calendar', at: AT, extra: '&idle=0.05' });
  await sleep(4500);
  expectBody('idle', await bodyOf(page), 'screen-home', 'rail-on');
  console.log('idle'.padEnd(18), 'ok');
  await page.close();
}

await browser.close();
server.close();
console.log('browser:', version);
if (failures.length) {
  console.error('FAIL\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('✓ e2e passed; screenshots in test/e2e/out/');
