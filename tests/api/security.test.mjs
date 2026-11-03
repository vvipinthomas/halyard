// Security control tests — each maps to a control in docs/security/soc2-control-matrix.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer, client, bootstrapped, ADMIN } from '../helpers/harness.mjs';

test('[SEC-01] unauthenticated access is denied on every protected route', async () => {
  const { app } = await bootstrapped(); const anon = client(app);
  for (const [m, p] of [['get', '/api/items'], ['get', '/api/kpis'], ['get', '/api/runs'], ['get', '/api/users'], ['get', '/api/audit'], ['get', '/api/export'], ['get', '/api/secrets'], ['post', '/api/items'], ['post', '/api/llm/openai'], ['post', '/api/mcp/call']])
    assert.equal((await anon[m](p, m === 'post' ? {} : undefined)).status, 401, `${m} ${p}`);
});

test('[SEC-02] CSRF: cookie-authenticated mutations require the X-Halyard header', async () => {
  const { app, admin } = await bootstrapped();
  const res = await app.request('/api/items', { method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'skill', name: 'x', body: {} }) });
  assert.equal(res.status, 403);
});

test('[SEC-03] account lockout after 5 failed attempts, and audit of failures', async () => {
  const { app, admin } = await bootstrapped(); const c = client(app, { ip: '10.9.9.9' });
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: ADMIN.email, password: 'nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password })).status, 423, 'locked even with right password');
  const audit = (await admin.get('/api/audit')).json.entries.map((e) => e.action);
  assert.ok(audit.includes('auth.login.failed') && audit.includes('auth.login.locked'));
});

test('[SEC-04] login rate limiting per IP', async () => {
  const { app } = await bootstrapped(); const c = client(app, { ip: '10.7.7.7' });
  let last; for (let i = 0; i < 21; i++) last = await c.post('/api/auth/login', { email: `nobody${i}@x.y`, password: 'x' });
  assert.equal(last.status, 429);
});

test('[SEC-05] session idle timeout is enforced server-side', async () => {
  const { app, admin, sqlite } = await bootstrapped();
  sqlite.prepare('UPDATE sessions SET last_seen_at = last_seen_at - ?').run(31 * 60 * 1000);
  assert.equal((await admin.get('/api/auth/me')).status, 401);
});

test('[SEC-06] password change revokes all sessions', async () => {
  const { app, admin } = await bootstrapped();
  const other = client(app, { ip: '10.0.0.2' }); await other.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  assert.equal((await admin.post('/api/auth/password', { current: ADMIN.password, next: 'another-secret-99' })).status, 200);
  assert.equal((await other.get('/api/auth/me')).status, 401);
});

test('[SEC-07] tenant isolation: one org cannot read or change another org’s items', async () => {
  const { app, admin, sqlite } = await bootstrapped();
  const item = (await admin.post('/api/items', { kind: 'skill', name: 'secret skill', body: { description: 'x' } })).json.item;
  // second org created directly (bootstrap is single-shot by design)
  const { hashPassword } = await import('../../src/lib/crypto.js'); const pw = await hashPassword('other-org-pass-1', undefined, 1000);
  sqlite.prepare("INSERT INTO orgs (id,name,created_at,settings) VALUES ('org_b','B',0,'{}')").run();
  sqlite.prepare("INSERT INTO users (id,org_id,email,name,pw_hash,pw_salt,pw_iter,role,created_at) VALUES ('usr_b','org_b','b@b.b','B',?,?,?,'admin',0)").run(pw.hash, pw.salt, pw.iterations);
  const b = client(app, { ip: '10.0.0.3' }); await b.post('/api/auth/login', { email: 'b@b.b', password: 'other-org-pass-1' });
  assert.equal((await b.get(`/api/items/${item.id}`)).status, 404);
  assert.equal((await b.get('/api/items')).json.items.length, 0);
  assert.equal((await b.put(`/api/items/${item.id}`, { body: {} })).status, 404);
  assert.equal((await b.del(`/api/items/${item.id}`)).status, 404);
  const adminId = (await admin.get('/api/auth/me')).json.user.id;
  assert.equal((await b.get('/api/audit')).json.entries.every((e) => e.user_id !== adminId), true);
});

test('[SEC-08] audit log is append-only and hash-chain verification detects tampering', async () => {
  const { admin, sqlite } = await bootstrapped();
  await admin.post('/api/items', { kind: 'skill', name: 's', body: {} });
  assert.equal((await admin.get('/api/audit/verify')).json.ok, true);
  assert.throws(() => sqlite.prepare('UPDATE audit_log SET action = ?').run('x'), /append-only/);
  assert.throws(() => sqlite.prepare('DELETE FROM audit_log').run(), /append-only/);
  sqlite.exec('DROP TRIGGER audit_no_update'); sqlite.prepare("UPDATE audit_log SET target='forged' WHERE seq=2").run();
  const v = (await admin.get('/api/audit/verify')).json; assert.equal(v.ok, false); assert.equal(v.brokenAt, 2);
});

