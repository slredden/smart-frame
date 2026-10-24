// Small crypto helpers on WebCrypto. Nothing here logs inputs.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64Decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}

export async function sha256Hex(text) {
  const h = await sha256(text);
  let s = '';
  for (const b of h) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Constant-time string comparison (length leak only). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

const hmacKeys = new Map();
async function hmacKey(secret) {
  let k = hmacKeys.get(secret);
  if (!k) {
    k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, k);
  }
  return k;
}

export async function hmac(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message));
  return b64urlEncode(sig);
}

const aesKeys = new Map();
async function aesKey(b64) {
  let k = aesKeys.get(b64);
  if (!k) {
    const raw = b64Decode(b64);
    if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY must be 32 bytes, base64');
    k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    aesKeys.set(b64, k);
  }
  return k;
}

/** AES-256-GCM. Output 'v1.<iv>.<ciphertext>' (base64url). `aad` binds the value to its purpose. */
export async function encryptText(keyB64, plain, aad = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await aesKey(keyB64), enc.encode(plain));
  return 'v1.' + b64urlEncode(iv) + '.' + b64urlEncode(ct);
}

export async function decryptText(keyB64, boxed, aad = '') {
  const parts = String(boxed).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('bad ciphertext');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(parts[1]), additionalData: enc.encode(aad) },
    await aesKey(keyB64),
    b64urlDecode(parts[2]),
  );
  return dec.decode(pt);
}

export async function pkcePair() {
  const verifier = randomToken(48);
  const challenge = b64urlEncode(await sha256(verifier));
  return { verifier, challenge };
}
