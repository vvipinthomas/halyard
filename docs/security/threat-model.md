# Threat model (STRIDE)

## System and trust boundaries

```
Browser (PWA, engine, local/WebGPU calls)
   │  HTTPS, session cookie / API key        ← boundary 1: internet → API
   ▼
Halyard API (Hono on Workers or Node)
   ├── D1 / SQLite (users, items, runs, audit, encrypted secrets)   ← boundary 2: app → data
   ├── Frontier LLM providers (server-held keys)                     ← boundary 3: app → third parties
   └── Remote MCP servers via proxy (SSRF-guarded)                   ← boundary 4: app → user-chosen endpoints
Browser → localhost Ollama / LM Studio (never touches the server)    ← boundary 5: browser → local services
```

**Assets:** provider API keys, user credentials, agent and flow definitions (intellectual property), knowledge and memory content, run metadata, and the audit log.

## Threats and mitigations

| # | STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|---|
| T1 | Spoofing | Credential stuffing or brute force | Lockout, per-IP rate limit, password policy, PBKDF2, TOTP MFA (enforceable org-wide) | Phishing of live TOTP codes is still possible; WebAuthn/passkeys would remove it |
| T2 | Spoofing | Session theft via XSS | HttpOnly cookies; CSP without inline scripts; HTML escaping (e2e tested) | `style-src-attr 'unsafe-inline'` allows inline style attributes only |
| T3 | Spoofing | CSRF on mutations | SameSite=Strict plus a required custom header | — |
| T4 | Tampering | Editing agent config without trace | Versioned items, audit log, RBAC | — |
| T5 | Tampering | Editing the audit log | Append-only triggers plus a hash chain | A DB owner can drop triggers and rewrite the whole chain; anchor the head hash externally (F-05) |
| T6 | Repudiation | User denies an action | Audit log with user, IP and time | — |
| T7 | Info disclosure | Provider keys leaked | AES-256-GCM at rest, server-only use, never returned, AAD-bound to org | A compromised `ENCRYPTION_KEY` plus a DB dump exposes keys (F-04) |
| T8 | Info disclosure | Cross-tenant reads | `org_id` scoping on every query (tested) | — |
| T9 | Info disclosure | SSRF to cloud metadata or internal services | URL guard, HTTPS only, redirects refused, method allowlist | DNS rebinding not prevented: a public hostname can resolve to a private IP (F-02) |
| T10 | Info disclosure | MCP authorization headers stored in item bodies | Visible only to org members; audit on change | Not encrypted like provider keys (F-03) |
| T11 | DoS | Request floods, huge bodies, runaway loops | Body limit, LLM/MCP per-user rate limits, loop max ≤10, tool-call cap | Workers platform limits apply; no global quota per org |
| T12 | EoP | Viewer escalates to editor or admin | Server-side role checks; self-demotion blocked; API keys cannot mint keys | — |
| T13 | EoP / integrity | **Prompt injection** via knowledge, tool results or web content steering an agent | Tool calls only to MCP servers an editor attached; capped tool calls; approval steps in flows; outputs are displayed as text and never executed | Inherent to LLM agents. Use approval gates before any side-effecting tool (F-07) |
| T15 | Tampering | An agent writes harmful or weakening code | Patch guard (no CI edits, no traversal, no credentials, size/file caps), reviewer agent, CI, risk gate with human approval on sensitive paths, branch protection recommended, rollback | Subtle logic bugs can pass review and tests; keep risk threshold conservative and watch windows long enough |
| T16 | EoP | Prompt injection via issue text or logs steers the crew (e.g. “merge this”) | Untrusted content fenced as data; strict JSON outputs; the agent cannot merge, only the policy engine can; risk/approval gates are code, not prompts | Model may still produce a plausible-but-wrong fix; gates and monitoring catch most |
| T17 | Info disclosure | Repository code sent to a model provider | Only diagnosed files (≤3) and the file list are sent; choose a provider under your data agreement or a self-hosted OpenAI-compatible endpoint | Inherent to using hosted models |
| T14 | Supply chain | Malicious MCP package | Catalogue lists registry-verified packages with source links; nothing is auto-installed | Registry presence ≠ safe. Review before use |
