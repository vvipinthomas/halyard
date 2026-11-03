// Dark factory: full guarded-autonomy loop in the sandbox, governance controls, webhooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, bootstrapped } from '../helpers/harness.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

async function setup() {
  const s = await bootstrapped();
  const r = await s.admin.post('/api/factory/products', { name: 'Demo Shop', config: { mode: 'sandbox' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { ...s, pid: r.json.product.id, hook: r.json.webhookSecret };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(c, pid, until) {
  for (let i = 0; i < 6; i++) {
    await c.post(`/api/factory/products/${pid}/tick`, {});
    const items = (await c.get(`/api/factory/items?product=${pid}`)).json.items;
    if (until(items)) return items;
    await sleep(30);
  }
  return (await c.get(`/api/factory/items?product=${pid}`)).json.items;
}

test('[FAC-01] low-risk incident is fixed, merged, deployed, verified and resolved with no humans', async () => {
  const { admin, pid } = await setup();
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'null-price' });
  const items = await settle(admin, pid, (xs) => xs[0]?.status === 'done');
  assert.equal(items[0].status, 'done'); assert.ok(items[0].risk <= 40, `risk ${items[0].risk}`);
  const d = (await admin.get(`/api/factory/items/${items[0].id}`)).json;
  const kinds = d.events.map((e) => e.kind);
  for (const k of ['triaged', 'diagnosed', 'pr_opened', 'reviewed', 'ci', 'merged', 'deployed', 'resolved']) assert.ok(kinds.includes(k), `missing ${k}: ${kinds}`);
  assert.match(d.item.data.patch.diff, /item\?\.price/);
  const audit = (await admin.get('/api/audit')).json.entries.map((e) => e.action);
  assert.ok(audit.includes('factory.merged') && audit.includes('factory.pr_opened') && audit.includes('factory.resolved'));
  assert.equal((await admin.get('/api/audit/verify')).json.ok, true, 'audit chain intact after unattended writes');
  const m = (await admin.get('/api/factory/metrics')).json;
  assert.equal(m.autonomy.resolvedWithoutHumans, 1); assert.equal(m.dora.changeFailureRate, 0); assert.ok(m.customers.impactResolved > 0);
});

test('[FAC-02] change to a sensitive path waits for a human; viewers cannot approve; editor approval releases it', async () => {
  const { app, admin, pid } = await setup();
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'auth-timeout' });
  let items = await settle(admin, pid, (xs) => xs[0]?.status === 'awaiting_approval');
  assert.equal(items[0].status, 'awaiting_approval'); assert.ok(items[0].risk > 40);
  const d = (await admin.get(`/api/factory/items/${items[0].id}`)).json;
  assert.ok(d.item.data.risk.factors.some((f) => /sensitive path/.test(f.why)));
  await admin.post('/api/users', { name: 'Vee', email: 'v@x.y', role: 'viewer', password: 'viewer-pass-123' });
  const v = client(app, { ip: '10.4.0.1' }); await v.post('/api/auth/login', { email: 'v@x.y', password: 'viewer-pass-123' });
  assert.equal((await v.post(`/api/factory/items/${items[0].id}/approve`, {})).status, 403);
  assert.equal((await admin.post(`/api/factory/items/${items[0].id}/approve`, {})).status, 200);
  items = await settle(admin, pid, (xs) => xs[0]?.status === 'done');
  assert.equal(items[0].status, 'done');
  const m = (await admin.get('/api/factory/metrics')).json; assert.equal(m.autonomy.resolvedWithoutHumans, 0, 'human-approved items are not counted as autonomous');
});

test('[FAC-03] a regression after release is rolled back automatically', async () => {
  const { admin, pid } = await setup();
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'bad-fix' });
  const items = await settle(admin, pid, (xs) => xs[0]?.status === 'rolled_back');
  assert.equal(items[0].status, 'rolled_back');
  const d = (await admin.get(`/api/factory/items/${items[0].id}`)).json;
  assert.ok(d.events.some((e) => e.kind === 'regression') && d.events.some((e) => e.kind === 'rollback'));
  assert.equal(d.item.data.rollback.to, 'v1');
  assert.equal((await admin.get('/api/factory/metrics')).json.dora.changeFailureRate, 1);
});

test('[FAC-04] customer requests become proposals that need a human decision', async () => {
  const { admin, pid } = await setup();
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'feature-request' });
  const items = await settle(admin, pid, (xs) => xs[0]?.status === 'proposal');
  assert.equal(items[0].status, 'proposal');
  const d = (await admin.get(`/api/factory/items/${items[0].id}`)).json; assert.ok(d.item.data.proposal.acceptanceCriteria.length);
  assert.equal((await admin.post(`/api/factory/items/${items[0].id}/build`, {})).status, 200);
  await sleep(50);
  const built = await settle(admin, pid, (xs) => xs[0]?.status === 'done');
  assert.equal(built[0].status, 'done', 'approved proposal is built, reviewed, released and verified');
  assert.match((await admin.get(`/api/factory/items/${built[0].id}`)).json.item.data.patch.diff, /exportCsv/);
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'feature-request' });
});

