#!/usr/bin/env node
// Chief's monthly publish (docs/runbook-reflection.md): extract the guide locally, then
// PUT /api/publish/reflection with the publish token from SMART_FRAME_PUBLISH_TOKEN.
// Prints week numbers and dates only, never the text.
//   node tools/publish-reflection.mjs <guide.html> [--dry-run] [--start … --end …] [--base https://…]
import { readFile } from 'node:fs/promises';
import { extractGuide, summary } from './lib/reflection-parse.mjs';
import { parseArgs, baseUrl, tokenFrom } from './lib/cli.mjs';

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
if (!file) {
  console.error('usage: publish-reflection.mjs <guide.html> [--dry-run] [--start YYYY-MM-DD --end YYYY-MM-DD] [--base URL]');
  process.exit(2);
}
try {
  const { guide, problems } = extractGuide(await readFile(file, 'utf8'), { start: args.start, end: args.end });
  if (!guide) throw new Error('refused: ' + problems.join(', '));
  console.log(summary(guide));
  if (args['dry-run']) {
    console.log('dry run: nothing sent');
    process.exit(0);
  }
  const base = baseUrl(args);
  const token = tokenFrom('SMART_FRAME_PUBLISH_TOKEN');
  const res = await fetch(base + '/api/publish/reflection', {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(guide),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('publish failed: HTTP ' + res.status + (body.error ? ' ' + body.error : '') + (body.problems ? ' (' + body.problems.join(', ') + ')' : ''));
  console.log('published: ' + body.weeks.length + ' weeks, ' + body.start + ' → ' + body.end);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
