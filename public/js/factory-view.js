// Factory page: products under agent operation, a live board staffed by the factory crew, approvals and DORA KPIs.
import { crewHTML } from './mascot.js';
import { icon } from './icons.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => { if (!t) return '—'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const dur = (h) => (h == null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${fmt(h)} h`);
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export const LANES = [
  { key: 'build', title: 'Building', crew: 'builder', statuses: ['brief', 'building', 'verifying', 'launching'] },
  { key: 'human', title: 'Needs you', crew: 'advocate', statuses: ['awaiting_approval', 'needs_human', 'proposal', 'plan_review', 'launch_review'] },
  { key: 'detect', title: 'Detected', crew: 'triage', statuses: ['new', 'triaged'] },
  { key: 'diagnose', title: 'Diagnosing', crew: 'diagnose', statuses: ['diagnosed'] },
  { key: 'fix', title: 'Fix & review', crew: 'fix', statuses: ['pr_open', 'reviewed'] },
  { key: 'release', title: 'Release', crew: 'release', statuses: ['ci_passed', 'merged'] },
  { key: 'watch', title: 'Watching', crew: 'watch', statuses: ['deployed'] },
  { key: 'done', title: 'Done', crew: 'watch', statuses: ['done'] },
  { key: 'stopped', title: 'Rolled back / closed', crew: 'release', statuses: ['rolled_back', 'rejected', 'ignored'] },
];
const STATUS_LABEL = { brief: 'planning', plan_review: 'approve plan', building: 'building', verifying: 'testing', launch_review: 'approve launch', launching: 'launching', new: 'detected', triaged: 'triaged', diagnosed: 'diagnosed', pr_open: 'PR open', reviewed: 'reviewed', ci_passed: 'CI passed', merged: 'merged', deployed: 'live · watching', awaiting_approval: 'approve release', needs_human: 'needs a human', proposal: 'proposal', done: 'resolved', rolled_back: 'rolled back', rejected: 'rejected', ignored: 'ignored' };
const SEV = { critical: 'bad', high: 'bad', medium: 'warn', low: '' };

