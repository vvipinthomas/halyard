import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFlow } from '../../public/js/engine.js';
const load = (f) => JSON.parse(readFileSync(new URL(`../../public/catalog/${f}.json`, import.meta.url)));
const [agents, flows, skills, mcp, contexts, memory] = ['agents', 'flows', 'skills', 'mcp', 'contexts', 'memory'].map(load);

test('catalog sizes meet the targets', () => {
  assert.ok(agents.length >= 200); assert.ok(flows.length >= 50); assert.ok(skills.length >= 300);
  assert.ok(mcp.length >= 150); assert.equal(contexts.length, 500); assert.equal(memory.length, 500);
});
test('ids are unique within each collection', () => {
  for (const [n, c] of Object.entries({ agents, flows, skills, mcp, contexts, memory })) assert.equal(new Set(c.map((x) => x.id)).size, c.length, n);
});
test('every flow is structurally valid and references real agents', () => {
  const ids = new Set(agents.map((a) => a.id));
  for (const f of flows) assert.deepEqual(validateFlow(f, ids), [], f.id);
});
test('every agent has a mascot, prompt, value and resolvable skills', () => {
  const sk = new Set(skills.map((s) => s.id));
  for (const a of agents) {
    assert.ok(a.mascot?.species && /^#[0-9a-f]{6}$/i.test(a.mascot.color) && a.mascot.nickname && a.mascot.badge, a.id);
    assert.ok(a.systemPrompt.includes('never invent facts'), a.id);
    assert.ok(a.value.minutesSavedPerRun > 0, a.id);
    for (const s of a.skills) assert.ok(sk.has(s), `${a.id} → ${s}`);
  }
});
test('skills are valid SKILL.md with frontmatter', () => {
  for (const s of skills) assert.match(s.body, /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/, s.id);
});
test('every MCP server has a registry source, run config and verification stamp', () => {
  for (const m of mcp) {
    assert.match(m.source, /^https:\/\/(www\.npmjs\.com\/package|pypi\.org\/project)\//, m.id);
    assert.ok(['npx', 'uvx'].includes(m.config.command), m.id);
    assert.ok(m.verified.at && m.verified.method, m.id);
  }
});
test('memory schemas carry scope, retention and a write policy forbidding secrets', () => {
  for (const m of memory) { assert.ok(['user', 'agent', 'team'].includes(m.scope)); assert.ok(m.retentionDays > 0); assert.match(m.writePolicy, /never store secrets/i); }
});
