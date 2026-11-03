import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer, client, bootstrapped, ADMIN } from '../helpers/harness.mjs';

test('health reports setup state; bootstrap only once', async () => {
  const { app } = makeServer(); const c = client(app);
  assert.equal((await c.get('/api/health')).json.needsSetup, true);
  assert.equal((await c.post('/api/auth/bootstrap', ADMIN)).status, 201);
  assert.equal((await c.get('/api/health')).json.needsSetup, false);
  assert.equal((await client(app).post('/api/auth/bootstrap', { ...ADMIN, email: 'x@y.z' })).status, 409);
});

test('setup token is enforced when configured', async () => {
  const { app } = makeServer({ SETUP_TOKEN: 's3cret' });
  assert.equal((await client(app).post('/api/auth/bootstrap', ADMIN)).status, 403);
  assert.equal((await client(app).post('/api/auth/bootstrap', { ...ADMIN, setupToken: 's3cret' })).status, 201);
});

test('login, me, logout', async () => {
  const { app } = await bootstrapped(); const c = client(app);
  assert.equal((await c.post('/api/auth/login', { email: ADMIN.email, password: 'wrong' })).status, 401);
  const r = await c.post('/api/auth/login', { email: ADMIN.email.toUpperCase(), password: ADMIN.password });
  assert.equal(r.status, 200); assert.equal(r.json.user.role, 'admin'); assert.ok(!('pw_hash' in r.json.user));
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i); assert.match(r.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.equal((await c.get('/api/auth/me')).json.org.name, 'Acme');
  await c.post('/api/auth/logout', {});
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('items CRUD with versions and optimistic concurrency', async () => {
  const { admin } = await bootstrapped();
  const created = await admin.post('/api/items', { kind: 'agent', name: 'Helper', body: { systemPrompt: 'You are Helper.', value: { minutesSavedPerRun: 10 } } });
  assert.equal(created.status, 201); const id = created.json.item.id;
  assert.equal((await admin.get('/api/items?kind=agent')).json.items.length, 1);
  const upd = await admin.put(`/api/items/${id}`, { name: 'Helper 2', body: { systemPrompt: 'v2' }, version: 1 });
  assert.equal(upd.json.item.version, 2);
  assert.equal((await admin.put(`/api/items/${id}`, { body: { systemPrompt: 'stale' }, version: 1 })).status, 409);
  const v = await admin.get(`/api/items/${id}/versions`); assert.deepEqual(v.json.versions.map((x) => x.version), [2, 1]);
  assert.equal((await admin.del(`/api/items/${id}`)).status, 200);
  assert.equal((await admin.get(`/api/items/${id}`)).status, 404);
  assert.equal((await admin.get(`/api/items/${id}/versions`)).json.versions.length, 2, 'history retained after delete');
});

test('copy from library records sourceId; validation rejects bad bodies', async () => {
  const { admin } = await bootstrapped();
  const r = await admin.post('/api/items', { kind: 'flow', name: 'F', sourceId: 'flow.eng.pipeline', body: { steps: [] } });
  assert.equal(r.json.item.sourceId, 'flow.eng.pipeline');
  assert.equal((await admin.post('/api/items', { kind: 'flow', name: 'F', body: {} })).status, 400);
  assert.equal((await admin.post('/api/items', { kind: 'agent', name: 'A', body: {} })).status, 400);
  assert.equal((await admin.post('/api/items', { kind: 'nope', name: 'A', body: {} })).status, 400);
  for (const kind of ['skill', 'mcp', 'context', 'knowledge', 'memory']) assert.equal((await admin.post('/api/items', { kind, name: kind, body: { description: 'x' } })).status, 201, kind);
});

test('runs are metered and priced; KPIs aggregate them; CSV export', async () => {
  const { admin } = await bootstrapped();
  await admin.put('/api/org/settings', { hourlyRate: 100, currency: 'cad', prices: { 'anthropic/m': { in: 3, out: 15 } } });
  const r = await admin.post('/api/runs', { targetKind: 'agent', targetId: 'a1', targetName: 'Agent One', status: 'succeeded', provider: 'anthropic', model: 'm', tokensIn: 1e6, tokensOut: 1e5, latencyMs: 1200, outputs: 1, minutesSaved: 60 });
  assert.equal(r.status, 201); assert.equal(r.json.costUsd, 4.5);
  await admin.post('/api/runs', { targetKind: 'agent', targetId: 'a1', targetName: 'Agent One', status: 'succeeded', provider: 'dryrun', model: 'dryrun', minutesSaved: 60 });
  let k = (await admin.get('/api/kpis?days=30')).json;
  assert.equal(k.adoption.runs, 1); assert.equal(k.testRuns, 1); assert.equal(k.value.hoursSavedEst, 0, 'unaccepted run not valued by default');
  await admin.patch(`/api/runs/${r.json.id}`, { accepted: true, rating: 5 });
  k = (await admin.get('/api/kpis?days=30')).json;
  assert.equal(k.value.hoursSavedEst, 1); assert.equal(k.value.valueEst, 100); assert.equal(k.window.currency, 'CAD'); assert.equal(k.value.roiEst, 22.2); assert.equal(k.output.avgRating, 5);
  const csv = await admin.get('/api/kpis.csv'); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.text, /Agent One/);
});

test('users: admin creates, roles enforced, disable kills sessions', async () => {
  const { app, admin } = await bootstrapped();
  const u = await admin.post('/api/users', { name: 'Vee', email: 'v@example.com', role: 'viewer', password: 'viewer-pass-123' });
  assert.equal(u.status, 201);
  const v = client(app, { ip: '10.0.0.9' }); assert.equal((await v.post('/api/auth/login', { email: 'v@example.com', password: 'viewer-pass-123' })).status, 200);
  assert.equal((await v.get('/api/items')).status, 200);
  assert.equal((await v.post('/api/items', { kind: 'skill', name: 's', body: {} })).status, 403, 'viewer cannot write');
  assert.equal((await v.get('/api/users')).status, 403, 'viewer cannot list users');
  assert.equal((await v.post('/api/runs', {})).status, 403);
  await admin.patch(`/api/users/${u.json.user.id}`, { disabled: true });
  assert.equal((await v.get('/api/items')).status, 401, 'disabled user is signed out');
  assert.equal((await admin.patch(`/api/users/${(await admin.get('/api/auth/me')).json.user.id}`, { role: 'viewer' })).status, 400, 'cannot demote self');
});

test('API keys authenticate scripts and can be revoked', async () => {
  const { app, admin } = await bootstrapped();
  const k = await admin.post('/api/keys', { name: 'ci' }); assert.match(k.json.key, /^hy_/);
  const bot = client(app); const H = { authorization: `Bearer ${k.json.key}` };
  assert.equal((await bot.get('/api/items', H)).status, 200);
  assert.equal((await bot.post('/api/keys', { name: 'nested' }, H)).status, 403, 'keys cannot mint keys');
  await admin.del(`/api/keys/${k.json.id}`);
  assert.equal((await bot.get('/api/items', H)).status, 401);
  assert.ok(!JSON.stringify((await admin.get('/api/keys')).json).includes(k.json.key), 'raw key never listed');
});

test('LLM proxy uses the stored, encrypted key and never returns it', async () => {
  let seenKey = null;
  const fake = async (url, init) => { seenKey = init.headers['x-api-key']; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 3, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } }); };
  const s = makeServer({}, fake); const admin = client(s.app); await admin.post('/api/auth/bootstrap', ADMIN);
  assert.equal((await admin.post('/api/llm/anthropic', { model: 'm', messages: [{ role: 'user', content: 'x' }] })).status, 400, 'no key yet');
  await admin.put('/api/secrets/anthropic', { apiKey: 'sk-ant-SECRET' });
  const row = s.sqlite.prepare('SELECT ciphertext FROM secrets').get(); assert.ok(!row.ciphertext.includes('SECRET'), 'encrypted at rest');
  const r = await admin.post('/api/llm/anthropic', { model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.json.text, 'hi'); assert.equal(seenKey, 'sk-ant-SECRET');
  assert.ok(!JSON.stringify((await admin.get('/api/secrets')).json).includes('SECRET'));
});

test('MCP proxy speaks JSON-RPC (JSON and SSE) and blocks private targets', async () => {
  const fake = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'demo' } } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess1' } });
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'search' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const s = makeServer({}, fake); const admin = client(s.app); await admin.post('/api/auth/bootstrap', ADMIN);
  const init = await admin.post('/api/mcp/call', { url: 'https://mcp.example.com/mcp', method: 'initialize', params: {} });
  assert.equal(init.json.sessionId, 'sess1'); assert.equal(init.json.response.result.serverInfo.name, 'demo');
  const tools = await admin.post('/api/mcp/call', { url: 'https://mcp.example.com/mcp', method: 'tools/list', sessionId: 'sess1' });
  assert.equal(tools.json.response.result.tools[0].name, 'search');
  assert.equal((await admin.post('/api/mcp/call', { url: 'https://169.254.169.254/', method: 'tools/list' })).status, 400);
  assert.equal((await admin.post('/api/mcp/call', { url: 'https://mcp.example.com/mcp', method: 'shutdown' })).status, 400, 'method allowlist');
});
