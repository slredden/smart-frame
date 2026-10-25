// Spotify OAuth (PLAN-v2.md §11.5): Authorization Code flow with the client secret, grant `spotify` in
// the existing `grants` table, tokens AES-GCM encrypted with TOKEN_ENC_KEY and never logged.
import { encryptText, decryptText, randomToken } from '../crypto.js';
import { nowIso, getMeta, setMeta } from '../db.js';
import { log } from '../http.js';

export const GRANT = 'spotify';
export const SCOPES = ['user-read-playback-state', 'user-modify-playback-state'];
export const AUTH_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const STATE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 86400000;
// Refresh tokens expire 6 months after consent and refreshing doesn't extend that. Reconnect by day 182,
// and health warns from day 168 (14 days before).
export const EXPIRES_DAYS = 182;
export const REAUTH_WARN_DAYS = 168;

export function redirectUri(origin) {
  return origin + '/admin/spotify/callback';
}

/** True when both halves of the app's client config are present. */
export const configured = (env) => !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);

function basic(env) {
  return 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET);
}

/** The consent URL; stores a one-time state row (oauth_state.verifier is unused here). */
export async function startAuth(env, origin, nowMs = Date.now()) {
  if (!configured(env)) throw new Error('spotify_client_missing');
  const state = randomToken(24);
  const db = env.FRAME_DB;
  await db.prepare('DELETE FROM oauth_state WHERE created_at < ?').bind(nowMs - STATE_TTL_MS).run();
  await db.prepare('INSERT INTO oauth_state (state, grant_name, verifier, created_at) VALUES (?, ?, ?, ?)').bind(state, GRANT, '', nowMs).run();
  const q = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(origin),
    scope: SCOPES.join(' '),
    state,
    show_dialog: 'true',
  });
  return AUTH_URL + '?' + q.toString();
}

async function saveTokens(env, tok, nowMs, keepRefresh) {
  const key = env.TOKEN_ENC_KEY;
  const refreshEnc = tok.refresh_token ? await encryptText(key, tok.refresh_token, 'refresh:' + GRANT) : keepRefresh;
  const accessEnc = await encryptText(key, tok.access_token, 'access:' + GRANT);
  const exp = nowMs + Math.max(60, Number(tok.expires_in) || 3600) * 1000;
  await env.FRAME_DB
    .prepare(
      `INSERT INTO grants (name, refresh_enc, access_enc, access_exp, scope, status, updated_at, last_error) VALUES (?, ?, ?, ?, ?, 'ok', ?, NULL)
       ON CONFLICT(name) DO UPDATE SET refresh_enc = excluded.refresh_enc, access_enc = excluded.access_enc, access_exp = excluded.access_exp,
       scope = COALESCE(excluded.scope, grants.scope), status = 'ok', updated_at = excluded.updated_at, last_error = NULL`,
    )
    .bind(GRANT, refreshEnc, accessEnc, exp, tok.scope || null, nowIso(nowMs))
    .run();
}

/** Handles /admin/spotify/callback. Returns {ok} or {ok:false, error}. */
export async function finishAuth(env, url, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const db = env.FRAME_DB;
  const row = state ? await db.prepare('SELECT grant_name, created_at FROM oauth_state WHERE state = ?').bind(state).first() : null;
  if (row) await db.prepare('DELETE FROM oauth_state WHERE state = ?').bind(state).run();
  if (!row || row.grant_name !== GRANT || nowMs - row.created_at > STATE_TTL_MS) return { ok: false, error: 'bad_state' };
  if (url.searchParams.get('error')) return { ok: false, error: 'consent_denied' };
  if (!code) return { ok: false, error: 'no_code' };
  if (!configured(env)) return { ok: false, error: 'spotify_client_missing' };
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(env) },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(url.origin) }),
  });
  if (!res.ok) {
    log('spotify_exchange_failed', { status: res.status });
    return { ok: false, error: 'exchange_failed' };
  }
  const tok = await res.json();
  const scopes = String(tok.scope || '').split(/\s+/);
  if (!SCOPES.every((s) => scopes.includes(s))) return { ok: false, error: 'scope_missing' };
  if (!tok.refresh_token || !tok.access_token) return { ok: false, error: 'no_refresh_token' };
  await saveTokens(env, tok, nowMs, null);
  await setMeta(db, 'spotify_connected_at', nowIso(nowMs));
  log('spotify_connected', {});
  return { ok: true };
}

/** A usable access token, refreshing (Basic auth) when it has < 5 min left. Null when not usable. */
export async function accessToken(env, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  if (!configured(env)) return null;
  const db = env.FRAME_DB;
  const row = await db.prepare('SELECT refresh_enc, access_enc, access_exp, status FROM grants WHERE name = ?').bind(GRANT).first();
  if (!row || row.status !== 'ok' || !row.refresh_enc) return null;
  if (row.access_enc && row.access_exp - nowMs > 5 * 60 * 1000) {
    return decryptText(env.TOKEN_ENC_KEY, row.access_enc, 'access:' + GRANT);
  }
  const refresh = await decryptText(env.TOKEN_ENC_KEY, row.refresh_enc, 'refresh:' + GRANT);
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(env) },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!res.ok) {
    let code = 'http_' + res.status;
    try {
      const b = await res.json();
      if (b && typeof b.error === 'string') code = b.error.slice(0, 40);
    } catch {
      // keep the http code
    }
    if (code === 'invalid_grant') {
      await db.prepare("UPDATE grants SET status = 'needs_reconsent', last_error = ?, updated_at = ? WHERE name = ?").bind(code, nowIso(nowMs), GRANT).run();
    } else {
      await db.prepare('UPDATE grants SET last_error = ? WHERE name = ?').bind(code, GRANT).run();
    }
    log('spotify_refresh_failed', { code });
    return null;
  }
  const tok = await res.json();
  // Spotify may rotate the refresh token; saveTokens keeps the old one only when none came back.
  await saveTokens(env, tok, nowMs, row.refresh_enc);
  return tok.access_token;
}

/** Clears the stored tokens (Spotify has no revoke endpoint; Stephen can remove the app in his account). */
export async function disconnect(env, nowMs = Date.now()) {
  await env.FRAME_DB
    .prepare(`UPDATE grants SET refresh_enc = NULL, access_enc = NULL, access_exp = NULL, status = 'disconnected', updated_at = ? WHERE name = ?`)
    .bind(nowIso(nowMs), GRANT)
    .run();
  await env.FRAME_DB.prepare("DELETE FROM meta WHERE key = 'spotify_connected_at'").run();
}

/**
 * Status for /admin and /api/health: {configured, status, connectedAt, reconnectBy, reauthDue}.
 * status is ok | needs_reconsent | disconnected | not_connected.
 */
export async function spotifyStatus(env, nowMs = Date.now()) {
  const db = env.FRAME_DB;
  const row = await db.prepare('SELECT status FROM grants WHERE name = ?').bind(GRANT).first();
  const status = row ? row.status : 'not_connected';
  const connectedAt = status === 'ok' ? await getMeta(db, 'spotify_connected_at') : null;
  const t = connectedAt ? Date.parse(connectedAt) : NaN;
  const reconnectBy = isFinite(t) ? nowIso(t + EXPIRES_DAYS * DAY_MS) : null;
  const reauthDue = isFinite(t) && nowMs - t >= REAUTH_WARN_DAYS * DAY_MS;
  return { configured: configured(env), status, connectedAt, reconnectBy, reauthDue };
}