export async function factoryView({ api, S, can }) {
  const [{ products, factoryPaused }, crewInfo, m] = await Promise.all([api('/api/factory/products'), api('/api/factory/crew'), api('/api/factory/metrics?days=30')]);
  S.factory = S.factory || {};
  if (!products.find((p) => p.id === S.factory.product)) S.factory.product = products[0]?.id || null;
  const p = products.find((x) => x.id === S.factory.product);
  const [items, feed] = p ? await Promise.all([api(`/api/factory/items?product=${p.id}`).then((r) => r.items), api('/api/factory/events').then((r) => r.events.filter((e) => e.product_id === p.id).slice(0, 12))]) : [[], []];
  S.factory.crew = crewInfo.crew; S.factory.templates = crewInfo.templates; S.factory.scenarios = crewInfo.scenarios; S.factory.defaultPolicy = crewInfo.defaultPolicy; S.factory.products = products;
  const running = !factoryPaused && p && !p.paused;
  const kpi = (label, v, sub = '') => `<div class="card kpi"><div class="label">${label}</div><div class="val">${v}</div><div class="sub">${sub}</div></div>`;

  const head = `<section class="hero"><div style="flex:1;min-width:260px"><h1>Software Factory</h1>
      <p class="muted">An agent crew that builds new products from a brief, then runs them: watching for problems, fixing what breaks, shipping within policy and rolling back when a release hurts customers. People approve plans, launches and anything risky.</p>
      <div class="row" style="margin-top:12px">${factoryPaused ? `<span class="chip bad">${icon('alert', 'width="14" height="14"')} Factory stopped</span>${can('admin') ? '<button class="btn sm" data-act="fac-all" data-v="0">Restart factory</button>' : ''}` : `<span class="chip ok">Factory running</span>${can('editor') ? '<button class="btn sm danger" data-act="fac-all" data-v="1">Stop all lines</button>' : ''}`}</div></div>
      <div class="lineup" aria-hidden="true">${Object.entries(crewInfo.crew).map(([k, c]) => crewHTML(c.mascot, 60, factoryPaused ? 'sleeping' : items.some((i) => LANES.find((l) => l.crew === k)?.statuses.includes(i.status)) ? 'working' : 'idle')).join('')}</div></section>`;

  const metrics = `<div class="grid kpi">${kpi('Deploys / day', fmt(m.dora.deploymentsPerDay, 2), 'DORA · last 30 days')}${kpi('Lead time', dur(m.dora.leadTimeHours), 'detected → live (median)')}${kpi('Change failure', pct(m.dora.changeFailureRate), 'releases rolled back')}${kpi('Time to restore', dur(m.dora.mttrHours), 'incident → resolved (median)')}${kpi('Autonomy', pct(m.autonomy.autonomyRate), `${m.autonomy.resolvedWithoutHumans} of ${m.autonomy.resolved} resolved with no human`)}${kpi('Customer impact fixed', fmt(m.customers.impactResolved, 0), `${fmt(m.customers.openImpact, 0)} still open`)}</div>`;

  if (!products.length) return `${head}${metrics}<div class="card empty" style="margin-top:20px">${crewHTML(crewInfo.crew.triage.mascot, 72, 'sleeping')}<h2>No products on the line yet</h2><p>Brief the crew to <strong>build a new product</strong>, or hand them an <strong>existing product</strong> to operate. Try either in the sandbox first — no real systems are touched.</p>${can('admin') ? '<div class="row" style="justify-content:center"><button class="btn primary" data-act="fac-new" data-v="build">Build a new product</button><button class="btn" data-act="fac-new" data-v="operate">Operate an existing product</button></div>' : '<p class="small">Ask an admin to add a product.</p>'}</div>`;

  const cfg = p.config; const pol = { ...crewInfo.defaultPolicy, ...(cfg.policy || {}) };
  const bar = `<div class="row" style="margin:24px 0 12px"><div class="tabs" role="tablist" style="margin:0">${products.map((x) => `<button class="tab" role="tab" aria-selected="${x.id === p.id}" data-act="fac-product" data-id="${x.id}">${esc(x.name)} ${x.config.mode === 'sandbox' ? '<span class="chip info">sandbox</span>' : '<span class="chip ok">live</span>'}${x.paused ? ' <span class="chip bad">stopped</span>' : ''}</button>`).join('')}</div>
    ${can('admin') ? '<button class="btn sm ghost" data-act="fac-new" data-v="build">' + icon('plus') + ' Build new</button><button class="btn sm ghost" data-act="fac-new" data-v="operate">' + icon('plus') + ' Operate existing</button>' : ''}<span class="spacer"></span>
    ${can('editor') ? `<button class="btn sm" data-act="fac-tick" ${running ? '' : 'disabled'}>${icon('run')} Run crew now</button>` : ''}
    ${cfg.mode === 'sandbox' && cfg.stage !== 'building' && can('editor') ? `<select data-input="fac-scenario" aria-label="Incident to inject" style="max-width:200px;min-height:32px;padding:4px 8px">${(p.scenarios || crewInfo.scenarios).map((s) => `<option>${s}</option>`).join('')}</select><button class="btn sm" data-act="fac-inject">${icon('alert')} Inject incident</button>` : ''}
    ${can('editor') ? (p.paused ? (can('admin') ? '<button class="btn sm" data-act="fac-pause" data-v="0">Restart line</button>' : '') : '<button class="btn sm danger" data-act="fac-pause" data-v="1" title="Andon cord: stop agents acting on this product">Stop line</button>') : ''}
    ${can('admin') ? `<button class="btn sm ghost" data-act="fac-edit" data-id="${p.id}">${icon('settings')} Configure</button>` : ''}</div>
    <p class="small muted" style="margin:0 0 14px">${cfg.mode === 'sandbox' ? 'Sandbox: a simulated repo, CI, Cloudflare and Sentry with a deterministic stand-in model — safe for demos and tests.' : `GitHub <span class="mono">${esc(cfg.repo.owner)}/${esc(cfg.repo.name)}@${esc(cfg.repo.branch)}</span>${cfg.cloudflare ? ` · Worker <span class="mono">${esc(cfg.cloudflare.script)}</span>` : ' · no Cloudflare'}${cfg.sentry ? ` · Sentry <span class="mono">${esc(cfg.sentry.org)}/${esc(cfg.sentry.project)}</span>` : ' · no Sentry'} · connected: ${p.connected.map((c) => `<span class="chip ok">${esc(c)}</span>`).join(' ') || '<span class="chip warn">none</span>'}`}
      · Auto-merge ${pol.autoMerge ? `up to risk <strong>${pol.riskThreshold}</strong>` : '<strong>off</strong>'} · CI ${pol.requireCi ? 'required' : 'optional'} · auto-rollback ${pol.autoRollback ? 'on' : 'off'} · watch ${pol.monitorMinutes} min after release</p>`;

  const board = `<div class="factory-board">${LANES.map((l) => { const list = items.filter((i) => l.statuses.includes(i.status)); const c = crewInfo.crew[l.crew];
    return `<section class="lane" aria-label="${l.title}"><header>${crewHTML(c.mascot, 36, !running ? 'sleeping' : list.length && !['done', 'stopped'].includes(l.key) ? (l.key === 'human' ? 'thinking' : 'working') : l.key === 'done' && list.length ? 'happy' : 'idle')}<div><strong>${l.title}</strong><span class="small muted">${esc(c.name)}</span></div><span class="chip">${list.length}</span></header>
      ${list.slice(0, 12).map((i) => `<button class="fcard" data-act="fac-item" data-id="${i.id}"><span class="t">${esc(i.title)}</span><span class="row" style="gap:4px"><span class="chip ${SEV[i.severity]}">${esc(i.severity)}</span><span class="chip ${i.status === 'awaiting_approval' || i.status === 'needs_human' ? 'warn' : i.status === 'done' ? 'ok' : i.status === 'rolled_back' ? 'bad' : 'info'}">${STATUS_LABEL[i.status] || i.status}</span>${i.risk != null ? `<span class="chip">risk ${i.risk}</span>` : ''}</span><span class="xs muted">${esc(i.source)} · impact ${fmt(i.impact, 0)} · ${ago(i.updatedAt)}</span></button>`).join('') || '<p class="xs subtle" style="margin:6px 2px">Nothing here</p>'}</section>`; }).join('')}</div>`;

  const actorMascot = (a) => { const k = a.startsWith('agent:') ? a.slice(6) : null; return k && crewInfo.crew[k] ? crewHTML(crewInfo.crew[k].mascot, 28) : `<span class="avatar" style="width:28px;height:28px;font-size:10px">${a.startsWith('human') ? 'YOU' : 'SYS'}</span>`; };
  const feedHtml = `<h2 class="section-title">Live feed</h2><div class="card stack" style="gap:8px">${feed.map((e) => `<div class="row" style="gap:10px;align-items:flex-start;flex-wrap:nowrap">${actorMascot(e.actor)}<div style="min-width:0"><div class="small">${esc(e.message)}</div><div class="xs subtle">${ago(e.at)}${e.item_id ? ` · <button class="btn sm ghost" style="min-height:0;padding:0 4px" data-act="fac-item" data-id="${e.item_id}">open</button>` : ''}</div></div></div>`).join('') || '<p class="small muted">Quiet so far.</p>'}</div>`;

  const build = items.find((i) => i.kind === 'build');
  const tracker = build && (cfg.stage === 'building' || build.status !== 'done') ? buildTracker(build, crewInfo.crew, running) : '';
  return `${head}${metrics}${bar}${tracker}${board}${feedHtml}`;
}

