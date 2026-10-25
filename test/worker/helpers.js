import { env as baseEnv } from 'cloudflare:workers';
import { ensureSchema } from '../../worker/src/db.js';
import { createDevice } from '../../worker/src/auth/device.js';
import { b64urlEncode } from '../../worker/src/crypto.js';

export const HEALTH = 'test-health-token-0123456789';
export const PUBLISH = 'test-publish-token-0123456789';
export const ORIGIN = 'https://smart-frame.example.workers.dev';

export function testEnv(extra = {}) {
  const assets = { fetch: async (req) => new Response('static:' + new URL(req.url).pathname, { headers: { 'content-type': 'text/html' } }) };
  return Object.assign({}, baseEnv, { ASSETS: assets, BUILD_ID: 'test-build' }, extra);
}

const TABLES = ['devices', 'grants', 'cache', 'reflection', 'photo_sets', 'photos', 'picker_jobs', 'oauth_state', 'meta', 'kv_writes', 'calendars', 'settings', 'tasklists', 'reflection_guides'];

/** Fresh tables per test (local test D1 only) plus one paired device. */
export async function setup(env) {
  await ensureSchema(env.FRAME_DB);
  await env.FRAME_DB.batch(TABLES.map((t) => env.FRAME_DB.prepare('DELETE FROM ' + t)));
  return createDevice(env.FRAME_DB, 'kitchen');
}

export const req = (path, init = {}) => new Request(ORIGIN + path, init);
export const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });

/** A real RS256 key pair plus a signer, for Access JWT tests. */
export async function accessKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  jwk.kid = 'k1';
  const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  async function sign(payload) {
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + enc(payload);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head));
    return head + '.' + b64urlEncode(new Uint8Array(sig));
  }
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/cdn-cgi/access/certs')) return Response.json({ keys: [jwk] });
    return new Response('nope', { status: 404 });
  };
  return { sign, fetchImpl };
}
