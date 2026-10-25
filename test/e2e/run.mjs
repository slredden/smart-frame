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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wav': 'audio/wav' };

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
  { name: 'home-rail', screen: '', extra: '&peek=1', at: AT, expectBody: 'rail-on', check: ['.nav-rail', '#home'], rail: 8, hits: true },
  { name: 'calendar-agenda', screen: 'calendar', at: AT, check: ['.nav-rail', '.toolbar', '.ag-row'], rail: 8, hits: true },
  { name: 'weather', screen: 'weather', at: AT, check: ['.nav-rail', '.wx-now', '.wx-hour', '.wx-day'], rail: 8, hits: true, count: { '.wx-hour': 24, '.wx-day': 10 } },
  { name: 'settings', screen: 'settings', at: AT, check: ['.nav-rail', '.set-row'], rail: 8, hits: true, count: { '.set-row': 9 } },
  { name: 'rail-all', screen: 'settings', extra: '&rail=all', at: AT, check: ['.nav-rail'], rail: 8, hits: true },
  // P1b screens
  { name: 'tasks', screen: 'tasks', at: AT, check: ['.nav-rail', '.task-tabs', '.task-row', '.task-check'], rail: 8, hits: true, count: { '.task-tab': 3, '.task-sec': 4, '.task-row.sub': 1 } },
  { name: 'tasks-noscope', screen: 'tasks', extra: '&tasks=noscope', at: AT, check: ['.tasks-empty'], rail: 8, hits: true, count: { '.task-row': 0 } },
  { name: 'reflection', screen: 'reflection', at: AT, check: ['.refl-big-theme', '.refl-full-practice', '.refl-week'], rail: 8, hits: true, count: { '.refl-week': 5, '.refl-week.future': 2, '.refl-guide-btn': 2 } },
  { name: 'photos', screen: 'photos', at: AT, check: ['.stage', '.ph-bar'], rail: 8, hits: true, count: { '.ph-btn': 6 } },
  // Alerts: 08:52 MDT is 8 min before the 9:00 Example meeting; 09:02 adds the 9:00 tasks alert.
  { name: 'banner-home', screen: 'home', at: '2026-10-24T14:52:00Z', check: ['.alerts.open', '.alert'], hits: true, count: { '.alert': 1 } },
  { name: 'banner-two', screen: 'calendar', at: '2026-10-24T15:02:00Z', check: ['.alerts.open'], hits: true, count: { '.alert': 2, '.alert-chip.tasks': 1 } },
  { name: 'banner-photos', screen: 'photos', at: '2026-10-24T14:52:00Z', check: ['.alerts.open'], hits: true, count: { '.alert': 1 } },
  // P2 Controls: mock Spotify and cameras; indoor cameras are off by default (§11.7).
  { name: 'controls', screen: 'controls', at: AT, check: ['.nav-rail', '.sp-card', '.cam-grid', '.sp-dev'], rail: 8, hits: true, count: { '.cam-tile': 4, '.cam-tile.has-img': 2, '.cam-tile.off': 2, '.cam-tile.stale': 1, '.sp-dev': 3, '.sp-dev.on': 1 } },
  { name: 'controls-off', screen: 'controls', extra: '&spotify=off&cams=off', at: AT, check: ['.sp-card.off', '.cam-msg'], rail: 8, hits: true, count: { '.cam-tile': 0, '.sp-dev': 0, '.sp-btn': 0 } },
  { name: 'controls-offline', screen: 'controls', extra: '&cams=offline&spotify=idle', at: AT, check: ['.sp-card', '.cam-msg'], rail: 8, hits: true, count: { '.cam-tile.has-img': 0, '.sp-dev': 1 } },
  { name: 'banner-night', screen: 'night', at: '2026-10-25T05:10:00Z', count: { '.alert': 0 } },
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
  // Record chime plays; ?audio=blocked makes play() reject like a kiosk without autoplay.
  await page.evaluateOnNewDocument((blocked) => {
    window.__plays = [];
    window.__blockAudio = blocked;
    HTMLMediaElement.prototype.play = function () {
      window.__plays.push({ muted: this.muted, volume: this.volume, blocked: window.__blockAudio });
      return window.__blockAudio ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
    };
  }, !!c.blockAudio);
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
      // Covered by a banner or toast: not tappable here.
      const top = document.elementFromPoint(Math.min(1279, Math.max(0, (b.left + b.right) / 2)), Math.min(799, Math.max(0, (b.top + b.bottom) / 2)));
      if (top && !el.contains(top) && !top.contains(el)) return false;
      return true;
    });
    const label = (el) => (el.getAttribute('data-go') || el.getAttribute('data-rail') || el.getAttribute('data-act') || el.className) + ' "' + (el.textContent || '').trim().slice(0, 18) + '"';
    const out = [];
    const boxes = els.map((el) => ({ el, b: el.getBoundingClientRect() }));
    for (const { el, b } of boxes) {
      if (b.width < 63.5 || b.height < 63.5) out.push('small ' + label(el) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
      // The kiosk Menu zone (bottom-left 96×72) must not reach any control: sample the overlap.
      if (b.left < 96 && b.bottom > 728) {
        let reach = false;
        for (let x = Math.max(0, b.left) + 2; x < Math.min(96, b.right) && !reach; x += 8) {
          for (let y = Math.max(728, b.top) + 2; y < Math.min(800, b.bottom) && !reach; y += 8) {
            const at = document.elementFromPoint(x, y);
            if (at && el.contains(at)) reach = true;
          }
        }
        if (reach) out.push('in Menu zone ' + label(el));
      }
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
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width };
  }, sel);
  if (!box || !box.w) {
    failures.push('tap: ' + sel + (box ? ' is hidden' : ' not found'));
    return;
  }
  await page.touchscreen.tap(box.x, box.y);
  await sleep(550); // past the 400 ms debounce, and the mock reply
}

