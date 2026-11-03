// Factory API. Mounted by createApp(). Admin configures products and credentials; editors can pull the andon cord,
// approve/reject releases, inject sandbox incidents and run a tick; viewers see everything read-only.
import { uid, randomToken, encrypt, timingSafeEqual, hex } from '../lib/crypto.js';
import { checkOutboundUrl } from '../lib/net.js';
import { PROVIDERS } from '../lib/llm.js';
import { tick, buildWorld, merge, logEvent, loadSandbox, saveSandbox, TERMINAL } from './loop.js';
import { sandboxWorld, sandboxInitial, SANDBOX_SCENARIOS, scenariosFor } from './connectors.js';
import { DEFAULT_POLICY } from './policy.js';
import { factoryMetrics } from './metrics.js';
import { FACTORY_CREW } from './agents.js';
import { TEMPLATES, templateList } from './templates.js';

async function hmacHex(key, data) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}

const slug = /^[A-Za-z0-9_.-]{1,100}$/;
function cleanConfig(b, env) {
  const mode = b.mode === 'real' ? 'real' : 'sandbox';
  const cfg = { mode, stage: b.stage === 'building' ? 'building' : 'operating', model: { provider: '', model: '' }, policy: {} };
  if (b.template) { if (!TEMPLATES[b.template]) throw Object.assign(new Error('Unknown template'), { status: 400 }); cfg.template = b.template; }
  if (b.model?.provider) { if (!PROVIDERS[b.model.provider]) throw Object.assign(new Error('Unknown model provider'), { status: 400 }); cfg.model = { provider: b.model.provider, model: String(b.model.model || '').slice(0, 120) }; }
  if (mode === 'real') {
    const r = b.repo || {};
    if (!slug.test(r.owner || '') || !slug.test(r.name || '')) throw Object.assign(new Error('GitHub owner and repository are required'), { status: 400 });
    cfg.repo = { owner: r.owner, name: r.name, branch: slug.test(r.branch || '') ? r.branch : 'main', issueLabel: String(r.issueLabel || 'bug').slice(0, 50) };
    if (b.cloudflare?.accountId) { if (!/^[a-f0-9]{32}$/i.test(b.cloudflare.accountId) || !slug.test(b.cloudflare.script || '')) throw Object.assign(new Error('Cloudflare account id (32 hex) and Worker script name are required'), { status: 400 }); cfg.cloudflare = { accountId: b.cloudflare.accountId, script: b.cloudflare.script }; }
    if (b.sentry?.org) {
      if (!slug.test(b.sentry.org) || !slug.test(b.sentry.project || '')) throw Object.assign(new Error('Sentry organisation and project slugs are required'), { status: 400 });
      const base = b.sentry.baseUrl || 'https://sentry.io'; const chk = checkOutboundUrl(base, { allowPrivate: env.ALLOW_PRIVATE_NETWORK === 'true' });
      if (!chk.ok) throw Object.assign(new Error(`Sentry URL: ${chk.reason}`), { status: 400 });
      cfg.sentry = { org: b.sentry.org, project: b.sentry.project, baseUrl: chk.url.origin };
    }
  }
  const p = b.policy || {};
  const num = (k, lo, hi) => { if (p[k] != null && p[k] !== '') cfg.policy[k] = Math.max(lo, Math.min(hi, Number(p[k]) || 0)); };
  num('riskThreshold', 0, 200); num('maxAttempts', 0, 5); num('maxPrsPerDay', 0, 100); num('maxDeploysPerDay', 0, 50); num('maxTokensPerDay', 0, 1e8); num('monitorMinutes', 1, 1440); num('maxFilesPerFix', 1, 20);
  for (const k of ['autoMerge', 'requireCi', 'autoRollback']) if (typeof p[k] === 'boolean') cfg.policy[k] = p[k];
  if (Array.isArray(p.sensitivePaths)) cfg.policy.sensitivePaths = p.sensitivePaths.map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 40);
  if (p.freezeUntil != null) cfg.policy.freezeUntil = Math.max(0, Number(p.freezeUntil) || 0);
  return cfg;
}

