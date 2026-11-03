// HALYARD frontend — vanilla ES modules, no framework, no build step.
import { createRun, validateFlow } from './engine.js';
import { callModel, FRONTIER, LOCAL_DEFAULTS, WEBLLM_MODELS } from './providers.js';
import { crewHTML, setCrewState, SPECIES_LIST, ACCESSORY_LIST, MASCOT_STATES, ROLE_BADGES } from './mascot.js';
import { mcpClient, desktopConfig } from './mcp-client.js';
import { icon } from './icons.js';
import { factoryView, itemDrawerHTML, productEditorHTML, collectProduct } from './factory-view.js';

// ---------- utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const store = { get(k, d) { try { const v = localStorage.getItem('hy.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('hy.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };
const KIND_LABEL = { agent: 'Agents', flow: 'Flows', skill: 'Skills', mcp: 'MCP servers', context: 'Context', knowledge: 'Knowledge', memory: 'Memory' };
const CATALOG_FILES = { agent: 'agents', flow: 'flows', skill: 'skills', mcp: 'mcp', context: 'contexts', memory: 'memory' };

function toast(msg, kind = 'info') {
  let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div'); t.className = `toast ${kind}`;
  t.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'bad' ? 'alert' : 'info')}<span></span>`; t.querySelector('span').textContent = msg;
  box.append(t); setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 250); }, kind === 'bad' ? 5200 : 3200);
}
const okToast = (m) => toast(m, 'ok'); const errToast = (m) => toast(m, 'bad');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'x-halyard': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !path.startsWith('/api/auth/')) { S.me = null; render(); throw new Error('Signed out'); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 403 && data?.code === 'MFA_SETUP_REQUIRED') { S.mfaGate = true; if (S.route !== 'settings' || S.settingsTab !== 'security') { S.settingsTab = 'security'; location.hash = '#/settings'; } }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ---------- state ----------
const S = {
  me: null, org: null, health: null, route: location.hash.slice(2) || 'crew',
  catalog: {}, items: {}, lib: { kind: 'agent', q: '', domain: '', page: 0 }, ws: 'skill',
  prefs: store.get('prefs', { provider: 'dryrun', model: '', ollama: LOCAL_DEFAULTS.ollama, lmstudio: LOCAL_DEFAULTS.lmstudio }),
  run: null, kpiDays: 30, settingsTab: 'security',
};
const can = (role) => ({ viewer: 1, editor: 2, admin: 3 })[S.me?.role] >= ({ viewer: 1, editor: 2, admin: 3 })[role];

async function catalog(kind) {
  if (!S.catalog[kind]) S.catalog[kind] = await fetch(`/catalog/${CATALOG_FILES[kind]}.json`).then((r) => r.json());
  return S.catalog[kind];
}
async function items(kind, force = false) {
  if (force || !S.items[kind]) S.items[kind] = (await api(`/api/items?kind=${kind}`)).items;
  return S.items[kind];
}

// Agent resolution: an adapted workspace copy wins over the catalog original it was copied from.
async function resolveAgent(id) {
  const ws = await items('agent');
  const w = ws.find((a) => a.id === id) || ws.find((a) => a.sourceId === id);
  if (w) return { id: w.id, name: w.name, ...w.body };
  return (await catalog('agent')).find((a) => a.id === id) || null;
}
async function resolveRef(kind, id) {
  const ws = kind === 'knowledge' ? await items('knowledge') : await items(kind);
  const w = ws.find((x) => x.id === id) || ws.find((x) => x.sourceId === id);
  if (w) return { id: w.id, name: w.name, ...w.body };
  if (!CATALOG_FILES[kind]) return null;
  return (await catalog(kind)).find((x) => x.id === id) || null;
}

// ---------- shell ----------
const NAV = [['crew', 'crew', 'Crew', 'c'], ['library', 'library', 'Library', 'l'], ['flows', 'flows', 'Flows', 'f'], ['workspace', 'workspace', 'Workspace', 'w'], ['run', 'run', 'Run', 'r'], ['factory', 'factory', 'Factory', 'd'], ['value', 'value', 'Value', 'v'], ['settings', 'settings', 'Settings', 's']];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const currentTheme = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function shell(content) {
  return `<div class="app"><nav class="side" aria-label="Main">
    <div class="logo"><img src="/icon.svg" width="32" height="32" alt=""> Halyard</div>
    <button class="palette-trigger" data-act="palette">${icon('search', 'width="16" height="16"')} <span>Search…</span> <kbd>${isMac ? '⌘' : 'Ctrl'} K</kbd></button>
    ${NAV.map(([r, i, l]) => `<a class="nav" href="#/${r}" ${S.route === r ? 'aria-current="page"' : ''}>${icon(i)}<span>${l}</span></a>`).join('')}
    <div class="foot"><span class="avatar" aria-hidden="true">${esc(initials(S.me.name))}</span><div class="who"><strong>${esc(S.me.name)}</strong><span class="muted">${esc(S.me.role)}${S.me.mfaEnabled ? ' · MFA on' : ''}</span></div>
      <button class="btn sm ghost icon" data-act="theme-toggle" aria-label="Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
      <button class="btn sm ghost icon" data-act="logout" aria-label="Sign out">${icon('logout')}</button></div>
  </nav><main id="main">${content}</main></div>`;
}
const skeleton = (n = 6) => `<div class="head"><div class="skeleton" style="min-height:44px;width:260px"></div></div><div class="grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`;

async function render() {
  const root = $('#root');
  try {
    if (!S.health) S.health = await api('/api/health');
    if (!S.me) {
      try { const r = await api('/api/auth/me'); S.me = r.user; S.org = r.org; } catch { /* not signed in */ }
    }
    if (!S.me) { root.innerHTML = authView(); return; }
    const view = VIEWS[S.route] || VIEWS.crew;
    root.innerHTML = shell(skeleton());
    const html = await view();
    $('#main').innerHTML = `<div class="page">${html}</div>`;
    document.title = `${(NAV.find(([r]) => r === S.route) || [, , 'Halyard'])[2]} · Halyard`;
    afterRender[S.route]?.();
  } catch (e) { if (e.message !== 'Signed out') root.innerHTML = shell(`<div class="card"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`); }
}
window.addEventListener('hashchange', () => { S.route = location.hash.slice(2).split('?')[0] || 'crew'; render(); });

// ---------- auth ----------
const AUTH_CREW = [['otter', '#4f8cff', 'glasses', 'code'], ['owl', '#22b07d', 'none', 'search'], ['fox', '#ff6fae', 'flower', 'chat'], ['penguin', '#3fa7ff', 'scarf', 'rocket'], ['robot', '#8e6cff', 'headset', 'shield']];
function authView() {
  const setup = S.health?.needsSetup;
  const lineup = `<div class="lineup">${AUTH_CREW.map(([sp, c, a, bd], i) => crewHTML({ species: sp, color: c, accessory: a, nickname: sp, badge: bd }, 60, i === 2 ? 'waving' : 'idle')).join('')}</div>`;
  if (S.mfaChallenge) return `<div class="auth"><form class="card stack" data-form="mfa">${lineup}
    <h1 style="text-align:center">Two-step check</h1><p class="muted" style="text-align:center">${S.useRecovery ? 'Enter one of your recovery codes. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}</p>
    ${S.useRecovery ? '<label>Recovery code<input name="code" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxxx-xxxxx" class="mono"></label>'
      : '<label class="sr-only" for="otp">Authentication code</label><input id="otp" name="code" class="otp" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" autofocus>'}
    <button class="btn primary" type="submit">Verify</button>
    <div class="row" style="justify-content:space-between"><button type="button" class="btn sm ghost" data-act="mfa-toggle-recovery">${S.useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button><button type="button" class="btn sm ghost" data-act="mfa-cancel">Back</button></div>
    <p class="small" id="auth-err" role="alert"></p></form></div>`;
  return `<div class="auth"><form class="card stack" data-form="${setup ? 'bootstrap' : 'login'}">${lineup}
    <div style="text-align:center"><h1>${setup ? 'Welcome aboard' : 'Welcome back'}</h1><div class="muted small">Halyard · agent &amp; harness workbench</div></div>
    ${setup ? `<p class="small muted">First run: create the admin account and organisation.</p>
      <label>Organisation<input name="org" required maxlength="100" value="My organisation"></label>
      <label>Your name<input name="name" required maxlength="100" autocomplete="name"></label>` : ''}
    <label>Email<input name="email" type="email" required autocomplete="username"></label>
    <label>Password<input name="password" type="password" required minlength="${setup ? 12 : 1}" autocomplete="${setup ? 'new-password' : 'current-password'}"></label>
    ${setup ? '<p class="small muted">At least 12 characters with a letter and a number.</p><label>Setup token (if your operator set one)<input name="setupToken" autocomplete="off"></label>' : ''}
    <button class="btn primary" type="submit">${setup ? 'Create admin & sign in' : 'Sign in'}</button>
    <p class="small" id="auth-err" role="alert"></p></form></div>`;
}

// ---------- CREW ----------
function agentCard(a, { workspace = false } = {}) {
  const body = workspace ? a.body : a;
  const m = body.mascot || {};
  return `<article class="card agent interactive" data-id="${esc(a.id)}">
    <div class="top">${crewHTML(m, 64, 'idle', `${m.nickname || ''} the ${m.species || ''}`)}<div><h3>${esc(a.name)}</h3><div class="nick">${esc(m.nickname || '')} the ${esc(m.species || 'agent')} · ${esc(body.domain || 'Custom')}</div></div></div>
    <p>${esc(body.goal || body.description || '')}</p>
    <div class="row small"><span class="chip">⏱ ~${esc(body.value?.minutesSavedPerRun ?? 0)} min/run</span>${body.model?.provider ? `<span class="chip">${esc(body.model.provider)}</span>` : ''}</div>
    <div class="actions">${workspace
      ? `<a class="btn sm primary" href="#/run" data-act="run-target" data-target="agent:${esc(a.id)}">Run</a><button class="btn sm" data-act="edit" data-kind="agent" data-id="${esc(a.id)}">Edit</button><button class="btn sm" data-act="dup" data-kind="agent" data-id="${esc(a.id)}">Duplicate</button><button class="btn sm danger" data-act="del" data-kind="agent" data-id="${esc(a.id)}">Delete</button>`
      : `<button class="btn sm" data-act="lib-open" data-kind="agent" data-id="${esc(a.id)}">Details</button><button class="btn sm primary" data-act="copy" data-kind="agent" data-id="${esc(a.id)}">Copy</button><button class="btn sm" data-act="adapt" data-kind="agent" data-id="${esc(a.id)}">Copy &amp; adapt</button>`}</div>
  </article>`;
}
const VIEWS = {};
const afterRender = {};

VIEWS.crew = async () => {
  const ws = await items('agent', true);
  let k = null; try { if (!S.mfaGate) k = await api('/api/kpis?days=7'); } catch { /* KPIs optional here */ }
  const hour = new Date().getHours(); const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lineup = ws.slice(0, 6).map((a, i) => crewHTML(a.body.mascot, 64, i === 0 ? 'waving' : 'idle')).join('');
  return `<section class="hero"><div><h1>${greet}, ${esc(S.me.name.split(' ')[0])}</h1><p class="muted">${ws.length ? `Your crew of ${ws.length} is ready.` : 'Let’s assemble your first crew.'} Press <kbd>${isMac ? '⌘' : 'Ctrl'} K</kbd> to jump anywhere.</p>
      ${k ? `<div class="stats"><div class="stat"><b>${fmt(k.adoption.runs)}</b><span>runs this week</span></div><div class="stat"><b>${fmt(k.value.hoursSavedEst, 1)}</b><span>hours saved <span class="est">EST</span></span></div><div class="stat"><b>${pct(k.output.acceptanceRate)}</b><span>accepted</span></div></div>` : ''}</div>
      ${lineup ? `<div class="lineup" aria-hidden="true">${lineup}</div>` : ''}</section>
    <div class="head"><div><h2>Your crew</h2><p class="muted small">Each agent has its own character, skills, tools and value model. Hover to say hello.</p></div>
    <div class="row">${can('editor') ? `<button class="btn" data-act="new" data-kind="agent">${icon('plus')} New agent</button><button class="btn dark" data-act="starter">Add starter crew</button>` : ''}<a class="btn primary" href="#/library">Browse library</a></div></div>
    ${ws.length ? `<div class="grid">${ws.map((a) => agentCard(a, { workspace: true })).join('')}</div>`
      : `<div class="card empty"><div class="row" style="justify-content:center">${AUTH_CREW.map(([sp, c, a, bd]) => crewHTML({ species: sp, nickname: sp, color: c, accessory: a, badge: bd }, 64, 'sleeping')).join('')}</div>
        <h2>Your crew is napping</h2><p>Wake them up: add a starter crew of ten, copy from ${S.catalog.agent?.length || 210} library agents, or design your own.</p>${can('editor') ? '<button class="btn primary" data-act="starter">Add starter crew</button>' : ''}</div>`}`;
};

