// The Software Factory loop. Each tick: observe signals → advance every active work item through
//   new → triaged → diagnosed → pr_open → reviewed → ci_passed → (merged | awaiting_approval) → deployed → done
// with side exits to proposal, needs_human, rejected and rolled_back. Runs unattended from the cron trigger.
import { uid, decrypt } from '../lib/crypto.js';
import { appendAudit } from '../lib/audit.js';
import { callProvider } from '../lib/llm.js';
import { realWorld, sandboxWorld, sandboxInitial } from './connectors.js';
import { policyOf, guardPatch, diffStats, riskScore, decide, budgetBlock } from './policy.js';
import { prompts, parseJson, sandboxModel, renderDiff, FACTORY_CREW } from './agents.js';
import { TEMPLATES, AGENT_WRITABLE } from './templates.js';

export const TERMINAL = ['done', 'rejected', 'rolled_back', 'needs_human', 'proposal', 'ignored'];
const WAITING = ['awaiting_approval', 'plan_review', 'launch_review'];
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export async function logEvent(db, { org, product, item = null, actor, kind, message, detail = null }) {
  await db.run('INSERT INTO factory_events (org_id,product_id,item_id,at,actor,kind,message,detail) VALUES (?,?,?,?,?,?,?,?)',
    [org, product, item, Date.now(), actor, kind, String(message).slice(0, 1000), detail == null ? null : JSON.stringify(detail).slice(0, 8000)]);
}
async function bumpUsage(db, productId, field, n) {
  await db.run(`INSERT INTO factory_usage (product_id, day, ${field}) VALUES (?,?,?) ON CONFLICT(product_id, day) DO UPDATE SET ${field} = ${field} + excluded.${field}`, [productId, day(), n]);
}
export async function usageToday(db, productId) { return (await db.get('SELECT * FROM factory_usage WHERE product_id=? AND day=?', [productId, day()])) || {}; }

export async function loadSandbox(db, productId) {
  const row = await db.get('SELECT state FROM factory_sandbox WHERE product_id=?', [productId]);
  return row ? JSON.parse(row.state) : sandboxInitial();
}
export async function saveSandbox(db, productId, state) { await db.run('INSERT INTO factory_sandbox (product_id,state) VALUES (?,?) ON CONFLICT(product_id) DO UPDATE SET state=excluded.state', [productId, JSON.stringify(state)]); }

async function productSecret(db, env, orgId, productId, name) {
  const s = await db.get('SELECT * FROM secrets WHERE org_id=? AND provider=?', [orgId, `factory:${productId}:${name}`]);
  return s ? decrypt(s, env.ENCRYPTION_KEY, `${orgId}:factory:${productId}:${name}`) : null;
}

export async function buildWorld(db, env, product, fetchImpl) {
  const cfg = JSON.parse(product.config);
  if (cfg.mode === 'sandbox') { const st = await loadSandbox(db, product.id); return { world: sandboxWorld(st), cfg, save: () => saveSandbox(db, product.id, st) }; }
  const secrets = { github: await productSecret(db, env, product.org_id, product.id, 'github'), sentry: await productSecret(db, env, product.org_id, product.id, 'sentry'), cloudflare: await productSecret(db, env, product.org_id, product.id, 'cloudflare') };
  if (!secrets.github) throw new Error('GitHub token is not configured for this product');
  return { world: realWorld({ cfg, secrets, fetchImpl, allowPrivate: env.ALLOW_PRIVATE_NETWORK === 'true' }), cfg, save: async () => {} };
}

