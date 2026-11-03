// HALYARD orchestration engine — pure ESM, no DOM. Runs in the browser (so it can reach local and
// WebGPU models) and in Node for tests. Step types: agent, parallel, router, loop, approval.
export class RejectedError extends Error { constructor(msg) { super(msg); this.name = 'RejectedError'; } }
export class CancelledError extends Error { constructor() { super('Run cancelled'); this.name = 'CancelledError'; } }

export function render(tpl, vars) {
  return String(tpl ?? '{{input}}').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), vars);
    return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  });
}

const TOOL_RE = /```tool\s*\n([\s\S]*?)```/;
export function parseToolCall(text) {
  const m = TOOL_RE.exec(text || ''); if (!m) return null;
  try { const j = JSON.parse(m[1]); return j && j.server && j.tool ? { server: String(j.server), tool: String(j.tool), args: j.args || {} } : null; } catch { return null; }
}

export function buildSystem(agent, { skills = [], contexts = [], memories = [], tools = [] } = {}) {
  const parts = [agent.systemPrompt || `You are ${agent.name}.`];
  if (skills.length) parts.push('# Skills you can apply\n' + skills.map((s) => s.body || `## ${s.name}\n${s.description}`).join('\n\n'));
  if (contexts.length) parts.push('# Context (authoritative)\n' + contexts.map((c) => c.body || c.description).join('\n\n'));
  if (memories.length) parts.push('# Memory (facts recorded earlier; verify if stale)\n' + memories.map((m) => `- ${m}`).join('\n'));
  if (tools.length) parts.push('# Tools\nTo call a tool, reply with ONLY a fenced block:\n```tool\n{"server":"<server id>","tool":"<tool name>","args":{}}\n```\nYou will receive the result and can continue. Available:\n' +
    tools.map((t) => `- ${t.server} / ${t.name}: ${t.description || ''}`).join('\n'));
  return parts.join('\n\n');
}

