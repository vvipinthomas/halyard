// Guarded-autonomy policy: patch safety guard, risk scoring and the merge/approval decision. Pure functions.
export const DEFAULT_POLICY = {
  autoMerge: true, riskThreshold: 40, requireCi: true, autoRollback: true,
  sensitivePaths: ['auth', 'security', 'migrations', 'payment', 'billing', 'wrangler.toml', 'package.json', 'package-lock.json', 'Dockerfile', 'infra/', 'terraform', '.env'],
  maxFilesPerFix: 5, maxBytesPerFile: 60000, maxAttempts: 2,
  maxPrsPerDay: 10, maxDeploysPerDay: 6, maxTokensPerDay: 400000,
  monitorMinutes: 30, freezeUntil: 0,
};
export const policyOf = (cfg = {}) => ({ ...DEFAULT_POLICY, ...(cfg.policy || {}) });

const SECRET_RE = /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/;

// Returns a list of reasons the patch must not be applied at all (empty = acceptable).
export function guardPatch(files, policy = DEFAULT_POLICY, knownPaths = null) {
  const errs = [];
  if (!Array.isArray(files) || !files.length) return ['The fix contains no file changes'];
  if (files.length > policy.maxFilesPerFix) errs.push(`Touches ${files.length} files (limit ${policy.maxFilesPerFix})`);
  for (const f of files) {
    const p = String(f.path || '');
    if (!p || p.startsWith('/') || p.includes('..') || p.includes('\\') || /[\0\r\n]/.test(p)) errs.push(`Unsafe path: ${p.slice(0, 80)}`);
    if (/^\.github\//.test(p)) errs.push(`Agents may not edit CI configuration (${p})`);
    if (/(^|\/)\.git\//.test(p)) errs.push(`Agents may not edit git internals (${p})`);
    if (typeof f.content !== 'string') errs.push(`No content for ${p}`);
    else {
      if (f.content.length > policy.maxBytesPerFile) errs.push(`${p} is larger than ${policy.maxBytesPerFile} bytes`);
      if (SECRET_RE.test(f.content)) errs.push(`${p} appears to contain a credential`);
    }
    if (knownPaths && !knownPaths.has(p) && files.filter((x) => !knownPaths.has(x.path)).length > 2) errs.push('Creates too many new files');
  }
  return [...new Set(errs)];
}

export function diffStats(files, originals = {}) {
  let added = 0, removed = 0, created = 0;
  for (const f of files) {
    const before = originals[f.path]; if (before == null) created++;
    const a = new Set(String(before || '').split('\n')); const b = String(f.content).split('\n');
    const bs = new Set(b);
    added += b.filter((l) => !a.has(l)).length; removed += [...a].filter((l) => l && !bs.has(l)).length;
  }
  return { files: files.length, added, removed, created };
}

const SEV = { low: 5, medium: 10, high: 20, critical: 30 };
export function riskScore({ severity = 'medium', files = [], stats = { files: 0, added: 0, removed: 0, created: 0 }, ci = 'none', review = 'approved' }, policy = DEFAULT_POLICY) {
  const factors = [];
  const add = (n, why) => { if (n) factors.push({ points: n, why }); };
  add(SEV[severity] ?? 10, `${severity} severity`);
  add(Math.min(stats.files * 5, 25), `${stats.files} file(s) changed`);
  add(Math.min(Math.ceil((stats.added + stats.removed) / 20) * 2, 20), `${stats.added + stats.removed} lines changed`);
  add(stats.created * 5, stats.created ? `${stats.created} new file(s)` : '');
  const sens = files.map((f) => f.path).filter((p) => policy.sensitivePaths.some((s) => p.toLowerCase().includes(s.toLowerCase())));
  add(sens.length ? 40 : 0, sens.length ? `sensitive path: ${sens.join(', ')}` : '');
  add(ci === 'none' ? 30 : ci === 'failure' ? 100 : 0, ci === 'none' ? 'no CI checks ran' : ci === 'failure' ? 'CI failed' : '');
  add(review === 'changes_needed' ? 30 : 0, review === 'changes_needed' ? 'reviewer agent requested changes' : '');
  return { score: factors.reduce((a, f) => a + f.points, 0), factors };
}

export function decide({ score, ci }, policy = DEFAULT_POLICY, { usage = {}, now = Date.now(), paused = false } = {}) {
  const reasons = [];
  if (paused) reasons.push('Factory is paused (andon)');
  if (policy.freezeUntil && now < policy.freezeUntil) reasons.push('Change freeze in effect');
  if (!policy.autoMerge) reasons.push('Auto-merge is off for this product');
  if (policy.requireCi && ci !== 'success') reasons.push('CI has not passed');
  if (score > policy.riskThreshold) reasons.push(`Risk ${score} is above the threshold of ${policy.riskThreshold}`);
  if ((usage.deploys || 0) >= policy.maxDeploysPerDay) reasons.push('Daily deploy budget reached');
  return { action: reasons.length ? 'approval' : 'merge', reasons };
}

export function budgetBlock(usage = {}, policy = DEFAULT_POLICY) {
  if ((usage.tokens || 0) >= policy.maxTokensPerDay) return 'Daily model-token budget reached';
  if ((usage.prs || 0) >= policy.maxPrsPerDay) return 'Daily pull-request budget reached';
  return null;
}