function modelFor(db, env, product, cfg, fetchImpl) {
  return async (role, p) => {
    let r;
    if (cfg.mode === 'sandbox') r = sandboxModel(p);
    else {
      const prov = cfg.model?.provider; const model = cfg.model?.model;
      if (!prov || !model) throw new Error('Choose a model for this product (Settings → Models provider, then the product’s model)');
      const s = await db.get('SELECT * FROM secrets WHERE org_id=? AND provider=?', [product.org_id, prov]);
      if (!s) throw new Error(`No ${prov} key configured`);
      const key = await decrypt(s, env.ENCRYPTION_KEY, `${product.org_id}:${prov}`);
      r = await callProvider(prov, key, s.base_url, { model, system: p.system, messages: [{ role: 'user', content: p.user }], maxTokens: ['fix', 'build', 'debug'].includes(role) ? 12000 : role === 'architect' || role === 'prd' ? 3000 : 1500 }, fetchImpl);
    }
    await bumpUsage(db, product.id, 'tokens', (r.usage?.in || 0) + (r.usage?.out || 0));
    return parseJson(r.text);
  };
}

async function setItem(db, item, patch) {
  const next = { ...item, ...patch, updated_at: Date.now() };
  if (patch.data) next.data = JSON.stringify({ ...JSON.parse(item.data || '{}'), ...patch.data });
  await db.run('UPDATE factory_items SET status=?, severity=?, kind=?, risk=?, attempts=?, data=?, updated_at=?, merged_at=?, deployed_at=?, resolved_at=? WHERE id=?',
    [next.status, next.severity, next.kind, next.risk ?? null, next.attempts, next.data, next.updated_at, next.merged_at ?? null, next.deployed_at ?? null, next.resolved_at ?? null, item.id]);
  return next;
}