const productOut = (p, counts = {}) => ({ id: p.id, name: p.name, paused: !!p.paused, config: JSON.parse(p.config), createdAt: p.created_at, counts });
const itemOut = (i, full = false) => { const d = JSON.parse(i.data || '{}'); return { id: i.id, productId: i.product_id, source: i.source, kind: i.kind, title: i.title, severity: i.severity, impact: i.impact, status: i.status, risk: i.risk, attempts: i.attempts, detectedAt: i.detected_at, updatedAt: i.updated_at, mergedAt: i.merged_at, deployedAt: i.deployed_at, resolvedAt: i.resolved_at, url: d.signal?.url || null, pr: d.pr || null, ...(full ? { data: { brief: d.brief, prd: d.prd, arch: d.arch, build: d.build ? { done: d.build.done, branch: d.build.branch } : null, reviewNotes: d.reviewNotes, triage: d.triage, diagnosis: d.diagnosis, patch: d.patch, risk: d.risk, review: d.review, ci: d.ci, deploy: d.deploy, rollback: d.rollback, proposal: d.proposal, signal: { title: d.signal?.title, body: d.signal?.body, source: d.signal?.source } } } : {}) }; };

export function mountFactory(app, { requireRole, json, str, audit, doFetch }) {
  const prod = async (c, id) => { const p = await c.get('db').get('SELECT * FROM factory_products WHERE id=? AND org_id=?', [id, c.get('user').org_id]); if (!p) throw Object.assign(new Error('Product not found'), { status: 404 }); return p; };
  const runSoon = (c, promise) => { try { c.executionCtx.waitUntil(promise); } catch { promise.catch(() => {}); } };

  app.get('/api/factory/crew', requireRole('viewer'), (c) => c.json({ crew: FACTORY_CREW, scenarios: Object.keys(SANDBOX_SCENARIOS), defaultPolicy: DEFAULT_POLICY, templates: templateList() }));

  app.get('/api/factory/products', requireRole('viewer'), async (c) => {
    const db = c.get('db'); const org = c.get('user').org_id;
    const ps = await db.all('SELECT * FROM factory_products WHERE org_id=? ORDER BY created_at', [org]);
    const counts = await db.all('SELECT product_id, status, COUNT(*) n FROM factory_items WHERE org_id=? GROUP BY product_id, status', [org]);
    const secrets = await db.all("SELECT provider FROM secrets WHERE org_id=? AND provider LIKE 'factory:%'", [org]);
    const s = JSON.parse((await db.get('SELECT settings FROM orgs WHERE id=?', [org])).settings);
    return c.json({ factoryPaused: !!s.factoryPaused, products: ps.map((p) => ({ scenarios: scenariosFor(!!JSON.parse(p.config).template), ...productOut(p, Object.fromEntries(counts.filter((x) => x.product_id === p.id).map((x) => [x.status, x.n]))), connected: secrets.filter((x) => x.provider.startsWith(`factory:${p.id}:`)).map((x) => x.provider.split(':')[2]), webhookPath: `/api/factory/hooks/${p.id}/github` })) });
  });
  app.post('/api/factory/products', requireRole('admin'), async (c) => {
    const b = await json(c); const u = c.get('user'); const now = Date.now(); const db = c.get('db');
    const building = !!b.build;
    const cfg = cleanConfig({ ...(b.config || {}), stage: building ? 'building' : 'operating', template: building ? (b.build.template || 'worker-app') : undefined }, c.get('env')); const id = uid('fp_'); const hook = randomToken(24);
    const name = str(b.name, 100, 'name');
    await db.run('INSERT INTO factory_products (id,org_id,name,config,hook_secret,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, u.org_id, name, JSON.stringify(cfg), hook, u.id, now, now]);
    if (building) {
      const brief = str(b.build.brief, 6000, 'brief');
      if (cfg.mode === 'sandbox') await saveSandbox(db, id, { ...sandboxInitial(), repo: { 'README.md': `# ${name}\n` }, deployments: [] });
      await db.run('INSERT INTO factory_items (id,org_id,product_id,source,external_id,kind,title,severity,impact,status,data,detected_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uid('fi_'), u.org_id, id, 'brief', `build-${now}`, 'build', `Build ${name}`, 'medium', 0, 'brief', JSON.stringify({ brief: { name, brief, template: cfg.template } }), now, now, now]);
      await logEvent(db, { org: u.org_id, product: id, actor: `human:${u.id}`, kind: 'brief', message: `${u.name} briefed the crew to build ${name}` });
      runSoon(c, tick(db, c.get('env'), { fetchImpl: doFetch, productId: id }));
    }
    await audit(c, 'factory.product.created', id, { mode: cfg.mode, build: building });
    return c.json({ product: productOut(await prod(c, id)), webhookSecret: hook }, 201);
  });
  app.put('/api/factory/products/:id', requireRole('admin'), async (c) => {
    const p = await prod(c, c.req.param('id')); const b = await json(c);
    const cfg = cleanConfig({ ...JSON.parse(p.config), ...(b.config || {}) }, c.get('env'));
    await c.get('db').run('UPDATE factory_products SET name=?, config=?, updated_at=? WHERE id=?', [b.name ? str(b.name, 100, 'name') : p.name, JSON.stringify(cfg), Date.now(), p.id]);
    await audit(c, 'factory.product.updated', p.id, { policy: cfg.policy });
    return c.json({ product: productOut(await prod(c, p.id)) });
  });
  app.delete('/api/factory/products/:id', requireRole('admin'), async (c) => {
    const p = await prod(c, c.req.param('id')); const db = c.get('db');
    await db.run('DELETE FROM factory_products WHERE id=?', [p.id]); await db.run("DELETE FROM secrets WHERE org_id=? AND provider LIKE ?", [p.org_id, `factory:${p.id}:%`]); await db.run('DELETE FROM factory_sandbox WHERE product_id=?', [p.id]);
    await audit(c, 'factory.product.deleted', p.id); return c.json({ ok: true });
  });
  app.put('/api/factory/products/:id/secrets/:name', requireRole('admin'), async (c) => {
    const p = await prod(c, c.req.param('id')); const name = c.req.param('name');
    if (!['github', 'sentry', 'cloudflare'].includes(name)) return c.json({ error: 'Unknown connection' }, 400);
    const b = await json(c); const key = str(b.token, 400, 'token'); const env = c.get('env');
    const sealed = await encrypt(key, env.ENCRYPTION_KEY, `${p.org_id}:factory:${p.id}:${name}`);
    await c.get('db').run('INSERT OR REPLACE INTO secrets (id,org_id,provider,ciphertext,iv,base_url,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', [uid('sec_'), p.org_id, `factory:${p.id}:${name}`, sealed.ciphertext, sealed.iv, null, c.get('user').id, Date.now()]);
    await audit(c, 'factory.secret.set', p.id, { name }); return c.json({ ok: true });
  });

  // Andon cord: any editor can stop the line; only admins can restart it.
  app.post('/api/factory/products/:id/pause', requireRole('editor'), async (c) => {
    const p = await prod(c, c.req.param('id')); const b = await json(c); const paused = !!b.paused;
    if (!paused && c.get('user').role !== 'admin') return c.json({ error: 'Only an admin can restart the line' }, 403);
    await c.get('db').run('UPDATE factory_products SET paused=? WHERE id=?', [paused ? 1 : 0, p.id]);
    await logEvent(c.get('db'), { org: p.org_id, product: p.id, actor: `human:${c.get('user').id}`, kind: paused ? 'paused' : 'resumed', message: `${c.get('user').name} ${paused ? 'pulled the andon cord' : 'restarted the line'}${b.reason ? `: ${String(b.reason).slice(0, 200)}` : ''}` });
    await audit(c, paused ? 'factory.paused' : 'factory.resumed', p.id); return c.json({ ok: true, paused });
  });
  app.post('/api/factory/pause-all', requireRole('editor'), async (c) => {
    const b = await json(c); const paused = !!b.paused; const u = c.get('user'); const db = c.get('db');
    if (!paused && u.role !== 'admin') return c.json({ error: 'Only an admin can restart the factory' }, 403);
    const s = JSON.parse((await db.get('SELECT settings FROM orgs WHERE id=?', [u.org_id])).settings); s.factoryPaused = paused;
    await db.run('UPDATE orgs SET settings=? WHERE id=?', [JSON.stringify(s), u.org_id]);
    await audit(c, paused ? 'factory.all_paused' : 'factory.all_resumed', u.org_id); return c.json({ ok: true, paused });
  });

  app.post('/api/factory/products/:id/tick', requireRole('editor'), async (c) => {
    const p = await prod(c, c.req.param('id'));
    const r = await tick(c.get('db'), c.get('env'), { fetchImpl: doFetch, productId: p.id });
    return c.json({ result: r[p.id] || r });
  });
  app.post('/api/factory/products/:id/sandbox/inject', requireRole('editor'), async (c) => {
    const p = await prod(c, c.req.param('id')); if (JSON.parse(p.config).mode !== 'sandbox') return c.json({ error: 'Only sandbox products accept injected incidents' }, 400);
    const b = await json(c); const db = c.get('db'); const st = await loadSandbox(db, p.id);
    const id = sandboxWorld(st).inject(String(b.scenario || '')); await saveSandbox(db, p.id, st);
    await logEvent(db, { org: p.org_id, product: p.id, actor: `human:${c.get('user').id}`, kind: 'injected', message: `Sandbox incident injected: ${SANDBOX_SCENARIOS[b.scenario].title}` });
    return c.json({ ok: true, issue: id });
  });
  app.post('/api/factory/products/:id/sandbox/reset', requireRole('admin'), async (c) => {
    const p = await prod(c, c.req.param('id')); const db = c.get('db');
    await saveSandbox(db, p.id, sandboxInitial()); await db.run('DELETE FROM factory_items WHERE product_id=?', [p.id]);
    await audit(c, 'factory.sandbox.reset', p.id); return c.json({ ok: true });
  });

  app.get('/api/factory/items', requireRole('viewer'), async (c) => {
    const org = c.get('user').org_id; const pid = c.req.query('product');
    const rows = pid ? await c.get('db').all('SELECT * FROM factory_items WHERE org_id=? AND product_id=? ORDER BY updated_at DESC LIMIT 300', [org, pid]) : await c.get('db').all('SELECT * FROM factory_items WHERE org_id=? ORDER BY updated_at DESC LIMIT 300', [org]);
    return c.json({ items: rows.map((i) => itemOut(i)) });
  });
  app.get('/api/factory/items/:id', requireRole('viewer'), async (c) => {
    const db = c.get('db'); const i = await db.get('SELECT * FROM factory_items WHERE id=? AND org_id=?', [c.req.param('id'), c.get('user').org_id]);
    if (!i) return c.json({ error: 'Not found' }, 404);
    const events = await db.all('SELECT at, actor, kind, message FROM factory_events WHERE item_id=? ORDER BY seq', [i.id]);
    return c.json({ item: itemOut(i, true), events });
  });
  const itemFor = async (c) => { const i = await c.get('db').get('SELECT * FROM factory_items WHERE id=? AND org_id=?', [c.req.param('id'), c.get('user').org_id]); if (!i) throw Object.assign(new Error('Not found'), { status: 404 }); return i; };

  app.post('/api/factory/items/:id/approve', requireRole('editor'), async (c) => {
    const i = await itemFor(c); if (!['awaiting_approval', 'plan_review', 'launch_review'].includes(i.status)) return c.json({ error: `Item is ${i.status}, not awaiting approval` }, 409);
    const p = await prod(c, i.product_id); const db = c.get('db'); const env = c.get('env');
    if (i.status === 'plan_review') {
      await db.run('UPDATE factory_items SET status=?, updated_at=? WHERE id=?', ['building', Date.now(), i.id]);
      await logEvent(db, { org: p.org_id, product: p.id, item: i.id, actor: `human:${c.get('user').id}`, kind: 'plan_approved', message: `${c.get('user').name} approved the plan. Building…` });
      await audit(c, 'factory.plan_approved', i.id);
      runSoon(c, tick(db, env, { fetchImpl: doFetch, productId: p.id }));
      return c.json({ ok: true });
    }
    const { world, cfg, save } = await buildWorld(db, env, p, doFetch);
    try { await merge({ db, world, cfg, product: p, now: Date.now() }, i, `human:${c.get('user').id}`, `approved by ${c.get('user').name}`); } finally { await save(); }
    await audit(c, 'factory.approved', i.id, { risk: i.risk });
    runSoon(c, tick(db, env, { fetchImpl: doFetch, productId: p.id }));
    return c.json({ ok: true });
  });
  app.post('/api/factory/items/:id/reject', requireRole('editor'), async (c) => {
    const i = await itemFor(c); const b = await json(c);
    if (!['awaiting_approval', 'proposal', 'needs_human', 'plan_review', 'launch_review'].includes(i.status)) return c.json({ error: `Item is ${i.status}` }, 409);
    const p = await prod(c, i.product_id); const db = c.get('db'); const d = JSON.parse(i.data);
    if (i.status === 'plan_review') {
      await db.run('UPDATE factory_items SET status=?, attempts=attempts+1, data=?, updated_at=? WHERE id=?', ['brief', JSON.stringify({ ...d, notes: String(b.reason || 'Please revise the plan').slice(0, 2000) }), Date.now(), i.id]);
      await logEvent(db, { org: p.org_id, product: p.id, item: i.id, actor: `human:${c.get('user').id}`, kind: 'plan_changes', message: `${c.get('user').name} asked for changes: ${String(b.reason || '').slice(0, 300)}` });
      await audit(c, 'factory.plan_changes_requested', i.id);
      runSoon(c, tick(db, c.get('env'), { fetchImpl: doFetch, productId: p.id }));
      return c.json({ ok: true, replanning: true });
    }
    if (i.status === 'launch_review') { const { world, save } = await buildWorld(db, c.get('env'), p, doFetch); try { await world.closePR(d.pr, `Launch declined by ${c.get('user').name}: ${String(b.reason || '').slice(0, 300)}`); } finally { await save(); } await db.run('UPDATE factory_items SET status=?, updated_at=? WHERE id=?', ['needs_human', Date.now(), i.id]); await audit(c, 'factory.launch_declined', i.id); return c.json({ ok: true }); }
    if (d.pr && i.status === 'awaiting_approval') { const { world, save } = await buildWorld(db, c.get('env'), p, doFetch); try { await world.closePR(d.pr, `Rejected by ${c.get('user').name}: ${String(b.reason || '').slice(0, 300)}`); } finally { await save(); } }
    await db.run('UPDATE factory_items SET status=?, updated_at=? WHERE id=?', ['rejected', Date.now(), i.id]);
    await logEvent(db, { org: p.org_id, product: p.id, item: i.id, actor: `human:${c.get('user').id}`, kind: 'rejected', message: `${c.get('user').name} rejected${b.reason ? `: ${String(b.reason).slice(0, 300)}` : ''}` });
    await audit(c, 'factory.rejected', i.id); return c.json({ ok: true });
  });
  // Build an approved proposal, or retry an escalated item from diagnosis.
  app.post('/api/factory/items/:id/build', requireRole('editor'), async (c) => {
    const i = await itemFor(c); if (!['proposal', 'needs_human', 'rolled_back'].includes(i.status)) return c.json({ error: `Item is ${i.status}` }, 409);
    const db = c.get('db'); const p = await prod(c, i.product_id);
    await db.run('UPDATE factory_items SET status=?, attempts=0, updated_at=? WHERE id=?', [i.kind === 'build' ? (JSON.parse(i.data).arch ? 'building' : 'brief') : 'triaged', Date.now(), i.id]);
    await logEvent(db, { org: p.org_id, product: p.id, item: i.id, actor: `human:${c.get('user').id}`, kind: 'requeued', message: `${c.get('user').name} sent this back to the crew` });
    await audit(c, 'factory.requeued', i.id);
    runSoon(c, tick(db, c.get('env'), { fetchImpl: doFetch, productId: p.id }));
    return c.json({ ok: true });
  });

  app.get('/api/factory/metrics', requireRole('viewer'), async (c) => {
    const org = c.get('user').org_id; const days = Math.min(Math.max(Number(c.req.query('days')) || 30, 1), 365);
    const items = await c.get('db').all('SELECT * FROM factory_items WHERE org_id=?', [org]);
    const events = await c.get('db').all('SELECT item_id, actor, kind FROM factory_events WHERE org_id=? AND item_id IS NOT NULL', [org]);
    return c.json(factoryMetrics(items, events, { days }));
  });
  app.get('/api/factory/events', requireRole('viewer'), async (c) => c.json({ events: await c.get('db').all('SELECT e.at, e.actor, e.kind, e.message, e.item_id, e.product_id FROM factory_events e WHERE e.org_id=? ORDER BY e.seq DESC LIMIT 80', [c.get('user').org_id]) }));

  // Signed webhooks: GitHub (X-Hub-Signature-256) and Sentry (Sentry-Hook-Signature). A valid hook triggers a tick.
  app.post('/api/factory/hooks/:id/:source', async (c) => {
    const db = c.get('db'); const p = await db.get('SELECT * FROM factory_products WHERE id=?', [c.req.param('id')]);
    const raw = await c.req.text();
    if (!p) return c.json({ error: 'Not found' }, 404);
    const src = c.req.param('source'); const expected = await hmacHex(p.hook_secret, raw);
    const got = src === 'github' ? String(c.req.header('x-hub-signature-256') || '').replace(/^sha256=/, '') : src === 'sentry' ? String(c.req.header('sentry-hook-signature') || '') : '';
    if (!got || !timingSafeEqual(got, expected)) { await logEvent(db, { org: p.org_id, product: p.id, actor: 'system', kind: 'hook_rejected', message: `Rejected unsigned or mis-signed ${src} webhook` }); return c.json({ error: 'Invalid signature' }, 401); }
    await logEvent(db, { org: p.org_id, product: p.id, actor: 'system', kind: 'hook', message: `${src} webhook received` });
    runSoon(c, tick(db, c.get('env'), { fetchImpl: doFetch, productId: p.id }));
    return c.json({ ok: true }, 202);
  });
}
export { TERMINAL };