test('[FAC-05] andon cord: editors can stop the line, only admins restart it; paused lines do not act', async () => {
  const { app, admin, pid } = await setup();
  await admin.post('/api/users', { name: 'Ed', email: 'ed@x.y', role: 'editor', password: 'editor-pass-123' });
  const ed = client(app, { ip: '10.4.0.2' }); await ed.post('/api/auth/login', { email: 'ed@x.y', password: 'editor-pass-123' });
  assert.equal((await ed.post(`/api/factory/products/${pid}/pause`, { paused: true, reason: 'release freeze' })).status, 200);
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'null-price' });
  await admin.post(`/api/factory/products/${pid}/tick`, {});
  assert.equal((await admin.get(`/api/factory/items?product=${pid}`)).json.items[0].status, 'new', 'detected but not acted on');
  assert.equal((await ed.post(`/api/factory/products/${pid}/pause`, { paused: false })).status, 403);
  assert.equal((await admin.post(`/api/factory/products/${pid}/pause`, { paused: false })).status, 200);
  const items = await settle(admin, pid, (xs) => xs[0]?.status === 'done'); assert.equal(items[0].status, 'done');
});

test('[FAC-06] org-wide stop halts every product', async () => {
  const { admin, pid } = await setup();
  await admin.post('/api/factory/pause-all', { paused: true });
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'null-price' });
  await admin.post(`/api/factory/products/${pid}/tick`, {});
  assert.equal((await admin.get(`/api/factory/items?product=${pid}`)).json.items[0].status, 'new');
  assert.equal((await admin.get('/api/factory/products')).json.factoryPaused, true);
});

