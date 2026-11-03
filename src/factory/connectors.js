// Connectors the factory uses to observe and change a product. Every connector exposes the same "world"
// interface so the loop is identical for real systems and the sandbox:
//   listSignals() · stackFor(signal) · repoTree() · readFiles(paths) · openPR(change) · prStatus(pr)
//   mergePR(pr) · closePR(pr, note) · deployments() · rollback(versionId, note) · healthSince(signal, ms) · resolveSignal(signal, note)
// Real endpoints follow GitHub REST (2022-11-28), Sentry API v0 and Cloudflare API v4 (Workers deployments).
import { checkOutboundUrl } from '../lib/net.js';

const b64enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\n/g, '')), (c) => c.charCodeAt(0)));

async function call(fetchImpl, url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetchImpl(url, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error(`${method} ${new URL(url).host}${new URL(url).pathname} → ${res.status}: ${String(data?.message || data?.detail || data?.errors?.[0]?.message || text).slice(0, 200)}`); e.status = res.status; throw e; }
  return data;
}

// ---------------- GitHub ----------------
export function github({ token, owner, repo, base = 'main', label = 'bug', fetchImpl = fetch }) {
  const H = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'halyard-factory' };
  const api = (p, o = {}) => call(fetchImpl, `https://api.github.com/repos/${owner}/${repo}${p}`, { ...o, headers: H });
  return {
    async issues() {
      const list = await api(`/issues?state=open&per_page=30&labels=${encodeURIComponent(label)}`);
      const feats = await api('/issues?state=open&per_page=20&labels=enhancement').catch(() => []);
      return [...list.map((i) => ({ i, kind: 'bug' })), ...feats.map((i) => ({ i, kind: 'feature' }))].filter(({ i }) => !i.pull_request).map(({ i, kind }) => ({
        source: 'github', externalId: `issue-${i.number}`, kind, title: i.title, severity: /critical|sev1|p0/i.test(i.labels.map((l) => l.name).join(' ')) ? 'high' : 'medium',
        impact: (i.reactions?.total_count || 0) + (i.comments || 0), detectedAt: Date.parse(i.created_at), url: i.html_url, body: String(i.body || '').slice(0, 4000), number: i.number }));
    },
    async failedRuns() {
      const r = await api(`/actions/runs?branch=${encodeURIComponent(base)}&status=failure&per_page=3`);
      return (r.workflow_runs || []).map((w) => ({ source: 'ci', externalId: `run-${w.id}`, kind: 'build', title: `CI failing: ${w.name}`, severity: 'high', impact: 5, detectedAt: Date.parse(w.created_at), url: w.html_url, body: `Workflow ${w.name} failed on ${base} at ${w.head_sha}` }));
    },
    async tree() { const t = await api(`/git/trees/${encodeURIComponent(base)}?recursive=1`); return (t.tree || []).filter((x) => x.type === 'blob').map((x) => x.path); },
    async readFiles(paths, ref = base) {
      const out = [];
      for (const p of paths.slice(0, 5)) { try { const f = await api(`/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`); if (f.size <= 80000) out.push({ path: p, content: b64dec(f.content) }); } catch { /* missing file */ } }
      return out;
    },
    async ensureBranch(branch) {
      try { const r = await api(`/git/ref/heads/${branch}`); return r.object.sha; } catch (e) { if (e.status !== 404) throw e; }
      const ref = await api(`/git/ref/heads/${encodeURIComponent(base)}`);
      await api('/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: ref.object.sha } });
      return ref.object.sha;
    },
    async commitFiles(branch, files, message) {
      const head = await this.ensureBranch(branch);
      const commit = await api(`/git/commits/${head}`);
      const tree = [];
      for (const f of files) { const blob = await api('/git/blobs', { method: 'POST', body: { content: b64enc(f.content), encoding: 'base64' } }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); }
      const newTree = await api('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
      const c = await api('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [head] } });
      await api(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: c.sha } });
      return c.sha;
    },
    async openPRFrom(branch, title, body, headSha) {
      const pr = await api('/pulls', { method: 'POST', body: { title, head: branch, base, body } });
      await api(`/issues/${pr.number}/labels`, { method: 'POST', body: { labels: ['halyard-factory'] } }).catch(() => {});
      return { number: pr.number, url: pr.html_url, headSha: headSha || pr.head?.sha, branch };
    },
    async openPR({ branch, title, body, files }) {
      const ref = await api(`/git/ref/heads/${encodeURIComponent(base)}`); const baseSha = ref.object.sha;
      const commit = await api(`/git/commits/${baseSha}`);
      const tree = [];
      for (const f of files) { const blob = await api('/git/blobs', { method: 'POST', body: { content: b64enc(f.content), encoding: 'base64' } }); tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); }
      const newTree = await api('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
      const c = await api('/git/commits', { method: 'POST', body: { message: title, tree: newTree.sha, parents: [baseSha] } });
      await api('/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: c.sha } });
      const pr = await api('/pulls', { method: 'POST', body: { title, head: branch, base, body } });
      await api(`/issues/${pr.number}/labels`, { method: 'POST', body: { labels: ['halyard-factory'] } }).catch(() => {});
      return { number: pr.number, url: pr.html_url, headSha: c.sha, branch };
    },
    async prStatus(pr) {
      const runs = await api(`/commits/${pr.headSha}/check-runs?per_page=50`);
      const cr = runs.check_runs || [];
      if (!cr.length) return { ci: 'none', summary: 'No CI checks reported for this commit' };
      if (cr.some((x) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(x.conclusion))) return { ci: 'failure', summary: cr.filter((x) => x.conclusion && x.conclusion !== 'success' && x.conclusion !== 'skipped').map((x) => `${x.name}: ${x.conclusion} ${x.output?.summary || ''}`).join('\n').slice(0, 2000) };
      if (cr.some((x) => x.status !== 'completed')) return { ci: 'pending', summary: `${cr.filter((x) => x.status !== 'completed').length} checks running` };
      return { ci: 'success', summary: `${cr.length} checks passed` };
    },
    async mergePR(pr) { const m = await api(`/pulls/${pr.number}/merge`, { method: 'PUT', body: { merge_method: 'squash' } }); return { sha: m.sha }; },
    async closePR(pr, note) { await api(`/issues/${pr.number}/comments`, { method: 'POST', body: { body: note } }).catch(() => {}); await api(`/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } }); },
    async comment(number, body) { await api(`/issues/${number}/comments`, { method: 'POST', body: { body } }); },
    async closeIssue(number, note) { await this.comment(number, note).catch(() => {}); await api(`/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } }); },
  };
}

