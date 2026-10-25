// D1 schema (created at runtime so the deploy token needs no D1 permissions) and small helpers.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
    last_seen TEXT, last_heartbeat TEXT, build TEXT, uptime_sec INTEGER, js_errors TEXT, revoked_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS grants (
    name TEXT PRIMARY KEY, refresh_enc TEXT, access_enc TEXT, access_exp INTEGER, scope TEXT,
    status TEXT NOT NULL, updated_at TEXT NOT NULL, last_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at TEXT NOT NULL, ok_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS reflection (id INTEGER PRIMARY KEY CHECK (id = 1), data_enc TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS photo_sets (set_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS photos (
    set_id TEXT NOT NULL, n INTEGER NOT NULL, w INTEGER, h INTEGER, orient TEXT, taken TEXT, blur TEXT,
    PRIMARY KEY (set_id, n))`,
  `CREATE TABLE IF NOT EXISTS picker_jobs (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, set_id TEXT NOT NULL, status TEXT NOT NULL,
    cursor TEXT, count INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, grant_name TEXT NOT NULL, verifier TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv_writes (day TEXT PRIMARY KEY, count INTEGER NOT NULL)`,
  // v1.1: the account's calendar list (synced from Google on /admin) and which ones the frame shows.
  `CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY, summary TEXT NOT NULL, color TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
    selected INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
  // v2 P1: frame settings, one JSON value per key (PLAN-v2.md §7.3).
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  // v2 P1b: the account's task lists (loaded on demand) and which ones the frame shows (PLAN-v2.md §4.1).
  `CREATE TABLE IF NOT EXISTS tasklists (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, selected INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
  // v2 P1b: up to 6 published guides, one row per guide start (PLAN-v2.md §8.2). Replaces reflection id = 1.
  `CREATE TABLE IF NOT EXISTS reflection_guides (start TEXT PRIMARY KEY, end TEXT NOT NULL, data_enc TEXT NOT NULL, published_at TEXT NOT NULL)`,
];

// Columns added to existing tables. SQLite has no ADD COLUMN IF NOT EXISTS, so each runs once per
// database (meta schema_v) and a "duplicate column" error from a half-finished run is ignored.
export const SCHEMA_VERSION = 2;
const MIGRATIONS = [
  'ALTER TABLE calendars ADD COLUMN alert INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE photos ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0',
];

async function migrate(db) {
  const v = Number(await getMeta(db, 'schema_v')) || 1;
  if (v >= SCHEMA_VERSION) return;
  for (const sql of MIGRATIONS) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
  await setMeta(db, 'schema_v', SCHEMA_VERSION);
}

const ready = new WeakMap();

/** Creates tables once per isolate per database binding. */
export function ensureSchema(db) {
  let p = ready.get(db);
  if (!p) {
    p = db.batch(SCHEMA.map((s) => db.prepare(s))).then(() => migrate(db)).catch((e) => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();

export async function getMeta(db, key) {
  const r = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}

export async function setMeta(db, key, value) {
  await db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value)).run();
}

export async function getCache(db, key) {
  const r = await db.prepare('SELECT value, fetched_at, ok_at FROM cache WHERE key = ?').bind(key).first();
  if (!r) return null;
  return { value: JSON.parse(r.value), fetchedAt: r.fetched_at, okAt: r.ok_at };
}

export async function putCache(db, key, value, ms = Date.now()) {
  const t = nowIso(ms);
  await db
    .prepare('INSERT INTO cache (key, value, fetched_at, ok_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, ok_at = excluded.ok_at')
    .bind(key, JSON.stringify(value), t, t)
    .run();
}
