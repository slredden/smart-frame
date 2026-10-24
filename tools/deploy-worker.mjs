#!/usr/bin/env node
// CI deploy wrapper (PLAN.md §12): `wrangler deploy` with BUILD_ID set to the commit, output filtered to
// drop per-file asset lines, exits with wrangler's own status. Same approach as the Grokbot Hub.
//   BUILD_ID=<sha> node tools/deploy-worker.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Drops asset/file listing lines; keeps results, version ids, errors. Exported for tests. */
export function scrubLine(l) {
  if (/^\s*[+~-]\s+\/\S+/.test(l)) return null; // "+ /assets/index-abc.js"
  if (/^\s*(Uploaded|Uploading)\s+\d+\s+of\s+\d+/i.test(l)) return null;
  return l.replace(/\/home\/runner\/\S+/g, '<path>');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const build = process.env.BUILD_ID || '';
  if (!/^[0-9a-f]{7,40}$/.test(build)) {
    console.error('BUILD_ID must be a git sha');
    process.exit(2);
  }
  const lvl = (process.env.WRANGLER_LOG || '').toLowerCase();
  if (lvl && lvl !== 'log') {
    console.error('refusing: WRANGLER_LOG=' + lvl + ' (use unset or "log")');
    process.exit(2);
  }
  const bin = process.env.DEPLOY_WRANGLER_BIN || path.join(ROOT, 'node_modules/.bin/wrangler');
  const args = process.env.DEPLOY_WRANGLER_BIN ? [] : ['deploy', '--config', 'worker/wrangler.jsonc', '--var', 'BUILD_ID:' + build];
  const child = spawn(bin, args, { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (src, dst) =>
    new Promise((done) =>
      readline
        .createInterface({ input: src, crlfDelay: Infinity })
        .on('line', (l) => {
          const s = scrubLine(l);
          if (s !== null) dst.write(s + '\n');
        })
        .on('close', done),
    );
  const drained = Promise.all([pipe(child.stdout, process.stdout), pipe(child.stderr, process.stderr)]);
  const code = await new Promise((res) => {
    child.on('error', (e) => {
      console.error('deploy-worker: could not start wrangler: ' + e.message);
      res(1);
    });
    child.on('exit', (c, sig) => res(c ?? (sig ? 1 : 0)));
  });
  await drained;
  process.exitCode = code === 0 ? 0 : code || 1;
}