// ---------------- Sentry ----------------
export function sentry({ token, org, project, baseUrl = 'https://sentry.io', allowPrivate = false, fetchImpl = fetch }) {
  const chk = checkOutboundUrl(baseUrl, { allowPrivate }); if (!chk.ok) throw new Error(`Sentry URL: ${chk.reason}`);
  const base = chk.url.origin; const H = { authorization: `Bearer ${token}` };
  const api = (p, o = {}) => call(fetchImpl, `${base}/api/0${p}`, { ...o, headers: H });
  const sev = (lvl, users) => (lvl === 'fatal' || users >= 100 ? 'critical' : lvl === 'error' && users >= 10 ? 'high' : lvl === 'error' ? 'medium' : 'low');
  return {
    async issues() {
      const list = await api(`/projects/${org}/${project}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=24h&limit=25`);
      return list.map((i) => ({ source: 'sentry', externalId: `sentry-${i.id}`, kind: 'incident', title: i.title, severity: sev(i.level, Number(i.userCount) || 0), impact: (Number(i.userCount) || 0) * 10 + Math.min(Number(i.count) || 0, 1000) / 10,
        detectedAt: Date.parse(i.firstSeen), url: i.permalink, body: `${i.culprit || ''}\nEvents: ${i.count}, users affected: ${i.userCount}`, sentryId: i.id, count: Number(i.count) || 0 }));
    },
    async stack(sentryId) {
      const ev = await api(`/organizations/${org}/issues/${sentryId}/events/latest/`);
      const ex = (ev.entries || []).find((e) => e.type === 'exception');
      const frames = (ex?.data?.values || []).flatMap((v) => (v.stacktrace?.frames || []).map((f) => ({ file: f.filename || f.absPath, line: f.lineNo, fn: f.function, inApp: f.inApp })));
      const msg = (ex?.data?.values || []).map((v) => `${v.type}: ${v.value}`).join('\n');
      return { message: msg.slice(0, 2000), frames: frames.filter((f) => f.inApp !== false).slice(-12) };
    },
    async issueCount(sentryId) { const i = await api(`/organizations/${org}/issues/${sentryId}/`); return { count: Number(i.count) || 0, lastSeen: Date.parse(i.lastSeen) }; },
    async newIssuesSince(ms) { const list = await api(`/projects/${org}/${project}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=24h&limit=50`); return list.filter((i) => Date.parse(i.firstSeen) > ms).map((i) => ({ id: i.id, title: i.title })); },
    async resolve(sentryId) { await api(`/organizations/${org}/issues/${sentryId}/`, { method: 'PUT', body: { status: 'resolved' } }); },
  };
}

