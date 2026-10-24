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
  { name: 'a', screen: 'a', at: AT, check: ['.card', '#screen-a'] },
  { name: 'b', screen: 'b', at: AT, check: ['.rail', '#screen-b'] },
  { name: 'night', screen: 'night', at: '2026-10-25T05:10:00Z', check: ['.night-clock'] },
  { name: 'morning-scheduled', screen: '', at: '2026-10-24T12:30:00Z', expectBody: 'screen-b' },
];

for (const c of cases) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const q = '?mock=1&at=' + encodeURIComponent(c.at) + (c.screen ? '&screen=' + c.screen : '');
  await page.goto(base + '/' + q, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900)); // first crossfade
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
  const want = c.expectBody || 'screen-' + c.screen;
  if (!info.body.split(/\s+/).includes(want)) failures.push(c.name + ': body class ' + info.body + ', wanted ' + want);
  for (const b of info.boxes) {
    if (!b.box || b.box.display === 'none' || b.box.w === 0) failures.push(c.name + ': ' + b.sel + ' not visible');
    else if (b.box.x < 0 || b.box.y < 0 || b.box.x + b.box.w > 1280.5 || b.box.y + b.box.h > 800.5) failures.push(c.name + ': ' + b.sel + ' outside the screen');
  }
  if (info.overflowX || info.overflowY) failures.push(c.name + ': page scrolls');
  if (errors.length) failures.push(c.name + ': JS errors: ' + errors.join(' | '));
  console.log(c.name.padEnd(18), info.body);
  await page.close();
}

// A single tap at night wakes to A; a second swaps to B.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, hasTouch: true });
  await page.goto(base + '/?mock=1&at=' + encodeURIComponent('2026-10-25T05:10:00Z'), { waitUntil: 'networkidle0' });
  await page.touchscreen.tap(640, 400);
  await new Promise((r) => setTimeout(r, 300));
  const first = await page.evaluate(() => document.body.className);
  await new Promise((r) => setTimeout(r, 500));
  await page.touchscreen.tap(640, 400);
  await new Promise((r) => setTimeout(r, 300));
  const second = await page.evaluate(() => document.body.className);
  if (!first.includes('screen-a')) failures.push('tap: night → ' + first);
  if (!second.includes('screen-b')) failures.push('tap: second tap → ' + second);
  console.log('taps'.padEnd(18), first, '→', second);
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