test('[SEC-09] security headers are set on API responses', async () => {
  const { admin } = await bootstrapped(); const r = await admin.get('/api/health');
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security']) assert.ok(r.headers.get(h), h);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('[SEC-10] request body size is limited', async () => {
  const { admin } = await bootstrapped();
  const r = await admin.post('/api/items', { kind: 'skill', name: 'big', body: { body: 'x'.repeat(1_100_000) } });
  assert.equal(r.status, 413);
});

test('[SEC-11] weak passwords are rejected at setup and user creation', async () => {
  const { app } = makeServer();
  assert.equal((await client(app).post('/api/auth/bootstrap', { ...ADMIN, password: 'short' })).status, 400);
  const { admin } = await bootstrapped();
  assert.equal((await admin.post('/api/users', { name: 'n', email: 'n@n.n', password: 'abc' })).status, 400);
});

test('[SEC-12] secrets: only admins set provider keys; custom endpoints are SSRF-checked', async () => {
  const { app, admin } = await bootstrapped();
  await admin.post('/api/users', { name: 'Ed', email: 'ed@x.y', role: 'editor', password: 'editor-pass-123' });
  const ed = client(app, { ip: '10.0.0.4' }); await ed.post('/api/auth/login', { email: 'ed@x.y', password: 'editor-pass-123' });
  assert.equal((await ed.put('/api/secrets/openai', { apiKey: 'k' })).status, 403);
  assert.equal((await admin.put('/api/secrets/custom', { apiKey: 'k', baseUrl: 'http://10.0.0.1/v1' })).status, 400);
  assert.equal((await admin.put('/api/secrets/custom', { apiKey: 'k', baseUrl: 'https://gateway.example.com/v1' })).status, 200);
});

test('[SEC-13] CSV export neutralises spreadsheet formula injection', async () => {
  const { admin } = await bootstrapped();
  await admin.post('/api/runs', { targetKind: 'agent', targetId: 'x', targetName: '=HYPERLINK("http://evil")', status: 'succeeded', provider: 'ollama', model: 'm' });
  const csv = (await admin.get('/api/kpis.csv')).text;
  assert.ok(!/,=HYPERLINK/.test(csv) && csv.includes("'=HYPERLINK"));
});

test('[SEC-14] errors do not leak internals', async () => {
  const { admin } = await bootstrapped();
  const r = await admin.post('/api/items', '{not json');
  assert.equal(r.status, 400); assert.ok(!/at .*\.js/.test(r.text));
});

test('[SEC-15] data export is admin-only and audited', async () => {
  const { app, admin } = await bootstrapped();
  await admin.post('/api/users', { name: 'Ed', email: 'ed@x.y', role: 'editor', password: 'editor-pass-123' });
  const ed = client(app, { ip: '10.0.0.5' }); await ed.post('/api/auth/login', { email: 'ed@x.y', password: 'editor-pass-123' });
  assert.equal((await ed.get('/api/export')).status, 403);
  const ex = await admin.get('/api/export'); assert.equal(ex.status, 200); assert.ok(ex.json.users.every((u) => !('pw_hash' in u)));
  assert.ok((await admin.get('/api/audit')).json.entries.some((e) => e.action === 'org.exported'));
});

test('[SEC-16] concurrent audit writes never fork the hash chain', async () => {
  const { appendAudit } = await import('../../src/lib/audit.js');
  const { admin, db } = await bootstrapped();
  await Promise.all(Array.from({ length: 40 }, (_, i) => appendAudit(db, { action: 'test.concurrent', target: String(i) })));
  const v = (await admin.get('/api/audit/verify')).json;
  assert.equal(v.ok, true, JSON.stringify(v));
});

test('[SEC-17] parallel login attempts cannot exceed the per-IP rate limit', async () => {
  const { app } = await bootstrapped({ LOGIN_RATE_PER_15MIN: '5' }); const c = client(app, { ip: '10.8.8.8' });
  const res = await Promise.all(Array.from({ length: 20 }, (_, i) => c.post('/api/auth/login', { email: `nobody${i}@x.y`, password: 'x' })));
  assert.equal(res.filter((r) => r.status !== 429).length, 5);
});

test('[SEC-18] only one factory tick runs at a time', async () => {
  const { tick } = await import('../../src/factory/loop.js');
  const { db, env } = await bootstrapped();
  const out = await Promise.all(Array.from({ length: 5 }, () => tick(db, env)));
  assert.equal(out.filter((o) => !o.skipped).length, 1);
  assert.ok(!(await tick(db, env)).skipped, 'lock is released after the tick');
});