export function itemDrawerHTML({ item, events }, { crew, can }) {
  const d = item.data; const c = (k) => crewHTML(crew[k].mascot, 30);
  const actor = (a) => (a.startsWith('agent:') && crew[a.slice(6)] ? c(a.slice(6)) : `<span class="avatar" style="width:30px;height:30px;font-size:10px">${a.startsWith('human') ? 'YOU' : 'SYS'}</span>`);
  return `<div class="stack"><div>${item.kind === 'build' ? '<span class="chip info">new product</span>' : `<span class="chip ${SEV[item.severity]}">${esc(item.severity)}</span>`} <span class="chip">${esc(STATUS_LABEL[item.status] || item.status)}</span>${item.risk != null ? ` <span class="chip">risk ${item.risk}</span>` : ''}</div>
    <h2 style="margin:0">${esc(item.title)}</h2>
    <div class="small muted">${item.kind === 'build' ? `Briefed ${ago(item.detectedAt)}` : `From ${esc(item.source)} · customer impact ${fmt(item.impact, 0)} · detected ${ago(item.detectedAt)}`}${item.url ? ` · <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}${item.pr?.url ? ` · <a href="${esc(item.pr.url)}" target="_blank" rel="noopener noreferrer">PR #${item.pr.number}</a>` : item.pr ? ` · PR #${item.pr.number}` : ''}</div>
    ${item.status === 'awaiting_approval' && can('editor') ? `<div class="banner">${icon('shield')}<div><strong>Release needs your approval.</strong> ${esc((d.risk?.factors || []).map((f) => `${f.why} (+${f.points})`).join(' · '))}</div></div><div class="row"><button class="btn primary" data-act="fac-approve" data-id="${item.id}">Approve &amp; merge</button><button class="btn danger" data-act="fac-reject" data-id="${item.id}">Reject</button></div>` : ''}
    ${item.status === 'plan_review' && can('editor') ? `<div class="banner info">${icon('info')}<div><strong>Review the plan.</strong> Approving lets the crew build it on a branch; nothing ships until you approve the launch.</div></div><div class="row"><button class="btn primary" data-act="fac-approve" data-id="${item.id}">Approve plan</button><button class="btn" data-act="fac-reject" data-id="${item.id}" data-ask="What should change in the plan?">Request changes</button></div>` : ''}
    ${item.status === 'launch_review' && can('editor') ? `<div class="banner">${icon('shield')}<div><strong>Ready to launch.</strong> CI passed and the reviewer signed off${d.reviewNotes ? `: “${esc(d.reviewNotes)}”` : ''}. Approving merges to main, which deploys it.</div></div><div class="row"><button class="btn primary" data-act="fac-approve" data-id="${item.id}">Approve launch</button><button class="btn danger" data-act="fac-reject" data-id="${item.id}">Decline</button></div>` : ''}
    ${d.prd ? `<div class="card stack">${c('strategist')}<h3>PRD — ${esc(d.prd.title || '')}</h3><p>${esc(d.prd.problem)}</p><p class="small muted">For: ${esc((d.prd.users || []).join(', '))}</p><ul class="small">${(d.prd.stories || []).map((x) => `<li>As ${esc(x.as)}, I want ${esc(x.want)}, so ${esc(x.so)}<br><span class="muted">✓ ${(x.acceptance || []).map(esc).join(' · ')}</span></li>`).join('')}</ul>${d.prd.nonGoals?.length ? `<p class="small"><strong>Not in v1:</strong> ${esc(d.prd.nonGoals.join(', '))}</p>` : ''}${d.prd.successMetrics?.length ? `<p class="small"><strong>Success:</strong> ${esc(d.prd.successMetrics.join(', '))}</p>` : ''}</div>` : ''}
    ${d.arch ? `<div class="card stack">${c('architect')}<h3>Architecture</h3><p>${esc(d.arch.summary)}</p>${d.arch.routes?.length ? `<p class="small"><strong>Routes:</strong> ${esc(d.arch.routes.join(' · '))}</p>` : ''}${d.arch.dataModel?.length ? `<p class="small"><strong>Data:</strong> ${esc(d.arch.dataModel.join(' · '))}</p>` : ''}<table><tbody>${d.arch.files.map((f) => `<tr><td class="mono">${esc(f.path)}</td><td class="small">${esc(f.purpose)}</td><td>${d.build?.done?.includes(f.path) ? '<span class="chip ok">written</span>' : '<span class="chip">planned</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${item.status === 'proposal' && can('editor') ? `<div class="row"><button class="btn primary" data-act="fac-build" data-id="${item.id}">Build it</button><button class="btn danger" data-act="fac-reject" data-id="${item.id}">Decline</button></div>` : ''}
    ${['needs_human', 'rolled_back'].includes(item.status) && can('editor') ? `<div class="row"><button class="btn" data-act="fac-build" data-id="${item.id}">Send back to the crew</button>${item.status === 'needs_human' ? `<button class="btn ghost danger" data-act="fac-reject" data-id="${item.id}">Close</button>` : ''}</div>` : ''}
    ${d.proposal ? `<div class="card stack">${c('advocate')}<h3>Proposal</h3><p><strong>Problem:</strong> ${esc(d.proposal.problem)}</p><p><strong>Proposal:</strong> ${esc(d.proposal.proposal)}</p><ul class="small">${(d.proposal.acceptanceCriteria || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul><p class="small muted">Value: ${esc(d.proposal.valueForCustomers)} · Effort ${esc(d.proposal.effort)}</p></div>` : ''}
    ${d.diagnosis ? `<div class="card"><h3>Root cause</h3><p>${esc(d.diagnosis.rootCause)}</p><p class="small muted">Files: ${d.diagnosis.files.map((f) => `<span class="mono">${esc(f)}</span>`).join(', ')}</p></div>` : ''}
    ${d.patch ? `<div class="card"><h3>Change</h3><p>${esc(d.patch.summary)} <span class="small muted">(${d.patch.stats.files} file, +${d.patch.stats.added} / −${d.patch.stats.removed})</span></p><details><summary class="small">Show diff</summary><pre class="out">${esc(d.patch.diff)}</pre></details></div>` : ''}
    <h3 style="margin-top:8px">Timeline</h3><div class="trace">${events.map((e) => `<div class="ev">${actor(e.actor)}<div class="bubble"><div class="small">${esc(e.message)}</div><div class="xs subtle">${new Date(e.at).toLocaleString()}</div></div></div>`).join('')}</div></div>`;
}

export function productEditorHTML(p, { defaultPolicy, providers, build = false, templates = [] }) {
  const cfg = p?.config || { mode: 'sandbox', policy: {} }; const pol = { ...defaultPolicy, ...(cfg.policy || {}) };
  const v = (x) => esc(x ?? ''); const opt = (pairs, cur) => pairs.map(([a, b]) => `<option value="${esc(a)}" ${a === cur ? 'selected' : ''}>${esc(b)}</option>`).join('');
  return `<form class="stack" data-form="fac-product" data-id="${v(p?.id)}"><h2>${p?.id ? 'Configure product' : build ? 'Build a new product' : 'Operate an existing product'}</h2>
    <label>Name<input name="name" required maxlength="100" value="${v(p?.name)}"></label>
    ${build ? `<input type="hidden" name="build" value="1"><label>Brief<textarea name="brief" required rows="6" maxlength="6000" placeholder="Who is it for, what problem does it solve, and what must the first release do?" style="font-family:var(--font-sans)"></textarea><span class="field-hint">The Product Strategist turns this into a PRD; you approve the plan before anything is built.</span></label>
    <label>Starter template<select name="template">${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.title)} — ${esc(t.description)}</option>`).join('')}</select><span class="field-hint">CI, deploy pipeline and config come from this vetted template; agents only write app code and tests.</span></label>` : ''}
    <label>Mode<select name="mode">${opt([['sandbox', 'Sandbox — simulated systems, safe'], ['real', 'Live — real GitHub, Cloudflare and Sentry']], cfg.mode)}</select>${build ? '<span class="field-hint">Live builds go into an existing repository you create on GitHub with a README (so the token needs no repo-creation rights).</span>' : ''}</label>
    <fieldset class="card stack" data-live ${cfg.mode === 'real' ? '' : 'hidden'}><legend class="small muted">Live connections</legend>
      <div class="row"><label style="flex:1">GitHub owner<input name="owner" value="${v(cfg.repo?.owner)}"></label><label style="flex:1">Repository<input name="repo" value="${v(cfg.repo?.name)}"></label><label style="width:120px">Branch<input name="branch" value="${v(cfg.repo?.branch || 'main')}"></label></div>
      <label>Issue label the crew watches<input name="issueLabel" value="${v(cfg.repo?.issueLabel || 'bug')}"></label>
      <div class="row"><label style="flex:2">Cloudflare account id<input name="accountId" value="${v(cfg.cloudflare?.accountId)}" class="mono"></label><label style="flex:1">Worker script<input name="script" value="${v(cfg.cloudflare?.script)}"></label></div>
      <div class="row"><label style="flex:1">Sentry org<input name="sentryOrg" value="${v(cfg.sentry?.org)}"></label><label style="flex:1">Sentry project<input name="sentryProject" value="${v(cfg.sentry?.project)}"></label><label style="flex:1">Sentry URL<input name="sentryUrl" value="${v(cfg.sentry?.baseUrl || 'https://sentry.io')}"></label></div>
      <div class="row"><label style="flex:1">Model provider<select name="provider">${opt([['', 'Choose…'], ...providers.map((x) => [x, x])], cfg.model?.provider || '')}</select></label><label style="flex:1">Model<input name="model" value="${v(cfg.model?.model)}" placeholder="e.g. claude-sonnet-4-5"></label></div>
      <p class="small muted">Tokens are encrypted on the server and never shown again. Use least privilege: GitHub fine-grained token with Contents, Pull requests, Issues (read/write) and Checks (read); Cloudflare token with Workers Scripts edit; Sentry token with project read and issue write.</p>
      <div class="row"><label style="flex:1">GitHub token<input name="tok_github" type="password" autocomplete="off" placeholder="${p?.connected?.includes('github') ? 'saved — leave blank to keep' : ''}"></label><label style="flex:1">Cloudflare token<input name="tok_cloudflare" type="password" autocomplete="off" placeholder="${p?.connected?.includes('cloudflare') ? 'saved' : ''}"></label><label style="flex:1">Sentry token<input name="tok_sentry" type="password" autocomplete="off" placeholder="${p?.connected?.includes('sentry') ? 'saved' : ''}"></label></div></fieldset>
    <fieldset class="card stack"><legend class="small muted">Guardrails</legend>
      <label class="toggle"><input type="checkbox" name="autoMerge" ${pol.autoMerge ? 'checked' : ''}> Let agents merge low-risk fixes</label>
      <label class="toggle"><input type="checkbox" name="requireCi" ${pol.requireCi ? 'checked' : ''}> Require passing CI before any merge</label>
      <label class="toggle"><input type="checkbox" name="autoRollback" ${pol.autoRollback ? 'checked' : ''}> Roll back automatically if a release causes errors</label>
      <div class="row"><label style="flex:1">Risk threshold<input type="number" name="riskThreshold" min="0" max="200" value="${pol.riskThreshold}"><span class="field-hint">Above this, a human must approve.</span></label><label style="flex:1">Watch after release (min)<input type="number" name="monitorMinutes" min="1" max="1440" value="${pol.monitorMinutes}"></label><label style="flex:1">Attempts before escalating<input type="number" name="maxAttempts" min="0" max="5" value="${pol.maxAttempts}"></label></div>
      <div class="row"><label style="flex:1">PRs / day<input type="number" name="maxPrsPerDay" min="0" max="100" value="${pol.maxPrsPerDay}"></label><label style="flex:1">Deploys / day<input type="number" name="maxDeploysPerDay" min="0" max="50" value="${pol.maxDeploysPerDay}"></label><label style="flex:1">Model tokens / day<input type="number" name="maxTokensPerDay" min="0" value="${pol.maxTokensPerDay}"></label></div>
      <label>Sensitive paths (always need a human)<input name="sensitivePaths" value="${v(pol.sensitivePaths.join(', '))}"></label></fieldset>
    <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="close">Cancel</button>${p ? `<span class="spacer"></span>${p.config.mode === 'sandbox' ? `<button class="btn ghost" type="button" data-act="fac-reset" data-id="${p.id}">Reset sandbox</button>` : ''}<button class="btn ghost danger" type="button" data-act="fac-delete" data-id="${p.id}">Remove</button>` : ''}</div>
    <p id="form-err" class="small" role="alert"></p></form>`;
}

