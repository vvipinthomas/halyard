// RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits) with WebCrypto — works on Workers and Node.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export function newSecret() { const b = new Uint8Array(20); crypto.getRandomValues(b); return base32Encode(b); }

export async function hotp(secretB32, counter, digits = 6) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8); const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32)); view.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const counterAt = (ms = Date.now(), step = 30) => Math.floor(ms / 1000 / step);
export async function totp(secretB32, ms = Date.now()) { return hotp(secretB32, counterAt(ms)); }

// Returns the matching counter (to block replay) or null. Accepts ±1 step for clock drift.
export async function verifyTotp(secretB32, code, { now = Date.now(), lastCounter = 0, window = 1 } = {}) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return null;
  const c0 = counterAt(now);
  for (let d = -window; d <= window; d++) {
    const c = c0 + d;
    if (c <= lastCounter) continue;
    if ((await hotp(secretB32, c)) === String(code).trim()) return c;
  }
  return null;
}
export const otpauthUri = (secret, account, issuer = 'Halyard') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
