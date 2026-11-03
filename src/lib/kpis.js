// Pure KPI computation over run rows — unit-testable, used by GET /api/kpis.
// Value is an ESTIMATE: minutes saved come from each agent's configurable "minutes saved per run",
// counted only for runs that pass the org value basis (accepted by default). Dry runs are excluded. Money values need an org hourly rate.
const LOCAL = new Set(['ollama', 'lmstudio', 'webllm', 'local']);
const isTest = (r) => r.provider === 'dryrun';
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function computeKpis(allRuns, { valueBasis = 'accepted', hourlyRate = null, currency = 'USD', days = 30, now = Date.now(), workspaceAgents = 0, prices = {} } = {}) {
  const runs = allRuns.filter((r) => !isTest(r));
  const since = now - days * 86400000;
  const prevSince = since - days * 86400000;
  const cur = runs.filter((r) => r.created_at >= since);
  const prev = runs.filter((r) => r.created_at >= prevSince && r.created_at < since);
  const sum = (arr, f) => arr.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const ok = (r) => r.status === 'succeeded';
  const valued = (r) => ok(r) && (valueBasis === 'accepted' ? r.accepted === 1 : r.accepted !== 0);

  const block = (rs) => {
    const succeeded = rs.filter(ok).length;
    const reviewed = rs.filter((r) => r.accepted === 0 || r.accepted === 1);
    const rated = rs.filter((r) => r.rating != null);
    const minutes = sum(rs.filter(valued), (r) => r.minutes_saved_est);
    const cost = sum(rs, (r) => r.cost_usd);
    const unpriced = rs.filter((r) => !LOCAL.has(r.provider) && (r.tokens_in + r.tokens_out) > 0 && !r.cost_usd && !prices[`${r.provider}/${r.model}`]).length;
    const value = hourlyRate ? (minutes / 60) * hourlyRate : null;
    return {
      adoption: {
        activeUsers: new Set(rs.map((r) => r.user_id)).size,
        runs: rs.length,
        agentsUsed: new Set(rs.filter((r) => r.target_kind === 'agent').map((r) => r.target_id)).size,
        flowsUsed: new Set(rs.filter((r) => r.target_kind === 'flow').map((r) => r.target_id)).size,
      },
      consumption: {
        tokensIn: sum(rs, (r) => r.tokens_in), tokensOut: sum(rs, (r) => r.tokens_out),
        costUsd: round(cost, 4), unpricedRuns: unpriced,
        avgLatencyMs: rs.length ? Math.round(sum(rs, (r) => r.latency_ms) / rs.length) : 0,
        localShare: rs.length ? round(rs.filter((r) => LOCAL.has(r.provider)).length / rs.length, 3) : 0,
      },
      output: {
        outputs: sum(rs, (r) => r.outputs), successRate: rs.length ? round(succeeded / rs.length, 3) : 0,
        acceptanceRate: reviewed.length ? round(reviewed.filter((r) => r.accepted === 1).length / reviewed.length, 3) : null,
        reviewedRuns: reviewed.length,
        avgRating: rated.length ? round(sum(rated, (r) => r.rating) / rated.length, 2) : null,
      },
      value: {
        hoursSavedEst: round(minutes / 60, 1),
        valueEst: value == null ? null : round(value, 0),
        roiEst: value != null && cost > 0 ? round(value / cost, 1) : null,
        costPerAcceptedOutput: rs.filter(valued).length ? round(cost / rs.filter(valued).length, 4) : null,
      },
    };
  };

  const c = block(cur), p = block(prev);
  const delta = (a, b) => (b ? round((a - b) / b, 3) : null);

  // daily series for the current window
  const series = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = new Date(now - d * 86400000); start.setUTCHours(0, 0, 0, 0);
    const s = start.getTime(), e = s + 86400000;
    const rs = cur.filter((r) => r.created_at >= s && r.created_at < e);
    series.push({ date: start.toISOString().slice(0, 10), runs: rs.length, tokens: sum(rs, (r) => r.tokens_in + r.tokens_out),
      costUsd: round(sum(rs, (r) => r.cost_usd), 4), hoursSavedEst: round(sum(rs.filter(valued), (r) => r.minutes_saved_est) / 60, 2) });
  }

  const group = (key) => {
    const m = new Map();
    for (const r of cur) {
      const k = key(r); const g = m.get(k) || { key: k, runs: 0, tokens: 0, costUsd: 0, minutes: 0, accepted: 0, rejected: 0 };
      g.runs++; g.tokens += r.tokens_in + r.tokens_out; g.costUsd += r.cost_usd || 0;
      if (valued(r)) g.minutes += r.minutes_saved_est; if (r.accepted === 1) g.accepted++; if (r.accepted === 0) g.rejected++;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, costUsd: round(g.costUsd, 4), hoursSavedEst: round(g.minutes / 60, 1) }))
      .sort((a, b) => b.minutes - a.minutes || b.runs - a.runs);
  };

  return {
    window: { days, since: new Date(since).toISOString(), currency, hourlyRate, valueBasis },
    testRuns: allRuns.filter((r) => isTest(r) && r.created_at >= since).length,
    ...c,
    adoption: { ...c.adoption, agentsInWorkspace: workspaceAgents, runsPerActiveUser: c.adoption.activeUsers ? round(c.adoption.runs / c.adoption.activeUsers, 1) : 0 },
    trend: { runs: delta(c.adoption.runs, p.adoption.runs), activeUsers: delta(c.adoption.activeUsers, p.adoption.activeUsers),
      costUsd: delta(c.consumption.costUsd, p.consumption.costUsd), hoursSavedEst: delta(c.value.hoursSavedEst, p.value.hoursSavedEst) },
    series,
    topTargets: group((r) => `${r.target_kind}:${r.target_name}`).slice(0, 10),
    byModel: group((r) => `${r.provider || 'unknown'}/${r.model || 'unknown'}`),
    notes: [
      `Hours saved and value are estimates: each agent’s "minutes saved per run" is an editable assumption, counted only for succeeded runs ${valueBasis === 'accepted' ? 'that a person marked accepted' : 'that were not rejected'}. Dry runs are excluded from every KPI.`,
      hourlyRate ? null : 'Set an hourly rate in Settings to see value and ROI in money.',
      c.consumption.unpricedRuns ? `${c.consumption.unpricedRuns} frontier run(s) have no price configured, so cost is understated.` : null,
    ].filter(Boolean),
  };
}

export function priceRun({ provider, model, tokensIn, tokensOut }, prices = {}) {
  if (LOCAL.has(provider)) return 0;
  const p = prices[`${provider}/${model}`];
  if (!p) return 0;
  return round(((tokensIn || 0) * (p.in || 0) + (tokensOut || 0) * (p.out || 0)) / 1e6, 6);
}