export function collectProduct(f) {
  const v = (n) => (f.elements[n]?.value ?? '').trim(); const chk = (n) => !!f.elements[n]?.checked;
  const mode = v('mode');
  const config = { mode, model: { provider: v('provider'), model: v('model') }, policy: { autoMerge: chk('autoMerge'), requireCi: chk('requireCi'), autoRollback: chk('autoRollback'), riskThreshold: v('riskThreshold'), monitorMinutes: v('monitorMinutes'), maxAttempts: v('maxAttempts'), maxPrsPerDay: v('maxPrsPerDay'), maxDeploysPerDay: v('maxDeploysPerDay'), maxTokensPerDay: v('maxTokensPerDay'), sensitivePaths: v('sensitivePaths').split(',').map((s) => s.trim()).filter(Boolean) } };
  if (mode === 'real') {
    config.repo = { owner: v('owner'), name: v('repo'), branch: v('branch') || 'main', issueLabel: v('issueLabel') || 'bug' };
    if (v('accountId')) config.cloudflare = { accountId: v('accountId'), script: v('script') };
    if (v('sentryOrg')) config.sentry = { org: v('sentryOrg'), project: v('sentryProject'), baseUrl: v('sentryUrl') };
  }
  const tokens = Object.fromEntries(['github', 'cloudflare', 'sentry'].map((k) => [k, v(`tok_${k}`)]).filter(([, t]) => t));
  const build = f.elements.build ? { brief: v('brief'), template: v('template') } : undefined;
  return { name: v('name'), config, tokens, build };
}

