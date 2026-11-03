// Server-side proxy for frontier providers so API keys never reach the browser.
// Normalised request: { model, system, messages:[{role:'user'|'assistant', content}], maxTokens }
// Normalised response: { text, usage:{ in, out }, model }
export const PROVIDERS = {
  anthropic: { base: 'https://api.anthropic.com/v1', style: 'anthropic' },
  openai: { base: 'https://api.openai.com/v1', style: 'openai' },
  groq: { base: 'https://api.groq.com/openai/v1', style: 'openai' },
  openrouter: { base: 'https://openrouter.ai/api/v1', style: 'openai' },
  mistral: { base: 'https://api.mistral.ai/v1', style: 'openai' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta', style: 'gemini' },
  custom: { base: null, style: 'openai' }, // OpenAI-compatible endpoint (LiteLLM, vLLM, Azure-compatible gateways)
};

export async function callProvider(provider, apiKey, baseUrl, req, fetchImpl = fetch) {
  const p = PROVIDERS[provider];
  if (!p) throw httpError(400, `Unknown provider ${provider}`);
  const base = (baseUrl || p.base || '').replace(/\/$/, '');
  if (!base) throw httpError(400, 'This provider needs a base URL');
  const maxTokens = Math.min(Math.max(Number(req.maxTokens) || 1024, 1), 32000);
  const messages = (req.messages || []).filter((m) => m && typeof m.content === 'string').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  let url, headers, body;
  if (p.style === 'anthropic') {
    url = `${base}/messages`;
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    body = { model: req.model, max_tokens: maxTokens, system: req.system || undefined, messages };
  } else if (p.style === 'gemini') {
    url = `${base}/models/${encodeURIComponent(req.model)}:generateContent`;
    headers = { 'x-goog-api-key': apiKey, 'content-type': 'application/json' };
    body = { contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens } };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  } else {
    url = `${base}/chat/completions`;
    headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
    body = { model: req.model, max_tokens: maxTokens, messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), ...messages] };
  }
  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(502, `${provider} returned ${res.status}: ${(data.error?.message || data.error?.type || JSON.stringify(data)).slice(0, 300)}`);
  if (p.style === 'anthropic') return { text: (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), usage: { in: data.usage?.input_tokens || 0, out: data.usage?.output_tokens || 0 }, model: data.model || req.model };
  if (p.style === 'gemini') return { text: (data.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''), usage: { in: data.usageMetadata?.promptTokenCount || 0, out: data.usageMetadata?.candidatesTokenCount || 0 }, model: req.model };
  return { text: data.choices?.[0]?.message?.content || '', usage: { in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 }, model: data.model || req.model };
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
