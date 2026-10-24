// Small shared helpers for the box-side CLIs. Tokens come from env vars only and are never printed.
export const DEFAULT_BASE = 'https://smart-frame.sredden.workers.dev';

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (a.includes('=')) out[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['--dry-run', '--json', '--quiet'].includes(a)) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

export function baseUrl(args) {
  const b = String(args.base || process.env.SMART_FRAME_URL || DEFAULT_BASE).replace(/\/+$/, '');
  if (!/^https:\/\//.test(b) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b)) throw new Error('base URL must be https (or local http)');
  return b;
}

export function tokenFrom(name) {
  const t = process.env[name];
  if (!t || t.length < 24) throw new Error(name + ' is not set (or too short). Set it in the environment; never pass it as an argument.');
  return t;
}