// ---------------- Cloudflare Workers ----------------
export function cloudflare({ token, accountId, script, fetchImpl = fetch }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(script)}/deployments`;
  const H = { authorization: `Bearer ${token}` };
  return {
    async deployments() {
      const r = await call(fetchImpl, url, { headers: H });
      return (r.result?.deployments || []).map((d) => ({ id: d.id, createdOn: Date.parse(d.created_on), versionId: d.versions?.[0]?.version_id, source: d.source, message: d.annotations?.['workers/message'] }));
    },
    async rollback(versionId, note) {
      const r = await call(fetchImpl, url, { method: 'POST', headers: H, body: { strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }], annotations: { 'workers/message': String(note).slice(0, 900), 'workers/triggered_by': 'halyard-factory' } } });
      return { id: r.result?.id };
    },
  };
}

// Compose the three into a single world for the loop.
export function realWorld({ cfg, secrets, fetchImpl = fetch, allowPrivate = false }) {
  const gh = github({ token: secrets.github, owner: cfg.repo.owner, repo: cfg.repo.name, base: cfg.repo.branch || 'main', label: cfg.repo.issueLabel || 'bug', fetchImpl });
  const se = cfg.sentry?.org && secrets.sentry ? sentry({ token: secrets.sentry, org: cfg.sentry.org, project: cfg.sentry.project, baseUrl: cfg.sentry.baseUrl || 'https://sentry.io', allowPrivate, fetchImpl }) : null;
  const cf = cfg.cloudflare?.accountId && secrets.cloudflare ? cloudflare({ token: secrets.cloudflare, accountId: cfg.cloudflare.accountId, script: cfg.cloudflare.script, fetchImpl }) : null;
  return {
    kind: 'real',
    async listSignals() { return [...(se ? await se.issues() : []), ...(await gh.issues()), ...(await gh.failedRuns().catch(() => []))]; },
    async stackFor(sig) { return sig.source === 'sentry' && se ? se.stack(sig.sentryId) : { message: sig.body || '', frames: [] }; },
    repoTree: () => gh.tree(), readFiles: (p, ref) => gh.readFiles(p, ref), openPR: (c) => gh.openPR(c), prStatus: (pr) => gh.prStatus(pr),
    commitFiles: (b, f, m) => gh.commitFiles(b, f, m), openPRFrom: (b, t, body, sha) => gh.openPRFrom(b, t, body, sha),
    mergePR: (pr) => gh.mergePR(pr), closePR: (pr, n) => gh.closePR(pr, n),
    deployments: () => (cf ? cf.deployments() : Promise.resolve([])), rollback: (v, n) => (cf ? cf.rollback(v, n) : Promise.reject(new Error('Cloudflare is not configured'))),
    async healthSince(sig, ms) {
      if (!se) return { regressed: false, detail: 'No Sentry configured; relying on CI only' };
      const fresh = await se.newIssuesSince(ms);
      let recurring = false;
      if (sig.source === 'sentry') { const c = await se.issueCount(sig.sentryId); recurring = c.lastSeen > ms + 60_000; }
      return { regressed: fresh.length > 0 || recurring, detail: `${fresh.length} new issue(s) since deploy${recurring ? '; original error still occurring' : ''}`, fresh };
    },
    async resolveSignal(sig, note) { if (sig.source === 'sentry' && se) await se.resolve(sig.sentryId); if (sig.source === 'github') await gh.closeIssue(sig.number, note); },
    async notify(sig, note) { if (sig.source === 'github') await gh.comment(sig.number, note).catch(() => {}); },
  };
}

// ---------------- Sandbox world (deterministic, for demos and tests) ----------------
export const SANDBOX_SCENARIOS = {
  'null-price': { title: "TypeError: Cannot read properties of undefined (reading 'price')", file: 'src/cart.js', severity: 'high', users: 37 },
  'auth-timeout': { title: 'Session expired error loop on /account', file: 'src/auth/session.js', severity: 'high', users: 12 },
  'bad-fix': { title: 'RangeError: Invalid time value in formatDate', file: 'src/format.js', severity: 'medium', users: 8 },
  'feature-request': { title: 'Customers ask for CSV export of orders', file: null, severity: 'low', users: 0 },
  'null-title': { title: "TypeError: Cannot read properties of undefined (reading 'trim') in add", file: 'src/store.js', severity: 'high', users: 21, forBuilt: true,
    breaks: { file: 'src/store.js', from: "const t = String(title || '').trim();", to: 'const t = title.trim();' } },
};
export const scenariosFor = (built) => Object.entries(SANDBOX_SCENARIOS).filter(([, s]) => (built ? s.forBuilt || !s.file : !s.forBuilt)).map(([k]) => k);
export function sandboxInitial() {
  return { clock: 0, version: 1, nextIssue: 1, nextPr: 1, issues: [], prs: [], deployments: [{ id: 'dep-1', versionId: 'v1', createdOn: 0 }],
    repo: {
      'src/cart.js': "export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n",
      'src/auth/session.js': "export function isExpired(s, now) {\n  return now > s.expiresAt;\n}\n",
      'src/format.js': "export function formatDate(d) {\n  return new Date(d).toISOString().slice(0, 10);\n}\n",
      'src/orders.js': "export function listOrders(db) {\n  return db.orders;\n}\n",
      'tests/cart.test.js': "// expects total([{qty:1}]) === 0\n", 'package.json': '{"name":"demo-shop"}\n',
    } };
}
export function sandboxWorld(state, now = Date.now()) {
  const s = state;
  const bugPresent = (file) => ({ 'src/cart.js': /item\.price/, 'src/auth/session.js': /return now > s\.expiresAt;/, 'src/format.js': /new Date\(d\)\.toISOString/, 'src/store.js': /const t = title\.trim\(\);/ }[file]?.test(s.repo[file] || ''));
  return {
    kind: 'sandbox', state: s,
    inject(name) {
      const sc = SANDBOX_SCENARIOS[name]; if (!sc) throw Object.assign(new Error(`Unknown scenario. Use one of: ${Object.keys(SANDBOX_SCENARIOS).join(', ')}`), { status: 400 });
      if (sc.file && s.repo[sc.file] == null) throw Object.assign(new Error(`This product has no ${sc.file}; pick a scenario for it`), { status: 400 });
      if (sc.breaks && s.repo[sc.breaks.file]) s.repo[sc.breaks.file] = s.repo[sc.breaks.file].replace(sc.breaks.from, sc.breaks.to);
      const id = s.nextIssue++;
      s.issues.push({ id, scenario: name, title: sc.title, file: sc.file, users: sc.users, severity: sc.severity, open: true, source: sc.file ? 'sentry' : 'github', firstSeen: now, lastSeen: now });
      return id;
    },
    async listSignals() {
      return s.issues.filter((i) => i.open).map((i) => ({ source: i.source, externalId: `sbx-${i.id}`, kind: i.file ? 'incident' : 'feature', title: i.title, severity: i.severity, impact: i.users * 10, detectedAt: i.firstSeen, url: null, body: i.file ? `in ${i.file}` : 'Several customers asked for this in support tickets.', sbxId: i.id, sentryId: String(i.id), number: i.id }));
    },
    async stackFor(sig) { const i = s.issues.find((x) => x.id === sig.sbxId); return { message: i?.title || '', frames: i?.file ? [{ file: i.file, line: 2, fn: 'handler', inApp: true }] : [] }; },
    async repoTree() { return Object.keys(s.repo); },
    async readFiles(paths, ref) { const src = (ref && s.branches?.[ref]) || s.repo; return paths.filter((p) => src[p] != null).map((p) => ({ path: p, content: src[p] })); },
    async openPR({ branch, title, files }) { const n = s.nextPr++; s.prs.push({ number: n, branch, title, files, state: 'open' }); return { number: n, url: null, headSha: `sbx${n}`, branch }; },
    async commitFiles(branch, files) { s.branches = s.branches || {}; const b = (s.branches[branch] = s.branches[branch] || {}); for (const f of files) b[f.path] = f.content; return `sbx-${branch}-${Object.keys(b).length}`; },
    async openPRFrom(branch, title) { const n = s.nextPr++; const b = s.branches?.[branch] || {}; s.prs.push({ number: n, branch, title, files: Object.entries(b).map(([path, content]) => ({ path, content })), state: 'open', live: true }); return { number: n, url: null, headSha: `sbx${n}`, branch }; },
    async prStatus(pr) {
      const p = s.prs.find((x) => x.number === pr.number);
      if (p.live) p.files = Object.entries(s.branches?.[p.branch] || {}).map(([path, content]) => ({ path, content }));
      const broken = p.files.some((f) => /SYNTAX ERROR|TODO_FAIL/.test(f.content));
      return broken ? { ci: 'failure', summary: 'tests/cart.test.js: SyntaxError' } : { ci: 'success', summary: '3 checks passed' };
    },
    async mergePR(pr) {
      const p = s.prs.find((x) => x.number === pr.number); p.state = 'merged';
      if (p.live) p.files = Object.entries(s.branches?.[p.branch] || {}).map(([path, content]) => ({ path, content }));
      for (const f of p.files) s.repo[f.path] = f.content;
      s.version += 1; s.deployments.unshift({ id: `dep-${s.version}`, versionId: `v${s.version}`, createdOn: now + 1, regression: p.files.some((f) => /REGRESSION/.test(f.content)) });
      return { sha: `merge${pr.number}` };
    },
    async closePR(pr) { const p = s.prs.find((x) => x.number === pr.number); if (p) p.state = 'closed'; },
    async deployments() { return s.deployments.map(({ id, versionId, createdOn }) => ({ id, versionId, createdOn })); },
    async rollback(versionId) { s.version += 1; const prev = s.deployments.find((d) => d.versionId === versionId); s.deployments.unshift({ id: `dep-${s.version}`, versionId, createdOn: now + 2, rollback: true, regression: false }); if (prev) prev.rolledBackTo = true; return { id: `dep-${s.version}` }; },
    async healthSince(sig) {
      const live = s.deployments[0];
      const i = s.issues.find((x) => x.id === sig.sbxId);
      const still = i?.file ? bugPresent(i.file) : false;
      return { regressed: !!live.regression || still, detail: live.regression ? '1 new issue since deploy: TypeError in formatDate caller' : still ? 'original error still occurring' : '0 new issues since deploy; original error stopped' };
    },
    async resolveSignal(sig) { const i = s.issues.find((x) => x.id === sig.sbxId); if (i) i.open = false; },
    async notify() {},
  };
}
