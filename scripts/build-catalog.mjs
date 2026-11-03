#!/usr/bin/env node
// Builds public/catalog/*.json from catalog-src. Deterministic: same input → same output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DOMAINS, SPECIES } from '../catalog-src/domains.mjs';

const OUT = new URL('../public/catalog/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const PALETTE = ['#4f8cff','#22b07d','#ff8a3d','#e5484d','#2fb8c9','#8e6cff','#ff6fae','#f5b700','#c86bfa','#ff7a59','#3dbb6c','#3fa7ff','#13a89e','#ff9ecf','#7d8597','#b5651d','#5c7cfa','#e8590c','#f08c00','#d4a017'];
const BADGE = { eng: 'code', qa: 'check', ops: 'cloud', sec: 'shield', de: 'database', ds: 'chart', pm: 'rocket', del: 'flows', ux: 'palette', mkt: 'megaphone', sales: 'cart', cs: 'chat', fin: 'dollar', hr: 'crew', legal: 'scale', opsb: 'wrench', res: 'search', write: 'pen', edu: 'cap', exec: 'compass', it: 'settings' };
const ACCESSORIES = ['glasses','headset','beanie','bowtie','crown','scarf','monocle','flower','cap','none'];
const NICK_A = ['Pip','Mo','Bo','Lu','Ki','Zu','Nim','Tai','Rue','Fen','Juno','Oli','Bix','Wren','Dot','Pax','Sol','Ivy','Kip','Remy'];
const NICK_B = ['', 'po', 'bean', 'kins', 'let', 'by', 'sy', 'mo', 'ster', 'lo'];

// ---------- Skills ----------
const skills = [];
for (const d of DOMAINS) {
  for (const [s, desc] of d.skills) {
    const id = `${d.k}.${s}`;
    const md = `---\nname: ${s}\ndescription: ${desc}.\n---\n\n# ${titleCase(s)}\n\n${desc}.\n\n## When to use\nUse when the task is: ${desc.toLowerCase()}. Domain: ${d.name}.\n\n## Inputs\n- The material to work on (paste, file or link)\n- Audience and purpose\n- Any constraints (format, length, policy, deadline)\n\n## Steps\n${d.proc.map((p, i) => `${i + 1}. ${p}.`).join('\n')}\n\n## Output\nA ${titleCase(s).toLowerCase()} artefact in Markdown, followed by a short "Assumptions & gaps" list.\n\n## Quality checks\n- Every factual claim traces to the input or a cited source; nothing is invented.\n- Missing inputs are listed as questions rather than guessed.\n- Output is in the requested format and length.\n`;
    skills.push({ id, name: s, title: titleCase(s), domain: d.name, description: desc, body: md, tags: [d.k] });
  }
}

// ---------- MCP (verified) ----------
const mcpSrc = JSON.parse(readFileSync(new URL('../catalog-src/mcp-verified.json', import.meta.url)));
const mcp = mcpSrc.servers.map((s) => ({
  id: `mcp.${s.eco}.${s.name.replace(/^@/, "").split("/").map(slug).join("~")}`, name: s.name, title: titleCase(slug(s.name.replace(/^@[^/]+\//, ''))),
  category: s.category, description: s.desc, ecosystem: s.eco, repo: s.repo || null, source: s.source,
  monthlyDownloads: s.monthly ?? null, transport: 'stdio', config: s.install, verified: { at: mcpSrc.verifiedAt, method: mcpSrc.method },
}));

// ---------- Agents + mascots ----------
const agents = [];
let n = 0;
for (const d of DOMAINS.filter((x) => x.agents)) {
  d.agents.forEach(([title, goal, min], i) => {
    const id = `${d.k}.${slug(title)}`;
    const domSkills = skills.filter((s) => s.tags[0] === d.k);
    const pick = [domSkills[i % 10], domSkills[(i + 3) % 10], domSkills[(i + 7) % 10]].map((s) => s.id);
    const species = i % 3 === 0 ? d.species : SPECIES[(n * 7 + i) % SPECIES.length];
    const nickname = NICK_A[(n + i * 3) % NICK_A.length] + NICK_B[(n * 3 + i) % NICK_B.length];
    agents.push({
      id, name: title, domain: d.name, goal,
      mascot: { species, color: PALETTE[(n + i) % PALETTE.length], accessory: ACCESSORIES[(i + n) % ACCESSORIES.length], nickname, badge: BADGE[d.k] || 'sparkle' },
      systemPrompt: `You are ${title}, a ${d.name} agent. Goal: ${goal}.\nWork method:\n${d.proc.map((p, j) => `${j + 1}. ${p}.`).join('\n')}\nRules: never invent facts, numbers or sources; ask for missing inputs; state assumptions; keep outputs in Markdown. When reviewing, end with exactly one line: VERDICT: APPROVED or VERDICT: CHANGES_NEEDED.`,
      skills: pick, mcpCategories: d.mcp, model: { tier: min >= 60 ? 'frontier' : 'balanced' },
      value: { minutesSavedPerRun: min },
    });
    n++;
  });
}
const A = (k, i) => agents.filter((a) => a.id.startsWith(k + '.'))[i].id;

// ---------- Flows / harnesses (50) ----------
const flows = [];
for (const d of DOMAINS.filter((x) => x.agents)) {
  flows.push({ id: `flow.${d.k}.pipeline`, name: `${d.name} pipeline`, pattern: 'sequential',
    description: `Draft → refine → final check for ${d.name.toLowerCase()} work, with a human approval before release.`,
    steps: [
      { id: 'draft', type: 'agent', agent: A(d.k, 0), prompt: '{{input}}' },
      { id: 'refine', type: 'agent', agent: A(d.k, 2), prompt: 'Improve this draft for the original request.\nRequest: {{input}}\nDraft:\n{{prev}}' },
      { id: 'gate', type: 'approval', message: 'Approve the refined output before it is final?' },
    ] });
  flows.push({ id: `flow.${d.k}.maker-checker`, name: `${d.name} maker–checker loop`, pattern: 'loop',
    description: 'One agent produces, another reviews; the loop exits on APPROVED or after 3 rounds.',
    steps: [{ id: 'loop', type: 'loop', until: 'VERDICT: APPROVED', max: 3, body: [
      { id: 'make', type: 'agent', agent: A(d.k, 1), prompt: 'Request: {{input}}\nPrevious review (may be empty):\n{{prev}}' },
      { id: 'check', type: 'agent', agent: A(d.k, 0), prompt: 'Review this against the request: {{input}}\n\n{{prev}}' },
    ] }] });
}
const cross = [
  ['Feature: PRD to tested code', 'sequential', [['agent', A('pm', 0)], ['agent', A('eng', 3)], ['agent', A('eng', 9)], ['agent', A('qa', 0)], ['approval']]],
  ['Release readiness review', 'parallel', [['parallel', [A('qa', 9), A('sec', 1), A('ops', 8)]], ['agent', A('del', 0)]]],
  ['Incident to postmortem', 'sequential', [['agent', A('ops', 2)], ['agent', A('ops', 3)], ['agent', A('exec', 8)], ['approval']]],
  ['Support ticket router', 'router', [['router', A('cs', 1), { billing: A('fin', 3), bug: A('eng', 1), howto: A('cs', 0), security: A('sec', 8) }]]],
  ['Research to blog post', 'sequential', [['agent', A('res', 0)], ['agent', A('res', 1)], ['agent', A('write', 1)], ['agent', A('mkt', 9)]]],
  ['Contract intake triage', 'router', [['router', A('legal', 1), { nda: A('legal', 2), dpa: A('legal', 5), other: A('legal', 0) }], ['approval']]],
  ['Board pack builder', 'parallel', [['parallel', [A('fin', 7), A('del', 6), A('exec', 9)]], ['agent', A('exec', 3)], ['approval']]],
  ['New hire end-to-end', 'sequential', [['agent', A('hr', 0)], ['agent', A('hr', 1)], ['agent', A('hr', 2)], ['agent', A('it', 2)]]],
  ['Data product delivery', 'sequential', [['agent', A('de', 5)], ['agent', A('de', 0)], ['agent', A('de', 4)], ['agent', A('de', 3)]]],
  ['AI agent security review', 'parallel', [['parallel', [A('sec', 0), A('sec', 9), A('sec', 3)]], ['agent', A('sec', 6)], ['approval']]],
];
for (const [name, pattern, spec] of cross) {
  const steps = spec.map((s, i) => {
    const id = `s${i + 1}`;
    if (s[0] === 'agent') return { id, type: 'agent', agent: s[1], prompt: i === 0 ? '{{input}}' : 'Original request: {{input}}\nPrevious step output:\n{{prev}}' };
    if (s[0] === 'approval') return { id, type: 'approval', message: 'Approve before finishing?' };
    if (s[0] === 'parallel') return { id, type: 'parallel', branches: s[1].map((a, j) => ({ id: `${id}b${j}`, type: 'agent', agent: a, prompt: '{{input}}' })) };
    if (s[0] === 'router') return { id, type: 'router', agent: s[1], routes: Object.fromEntries(Object.entries(s[2]).map(([k, a]) => [k, { id: `${id}-${k}`, type: 'agent', agent: a, prompt: '{{input}}' }])) };
  });
  flows.push({ id: `flow.x.${slug(name)}`, name, pattern, description: `Cross-team harness: ${name}.`, steps });
}

// ---------- Context templates (25 domains × 20) ----------
const CTX = [
  ['Glossary', ['Term', 'Definition', 'Do not confuse with']], ['Style guide', ['Voice', 'Formatting', 'Words we avoid']],
  ['Definition of done', ['Criteria', 'Evidence required', 'Who signs off']], ['Escalation policy', ['Severity levels', 'Who to contact', 'Response times']],
  ['Stakeholder register', ['Name/role', 'Interest', 'Preferred channel']], ['Constraints & non-goals', ['Hard constraints', 'Non-goals', 'Assumptions']],
  ['Systems inventory', ['System', 'Owner', 'Integration points']], ['Quality bar', ['Must-haves', 'Nice-to-haves', 'Rejection reasons']],
  ['Compliance obligations', ['Obligation', 'Source (law/policy)', 'Control']], ['Templates & formats', ['Artefact', 'Required sections', 'Example']],
  ['Team working agreement', ['Hours & channels', 'Review norms', 'Decision rights']], ['Customer profile', ['Segment', 'Jobs & pains', 'Evidence']],
  ['Risk appetite', ['Accept', 'Escalate', 'Never']], ['Tooling & access', ['Tool', 'Use for', 'Access rules']],
  ['Data handling rules', ['Classification', 'Allowed processing', 'Retention']], ['KPIs & targets', ['KPI', 'Definition', 'Target']],
  ['Prior decisions', ['Decision', 'Date & owner', 'Rationale']], ['Known issues', ['Issue', 'Workaround', 'Status']],
  ['Brand & tone', ['Personality', 'Do', "Don't"]], ['Onboarding brief', ['What we do', 'Key people', 'First-week tasks']],
];
const contexts = [];
for (const d of DOMAINS.slice(0, 25)) for (const [t, cols] of CTX) {
  contexts.push({ id: `ctx.${d.k}.${slug(t)}`, name: `${d.name} — ${t}`, domain: d.name, kind: t,
    description: `${t} context pack for ${d.name.toLowerCase()} agents. Fill in the table; agents receive it as grounding.`,
    body: `# ${d.name}: ${t}\n\n> Fill-in template. Agents treat this as authoritative context — keep it current.\n\n| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n| | | |\n\n## Notes\n- Owner:\n- Last reviewed:\n` });
}

// ---------- Memory schemas (25 domains × 20) ----------
const MEM = [
  ['Decision log', 'team', 730, ['decision', 'owner', 'date', 'rationale', 'alternatives']], ['User preferences', 'user', 365, ['preference', 'scope', 'source']],
  ['Entity facts', 'team', 365, ['entity', 'attribute', 'value', 'source', 'verifiedAt']], ['Run summaries', 'agent', 90, ['runId', 'goal', 'outcome', 'lessons']],
  ['Lessons learned', 'team', 730, ['situation', 'what worked', 'what failed']], ['Open questions', 'team', 60, ['question', 'askedBy', 'status']],
  ['Glossary memory', 'team', 730, ['term', 'meaning']], ['Corrections', 'agent', 365, ['mistake', 'correction', 'appliesTo']],
  ['Contacts & owners', 'team', 365, ['area', 'owner', 'backup']], ['Commitments', 'team', 120, ['commitment', 'owner', 'due', 'status']],
  ['Feedback received', 'agent', 180, ['output', 'rating', 'comment']], ['Style memory', 'user', 365, ['rule', 'example']],
  ['Project state', 'team', 180, ['project', 'phase', 'status', 'next']], ['Source registry', 'team', 365, ['source', 'trust', 'notes']],
  ['Recurring tasks', 'user', 365, ['task', 'cadence', 'lastDone']], ['Risk memory', 'team', 365, ['risk', 'trigger', 'mitigation']],
  ['Tool quirks', 'agent', 365, ['tool', 'quirk', 'workaround']], ['Customer context', 'team', 365, ['customer', 'context', 'consentBasis']],
  ['Working set', 'agent', 7, ['item', 'why relevant']], ['Retired facts', 'team', 30, ['fact', 'retiredBecause']],
];
const memory = [];
for (const d of DOMAINS.slice(0, 25)) for (const [t, scope, days, fields] of MEM) {
  memory.push({ id: `mem.${d.k}.${slug(t)}`, name: `${d.name} — ${t}`, domain: d.name, kind: t, scope, retentionDays: days,
    schema: { type: 'object', required: [fields[0]], properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])) },
    writePolicy: 'Write only facts stated by a user or verified in a tool result; never store secrets, credentials or special-category personal data; prefer updating an existing entry over appending a duplicate.',
    description: `${scope}-scoped ${t.toLowerCase()} for ${d.name.toLowerCase()}, kept ${days} days.` });
}

const write = (f, data) => writeFileSync(new URL(f, OUT), JSON.stringify(data));
write('agents.json', agents); write('flows.json', flows); write('skills.json', skills);
write('mcp.json', mcp); write('contexts.json', contexts); write('memory.json', memory);
const counts = { agents: agents.length, flows: flows.length, skills: skills.length, mcp: mcp.length, contexts: contexts.length, memory: memory.length };
write('index.json', { version: 1, builtFrom: 'catalog-src', counts });
console.log(counts);