// One step of the state machine for an item. Returns the updated item (status may be unchanged when waiting).
export async function step(ctx, item) {
  const { db, world, cfg, product, ask, now } = ctx;
  const policy = policyOf(cfg); const data = JSON.parse(item.data || '{}'); const sig = data.signal;
  const ev = (actor, kind, message, detail) => logEvent(db, { org: product.org_id, product: product.id, item: item.id, actor, kind, message, detail });
  const aud = (action, detail) => appendAudit(db, { org: product.org_id, user: null, action: `factory.${action}`, target: item.id, detail: { product: product.id, ...detail } });
  const failOrRetry = async (why, back = 'diagnosed') => {
    const attempts = item.attempts + 1;
    if (attempts > policy.maxAttempts) { await ev('agent:release', 'escalated', `Escalated to a human after ${attempts} attempts: ${why}`); return setItem(db, item, { status: 'needs_human', attempts }); }
    await ev('agent:review', 'retry', `Retrying (${attempts}/${policy.maxAttempts}): ${why}`);
    return setItem(db, item, { status: back, attempts, data: { notes: why } });
  };

  switch (item.status) {
    // ---------------- build from scratch ----------------
    case 'brief': {
      const tpl = TEMPLATES[data.brief.template] || TEMPLATES['worker-app'];
      const prd = await ask('prd', prompts.prd(data.brief, data.notes));
      await ev('agent:strategist', 'prd', `${FACTORY_CREW.strategist.name} wrote the PRD: ${(prd.stories || []).length} user stories`, { title: prd.title });
      const arch = await ask('architect', prompts.architect(data.brief, prd, tpl));
      const seen = new Set();
      const files = (arch.files || []).filter((f) => f && AGENT_WRITABLE.test(f.path || '') && !f.path.includes('..') && !seen.has(f.path) && seen.add(f.path)).slice(0, 12);
      if (!files.some((f) => f.path.startsWith('tests/'))) { await ev('agent:architect', 'stuck', 'The plan has no tests, so it was sent back'); return failOrRetry('Plan must include at least one test file', 'brief'); }
      await ev('agent:architect', 'plan', `${FACTORY_CREW.architect.name}: ${arch.summary} (${files.length} files)`, { files: files.map((f) => f.path) });
      await aud('plan_ready', { files: files.length });
      return setItem(db, item, { status: 'plan_review', data: { prd, arch: { ...arch, files }, notes: null } });
    }
    case 'building': {
      const tpl = TEMPLATES[data.brief.template] || TEMPLATES['worker-app'];
      const b = data.build || { branch: `halyard/build-${item.id.slice(-8)}`, done: [], template: false };
      if (!b.template) {
        const files = Object.entries(tpl.files({ name: data.brief.name, prd: data.prd })).map(([path, content]) => ({ path, content }));
        await world.commitFiles(b.branch, files, 'chore: Halyard template (CI, config, README)');
        await ev('system', 'template', `Committed the vetted “${tpl.title}” template (CI pipeline and config are Halyard-authored, not agent-written)`, { files: files.map((f) => f.path) });
        return setItem(db, item, { data: { build: { ...b, template: true } } });
      }
      const plan = data.arch.files; const todo = plan.filter((f) => !b.done.includes(f.path));
      if (todo.length) {
        const block = budgetBlock(await usageToday(db, product.id), policy);
        if (block) { await ev('system', 'budget', block); return item; }
        const batch = todo.slice(0, 3);
        const out = await ask('build', prompts.build(data.brief, data.prd, data.arch, tpl, batch, b.done));
        const allowed = new Set(batch.map((f) => f.path));
        const files = (out.files || []).filter((f) => f && allowed.has(f.path) && typeof f.content === 'string');
        const problems = guardPatch(files, { ...policy, maxFilesPerFix: 3 });
        if (problems.length || !files.length) return failOrRetry(problems.length ? `Builder output blocked: ${problems.join('; ')}` : 'Builder returned no files for this batch', 'building');
        await world.commitFiles(b.branch, files, `feat: ${files.map((f) => f.path).join(', ')}`);
        const done = [...b.done, ...files.map((f) => f.path)];
        await ev('agent:builder', 'built', `${FACTORY_CREW.builder.name} wrote ${files.map((f) => f.path).join(', ')} (${done.length}/${plan.length})`);
        return setItem(db, item, { data: { build: { ...b, done } } });
      }
      const s = data.prd || {};
      const body = `Initial build by Halyard Software Factory.\n\n**Problem:** ${s.problem || ''}\n\n**Stories:**\n${(s.stories || []).map((x) => `- As ${x.as}, I want ${x.want}, so ${x.so}`).join('\n')}\n\n**Architecture:** ${data.arch.summary}\n\n_Launch requires human approval._`;
      const pr = await world.openPRFrom(b.branch, `feat: initial build of ${data.brief.name}`.slice(0, 120), body);
      await bumpUsage(db, product.id, 'prs', 1);
      await ev('agent:builder', 'pr_opened', `${FACTORY_CREW.builder.name} opened PR #${pr.number} with ${plan.length} files`, { pr });
      await aud('pr_opened', { pr: pr.number, build: true });
      return setItem(db, item, { status: 'verifying', data: { pr, build: { ...b, opened: now } } });
    }
    case 'verifying': {
      const tpl = TEMPLATES[data.brief.template] || TEMPLATES['worker-app'];
      const st = await world.prStatus(data.pr);
      if (st.ci === 'pending') return item;
      if (st.ci === 'none') { if (world.kind === 'real' && now - (data.build.opened || now) < 20 * 60000) return item; await ev('agent:release', 'stuck', 'No CI ran on the build PR'); return setItem(db, item, { status: 'needs_human' }); }
      await ev('agent:release', 'ci', `CI ${st.ci}: ${st.summary}`);
      if (st.ci === 'failure') {
        if (item.attempts >= policy.maxAttempts) { await ev('agent:release', 'escalated', 'CI still failing after fixes'); return setItem(db, item, { status: 'needs_human' }); }
        const paths = data.arch.files.map((f) => f.path); const named = paths.filter((p) => st.summary.includes(p));
        const pick = (named.length ? named : paths.filter((p) => p.startsWith('src/'))).slice(0, 3);
        const cur = await world.readFiles(pick, data.build.branch);
        const fx = await ask('debug', prompts.debug(data.brief, data.arch, st.summary, cur, tpl));
        const files = (fx.files || []).filter((f) => f && paths.includes(f.path) && typeof f.content === 'string');
        if (guardPatch(files, policy).length || !files.length) { await ev('agent:fix', 'stuck', 'Could not produce a safe fix for the failing build'); return setItem(db, item, { status: 'needs_human' }); }
        const sha = await world.commitFiles(data.build.branch, files, `fix: ${fx.summary || 'CI failure'}`);
        await ev('agent:fix', 'fixed', `${FACTORY_CREW.fix.name}: ${fx.summary}`);
        return setItem(db, item, { attempts: item.attempts + 1, data: { pr: { ...data.pr, headSha: sha } } });
      }
      const files = await world.readFiles(data.arch.files.map((f) => f.path).slice(0, 5), data.build.branch);
      const rv = await ask('review', prompts.review({ title: `Initial build of ${data.brief.name}` }, files.map((f) => `### ${f.path}\n${f.content}`).join('\n\n')));
      await ev('agent:review', 'reviewed', `${FACTORY_CREW.review.name}: ${rv.verdict}. ${rv.notes || ''}`);
      await aud('launch_ready', { pr: data.pr.number });
      return setItem(db, item, { status: 'launch_review', data: { review: rv.verdict, reviewNotes: rv.notes, ci: st.ci } });
    }
    case 'launching': {
      const deps = await world.deployments();
      const mine = deps.find((d) => d.createdOn >= (item.merged_at || 0) - 1000);
      if (!mine && world.kind === 'real' && cfg.cloudflare?.accountId && now - item.merged_at < 60 * 60000) return item;
      if (mine) await bumpUsage(db, product.id, 'deploys', 1);
      await ev('agent:watch', 'deployed', mine ? `${FACTORY_CREW.watch.name}: ${data.brief.name} is live (${mine.versionId})` : `${FACTORY_CREW.watch.name}: merged; no deployment signal available`, { deploy: mine });
      const cfgNext = { ...cfg, stage: 'operating' };
      await db.run('UPDATE factory_products SET config=?, updated_at=? WHERE id=?', [JSON.stringify(cfgNext), now, product.id]);
      await ev('system', 'operating', `${data.brief.name} launched. The crew now operates it: watching errors, issues and builds.`);
      await aud('launched', { deployment: mine?.id || null });
      return setItem(db, item, { status: 'done', deployed_at: now, resolved_at: now });
    }
    // ---------------- operate ----------------
    case 'new': {
      const t = await ask('triage', prompts.triage(sig));
      const kind = ['incident', 'bug', 'build', 'feature', 'noise'].includes(t.kind) ? t.kind : item.kind;
      const severity = ['low', 'medium', 'high', 'critical'].includes(t.severity) ? t.severity : item.severity;
      await ev('agent:triage', 'triaged', `${FACTORY_CREW.triage.name}: ${kind}, ${severity}. ${t.customerImpact || ''}`, t);
      if (kind === 'noise') return setItem(db, item, { status: 'ignored', kind, severity });
      if (kind === 'feature' || t.actionable === false) {
        const p = await ask('advocate', prompts.advocate(sig));
        await ev('agent:advocate', 'proposal', `${FACTORY_CREW.advocate.name} drafted a proposal: ${p.proposal || ''}`, p);
        return setItem(db, item, { status: 'proposal', kind: 'feature', severity, data: { proposal: p } });
      }
      return setItem(db, item, { status: 'triaged', kind, severity, data: { triage: t } });
    }
    case 'triaged': {
      const stack = await world.stackFor(sig); const tree = await world.repoTree();
      const d = await ask('diagnose', prompts.diagnose(sig, stack, tree));
      const known = new Set(tree); const files = (d.files || []).filter((f) => known.has(f)).slice(0, 3);
      if (!files.length) { await ev('agent:diagnose', 'stuck', 'Could not map the problem to files in the repository'); return setItem(db, item, { status: 'needs_human' }); }
      await ev('agent:diagnose', 'diagnosed', `${FACTORY_CREW.diagnose.name}: ${d.rootCause}`, { files, confidence: d.confidence });
      return setItem(db, item, { status: 'diagnosed', data: { diagnosis: { rootCause: d.rootCause, files, confidence: d.confidence } } });
    }
    case 'diagnosed': {
      const block = budgetBlock(await usageToday(db, product.id), policy);
      if (block) { await ev('system', 'budget', block); return item; }
      const originals = Object.fromEntries((await world.readFiles(data.diagnosis.files)).map((f) => [f.path, f.content]));
      const fx = await ask('fix', prompts.fix(item, data.diagnosis, Object.entries(originals).map(([path, content]) => ({ path, content })), data.notes));
      const files = (fx.files || []).filter((f) => f && f.path && originals[f.path] !== f.content);
      const problems = guardPatch(files, policy, new Set(await world.repoTree()));
      if (problems.length) { await ev('agent:fix', 'guard_blocked', `Patch blocked by policy: ${problems.join('; ')}`, { problems }); return failOrRetry(`Patch blocked: ${problems.join('; ')}`); }
      const stats = diffStats(files, originals);
      const branch = `halyard/fix-${item.id.slice(-8)}-${item.attempts + 1}`;
      const body = `Automated fix by Halyard Factory.\n\n**Problem:** ${item.title}\n**Root cause:** ${data.diagnosis.rootCause}\n**Change:** ${fx.summary}\n**Verification:** ${fx.testPlan || 'CI'}\n${sig.url ? `**Source:** ${sig.url}\n` : ''}\n_Human approval is required above risk ${policy.riskThreshold}._`;
      const pr = await world.openPR({ branch, title: `fix: ${item.title}`.slice(0, 120), body, files });
      await bumpUsage(db, product.id, 'prs', 1);
      await ev('agent:fix', 'pr_opened', `${FACTORY_CREW.fix.name} opened PR #${pr.number}: ${fx.summary}`, { pr, stats });
      await aud('pr_opened', { pr: pr.number, files: files.map((f) => f.path) });
      return setItem(db, item, { status: 'pr_open', data: { pr, patch: { summary: fx.summary, stats, files: files.map((f) => f.path), diff: renderDiff(files, originals).slice(0, 20000) }, notes: null } });
    }
    case 'pr_open': {
      const rv = await ask('review', prompts.review(item, data.patch.diff));
      const verdict = rv.verdict === 'approved' ? 'approved' : 'changes_needed';
      await ev('agent:review', 'reviewed', `${FACTORY_CREW.review.name}: ${verdict}. ${rv.notes || ''}`, rv);
      if (verdict !== 'approved') { await world.closePR(data.pr, `Closing: reviewer requested changes — ${rv.notes || ''}`); return failOrRetry(`Reviewer: ${rv.notes || 'changes needed'}`); }
      return setItem(db, item, { status: 'reviewed', data: { review: verdict } });
    }
    case 'reviewed': {
      const st = await world.prStatus(data.pr);
      if (st.ci === 'pending') return item;
      await ev('agent:release', 'ci', `CI ${st.ci}: ${st.summary}`);
      if (st.ci === 'failure') { await world.closePR(data.pr, `Closing: CI failed.\n${st.summary}`); return failOrRetry(`CI failed: ${st.summary}`); }
      return setItem(db, item, { status: 'ci_passed', data: { ci: st.ci } });
    }
    case 'ci_passed': {
      const files = (data.patch.files || []).map((path) => ({ path }));
      const risk = riskScore({ severity: item.severity, files, stats: data.patch.stats, ci: data.ci, review: data.review }, policy);
      const d = decide({ score: risk.score, ci: data.ci }, policy, { usage: await usageToday(db, product.id), now, paused: !!product.paused });
      if (d.action === 'approval') {
        await ev('agent:release', 'approval_needed', `${FACTORY_CREW.release.name}: needs a human — ${d.reasons.join('; ')}`, { risk });
        await aud('approval_requested', { risk: risk.score });
        return setItem(db, item, { status: 'awaiting_approval', risk: risk.score, data: { risk } });
      }
      return merge(ctx, await setItem(db, item, { risk: risk.score, data: { risk } }), 'agent:release', `risk ${risk.score} ≤ ${policy.riskThreshold}`);
    }
    case 'merged': {
      const deps = await world.deployments();
      const mine = deps.find((d) => d.createdOn >= (item.merged_at || 0) - 1000);
      if (!mine) {
        if (world.kind === 'real' && !cfg.cloudflare?.accountId) { await ev('agent:watch', 'deployed', 'No Cloudflare connection: treating merge as release'); return setItem(db, item, { status: 'deployed', deployed_at: now, data: { deploy: { previous: null } } }); }
        if (now - (item.merged_at || now) > 60 * 60000) { await ev('agent:watch', 'stuck', 'No deployment seen within 60 minutes of merge'); return setItem(db, item, { status: 'needs_human' }); }
        return item;
      }
      const previous = deps.find((d) => d.createdOn < mine.createdOn && d.versionId !== mine.versionId);
      await bumpUsage(db, product.id, 'deploys', 1);
      await ev('agent:watch', 'deployed', `${FACTORY_CREW.watch.name}: deployment ${mine.id} (${mine.versionId}) is live — watching for ${policy.monitorMinutes} min`, { deploy: mine, previous });
      await aud('deployed', { deployment: mine.id });
      return setItem(db, item, { status: 'deployed', deployed_at: now, data: { deploy: { id: mine.id, versionId: mine.versionId, previous: previous?.versionId || null } } });
    }
    case 'deployed': {
      if (world.kind === 'real' && now - item.deployed_at < policy.monitorMinutes * 60000) return item;
      const h = await world.healthSince(sig, item.deployed_at);
      if (h.regressed) {
        await ev('agent:watch', 'regression', `${FACTORY_CREW.watch.name}: regression after deploy — ${h.detail}`, h);
        if (policy.autoRollback && data.deploy?.previous) {
          const rb = await world.rollback(data.deploy.previous, `Halyard Factory rollback: regression after fixing "${item.title}"`);
          await ev('agent:watch', 'rollback', `Rolled back to ${data.deploy.previous}`, rb);
          await aud('rollback', { to: data.deploy.previous });
          return setItem(db, item, { status: 'rolled_back', data: { rollback: { to: data.deploy.previous, at: now } } });
        }
        return setItem(db, item, { status: 'needs_human' });
      }
      await world.resolveSignal(sig, `Fixed by Halyard Factory in PR #${data.pr?.number}. Monitored ${policy.monitorMinutes} min after release with no regressions.`);
      await ev('agent:watch', 'resolved', `${FACTORY_CREW.watch.name}: healthy — ${h.detail}. Resolved.`);
      await aud('resolved', {});
      return setItem(db, item, { status: 'done', resolved_at: now });
    }
    default: return item;
  }
}

