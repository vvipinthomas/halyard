// HALYARD API — one Hono app for Cloudflare Workers (D1) and Node/Docker (SQLite).
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { uid, randomToken, sha256, hashPassword, verifyPassword, passwordProblems, encrypt, decrypt } from './lib/crypto.js';
import { checkOutboundUrl } from './lib/net.js';
import { callProvider, PROVIDERS, httpError } from './lib/llm.js';
import { computeKpis, priceRun } from './lib/kpis.js';
import { newSecret, verifyTotp, otpauthUri } from './lib/totp.js';
import { appendAudit } from './lib/audit.js';
import { mountFactory } from './factory/routes.js';
import { tick as factoryTick } from './factory/loop.js';

export const KINDS = ['agent', 'flow', 'skill', 'mcp', 'context', 'knowledge', 'memory'];
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const SESSION_IDLE_MS = 30 * 60 * 1000;          // CC6.1: idle timeout
const SESSION_MAX_MS = 12 * 60 * 60 * 1000;      // absolute lifetime
const LOCKOUT_THRESHOLD = 5, LOCKOUT_MS = 15 * 60 * 1000;
const COOKIE = 'hy_session';

export function createApp({ getDb, getEnv, fetchImpl }) {
  const doFetch = (...a) => (fetchImpl || fetch)(...a);
  const app = new Hono();

  // ---- security headers on every response ----
  app.use('*', async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://esm.run https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self' http://localhost:* http://127.0.0.1:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com https://cdn.jsdelivr.net https://esm.run; " +
      "worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (c.req.path.startsWith('/api/')) h.set('Cache-Control', 'no-store');
  });

  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Request body too large (1 MB max)' }, 413) }));

  // ---- context: db, env, auth ----
  app.use('/api/*', async (c, next) => {
    c.set('db', await getDb(c)); c.set('env', getEnv(c));
    // CSRF: cookie-authenticated mutations must carry a custom header (cannot be sent cross-site without CORS preflight).
    const m = c.req.method;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(m) && getCookie(c, COOKIE) && c.req.header('x-halyard') !== '1') return c.json({ error: 'Missing X-Halyard header' }, 403);
    await next();
  });

  const ip = (c) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';

  async function audit(c, action, target = null, detail = null) {
    const u = c.get('user');
    await appendAudit(c.get('db'), { org: u?.org_id || null, user: u?.id || null, action, target, detail, ip: ip(c) });
  }

  async function rateLimit(c, key, limit, windowMs) {
    // Single upsert so parallel requests can't all read the same count and slip past the limit.
    const now = Date.now();
    const row = await c.get('db').get(
      'INSERT INTO rate_limits (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET ' +
      'count=CASE WHEN rate_limits.reset_at<? THEN 1 ELSE rate_limits.count+1 END, ' +
      'reset_at=CASE WHEN rate_limits.reset_at<? THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count',
      [key, now + windowMs, now, now]);
    return row.count <= limit;
  }

  async function loadUser(c) {
    const db = c.get('db'); const now = Date.now();
    const auth = c.req.header('authorization');
    if (auth?.startsWith('Bearer hy_')) {
      const k = await db.get('SELECT k.id kid, u.* FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked=0 AND u.disabled=0', [await sha256(auth.slice(7))]);
      if (k) { await db.run('UPDATE api_keys SET last_used_at=? WHERE id=?', [now, k.kid]); c.set('authType', 'apikey'); return k; }
      return null;
    }
    const tok = getCookie(c, COOKIE); if (!tok) return null;
    const th = await sha256(tok);
    const s = await db.get('SELECT s.*, u.id uid FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.disabled=0', [th]);
    if (!s || s.expires_at < now || now - s.last_seen_at > SESSION_IDLE_MS) { if (s) await db.run('DELETE FROM sessions WHERE token_hash=?', [th]); return null; }
    await db.run('UPDATE sessions SET last_seen_at=? WHERE token_hash=?', [now, th]);
    c.set('authType', 'session');
    return db.get('SELECT * FROM users WHERE id=?', [s.user_id]);
  }

  const requireRole = (role) => async (c, next) => {
    const u = await loadUser(c);
    if (!u) return c.json({ error: 'Not signed in' }, 401);
    if (ROLE_RANK[u.role] < ROLE_RANK[role]) return c.json({ error: `Requires ${role} role` }, 403);
    c.set('user', u);
    // Org-wide MFA enforcement: a signed-in user without MFA may only reach their own account & MFA setup.
    if (!u.mfa_enabled && c.get('authType') === 'session' && !/^\/api\/auth\/(me|mfa\/|password)/.test(c.req.path)) {
      const org = await c.get('db').get('SELECT settings FROM orgs WHERE id=?', [u.org_id]);
      if (JSON.parse(org?.settings || '{}').requireMfa) return c.json({ error: 'Your organisation requires multi-factor authentication. Set it up in Settings → Security.', code: 'MFA_SETUP_REQUIRED' }, 403);
    }
    await next();
  };
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.org_id, disabled: !!u.disabled, lastLoginAt: u.last_login_at, mfaEnabled: !!u.mfa_enabled });
  const json = async (c) => { try { return await c.req.json(); } catch { throw httpError(400, 'Invalid JSON body'); } };
  const str = (v, max, name) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw httpError(400, `${name} is required (max ${max} chars)`); return v.trim(); };

  app.onError((err, c) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return c.json({ error: status >= 500 && !err.status ? 'Internal error' : err.message }, status);
  });

  async function startSession(c, user) {
    const db = c.get('db'); const tok = randomToken(32); const now = Date.now();
    await db.run('INSERT INTO sessions (token_hash,user_id,created_at,last_seen_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?)',
      [await sha256(tok), user.id, now, now, now + SESSION_MAX_MS, ip(c), (c.req.header('user-agent') || '').slice(0, 200)]);
    const secure = new URL(c.req.url).protocol === 'https:';
    setCookie(c, COOKIE, tok, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: SESSION_MAX_MS / 1000 });
  }

  // ---------------- health & setup ----------------
  app.get('/api/health', async (c) => {
    const n = await c.get('db').get('SELECT COUNT(*) n FROM users');
    return c.json({ ok: true, name: 'halyard', version: '1.5.0', needsSetup: !n?.n, encryption: !!c.get('env').ENCRYPTION_KEY });
  });

  // First admin + org. Only works while there are zero users; optionally gated by SETUP_TOKEN.
  app.post('/api/auth/bootstrap', async (c) => {
    const db = c.get('db'); const env = c.get('env');
    if ((await db.get('SELECT COUNT(*) n FROM users')).n > 0) return c.json({ error: 'Already set up' }, 409);
    const b = await json(c);
    if (env.SETUP_TOKEN && b.setupToken !== env.SETUP_TOKEN) return c.json({ error: 'Invalid setup token' }, 403);
    const email = str(b.email, 200, 'email').toLowerCase(); const name = str(b.name, 100, 'name'); const org = str(b.org || 'My organisation', 100, 'org');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Invalid email');
    const probs = passwordProblems(b.password); if (probs.length) throw httpError(400, `Password needs ${probs.join(', ')}`);
    const now = Date.now(); const orgId = uid('org_'); const userId = uid('usr_');
    const pw = await hashPassword(b.password, undefined, Number(env.PBKDF2_ITERATIONS) || 100000);
    await db.run('INSERT INTO orgs (id,name,created_at,settings) VALUES (?,?,?,?)', [orgId, org, now, JSON.stringify({ hourlyRate: null, currency: 'USD', valueBasis: 'accepted', prices: {} })]);
    await db.run('INSERT INTO users (id,org_id,email,name,pw_hash,pw_salt,pw_iter,role,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [userId, orgId, email, name, pw.hash, pw.salt, pw.iterations, 'admin', now]);
    const user = await db.get('SELECT * FROM users WHERE id=?', [userId]);
    c.set('user', user); await audit(c, 'org.bootstrap', orgId);
    await startSession(c, user);
    return c.json({ user: publicUser(user) }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const db = c.get('db');
    if (!(await rateLimit(c, `login:${ip(c)}`, Number(c.get('env').LOGIN_RATE_PER_15MIN) || 20, 15 * 60 * 1000))) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
    const b = await json(c); const email = String(b.email || '').toLowerCase().trim();
    const u = await db.get('SELECT * FROM users WHERE email=?', [email]);
    const now = Date.now();
    if (u && u.locked_until > now) { c.set('user', u); await audit(c, 'auth.login.locked', u.id); return c.json({ error: 'Account temporarily locked' }, 423); }
    const okPw = u && !u.disabled && (await verifyPassword(String(b.password || ''), u));
    if (!okPw) {
      if (u) {
        const f = u.failed_logins + 1;
        await db.run('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', [f >= LOCKOUT_THRESHOLD ? 0 : f, f >= LOCKOUT_THRESHOLD ? now + LOCKOUT_MS : 0, u.id]);
        c.set('user', u); await audit(c, 'auth.login.failed', u.id, { attempt: f });
      } else await audit(c, 'auth.login.failed', null, { email: email.slice(0, 100) });
      return c.json({ error: 'Invalid email or password' }, 401);
    }
    c.set('user', u);
    if (u.mfa_enabled) {
      const challenge = randomToken(24);
      await db.run('INSERT INTO mfa_challenges (token_hash,user_id,expires_at) VALUES (?,?,?)', [await sha256(challenge), u.id, now + 5 * 60 * 1000]);
      await audit(c, 'auth.login.mfa_challenge', u.id);
      return c.json({ mfaRequired: true, challenge });
    }
    await db.run('UPDATE users SET failed_logins=0, locked_until=0, last_login_at=? WHERE id=?', [now, u.id]);
    await audit(c, 'auth.login', u.id);
    await startSession(c, u);
    return c.json({ user: publicUser(u) });
  });

  // ---------------- MFA (TOTP + recovery codes) ----------------
  const mfaSecret = async (c, u, pending = false) => decrypt({ ciphertext: pending ? u.mfa_pending_ct : u.mfa_secret_ct, iv: pending ? u.mfa_pending_iv : u.mfa_secret_iv }, c.get('env').ENCRYPTION_KEY, `mfa:${u.id}`);
  // Checks a TOTP code (with replay protection) or a single-use recovery code. Returns 'totp' | 'recovery' | null.
  async function checkSecondFactor(c, u, code) {
    const db = c.get('db'); const raw = String(code || '').trim();
    if (/^\d{6}$/.test(raw)) {
      const ctr = await verifyTotp(await mfaSecret(c, u), raw, { lastCounter: u.mfa_last_counter });
      if (ctr != null) { await db.run('UPDATE users SET mfa_last_counter=? WHERE id=?', [ctr, u.id]); return 'totp'; }
      return null;
    }
    const norm = raw.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (norm.length !== 10) return null;
    const r = await db.run('UPDATE mfa_recovery SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL', [Date.now(), u.id, await sha256(norm)]);
    return r.changes ? 'recovery' : null;
  }
  async function issueRecoveryCodes(db, userId) {
    await db.run('DELETE FROM mfa_recovery WHERE user_id=?', [userId]);
    const codes = [];
    for (let i = 0; i < 10; i++) { const k = randomToken(5); codes.push(`${k.slice(0, 5)}-${k.slice(5)}`); await db.run('INSERT INTO mfa_recovery (user_id,code_hash) VALUES (?,?)', [userId, await sha256(k)]); }
    return codes;
  }

  app.post('/api/auth/mfa/verify', async (c) => {
    const db = c.get('db'); const b = await json(c); const now = Date.now();
    if (!(await rateLimit(c, `mfa:${ip(c)}`, 30, 15 * 60 * 1000))) return c.json({ error: 'Too many attempts. Try again later.' }, 429);
    const th = await sha256(String(b.challenge || ''));
    const ch = await db.get('SELECT * FROM mfa_challenges WHERE token_hash=?', [th]);
    if (!ch || ch.expires_at < now || ch.attempts >= 5) { if (ch) await db.run('DELETE FROM mfa_challenges WHERE token_hash=?', [th]); return c.json({ error: 'Sign-in expired. Enter your password again.' }, 401); }
    const u = await db.get('SELECT * FROM users WHERE id=? AND disabled=0', [ch.user_id]);
    if (!u || u.locked_until > now) return c.json({ error: 'Account temporarily locked' }, 423);
    c.set('user', u);
    const kind = await checkSecondFactor(c, u, b.code);
    if (!kind) {
      await db.run('UPDATE mfa_challenges SET attempts=attempts+1 WHERE token_hash=?', [th]);
      const f = u.failed_logins + 1;
      await db.run('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', [f >= LOCKOUT_THRESHOLD ? 0 : f, f >= LOCKOUT_THRESHOLD ? now + LOCKOUT_MS : 0, u.id]);
      await audit(c, 'auth.mfa.failed', u.id, { attempt: f });
      return c.json({ error: 'That code didn’t work. Check your authenticator app’s clock and try again.' }, 401);
    }
    await db.run('DELETE FROM mfa_challenges WHERE token_hash=?', [th]);
    await db.run('UPDATE users SET failed_logins=0, locked_until=0, last_login_at=? WHERE id=?', [now, u.id]);
    await audit(c, kind === 'recovery' ? 'auth.login.recovery_code' : 'auth.login', u.id, { mfa: kind });
    await startSession(c, u);
    const left = kind === 'recovery' ? (await db.get('SELECT COUNT(*) n FROM mfa_recovery WHERE user_id=? AND used_at IS NULL', [u.id])).n : undefined;
    return c.json({ user: publicUser(u), recoveryCodesLeft: left });
  });

  app.get('/api/auth/mfa/status', requireRole('viewer'), async (c) => {
    const u = c.get('user');
    const left = (await c.get('db').get('SELECT COUNT(*) n FROM mfa_recovery WHERE user_id=? AND used_at IS NULL', [u.id])).n;
    return c.json({ enabled: !!u.mfa_enabled, recoveryCodesLeft: left });
  });
  app.post('/api/auth/mfa/setup', requireRole('viewer'), async (c) => {
    const u = c.get('user'); if (u.mfa_enabled) return c.json({ error: 'MFA is already on' }, 409);
    if (c.get('authType') !== 'session') return c.json({ error: 'Set up MFA from a signed-in session' }, 403);
    const secret = newSecret(); const sealed = await encrypt(secret, c.get('env').ENCRYPTION_KEY, `mfa:${u.id}`);
    await c.get('db').run('UPDATE users SET mfa_pending_ct=?, mfa_pending_iv=? WHERE id=?', [sealed.ciphertext, sealed.iv, u.id]);
    return c.json({ secret, otpauth: otpauthUri(secret, u.email) });
  });
  app.post('/api/auth/mfa/enable', requireRole('viewer'), async (c) => {
    const u = c.get('user'); const db = c.get('db'); const b = await json(c);
    if (u.mfa_enabled) return c.json({ error: 'MFA is already on' }, 409);
    if (!u.mfa_pending_ct) return c.json({ error: 'Start setup first' }, 400);
    const ctr = await verifyTotp(await mfaSecret(c, u, true), b.code);
    if (ctr == null) return c.json({ error: 'That code didn’t match. Wait for the next code and try again.' }, 400);
    await db.run('UPDATE users SET mfa_enabled=1, mfa_secret_ct=mfa_pending_ct, mfa_secret_iv=mfa_pending_iv, mfa_pending_ct=NULL, mfa_pending_iv=NULL, mfa_last_counter=? WHERE id=?', [ctr, u.id]);
    const codes = await issueRecoveryCodes(db, u.id);
    await audit(c, 'auth.mfa.enabled', u.id);
    return c.json({ ok: true, recoveryCodes: codes });
  });
  app.post('/api/auth/mfa/recovery-codes', requireRole('viewer'), async (c) => {
    const u = c.get('user'); const b = await json(c);
    if (!u.mfa_enabled) return c.json({ error: 'MFA is off' }, 400);
    if ((await checkSecondFactor(c, u, b.code)) !== 'totp') return c.json({ error: 'Enter a current code from your authenticator app' }, 400);
    const codes = await issueRecoveryCodes(c.get('db'), u.id);
    await audit(c, 'auth.mfa.recovery_regenerated', u.id);
    return c.json({ recoveryCodes: codes });
  });
  app.post('/api/auth/mfa/disable', requireRole('viewer'), async (c) => {
    const u = c.get('user'); const db = c.get('db'); const b = await json(c);
    if (!u.mfa_enabled) return c.json({ error: 'MFA is off' }, 400);
    const org = JSON.parse((await db.get('SELECT settings FROM orgs WHERE id=?', [u.org_id])).settings);
    if (org.requireMfa) return c.json({ error: 'Your organisation requires MFA, so it can’t be turned off.' }, 403);
    if (!(await verifyPassword(String(b.password || ''), u)) || !(await checkSecondFactor(c, u, b.code))) return c.json({ error: 'Password or code is wrong' }, 400);
    await db.run('UPDATE users SET mfa_enabled=0, mfa_secret_ct=NULL, mfa_secret_iv=NULL, mfa_last_counter=0 WHERE id=?', [u.id]);
    await db.run('DELETE FROM mfa_recovery WHERE user_id=?', [u.id]);
    await audit(c, 'auth.mfa.disabled', u.id);
    return c.json({ ok: true });
  });
  app.post('/api/users/:id/mfa-reset', requireRole('admin'), async (c) => {
    const db = c.get('db'); const me = c.get('user');
    const u = await db.get('SELECT * FROM users WHERE id=? AND org_id=?', [c.req.param('id'), me.org_id]);
    if (!u) return c.json({ error: 'Not found' }, 404);
    if (u.id === me.id) return c.json({ error: 'Use Settings → Security to manage your own MFA' }, 400);
    await db.run('UPDATE users SET mfa_enabled=0, mfa_secret_ct=NULL, mfa_secret_iv=NULL, mfa_pending_ct=NULL, mfa_pending_iv=NULL, mfa_last_counter=0 WHERE id=?', [u.id]);
    await db.run('DELETE FROM mfa_recovery WHERE user_id=?', [u.id]);
    await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]);
    await audit(c, 'user.mfa.reset', u.id);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', async (c) => {
    const tok = getCookie(c, COOKIE);
    if (tok) await c.get('db').run('DELETE FROM sessions WHERE token_hash=?', [await sha256(tok)]);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', requireRole('viewer'), async (c) => {
    const u = c.get('user'); const org = await c.get('db').get('SELECT id,name,settings FROM orgs WHERE id=?', [u.org_id]);
    return c.json({ user: publicUser(u), org: { id: org.id, name: org.name, settings: JSON.parse(org.settings) } });
  });

  app.post('/api/auth/password', requireRole('viewer'), async (c) => {
    const b = await json(c); const u = c.get('user'); const db = c.get('db');
    if (!(await verifyPassword(String(b.current || ''), u))) return c.json({ error: 'Current password is wrong' }, 400);
    const probs = passwordProblems(b.next); if (probs.length) throw httpError(400, `Password needs ${probs.join(', ')}`);
    const pw = await hashPassword(b.next, undefined, Number(c.get('env').PBKDF2_ITERATIONS) || 100000);
    await db.run('UPDATE users SET pw_hash=?, pw_salt=?, pw_iter=? WHERE id=?', [pw.hash, pw.salt, pw.iterations, u.id]);
    await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]);
    await audit(c, 'auth.password.changed', u.id);
    return c.json({ ok: true, reauth: true });
  });

  // ---------------- users (admin) ----------------
  app.get('/api/users', requireRole('admin'), async (c) => {
    const rows = await c.get('db').all('SELECT * FROM users WHERE org_id=? ORDER BY created_at', [c.get('user').org_id]);
    return c.json({ users: rows.map(publicUser) });
  });
  app.post('/api/users', requireRole('admin'), async (c) => {
    const b = await json(c); const db = c.get('db'); const me = c.get('user');
    const email = str(b.email, 200, 'email').toLowerCase(); const name = str(b.name, 100, 'name');
    const role = ['admin', 'editor', 'viewer'].includes(b.role) ? b.role : 'viewer';
    if (await db.get('SELECT id FROM users WHERE email=?', [email])) return c.json({ error: 'Email already in use' }, 409);
    const temp = b.password || randomToken(9) + 'A1';
    const probs = passwordProblems(temp); if (probs.length) throw httpError(400, `Password needs ${probs.join(', ')}`);
    const pw = await hashPassword(temp, undefined, Number(c.get('env').PBKDF2_ITERATIONS) || 100000);
    const id = uid('usr_');
    await db.run('INSERT INTO users (id,org_id,email,name,pw_hash,pw_salt,pw_iter,role,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, me.org_id, email, name, pw.hash, pw.salt, pw.iterations, role, Date.now()]);
    await audit(c, 'user.created', id, { role });
    return c.json({ user: publicUser(await db.get('SELECT * FROM users WHERE id=?', [id])), temporaryPassword: b.password ? undefined : temp }, 201);
  });
  app.patch('/api/users/:id', requireRole('admin'), async (c) => {
    const b = await json(c); const db = c.get('db'); const me = c.get('user');
    const u = await db.get('SELECT * FROM users WHERE id=? AND org_id=?', [c.req.param('id'), me.org_id]);
    if (!u) return c.json({ error: 'Not found' }, 404);
    if (u.id === me.id && (b.role && b.role !== 'admin' || b.disabled)) return c.json({ error: 'You cannot demote or disable yourself' }, 400);
    if (b.role && ROLE_RANK[b.role]) await db.run('UPDATE users SET role=? WHERE id=?', [b.role, u.id]);
    if (typeof b.disabled === 'boolean') { await db.run('UPDATE users SET disabled=? WHERE id=?', [b.disabled ? 1 : 0, u.id]); if (b.disabled) await db.run('DELETE FROM sessions WHERE user_id=?', [u.id]); }
    await audit(c, 'user.updated', u.id, { role: b.role, disabled: b.disabled });
    return c.json({ user: publicUser(await db.get('SELECT * FROM users WHERE id=?', [u.id])) });
  });

  // ---------------- API keys ----------------
  app.get('/api/keys', requireRole('editor'), async (c) => c.json({ keys: await c.get('db').all('SELECT id,name,prefix,created_at,last_used_at,revoked FROM api_keys WHERE user_id=? ORDER BY created_at DESC', [c.get('user').id]) }));
  app.post('/api/keys', requireRole('editor'), async (c) => {
    if (c.get('authType') !== 'session') return c.json({ error: 'API keys can only be created from a signed-in session' }, 403);
    const b = await json(c); const key = 'hy_' + randomToken(24); const id = uid('key_');
    await c.get('db').run('INSERT INTO api_keys (id,user_id,name,key_hash,prefix,created_at) VALUES (?,?,?,?,?,?)', [id, c.get('user').id, str(b.name, 80, 'name'), await sha256(key), key.slice(0, 10), Date.now()]);
    await audit(c, 'apikey.created', id);
    return c.json({ id, key, note: 'Shown once. Store it securely.' }, 201);
  });
  app.delete('/api/keys/:id', requireRole('editor'), async (c) => {
    const r = await c.get('db').run('UPDATE api_keys SET revoked=1 WHERE id=? AND user_id=?', [c.req.param('id'), c.get('user').id]);
    if (!r.changes) return c.json({ error: 'Not found' }, 404);
    await audit(c, 'apikey.revoked', c.req.param('id')); return c.json({ ok: true });
  });

  // ---------------- workspace items ----------------
  const itemOut = (r) => ({ id: r.id, kind: r.kind, name: r.name, body: JSON.parse(r.body), sourceId: r.source_id, version: r.version, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
  function validateBody(kind, body) {
    if (!KINDS.includes(kind)) throw httpError(400, `kind must be one of ${KINDS.join(', ')}`);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'body must be an object');
    if (JSON.stringify(body).length > 400000) throw httpError(413, 'Item too large');
    if (kind === 'flow' && !Array.isArray(body.steps)) throw httpError(400, 'flow.body.steps must be an array');
    if (kind === 'agent' && typeof body.systemPrompt !== 'string') throw httpError(400, 'agent.body.systemPrompt is required');
    if (kind === 'mcp' && body.url) { const chk = checkOutboundUrl(body.url, { allowPrivate: true }); if (!chk.ok) throw httpError(400, chk.reason); }
  }

  app.get('/api/items', requireRole('viewer'), async (c) => {
    const kind = c.req.query('kind'); const db = c.get('db'); const org = c.get('user').org_id;
    const rows = kind ? await db.all('SELECT * FROM items WHERE org_id=? AND kind=? AND deleted=0 ORDER BY updated_at DESC', [org, kind])
      : await db.all('SELECT * FROM items WHERE org_id=? AND deleted=0 ORDER BY updated_at DESC', [org]);
    return c.json({ items: rows.map(itemOut) });
  });
  app.get('/api/items/:id', requireRole('viewer'), async (c) => {
    const r = await c.get('db').get('SELECT * FROM items WHERE id=? AND org_id=? AND deleted=0', [c.req.param('id'), c.get('user').org_id]);
    return r ? c.json({ item: itemOut(r) }) : c.json({ error: 'Not found' }, 404);
  });
  app.post('/api/items', requireRole('editor'), async (c) => {
    const b = await json(c); const db = c.get('db'); const u = c.get('user');
    const name = str(b.name, 200, 'name'); validateBody(b.kind, b.body);
    const id = uid(b.kind.slice(0, 3) + '_'); const now = Date.now(); const body = JSON.stringify(b.body);
    await db.run('INSERT INTO items (id,org_id,kind,name,body,source_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, u.org_id, b.kind, name, body, b.sourceId ? String(b.sourceId).slice(0, 200) : null, u.id, now, now]);
    await db.run('INSERT INTO item_versions (item_id,version,body,changed_by,changed_at) VALUES (?,?,?,?,?)', [id, 1, body, u.id, now]);
    await audit(c, b.sourceId ? 'item.copied' : 'item.created', id, { kind: b.kind, sourceId: b.sourceId || null });
    return c.json({ item: itemOut(await db.get('SELECT * FROM items WHERE id=?', [id])) }, 201);
  });
  app.put('/api/items/:id', requireRole('editor'), async (c) => {
    const b = await json(c); const db = c.get('db'); const u = c.get('user');
    const cur = await db.get('SELECT * FROM items WHERE id=? AND org_id=? AND deleted=0', [c.req.param('id'), u.org_id]);
    if (!cur) return c.json({ error: 'Not found' }, 404);
    if (b.version != null && Number(b.version) !== cur.version) return c.json({ error: 'Version conflict — reload and reapply your change', current: cur.version }, 409);
    validateBody(cur.kind, b.body); const name = b.name ? str(b.name, 200, 'name') : cur.name;
    const v = cur.version + 1; const now = Date.now(); const body = JSON.stringify(b.body);
    await db.run('UPDATE items SET name=?, body=?, version=?, updated_at=? WHERE id=?', [name, body, v, now, cur.id]);
    await db.run('INSERT INTO item_versions (item_id,version,body,changed_by,changed_at) VALUES (?,?,?,?,?)', [cur.id, v, body, u.id, now]);
    await audit(c, 'item.updated', cur.id, { version: v });
    return c.json({ item: itemOut(await db.get('SELECT * FROM items WHERE id=?', [cur.id])) });
  });
  app.delete('/api/items/:id', requireRole('editor'), async (c) => {
    const r = await c.get('db').run('UPDATE items SET deleted=1, updated_at=? WHERE id=? AND org_id=? AND deleted=0', [Date.now(), c.req.param('id'), c.get('user').org_id]);
    if (!r.changes) return c.json({ error: 'Not found' }, 404);
    await audit(c, 'item.deleted', c.req.param('id')); return c.json({ ok: true });
  });
  app.get('/api/items/:id/versions', requireRole('viewer'), async (c) => {
    const it = await c.get('db').get('SELECT id FROM items WHERE id=? AND org_id=?', [c.req.param('id'), c.get('user').org_id]);
    if (!it) return c.json({ error: 'Not found' }, 404);
    const rows = await c.get('db').all('SELECT version, changed_by, changed_at, body FROM item_versions WHERE item_id=? ORDER BY version DESC', [it.id]);
    return c.json({ versions: rows.map((r) => ({ ...r, body: JSON.parse(r.body) })) });
  });

  // ---------------- provider credentials ----------------
  app.get('/api/secrets', requireRole('viewer'), async (c) => c.json({ providers: Object.keys(PROVIDERS), configured: await c.get('db').all('SELECT provider, base_url, created_at FROM secrets WHERE org_id=?', [c.get('user').org_id]) }));
  app.put('/api/secrets/:provider', requireRole('admin'), async (c) => {
    const provider = c.req.param('provider'); if (!PROVIDERS[provider]) return c.json({ error: 'Unknown provider' }, 400);
    const b = await json(c); const u = c.get('user'); const env = c.get('env');
    const apiKey = str(b.apiKey, 500, 'apiKey');
    let base = null;
    if (provider === 'custom') { const chk = checkOutboundUrl(str(b.baseUrl, 300, 'baseUrl'), { allowPrivate: env.ALLOW_PRIVATE_NETWORK === 'true' }); if (!chk.ok) throw httpError(400, chk.reason); base = chk.url.toString(); }
    const sealed = await encrypt(apiKey, env.ENCRYPTION_KEY, `${u.org_id}:${provider}`);
    await c.get('db').run('INSERT OR REPLACE INTO secrets (id,org_id,provider,ciphertext,iv,base_url,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', [uid('sec_'), u.org_id, provider, sealed.ciphertext, sealed.iv, base, u.id, Date.now()]);
    await audit(c, 'secret.set', provider);
    return c.json({ ok: true });
  });
  app.delete('/api/secrets/:provider', requireRole('admin'), async (c) => {
    await c.get('db').run('DELETE FROM secrets WHERE org_id=? AND provider=?', [c.get('user').org_id, c.req.param('provider')]);
    await audit(c, 'secret.deleted', c.req.param('provider')); return c.json({ ok: true });
  });

  // ---------------- LLM proxy (frontier) ----------------
  app.post('/api/llm/:provider', requireRole('editor'), async (c) => {
    const provider = c.req.param('provider'); const u = c.get('user'); const env = c.get('env');
    if (!(await rateLimit(c, `llm:${u.id}`, Number(env.LLM_RATE_PER_MIN) || 60, 60000))) return c.json({ error: 'Rate limit reached' }, 429);
    const s = await c.get('db').get('SELECT * FROM secrets WHERE org_id=? AND provider=?', [u.org_id, provider]);
    if (!s) return c.json({ error: `No API key configured for ${provider}. An admin can add one in Settings → Providers.` }, 400);
    const b = await json(c); str(b.model, 200, 'model');
    const key = await decrypt(s, env.ENCRYPTION_KEY, `${u.org_id}:${provider}`);
    const t0 = Date.now();
    const out = await callProvider(provider, key, s.base_url, b, doFetch);
    return c.json({ ...out, latencyMs: Date.now() - t0 });
  });

  // ---------------- MCP proxy (Streamable HTTP JSON-RPC) ----------------
  app.post('/api/mcp/call', requireRole('editor'), async (c) => {
    const b = await json(c); const env = c.get('env'); const u = c.get('user');
    if (!(await rateLimit(c, `mcp:${u.id}`, 120, 60000))) return c.json({ error: 'Rate limit reached' }, 429);
    const chk = checkOutboundUrl(String(b.url || ''), { allowPrivate: env.ALLOW_PRIVATE_NETWORK === 'true' });
    if (!chk.ok) return c.json({ error: chk.reason }, 400);
    if (!['initialize', 'tools/list', 'tools/call', 'resources/list', 'prompts/list', 'notifications/initialized'].includes(b.method)) return c.json({ error: 'Method not allowed' }, 400);
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (b.sessionId) headers['mcp-session-id'] = String(b.sessionId);
    if (b.authorization) headers.authorization = String(b.authorization).slice(0, 2000);
    const payload = b.method.startsWith('notifications/') ? { jsonrpc: '2.0', method: b.method } : { jsonrpc: '2.0', id: Date.now(), method: b.method, params: b.params || {} };
    const res = await (doFetch)(chk.url.toString(), { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) return c.json({ error: 'MCP server tried to redirect; refused' }, 502);
    const text = await res.text();
    let data = null;
    if ((res.headers.get('content-type') || '').includes('text/event-stream')) {
      for (const line of text.split('\n')) if (line.startsWith('data:')) { try { const j = JSON.parse(line.slice(5)); if (j.id != null || j.result || j.error) data = j; } catch { /* skip */ } }
    } else if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (b.method === 'tools/call') await audit(c, 'mcp.tool.call', chk.url.host, { tool: b.params?.name });
    return c.json({ status: res.status, sessionId: res.headers.get('mcp-session-id'), response: data }, res.ok || res.status === 202 ? 200 : 502);
  });

  // ---------------- runs & KPIs ----------------
  app.post('/api/runs', requireRole('editor'), async (c) => {
    const b = await json(c); const u = c.get('user'); const db = c.get('db');
    const org = await db.get('SELECT settings FROM orgs WHERE id=?', [u.org_id]); const settings = JSON.parse(org.settings);
    const n = (v, max = 1e9) => Math.max(0, Math.min(Number(v) || 0, max));
    const status = ['succeeded', 'failed', 'rejected', 'cancelled'].includes(b.status) ? b.status : 'failed';
    const tokensIn = n(b.tokensIn), tokensOut = n(b.tokensOut);
    const cost = b.costUsd != null ? n(b.costUsd, 1e5) : priceRun({ provider: b.provider, model: b.model, tokensIn, tokensOut }, settings.prices || {});
    const id = uid('run_');
    await db.run(`INSERT INTO runs (id,org_id,user_id,target_kind,target_id,target_name,status,provider,model,steps,tokens_in,tokens_out,cost_usd,latency_ms,outputs,output_chars,minutes_saved_est,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, u.org_id, u.id, b.targetKind === 'flow' ? 'flow' : 'agent', str(b.targetId, 200, 'targetId'), str(b.targetName, 200, 'targetName'), status,
      String(b.provider || '').slice(0, 40), String(b.model || '').slice(0, 120), n(b.steps, 1000), tokensIn, tokensOut, cost, n(b.latencyMs, 36e5), n(b.outputs, 1000), n(b.outputChars, 1e8), status === 'succeeded' ? n(b.minutesSaved, 100000) : 0, Date.now()]);
    return c.json({ id, costUsd: cost }, 201);
  });
  app.patch('/api/runs/:id', requireRole('editor'), async (c) => {
    const b = await json(c); const u = c.get('user');
    const accepted = b.accepted === true ? 1 : b.accepted === false ? 0 : null;
    const rating = b.rating != null ? Math.max(1, Math.min(5, Math.round(Number(b.rating)))) : null;
    const r = await c.get('db').run('UPDATE runs SET accepted=COALESCE(?,accepted), rating=COALESCE(?,rating) WHERE id=? AND org_id=?', [accepted, rating, c.req.param('id'), u.org_id]);
    return r.changes ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });
  app.get('/api/runs', requireRole('viewer'), async (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
    return c.json({ runs: await c.get('db').all('SELECT r.*, u.name user_name FROM runs r JOIN users u ON u.id=r.user_id WHERE r.org_id=? ORDER BY r.created_at DESC LIMIT ?', [c.get('user').org_id, limit]) });
  });
  app.get('/api/kpis', requireRole('viewer'), async (c) => {
    const days = Math.min(Math.max(Number(c.req.query('days')) || 30, 1), 365); const u = c.get('user'); const db = c.get('db');
    const since = Date.now() - 2 * days * 86400000;
    const runs = await db.all('SELECT * FROM runs WHERE org_id=? AND created_at>=?', [u.org_id, since]);
    const s = JSON.parse((await db.get('SELECT settings FROM orgs WHERE id=?', [u.org_id])).settings);
    const agents = (await db.get("SELECT COUNT(*) n FROM items WHERE org_id=? AND kind='agent' AND deleted=0", [u.org_id])).n;
    return c.json(computeKpis(runs, { valueBasis: s.valueBasis || 'accepted', hourlyRate: s.hourlyRate, currency: s.currency, days, workspaceAgents: agents, prices: s.prices || {} }));
  });
  app.get('/api/kpis.csv', requireRole('viewer'), async (c) => {
    const rows = await c.get('db').all('SELECT created_at,target_kind,target_name,status,provider,model,tokens_in,tokens_out,cost_usd,latency_ms,outputs,minutes_saved_est,accepted,rating FROM runs WHERE org_id=? ORDER BY created_at DESC LIMIT 50000', [c.get('user').org_id]);
    const cols = ['created_at', 'target_kind', 'target_name', 'status', 'provider', 'model', 'tokens_in', 'tokens_out', 'cost_usd', 'latency_ms', 'outputs', 'minutes_saved_est', 'accepted', 'rating'];
    const esc = (v) => { const s = v == null ? '' : String(v); return /^[=+\-@]/.test(s) ? `'${s}` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => esc(k === 'created_at' ? new Date(r[k]).toISOString() : r[k])).join(','))].join('\n');
    return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="halyard-runs.csv"' });
  });

  // ---------------- org settings ----------------
  app.put('/api/org/settings', requireRole('admin'), async (c) => {
    const b = await json(c); const u = c.get('user'); const db = c.get('db');
    const s = JSON.parse((await db.get('SELECT settings FROM orgs WHERE id=?', [u.org_id])).settings);
    if (typeof b.requireMfa === 'boolean') {
      if (b.requireMfa && !u.mfa_enabled) return c.json({ error: 'Turn on MFA for your own account before requiring it for everyone.' }, 400);
      s.requireMfa = b.requireMfa;
    }
    if ('hourlyRate' in b) s.hourlyRate = b.hourlyRate == null || b.hourlyRate === '' ? null : Math.max(0, Math.min(Number(b.hourlyRate) || 0, 10000));
    if (['accepted', 'not-rejected'].includes(b.valueBasis)) s.valueBasis = b.valueBasis;
    if (b.currency) s.currency = String(b.currency).slice(0, 3).toUpperCase();
    if (b.prices && typeof b.prices === 'object') {
      s.prices = {};
      for (const [k, v] of Object.entries(b.prices).slice(0, 200)) s.prices[String(k).slice(0, 160)] = { in: Math.max(0, Number(v.in) || 0), out: Math.max(0, Number(v.out) || 0) };
    }
    await db.run('UPDATE orgs SET settings=? WHERE id=?', [JSON.stringify(s), u.org_id]);
    await audit(c, 'org.settings.updated', u.org_id);
    return c.json({ settings: s });
  });

  // ---------------- audit & data export (admin) ----------------
  app.get('/api/audit', requireRole('admin'), async (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 200, 1000);
    return c.json({ entries: await c.get('db').all('SELECT seq,user_id,action,target,detail,ip,at FROM audit_log WHERE org_id=? ORDER BY seq DESC LIMIT ?', [c.get('user').org_id, limit]) });
  });
  app.get('/api/audit/verify', requireRole('admin'), async (c) => {
    const rows = await c.get('db').all('SELECT * FROM audit_log ORDER BY seq');
    let prev = 'GENESIS';
    for (const r of rows) {
      const entry = { org: r.org_id, user: r.user_id, action: r.action, target: r.target, detail: r.detail, ip: r.ip, at: r.at };
      if (r.prev_hash !== prev || (await sha256(prev + JSON.stringify(entry))) !== r.hash) return c.json({ ok: false, brokenAt: r.seq, checked: rows.length });
      prev = r.hash;
    }
    return c.json({ ok: true, checked: rows.length });
  });
  app.get('/api/export', requireRole('admin'), async (c) => {
    const db = c.get('db'); const org = c.get('user').org_id;
    await audit(c, 'org.exported', org);
    return c.json({ exportedAt: new Date().toISOString(),
      items: (await db.all('SELECT * FROM items WHERE org_id=? AND deleted=0', [org])).map(itemOut),
      runs: await db.all('SELECT * FROM runs WHERE org_id=?', [org]),
      users: (await db.all('SELECT * FROM users WHERE org_id=?', [org])).map(publicUser) });
  });

  // Housekeeping: expire sessions/rate limits. Called by the cron trigger (Workers) or interval (Node).
  app.housekeep = async (db) => { const now = Date.now(); await db.run('DELETE FROM sessions WHERE expires_at<? OR last_seen_at<?', [now, now - SESSION_IDLE_MS]); await db.run('DELETE FROM mfa_challenges WHERE expires_at<?', [now]); await db.run('DELETE FROM rate_limits WHERE reset_at<?', [now]); };

  mountFactory(app, { requireRole, json, str, audit, doFetch });
  app.factoryTick = (db, env) => factoryTick(db, env, { fetchImpl: doFetch });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}