// ---------- LIBRARY ----------
const PAGE = 24;
function libItemCard(kind, x) {
  if (kind === 'agent') return agentCard(x);
  const meta = kind === 'mcp' ? `${x.category} · ${x.ecosystem}${x.monthlyDownloads ? ` · ${fmt(x.monthlyDownloads)}/mo` : ''}` : kind === 'flow' ? `${x.pattern} · ${countSteps(x.steps)} steps` : kind === 'memory' ? `${x.scope} scope · ${x.retentionDays} days` : x.domain || '';
  return `<article class="card agent interactive"><div class="top"><span class="item-icon">${icon(kind)}</span><div><h3>${esc(x.title || x.name)}</h3><div class="nick">${esc(meta)}</div></div></div><p>${esc(x.description || '')}</p>
    <div class="actions"><button class="btn sm" data-act="lib-open" data-kind="${kind}" data-id="${esc(x.id)}">Details</button>${can('editor') ? `<button class="btn sm primary" data-act="copy" data-kind="${kind}" data-id="${esc(x.id)}">Copy</button><button class="btn sm" data-act="adapt" data-kind="${kind}" data-id="${esc(x.id)}">Copy &amp; adapt</button>` : ''}</div></article>`;
}
function countSteps(steps = []) { return steps.reduce((n, s) => n + 1 + countSteps(s.branches || s.body || Object.values(s.routes || {})), 0); }
VIEWS.library = async () => {
  const L = S.lib; const all = await catalog(L.kind);
  const domains = [...new Set(all.map((x) => x.domain || x.category).filter(Boolean))].sort();
  const q = L.q.toLowerCase();
  const list = all.filter((x) => (!L.domain || (x.domain || x.category) === L.domain) && (!q || `${x.name} ${x.title || ''} ${x.description || ''} ${x.goal || ''}`.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(list.length / PAGE)); L.page = Math.min(L.page, pages - 1);
  const counts = (await fetch('/catalog/index.json').then((r) => r.json())).counts;
  const countKey = { agent: 'agents', flow: 'flows', skill: 'skills', mcp: 'mcp', context: 'contexts', memory: 'memory' };
  return `<div class="head"><div><h1>Library</h1><p class="muted">Pre-built, curated building blocks. Copy as-is or copy &amp; adapt into your workspace.</p></div></div>
    <div class="tabs" role="tablist">${Object.keys(CATALOG_FILES).map((k) => `<button class="tab" role="tab" aria-selected="${L.kind === k}" data-act="lib-kind" data-kind="${k}">${KIND_LABEL[k]} <span class="chip">${counts[countKey[k]]}</span></button>`).join('')}</div>
    ${L.kind === 'mcp' ? '<div class="banner">Every MCP server here is a real package, confirmed on npm or PyPI on 2026-11-01 (see <span class="mono">catalog-src/mcp-verified.json</span>). They run as stdio processes — copy one, then export a desktop-client config, or register an HTTP endpoint to call it from flows.</div>' : ''}
    ${L.kind === 'context' || L.kind === 'memory' ? `<div class="banner">These are ${L.kind === 'context' ? 'fill-in context templates' : 'memory schemas with scope, retention and write policy'} per domain — structure, not pre-filled facts. Copy one and add your organisation’s content.</div>` : ''}
    <div class="row" style="margin-bottom:14px"><input class="search" type="search" placeholder="Search ${esc(KIND_LABEL[L.kind].toLowerCase())}…" value="${esc(L.q)}" data-input="lib-q" aria-label="Search">
      <select data-input="lib-domain" aria-label="Filter" style="max-width:260px"><option value="">All ${L.kind === 'mcp' ? 'categories' : 'domains'}</option>${domains.map((d) => `<option ${d === L.domain ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
      <span class="muted small">${list.length} match${list.length === 1 ? '' : 'es'}</span></div>
    <div class="grid">${list.slice(L.page * PAGE, L.page * PAGE + PAGE).map((x) => libItemCard(L.kind, x)).join('') || '<p class="muted">Nothing matches.</p>'}</div>
    <div class="pager"><button class="btn sm" data-act="page" data-d="-1" ${L.page === 0 ? 'disabled' : ''}>Previous</button><span class="small muted">Page ${L.page + 1} of ${pages}</span><button class="btn sm" data-act="page" data-d="1" ${L.page >= pages - 1 ? 'disabled' : ''}>Next</button></div>`;
};

async function openLibDetail(kind, id) {
  const x = (await catalog(kind)).find((i) => i.id === id); if (!x) return;
  let body = '';
  if (kind === 'agent') body = `<div class="row">${crewHTML(x.mascot, 80, 'waving')}<div><h2>${esc(x.name)}</h2><div class="muted">${esc(x.mascot.nickname)} the ${esc(x.mascot.species)} · ${esc(x.domain)}</div></div></div>
    <p>${esc(x.goal)}</p><h3>System prompt</h3><pre class="out">${esc(x.systemPrompt)}</pre><h3>Skills</h3><p>${x.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')}</p>
    <h3>Suggested MCP categories</h3><p>${x.mcpCategories.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')}</p><p class="small muted">Estimated time saved per accepted run: ${x.value.minutesSavedPerRun} min (editable after copying).</p>`;
  else if (kind === 'flow') body = `<h2>${esc(x.name)}</h2><p>${esc(x.description)}</p><div class="stack">${await flowTree(x.steps)}</div>`;
  else if (kind === 'skill') body = `<h2>${esc(x.title)}</h2><pre class="out">${esc(x.body)}</pre>`;
  else if (kind === 'mcp') body = `<h2>${esc(x.name)}</h2><p>${esc(x.description)}</p><table><tr><th>Category</th><td>${esc(x.category)}</td></tr><tr><th>Registry</th><td><a href="${esc(x.source)}" target="_blank" rel="noopener noreferrer">${esc(x.source)}</a></td></tr>${x.repo ? `<tr><th>Repository</th><td><a href="${esc(x.repo)}" target="_blank" rel="noopener noreferrer">${esc(x.repo)}</a></td></tr>` : ''}<tr><th>Run with</th><td class="mono">${esc(x.config.command)} ${esc(x.config.args.join(' '))}</td></tr><tr><th>Verified</th><td>${esc(x.verified.at)}</td></tr></table>
    <p class="small muted">Review a server’s permissions and source before connecting it to production data. Many need API keys passed as environment variables.</p>`;
  else if (kind === 'context') body = `<h2>${esc(x.name)}</h2><p>${esc(x.description)}</p><pre class="out">${esc(x.body)}</pre>`;
  else if (kind === 'memory') body = `<h2>${esc(x.name)}</h2><p>${esc(x.description)}</p><h3>Schema</h3><pre class="out">${esc(JSON.stringify(x.schema, null, 2))}</pre><h3>Write policy</h3><p>${esc(x.writePolicy)}</p>`;
  drawer(`${body}<div class="row" style="margin-top:16px">${can('editor') ? `<button class="btn primary" data-act="copy" data-kind="${kind}" data-id="${esc(id)}">Copy to workspace</button><button class="btn" data-act="adapt" data-kind="${kind}" data-id="${esc(id)}">Copy &amp; adapt</button>` : ''}<button class="btn ghost" data-act="close">Close</button></div>`);
}

function catalogToBody(kind, x) {
  switch (kind) {
    case 'agent': return { domain: x.domain, goal: x.goal, mascot: x.mascot, systemPrompt: x.systemPrompt, skills: x.skills, contexts: [], memory: [], knowledge: [], mcp: [], mcpCategories: x.mcpCategories, model: { provider: '', model: '' }, value: x.value };
    case 'flow': return { description: x.description, pattern: x.pattern, steps: x.steps };
    case 'skill': return { description: x.description, domain: x.domain, body: x.body };
    case 'mcp': return { description: x.description, category: x.category, package: x.name, config: x.config, repo: x.repo, url: '', authorization: '' };
    case 'context': return { description: x.description, domain: x.domain, body: x.body };
    case 'memory': return { description: x.description, scope: x.scope, retentionDays: x.retentionDays, schema: x.schema, writePolicy: x.writePolicy, entries: [] };
  }
}
async function copyFromCatalog(kind, id) {
  const x = (await catalog(kind)).find((i) => i.id === id);
  const r = await api('/api/items', { method: 'POST', body: { kind, name: x.title && kind !== 'mcp' ? x.title : x.name, sourceId: id, body: catalogToBody(kind, x) } });
  S.items[kind] = null; return r.item;
}

// ---------- FLOWS ----------
async function flowTree(steps, depth = 0) {
  const out = [];
  for (const s of steps || []) {
    let label = '';
    if (s.agent) { const a = await resolveAgent(s.agent); label = a ? `${crewHTML(a.mascot, 30)} ${esc(a.name)}` : `<span class="chip bad">missing agent ${esc(s.agent)}</span>`; }
    let kids = '';
    if (s.type === 'parallel') kids = await flowTree(s.branches, depth + 1);
    if (s.type === 'loop') kids = await flowTree(s.body, depth + 1);
    if (s.type === 'router') kids = (await Promise.all(Object.entries(s.routes).map(async ([k, v]) => `<div><span class="chip">when “${esc(k)}”</span>${await flowTree([v], depth + 1)}</div>`))).join('');
    const extra = s.type === 'loop' ? ` · until “${esc(s.until)}” · max ${esc(s.max)}` : s.type === 'approval' ? ` · ${esc(s.message || '')}` : '';
    out.push(`<div class="step"><div class="step-type">${esc(s.type)}${extra}</div><div class="row" style="gap:6px;margin-top:4px">${label}</div>${kids ? `<div class="kids">${kids}</div>` : ''}</div>`);
  }
  return out.join('');
}
VIEWS.flows = async () => {
  const ws = await items('flow', true);
  return `<div class="head"><div><h1>Flows &amp; harnesses</h1><p class="muted">Orchestrate agents with sequential, parallel, router, maker–checker loop and human-approval steps.</p></div>
    <div class="row">${can('editor') ? '<button class="btn" data-act="new" data-kind="flow">New flow</button>' : ''}<button class="btn primary" data-act="lib-goto" data-kind="flow">Flow library</button></div></div>
    ${ws.length ? `<div class="grid">${ws.map((f) => `<article class="card agent"><h3>${esc(f.name)}</h3><div class="nick">${esc(f.body.pattern || 'custom')} · ${countSteps(f.body.steps)} steps · v${f.version}</div><p>${esc(f.body.description || '')}</p>
      <div class="actions"><a class="btn sm primary" href="#/run" data-act="run-target" data-target="flow:${esc(f.id)}">Run</a>${can('editor') ? `<button class="btn sm" data-act="edit" data-kind="flow" data-id="${esc(f.id)}">Edit</button><button class="btn sm danger" data-act="del" data-kind="flow" data-id="${esc(f.id)}">Delete</button>` : ''}</div></article>`).join('')}</div>`
      : '<div class="card"><h2>No flows yet</h2><p class="muted">Copy one of 52 pre-built harnesses from the library, or start a new one.</p></div>'}`;
};

// ---------- WORKSPACE (skills, mcp, context, knowledge, memory) ----------
VIEWS.workspace = async () => {
  const k = S.ws; const ws = await items(k, true);
  return `<div class="head"><div><h1>Workspace</h1><p class="muted">Manage the skills, tools, context, knowledge and memory your agents use.</p></div>
    ${can('editor') ? `<div class="row"><button class="btn" data-act="new" data-kind="${k}">New ${esc(KIND_LABEL[k].toLowerCase().replace(/s$/, ''))}</button>${CATALOG_FILES[k] ? `<button class="btn primary" data-act="lib-goto" data-kind="${k}">From library</button>` : ''}${k === 'mcp' ? '<button class="btn" data-act="mcp-export">Export desktop config</button>' : ''}</div>` : ''}</div>
    <div class="tabs" role="tablist">${['skill', 'mcp', 'context', 'knowledge', 'memory'].map((x) => `<button class="tab" role="tab" aria-selected="${k === x}" data-act="ws-kind" data-kind="${x}">${KIND_LABEL[x]}</button>`).join('')}</div>
    ${k === 'knowledge' ? '<div class="banner">Knowledge documents are chunked and the most relevant passages are added to an agent’s context at run time (keyword retrieval, entirely in your browser).</div>' : ''}
    ${ws.length ? `<div class="card table-card table-wrap"><table><thead><tr><th>Name</th><th>Details</th><th>Version</th><th>Updated</th><th></th></tr></thead><tbody>
      ${ws.map((x) => `<tr><td><strong>${esc(x.name)}</strong>${x.sourceId ? `<div class="small muted">from ${esc(x.sourceId)}</div>` : ''}</td><td class="small muted">${esc(wsDetail(k, x.body))}</td><td>v${x.version}</td><td class="small">${new Date(x.updatedAt).toLocaleString()}</td>
      <td style="white-space:nowrap">${can('editor') ? `<button class="btn sm" data-act="edit" data-kind="${k}" data-id="${esc(x.id)}">Edit</button> <button class="btn sm danger" data-act="del" data-kind="${k}" data-id="${esc(x.id)}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="card"><p class="muted">No ${esc(KIND_LABEL[k].toLowerCase())} yet.</p></div>`}`;
};
function wsDetail(k, b) {
  if (k === 'mcp') return b.url ? `HTTP · ${b.url}` : `stdio · ${b.config?.command || ''} ${(b.config?.args || []).join(' ')}`;
  if (k === 'knowledge') return `${fmt((b.text || '').length)} characters`;
  if (k === 'memory') return `${b.scope || 'team'} scope · ${(b.entries || []).length} entries · ${b.retentionDays || '∞'} days`;
  return b.description || '';
}

// ---------- EDITOR ----------
const PROVIDER_OPTS = () => [['', 'Workspace default'], ['dryrun', 'Dry run (offline, no model)'], ...FRONTIER.map((p) => [p, `${p} (frontier, via server)`]), ['ollama', 'Ollama (local)'], ['lmstudio', 'LM Studio (local)'], ['webllm', 'WebLLM (WebGPU, in browser)']];
const opt = (pairs, v) => pairs.map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`).join('');
async function refOptions() {
  const ids = async (k) => [...(await items(k)).map((x) => [x.id, `${x.name} (workspace)`]), ...(CATALOG_FILES[k] ? (await catalog(k)).map((x) => [x.id, x.title || x.name]) : [])];
  return { skill: await ids('skill'), context: await ids('context'), memory: await ids('memory'), knowledge: await ids('knowledge'), mcp: (await items('mcp')).filter((m) => m.body.url).map((m) => [m.id, m.name]) };
}
function chipsField(name, label, values, options) {
  return `<div class="stack" data-chips="${name}"><label>${label}<input list="dl-${name}" placeholder="Type to search, Enter to add" data-chip-input="${name}"></label>
    <datalist id="dl-${name}">${options.slice(0, 2000).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</datalist>
    <div class="row" data-chip-list="${name}">${(values || []).map((v) => `<span class="chip" data-v="${esc(v)}">${esc(v)} <button type="button" class="btn sm ghost" data-act="chip-rm" aria-label="Remove ${esc(v)}">×</button></span>`).join('')}</div></div>`;
}
const readChips = (form, name) => $$(`[data-chip-list="${name}"] .chip`, form).map((c) => c.dataset.v);

async function openEditor(kind, id) {
  const it = id ? (await items(kind)).find((x) => x.id === id) : null;
  const b = it ? structuredClone(it.body) : {};
  const name = it?.name || '';
  let f = '';
  if (kind === 'agent') {
    const m = b.mascot || { species: 'otter', color: '#4f8cff', accessory: 'none', nickname: 'Pip' };
    const r = await refOptions();
    f = `<div class="row"><div class="stack" style="align-items:center"><div id="mascot-preview">${crewHTML(m, 96)}</div><div class="row" style="gap:4px;max-width:150px;justify-content:center">${MASCOT_STATES.map((st) => `<button type="button" class="btn sm ghost" data-act="preview-state" data-v="${st}">${st}</button>`).join('')}</div></div><div class="stack" style="flex:1">
        <label>Name<input name="name" required maxlength="200" value="${esc(name)}"></label>
        <div class="row"><label style="flex:1">Nickname<input name="nickname" maxlength="30" value="${esc(m.nickname || '')}" data-mascot></label>
        <label style="flex:1">Character<select name="species" data-mascot>${opt(SPECIES_LIST.map((s) => [s, s]), m.species)}</select></label></div>
        <div class="row"><label style="flex:1">Accessory<select name="accessory" data-mascot>${opt(ACCESSORY_LIST.map((s) => [s, s]), m.accessory)}</select></label><label style="flex:1">Role badge<select name="badge" data-mascot>${opt([['', 'none'], ...ROLE_BADGES.map((s) => [s, s])], m.badge || '')}</select></label><label style="width:90px">Colour<input type="color" name="color" value="${esc(m.color || '#4f8cff')}" data-mascot></label></div></div></div>
      <label>Goal<input name="goal" maxlength="300" value="${esc(b.goal || '')}"></label>
      <label>System prompt<textarea name="systemPrompt" rows="8" required>${esc(b.systemPrompt || 'You are a helpful agent. Never invent facts; ask for missing inputs.')}</textarea></label>
      <div class="row"><label style="flex:1">Model provider<select name="provider">${opt(PROVIDER_OPTS(), b.model?.provider || '')}</select></label><label style="flex:1">Model<input name="model" value="${esc(b.model?.model || '')}" placeholder="e.g. claude-sonnet-4-5, llama3.2"></label></div>
      ${chipsField('skills', 'Skills', b.skills, r.skill)}${chipsField('contexts', 'Context packs', b.contexts, r.context)}${chipsField('knowledge', 'Knowledge', b.knowledge, r.knowledge)}${chipsField('memory', 'Memory', b.memory, r.memory)}${chipsField('mcp', 'MCP servers (HTTP endpoints in workspace)', b.mcp, r.mcp)}
      <label>Estimated minutes of manual work one accepted run replaces<input type="number" name="minutes" min="0" max="100000" value="${esc(b.value?.minutesSavedPerRun ?? 15)}"></label>
      <p class="small muted">This assumption drives the Value dashboard. Base it on a timed sample of the manual task.</p>`;
  } else if (kind === 'flow') {
    f = `<label>Name<input name="name" required maxlength="200" value="${esc(name)}"></label><label>Description<input name="description" value="${esc(b.description || '')}"></label>
      <div class="row"><span class="small muted">Add step:</span>${['agent', 'parallel', 'router', 'loop', 'approval'].map((t) => `<button type="button" class="btn sm" data-act="flow-add" data-t="${t}">${t}</button>`).join('')}<button type="button" class="btn sm dark" data-act="flow-check">Validate &amp; preview</button></div>
      <label>Steps (JSON)<textarea name="steps" rows="16" spellcheck="false">${esc(JSON.stringify(b.steps || [], null, 2))}</textarea></label>
      <div id="flow-preview" class="stack"></div>
      <p class="small muted">Agent ids can be workspace agents or library agents (e.g. <span class="mono">eng.code-reviewer</span>). Prompts support {{input}}, {{prev}} and {{steps.&lt;id&gt;}}.</p>`;
  } else if (kind === 'mcp') {
    f = `<label>Name<input name="name" required maxlength="200" value="${esc(name)}"></label><label>Description<input name="description" value="${esc(b.description || '')}"></label>
      <label>HTTP endpoint (Streamable HTTP)<input name="url" type="url" placeholder="https://example.com/mcp" value="${esc(b.url || '')}"></label>
      <label>Authorization header (optional, stored in this item)<input name="authorization" value="${esc(b.authorization || '')}" autocomplete="off"></label>
      <div class="row"><label style="flex:1">stdio command<input name="command" value="${esc(b.config?.command || '')}"></label><label style="flex:2">args (space separated)<input name="args" value="${esc((b.config?.args || []).join(' '))}"></label></div>
      <button type="button" class="btn" data-act="mcp-test">Test HTTP connection</button><div id="mcp-test-out" class="small"></div>`;
  } else if (kind === 'knowledge') {
    f = `<label>Name<input name="name" required maxlength="200" value="${esc(name)}"></label><label>Description<input name="description" value="${esc(b.description || '')}"></label>
      <label>Upload text (.md, .txt, .csv, .json)<input type="file" accept=".md,.txt,.csv,.json,text/*" data-act-change="kn-file"></label>
      <label>Content<textarea name="text" rows="14">${esc(b.text || '')}</textarea></label>`;
  } else if (kind === 'memory') {
    f = `<label>Name<input name="name" required maxlength="200" value="${esc(name)}"></label><label>Description<input name="description" value="${esc(b.description || '')}"></label>
      <div class="row"><label style="flex:1">Scope<select name="scope">${opt([['user', 'user'], ['agent', 'agent'], ['team', 'team']], b.scope || 'team')}</select></label><label style="flex:1">Retention (days)<input type="number" name="retentionDays" min="1" max="3650" value="${esc(b.retentionDays || 365)}"></label></div>
      <label>Write policy<input name="writePolicy" value="${esc(b.writePolicy || 'Only store facts stated by a user or verified by a tool. Never store secrets.')}"></label>
      <label>Entries (one per line — injected into attached agents)<textarea name="entries" rows="10">${esc((b.entries || []).map((e) => e.text || e).join('\n'))}</textarea></label>`;
  } else {
    f = `<label>Name<input name="name" required maxlength="200" value="${esc(name)}"></label><label>Description<input name="description" value="${esc(b.description || '')}"></label>
      <label>${kind === 'skill' ? 'SKILL.md' : 'Content'}<textarea name="body" rows="18">${esc(b.body || (kind === 'skill' ? '---\nname: my-skill\ndescription: What this skill does and when to use it.\n---\n\n# My skill\n\n## Steps\n1. \n' : ''))}</textarea></label>`;
  }
  drawer(`<form class="stack" data-form="save" data-kind="${kind}" data-id="${esc(id || '')}" data-version="${it?.version || ''}">
    <h2>${it ? 'Edit' : 'New'} ${esc(KIND_LABEL[kind].replace(/s$/, '').toLowerCase())}</h2>${it?.sourceId ? `<p class="small muted">Adapted from library item <span class="mono">${esc(it.sourceId)}</span>. Flows that reference the original now use this copy.</p>` : ''}
    ${f}<div class="row"><button class="btn primary" type="submit">Save</button><button class="btn ghost" type="button" data-act="close">Cancel</button>${it ? `<button class="btn ghost" type="button" data-act="versions" data-id="${esc(it.id)}">History (v${it.version})</button>` : ''}</div><p id="form-err" role="alert" class="small"></p></form>`);
}

function collect(form, kind, prev = {}) {
  const v = (n) => form.elements[n]?.value ?? '';
  if (kind === 'agent') return { ...prev, goal: v('goal'), systemPrompt: v('systemPrompt'), mascot: { species: v('species'), accessory: v('accessory'), color: v('color'), nickname: v('nickname'), badge: v('badge') },
    model: { provider: v('provider'), model: v('model') }, skills: readChips(form, 'skills'), contexts: readChips(form, 'contexts'), knowledge: readChips(form, 'knowledge'), memory: readChips(form, 'memory'), mcp: readChips(form, 'mcp'),
    value: { minutesSavedPerRun: Math.max(0, Number(v('minutes')) || 0) } };
  if (kind === 'flow') { let steps; try { steps = JSON.parse(v('steps')); } catch { throw new Error('Steps must be valid JSON'); } return { ...prev, description: v('description'), steps }; }
  if (kind === 'mcp') return { ...prev, description: v('description'), url: v('url').trim(), authorization: v('authorization'), config: { command: v('command'), args: v('args').split(/\s+/).filter(Boolean) } };
  if (kind === 'knowledge') return { ...prev, description: v('description'), text: v('text') };
  if (kind === 'memory') return { ...prev, description: v('description'), scope: v('scope'), retentionDays: Number(v('retentionDays')) || 365, writePolicy: v('writePolicy'), entries: v('entries').split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ text })) };
  return { ...prev, description: v('description'), body: v('body') };
}

// ---------- RUN CONSOLE ----------
VIEWS.run = async () => {
  const [wa, wf, cf] = [await items('agent', true), await items('flow', true), await catalog('flow')];
  const sel = S.runTarget || (wa[0] ? `agent:${wa[0].id}` : wf[0] ? `flow:${wf[0].id}` : `flow:${cf[0].id}`);
  const P = S.prefs;
  return `<div class="head"><div><h1>Run</h1><p class="muted">Run an agent or a flow. Every run is metered for tokens, cost, latency, output and estimated value.</p></div></div>
    ${!can('editor') ? '<div class="banner">Viewers can browse runs and KPIs. Ask an admin for the editor role to run agents.</div>' : ''}
    <div class="card stack"><div class="row"><label style="flex:2;min-width:240px">What to run<select name="target" data-input="run-target">
      <optgroup label="Workspace agents">${wa.map((a) => `<option value="agent:${esc(a.id)}" ${sel === `agent:${a.id}` ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>
      <optgroup label="Workspace flows">${wf.map((f) => `<option value="flow:${esc(f.id)}" ${sel === `flow:${f.id}` ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup>
      <optgroup label="Library flows">${cf.map((f) => `<option value="flow:${esc(f.id)}" ${sel === `flow:${f.id}` ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup></select></label>
      <label style="flex:1;min-width:180px">Default provider<select data-input="pref-provider">${opt(PROVIDER_OPTS().slice(1), P.provider)}</select></label>
      <label style="flex:1;min-width:160px">Default model<input data-input="pref-model" value="${esc(P.model)}" placeholder="${P.provider === 'webllm' ? WEBLLM_MODELS[0] : 'model name'}" list="dl-webllm"></label><datalist id="dl-webllm">${WEBLLM_MODELS.map((m) => `<option value="${m}">`).join('')}</datalist></div>
      <p class="small muted">Agents with their own model use it; others use this default. “Dry run” checks a flow’s wiring without calling any model and is labelled in every output.</p>
      <label>Input<textarea id="run-input" rows="5" placeholder="Describe the task, paste material, or give the brief…">${esc(S.lastInput || '')}</textarea></label>
      <div class="row"><button class="btn primary" data-act="run-go" ${!can('editor') ? 'disabled' : ''}>Run</button><button class="btn" data-act="run-stop" disabled id="run-stop">Stop</button><span id="run-status" class="small muted"></span></div></div>
    <div id="run-area" style="margin-top:16px"></div>`;
};

async function knowledgeFor(ids, input) {
  const terms = new Set(String(input).toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  const chunks = [];
  for (const id of ids || []) {
    const k = await resolveRef('knowledge', id); if (!k?.text) continue;
    for (let i = 0; i < k.text.length; i += 900) {
      const t = k.text.slice(i, i + 1000); const score = [...terms].filter((w) => t.toLowerCase().includes(w)).length;
      chunks.push({ score, body: `From “${k.name}”:\n${t}` });
    }
  }
  return chunks.sort((a, b) => b.score - a.score).slice(0, 4).filter((c) => c.score > 0 || chunks.length <= 4);
}

async function startRun() {
  const [kind, id] = ($('[data-input="run-target"]').value || '').split(':');
  const input = $('#run-input').value.trim(); if (!input) return toast('Add some input first.');
  S.lastInput = input;
  let flow;
  if (kind === 'flow') { flow = (await items('flow')).find((f) => f.id === id); flow = flow ? { name: flow.name, ...flow.body } : (await catalog('flow')).find((f) => f.id === id); }
  else { const a = await resolveAgent(id); flow = { name: a.name, steps: [{ id: 'agent', type: 'agent', agent: id, prompt: '{{input}}' }] }; }
  const errs = validateFlow(flow); if (errs.length) return toast(`Flow is invalid: ${errs[0]}`);
  const refs = []; const collectRefs = (steps) => { for (const st of steps || []) { if (st.agent && !refs.includes(st.agent)) refs.push(st.agent); collectRefs(st.branches || st.body || Object.values(st.routes || {})); } }; collectRefs(flow.steps);
  const cast = (await Promise.all(refs.map(async (r) => [r, await resolveAgent(r)]))).filter(([, a]) => a);
  const area = $('#run-area');
  area.innerHTML = `<div class="card"><div class="crew-stage" aria-label="Crew on this run">${cast.map(([r, a]) => `<div class="member" data-ref="${esc(r)}">${crewHTML(a.mascot, 64, 'idle', `${a.mascot?.nickname || a.name}`)}<span class="status" aria-live="polite"></span><span class="tag">${esc(a.name)}</span></div>`).join('')}</div><div class="trace" id="trace"></div></div>`;
  const member = (ref) => (ref ? $(`.crew-stage .member[data-ref="${CSS.escape(ref)}"]`, area) : null);
  const act = (ref, state, label = '', revert = 0) => { const m = member(ref); if (!m) return; $$('.crew-stage .member', area).forEach((x) => { x.dataset.active = x === m ? '1' : '0'; }); setCrewState(m.querySelector('.crew'), state, revert); m.querySelector('.status').textContent = label; };
  const trace = $('#trace'); const status = $('#run-status'); const ctrl = new AbortController();
  $('#run-stop').disabled = false; $('#run-stop').onclick = () => ctrl.abort();
  const mcpCache = new Map(); let lastAgentModel = { provider: S.prefs.provider, model: S.prefs.model };
  const add = (html) => { trace.insertAdjacentHTML('beforeend', html); trace.lastElementChild.scrollIntoView({ block: 'nearest' }); };
  const engine = createRun({
    signal: ctrl.signal,
    getAgent: resolveAgent,
    async resolveAgentEnv(agent) {
      const skills = (await Promise.all((agent.skills || []).map((s) => resolveRef('skill', s)))).filter(Boolean);
      const contexts = (await Promise.all((agent.contexts || []).map((s) => resolveRef('context', s)))).filter(Boolean);
      contexts.push(...(await knowledgeFor(agent.knowledge, input)));
      const memories = (await Promise.all((agent.memory || []).map((s) => resolveRef('memory', s)))).filter(Boolean).flatMap((m) => (m.entries || []).map((e) => e.text || e));
      const tools = [];
      for (const mid of agent.mcp || []) {
        const m = (await items('mcp')).find((x) => x.id === mid); if (!m?.body.url) continue;
        try {
          if (!mcpCache.has(mid)) { const cl = mcpClient(api, { url: m.body.url, authorization: m.body.authorization }); await cl.connect(); mcpCache.set(mid, { cl, tools: await cl.listTools() }); }
          for (const t of mcpCache.get(mid).tools) tools.push({ server: mid, name: t.name, description: (t.description || '').slice(0, 200) });
        } catch (e) { add(`<div class="small muted">MCP ${esc(m.name)} unavailable: ${esc(e.message)}</div>`); }
      }
      return { skills, contexts, memories, tools };
    },
    async callModel(agent, system, messages) {
      const prov = agent.model?.provider || S.prefs.provider; const model = agent.model?.model || S.prefs.model;
      if (prov !== 'dryrun' && !model) throw new Error(`No model set for ${agent.name}. Choose a default model or set one on the agent.`);
      lastAgentModel = { provider: prov, model };
      return callModel({ provider: prov, model, baseUrl: S.prefs[prov] }, system, messages, { api, onProgress: (t) => { status.textContent = t; } });
    },
    async callTool(server, tool, args) { const c = mcpCache.get(server); if (!c) throw new Error('Unknown MCP server'); return c.cl.callTool(tool, args); },
    approve: (message, output) => approvalModal(message, output),
    onEvent(e) {
      if (e.type === 'step.start') { status.textContent = `${e.agent} is working…`; act(e.ref, 'working', 'working'); add(`<div class="ev" data-step="${esc(e.step)}">${crewHTML(e.mascot, 44, 'thinking')}<div class="bubble"><strong>${esc(e.agent)}</strong> <span class="small muted">thinking…</span></div></div>`); }
      if (e.type === 'step.done') { act(e.ref, 'talking', 'done', 1600); const el = $$(`.ev[data-step="${CSS.escape(e.step)}"]`, trace).pop(); if (el) { setCrewState(el.querySelector('.crew'), 'talking', 1600); el.querySelector('.bubble').innerHTML = `<strong>${esc(e.agent)}</strong><pre class="out">${esc(e.output)}</pre>`; } }
      if (e.type === 'tool.call') { act(e.ref, 'tool', 'using tool'); add(`<div class="small muted">🔧 ${esc(e.tool)} called</div>`); }
      if (e.type === 'tool.result') act(e.ref, 'working', 'working');
      if (e.type === 'approval.wait') act(e.ref, 'thinking', 'waiting for you');
      if (e.type === 'route') add(`<div class="small"><span class="chip">routed → ${esc(e.label)}</span></div>`);
      if (e.type === 'loop.iteration') add(`<div class="small"><span class="chip">loop round ${e.iteration}</span></div>`);
      if (e.type === 'loop.exit') add(`<div class="small"><span class="chip ok">loop exit: ${esc(e.reason)}</span></div>`);
      if (e.type === 'approval.result') add(`<div class="small"><span class="chip ${e.approved ? 'ok' : 'bad'}">${e.approved ? 'approved' : 'rejected'}</span></div>`);
    },
  });
  status.textContent = 'Starting…';
  const res = await engine.run(flow, input);
  $('#run-stop').disabled = true; status.textContent = '';
  $$('.crew-stage .member', area).forEach((m) => { m.dataset.active = '0'; m.querySelector('.status').textContent = res.status === 'succeeded' ? 'nice!' : res.status; setCrewState(m.querySelector('.crew'), res.status === 'succeeded' ? 'happy' : 'sad', 5000); });
  const target = kind === 'flow' ? flow : await resolveAgent(id);
  const minutes = kind === 'flow' ? res.metrics.minutesSaved : Number(target.value?.minutesSavedPerRun) || 0;
  const provider = res.metrics.models.length === 1 ? res.metrics.models[0].split('/')[0] : res.metrics.models.length ? 'mixed' : lastAgentModel.provider;
  const model = res.metrics.models.length === 1 ? res.metrics.models[0].split('/').slice(1).join('/') : res.metrics.models.join(', ').slice(0, 120);
  let runId = null, cost = 0;
  try { const r = await api('/api/runs', { method: 'POST', body: { targetKind: kind, targetId: id, targetName: flow.name, status: res.status, provider, model, steps: res.metrics.steps, tokensIn: res.metrics.tokensIn, tokensOut: res.metrics.tokensOut, latencyMs: res.latencyMs, outputs: res.metrics.outputs, outputChars: res.metrics.outputChars, minutesSaved: minutes } }); runId = r.id; cost = r.costUsd; } catch (e) { toast(`Run not recorded: ${e.message}`); }
  const mems = (await items('memory')).map((m) => [m.id, m.name]);
  area.insertAdjacentHTML('beforeend', `<div class="card stack" style="margin-top:14px" data-run="${esc(runId || '')}">
    <div class="row"><h2 style="margin:0">Result</h2><span class="chip ${res.status === 'succeeded' ? 'ok' : 'bad'}">${esc(res.status)}</span>${res.error ? `<span class="small">${esc(res.error)}</span>` : ''}</div>
    <pre class="out">${esc(res.output)}</pre>
    <div class="row small"><span class="chip">${fmt(res.metrics.tokensIn)} in / ${fmt(res.metrics.tokensOut)} out tokens${provider === 'dryrun' ? ' (estimated)' : ''}</span><span class="chip">${(res.latencyMs / 1000).toFixed(1)} s</span><span class="chip">${res.metrics.calls} model calls</span><span class="chip">${cost ? `$${cost}` : 'cost: unpriced or local'}</span>${res.status === 'succeeded' ? `<span class="chip">${provider === 'dryrun' ? 'dry run — excluded from value' : `~${fmt(minutes)} min saved if accepted <span class="est">EST</span>`}</span>` : ''}</div>
    ${runId && res.status === 'succeeded' ? `<div class="row"><span class="small muted">Was this output useful?</span><button class="btn sm" data-act="accept" data-v="1">✅ Accept</button><button class="btn sm" data-act="accept" data-v="0">❌ Reject</button>
      <span class="small muted">Rate</span>${[1, 2, 3, 4, 5].map((n) => `<button class="btn sm ghost" data-act="rate" data-v="${n}" aria-label="${n} stars">${'★'.repeat(n)}</button>`).join('')}</div>
      ${mems.length ? `<div class="row"><select id="mem-target" style="max-width:280px">${opt(mems, '')}</select><button class="btn sm" data-act="remember">Save a note to memory</button></div>` : ''}` : ''}</div>`);
  S.lastOutput = res.output;
}

function approvalModal(message, output) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div'); scrim.className = 'scrim modal-scrim';
    const m = document.createElement('div'); m.className = 'modal card stack'; m.role = 'dialog'; m.ariaModal = 'true';
    m.innerHTML = `<h2>Human approval</h2><p>${esc(message)}</p><pre class="out">${esc(String(output ?? '').slice(0, 4000))}</pre><div class="row"><button class="btn primary" data-v="1">Approve</button><button class="btn danger" data-v="0">Reject</button></div>`;
    document.body.append(scrim, m); m.querySelector('button').focus();
    m.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; scrim.remove(); m.remove(); resolve(b.dataset.v === '1'); });
  });
}

// ---------- VALUE (KPIs) ----------
function deltaChip(d, invert = false) {
  if (d == null) return '<span class="sub">no prior period</span>';
  const up = d >= 0; const good = invert ? !up : up;
  return `<span class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}%</span> <span class="sub">vs previous ${S.kpiDays} days</span>`;
}
function kpiCard(label, val, sub = '', est = false) { return `<div class="card kpi"><div class="label">${label} ${est ? '<span class="est">EST</span>' : ''}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`; }
function barChart(series, key, color, label) {
  const W = 720, H = 180, pad = 26; const max = Math.max(1, ...series.map((s) => s[key])); const bw = (W - pad * 2) / series.length;
  const bars = series.map((s, i) => { const h = ((H - pad * 2) * s[key]) / max; return `<rect x="${pad + i * bw + 1}" y="${H - pad - h}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" fill="${color}"><title>${s.date}: ${s[key]}</title></rect>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per day"><line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="currentColor" opacity=".2"/>${bars}
    <text x="${pad}" y="14" font-size="11" fill="currentColor" opacity=".7">${esc(label)} · max ${fmt(max, 2)}</text><text x="${pad}" y="${H - 8}" font-size="10" fill="currentColor" opacity=".6">${series[0]?.date || ''}</text><text x="${W - pad}" y="${H - 8}" font-size="10" text-anchor="end" fill="currentColor" opacity=".6">${series.at(-1)?.date || ''}</text></svg>`;
}
VIEWS.value = async () => {
  const k = await api(`/api/kpis?days=${S.kpiDays}`); const cur = k.window.currency;
  const money = (v) => (v == null ? '—' : `${cur} ${fmt(v)}`);
  return `<div class="head"><div><h1>Value &amp; adoption</h1><p class="muted">Leadership view of usage, consumption, output quality and estimated value.</p></div>
    <div class="row"><select data-input="kpi-days" aria-label="Window">${opt([['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 365 days']], String(S.kpiDays))}</select><a class="btn" href="/api/kpis.csv" download>Export runs (CSV)</a></div></div>
    ${k.notes.map((n) => `<div class="banner">${esc(n)}</div>`).join('')}${k.testRuns ? `<p class="small muted">${fmt(k.testRuns)} dry run(s) in this window are excluded.</p>` : ''}
    <h2 class="section-title">Adoption</h2><div class="grid kpi">
      ${kpiCard('Active users', fmt(k.adoption.activeUsers), deltaChip(k.trend.activeUsers))}${kpiCard('Runs', fmt(k.adoption.runs), deltaChip(k.trend.runs))}
      ${kpiCard('Runs per active user', fmt(k.adoption.runsPerActiveUser, 1))}${kpiCard('Agents in use', `${fmt(k.adoption.agentsUsed)} <span class="sub">of ${fmt(k.adoption.agentsInWorkspace)}</span>`, `${fmt(k.adoption.flowsUsed)} flows used`)}</div>
    <h2 class="section-title">Consumption</h2><div class="grid kpi">
      ${kpiCard('Tokens', fmt(k.consumption.tokensIn + k.consumption.tokensOut), `${fmt(k.consumption.tokensIn)} in · ${fmt(k.consumption.tokensOut)} out`)}${kpiCard('Model spend', `$${fmt(k.consumption.costUsd, 2)}`, deltaChip(k.trend.costUsd, true))}
      ${kpiCard('Avg run time', `${fmt(k.consumption.avgLatencyMs / 1000, 1)} s`)}${kpiCard('Local / on-device share', pct(k.consumption.localShare), 'runs that used no paid API')}</div>
    <h2 class="section-title">Output &amp; quality</h2><div class="grid kpi">
      ${kpiCard('Outputs produced', fmt(k.output.outputs))}${kpiCard('Success rate', pct(k.output.successRate))}
      ${kpiCard('Acceptance rate', pct(k.output.acceptanceRate), `${fmt(k.output.reviewedRuns)} runs reviewed`)}${kpiCard('Avg rating', k.output.avgRating == null ? '—' : `${k.output.avgRating} / 5`)}</div>
    <h2 class="section-title">Value</h2><div class="grid kpi">
      ${kpiCard('Hours saved', fmt(k.value.hoursSavedEst, 1), deltaChip(k.trend.hoursSavedEst), true)}${kpiCard('Value of time saved', money(k.value.valueEst), k.window.hourlyRate ? `at ${cur} ${k.window.hourlyRate}/h` : 'set an hourly rate in Settings', true)}
      ${kpiCard('ROI', k.value.roiEst == null ? '—' : `${fmt(k.value.roiEst, 1)}×`, 'value ÷ model spend', true)}${kpiCard('Cost per accepted output', k.value.costPerAcceptedOutput == null ? '—' : `$${fmt(k.value.costPerAcceptedOutput, 4)}`)}</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:16px">
      <div class="card chart">${barChart(k.series, 'runs', 'var(--accent)', 'Runs')}</div><div class="card chart">${barChart(k.series, 'hoursSavedEst', 'var(--ok)', 'Hours saved (est.)')}</div></div>
    <h2 class="section-title">Top agents &amp; flows by value</h2>
    <div class="card table-card table-wrap"><table><thead><tr><th>Agent / flow</th><th>Runs</th><th>Accepted</th><th>Rejected</th><th>Tokens</th><th>Spend</th><th>Hours saved (est.)</th></tr></thead><tbody>
      ${k.topTargets.map((t) => `<tr><td>${esc(t.key.split(':').slice(1).join(':'))} <span class="chip">${esc(t.key.split(':')[0])}</span></td><td>${t.runs}</td><td>${t.accepted}</td><td>${t.rejected}</td><td>${fmt(t.tokens)}</td><td>$${fmt(t.costUsd, 4)}</td><td>${fmt(t.hoursSavedEst, 1)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No runs in this window yet.</td></tr>'}</tbody></table></div>
    <h2 class="section-title">By provider / model</h2>
    <div class="card table-card table-wrap"><table><thead><tr><th>Provider / model</th><th>Runs</th><th>Tokens</th><th>Spend</th></tr></thead><tbody>
      ${k.byModel.map((t) => `<tr><td class="mono">${esc(t.key)}</td><td>${t.runs}</td><td>${fmt(t.tokens)}</td><td>$${fmt(t.costUsd, 4)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}</tbody></table></div>
    <p class="small muted" style="margin-top:14px">How value is measured: each agent carries an editable “minutes of manual work replaced per accepted run” (a flow counts each participating agent once). Hours saved = sum over ${k.window.valueBasis === 'accepted' ? 'runs marked accepted' : 'succeeded runs not marked rejected'}; dry runs never count. Value = hours × your hourly rate. ROI = value ÷ model spend. Spend uses the per-model prices an admin enters in Settings; local and WebGPU runs cost $0 in API fees.</p>`;
};

// ---------- SETTINGS ----------
VIEWS.settings = async () => {
  const t = S.settingsTab; const tabs = [['security', 'Security'], ['models', 'Models'], ['value', 'Value model'], ['team', 'Team'], ['keys', 'API keys'], ['audit', 'Audit log'], ['design', 'Design system']];
  let body = '';
  if (t === 'models') {
    const s = await api('/api/secrets'); const P = S.prefs;
    body = `<div class="card stack"><h2>Frontier providers</h2><p class="small muted">Keys are encrypted with AES-256-GCM on the server and never sent to browsers. Only admins can change them.</p>
      <div class="table-wrap"><table><thead><tr><th>Provider</th><th>Status</th><th></th></tr></thead><tbody>${s.providers.map((p) => { const c = s.configured.find((x) => x.provider === p); return `<tr><td>${esc(p)}${c?.base_url ? `<div class="small mono">${esc(c.base_url)}</div>` : ''}</td><td>${c ? '<span class="chip ok">configured</span>' : '<span class="chip">not set</span>'}</td><td>${can('admin') ? `<button class="btn sm" data-act="secret-set" data-p="${p}">${c ? 'Replace' : 'Add key'}</button>${c ? ` <button class="btn sm danger" data-act="secret-del" data-p="${p}">Remove</button>` : ''}` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>
      <div class="card stack" style="margin-top:14px"><h2>Local &amp; on-device models (this browser)</h2>
      <label>Ollama base URL<input data-input="pref-ollama" value="${esc(P.ollama)}"></label><label>LM Studio base URL<input data-input="pref-lmstudio" value="${esc(P.lmstudio)}"></label>
      <p class="small muted">Local servers are called directly from your browser, so your prompts never pass through the Halyard server. For Ollama, allow this site’s origin with <span class="mono">OLLAMA_ORIGINS</span>. WebLLM runs models in this tab on WebGPU (first load downloads the model).</p>
      <p class="small">WebGPU in this browser: ${'gpu' in navigator ? '<span class="chip ok">available</span>' : '<span class="chip bad">not available</span>'}</p></div>`;
  } else if (t === 'value') {
    const s = S.org.settings;
    body = `<form class="card stack" data-form="org-settings"><h2>Value model</h2><p class="small muted">These assumptions turn usage into the leadership KPIs. Keep them conservative and documented.</p>
      <div class="row"><label style="flex:1">Loaded hourly rate<input type="number" name="hourlyRate" min="0" step="1" value="${esc(s.hourlyRate ?? '')}" placeholder="e.g. 85"></label><label style="width:120px">Currency<input name="currency" maxlength="3" value="${esc(s.currency || 'USD')}"></label></div>
      <label>Count value for<select name="valueBasis">${opt([['accepted', 'Runs a person marked accepted (conservative)'], ['not-rejected', 'Succeeded runs not marked rejected']], s.valueBasis || 'accepted')}</select></label>
      <label>Model prices (USD per 1M tokens) — one per line: <span class="mono">provider/model in out</span><textarea name="prices" rows="8" placeholder="anthropic/claude-sonnet-4-5 3 15">${esc(Object.entries(s.prices || {}).map(([k, v]) => `${k} ${v.in} ${v.out}`).join('\n'))}</textarea></label>
      <p class="small muted">Enter prices from your provider’s current price page or contract. Halyard ships no default prices because they change and vary by agreement; unpriced runs are flagged on the dashboard.</p>
      ${can('admin') ? '<button class="btn primary" type="submit">Save</button>' : '<p class="small">Only admins can change these.</p>'}</form>`;
  } else if (t === 'team') {
    if (!can('admin')) body = '<div class="card">Only admins can manage the team.</div>';
    else { const u = await api('/api/users');
      body = `<div class="card table-card table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>MFA</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${u.users.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td><select data-act-change="user-role" data-id="${x.id}" ${x.id === S.me.id ? 'disabled' : ''}>${opt([['viewer', 'viewer'], ['editor', 'editor'], ['admin', 'admin']], x.role)}</select></td><td>${x.mfaEnabled ? '<span class="chip ok">on</span>' : '<span class="chip warn">off</span>'}</td><td>${x.disabled ? '<span class="chip bad">disabled</span>' : '<span class="chip ok">active</span>'}</td><td class="small">${x.lastLoginAt ? new Date(x.lastLoginAt).toLocaleString() : '—'}</td><td style="white-space:nowrap">${x.id !== S.me.id ? `${x.mfaEnabled ? `<button class="btn sm ghost" data-act="mfa-reset" data-id="${x.id}">Reset MFA</button> ` : ''}<button class="btn sm" data-act="user-toggle" data-id="${x.id}" data-d="${x.disabled ? 0 : 1}">${x.disabled ? 'Enable' : 'Disable'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="card stack" style="margin-top:16px"><label class="toggle"><input type="checkbox" data-act-change="require-mfa" ${S.org.settings.requireMfa ? 'checked' : ''}> Require multi-factor authentication for everyone</label>
      <p class="small muted">People without MFA can still sign in, but they can only reach Settings → Security until they set it up. Turn on your own MFA first.</p></div>
      <form class="card stack" data-form="user-new" style="margin-top:14px"><h2>Add a team member</h2><div class="row"><label style="flex:1">Name<input name="name" required></label><label style="flex:1">Email<input name="email" type="email" required></label><label style="width:140px">Role<select name="role">${opt([['viewer', 'viewer'], ['editor', 'editor'], ['admin', 'admin']], 'editor')}</select></label></div><button class="btn primary" type="submit">Add</button><p id="user-new-out" class="small"></p></form>`; }
  } else if (t === 'keys') {
    if (!can('editor')) body = '<div class="card">Editors and admins can create API keys.</div>';
    else { const k = await api('/api/keys');
      body = `<div class="card stack"><h2>API keys</h2><p class="small muted">Use <span class="mono">Authorization: Bearer hy_…</span> to call the API from scripts and CI. Keys carry your role.</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>${k.keys.map((x) => `<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.prefix)}…</td><td class="small">${new Date(x.created_at).toLocaleDateString()}</td><td class="small">${x.last_used_at ? new Date(x.last_used_at).toLocaleString() : '—'}</td><td>${x.revoked ? '<span class="chip">revoked</span>' : `<button class="btn sm danger" data-act="key-revoke" data-id="${x.id}">Revoke</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No keys.</td></tr>'}</tbody></table></div>
      <form class="row" data-form="key-new"><input name="name" placeholder="Key name, e.g. CI pipeline" required style="max-width:300px"><button class="btn primary" type="submit">Create key</button></form><p id="key-out" class="mono small"></p></div>`; }
  } else if (t === 'audit') {
    if (!can('admin')) body = '<div class="card">Only admins can view the audit log.</div>';
    else { const a = await api('/api/audit?limit=300');
      body = `<div class="card stack"><div class="row"><h2 style="margin:0">Audit log</h2><button class="btn sm" data-act="audit-verify">Verify hash chain</button><a class="btn sm" href="/api/export" download="halyard-export.json">Export org data (JSON)</a><span id="audit-out" class="small"></span></div>
      <p class="small muted">Append-only and hash-chained: each entry includes the hash of the previous one, so edits or deletions are detectable.</p>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>When</th><th>Action</th><th>Target</th><th>User</th><th>IP</th></tr></thead><tbody>${a.entries.map((e) => `<tr><td>${e.seq}</td><td class="small">${new Date(e.at).toLocaleString()}</td><td class="mono">${esc(e.action)}</td><td class="small mono">${esc(e.target || '')}</td><td class="small mono">${esc(e.user_id || '')}</td><td class="small">${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>`; }
  } else if (t === 'design') {
    body = styleguide();
  } else {
    const st = await api('/api/auth/mfa/status');
    body = `${S.mfaGate && !st.enabled ? `<div class="banner danger">${icon('shield')}<div><strong>Your organisation requires MFA.</strong> Set it up below to continue using Halyard.</div></div>` : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
      <div class="card stack" id="mfa-card"><div class="row"><span class="item-icon">${icon('shield')}</span><div><h2 style="margin:0">Two-step sign-in</h2><span class="small muted">Authenticator app codes (TOTP)</span></div><span class="spacer"></span>${st.enabled ? '<span class="chip ok">On</span>' : '<span class="chip warn">Off</span>'}</div>
      ${st.enabled ? `<p class="small muted">You’ll be asked for a code from your authenticator app when you sign in. ${st.recoveryCodesLeft} recovery code${st.recoveryCodesLeft === 1 ? '' : 's'} left.</p>
        <form class="stack" data-form="mfa-regen"><label>Current code<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></label><button class="btn" type="submit">New recovery codes</button></form>
        ${S.org.settings.requireMfa ? '<p class="small muted">Your organisation requires MFA, so it can’t be turned off.</p>' : `<details><summary class="small">Turn off two-step sign-in</summary><form class="stack" data-form="mfa-disable" style="margin-top:8px"><label>Password<input type="password" name="password" required autocomplete="current-password"></label><label>Code or recovery code<input name="code" required autocomplete="one-time-code"></label><button class="btn danger" type="submit">Turn off</button></form></details>`}`
      : `<p class="small muted">Add a second step so a stolen password isn’t enough. Works with any authenticator app (1Password, Authy, Google or Microsoft Authenticator…).</p><button class="btn primary" data-act="mfa-setup">${icon('shield')} Set up two-step sign-in</button>`}
      <div id="mfa-setup-area"></div></div>
      <form class="card stack" data-form="password"><h2>Password</h2><label>Current password<input type="password" name="current" required autocomplete="current-password"></label><label>New password<input type="password" name="next" required minlength="12" autocomplete="new-password"><span class="field-hint">At least 12 characters with a letter and a number.</span></label><button class="btn" type="submit">Change password</button><p class="small muted">Changing your password signs you out everywhere.</p></form>
      <div class="card stack"><h2>Appearance</h2><div class="tabs" role="radiogroup" aria-label="Theme" style="margin:0">${['system', 'light', 'dark'].map((m) => `<button class="tab" role="radio" aria-selected="${store.get('theme', 'system') === m}" data-act="theme" data-v="${m}">${m}</button>`).join('')}</div>
      <p class="small muted">Shortcuts: <kbd>${isMac ? '⌘' : 'Ctrl'} K</kbd> command palette · <kbd>g</kbd> then <kbd>c</kbd> <kbd>l</kbd> <kbd>f</kbd> <kbd>w</kbd> <kbd>r</kbd> <kbd>v</kbd> <kbd>s</kbd> to jump · <kbd>?</kbd> all shortcuts.</p></div></div>`;
  }
  return `<div class="head"><div><h1>Settings</h1><p class="muted small">${esc(S.me.name)} · ${esc(S.me.role)} · ${esc(S.org?.name || '')}</p></div><button class="btn" data-act="logout">Sign out</button></div><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${t === k}" data-act="set-tab" data-v="${k}">${l}</button>`).join('')}</div>${body}`;
};

// ---------- FACTORY ----------
VIEWS.factory = () => factoryView({ api, S, can });
let factoryTimer = null;
afterRender.factory = () => {
  clearInterval(factoryTimer);
  factoryTimer = setInterval(async () => {
    if (S.route !== 'factory') return clearInterval(factoryTimer);
    if ($('.drawer, .modal, .palette') || document.hidden || document.activeElement?.closest?.('select, input')) return;
    try { const html = await factoryView({ api, S, can }); const m = $('#main'); if (m && S.route === 'factory') m.innerHTML = `<div>${html}</div>`; } catch { /* next poll */ }
  }, 8000);
};
async function openFactoryItem(id) { const r = await api(`/api/factory/items/${id}`); drawer(itemDrawerHTML(r, { crew: S.factory.crew, can })); }
async function factoryAct(act, el) {
  const pid = S.factory?.product;
  if (act === 'fac-product') { S.factory.product = el.dataset.id; return render(); }
  if (act === 'fac-item') return openFactoryItem(el.dataset.id);
  if (act === 'fac-new' || act === 'fac-edit') { const p = act === 'fac-edit' ? S.factory.products.find((x) => x.id === el.dataset.id) : null; return drawer(productEditorHTML(p, { defaultPolicy: S.factory.defaultPolicy, providers: ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'custom'], build: el.dataset.v === 'build', templates: S.factory.templates || [] })); }
  if (act === 'fac-tick') { el.setAttribute('aria-busy', 'true'); const r = await api(`/api/factory/products/${pid}/tick`, { method: 'POST', body: {} }); toast(r.result?.skipped ? 'The crew is already working — try again in a moment.' : `Crew ran: ${r.result?.ingested || 0} new, ${r.result?.advanced || 0} steps advanced${r.result?.errors ? `, ${r.result.errors} errors` : ''}.`, r.result?.errors ? 'bad' : 'ok'); return render(); }
  if (act === 'fac-inject') { const sc = $('[data-input="fac-scenario"]').value; await api(`/api/factory/products/${pid}/sandbox/inject`, { method: 'POST', body: { scenario: sc } }); okToast(`Injected “${sc}”. Running the crew…`); return factoryAct('fac-tick', el); }
  if (act === 'fac-pause') { const stop = el.dataset.v === '1'; const reason = stop ? prompt('Why are you stopping the line? (optional)') : ''; if (stop && reason === null) return; await api(`/api/factory/products/${pid}/pause`, { method: 'POST', body: { paused: stop, reason } }); toast(stop ? 'Line stopped. Agents will observe but not act.' : 'Line restarted.', stop ? 'bad' : 'ok'); return render(); }
  if (act === 'fac-all') { const stop = el.dataset.v === '1'; if (stop && !confirm('Stop every factory line? Agents will keep observing but take no actions until an admin restarts.')) return; await api('/api/factory/pause-all', { method: 'POST', body: { paused: stop } }); return render(); }
  if (act === 'fac-approve') { el.setAttribute('aria-busy', 'true'); await api(`/api/factory/items/${el.dataset.id}/approve`, { method: 'POST', body: {} }); closeDrawer(); okToast('Approved. The crew is on it.'); return render(); }
  if (act === 'fac-reject') { const reason = prompt(el.dataset.ask || 'Reason (shared on the PR):'); if (reason === null) return; await api(`/api/factory/items/${el.dataset.id}/reject`, { method: 'POST', body: { reason } }); closeDrawer(); toast('Rejected.'); return render(); }
  if (act === 'fac-build') { await api(`/api/factory/items/${el.dataset.id}/build`, { method: 'POST', body: {} }); closeDrawer(); okToast('Sent to the crew.'); return render(); }
  if (act === 'fac-reset') { if (!confirm('Reset the sandbox world and clear its work items?')) return; await api(`/api/factory/products/${el.dataset.id}/sandbox/reset`, { method: 'POST', body: {} }); closeDrawer(); return render(); }
  if (act === 'fac-delete') { if (!confirm('Remove this product from the factory? Its stored tokens are deleted.')) return; await api(`/api/factory/products/${el.dataset.id}`, { method: 'DELETE' }); closeDrawer(); S.factory.product = null; return render(); }
}

// ---------- living style guide ----------
function styleguide() {
  const sw = (n, v) => `<div class="swatch"><div style="background:var(${v})"></div><span><strong>${n}</strong><br><span class="mono">${v}</span></span></div>`;
  const demo = { species: 'otter', color: '#4f8cff', accessory: 'glasses', nickname: 'Pip', badge: 'code' };
  return `<div class="stack" style="gap:24px">
    <div class="banner info">${icon('palette')}<div><strong>Harbor</strong> is Halyard’s design system. Tokens live in <span class="mono">public/css/tokens.css</span>, components in <span class="mono">components.css</span>, crew animation in <span class="mono">crew.css</span>. Full guide: <span class="mono">docs/design-system.md</span>.</div></div>
    <section><h2>Colour</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${[['Brand', '--brand'], ['Accent', '--accent'], ['Success', '--success'], ['Warning', '--warning'], ['Danger', '--danger'], ['Background', '--bg'], ['Raised', '--bg-raised'], ['Sunken', '--bg-sunken'], ['Text', '--fg'], ['Muted text', '--fg-muted'], ['Border', '--border-strong']].map(([n, v]) => sw(n, v)).join('')}</div></section>
    <section class="card stack"><h2>Type</h2><h1 style="font-size:var(--fs-3xl)">Display — Good morning</h1><h1>Title — Your crew</h1><h2>Heading — Value &amp; adoption</h2><p>Body — Agents carry skills, context and memory into every run.</p><p class="small muted">Small — Supporting detail and hints.</p><p class="mono">Mono — flow.eng.pipeline</p></section>
    <section class="card stack"><h2>Buttons &amp; chips</h2><div class="row"><button class="btn primary">Primary</button><button class="btn">Secondary</button><button class="btn dark">Dark</button><button class="btn ghost">Ghost</button><button class="btn danger">Danger</button><button class="btn" aria-busy="true">Saving</button><button class="btn sm">Small</button></div>
      <div class="row"><span class="chip">neutral</span><span class="chip ok">success</span><span class="chip warn">warning</span><span class="chip bad">danger</span><span class="chip info">info</span><span class="est">EST</span><kbd>⌘ K</kbd></div></section>
    <section class="card stack"><h2>Form controls</h2><div class="row"><label style="flex:1">Text input<input placeholder="Placeholder"></label><label style="flex:1">Select<select><option>Option</option></select></label></div><label class="toggle"><input type="checkbox" checked> Toggle</label><div class="tabs" style="margin:0"><button class="tab" aria-selected="true">Selected</button><button class="tab">Tab</button><button class="tab">Tab</button></div></section>
    <section class="card stack"><h2>Crew states</h2><p class="small muted">Every agent character animates by state. Motion is disabled when the user prefers reduced motion.</p>
      <div class="crew-stage">${MASCOT_STATES.map((st) => `<div class="member">${crewHTML(demo, 64, st)}<span class="tag">${st}</span></div>`).join('')}</div></section>
    <section class="card stack"><h2>Feedback</h2><div class="banner">${icon('alert')}<div>Warning banner — estimates and caveats.</div></div><div class="banner info">${icon('info')}<div>Info banner — guidance.</div></div><div class="row"><button class="btn" data-act="demo-toast" data-v="ok">Success toast</button><button class="btn" data-act="demo-toast" data-v="bad">Error toast</button><button class="btn" data-act="demo-toast" data-v="info">Info toast</button></div><div class="skeleton" style="min-height:60px"></div></section>
    <section class="card stack"><h2>Icons</h2><div class="row" style="gap:16px;color:var(--fg-muted)">${['crew', 'library', 'flows', 'workspace', 'run', 'value', 'settings', 'skill', 'mcp', 'context', 'knowledge', 'memory', 'agent', 'shield', 'key', 'search', 'sparkle'].map((n) => `<span title="${n}" style="width:24px;height:24px;display:inline-block">${icon(n)}</span>`).join('')}</div></section></div>`;
}

// ---------- command palette ----------
let paletteItems = [];
async function openPalette() {
  if ($('.palette')) return;
  lastFocus = document.activeElement;
  const sc = document.createElement('div'); sc.className = 'scrim palette-scrim'; sc.dataset.act = 'close';
  const el = document.createElement('div'); el.className = 'palette'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Command palette');
  el.innerHTML = `<input type="search" placeholder="Search pages, crew, flows, actions…" aria-label="Search" aria-controls="pal-list" autocomplete="off"><ul id="pal-list" role="listbox"></ul><div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>`;
  document.body.append(sc, el);
  const base = [...NAV.map(([r, i, l]) => ({ label: `Go to ${l}`, kind: 'Page', icon: i, go: () => { location.hash = `#/${r}`; } })),
    { label: 'New agent', kind: 'Action', icon: 'plus', go: () => openEditor('agent', null) }, { label: 'New flow', kind: 'Action', icon: 'plus', go: () => openEditor('flow', null) },
    { label: 'Toggle dark / light theme', kind: 'Action', icon: 'moon', go: () => toggleTheme() }, { label: 'Security & two-step sign-in', kind: 'Settings', icon: 'shield', go: () => { S.settingsTab = 'security'; location.hash = '#/settings'; render(); } },
    { label: 'Design system', kind: 'Settings', icon: 'palette', go: () => { S.settingsTab = 'design'; location.hash = '#/settings'; render(); } }];
  try {
    for (const a of await items('agent')) base.push({ label: `Run ${a.name}`, kind: 'Crew', icon: 'run', go: () => { S.runTarget = `agent:${a.id}`; location.hash = '#/run'; } }, { label: `Edit ${a.name}`, kind: 'Crew', icon: 'agent', go: () => openEditor('agent', a.id) });
    for (const f of await items('flow')) base.push({ label: `Run ${f.name}`, kind: 'Flow', icon: 'flows', go: () => { S.runTarget = `flow:${f.id}`; location.hash = '#/run'; } });
    for (const a of (await catalog('agent')).slice(0, 400)) base.push({ label: a.name, kind: `Library · ${a.domain}`, icon: 'library', go: () => openLibDetail('agent', a.id) });
  } catch { /* palette still works with pages */ }
  const input = el.querySelector('input'); const list = el.querySelector('ul'); let sel = 0;
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    paletteItems = (q ? base.filter((x) => `${x.label} ${x.kind}`.toLowerCase().includes(q)) : base.slice(0, 12)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, paletteItems.length - 1));
    list.innerHTML = paletteItems.map((x, i) => `<li role="option" id="pal-${i}" aria-selected="${i === sel}" data-i="${i}">${icon(x.icon)}<span>${esc(x.label)}</span><span class="kind">${esc(x.kind)}</span></li>`).join('') || '<li aria-disabled="true" class="muted">No matches</li>';
    input.setAttribute('aria-activedescendant', `pal-${sel}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (i) => { const x = paletteItems[i]; if (!x) return; closeDrawer(); x.go(); };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, paletteItems.length - 1); draw(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); } if (e.key === 'Enter') { choose(sel); e.preventDefault(); } });
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) choose(Number(li.dataset.i)); });
  draw(); input.focus();
}
function toggleTheme() { const next = currentTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); const b = $('[data-act="theme-toggle"]'); if (b) { b.innerHTML = icon(next === 'dark' ? 'sun' : 'moon'); b.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`); } }
function shortcutsHelp() { drawer(`<h2>Keyboard shortcuts</h2><table><tbody>${[[`${isMac ? '⌘' : 'Ctrl'} K`, 'Command palette'], ['g c', 'Crew'], ['g l', 'Library'], ['g f', 'Flows'], ['g w', 'Workspace'], ['g r', 'Run'], ['g d', 'Factory'], ['g v', 'Value'], ['g s', 'Settings'], ['n', 'New agent (on Crew)'], ['/', 'Focus search'], ['Esc', 'Close panels'], ['?', 'This help']].map(([k, d]) => `<tr><td>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</td><td>${d}</td></tr>`).join('')}</tbody></table>`); }

async function showMfaSetup() {
  const r = await api('/api/auth/mfa/setup', { method: 'POST', body: {} });
  if (!window.qrcode) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/vendor/qrcode.js'; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
  const qr = window.qrcode(0, 'M'); qr.addData(r.otpauth); qr.make();
  const n = qr.getModuleCount(); let rects = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  $('#mfa-setup-area').innerHTML = `<div class="stack" style="margin-top:8px"><ol class="small" style="padding-left:18px;margin:0"><li>Scan this code with your authenticator app.</li><li>Enter the 6-digit code it shows.</li></ol>
    <div class="row" style="align-items:flex-start"><div class="qr" role="img" aria-label="QR code for your authenticator app"><svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" fill="#111830">${rects}</svg></div>
    <div class="stack" style="flex:1;min-width:180px"><span class="small muted">Can’t scan? Enter this key:</span><code class="mono" style="word-break:break-all;background:var(--bg-sunken);padding:8px;border-radius:8px" data-secret>${esc(r.secret.match(/.{1,4}/g).join(' '))}</code></div></div>
    <form class="stack" data-form="mfa-enable"><label for="mfa-code">Code from the app</label><input id="mfa-code" name="code" class="otp" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" required placeholder="000000"><button class="btn primary" type="submit">Turn on</button><p id="form-err" class="small" role="alert"></p></form></div>`;
  $('#mfa-code').focus();
}
function showRecoveryCodes(codes) {
  const txt = `Halyard recovery codes for ${S.me.email}\nEach code works once.\n\n${codes.join('\n')}\n`;
  drawer(`<h2>Save your recovery codes</h2><p class="muted">If you lose your phone, each of these codes lets you sign in once. Store them in a password manager. They won’t be shown again.</p>
    <div class="recovery-grid">${codes.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="copy-text" data-text="${esc(txt)}">${icon('copy')} Copy</button><a class="btn" download="halyard-recovery-codes.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(txt)}">${icon('download')} Download</a><button class="btn primary" data-act="close">I’ve saved them</button></div>`);
}

// ---------- drawer ----------
let lastFocus = null;
function drawer(html) { if (!$('.drawer')) lastFocus = document.activeElement; $$('.drawer, .scrim:not(.modal-scrim)').forEach((e) => e.remove()); const sc = document.createElement('div'); sc.className = 'scrim'; sc.dataset.act = 'close'; const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.innerHTML = `<button class="btn ghost icon close" data-act="close" aria-label="Close">${icon('x')}</button>${html}`; document.body.append(sc, d); (d.querySelector('input,select,textarea') || d.querySelector('button:not(.close)'))?.focus(); }
function closeDrawer() { const had = $('.drawer'); $$('.drawer, .scrim:not(.modal-scrim), .palette, .palette-scrim').forEach((e) => e.remove()); if (had) lastFocus?.focus?.(); }

// ---------- events ----------
const STARTER = ['eng.code-reviewer', 'qa.test-case-designer', 'del.status-reporter', 'pm.prd-writer', 'res.fact-checker', 'write.clarity-editor', 'cs.reply-drafter', 'sec.threat-modeler', 'exec.decision-memo-writer', 'exec.ai-value-analyst'];
const FLOW_TEMPLATES = {
  agent: { type: 'agent', agent: 'eng.code-reviewer', prompt: 'Original request: {{input}}\nPrevious output:\n{{prev}}' },
  parallel: { type: 'parallel', branches: [{ type: 'agent', agent: 'qa.release-qa-gate', prompt: '{{input}}' }, { type: 'agent', agent: 'sec.appsec-reviewer', prompt: '{{input}}' }] },
  router: { type: 'router', agent: 'cs.ticket-router', routes: { bug: { type: 'agent', agent: 'eng.bug-hunter', prompt: '{{input}}' }, other: { type: 'agent', agent: 'cs.reply-drafter', prompt: '{{input}}' } } },
  loop: { type: 'loop', until: 'VERDICT: APPROVED', max: 3, body: [{ type: 'agent', agent: 'write.blog-writer', prompt: 'Request: {{input}}\nReview notes: {{prev}}' }, { type: 'agent', agent: 'write.clarity-editor', prompt: 'Review against: {{input}}\n\n{{prev}}' }] },
  approval: { type: 'approval', message: 'Approve before continuing?' },
};
function withIds(step, used) { const s = structuredClone(step); let n = used.size + 1; const give = (x) => { while (used.has(`s${n}`)) n++; x.id = `s${n}`; used.add(x.id); (x.branches || x.body || []).forEach(give); Object.values(x.routes || {}).forEach(give); }; give(s); return s; }
function collectIds(steps, set = new Set()) { for (const s of steps || []) { if (s.id) set.add(s.id); collectIds(s.branches || s.body || Object.values(s.routes || {}), set); } return set; }

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act, kind, id } = el.dataset;
  try {
    if (act === 'close') return closeDrawer();
    if (act?.startsWith('fac-')) return factoryAct(act, el);
    if (act === 'palette') return openPalette();
    if (act === 'theme-toggle') return toggleTheme();
    if (act === 'demo-toast') return toast(el.dataset.v === 'ok' ? 'Saved — your crew is up to date.' : el.dataset.v === 'bad' ? 'That didn’t work. Try again.' : 'Heads up: this is an info toast.', el.dataset.v);
    if (act === 'copy-text') { await navigator.clipboard.writeText(el.dataset.text); return okToast('Copied.'); }
    if (act === 'mfa-setup') { el.setAttribute('aria-busy', 'true'); await showMfaSetup(); el.remove(); return; }
    if (act === 'mfa-toggle-recovery') { S.useRecovery = !S.useRecovery; return render(); }
    if (act === 'mfa-cancel') { S.mfaChallenge = null; S.useRecovery = false; return render(); }
    if (act === 'mfa-reset') { if (!confirm('Reset this person’s two-step sign-in? They’ll be signed out and must set it up again.')) return; await api(`/api/users/${id}/mfa-reset`, { method: 'POST', body: {} }); okToast('MFA reset.'); return render(); }
    if (act === 'logout') { await api('/api/auth/logout', { method: 'POST' }); S.me = null; S.items = {}; return render(); }
    if (act === 'lib-kind') { S.lib = { kind, q: '', domain: '', page: 0 }; return render(); }
    if (act === 'lib-goto') { S.lib = { kind, q: '', domain: '', page: 0 }; location.hash = '#/library'; return; }
    if (act === 'ws-kind') { S.ws = kind; return render(); }
    if (act === 'page') { S.lib.page += Number(el.dataset.d); render(); return window.scrollTo(0, 0); }
    if (act === 'lib-open') return openLibDetail(kind, id);
    if (act === 'copy') { const it = await copyFromCatalog(kind, id); closeDrawer(); return toast(`Copied “${it.name}” to your workspace.`); }
    if (act === 'adapt') { const it = await copyFromCatalog(kind, id); await items(kind, true); return openEditor(kind, it.id); }
    if (act === 'new') return openEditor(kind, null);
    if (act === 'edit') return openEditor(kind, id);
    if (act === 'dup') { const it = (await items(kind)).find((x) => x.id === id); await api('/api/items', { method: 'POST', body: { kind, name: `${it.name} (copy)`, body: it.body } }); S.items[kind] = null; okToast('Duplicated.'); return render(); }
    if (act === 'del') { if (!confirm('Delete this item? Its version history is kept for audit.')) return; await api(`/api/items/${id}`, { method: 'DELETE' }); S.items[kind] = null; okToast('Deleted.'); return render(); }
    if (act === 'versions') { const v = await api(`/api/items/${id}/versions`); return drawer(`<h2>Version history</h2>${v.versions.map((x) => `<details class="card" style="margin-bottom:8px"><summary>v${x.version} · ${new Date(x.changed_at).toLocaleString()} · ${esc(x.changed_by)}</summary><pre class="out">${esc(JSON.stringify(x.body, null, 2))}</pre></details>`).join('')}<button class="btn" data-act="close">Close</button>`); }
    if (act === 'starter') { const have = new Set((await items('agent', true)).map((a) => a.sourceId)); let n = 0; for (const sid of STARTER) if (!have.has(sid)) { await copyFromCatalog('agent', sid); n++; } toast(n ? `Added ${n} agents to your crew.` : 'Starter crew already added.'); return render(); }
    if (act === 'run-target') { S.runTarget = el.dataset.target; return; }
    if (act === 'run-go') return startRun();
    if (act === 'accept' || act === 'rate') { const card = el.closest('[data-run]'); await api(`/api/runs/${card.dataset.run}`, { method: 'PATCH', body: act === 'accept' ? { accepted: el.dataset.v === '1' } : { rating: Number(el.dataset.v) } }); return toast(act === 'accept' ? (el.dataset.v === '1' ? 'Marked accepted — counts toward value.' : 'Marked rejected — excluded from value.') : 'Thanks — rating saved.'); }
    if (act === 'remember') { const mid = $('#mem-target').value; const note = prompt('Note to remember (a fact you have checked):', (S.lastOutput || '').slice(0, 300)); if (!note) return; const m = (await items('memory', true)).find((x) => x.id === mid); const entries = [...(m.body.entries || []), { text: note.slice(0, 2000), at: Date.now() }]; await api(`/api/items/${mid}`, { method: 'PUT', body: { body: { ...m.body, entries }, version: m.version } }); S.items.memory = null; return okToast('Saved to memory.'); }
    if (act === 'chip-rm') return el.closest('.chip').remove();
    if (act === 'preview-state') return setCrewState($('#mascot-preview .crew'), el.dataset.v, el.dataset.v === 'idle' ? 0 : 4000);
    if (act === 'flow-add') { const ta = $('textarea[name="steps"]'); let steps; try { steps = JSON.parse(ta.value || '[]'); } catch { return toast('Fix the JSON first.'); } steps.push(withIds(FLOW_TEMPLATES[el.dataset.t], collectIds(steps))); ta.value = JSON.stringify(steps, null, 2); return; }
    if (act === 'flow-check') { let steps; try { steps = JSON.parse($('textarea[name="steps"]').value); } catch { return ($('#flow-preview').innerHTML = '<p class="chip bad">Invalid JSON</p>'); } const errs = validateFlow({ steps }); $('#flow-preview').innerHTML = errs.length ? `<div class="banner">${errs.map(esc).join('<br>')}</div>` : `<span class="chip ok">Valid</span>${await flowTree(steps)}`; return; }
    if (act === 'mcp-test') { const f = el.closest('form'); const out = $('#mcp-test-out'); out.textContent = 'Connecting…'; const cl = mcpClient(api, { url: f.elements.url.value, authorization: f.elements.authorization.value }); const info = await cl.connect(); const tools = await cl.listTools(); out.innerHTML = `<span class="chip ok">Connected to ${esc(info?.serverInfo?.name || 'server')}</span> ${tools.length} tools: ${tools.map((t) => `<span class="chip">${esc(t.name)}</span>`).join(' ')}`; return; }
    if (act === 'mcp-export') { const ws = await items('mcp'); const cfg = desktopConfig(ws.map((x) => ({ name: x.name, url: x.body.url, config: x.body.config }))); return drawer(`<h2>Desktop client config</h2><p class="small muted">Paste into an MCP client’s config (for example <span class="mono">claude_desktop_config.json</span>). Add each server’s required environment variables.</p><pre class="out">${esc(JSON.stringify(cfg, null, 2))}</pre><button class="btn" data-act="close">Close</button>`); }
    if (act === 'set-tab') { S.settingsTab = el.dataset.v; return render(); }
    if (act === 'secret-set') { const p = el.dataset.p; const key = prompt(`API key for ${p}:`); if (!key) return; const baseUrl = p === 'custom' ? prompt('Base URL of the OpenAI-compatible endpoint (https://…/v1):') : undefined; await api(`/api/secrets/${p}`, { method: 'PUT', body: { apiKey: key, baseUrl } }); okToast('Saved (encrypted).'); return render(); }
    if (act === 'secret-del') { if (!confirm('Remove this key?')) return; await api(`/api/secrets/${el.dataset.p}`, { method: 'DELETE' }); return render(); }
    if (act === 'user-toggle') { await api(`/api/users/${id}`, { method: 'PATCH', body: { disabled: el.dataset.d === '1' } }); return render(); }
    if (act === 'key-revoke') { if (!confirm('Revoke this key? Scripts using it will stop working.')) return; await api(`/api/keys/${id}`, { method: 'DELETE' }); return render(); }
    if (act === 'audit-verify') { const r = await api('/api/audit/verify'); $('#audit-out').innerHTML = r.ok ? `<span class="chip ok">Chain intact · ${r.checked} entries</span>` : `<span class="chip bad">Broken at #${r.brokenAt}</span>`; return; }
    if (act === 'theme') { const v = el.dataset.v; if (v === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = v; store.set('theme', v); return render(); }
  } catch (err) { errToast(err.message); }
});

document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (k === 'lib-q') { S.lib.q = e.target.value; S.lib.page = 0; clearTimeout(S._t); S._t = setTimeout(async () => { const pos = e.target.selectionStart; await render(); const i = $('[data-input="lib-q"]'); i?.focus(); i?.setSelectionRange(pos, pos); }, 250); }
  if (e.target.matches('[data-mascot]')) { const f = e.target.form; { const st = $('#mascot-preview .crew')?.dataset.state || 'idle'; $('#mascot-preview').innerHTML = crewHTML({ species: f.species.value, accessory: f.accessory.value, color: f.color.value, nickname: f.nickname.value, badge: f.badge.value }, 96, st); } }
  if (k?.startsWith('pref-')) { S.prefs[k.slice(5)] = e.target.value; store.set('prefs', S.prefs); }
});
document.addEventListener('change', async (e) => {
  const k = e.target.dataset.input;
  if (k === 'lib-domain') { S.lib.domain = e.target.value; S.lib.page = 0; render(); }
  if (k === 'kpi-days') { S.kpiDays = Number(e.target.value); render(); }
  if (k === 'run-target') S.runTarget = e.target.value;
  if (k === 'pref-provider') { S.prefs.provider = e.target.value; store.set('prefs', S.prefs); }
  if (e.target.matches('form[data-form="fac-product"] select[name=mode]')) { const live = e.target.form.querySelector('[data-live]'); if (live) live.hidden = e.target.value !== 'real'; }
  if (e.target.dataset.actChange === 'require-mfa') { try { const r = await api('/api/org/settings', { method: 'PUT', body: { requireMfa: e.target.checked } }); S.org.settings = r.settings; okToast(e.target.checked ? 'Two-step sign-in is now required for everyone.' : 'Two-step sign-in is now optional.'); } catch (err) { e.target.checked = !e.target.checked; errToast(err.message); } }
  if (e.target.dataset.actChange === 'user-role') { try { await api(`/api/users/${e.target.dataset.id}`, { method: 'PATCH', body: { role: e.target.value } }); okToast('Role updated.'); } catch (err) { toast(err.message); } }
  if (e.target.dataset.actChange === 'kn-file') { const file = e.target.files[0]; if (!file) return; if (file.size > 350000) return toast('File too large (350 KB max per document).'); const f = e.target.form; f.elements.text.value = await file.text(); if (!f.elements.name.value) f.elements.name.value = file.name; }
});
let gPending = 0;
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.me) { e.preventDefault(); return $('.palette') ? closeDrawer() : openPalette(); }
  if (e.key === 'Escape') closeDrawer();
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (!typing && S.me && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (gPending && Date.now() - gPending < 1200) { const n = NAV.find((x) => x[3] === e.key); gPending = 0; if (n) { location.hash = `#/${n[0]}`; return; } }
    if (e.key === 'g') { gPending = Date.now(); return; }
    if (e.key === '?') return shortcutsHelp();
    if (e.key === '/') { const sb = $('input[type=search]'); if (sb) { e.preventDefault(); sb.focus(); } return; }
    if (e.key === 'n' && S.route === 'crew' && can('editor')) return openEditor('agent', null);
  }
  const inp = e.target.closest?.('[data-chip-input]');
  if (inp && e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(); if (!v) return; const list = $(`[data-chip-list="${inp.dataset.chipInput}"]`); if (![...list.children].some((c) => c.dataset.v === v)) list.insertAdjacentHTML('beforeend', `<span class="chip" data-v="${esc(v)}">${esc(v)} <button type="button" class="btn sm ghost" data-act="chip-rm" aria-label="Remove ${esc(v)}">×</button></span>`); inp.value = ''; }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
  const kind = f.dataset.form; const fd = Object.fromEntries(new FormData(f));
  try {
    if (kind === 'login' || kind === 'bootstrap') {
      const r = await api(`/api/auth/${kind}`, { method: 'POST', body: fd });
      if (r.mfaRequired) { S.mfaChallenge = r.challenge; S.useRecovery = false; return render(); }
      S.health = null; S.me = null; location.hash = '#/crew'; return render();
    }
    if (kind === 'mfa') {
      const r = await api('/api/auth/mfa/verify', { method: 'POST', body: { challenge: S.mfaChallenge, code: fd.code } });
      S.mfaChallenge = null; S.useRecovery = false; S.health = null; S.me = null; location.hash = '#/crew'; await render();
      if (r.recoveryCodesLeft != null) toast(`Signed in with a recovery code. ${r.recoveryCodesLeft} left — consider generating new ones.`, r.recoveryCodesLeft < 3 ? 'bad' : 'info');
      return;
    }
    if (kind === 'mfa-enable') { const r = await api('/api/auth/mfa/enable', { method: 'POST', body: { code: fd.code } }); S.me.mfaEnabled = true; S.mfaGate = false; await render(); okToast('Two-step sign-in is on.'); return showRecoveryCodes(r.recoveryCodes); }
    if (kind === 'mfa-regen') { const r = await api('/api/auth/mfa/recovery-codes', { method: 'POST', body: { code: fd.code } }); return showRecoveryCodes(r.recoveryCodes); }
    if (kind === 'mfa-disable') { await api('/api/auth/mfa/disable', { method: 'POST', body: fd }); S.me.mfaEnabled = false; okToast('Two-step sign-in is off.'); return render(); }
    if (kind === 'save') {
      const k = f.dataset.kind; const id = f.dataset.id; const prev = id ? (await items(k)).find((x) => x.id === id)?.body : {};
      const body = collect(f, k, prev);
      if (k === 'flow') { const errs = validateFlow({ steps: body.steps }); if (errs.length) throw new Error(errs[0]); }
      if (id) await api(`/api/items/${id}`, { method: 'PUT', body: { name: fd.name, body, version: Number(f.dataset.version) } });
      else await api('/api/items', { method: 'POST', body: { kind: k, name: fd.name, body } });
      S.items[k] = null; closeDrawer(); okToast('Saved.'); return render();
    }
    if (kind === 'fac-product') {
      const { name, config, tokens, build } = collectProduct(f); const id = f.dataset.id;
      const r = id ? await api(`/api/factory/products/${id}`, { method: 'PUT', body: { name, config } }) : await api('/api/factory/products', { method: 'POST', body: { name, config, build } });
      const pid = r.product.id;
      for (const [k, token] of Object.entries(tokens)) await api(`/api/factory/products/${pid}/secrets/${k}`, { method: 'PUT', body: { token } });
      S.factory.product = pid; closeDrawer(); await render();
      if (r.webhookSecret && config.mode === 'real') drawer(`<h2>Connect webhooks (optional)</h2><p class="muted">The crew polls every few minutes. Webhooks make it react immediately.</p><table><tbody><tr><th>GitHub payload URL</th><td class="mono">${esc(location.origin)}/api/factory/hooks/${esc(pid)}/github</td></tr><tr><th>Sentry webhook URL</th><td class="mono">${esc(location.origin)}/api/factory/hooks/${esc(pid)}/sentry</td></tr><tr><th>Secret (shown once)</th><td class="mono">${esc(r.webhookSecret)}</td></tr></tbody></table><p class="small muted">GitHub: content type application/json, events Issues + Check runs. Sentry: use this secret as the integration client secret.</p><button class="btn primary" data-act="close">Done</button>`);
      else okToast('Saved.');
      return;
    }
    if (kind === 'org-settings') {
      const prices = {}; for (const line of String(fd.prices || '').split('\n')) { const [k, i, o] = line.trim().split(/\s+/); if (k && i != null) prices[k] = { in: Number(i), out: Number(o) || 0 }; }
      const r = await api('/api/org/settings', { method: 'PUT', body: { hourlyRate: fd.hourlyRate === '' ? null : Number(fd.hourlyRate), currency: fd.currency, valueBasis: fd.valueBasis, prices } });
      S.org.settings = r.settings; return okToast('Value model saved.');
    }
    if (kind === 'user-new') { const r = await api('/api/users', { method: 'POST', body: fd }); $('#user-new-out').textContent = r.temporaryPassword ? `Created. Temporary password (shown once): ${r.temporaryPassword}` : 'Created.'; return; }
    if (kind === 'key-new') { const r = await api('/api/keys', { method: 'POST', body: fd }); $('#key-out').textContent = `New key (shown once): ${r.key}`; return; }
    if (kind === 'password') { await api('/api/auth/password', { method: 'POST', body: fd }); toast('Password changed. Please sign in again.'); S.me = null; return render(); }
  } catch (err) { if (/expired/i.test(err.message)) { S.mfaChallenge = null; } const out = f.querySelector('#auth-err, #form-err') || $('#auth-err') || $('#form-err'); if (out) out.textContent = err.message; else errToast(err.message); }
});

// ---------- boot ----------
const theme = store.get('theme', 'system'); if (theme !== 'system') document.documentElement.dataset.theme = theme;
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
catalog('agent').catch(() => {});
render();
