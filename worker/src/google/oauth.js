// Google OAuth for two grants with one Web client (PLAN.md §7.3).
// Tokens are AES-GCM encrypted in D1 and never logged.
import { encryptText, decryptText, pkcePair, randomToken } from '../crypto.js';
import { nowIso } from '../db.js';
import { log } from '../http.js';

export const GRANTS = {
  calendar: { scope: 'https://www.googleapis.com/auth/calendar.events.readonly' },
  photos: { scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly' },
};

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const STATE_TTL_MS = 10 * 60 * 1000;

export function redirectUri(origin) {
  return origin + '/admin/oauth/callback';
}

/** Builds the consent URL and stores a one-time state row with the PKCE verifier. */
export async function startAuth(env, grant, origin, nowMs = Date.now()) {
  if (!GRANTS[grant]) throw new Error('unknown_grant');
  if (!env.GOOGLE_CLIENT_ID) throw new Error('google_client_missing');
  const { verifier, challenge } = await pkcePair();
  const state = randomToken(24);
  const db = env.FRAME_DB;
  await db.prepare('DELETE FROM oauth_state WHERE created_at < ?').bind(nowMs - STATE_TTL_MS).run();
  await db.prepare('INSERT INTO oauth_state (state, grant_name, verifier, created_at) VALUES (?, ?, ?, ?)').bind(state, grant, verifier, nowMs).run();
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: GRANTS[grant].scope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return AUTH_URL + '?' + q.toString();
}

async function saveTokens(env, grant, tok, nowMs, keepRefresh) {
  const key = env.TOKEN_ENC_KEY;
  const refreshEnc = tok.refresh_token ? await encryptText(key, tok.refresh_token, 'refresh:' + grant) : keepRefresh;
  const accessEnc = await encryptText(key, tok.access_token, 'access:' + grant);
  const exp = nowMs + Math.max(60, Number(tok.expires_in) || 3600) * 1000;
  await env.FRAME_DB
    .prepare(
      `INSERT INTO grants (name, refresh_enc, access_enc, access_exp, scope, status, updated_at, last_error) VALUES (?, ?, ?, ?, ?, 'ok', ?, NULL)
       ON CONFLICT(name) DO UPDATE SET refresh_enc = excluded.refresh_enc, access_enc = excluded.access_enc, access_exp = excluded.access_exp,
       scope = excluded.scope, status = 'ok', updated_at = excluded.updated_at, last_error = NULL`,
    )
    .bind(grant, refreshEnc, accessEnc, exp, tok.scope || GRANTS[grant].scope, nowIso(nowMs))
    .run();
}

/** Handles /admin/oauth/callback. Returns {ok, grant} or {ok:false, error}. */
export async function finishAuth(env, url, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const db = env.FRAME_DB;
  const row = state ? await db.prepare('SELECT grant_name, verifier, created_at FROM oauth_state WHERE state = ?').bind(state).first() : null;
  if (row) await db.prepare('DELETE FROM oauth_state WHERE state = ?').bind(state).run();
  if (!row || nowMs - row.created_at > STATE_TTL_MS) return { ok: false, error: 'bad_state' };
  if (url.searchParams.get('error')) return { ok: false, error: 'consent_denied', grant: row.grant_name };
  if (!code) return { ok: false, error: 'no_code', grant: row.grant_name };
  const grant = row.grant_name;
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri(url.origin),
      grant_type: 'authorization_code',
      code_verifier: row.verifier,
    }),
  });
  if (!res.ok) {
    log('oauth_exchange_failed', { grant, status: res.status });
    return { ok: false, error: 'exchange_failed', grant };
  }
  const tok = await res.json();
  const scopes = String(tok.scope || '').split(/\s+/);
  if (!scopes.includes(GRANTS[grant].scope)) return { ok: false, error: 'scope_missing', grant };
  if (!tok.refresh_token) return { ok: false, error: 'no_refresh_token', grant };
  await saveTokens(env, grant, tok, nowMs, null);
  log('oauth_connected', { grant });
  return { ok: true, grant };
}

async function markGrant(db, grant, status, err, nowMs) {
  await db.prepare('UPDATE grants SET status = ?, last_error = ?, updated_at = ? WHERE name = ?').bind(status, err, nowIso(nowMs), grant).run();
}

/** A usable access token for `grant`, refreshing if needed. Null when the grant isn't usable. */
export async function accessToken(env, grant, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const row = await db.prepare('SELECT refresh_enc, access_enc, access_exp, status FROM grants WHERE name = ?').bind(grant).first();
  if (!row || row.status !== 'ok' || !row.refresh_enc) return null;
  if (row.access_enc && row.access_exp - nowMs > 5 * 60 * 1000) {
    return decryptText(env.TOKEN_ENC_KEY, row.access_enc, 'access:' + grant);
  }
  const refresh = await decryptText(env.TOKEN_ENC_KEY, row.refresh_enc, 'refresh:' + grant);
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  if (!res.ok) {
    let code = 'http_' + res.status;
    try {
      const b = await res.json();
      if (b && typeof b.error === 'string') code = b.error.slice(0, 40);
    } catch {
      // keep the http code
    }
    if (code === 'invalid_grant') await markGrant(db, grant, 'needs_reconsent', code, nowMs);
    else await db.prepare('UPDATE grants SET last_error = ? WHERE name = ?').bind(code, grant).run();
    log('oauth_refresh_failed', { grant, code });
    return null;
  }
  const tok = await res.json();
  await saveTokens(env, grant, tok, nowMs, row.refresh_enc);
  return tok.access_token;
}

/** Revokes at Google (best effort) and clears stored tokens. The row stays as 'disconnected'. */
export async function disconnect(env, grant, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const db = env.FRAME_DB;
  const row = await db.prepare('SELECT refresh_enc FROM grants WHERE name = ?').bind(grant).first();
  if (row && row.refresh_enc) {
    try {
      const refresh = await decryptText(env.TOKEN_ENC_KEY, row.refresh_enc, 'refresh:' + grant);
      await fetchImpl(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) });
    } catch {
      log('oauth_revoke_failed', { grant });
    }
  }
  await db
    .prepare(`UPDATE grants SET refresh_enc = NULL, access_enc = NULL, access_exp = NULL, status = 'disconnected', updated_at = ? WHERE name = ?`)
    .bind(nowIso(nowMs), grant)
    .run();
}

export async function grantStatuses(db) {
  const out = { calendar: { status: 'not_connected' }, photos: { status: 'not_connected' } };
  const { results } = await db.prepare('SELECT name, status, updated_at, last_error FROM grants').all();
  for (const r of results) if (out[r.name]) out[r.name] = { status: r.status, updatedAt: r.updated_at, lastError: r.last_error };
  return out;
}
