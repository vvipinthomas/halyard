// MFA controls — mapped in docs/security/soc2-control-matrix.md (CC6.1 MFA)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, bootstrapped, ADMIN } from '../helpers/harness.mjs';
import { totp, counterAt, hotp } from '../../src/lib/totp.js';

async function enroll(c) {
  const s = await c.post('/api/auth/mfa/setup', {}); assert.equal(s.status, 200); assert.match(s.json.otpauth, /^otpauth:\/\/totp\/Halyard:/);
  const e = await c.post('/api/auth/mfa/enable', { code: await totp(s.json.secret) }); assert.equal(e.status, 200, JSON.stringify(e.json));
  assert.equal(e.json.recoveryCodes.length, 10);
  return { secret: s.json.secret, codes: e.json.recoveryCodes };
}
const nextCode = (secret) => hotp(secret, counterAt() + 1);

test('[MFA-01] enrolment needs a valid code; secret is encrypted at rest', async () => {
  const { admin, sqlite } = await bootstrapped();
  const s = await admin.post('/api/auth/mfa/setup', {});
  assert.equal((await admin.post('/api/auth/mfa/enable', { code: '000000' })).status, 400);
  await admin.post('/api/auth/mfa/enable', { code: await totp(s.json.secret) });
  const row = sqlite.prepare('SELECT mfa_secret_ct, mfa_enabled FROM users').get();
  assert.equal(row.mfa_enabled, 1); assert.ok(!row.mfa_secret_ct.includes(s.json.secret));
  assert.equal((await admin.get('/api/auth/mfa/status')).json.enabled, true);
});

test('[MFA-02] login with MFA needs a second step; no session before it', async () => {
  const { app, admin } = await bootstrapped(); const { secret } = await enroll(admin);
  const c = client(app, { ip: '10.1.0.1' });
  const r = await c.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  assert.equal(r.json.mfaRequired, true); assert.ok(r.json.challenge); assert.equal(c.cookie, '');
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await c.post('/api/auth/mfa/verify', { challenge: r.json.challenge, code: '123456' })).status, 401);
  const ok = await c.post('/api/auth/mfa/verify', { challenge: r.json.challenge, code: await nextCode(secret) });
  assert.equal(ok.status, 200); assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('[MFA-03] a TOTP code cannot be replayed', async () => {
  const { app, admin } = await bootstrapped(); const { secret } = await enroll(admin);
  const code = await nextCode(secret);
  const a = client(app, { ip: '10.1.0.2' }); const ra = await a.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  assert.equal((await a.post('/api/auth/mfa/verify', { challenge: ra.json.challenge, code })).status, 200);
  const b = client(app, { ip: '10.1.0.3' }); const rb = await b.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  assert.equal((await b.post('/api/auth/mfa/verify', { challenge: rb.json.challenge, code })).status, 401);
});

test('[MFA-04] recovery codes work once each', async () => {
  const { app, admin } = await bootstrapped(); const { codes } = await enroll(admin);
  const login = async () => { const c = client(app, { ip: '10.1.0.4' }); return [c, (await c.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).json.challenge]; };
  let [c, ch] = await login(); const r = await c.post('/api/auth/mfa/verify', { challenge: ch, code: codes[0].toUpperCase() });
  assert.equal(r.status, 200); assert.equal(r.json.recoveryCodesLeft, 9);
  [c, ch] = await login(); assert.equal((await c.post('/api/auth/mfa/verify', { challenge: ch, code: codes[0] })).status, 401);
});

test('[MFA-05] challenges expire after 5 wrong codes and failures count toward lockout', async () => {
  const { app, admin } = await bootstrapped(); const { secret } = await enroll(admin);
  const c = client(app, { ip: '10.1.0.5' }); const ch = (await c.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).json.challenge;
  for (let i = 0; i < 5; i++) await c.post('/api/auth/mfa/verify', { challenge: ch, code: '000000' });
  const r = await c.post('/api/auth/mfa/verify', { challenge: ch, code: await nextCode(secret) });
  assert.ok([401, 423].includes(r.status));
  const audit = (await admin.get('/api/audit')).json.entries.map((e) => e.action);
  assert.ok(audit.includes('auth.mfa.failed'));
});

test('[MFA-06] org can require MFA; admin must enrol first; un-enrolled users are confined to setup', async () => {
  const { app, admin } = await bootstrapped();
  assert.equal((await admin.put('/api/org/settings', { requireMfa: true })).status, 400);
  await enroll(admin);
  assert.equal((await admin.put('/api/org/settings', { requireMfa: true })).status, 200);
  await admin.post('/api/users', { name: 'Ed', email: 'ed@x.y', role: 'editor', password: 'editor-pass-123' });
  const ed = client(app, { ip: '10.1.0.6' }); await ed.post('/api/auth/login', { email: 'ed@x.y', password: 'editor-pass-123' });
  const blocked = await ed.get('/api/items'); assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'MFA_SETUP_REQUIRED');
  assert.equal((await ed.get('/api/auth/me')).status, 200);
  await enroll(ed);
  assert.equal((await ed.get('/api/items')).status, 200);
  assert.equal((await admin.post('/api/auth/mfa/disable', { password: ADMIN.password, code: '000000' })).status, 403, 'cannot disable while required');
});

test('[MFA-07] disabling needs password + code; admin reset clears MFA and sessions', async () => {
  const { app, admin } = await bootstrapped(); const { secret } = await enroll(admin);
  assert.equal((await admin.post('/api/auth/mfa/disable', { password: ADMIN.password, code: '000000' })).status, 400);
  assert.equal((await admin.post('/api/auth/mfa/disable', { password: ADMIN.password, code: await nextCode(secret) })).status, 200);
  const u = (await admin.post('/api/users', { name: 'Vi', email: 'vi@x.y', role: 'viewer', password: 'viewer-pass-123' })).json.user;
  const vi = client(app, { ip: '10.1.0.7' }); await vi.post('/api/auth/login', { email: 'vi@x.y', password: 'viewer-pass-123' }); await enroll(vi);
  assert.equal((await admin.post(`/api/users/${u.id}/mfa-reset`, {})).status, 200);
  assert.equal((await vi.get('/api/auth/me')).status, 401, 'sessions revoked');
  assert.ok((await admin.get('/api/audit')).json.entries.some((e) => e.action === 'user.mfa.reset'));
});