const bodyOf = (page) => page.evaluate(() => document.body.className);

/**
 * Empty space on every screen with the rail hidden: the left edge, mid-height (clear of the Menu zone).
 * On Home that's the photo; elsewhere it's the transparent 32 px bring-back zone (#rail-edge).
 */
const EMPTY = { x: 16, y: 400 };
const EDGE_W = 32;

/** Rail hidden on a non-Home screen: the view is full width and no control sits under the edge zone. */
async function auditFullWidth(page, scr, railOn) {
  const r = await page.evaluate((s, w) => {
    const v = document.getElementById('view-' + s).getBoundingClientRect();
    const st = document.getElementById('stage').getBoundingClientRect();
    const edge = document.getElementById('rail-edge');
    const edgeShown = getComputedStyle(edge).display !== 'none';
    const eb = edge.getBoundingClientRect();
    const under = Array.prototype.filter
      .call(document.querySelectorAll('[data-act], [data-go], button, a[href], input, select, textarea, label, .tap-row'), (el) => {
        if (el.closest('#nav-rail')) return false;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') return false;
        return b.left < w && b.right > 0 && b.top < 728 && b.bottom > 0;
      })
      .map((el) => (el.getAttribute('data-act') || el.className) + ' @' + Math.round(el.getBoundingClientRect().left));
    const cornerShown = getComputedStyle(document.getElementById('rail-corner')).display !== 'none';
    return { left: v.left, width: v.width, stLeft: st.left, stWidth: st.width, edgeShown, ew: eb.width, eh: eb.bottom, under, cornerShown };
  }, scr, EDGE_W);
  const tag = 'rail ' + scr + (railOn ? ' shown' : ' hidden');
  const [wantL, wantW] = railOn ? [96, 1184] : [0, 1280];
  if (r.left !== wantL || r.width !== wantW) failures.push(tag + ': view at x=' + r.left + ' w=' + r.width + ', wanted x=' + wantL + ' w=' + wantW);
  if (scr === 'photos' && (r.stLeft !== wantL || r.stWidth !== wantW)) failures.push(tag + ': photo stage at x=' + r.stLeft + ' w=' + r.stWidth);
  if (r.edgeShown === railOn) failures.push(tag + ': edge zone ' + (r.edgeShown ? 'shown' : 'missing'));
  if (!railOn && (r.ew !== EDGE_W || r.eh > 728)) failures.push(tag + ': edge zone is ' + r.ew + ' wide, ends at ' + r.eh);
  if (r.cornerShown !== (!railOn && scr !== 'photos')) failures.push(tag + ': Menu corner guard ' + (r.cornerShown ? 'shown' : 'missing'));
  if (!railOn && r.under.length) failures.push(tag + ': controls under the edge zone: ' + r.under.join(', '));
}

/** A rail item, after an empty-space tap to show the rail if it has hidden (10 s after the last touch). */
async function railTap(page, view) {
  if (!(await bodyOf(page)).split(/\s+/).includes('rail-on')) {
    await page.touchscreen.tap(EMPTY.x, EMPTY.y);
    await sleep(550);
  }
  await tapSel(page, '[data-rail="' + view + '"]');
}
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
  await railTap(page, 'home');
  expectBody('rail home', await bodyOf(page), 'screen-home');
  await tapSel(page, '[data-go="calendar"]');
  expectBody('agenda widget', await bodyOf(page), 'screen-calendar');
  await railTap(page, 'home');
  await sleep(10500); // let the rail from the rail tap run out (10 s)
  expectBody('peek ends', await bodyOf(page), 'screen-home', 'rail-on');
  await page.touchscreen.tap(400, 300);
  await sleep(550);
  expectBody('photo tap', await bodyOf(page), 'rail-on');
  await railTap(page, 'home');
  await tapSel(page, '[data-go="reflection"]');
  expectBody('reflection widget', await bodyOf(page), 'screen-reflection');
  await railTap(page, 'home');
  const dueLine = await textOf(page, '[data-bind="tasksLine"]');
  if (!/^Due today: /.test(dueLine)) failures.push('home: tasks line says "' + dueLine + '"');
  await page.touchscreen.tap(400, 300);
  await sleep(550);
  expectBody('photo tap', await bodyOf(page), 'rail-on');
  await railTap(page, 'settings');
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
  if ((await countOf(page, '.cal-bell')) !== 3) failures.push('calendars sheet: expected 3 alert toggles');
  await auditHits(page, 'sheet-calendars');
  await tapSel(page, '.cal-pick-row:nth-child(3) .cal-pick');
  await tapSel(page, '.cal-pick-row:nth-child(2) .cal-bell');
  if (!/off/.test(await textOf(page, '.cal-pick-row:nth-child(2) .cal-bell'))) failures.push('calendars sheet: bell did not toggle');
  await page.screenshot({ path: join(OUT, 'sheet-calendars-bell.png') });
  await tapSel(page, '[data-act="sheet-done"]');
  const sel = await page.evaluate(() => window.__sfMock.calls.filter((x) => x.m === 'saveSelection').pop());
  if (!sel || sel.alertsOff.length !== 1) failures.push('calendars sheet: alertsOff not saved: ' + JSON.stringify(sel));
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

const callsOf = (page, m) => page.evaluate((k) => window.__sfMock.calls.filter((x) => x.m === k), m);
const plays = (page) => page.evaluate(() => window.__plays.slice());