const BUILD_STEPS = [
  ['Brief', 'strategist', ['brief']], ['Plan review', 'architect', ['plan_review']], ['Build', 'builder', ['building']],
  ['Test & review', 'review', ['verifying']], ['Launch review', 'release', ['launch_review']], ['Live', 'watch', ['launching', 'done']],
];
function buildTracker(item, crew, running) {
  const at = BUILD_STEPS.findIndex(([, , st]) => st.includes(item.status));
  const stuck = item.status === 'needs_human';
  return `<section class="card build-tracker" aria-label="Build progress"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">Building ${esc(item.title.replace(/^Build /, ''))}</h2><span class="small muted">${stuck ? 'The crew needs a human to continue.' : item.status === 'done' ? 'Launched — the crew now operates it.' : 'Briefed products get a PRD and plan you approve, then a tested build you approve before launch.'}</span></div>
    <button class="btn sm ${['plan_review', 'launch_review'].includes(item.status) || stuck ? 'primary' : ''}" data-act="fac-item" data-id="${item.id}">${item.status === 'plan_review' ? 'Review plan' : item.status === 'launch_review' ? 'Review launch' : 'Open'}</button></div>
    <ol class="steps">${BUILD_STEPS.map(([label, k], i) => { const state = stuck && i === Math.max(at, 0) ? 'stuck' : item.status === 'done' || i < at ? 'done' : i === at ? 'now' : 'todo';
      const mood = state === 'done' ? 'happy' : state === 'stuck' ? 'sad' : state === 'now' ? (['plan_review', 'launch_review'].includes(item.status) ? 'thinking' : running ? 'working' : 'sleeping') : 'idle';
      return `<li data-state="${state}">${crewHTML(crew[k].mascot, 40, mood)}<span>${label}</span></li>`; }).join('')}</ol></section>`;
}
