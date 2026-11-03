import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKpis, priceRun } from '../../src/lib/kpis.js';

const now = Date.UTC(2026, 10, 1, 12);
const run = (o) => ({ user_id: 'u1', target_kind: 'agent', target_id: 'a', target_name: 'A', status: 'succeeded', provider: 'anthropic', model: 'm', tokens_in: 1000, tokens_out: 500, cost_usd: 0.01, latency_ms: 2000, outputs: 1, minutes_saved_est: 30, accepted: null, rating: null, created_at: now - 3600e3, ...o });

test('value counts only accepted runs by default; dry runs never count', () => {
  const k = computeKpis([run({ accepted: 1 }), run({ accepted: null }), run({ accepted: 0 }), run({ provider: 'dryrun', accepted: 1 })], { now, hourlyRate: 60 });
  assert.equal(k.adoption.runs, 3, 'dry run excluded from runs');
  assert.equal(k.testRuns, 1);
  assert.equal(k.value.hoursSavedEst, 0.5);
  assert.equal(k.value.valueEst, 30);
  assert.equal(k.value.roiEst, 1000); // $30 / $0.03
  assert.equal(k.output.acceptanceRate, 0.5);
});
test('not-rejected basis includes unreviewed runs', () => {
  const k = computeKpis([run({ accepted: 1 }), run({ accepted: null }), run({ accepted: 0 })], { now, valueBasis: 'not-rejected' });
  assert.equal(k.value.hoursSavedEst, 1);
  assert.equal(k.value.valueEst, null, 'no hourly rate → no money value');
});
test('failed runs earn no value; local share and unpriced detection', () => {
  const k = computeKpis([run({ status: 'failed', accepted: 1 }), run({ provider: 'ollama', cost_usd: 0, accepted: 1 }), run({ cost_usd: 0, model: 'unpriced' })], { now });
  assert.equal(k.value.hoursSavedEst, 0.5);
  assert.equal(k.consumption.localShare, 0.333);
  assert.equal(k.consumption.unpricedRuns, 1);
  assert.ok(k.notes.some((n) => n.includes('no price')));
});
test('trend compares to previous window; series length = days', () => {
  const k = computeKpis([run({}), run({}), run({ created_at: now - 40 * 86400e3 })], { now, days: 30 });
  assert.equal(k.trend.runs, 1); // 2 vs 1
  assert.equal(k.series.length, 30);
});
test('priceRun uses per-1M prices and is 0 for local', () => {
  assert.equal(priceRun({ provider: 'anthropic', model: 'x', tokensIn: 1e6, tokensOut: 1e6 }, { 'anthropic/x': { in: 3, out: 15 } }), 18);
  assert.equal(priceRun({ provider: 'ollama', model: 'x', tokensIn: 1e6 }, { 'ollama/x': { in: 3 } }), 0);
  assert.equal(priceRun({ provider: 'openai', model: 'none', tokensIn: 1e6 }, {}), 0);
});
