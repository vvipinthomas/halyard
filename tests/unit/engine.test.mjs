import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, validateFlow, render, parseToolCall, buildSystem } from '../../public/js/engine.js';
import { dryRun } from '../../public/js/providers.js';

const agents = {
  writer: { id: 'writer', name: 'Writer', systemPrompt: 'You are Writer.', value: { minutesSavedPerRun: 10 } },
  checker: { id: 'checker', name: 'Checker', systemPrompt: 'You are Checker.', value: { minutesSavedPerRun: 5 } },
  router: { id: 'router', name: 'Router', systemPrompt: 'You are Router.' },
  tooly: { id: 'tooly', name: 'Tooly', systemPrompt: 'You are Tooly.' },
};
function ctx(script, extra = {}) {
  const calls = [];
  return { calls, getAgent: async (id) => agents[id], callModel: async (a, system, messages) => { calls.push({ a: a.id, system, messages }); const t = script(a, messages, calls); return { text: t, usage: { in: 10, out: 5 }, provider: 'test', model: 'm' }; }, ...extra };
}

test('render substitutes nested vars and leaves unknown blank', () => {
  assert.equal(render('a {{input}} b {{steps.x}} c {{nope}}', { input: 'I', steps: { x: 'X' } }), 'a I b X c ');
});
test('sequential flow passes prev between steps and meters usage', async () => {
  const c = ctx((a, m) => `${a.id}:${m.at(-1).content}`);
  const r = await createRun(c).run({ name: 'f', steps: [{ id: '1', type: 'agent', agent: 'writer', prompt: '{{input}}' }, { id: '2', type: 'agent', agent: 'checker', prompt: 'got {{prev}}' }] }, 'hello');
  assert.equal(r.status, 'succeeded'); assert.equal(r.output, 'checker:got writer:hello');
  assert.deepEqual([r.metrics.tokensIn, r.metrics.tokensOut, r.metrics.calls, r.metrics.minutesSaved], [20, 10, 2, 15]);
});
test('parallel runs all branches and joins with headings', async () => {
  const r = await createRun(ctx((a) => a.id)).run({ steps: [{ id: 'p', type: 'parallel', branches: [{ id: 'b1', type: 'agent', agent: 'writer' }, { id: 'b2', type: 'agent', agent: 'checker' }] }] }, 'x');
  assert.match(r.output, /## b1\nwriter/); assert.match(r.output, /## b2\nchecker/);
});
test('router picks the matching route, falls back to other', async () => {
  const flow = (label) => ({ steps: [{ id: 'r', type: 'router', agent: 'router', routes: { bug: { id: 'b', type: 'agent', agent: 'writer' }, other: { id: 'o', type: 'agent', agent: 'checker' } } }] });
  assert.equal((await createRun(ctx((a) => (a.id === 'router' ? 'BUG' : a.id))).run(flow(), 'x')).output, 'writer');
  assert.equal((await createRun(ctx((a) => (a.id === 'router' ? '??' : a.id))).run(flow(), 'x')).output, 'checker');
});
test('loop exits on condition and counts minutes once per agent', async () => {
  let round = 0;
  const c = ctx((a) => { if (a.id === 'checker') { round++; return round >= 2 ? 'VERDICT: APPROVED' : 'VERDICT: CHANGES_NEEDED'; } return 'draft'; });
  const r = await createRun(c).run({ steps: [{ id: 'l', type: 'loop', until: 'VERDICT: APPROVED', max: 5, body: [{ id: 'w', type: 'agent', agent: 'writer' }, { id: 'c', type: 'agent', agent: 'checker' }] }] }, 'x');
  assert.equal(round, 2); assert.equal(r.metrics.calls, 4); assert.equal(r.metrics.minutesSaved, 15, 'not inflated by loop rounds');
  assert.ok(r.trace.some((e) => e.type === 'loop.exit' && e.reason === 'condition met'));
});
test('loop stops at max iterations', async () => {
  const r = await createRun(ctx(() => 'nope')).run({ steps: [{ id: 'l', type: 'loop', until: 'DONE', max: 3, body: [{ id: 'w', type: 'agent', agent: 'writer' }] }] }, 'x');
  assert.equal(r.metrics.calls, 3);
});
test('approval rejection yields rejected status', async () => {
  const r = await createRun(ctx(() => 'out', { approve: async () => false })).run({ steps: [{ id: 'a', type: 'agent', agent: 'writer' }, { id: 'g', type: 'approval', message: 'ok?' }] }, 'x');
  assert.equal(r.status, 'rejected');
});
test('cancellation via AbortSignal', async () => {
  const ac = new AbortController(); ac.abort();
  const r = await createRun(ctx(() => 'x', { signal: ac.signal })).run({ steps: [{ id: 'a', type: 'agent', agent: 'writer' }] }, 'x');
  assert.equal(r.status, 'cancelled');
});
test('model errors become failed runs, not crashes', async () => {
  const r = await createRun(ctx(() => { throw new Error('boom'); })).run({ steps: [{ id: 'a', type: 'agent', agent: 'writer' }] }, 'x');
  assert.equal(r.status, 'failed'); assert.equal(r.error, 'boom');
});
test('tool calls are executed and results fed back; capped', async () => {
  const toolCalls = [];
  const c = ctx((a, m) => (m.length === 1 ? 'thinking\n```tool\n{"server":"s1","tool":"search","args":{"q":"x"}}\n```' : `final with ${m.at(-1).content.slice(0, 20)}`),
    { callTool: async (s, t, args) => { toolCalls.push([s, t, args]); return { hits: 3 }; } });
  const r = await createRun(c).run({ steps: [{ id: 'a', type: 'agent', agent: 'tooly' }] }, 'x');
  assert.deepEqual(toolCalls, [['s1', 'search', { q: 'x' }]]); assert.match(r.output, /^final with Tool result/); assert.equal(r.metrics.toolCalls, 1);
  const loopy = await createRun({ ...ctx(() => '```tool\n{"server":"s","tool":"t"}\n```'), callTool: async () => ({}), maxToolCalls: 2 }).run({ steps: [{ id: 'a', type: 'agent', agent: 'tooly' }] }, 'x');
  assert.equal(loopy.metrics.toolCalls, 2);
});
test('parseToolCall ignores malformed blocks', () => {
  assert.equal(parseToolCall('```tool\nnot json\n```'), null); assert.equal(parseToolCall('no tool'), null);
});
test('buildSystem includes skills, context, memory and tool protocol', () => {
  const s = buildSystem({ systemPrompt: 'SP' }, { skills: [{ body: 'SKILL' }], contexts: [{ body: 'CTX' }], memories: ['MEM'], tools: [{ server: 's', name: 't' }] });
  for (const k of ['SP', 'SKILL', 'CTX', '- MEM', '```tool']) assert.ok(s.includes(k), k);
});
test('validateFlow catches structural errors', () => {
  assert.deepEqual(validateFlow({ steps: [{ id: 'a', type: 'agent', agent: 'x' }] }), []);
  const errs = validateFlow({ steps: [{ id: 'a', type: 'agent' }, { id: 'a', type: 'weird' }, { id: 'l', type: 'loop', body: [] }, { id: 'r', type: 'router', agent: 'x', routes: {} }] });
  assert.ok(errs.length >= 4, errs.join('\n'));
  assert.ok(validateFlow({ steps: [{ id: 'a', type: 'agent', agent: 'ghost' }] }, new Set(['real'])).some((e) => e.includes('unknown agent')));
});
test('dry run is labelled, routes deterministically and approves review loops', () => {
  const d = dryRun('You are X. VERDICT: rules', [{ role: 'user', content: 'hi' }]);
  assert.match(d.text, /^\[DRY RUN — no model was called\]/); assert.match(d.text, /VERDICT: APPROVED/); assert.equal(d.provider, 'dryrun');
  assert.equal(dryRun('You are R.', [{ role: 'user', content: 'Classify the request into exactly one label from: billing, bug, other.\nReply with the label only.\n\nRequest:\nfound a bug' }]).text, 'bug');
});
