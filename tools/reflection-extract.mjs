#!/usr/bin/env node
// Parses a monthly guide HTML file into reflection JSON (PLAN.md §9.4) and prints a structure-only
// summary (week numbers, dates, text lengths). The guide is private: it is read from a path outside
// this repo and never copied in. Use --out <file> to write the JSON somewhere private.
//   node tools/reflection-extract.mjs <guide.html> [--start YYYY-MM-DD --end YYYY-MM-DD] [--out file.json]
import { readFile, writeFile } from 'node:fs/promises';
import { extractGuide, summary } from './lib/reflection-parse.mjs';
import { parseArgs } from './lib/cli.mjs';

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
if (!file) {
  console.error('usage: reflection-extract.mjs <guide.html> [--start YYYY-MM-DD --end YYYY-MM-DD] [--out file.json]');
  process.exit(2);
}
const { guide, problems } = extractGuide(await readFile(file, 'utf8'), { start: args.start, end: args.end });
if (!guide) {
  console.error('refused: ' + problems.join(', '));
  process.exit(1);
}
console.log(summary(guide));
if (args.out) {
  await writeFile(args.out, JSON.stringify(guide, null, 2), { mode: 0o600 });
  console.log('wrote ' + guide.weeks.length + ' weeks to the --out file (mode 600)');
}
