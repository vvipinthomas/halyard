# SOC 2 control matrix

**Read this first.** SOC 2 is an attestation an independent CPA firm issues about an *organisation's* controls over a period of time (Type II) or at a point in time (Type I). Software cannot be "SOC 2 compliant" on its own. What Halyard provides is a set of **product controls** that map to the AICPA Trust Services Criteria (TSC). An operator can rely on these controls and produce evidence for them during an audit.

Each row says who owns the control:
- **Product**: implemented in this codebase and covered by an automated test.
- **Operator**: the organisation running Halyard must implement it, in policy, process or infrastructure.
- **Shared**: both.

Test IDs refer to `tests/api/security.test.mjs` (SEC-xx), `tests/api/api.test.mjs` and `tests/e2e/workbench.spec.mjs`.

## Common Criteria (Security)

| TSC | Control | Owner | Implementation | Evidence |
|---|---|---|---|---|
| CC1.x, CC2.x | Governance, code of conduct, security awareness | Operator | Not a product feature | Operator policies; `CODE_OF_CONDUCT.md` covers the project community only |
| CC3.x | Risk assessment | Shared | Product threat model maintained in-repo | `docs/security/threat-model.md`; operator risk register |
| CC5.x | Control activities defined by policy | Operator | — | Operator policies |
| CC6.1 | Logical access requires authentication | Product | Session cookies (HttpOnly, Secure, SameSite=Strict) or hashed API keys on every `/api/*` route except health, bootstrap and login | SEC-01, *login, me, logout* |
| CC6.1 | Credential storage | Product | PBKDF2-HMAC-SHA256 with per-user salt; iterations stored per user so the work factor can rise | `src/lib/crypto.js`, unit *password hashing* |
| CC6.1 | Password policy | Product | ≥12 chars, letter and number, ≤256 | SEC-11 |
| CC6.1 | Brute-force protection | Product | Lock after 5 failed attempts for 15 min; 20 login attempts per IP per 15 min | SEC-03, SEC-04 |
| CC6.1 | Session management | Product | 30-min idle timeout and 12-h absolute lifetime, enforced server-side; password change revokes all sessions | SEC-05, SEC-06 |
| CC6.1 | Multi-factor authentication | Product | TOTP (RFC 6238) with ±1-step drift, replay protection, 5-attempt challenges counted toward lockout, 10 single-use hashed recovery codes; secrets AES-256-GCM encrypted; org-wide **Require MFA** confines un-enrolled users to setup; admins can reset (audited, revokes sessions) | `tests/api/mfa.test.mjs` MFA-01…07, unit *TOTP*, e2e *MFA* |
| CC6.1 | Single sign-on | Operator | Not built in; optionally front with Cloudflare Access / OIDC proxy | — |
| CC6.2 | User provisioning and deprovisioning | Product | Admins create users with a role; disabling a user deletes their sessions immediately | *users: admin creates…* |
| CC6.3 | Role-based access, least privilege | Product | viewer < editor < admin, checked server-side per route; users cannot demote or disable themselves | *users…*, SEC-12, SEC-15 |
| CC6.3 | Periodic access review | Operator | Team page lists users, roles and last sign-in for review | Settings → Team |
| CC6.1, C1.1 | Tenant isolation | Product | Every query is scoped by `org_id` | SEC-07 |
| CC6.6 | Boundary protection: outbound | Product | SSRF guard on the MCP proxy and custom model endpoints (HTTPS only; private, loopback, link-local and metadata ranges blocked); redirects refused; MCP method allowlist | unit *SSRF guard*, *MCP proxy…*, SEC-12 |
| CC6.6 | Boundary protection: inbound/browser | Product | CSP with `frame-ancestors 'none'`, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP; CSRF header on cookie-authenticated mutations; 1 MB body limit | SEC-02, SEC-09, SEC-10 |
| CC6.6 | Output encoding (XSS) | Product | All user data is HTML-escaped before rendering | e2e *XSS* |
| CC6.7 | Encryption in transit | Shared | HSTS header; TLS terminated by Cloudflare, or by the operator's proxy in Docker | SEC-09; operator TLS config |
| CC6.7 | Encryption at rest: credentials | Product | Provider API keys sealed with AES-256-GCM, with org+provider bound as additional authenticated data; never returned by the API | unit *AES-256-GCM*, *LLM proxy…* |
| CC6.7 | Encryption at rest: database | Shared | D1 is encrypted at rest by Cloudflare. For Docker, the operator must use an encrypted volume | Operator infra |
| CC6.7 | Key management | Operator | `ENCRYPTION_KEY` is held in Workers Secrets or the Docker env; rotation is a manual re-entry of provider keys today | See finding F-04 |
| CC6.8 | Malicious or vulnerable components | Shared | `npm audit` gate in CI; minimal runtime dependencies (3) | `.github/workflows/ci.yml`; assessment §4 |
| CC7.1 | Vulnerability management | Shared | CI audit, `SECURITY.md` disclosure process | `SECURITY.md` |
| CC7.2 | Monitoring and logging | Product | Append-only audit log covering sign-ins, failures, lockouts, user/role changes, item create/copy/update/delete, secret changes, MCP tool calls, exports and settings | SEC-03, SEC-08, SEC-15 |
| CC7.2 | Log integrity | Product | DB triggers block UPDATE/DELETE; SHA-256 hash chain with a verify endpoint | SEC-08 |
| CC7.3–7.5 | Incident response | Operator | — | Operator runbook; `SECURITY.md` for product vulnerabilities |
| CC8.1 | Change management (product) | Shared | CI runs syntax gate, unit, API, security and e2e tests on every push | `.github/workflows/ci.yml` |
| CC8.1 | Change management (agent configuration) | Product | Every agent, flow, skill, MCP, context, knowledge and memory change is versioned with author and time; optimistic concurrency; soft delete keeps history | *items CRUD…* |
| CC8.1 | Change management for agent-authored changes (Factory) | Product | New products need human approval of the plan and of the launch; CI/deploy pipeline and dependency manifests come from vetted templates, never agents; every change is a PR on a branch; maker–checker agent review; CI required; risk scoring with mandatory human approval above threshold or on sensitive paths; agents cannot edit CI config; budgets, freeze and andon cord; approvals attributed to a named user; full audit trail | `tests/api/factory.test.mjs` FAC-01…08, unit *patch guard / risk* |
| CC7.4 | Incident response & recovery (Factory) | Shared | Automatic detection from Sentry/CI, post-release verification and automatic rollback; escalation to humans after retries | FAC-03; operator runbook still required |
| CC9.2 | Vendor risk (model and MCP providers) | Operator | Catalogue entries link to their registry and repository for review; admins control which provider keys exist | `public/catalog/mcp.json` |

## Availability, Confidentiality, Processing Integrity, Privacy

| TSC | Control | Owner | Implementation | Evidence |
|---|---|---|---|---|
| A1.2 | Backups and recovery | Operator | D1 Time Travel / exports; snapshot the Docker volume `/data` | Operator procedure |
| A1.2 | Health checks | Product | `/api/health`; Docker `HEALTHCHECK` | `Dockerfile` |
| C1.1 | Confidential data handling | Shared | Local and WebGPU models keep prompts off the server; memory write policies forbid secrets | `docs/architecture.md` |
| C1.2 | Disposal | Shared | Soft delete keeps audit history; hard deletion and retention enforcement are operator processes today | See finding F-06 |
| PI1.x | Input validation and integrity | Product | Server-side validation of kinds, bodies and sizes; flow validation; version conflicts return 409 | *copy from library…*, unit *validateFlow* |
| P (privacy) | Data subject access / portability | Product | Admin JSON export of org data (audited) | SEC-15 |
| P (privacy) | Data minimisation | Product | Audit `detail` is truncated; passwords and keys are never logged; CSV export neutralises formula injection | SEC-13 |
