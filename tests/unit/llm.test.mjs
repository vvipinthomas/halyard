import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callProvider } from '../../src/lib/llm.js';

function fakeFetch(response, status = 200) { const seen = []; const f = async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } }); }; f.seen = seen; return f; }
const req = { model: 'm1', system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 };

test('anthropic request/response mapping', async () => {
  const f = fakeFetch({ content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 7, output_tokens: 3 }, model: 'm1' });
  const r = await callProvider('anthropic', 'k', null, req, f);
  assert.deepEqual(r, { text: 'hello', usage: { in: 7, out: 3 }, model: 'm1' });
  assert.equal(f.seen[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(f.seen[0].init.headers['x-api-key'], 'k'); assert.equal(f.seen[0].body.system, 'sys');
});
test('openai-compatible mapping (openai, groq, openrouter, mistral, custom)', async () => {
  for (const [p, base] of [['openai', 'https://api.openai.com/v1'], ['groq', 'https://api.groq.com/openai/v1'], ['openrouter', 'https://openrouter.ai/api/v1'], ['mistral', 'https://api.mistral.ai/v1'], ['custom', 'https://gw.example.com/v1']]) {
    const f = fakeFetch({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
    const r = await callProvider(p, 'k', p === 'custom' ? base : null, req, f);
    assert.equal(f.seen[0].url, `${base}/chat/completions`); assert.equal(f.seen[0].body.messages[0].role, 'system'); assert.deepEqual(r.usage, { in: 4, out: 2 });
  }
});
test('gemini mapping', async () => {
  const f = fakeFetch({ candidates: [{ content: { parts: [{ text: 'g' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } });
  const r = await callProvider('gemini', 'k', null, req, f);
  assert.match(f.seen[0].url, /models\/m1:generateContent$/); assert.equal(f.seen[0].init.headers['x-goog-api-key'], 'k'); assert.equal(f.seen[0].body.systemInstruction.parts[0].text, 'sys');
  assert.deepEqual(r, { text: 'g', usage: { in: 5, out: 1 }, model: 'm1' });
});
test('provider errors surface as 502 with message; unknown provider 400', async () => {
  await assert.rejects(callProvider('openai', 'k', null, req, fakeFetch({ error: { message: 'bad key' } }, 401)), (e) => e.status === 502 && /bad key/.test(e.message));
  await assert.rejects(callProvider('nope', 'k', null, req, fakeFetch({})), (e) => e.status === 400);
});
