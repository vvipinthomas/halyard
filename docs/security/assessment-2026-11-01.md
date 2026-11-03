# Security assessment — Halyard 1.0.0 (2026-11-01)

**Scope:** source in this repository (API, engine, PWA), default configuration for Cloudflare Workers and Docker.
**Method:** design review against the STRIDE threat model, an OWASP ASVS-style checklist of the auth/session/access/input/crypto/logging areas, automated security tests, and a dependency audit.
**Not covered:** penetration testing by an independent party, infrastructure configuration of any specific deployment, or organisational controls. This is an internal engineering assessment, not an audit opinion.

## 1. Summary

| Area | Result |
|---|---|
| Authentication & sessions | Pass (TOTP MFA with enforcement since 1.1.0; SSO not built in) |
| Access control & tenant isolation | Pass |
| Input handling, XSS, CSRF | Pass |
| Outbound request safety (SSRF) | Pass, with one residual (DNS rebinding) |
| Cryptography | Pass, with key rotation as an operator process |
| Logging & audit | Pass |
| Dependencies | 0 known vulnerabilities (`npm audit`, prod and dev) |
| Automated tests | 116 passing: 49 unit, 44 API/security/MFA/factory, 23 e2e (desktop + mobile; 3 desktop-only tests skipped on mobile) |

## 2. Findings

| ID | Severity | Finding | Recommendation | Status |
|---|---|---|---|---|
| F-01 | High (for SOC 2) | No built-in MFA or SSO | Built-in TOTP MFA with recovery codes and org-wide enforcement added in 1.1.0. SSO/OIDC remains on the roadmap | **MFA resolved in 1.1.0**; SSO open |
| F-02 | Medium | The SSRF guard checks hostnames, not resolved IPs, so DNS rebinding is possible | Prefer a vetted MCP allowlist; in Docker, add an egress firewall; native resolver pinning in Node is a roadmap item | Open |
| F-03 | Medium | MCP `authorization` header is stored in the item body (plaintext in DB, visible to org members) | Move to the encrypted `secrets` store, referenced by id | Open: the UI labels the field so users know |
| F-04 | Medium | `ENCRYPTION_KEY` rotation requires re-entering provider keys | Add dual-key decrypt and a re-seal job | Open: documented procedure in `docs/deploy-*.md` |
| F-05 | Low | The audit hash chain is not anchored outside the DB. Concurrent writes could fork the chain; this was observed in testing once the factory wrote audits in the background | Fork fixed in 1.3.0: a UNIQUE(prev_hash) index makes appends atomic, with retry (SEC-16). Still recommended: export the head hash to WORM storage or a SIEM | Fork fixed; anchoring open |
| F-06 | Low | No automatic hard-delete or retention enforcement for runs and soft-deleted items | Add a retention setting enforced by the scheduled job | Open |
| F-07 | Info | Prompt injection is inherent to LLM agents | Keep approval steps before side-effecting tools; least-privilege MCP tokens | Accepted, documented |
| F-08 | Low | PBKDF2 is capped at 100,000 iterations on Workers (a platform limit). OWASP recommends 600,000 for PBKDF2-SHA256 | Raise `PBKDF2_ITERATIONS` on Docker; on Workers rely on lockout and rate limits, or move auth to an IdP (F-01) | Accepted with compensating controls |

## 3. Checklist highlights (verified by test)

- Every protected route returns 401 without credentials (SEC-01).
- Cookie mutations without the CSRF header are rejected (SEC-02).
- Lockout after 5 failures; per-IP login rate limit (SEC-03/04).
- Idle timeout enforced server-side; password change revokes sessions (SEC-05/06).
- Another org cannot read, update or delete items (SEC-07).
- The audit log rejects UPDATE/DELETE; verify detects tampering (SEC-08).
- Security headers and `no-store` on API responses (SEC-09).
- 1 MB request limit (SEC-10); password policy (SEC-11).
- Only admins can set provider keys; custom endpoints are SSRF-checked (SEC-12).
- CSV formula injection neutralised (SEC-13); no stack traces in errors (SEC-14).
- Export is admin-only and audited; password hashes are never exported (SEC-15).
- Provider keys are encrypted at rest and never returned (*LLM proxy* test); AAD prevents moving ciphertext between orgs (unit).
- A stored XSS payload in an item name renders as text and runs no script (e2e).

## 4. Dependency audit

```
npm audit --omit=dev   → found 0 vulnerabilities
npm audit              → found 0 vulnerabilities
```
Runtime dependencies: `hono`, `@hono/node-server`, `better-sqlite3`. CI repeats the audit on every push.

## 5. Re-assessment

Re-run this assessment on each minor release and after any change to auth, the proxies, or crypto. Commission an independent penetration test before production use with sensitive data.
