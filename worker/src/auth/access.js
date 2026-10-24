// Cloudflare Access JWT check for /admin (PLAN.md §7.2). Fails closed on any missing config.
import { b64urlDecode } from '../crypto.js';

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: '', at: 0, keys: new Map() };

async function getKey(teamDomain, kid, fetchImpl, nowMs) {
  const url = teamDomain.replace(/\/$/, '') + '/cdn-cgi/access/certs';
  if (jwksCache.url !== url || nowMs - jwksCache.at > JWKS_TTL_MS || !jwksCache.keys.has(kid)) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error('jwks_fetch_failed');
    const body = await res.json();
    const keys = new Map();
    for (const jwk of body.keys || []) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue;
      keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    jwksCache = { url, at: nowMs, keys };
  }
  return jwksCache.keys.get(kid) || null;
}

export function resetJwksCache() {
  jwksCache = { url: '', at: 0, keys: new Map() };
}

function parseEmails(list) {
  return String(list || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns {email} when the request carries a valid Access JWT for this app and an allowed email,
 * otherwise null.
 */
export async function verifyAccess(request, env, fetchImpl = fetch, nowMs = Date.now()) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  const allowed = parseEmails(env.ADMIN_EMAILS);
  if (!team || !aud || !allowed.length) return null;
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;
  let key;
  try {
    key = await getKey(team, header.kid, fetchImpl, nowMs);
  } catch {
    return null;
  }
  if (!key) return null;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const now = Math.floor(nowMs / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss !== team.replace(/\/$/, '')) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return null;
  const email = String(payload.email || '').toLowerCase();
  if (!email || !allowed.includes(email)) return null;
  return { email };
}