export async function merge(ctx, item, actor, why) {
  const { db, world, product, now } = ctx; const data = JSON.parse(item.data || '{}');
  const m = await world.mergePR(data.pr);
  await logEvent(db, { org: product.org_id, product: product.id, item: item.id, actor, kind: 'merged', message: `Merged PR #${data.pr.number} (${why})`, detail: m });
  await appendAudit(db, { org: product.org_id, user: actor.startsWith('human:') ? actor.slice(6) : null, action: 'factory.merged', target: item.id, detail: { pr: data.pr.number, why } });
  return setItem(db, item, { status: item.kind === 'build' ? 'launching' : 'merged', merged_at: now });
}

// Ingest signals and advance items. Bounded per tick to stay within Worker limits.
export async function runProduct(db, env, product, { fetchImpl = fetch, maxItems = 8, maxSteps = 9 } = {}) {
  const now = Date.now();
  const { world, cfg, save } = await buildWorld(db, env, product, fetchImpl);
  const ctx = { db, env, world, cfg, product, now, ask: modelFor(db, env, product, cfg, fetchImpl) };
  const summary = { ingested: 0, advanced: 0, errors: 0 };
  try {
    for (const sig of cfg.stage === 'building' ? [] : await world.listSignals()) {
      const r = await db.run('INSERT OR IGNORE INTO factory_items (id,org_id,product_id,source,external_id,kind,title,severity,impact,status,data,detected_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uid('fi_'), product.org_id, product.id, sig.source, sig.externalId, sig.kind, String(sig.title).slice(0, 300), sig.severity || 'medium', Math.round(sig.impact || 0), 'new', JSON.stringify({ signal: sig }), sig.detectedAt || now, now, now]);
      if (r.changes) { summary.ingested++; await logEvent(db, { org: product.org_id, product: product.id, item: null, actor: 'system', kind: 'detected', message: `Detected from ${sig.source}: ${sig.title}` }); }
    }
    if (product.paused) return { ...summary, paused: true };
    const active = await db.all(`SELECT * FROM factory_items WHERE product_id=? AND status NOT IN (${[...TERMINAL, ...WAITING].map(() => '?').join(',')}) ORDER BY impact DESC, detected_at ASC LIMIT ?`, [product.id, ...TERMINAL, ...WAITING, maxItems]);
    for (let item of active) {
      for (let i = 0; i < maxSteps; i++) {
        const before = item.status; let next;
        try { next = await step(ctx, item); } catch (e) {
          summary.errors++;
          await logEvent(db, { org: product.org_id, product: product.id, item: item.id, actor: 'system', kind: 'error', message: `Step "${before}" failed: ${e.message}` });
          const attempts = item.attempts + 1;
          item = await setItem(db, item, { attempts, status: attempts > 3 ? 'needs_human' : item.status });
          break;
        }
        if (next === item) break;
        item = next; summary.advanced++;
        if (TERMINAL.includes(item.status) || WAITING.includes(item.status)) break;
      }
    }
    return summary;
  } finally { await save(); }
}

export async function tick(db, env, { fetchImpl = fetch, orgId = null, productId = null } = {}) {
  // Take the lock in one statement so two ticks (interval + manual run) can't both see it free.
  const now = Date.now(); const until = now + 4 * 60000 + Math.random();
  const took = await db.run('INSERT INTO factory_locks (name, until) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET until=excluded.until WHERE factory_locks.until <= ?', ['tick', until, now]);
  if (!took.changes) return { skipped: 'another tick is running' };
  const out = {};
  try {
    const where = productId ? 'WHERE id=?' : orgId ? 'WHERE org_id=?' : '';
    const products = await db.all(`SELECT p.*, o.settings org_settings FROM factory_products p JOIN orgs o ON o.id=p.org_id ${where.replace('id=', 'p.id=').replace('org_id', 'p.org_id')}`, productId ? [productId] : orgId ? [orgId] : []);
    for (const p of products) {
      const orgPaused = JSON.parse(p.org_settings || '{}').factoryPaused;
      try { out[p.id] = await runProduct(db, env, { ...p, paused: p.paused || orgPaused }, { fetchImpl }); }
      catch (e) { out[p.id] = { error: e.message }; await logEvent(db, { org: p.org_id, product: p.id, actor: 'system', kind: 'error', message: e.message }); }
    }
  } finally { await db.run('UPDATE factory_locks SET until=0 WHERE name=? AND until=?', ['tick', until]); }
  return out;
}
