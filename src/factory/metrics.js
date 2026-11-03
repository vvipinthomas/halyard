// Factory KPIs: DORA metrics plus autonomy and customer impact. Pure; computed from items + events.
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function factoryMetrics(items, events, { days = 30, now = Date.now() } = {}) {
  const since = now - days * 86400000;
  const win = items.filter((i) => i.created_at >= since);
  const deployed = items.filter((i) => i.deployed_at && i.deployed_at >= since);
  const rolledBack = deployed.filter((i) => i.status === 'rolled_back' || events.some((e) => e.item_id === i.id && e.kind === 'rollback'));
  const done = items.filter((i) => i.status === 'done' && i.resolved_at >= since);
  const humanTouched = new Set(events.filter((e) => e.actor.startsWith('human')).map((e) => e.item_id));
  const incidents = done.filter((i) => ['incident', 'bug', 'build'].includes(i.kind));
  return {
    window: { days },
    dora: {
      deploymentsPerDay: r(deployed.length / days, 2),
      leadTimeHours: r(median(deployed.filter((i) => i.merged_at).map((i) => (i.deployed_at - i.detected_at) / 3600000))),
      changeFailureRate: deployed.length ? r(rolledBack.length / deployed.length, 3) : null,
      mttrHours: r(median(incidents.map((i) => (i.resolved_at - i.detected_at) / 3600000))),
    },
    autonomy: {
      detected: win.length, resolved: done.length,
      resolvedWithoutHumans: done.filter((i) => !humanTouched.has(i.id)).length,
      autonomyRate: done.length ? r(done.filter((i) => !humanTouched.has(i.id)).length / done.length, 3) : null,
      awaitingApproval: items.filter((i) => i.status === 'awaiting_approval').length,
      needsHuman: items.filter((i) => i.status === 'needs_human').length,
      inFlight: items.filter((i) => !['done', 'rejected', 'rolled_back', 'needs_human', 'proposal', 'ignored'].includes(i.status)).length,
      rollbacks: rolledBack.length,
    },
    customers: {
      impactResolved: Math.round(done.reduce((a, i) => a + (i.impact || 0), 0)),
      openImpact: Math.round(items.filter((i) => !['done', 'rejected', 'ignored'].includes(i.status)).reduce((a, i) => a + (i.impact || 0), 0)),
      proposals: items.filter((i) => i.status === 'proposal').length,
    },
  };
}
