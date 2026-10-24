#!/usr/bin/env node
// Fails (exit 1) when built frame files use features Chrome 106 (the frame's WebView) lacks.
// Usage: node tools/compat-check.mjs frame/dist
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const CSS_RULES = [
  [/oklch\(/i, 'oklch()'],
  [/oklab\(/i, 'oklab()'],
  [/color-mix\(/i, 'color-mix()'],
  [/:has\(/i, ':has()'],
  [/@container\b/i, '@container'],
  [/@property\b/i, '@property'],
  [/\b\d*\.?\d+(dvh|svh|lvh|dvw|svw|lvw)\b/i, 'dynamic viewport units'],
  [/@starting-style\b/i, '@starting-style'],
  [/\btext-wrap\s*:/i, 'text-wrap'],
  [/backdrop-filter\s*:/i, 'backdrop-filter'],
  [/(?<![\w-])#(?:[0-9a-f]{4}|[0-9a-f]{8})(?![0-9a-f\w-])/i, '4/8-digit hex color'],
  [/animation[^;{}]*\binfinite\b/i, 'infinite animation'],
];

const JS_RULES = [
  [/\.toSorted\(/, 'Array#toSorted'],
  [/\.toReversed\(/, 'Array#toReversed'],
  [/\.toSpliced\(/, 'Array#toSpliced'],
  [/\.with\(\s*-?\d/, 'Array#with'],
  [/Object\.groupBy\(/, 'Object.groupBy'],
  [/Map\.groupBy\(/, 'Map.groupBy'],
  [/Promise\.withResolvers\(/, 'Promise.withResolvers'],
  [/Array\.fromAsync\(/, 'Array.fromAsync'],
];

const SVG_RULES = [[/<animate/i, 'SMIL <animate>']];

// Native CSS nesting: a '{' opened while already inside a style rule (not an at-rule block).
export function hasNesting(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  const stack = [];
  let head = '';
  for (const ch of stripped) {
    if (ch === '{') {
      const isAt = head.trim().startsWith('@');
      if (stack.length && stack[stack.length - 1] === 'rule') return true;
      stack.push(isAt ? 'at' : 'rule');
      head = '';
    } else if (ch === '}') {
      stack.pop();
      head = '';
    } else if (ch === ';') {
      head = '';
    } else {
      head += ch;
    }
  }
  return false;
}

export function checkText(kind, text) {
  const hits = [];
  const rules = kind === 'css' ? CSS_RULES : kind === 'js' ? JS_RULES : kind === 'svg' ? SVG_RULES : [];
  for (const [re, name] of rules) if (re.test(text)) hits.push(name);
  if (kind === 'css' && hasNesting(text)) hits.push('CSS nesting');
  if (kind === 'html') {
    for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) hits.push(...checkText('css', m[1]));
    for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) hits.push(...checkText('js', m[1]));
  }
  return hits;
}

const KIND = { '.css': 'css', '.js': 'js', '.mjs': 'js', '.html': 'html', '.svg': 'svg' };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const JS_BUDGET_GZ = 60 * 1024;

function main(argv) {
  const dir = argv[0] || 'frame/dist';
  let failed = 0;
  let checked = 0;
  for (const f of walk(dir)) {
    const kind = KIND[extname(f)];
    if (!kind) continue;
    checked++;
    const hits = checkText(kind, readFileSync(f, 'utf8'));
    if (hits.length) {
      failed++;
      console.error(`✗ ${f}: ${hits.join(', ')}`);
    }
  }
  if (!checked) {
    console.error(`No files checked in ${dir}. Run the build first.`);
    process.exit(1);
  }
  console.log(failed ? `${failed} file(s) failed the Chrome 106 check.` : `✓ ${checked} files pass the Chrome 106 check.`);
  // Bundle budget (PLAN.md §16 P1): the frame's JS, gzipped, at most 60 KB.
  const js = walk(dir).filter((f) => extname(f) === '.js' && !f.includes('/admin'));
  const gz = js.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
  const over = gz > JS_BUDGET_GZ;
  console.log(`${over ? '✗' : '✓'} frame JS ${(gz / 1024).toFixed(1)} KB gzipped (budget ${JS_BUDGET_GZ / 1024} KB)`);
  process.exit(failed || over ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
