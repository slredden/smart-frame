// Static bearer tokens for Chief's endpoints. The Worker holds only SHA-256 hex hashes as secrets.
import { sha256Hex, safeEqual } from '../crypto.js';
import { bearer } from '../http.js';

/** True only when a hash is configured and the presented token hashes to it. Fails closed. */
export async function checkHashedToken(request, hashHex) {
  if (!hashHex || !/^[0-9a-f]{64}$/i.test(hashHex)) return false;
  const raw = bearer(request);
  if (!raw || raw.length < 16 || raw.length > 256) return false;
  return safeEqual(await sha256Hex(raw), hashHex.toLowerCase());
}
