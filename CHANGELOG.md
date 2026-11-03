# Changelog

## Unreleased
- Fixed: concurrent audit writes could fail with "Audit log is busy". Appends are now queued per database within a process.
- Fixed: parallel requests could slip past rate limits, and two factory ticks (the timer plus a manual run) could act on the same product at once. Both now use single atomic statements.
- Security: on Node/Docker, client-sent `X-Forwarded-For` / `CF-Connecting-IP` headers are no longer trusted, so the per-IP login limit can't be bypassed. The new `TRUST_PROXY=true` setting is for running behind one reverse proxy.
- Node/Docker: graceful shutdown on SIGTERM/SIGINT; the server fails fast on a malformed `ENCRYPTION_KEY` (or a missing one when `NODE_ENV=production`) and on a port already in use; SQLite `busy_timeout`; static files are served correctly when the server is started from another directory.
- README: Windows (PowerShell) quick start.
- Zero-config local start: `npm start` creates `.env` with a fresh `ENCRYPTION_KEY` (cross-platform, no openssl) and the server loads it. `npm run setup` does the same on demand.
- Fixed: `engines` said Node ≥ 20, but `better-sqlite3` 13 requires Node ≥ 22. The engines field is corrected, `.nvmrc` is added, and setup stops with a clear message on older Node.
- Docs: new illustrated [user guide](docs/user-guide.md), a refreshed README with screenshots and troubleshooting, and `npm run screenshots` to regenerate images from the live UI.
- CI: `.gitlab-ci.yml` alongside GitHub Actions; issue and PR templates.

## 1.5.0 — 2026-11-01
- **Full-body crew:** characters now have torsos, bellies, arms with paws/wings/flippers, feet and species tails, with more realistic shading (iris eyes with lids and catchlights, glossy noses, fur-edge texture, neck occlusion, rim light).
- **Acted poses:** arms animate per state: wave, type, hand-to-chin, reach for the tool, celebrate, droop.

## 1.4.0 — 2026-11-01
- **Crew redesign:** original soft-3D characters on rounded app-icon tiles: gradient lighting, specular sheen, glossy eyes, ground shadow, refined accessories. New **role badges** (28 role icons, added to the Harbor icon set) show what each agent does; catalog agents and the factory crew are badged by role, and badges are editable per agent. Animation states unchanged.
- Fixed: animation transform origins applied to every SVG element, which skewed rotated shapes and the tool-state gear; now scoped to the animated parts only.

## 1.3.0 — 2026-11-01
- Renamed to **Software Factory**.
- **Build from scratch:** brief → PRD and architecture (Product Strategist, Architect) → plan approval → vetted template (CI/deploy/config written by Halyard, not agents) → Builder writes planned files only → CI with automatic fixes → review → launch approval → live → handed to the operate loop. Two templates (Workers web app, static site).
- Sandbox builds produce a genuinely working app whose own tests run in CI here; built products get product-specific incident scenarios.
- Fixed: template test script now works on Node 22 (`node --test`).
- Fixed: concurrent audit writes (e.g. a background factory tick alongside a request) could fork the audit hash chain. Appends are now atomic via a UNIQUE(prev_hash) index with retry (migration 0004).

## 1.2.0 — 2026-11-01
- **Software Factory** (introduced as “dark factory”): an agent crew (Triage Lead, Root-Cause Detective, Fix Engineer, Code Reviewer, Release Captain, SRE Watch, Customer Advocate) that operates products end to end with guarded autonomy. GitHub, Sentry and Cloudflare Workers connectors plus a deterministic sandbox; risk scoring and patch guard; human approval gates; automatic rollback; andon cord; budgets; signed webhooks; DORA and autonomy KPIs; full audit trail. Runs unattended on the cron trigger (Workers) or an interval (Docker).

## 1.1.0 — 2026-11-01
- **MFA:** TOTP two-step sign-in with QR enrolment, replay protection, 10 single-use recovery codes, org-wide enforcement, admin reset; all audited.
- **Animated crew:** state-driven character animation (idle, waving, thinking, working, tool, talking, happy, sad, sleeping) and a live crew stage in the run console.
- **Harbor design system:** tokens, components, icon set, command palette, keyboard shortcuts, toasts, skeletons, empty states, living style guide.
- Migrations runner for SQLite; configurable login rate limit.

## 1.0.0 — 2026-11-01
- First release: crew with original characters, library (210 agents, 52 flows, 300 skills, 197 verified MCP servers, 500 context templates, 500 memory schemas), flow engine (sequential, parallel, router, loop, approval), frontier/local/WebGPU models, MCP over Streamable HTTP, value & KPI dashboard, RBAC, API keys, versioning, hash-chained audit log, Cloudflare and Docker deployment, unit/API/security/e2e tests, security assessment and SOC 2 control matrix.
