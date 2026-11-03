# Architecture

## Stack choice and why

| Layer | Choice | Why |
|---|---|---|
| API | **Hono** (plain ESM JS) | One codebase runs on Cloudflare Workers and Node; tiny, fast, standards-based (`Request`/`Response`, WebCrypto) |
| Data | **D1** on Cloudflare, **SQLite** (better-sqlite3) in Docker | Same SQL dialect and schema; a thin adapter (`src/lib/db.js`) hides the difference |
| Frontend | Vanilla ES modules, no build step | Zero framework lock-in; static assets deploy unchanged to Workers Static Assets or any file server |
| Engine | Pure ESM in `public/js/engine.js` | Runs **in the browser**, so it can reach local (Ollama/LM Studio) and WebGPU models the server cannot; the same module is unit-tested in Node |
| Crypto | WebCrypto (PBKDF2, AES-256-GCM, SHA-256) | Identical on Workers and Node, no native crypto dependencies |
| Tests | `node:test` + Playwright | No extra test framework; e2e runs desktop and mobile viewports |

## Request paths

```
            ┌──────────── Browser (PWA) ────────────┐
            │ app.js  ─ UI                          │
            │ engine.js ─ flow execution            │──► Ollama / LM Studio (localhost, direct)
            │ providers.js ─ model adapters         │──► WebLLM (WebGPU, in-tab)
            │ mcp-client.js                         │
            └───────────────┬───────────────────────┘
                            │ /api/* (cookie or Bearer hy_…)
            ┌───────────────▼───────────────────────┐
            │ Hono app (src/app.js)                 │
            │  auth · RBAC · items · runs · KPIs    │──► Frontier LLMs (keys decrypted server-side)
            │  audit · secrets · LLM & MCP proxies  │──► Remote MCP (SSRF-guarded)
            └───────────────┬───────────────────────┘
                            │
                    D1 (Workers) / SQLite (Docker)
```

## Data model

`orgs`, `users`, `sessions`, `api_keys`, `items` (agent | flow | skill | mcp | context | knowledge | memory, JSON body, versioned), `item_versions`, `secrets` (AES-GCM), `runs` (metering), `audit_log` (append-only, hash-chained), `rate_limits`. See `migrations/0001_init.sql`.

## Resolution rules

- A flow step references an agent id. Halyard first looks for a workspace agent with that id, then for a workspace agent **adapted from** that library id (`sourceId`), then for the library agent. So "copy & adapt" transparently upgrades every library flow that uses the original.
- At run time an agent's system prompt is built from: its prompt, its skills' SKILL.md bodies, its context packs, the top-matching knowledge chunks (keyword retrieval in the browser), its memory entries, and the tool list from its attached MCP servers.

## Tool protocol

To call a tool, a model replies with a fenced block:

````
```tool
{"server":"<mcp item id>","tool":"search","args":{"q":"…"}}
```
````

The engine executes it via the MCP proxy and feeds the result back, up to a cap (default 5 per step). This works with any model, including small local ones, without relying on vendor-specific function-calling formats.

## Metering

Each run records provider, model, steps, tokens in/out, latency, outputs, characters, estimated minutes saved, status, and later acceptance and rating. Cost is computed server-side from admin-entered prices. KPIs are computed by `src/lib/kpis.js` (pure, unit-tested).