// Tasks: tabs filter, check-off strikes at once, Undo sends nothing, the 10 s toast end sends one write.
{
  const page = await open({ screen: 'tasks', at: AT });
  const all = await countOf(page, '.task-row');
  await tapSel(page, '.task-tab:nth-child(3)');
  const second = await countOf(page, '.task-row');
  if (!(second > 0 && second < all)) failures.push('tasks tab: ' + second + ' rows of ' + all);
  await tapSel(page, '.task-tab:nth-child(1)');
  await tapSel(page, '.task-row .task-check');
  if ((await countOf(page, '.task-row.done')) !== 1) failures.push('tasks: check did not strike the row');
  if (!(await page.evaluate(() => !!document.querySelector('#toast.open .toast-btn')))) failures.push('tasks: no Undo toast');
  await page.screenshot({ path: join(OUT, 'tasks-undo-toast.png') });
  await auditHits(page, 'tasks-undo-toast');
  await tapSel(page, '#toast .toast-btn');
  if ((await countOf(page, '.task-row.done')) !== 0) failures.push('tasks: Undo did not restore the row');
  await sleep(1000);
  if ((await callsOf(page, 'completeTask')).length) failures.push('tasks: Undo still sent a write');
  await tapSel(page, '.task-row .task-check');
  await sleep(10600);
  const done = await callsOf(page, 'completeTask');
  if (done.length !== 1) failures.push('tasks: expected 1 completeTask after the toast, got ' + done.length);
  if ((await countOf(page, '.task-row')) !== all - 1) failures.push('tasks: completed row still listed');
  await tapSel(page, '[data-act="task-lists"]');
  await page.screenshot({ path: join(OUT, 'sheet-tasklists.png') });
  if ((await countOf(page, '#sheet .cal-pick')) !== 3) failures.push('task lists sheet: expected 3 lists');
  await auditHits(page, 'sheet-tasklists');
  await tapSel(page, '#sheet .cal-pick:nth-child(3)');
  await tapSel(page, '[data-act="sheet-done"]');
  const saved = await callsOf(page, 'saveTaskLists');
  if (saved.length !== 1 || saved[0].ids.length !== 3) failures.push('task lists: save ' + JSON.stringify(saved));
  console.log('tasks flow'.padEnd(18), all + ' rows ok');
  if (page.errors.length) failures.push('tasks flow: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Photos: toolbar shows on open and hides after 5 s; a blank tap brings it back; next, pause, favorite, hide + undo.
{
  const page = await open({ screen: 'photos', at: AT });
  const first = await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll('#stage .layer img'), (i) => !!i.getAttribute('src')));
  await tapSel(page, '[data-act="ph-next"]');
  await sleep(800);
  await tapSel(page, '[data-act="ph-pause"]');
  if ((await textOf(page, '[data-act="ph-pause"]')) !== 'Play') failures.push('photos: Pause did not switch to Play');
  if (!/Paused/.test(await textOf(page, '.ph-note'))) failures.push('photos: no Paused note');
  await tapSel(page, '[data-act="ph-fav"]');
  const favs = await callsOf(page, 'photoFlag');
  if (favs.length !== 1 || !('favorite' in favs[0].patch)) failures.push('photos: favorite not saved ' + JSON.stringify(favs));
  await page.screenshot({ path: join(OUT, 'photos-toolbar.png') });
  await tapSel(page, '[data-act="ph-hide"]');
  await page.screenshot({ path: join(OUT, 'photos-hide-toast.png') });
  await auditHits(page, 'photos-hide-toast');
  await tapSel(page, '#toast .toast-btn');
  await sleep(5500);
  if ((await callsOf(page, 'photoFlag')).length !== 1) failures.push('photos: Undo still sent the hide');
  if (await page.evaluate(() => document.querySelector('#view-photos').classList.contains('bar-on'))) failures.push('photos: toolbar did not hide after 5 s');
  await page.touchscreen.tap(700, 400);
  await sleep(550);
  if (!(await page.evaluate(() => document.querySelector('#view-photos').classList.contains('bar-on')))) failures.push('photos: blank tap did not show the toolbar');
  await tapSel(page, '[data-act="ph-options"]');
  await page.screenshot({ path: join(OUT, 'sheet-photo-options.png') });
  await auditHits(page, 'sheet-photo-options');
  await tapSel(page, '[data-f="fit"][data-v="fill"]');
  await tapSel(page, '[data-act="sheet-done"]');
  if (!(await page.evaluate(() => document.getElementById('stage').classList.contains('fill')))) failures.push('photos: Fill not applied');
  console.log('photos flow'.padEnd(18), first ? 'ok' : 'no photo');
  if (page.errors.length) failures.push('photos flow: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Reflection: a past week opens its practice; a guide opens its weeks.
{
  const page = await open({ screen: 'reflection', at: AT });
  await tapSel(page, '.refl-week:not(.future):not(.current)');
  if (!(await page.evaluate(() => !!document.querySelector('#sheet.open .refl-full-practice')))) failures.push('reflection: past week did not open');
  await page.screenshot({ path: join(OUT, 'reflection-week.png') });
  await tapSel(page, '[data-act="sheet-done"]');
  await tapSel(page, '.refl-guide-btn');
  if ((await countOf(page, '#sheet.open .refl-week')) !== 5) failures.push('reflection: guide sheet should list 5 weeks');
  await page.screenshot({ path: join(OUT, 'reflection-guide.png') });
  await auditHits(page, 'reflection-guide');
  console.log('reflection flow'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('reflection flow: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Rail auto-hide: on every screen the rail hides 10 s after the last touch and an empty-space tap
// brings it back; controls (task checkboxes) work without toggling it but restart a showing rail.
{
  const all = ['calendar', 'tasks', 'weather', 'photos', 'reflection', 'controls', 'settings'];
  const pages = [];
  for (const scr of all) {
    const page = await open({ screen: scr, at: AT });
    expectBody('rail ' + scr + ' start', await bodyOf(page), 'rail-on');
    pages.push([scr, page]);
  }
  const home = await open({ at: AT });
  await home.touchscreen.tap(EMPTY.x, EMPTY.y);
  await sleep(550);
  expectBody('rail home empty tap', await bodyOf(home), 'rail-on');
  pages.push(['home', home]);
  await sleep(10600);
  for (const [scr, page] of pages) {
    expectBody('rail ' + scr + ' hides after 10 s', await bodyOf(page), 'screen-' + scr, 'rail-on');
    if (scr !== 'home') await auditFullWidth(page, scr, false);
    if (scr !== 'home') await auditHits(page, 'rail ' + scr + ' hidden');
    if (scr === 'tasks' || scr === 'calendar' || scr === 'photos' || scr === 'controls') await page.screenshot({ path: join(OUT, 'rail-hidden-' + scr + '.png') });
    const hit = await page.evaluate((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      if (!el) return 'nothing';
      if (el.closest('[data-act], [data-go], [data-rail], button, a[href], input, select, label, .tap-row')) return 'control ' + el.className;
      return el.id === 'rail-edge' ? 'edge' : 'empty ' + el.className;
    }, EMPTY);
    const wantHit = scr === 'home' ? 'empty' : 'edge';
    if (!hit.startsWith(wantHit)) failures.push('rail ' + scr + ': the left-edge spot is ' + hit + ', wanted ' + wantHit);
    await page.touchscreen.tap(EMPTY.x, EMPTY.y);
    await sleep(550);
    expectBody('rail ' + scr + ' empty tap', await bodyOf(page), 'rail-on');
    expectBody('rail ' + scr + ' empty tap keeps screen', await bodyOf(page), 'screen-' + scr);
    if (scr !== 'home') await auditFullWidth(page, scr, true);
    if (scr === 'tasks' || scr === 'calendar' || scr === 'photos' || scr === 'controls') await page.screenshot({ path: join(OUT, 'rail-shown-' + scr + '.png') });
    if (scr !== 'tasks' && scr !== 'settings') await page.close();
  }
  // Tasks: a checkbox tap while the rail is hidden keeps it hidden and still checks the task.
  const page = pages.find((p) => p[0] === 'tasks')[1];
  await sleep(10600);
  expectBody('tasks rail hidden', await bodyOf(page), 'screen-tasks', 'rail-on');
  await tapSel(page, '.task-row .task-check');
  expectBody('checkbox with rail hidden', await bodyOf(page), 'screen-tasks', 'rail-on');
  if ((await countOf(page, '.task-check.on')) < 1) failures.push('rail: checkbox did not check while the rail was hidden');
  await tapSel(page, '#toast .toast-btn'); // undo, so nothing is sent
  expectBody('undo with rail hidden', await bodyOf(page), 'screen-tasks', 'rail-on');
  // Rail shown: a checkbox tap at ~7 s restarts the 10 s, so the rail is still up at 12 s.
  await page.touchscreen.tap(EMPTY.x, EMPTY.y);
  await sleep(550);
  expectBody('tasks rail shown', await bodyOf(page), 'rail-on');
  await sleep(6500);
  await tapSel(page, '.task-row .task-check');
  expectBody('checkbox with rail shown', await bodyOf(page), 'rail-on');
  await tapSel(page, '#toast .toast-btn');
  await sleep(3500); // ~11.6 s after the empty tap, ~4.5 s after the checkbox
  expectBody('checkbox restarted the rail timer', await bodyOf(page), 'rail-on');
  await sleep(6500);
  expectBody('rail hides 10 s after the last control tap', await bodyOf(page), 'screen-tasks', 'rail-on');
  // Settings with the rail hidden (idle since its reveal): a row opens its sheet, Cancel closes it,
  // and neither shows the rail; the view stays full width.
  const set = pages.find((p) => p[0] === 'settings')[1];
  expectBody('settings rail hidden', await bodyOf(set), 'screen-settings', 'rail-on');
  await tapSel(set, '[data-act="set-idle"]');
  if (!(await countOf(set, '#sheet.open'))) failures.push('rail: Settings row did not open its sheet with the rail hidden');
  expectBody('settings row with rail hidden', await bodyOf(set), 'screen-settings', 'rail-on');
  await tapSel(set, '[data-act="sheet-cancel"]');
  expectBody('settings cancel with rail hidden', await bodyOf(set), 'screen-settings', 'rail-on');
  await auditFullWidth(set, 'settings', false);
  await set.close();
  console.log('rail auto-hide'.padEnd(18), 'ok (' + pages.length + ' screens)');
  for (const [, p] of pages) if (p.errors && p.errors.length) failures.push('rail auto-hide: JS errors: ' + p.errors.join(' | '));
  await page.close();
}

// Alerts: the banner chimes once, Dismiss keeps it gone, Open goes to Calendar; Settings › Alerts test chime.
{
  const page = await open({ screen: 'home', at: '2026-10-24T14:52:00Z' });
  const p1 = await plays(page);
  if (p1.filter((x) => !x.muted).length !== 1) failures.push('alerts: expected one chime, got ' + JSON.stringify(p1));
  if (p1[0] && Math.abs(p1[0].volume - 0.6) > 0.01) failures.push('alerts: chime volume ' + p1[0].volume);
  await sleep(2500);
  if ((await plays(page)).length !== 1) failures.push('alerts: chimed again');
  await tapSel(page, '[data-act="alert-dismiss"]');
  if ((await countOf(page, '.alert')) !== 0) failures.push('alerts: Dismiss did not hide the banner');
  expectBody('dismiss', await bodyOf(page), 'screen-home', 'rail-on');
  await page.close();
}
{
  // No ?screen= here: a forced screen pins Home, and Open has to navigate.
  const page = await open({ at: '2026-10-24T14:52:00Z' });
  expectBody('alert open start', await bodyOf(page), 'screen-home');
  await tapSel(page, '[data-act="alert-open"]');
  expectBody('alert open', await bodyOf(page), 'screen-calendar');
  if ((await countOf(page, '.alert')) !== 0) failures.push('alerts: Open did not dismiss');
  await page.close();
}
{
  // Blocked autoplay: the chime is kept and plays on the next tap.
  const page = await open({ screen: 'home', at: '2026-10-24T14:52:00Z', blockAudio: true });
  const before = await plays(page);
  await page.evaluate(() => (window.__blockAudio = false));
  await page.touchscreen.tap(400, 300);
  await sleep(550);
  const after = await plays(page);
  if (!(before.length === 1 && before[0].blocked && after.length === 2 && !after[1].muted)) failures.push('alerts: blocked chime not replayed on tap ' + JSON.stringify(after));
  console.log('alerts flow'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('alerts flow: JS errors: ' + page.errors.join(' | '));
  await page.close();
}
{
  const page = await open({ screen: 'settings', at: AT });
  await tapSel(page, '[data-act="set-alerts"]');
  await page.screenshot({ path: join(OUT, 'sheet-alerts.png') });
  await auditHits(page, 'sheet-alerts');
  await tapSel(page, '[data-act="test-chime"]');
  const tp = await plays(page);
  if (tp.length !== 1 || Math.abs(tp[0].volume - 0.6) > 0.01) failures.push('settings: test chime ' + JSON.stringify(tp));
  for (let i = 0; i < 3; i++) await tapSel(page, '[data-f="leadMin"][data-dir="-1"]');
  await tapSel(page, '[data-act="sheet-done"]');
  const row = await textOf(page, '[data-act="set-alerts"] .set-value');
  if (row !== 'Tasks only · chime 60%') failures.push('settings alerts row says "' + row + '"');
  await tapSel(page, '[data-act="set-tasks-home"]');
  if ((await textOf(page, '[data-act="set-tasks-home"] .set-value')) !== 'Off') failures.push('settings: Tasks on Home did not toggle');
  await tapSel(page, '[data-act="set-tasklists"]');
  if ((await countOf(page, '#sheet .cal-pick')) !== 3) failures.push('settings: task lists sheet');
  await tapSel(page, '[data-act="sheet-cancel"]');
  await page.screenshot({ path: join(OUT, 'settings-p1b.png') });
  console.log('alert settings'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('alert settings: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Controls (PLAN-v2.md §11.4-§11.7): status messages, pictures only on a new `updated`, optimistic
// Spotify with a revert toast, enlarge, polling stops on hide, indoor reveal and auto-cover.
{
  const page = await open({ screen: 'controls', at: AT });
  const camCalls = async (id) => (await callsOf(page, 'camImage')).filter((x) => !id || x.id === id);
  const msg = await textOf(page, '.cam-msg');
  if (msg) failures.push('controls: unexpected camera message "' + msg + '"');
  if (!/updated 40 s ago/.test(await textOf(page, '.cam-tile:nth-child(1) .cam-age'))) failures.push('controls: front door age says "' + (await textOf(page, '.cam-tile:nth-child(1) .cam-age')) + '"');
  if (!/Indoor cameras off/.test(await textOf(page, '.cam-tile.off'))) failures.push('controls: indoor tile not "Indoor cameras off"');
  if ((await camCalls()).some((x) => x.id === 'c3' || x.id === 'c4')) failures.push('controls: fetched an indoor picture with the setting off');
  const first = (await camCalls()).length;
  await sleep(5600);
  if ((await callsOf(page, 'controlsState')).length < 2) failures.push('controls: no second poll after 5 s');
  if ((await camCalls()).length !== first) failures.push('controls: re-fetched pictures that had not changed');
  await page.evaluate(() => (window.__sfMock.camAt.c1 = new Date(Date.parse(window.__sfMock.camAt.c1) + 30000).toISOString()));
  await sleep(5600);
  if ((await camCalls('c1')).length !== 2 || (await camCalls('c2')).length !== 1) failures.push('controls: picture fetches ' + JSON.stringify(await camCalls()));
  // Spotify: optimistic pause, failed play reverts with a toast, volume, transfer.
  await tapSel(page, '[data-act="sp-pause"]');
  if (!(await countOf(page, '[data-act="sp-play"]'))) failures.push('controls: Pause did not switch to Play');
  await page.evaluate(() => (window.__sfMock.spotifyFail = 'premium_needed'));
  await tapSel(page, '[data-act="sp-play"]');
  if (!(await countOf(page, '[data-act="sp-play"]'))) failures.push('controls: failed Play did not revert');
  if (!/Premium/.test(await textOf(page, '#toast'))) failures.push('controls: no revert toast, got "' + (await textOf(page, '#toast')) + '"');
  await page.screenshot({ path: join(OUT, 'controls-revert-toast.png') });
  await tapSel(page, '[data-act="sp-vol"][data-dir="1"]');
  if ((await textOf(page, '.sp-vol-val')) !== '50%') failures.push('controls: volume shows ' + (await textOf(page, '.sp-vol-val')));
  await tapSel(page, '.sp-dev:nth-child(2)');
  await sleep(1000);
  if (!/Example office/.test(await textOf(page, '.sp-dev.on'))) failures.push('controls: transfer did not mark the new speaker');
  const sent = (await callsOf(page, 'spotify')).map((x) => x.action).join(',');
  if (sent !== 'pause,play,volume,transfer') failures.push('controls: Spotify writes ' + sent);
  // Enlarge and close.
  await tapSel(page, '.cam-tile[data-id="c1"]');
  if (!(await countOf(page, '.cam-card.big-on'))) failures.push('controls: tile did not enlarge');
  await page.screenshot({ path: join(OUT, 'controls-enlarged.png') });
  await auditHits(page, 'controls-enlarged');
  await tapSel(page, '[data-act="cam-close"]');
  if (await countOf(page, '.cam-card.big-on')) failures.push('controls: enlarged picture did not close');
  // Leaving Controls stops the polls and drops every picture; nothing camera-related on Home.
  await railTap(page, 'home');
  const polls = (await callsOf(page, 'controlsState')).length;
  if (await countOf(page, '.cam-img[src]')) failures.push('controls: pictures kept after leaving');
  await sleep(6000);
  if ((await callsOf(page, 'controlsState')).length !== polls) failures.push('controls: still polling on Home');
  const homeCams = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('img'), (i) => /^blob:/.test(i.src || '') && i.getBoundingClientRect().width > 0).length);
  if (homeCams) failures.push('controls: a camera picture shows on Home');
  // Settings › Indoor cameras: on, 30 s.
  await railTap(page, 'settings');
  await tapSel(page, '[data-act="set-controls"]');
  await page.screenshot({ path: join(OUT, 'sheet-controls.png') });
  await auditHits(page, 'sheet-controls');
  await tapSel(page, '#sheet [data-act="opt"][data-v="true"]');
  for (let i = 0; i < 4; i++) await tapSel(page, '#sheet [data-act="step"][data-dir="-1"]');
  await tapSel(page, '[data-act="sheet-done"]');
  const row = await textOf(page, '[data-act="set-controls"] .set-value');
  if (row !== 'Shown 30 s per tap') failures.push('controls setting: row says "' + row + '"');
  await railTap(page, 'controls');
  await sleep(600);
  if ((await countOf(page, '.cam-tile.covered')) !== 2) failures.push('indoor: expected 2 covered tiles, got ' + (await countOf(page, '.cam-tile.covered')));
  if ((await camCalls('c3')).length) failures.push('indoor: fetched before a tap');
  await tapSel(page, '.cam-tile[data-id="c3"]');
  await sleep(300);
  const rv = await camCalls('c3');
  if (rv.length !== 1 || !rv[0].reveal) failures.push('indoor: reveal fetch ' + JSON.stringify(rv));
  if ((await countOf(page, '.cam-tile.covered')) !== 1 || !(await countOf(page, '.cam-tile[data-id="c3"].has-img'))) failures.push('indoor: tap did not reveal');
  await page.screenshot({ path: join(OUT, 'controls-indoor-revealed.png') });
  await sleep(31000);
  if ((await countOf(page, '.cam-tile.covered')) !== 2 || (await countOf(page, '.cam-tile[data-id="c3"] .cam-img[src]'))) failures.push('indoor: not covered again after 30 s');
  await tapSel(page, '.cam-tile[data-id="c4"]');
  if (!(await countOf(page, '.cam-tile[data-id="c4"].has-img'))) failures.push('indoor: c4 did not reveal');
  await railTap(page, 'home');
  await railTap(page, 'controls');
  await sleep(600);
  if ((await countOf(page, '.cam-tile.covered')) !== 2) failures.push('indoor: leaving Controls did not cover');
  console.log('controls flow'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('controls flow: JS errors: ' + page.errors.join(' | '));
  await page.close();
}
{
  // Spotify idle with the remembered speaker gone: the §11.5 message and the devices that are there.
  const page = await open({ screen: 'controls', at: AT, extra: '&spotify=idle' });
  if (!/Nothing playing/.test(await textOf(page, '.sp-card'))) failures.push('spotify idle: no "Nothing playing"');
  await tapSel(page, '[data-act="sp-play"]');
  const m = await textOf(page, '.sp-msg');
  if (m !== 'Example office not available; say "Alexa, Spotify Connect" or play once from the Spotify app') failures.push('spotify idle: message "' + m + '"');
  await page.screenshot({ path: join(OUT, 'controls-device-absent.png') });
  await tapSel(page, '.sp-dev');
  await sleep(1000);
  if (!/Example speaker/.test(await textOf(page, '.sp-device'))) failures.push('spotify idle: transfer did not play on the listed speaker');
  // Idle return to Home stops Controls (?idle not set here, so leave via the rail).
  console.log('spotify absent'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('spotify absent: JS errors: ' + page.errors.join(' | '));
  await page.close();
}
// P2.1 Recent sheet: 10 tiles with no scrolling at 1280×800, a tap plays that context and closes the
// sheet, the Playlists tab scrolls, outside tap / Close / 30 s idle close it, and nothing in it toggles
// the rail. The 30 s is ?sheetidle=2500 here.
{
  const page = await open({ screen: 'controls', at: AT, extra: '&sheetidle=2500' });
  await sleep(10600); // the rail from opening the screen hides after 10 s
  const railOn = async () => (await bodyOf(page)).split(/\s+/).includes('rail-on');
  if (await railOn()) failures.push('recent: rail still shown before the test');
  await tapSel(page, '[data-act="sp-recent"]');
  await sleep(300);
  if (!(await countOf(page, '#sheet.open .sp-pick-recent'))) failures.push('recent: sheet did not open');
  const n = await countOf(page, '.sp-pick-recent .sp-tile');
  if (n !== 10) failures.push('recent: ' + n + ' tiles, wanted 10');
  const fit = await page.evaluate(() => {
    const list = document.querySelector('.sp-pick-recent');
    const body = document.querySelector('.sheet-body');
    const panel = document.querySelector('.sheet-panel').getBoundingClientRect();
    const lb = list.getBoundingClientRect();
    const tiles = Array.prototype.map.call(document.querySelectorAll('.sp-pick-recent .sp-tile'), (t) => t.getBoundingClientRect());
    const arts = Array.prototype.map.call(document.querySelectorAll('.sp-pick-recent .sp-tile-art'), (a) => Math.round(a.getBoundingClientRect().width));
    const cols = new Set(tiles.map((t) => Math.round(t.left))).size;
    return {
      listScroll: list.scrollHeight - list.clientHeight,
      bodyScroll: body.scrollHeight - body.clientHeight,
      panelTop: panel.top,
      panelBottom: panel.bottom,
      clipped: tiles.filter((t) => t.top < lb.top - 0.5 || t.bottom > lb.bottom + 0.5).length,
      arts: Array.from(new Set(arts)),
      cols,
      types: Array.prototype.map.call(document.querySelectorAll('.sp-pick-recent .sp-tile-type'), (e) => e.textContent).join(','),
    };
  });
  if (fit.listScroll > 0 || fit.bodyScroll > 0 || fit.clipped || fit.panelTop < 0 || fit.panelBottom > 800) failures.push('recent: does not fit at 1280×800 ' + JSON.stringify(fit));
  if (fit.cols !== 2 || fit.arts.join() !== '72') failures.push('recent: grid ' + JSON.stringify(fit));
  if (!/^Playlist,Album,Artist,Album,Playlist/.test(fit.types)) failures.push('recent: type labels ' + fit.types);
  await page.screenshot({ path: join(OUT, 'controls-recent.png') });
  await auditHits(page, 'controls-recent');
  // Playlists tab: 20 rows in the same box, which scrolls.
  await tapSel(page, '[data-act="sp-tab"][data-tab="playlists"]');
  // Audit before scrolling: a scrolled-away row is clipped by the list, not under the tabs.
  await auditHits(page, 'controls-recent-playlists');
  const pl = await page.evaluate(() => {
    const list = document.querySelector('.sp-pick-playlists');
    if (!list) return null;
    list.scrollTop = 300;
    return { n: list.querySelectorAll('.sp-tile').length, over: list.scrollHeight - list.clientHeight, top: list.scrollTop, oy: getComputedStyle(list).overflowY };
  });
  if (!pl || pl.n !== 20 || pl.over <= 0 || pl.top <= 0 || pl.oy !== 'auto') failures.push('recent: playlists tab ' + JSON.stringify(pl));
  await page.screenshot({ path: join(OUT, 'controls-recent-playlists.png') });
  // Touches keep it open past the idle time; then it closes on its own.
  await sleep(1500);
  await tapSel(page, '[data-act="sp-tab"][data-tab="recent"]');
  await sleep(1500);
  if (!(await countOf(page, '#sheet.open'))) failures.push('recent: closed although touched within the idle time');
  await sleep(1500);
  if (await countOf(page, '#sheet.open')) failures.push('recent: did not close after the idle time');
  if (await railOn()) failures.push('recent: a sheet touch showed the rail');
  // A tile plays that context from the start and closes the sheet.
  await tapSel(page, '[data-act="sp-pause"]');
  await tapSel(page, '[data-act="sp-recent"]');
  await sleep(300);
  const uri = await page.evaluate(() => document.querySelector('.sp-pick-recent .sp-tile:nth-child(3)').getAttribute('data-uri'));
  await tapSel(page, '.sp-pick-recent .sp-tile:nth-child(3)');
  const last = (await callsOf(page, 'spotify')).at(-1);
  if (!last || last.action !== 'play' || !last.body || last.body.context_uri !== uri || Object.keys(last.body).length !== 1) failures.push('recent: play request ' + JSON.stringify(last));
  if (await countOf(page, '#sheet.open')) failures.push('recent: tile tap did not close the sheet');
  if (!(await countOf(page, '[data-act="sp-pause"]'))) failures.push('recent: card did not switch to playing');
  if (await railOn()) failures.push('recent: a tile tap showed the rail');
  // Outside tap closes (and doesn't show the rail); so does Close.
  await tapSel(page, '[data-act="sp-recent"]');
  await page.touchscreen.tap(1240, 400);
  await sleep(550);
  if (await countOf(page, '#sheet.open')) failures.push('recent: outside tap did not close');
  if (await railOn()) failures.push('recent: outside tap showed the rail');
  await tapSel(page, '[data-act="sp-recent"]');
  await tapSel(page, '[data-act="sheet-done"]');
  if (await countOf(page, '#sheet.open')) failures.push('recent: Close did not close');
  if (await railOn()) failures.push('recent: Close showed the rail');
  if ((await callsOf(page, 'spotifyRecent')).length < 4) failures.push('recent: fetches ' + (await callsOf(page, 'spotifyRecent')).length);
  console.log('spotify recent'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('spotify recent: JS errors: ' + page.errors.join(' | '));
  await page.close();
}
{
  // A grant without the new scopes: the reconnect message, playback untouched.
  const page = await open({ screen: 'controls', at: AT, extra: '&recent=consent' });
  await tapSel(page, '[data-act="sp-recent"]');
  await sleep(300);
  const m = await textOf(page, '.sp-pick-msg');
  if (m !== 'Reconnect Spotify on /admin to see recent') failures.push('recent consent: message "' + m + '"');
  if (await countOf(page, '.sp-tile')) failures.push('recent consent: shows tiles');
  await page.screenshot({ path: join(OUT, 'controls-recent-consent.png') });
  await tapSel(page, '[data-act="sheet-done"]');
  await tapSel(page, '[data-act="sp-pause"]');
  if (!(await countOf(page, '[data-act="sp-play"]'))) failures.push('recent consent: playback controls broke');
  console.log('recent consent'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('recent consent: JS errors: ' + page.errors.join(' | '));
  await page.close();
}
{
  // Idle return from Controls stops the polls.
  const page = await open({ screen: 'controls', at: AT, extra: '&idle=0.05' });
  await sleep(4500);
  expectBody('controls idle', await bodyOf(page), 'screen-home');
  const n = (await callsOf(page, 'controlsState')).length;
  await sleep(5500);
  if ((await callsOf(page, 'controlsState')).length !== n) failures.push('controls: polling after idle return');
  await page.close();
}

// Photos never idles (2026-10-25): with the same 3 s idle it is still up well past it.
{
  const page = await open({ screen: 'photos', at: AT, extra: '&idle=0.05' });
  await sleep(9000);
  expectBody('photos no idle', await bodyOf(page), 'screen-photos');
  console.log('photos no idle'.padEnd(18), 'ok');
  if (page.errors.length) failures.push('photos no idle: JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Photos at night: the night clock takes over once idle, like any other screen (2026-10-25).
// Up at 21:59:56 MDT: still Photos at the start, the night clock after 22:00 and the 3 s idle.
for (const [name, at] of [['photos 22:00', '2026-10-25T03:59:56Z'], ['photos at night', '2026-10-25T05:10:00Z']]) {
  const page = await open({ screen: 'photos', at, extra: '&idle=0.05' });
  expectBody(name + ' start', await bodyOf(page), 'screen-photos');
  await sleep(6000);
  expectBody(name, await bodyOf(page), 'screen-night');
  console.log(name.padEnd(18), 'ok');
  if (page.errors.length) failures.push(name + ': JS errors: ' + page.errors.join(' | '));
  await page.close();
}

// Idle: a screen falls back to the schedule (Home by day) after the idle timeout (?idle=0.05 → 3 s).
{
  const page = await open({ screen: 'calendar', at: AT, extra: '&idle=0.05' });
  await sleep(4500);
  expectBody('idle', await bodyOf(page), 'screen-home');
  await sleep(6200); // the rail from opening the screen hides 10 s after it
  expectBody('idle rail', await bodyOf(page), 'screen-home', 'rail-on');
  console.log('idle'.padEnd(18), 'ok');
  await page.close();
}

// P1c /admin › Photos: the sets line, and "Restore previous set" with its one-tap confirm, against a
// mocked /admin/api. Arming alone sends nothing; confirming swaps; a second restore flips back.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const A = { setId: 'sAct01', count: 244, rows: 244, date: '2026-10-25T19:32:52.799Z' };
  const B = { setId: 'sUW6jbMa7', count: 50, rows: 50, date: '2026-10-24T23:40:41.473Z' };
  const state = { current: A, previous: B, queued: 4, deletedToday: 0, deletesLeft: 900, storage: { bytes: 307 * 250 * 1024, approx: true } };
  const posts = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/admin/api/')) return r.continue();
    const p = u.pathname.slice('/admin/api/'.length);
    const reply = (o, status = 200) => r.respond({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (r.method() === 'POST') posts.push(p);
    if (p === 'photos' && r.method() === 'GET') return reply({ hidden: 2, sets: state });
    if (p === 'photos/restore-previous' && r.method() === 'POST') {
      const t = state.current;
      state.current = state.previous;
      state.previous = t;
      return reply({ ok: true, sets: state });
    }
    if (p === 'status') return reply({ admin: 'stephen@example.com', health: { ok: true }, devices: [], job: null });
    return reply({ error: 'not_mocked' }, 404);
  });
  await page.goto(base + '/admin/', { waitUntil: 'networkidle0' });
  const line = () => page.$eval('#ph-sets', (e) => e.textContent);
  const shown = (id) => page.$eval(id, (e) => e.getBoundingClientRect().height > 0);
  const want = 'Current: 244 photos, Oct 25, 2026 · Previous: 50 photos, Oct 24, 2026 · Queued for cleanup: 4 set(s) · Deletes left today: 900 · Storage: approx. 75.0 MB';
  const l1 = await line();
  if (l1 !== want) failures.push('admin sets line: "' + l1 + '"');
  if (!(await shown('#ph-restore'))) failures.push('admin: Restore previous set not shown');
  if (await shown('#ph-restore-ok')) failures.push('admin: confirm shown before arming');
  await page.click('#ph-restore');
  await sleep(300);
  if (posts.length) failures.push('admin: arming alone sent ' + posts.join(','));
  if (!(await shown('#ph-restore-ok'))) failures.push('admin: confirm not shown after arming');
  await page.click('#ph-restore-ok');
  await sleep(500);
  if (posts.join(',') !== 'photos/restore-previous') failures.push('admin: confirm posts ' + posts.join(','));
  if (!(await line()).startsWith('Current: 50 photos, Oct 24, 2026 · Previous: 244 photos')) failures.push('admin after restore: "' + (await line()) + '"');
  if (await shown('#ph-restore-ok')) failures.push('admin: confirm still shown after swap');
  await page.click('#ph-restore');
  await sleep(200);
  await page.click('#ph-restore-ok');
  await sleep(500);
  if ((await line()) !== want) failures.push('admin flip back: "' + (await line()) + '"');
  if (await shown('#ph-restore-ok')) failures.push('admin: confirm still shown after flip back');
  await page.screenshot({ path: join(OUT, 'admin-photos.png'), fullPage: true });
  if (errors.length) failures.push('admin page errors: ' + errors.join(' | '));
  console.log('admin photos'.padEnd(18), 'ok');
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
