// SSRF guard for outbound requests made on a user's behalf (MCP proxy, custom model endpoints).
// Blocks non-HTTPS and private, loopback, link-local and metadata ranges unless explicitly allowed
// (ALLOW_PRIVATE_NETWORK=true is intended for local Docker use with Ollama / LM Studio / local MCP).
const PRIVATE = [
  /^localhost$/i, /\.localhost$/i, /\.internal$/i, /\.local$/i,
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/, /^\[?f[cd][0-9a-f]{2}:/i, /^\[?fe80:/i, /^\[?::ffff:/i, /^metadata\.google\.internal$/i,
];
export function checkOutboundUrl(raw, { allowPrivate = false } = {}) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'Invalid URL' }; }
  if (u.username || u.password) return { ok: false, reason: 'Credentials in URL are not allowed' };
  const host = u.hostname;
  const isPrivate = PRIVATE.some((r) => r.test(host)) || /^\d+$/.test(host);
  if (isPrivate && !allowPrivate) return { ok: false, reason: 'Private or local network addresses are blocked on this deployment' };
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) return { ok: false, reason: 'Only HTTPS endpoints are allowed' };
  return { ok: true, url: u };
}
