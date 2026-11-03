// Model providers available to the browser engine.
//  - frontier: proxied through /api/llm/:provider (keys stay server-side, encrypted)
//  - local: Ollama / LM Studio / any OpenAI-compatible server on this machine (called directly)
//  - webgpu: WebLLM running in this browser tab
//  - dryrun: deterministic, labelled offline stand-in for tests and demos (no model is called)
export const FRONTIER = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'custom'];
export const LOCAL_DEFAULTS = { ollama: 'http://localhost:11434/v1', lmstudio: 'http://localhost:1234/v1' };
export const WEBLLM_MODELS = ['Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama-3.2-3B-Instruct-q4f16_1-MLC', 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Phi-3.5-mini-instruct-q4f16_1-MLC'];

let webllmEngine = null, webllmModel = null;

export async function callModel({ provider, model, baseUrl, maxTokens = 1500 }, system, messages, { api, onProgress } = {}) {
  if (provider === 'dryrun') return dryRun(system, messages);
  if (FRONTIER.includes(provider)) {
    const r = await api(`/api/llm/${provider}`, { method: 'POST', body: { model, system, messages, maxTokens } });
    return { text: r.text, usage: r.usage, provider, model: r.model || model };
  }
  if (provider === 'ollama' || provider === 'lmstudio') {
    const base = (baseUrl || LOCAL_DEFAULTS[provider]).replace(/\/$/, '');
    let res;
    try {
      res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }) });
    } catch (e) { throw new Error(`Could not reach ${provider} at ${base}. Is it running, and does it allow this origin (Ollama: OLLAMA_ORIGINS)?`); }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${provider} error ${res.status}: ${d.error?.message || d.error || ''}`);
    return { text: d.choices?.[0]?.message?.content || '', usage: { in: d.usage?.prompt_tokens || 0, out: d.usage?.completion_tokens || 0 }, provider, model };
  }
  if (provider === 'webllm') {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser.');
    if (!webllmEngine || webllmModel !== model) {
      const webllm = await import('https://esm.run/@mlc-ai/web-llm');
      webllmEngine = await webllm.CreateMLCEngine(model, { initProgressCallback: (p) => onProgress?.(p.text) });
      webllmModel = model;
    }
    const r = await webllmEngine.chat.completions.create({ messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens });
    return { text: r.choices?.[0]?.message?.content || '', usage: { in: r.usage?.prompt_tokens || 0, out: r.usage?.completion_tokens || 0 }, provider, model };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

// Deterministic offline stand-in. Clearly labelled; token counts are character-based estimates.
export function dryRun(system, messages) {
  const last = messages[messages.length - 1]?.content || '';
  const name = (/You are ([^,.\n]+)/.exec(system) || [])[1] || 'Agent';
  let text;
  if (/Reply with the label only/.test(last)) {
    const labels = (/from: ([^\n]+)/.exec(last)?.[1] || '').split(',').map((s) => s.trim());
    const req = last.split('Request:')[1] || '';
    text = labels.find((l) => req.toLowerCase().includes(l.toLowerCase())) || labels[labels.length - 1];
  } else {
    text = `[DRY RUN — no model was called]\n**${name}** received ${last.length} characters of input.\n\n> ${last.slice(0, 160).replace(/\n/g, ' ')}${last.length > 160 ? '…' : ''}`;
    if (/VERDICT:/.test(system)) text += '\n\nVERDICT: APPROVED';
  }
  return { text, usage: { in: Math.ceil((system.length + last.length) / 4), out: Math.ceil(text.length / 4) }, provider: 'dryrun', model: 'dryrun' };
}
