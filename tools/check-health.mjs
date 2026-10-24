#!/usr/bin/env node
// Chief's health check (docs/runbook-health.md). GET /api/health with SMART_FRAME_HEALTH_TOKEN.
// Exit codes: 0 healthy (or only soft problems), 2 alert (email Stephen), 3 Worker unreachable or
// auth failed (also email), 1 usage error. --json prints the raw (content-free) health JSON.
import { parseArgs, baseUrl, tokenFrom } from './lib/cli.mjs';

const args = parseArgs(process.argv.slice(2));
let base;
let token;
try {
  base = baseUrl(args);
  token = tokenFrom('SMART_FRAME_HEALTH_TOKEN');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
let res;
try {
  res = await fetch(base + '/api/health', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
} catch (e) {
  console.log('ALERT worker_unreachable (' + (e.name || 'error') + ')');
  process.exit(3);
}
if (!res.ok) {
  console.log('ALERT health_http_' + res.status);
  process.exit(3);
}
const h = await res.json();
if (args.json) console.log(JSON.stringify(h, null, 2));
const age = h.frame && h.frame.ageMinutes != null ? h.frame.ageMinutes + ' min ago' : 'never';
const line = 'frame last seen ' + age + '; grants ' + Object.entries(h.grants || {}).map(([k, v]) => k + '=' + v.status).join(' ') + '; photos ' + ((h.photos && h.photos.count) || 0);
if (h.alert) {
  console.log('ALERT ' + h.problems.join(' ') + '\n' + line);
  process.exit(2);
}
console.log((h.ok ? 'OK ' : 'OK (soft: ' + h.problems.join(' ') + ') ') + line);
