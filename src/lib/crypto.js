// WebCrypto helpers — identical behaviour on Cloudflare Workers and Node 20+.
const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const uid = (prefix = '') => prefix + randomToken(12);
export async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

// PBKDF2-HMAC-SHA256. Cloudflare Workers caps iterations at 100,000; iterations are stored per user
// so the work factor can be raised later (e.g. in Docker) without breaking existing hashes.
export async function hashPassword(password, salt = randomToken(16), iterations = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
  return { hash: hex(bits), salt, iterations };
}
export async function verifyPassword(password, user) {
  const { hash } = await hashPassword(password, user.pw_salt, user.pw_iter);
  return timingSafeEqual(hash, user.pw_hash);
}
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// AES-256-GCM for provider credentials at rest. Key: 32 random bytes, base64, from ENCRYPTION_KEY.
async function aesKey(b64key) {
  if (!b64key) throw new Error('ENCRYPTION_KEY is not configured');
  const raw = unb64(b64key);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(plaintext, b64key, aad = '') {
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await aesKey(b64key), enc.encode(plaintext));
  return { ciphertext: b64(ct), iv: b64(iv) };
}
export async function decrypt({ ciphertext, iv }, b64key, aad = '') {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(aad) }, await aesKey(b64key), unb64(ciphertext));
  return dec.decode(pt);
}

export function passwordProblems(pw) {
  const p = [];
  if (typeof pw !== 'string' || pw.length < 12) p.push('at least 12 characters');
  if (pw && pw.length > 256) p.push('at most 256 characters');
  if (pw && !/[a-z]/i.test(pw)) p.push('a letter');
  if (pw && !/[0-9]/.test(pw)) p.push('a number');
  return p;
}