test('[FAC-07] webhooks must be signed', async () => {
  const { app, pid, hook } = await setup();
  const body = JSON.stringify({ action: 'opened' });
  const bad = await app.request(`/api/factory/hooks/${pid}/github`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' }, body });
  assert.equal(bad.status, 401);
  const { createHmac } = await import('node:crypto');
  const sig = createHmac('sha256', hook).update(body).digest('hex');
  const ok = await app.request(`/api/factory/hooks/${pid}/github`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sig}` }, body });
  assert.equal(ok.status, 202);
  const sok = await app.request(`/api/factory/hooks/${pid}/sentry`, { method: 'POST', headers: { 'content-type': 'application/json', 'sentry-hook-signature': sig }, body });
  assert.equal(sok.status, 202);
});

test('[FAC-08] product config is validated and connection tokens are encrypted and never returned', async () => {
  const { admin, sqlite, pid } = await setup();
  assert.equal((await admin.post('/api/factory/products', { name: 'Bad', config: { mode: 'real', repo: { owner: '../x', name: 'y' } } })).status, 400);
  assert.equal((await admin.post('/api/factory/products', { name: 'Bad', config: { mode: 'real', repo: { owner: 'o', name: 'r' }, sentry: { org: 'o', project: 'p', baseUrl: 'http://169.254.169.254' } } })).status, 400);
  const real = await admin.post('/api/factory/products', { name: 'Shop', config: { mode: 'real', repo: { owner: 'acme', name: 'shop' }, cloudflare: { accountId: 'a'.repeat(32), script: 'shop' }, sentry: { org: 'acme', project: 'shop' }, policy: { riskThreshold: 25, autoMerge: false } } });
  assert.equal(real.status, 201); assert.equal(real.json.product.config.policy.riskThreshold, 25);
  await admin.put(`/api/factory/products/${real.json.product.id}/secrets/github`, { token: 'ghp_SECRETSECRETSECRETSECRETSECRET12' });
  assert.ok(!sqlite.prepare("SELECT ciphertext FROM secrets WHERE provider LIKE 'factory:%'").get().ciphertext.includes('SECRET'));
  const list = await admin.get('/api/factory/products'); assert.ok(!JSON.stringify(list.json).includes('ghp_')); assert.deepEqual(list.json.products.find((p) => p.name === 'Shop').connected, ['github']);
  assert.equal((await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'nope' })).status, 500 - 100, 'unknown scenario is a 400');
});

test('[FAC-09] build from scratch: brief → PRD+plan (gate) → template + build → CI + review → launch (gate) → live → operated', async () => {
  const { admin, pid: _ignored, sqlite } = await setup();
  const r = await admin.post('/api/factory/products', { name: 'Team Items', config: { mode: 'sandbox' }, build: { brief: 'A tiny app where a team adds and lists shared items.', template: 'worker-app' } });
  assert.equal(r.status, 201); const pid = r.json.product.id; assert.equal(r.json.product.config.stage, 'building');
  let items = await settle(admin, pid, (xs) => xs[0]?.status === 'plan_review');
  const id = items[0].id; assert.equal(items[0].status, 'plan_review');
  let d = (await admin.get(`/api/factory/items/${id}`)).json.item.data;
  assert.ok(d.prd.stories.length && d.arch.files.some((f) => f.path.startsWith('tests/')));
  assert.equal((await admin.post(`/api/factory/items/${id}/reject`, { reason: 'Add a 200-char limit' })).json.replanning, true);
  items = await settle(admin, pid, (xs) => xs[0]?.status === 'plan_review'); assert.equal(items[0].attempts, 1);
  assert.equal((await admin.post(`/api/factory/items/${id}/approve`, {})).status, 200);
  items = await settle(admin, pid, (xs) => xs[0]?.status === 'launch_review');
  assert.equal(items[0].status, 'launch_review');
  const ev = (await admin.get(`/api/factory/items/${id}`)).json.events.map((e) => e.kind);
  for (const k of ['prd', 'plan', 'plan_approved', 'template', 'built', 'pr_opened', 'ci', 'reviewed']) assert.ok(ev.includes(k), `missing ${k}`);
  assert.equal((await admin.post(`/api/factory/items/${id}/approve`, {})).status, 200);
  items = await settle(admin, pid, (xs) => xs.find((x) => x.id === id)?.status === 'done');
  assert.equal(items.find((x) => x.id === id).status, 'done');
  assert.equal((await admin.get('/api/factory/products')).json.products.find((p) => p.id === pid).config.stage, 'operating');
  // The merged repository is real code: write it out and run its own tests.
  const repo = JSON.parse(sqlite.prepare('SELECT state FROM factory_sandbox WHERE product_id=?').get(pid).state).repo;
  assert.ok(repo['.github/workflows/ci.yml'].includes('wrangler-action'), 'CI comes from the vetted template');
  const dir = mkdtempSync(join(tmpdir(), 'hy-build-'));
  for (const [path, content] of Object.entries(repo)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content); }
  const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: dir, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
  assert.match(out, /# pass 3/); assert.match(out, /# fail 0/);
});

test('[FAC-10] builder output outside the plan or writing CI config is refused', async () => {
  const { guardPatch } = await import('../../src/factory/policy.js');
  const { AGENT_WRITABLE } = await import('../../src/factory/templates.js');
  assert.ok(AGENT_WRITABLE.test('src/index.js') && AGENT_WRITABLE.test('tests/a.test.js') && AGENT_WRITABLE.test('public/index.html'));
  for (const p of ['.github/workflows/ci.yml', 'package.json', 'wrangler.toml', 'src/../x.js', 'scripts/postinstall.js']) assert.equal(AGENT_WRITABLE.test(p) && !p.includes('..'), false, p);
  assert.ok(guardPatch([{ path: '.github/workflows/x.yml', content: '' }]).length);
});

test('[FAC-11] after launch the crew operates the built product: an injected real bug is diagnosed, fixed and verified', async () => {
  const { admin, sqlite } = await setup();
  const r = await admin.post('/api/factory/products', { name: 'Team Items', config: { mode: 'sandbox' }, build: { brief: 'Shared team list', template: 'worker-app' } });
  const pid = r.json.product.id;
  let xs = await settle(admin, pid, (a) => a[0]?.status === 'plan_review'); await admin.post(`/api/factory/items/${xs[0].id}/approve`, {});
  xs = await settle(admin, pid, (a) => a[0]?.status === 'launch_review'); await admin.post(`/api/factory/items/${xs[0].id}/approve`, {});
  await settle(admin, pid, (a) => a[0]?.status === 'done');
  const prodInfo = (await admin.get('/api/factory/products')).json.products.find((p) => p.id === pid);
  assert.deepEqual(prodInfo.scenarios.sort(), ['feature-request', 'null-title']);
  assert.equal((await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'null-price' })).status, 400, 'scenarios must fit the product');
  await admin.post(`/api/factory/products/${pid}/sandbox/inject`, { scenario: 'null-title' });
  let repo = JSON.parse(sqlite.prepare('SELECT state FROM factory_sandbox WHERE product_id=?').get(pid).state).repo;
  assert.match(repo['src/store.js'], /const t = title\.trim\(\);/, 'the bug is really in the code');
  const done = await settle(admin, pid, (a) => a.find((i) => i.kind !== 'build')?.status === 'done');
  assert.equal(done.find((i) => i.kind !== 'build').status, 'done');
  repo = JSON.parse(sqlite.prepare('SELECT state FROM factory_sandbox WHERE product_id=?').get(pid).state).repo;
  assert.match(repo['src/store.js'], /String\(title \|\| ''\)\.trim\(\)/, 'the fix is merged');
});