export function createRun(ctx) {
  const counted = new Set();
  const metrics = { tokensIn: 0, tokensOut: 0, calls: 0, steps: 0, outputs: 0, outputChars: 0, toolCalls: 0, models: new Set(), minutesSaved: 0 };
  const trace = [];
  const emit = (e) => { trace.push({ at: Date.now(), ...e }); ctx.onEvent?.(e); };
  const check = () => { if (ctx.signal?.aborted) throw new CancelledError(); };
  const maxTools = ctx.maxToolCalls ?? 5;

  async function runAgent(step, vars = {}) {
    check();
    const agent = await ctx.getAgent(step.agent);
    if (!agent) throw new Error(`Agent not found: ${step.agent}`);
    const env = (await ctx.resolveAgentEnv?.(agent)) || {};
    const system = buildSystem(agent, env);
    const messages = [{ role: 'user', content: render(step.prompt, vars) }];
    emit({ type: 'step.start', step: step.id, ref: step.agent, agent: agent.name, mascot: agent.mascot });
    let text = '';
    vars.lastRef = step.agent;
    for (let i = 0; i <= maxTools; i++) {
      check();
      const r = await ctx.callModel(agent, system, messages);
      metrics.calls++; metrics.tokensIn += r.usage?.in || 0; metrics.tokensOut += r.usage?.out || 0;
      if (r.provider) metrics.models.add(`${r.provider}/${r.model || ''}`);
      text = r.text || '';
      const call = parseToolCall(text);
      if (!call || !ctx.callTool || i === maxTools) break;
      metrics.toolCalls++;
      emit({ type: 'tool.call', step: step.id, ref: step.agent, ...call });
      let result;
      try { result = await ctx.callTool(call.server, call.tool, call.args); } catch (e) { result = { error: String(e.message || e) }; }
      emit({ type: 'tool.result', step: step.id, ref: step.agent, server: call.server, tool: call.tool });
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Tool result for ${call.tool}:\n${JSON.stringify(result).slice(0, 12000)}` });
    }
    metrics.steps++; metrics.outputs++; metrics.outputChars += text.length;
    if (!counted.has(agent.id || agent.name)) { counted.add(agent.id || agent.name); metrics.minutesSaved += Number(agent.value?.minutesSavedPerRun) || 0; }
    emit({ type: 'step.done', step: step.id, ref: step.agent, agent: agent.name, output: text });
    return text;
  }

  async function exec(step, vars) {
    check();
    switch (step.type) {
      case 'agent': return runAgent(step, vars);
      case 'parallel': {
        const outs = await Promise.all(step.branches.map((b) => exec(b, vars)));
        return outs.map((o, i) => `## ${step.branches[i].id}\n${o}`).join('\n\n');
      }
      case 'router': {
        const keys = Object.keys(step.routes || {});
        const label = await runAgent({ id: step.id, agent: step.agent, prompt: `Classify the request into exactly one label from: ${keys.join(', ')}.\nReply with the label only.\n\nRequest:\n{{input}}` }, vars);
        const pick = keys.find((k) => new RegExp(`\\b${k}\\b`, 'i').test(label)) || (keys.includes('other') ? 'other' : keys[0]);
        emit({ type: 'route', step: step.id, label: pick });
        return exec(step.routes[pick], vars);
      }
      case 'loop': {
        let last = vars.prev ?? ''; const max = Math.min(step.max || 3, 10);
        for (let i = 1; i <= max; i++) {
          emit({ type: 'loop.iteration', step: step.id, iteration: i });
          for (const b of step.body) { last = await exec(b, { ...vars, prev: last }); vars.steps[b.id] = last; }
          if (step.until && last.includes(step.until)) { emit({ type: 'loop.exit', step: step.id, reason: 'condition met', iteration: i }); return last; }
        }
        emit({ type: 'loop.exit', step: step.id, reason: 'max iterations', iteration: max });
        return last;
      }
      case 'approval': {
        emit({ type: 'approval.wait', step: step.id, message: step.message, ref: vars.lastRef });
        const ok = ctx.approve ? await ctx.approve(step.message || 'Approve?', vars.prev) : true;
        emit({ type: 'approval.result', step: step.id, approved: !!ok });
        if (!ok) throw new RejectedError(`Rejected at ${step.id}`);
        return vars.prev;
      }
      default: throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  async function run(flow, input) {
    const vars = { input, prev: input, steps: {} };
    const started = Date.now(); let status = 'succeeded'; let output = ''; let error = null;
    emit({ type: 'run.start', flow: flow.name });
    try {
      for (const s of flow.steps || []) { vars.prev = await exec(s, vars); vars.steps[s.id] = vars.prev; }
      output = vars.prev;
    } catch (e) {
      status = e instanceof RejectedError ? 'rejected' : e instanceof CancelledError ? 'cancelled' : 'failed';
      error = e.message; output = vars.prev;
    }
    const latencyMs = Date.now() - started;
    emit({ type: 'run.end', status, latencyMs, error });
    return { status, output, error, latencyMs, trace, metrics: { ...metrics, models: [...metrics.models] } };
  }

  return { run, runAgentOnce: (agentId, input) => run({ name: agentId, steps: [{ id: 'agent', type: 'agent', agent: agentId, prompt: '{{input}}' }] }, input) };
}

export function validateFlow(flow, knownAgents = null) {
  const errs = []; const ids = new Set();
  const walk = (s, path) => {
    if (!s || typeof s !== 'object') { errs.push(`${path}: step must be an object`); return; }
    if (!s.id) errs.push(`${path}: missing id`); else if (ids.has(s.id)) errs.push(`${path}: duplicate id ${s.id}`); else ids.add(s.id);
    if (!['agent', 'parallel', 'router', 'loop', 'approval'].includes(s.type)) errs.push(`${path}: unknown type ${s.type}`);
    if ((s.type === 'agent' || s.type === 'router') && !s.agent) errs.push(`${path}: needs an agent`);
    if (knownAgents && s.agent && !knownAgents.has(s.agent)) errs.push(`${path}: unknown agent ${s.agent}`);
    if (s.type === 'parallel') (s.branches || []).forEach((b, i) => walk(b, `${path}.branches[${i}]`));
    if (s.type === 'router') { if (!s.routes || !Object.keys(s.routes).length) errs.push(`${path}: router needs routes`); else Object.entries(s.routes).forEach(([k, b]) => walk(b, `${path}.routes.${k}`)); }
    if (s.type === 'loop') { if (!Array.isArray(s.body) || !s.body.length) errs.push(`${path}: loop needs a body`); else s.body.forEach((b, i) => walk(b, `${path}.body[${i}]`)); }
  };
  if (!Array.isArray(flow?.steps) || !flow.steps.length) errs.push('flow needs at least one step');
  else flow.steps.forEach((s, i) => walk(s, `steps[${i}]`));
  return errs;
}
