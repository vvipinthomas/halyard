# API reference

Base path `/api`. Authenticate with the session cookie (set by login) or `Authorization: Bearer hy_…` (API key). Cookie-authenticated mutations must send `X-Halyard: 1`. Errors are `{ "error": "message" }` with an HTTP status.

| Method & path | Role | Purpose |
|---|---|---|
| `GET /health` | — | `{ ok, needsSetup, encryption }` |
| `POST /auth/bootstrap` | — | First admin + org (`email, password, name, org, setupToken?`). Works once |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` | — / any | Sessions |
| `POST /auth/password` | viewer | `{ current, next }`; revokes all sessions |
| `POST /auth/mfa/verify` | — | Second sign-in step: `{ challenge, code }` (6-digit TOTP or a recovery code). `POST /auth/login` returns `{ mfaRequired, challenge }` when MFA is on |
| `GET /auth/mfa/status` | viewer | `{ enabled, recoveryCodesLeft }` |
| `POST /auth/mfa/setup` · `POST /auth/mfa/enable` | viewer | Start enrolment → `{ secret, otpauth }`; confirm with `{ code }` → `{ recoveryCodes }` (shown once) |
| `POST /auth/mfa/recovery-codes` · `POST /auth/mfa/disable` | viewer | Regenerate (`{ code }`); turn off (`{ password, code }`, refused while the org requires MFA) |
| `POST /users/:id/mfa-reset` | admin | Clear a user's MFA and sessions (audited) |
| `GET /users` · `POST /users` · `PATCH /users/:id` | admin | List / create (`name, email, role, password?`) / change `role` or `disabled` |
| `GET /keys` · `POST /keys` · `DELETE /keys/:id` | editor | API keys (created only from a session; shown once) |
| `GET /items?kind=` · `GET /items/:id` | viewer | Workspace items |
| `POST /items` | editor | `{ kind, name, body, sourceId? }` |
| `PUT /items/:id` | editor | `{ name?, body, version? }`; 409 on version conflict |
| `DELETE /items/:id` · `GET /items/:id/versions` | editor / viewer | Soft delete; full history |
| `GET /secrets` · `PUT /secrets/:provider` · `DELETE /secrets/:provider` | viewer / admin | Provider key status / set (`apiKey, baseUrl?`) / remove |
| `POST /llm/:provider` | editor | `{ model, system, messages, maxTokens }` → `{ text, usage:{in,out}, model, latencyMs }` |
| `POST /mcp/call` | editor | `{ url, method, params?, sessionId?, authorization? }`; methods: initialize, tools/list, tools/call, resources/list, prompts/list |
| `POST /runs` · `PATCH /runs/:id` · `GET /runs` | editor / editor / viewer | Record a run; set `accepted`, `rating`; list |
| `GET /kpis?days=30` · `GET /kpis.csv` | viewer | KPI report; CSV of runs |
| `PUT /org/settings` | admin | `{ hourlyRate, currency, valueBasis, prices, requireMfa }`. `requireMfa` needs the admin's own MFA on. While it is on, un-enrolled users get `403 { code: 'MFA_SETUP_REQUIRED' }` outside `/auth/*` |
| `GET/POST /factory/products` · `PUT/DELETE /factory/products/:id` | viewer / admin | Products on the line (`config.mode` sandbox or real, repo, cloudflare, sentry, model, policy) |
| `PUT /factory/products/:id/secrets/:name` | admin | `github`, `cloudflare` or `sentry` token (encrypted) |
| `POST /factory/products/:id/pause` · `POST /factory/pause-all` | editor (stop) / admin (restart) | Andon cord |
| `POST /factory/products/:id/tick` · `/sandbox/inject` · `/sandbox/reset` | editor / editor / admin | Run the crew now; inject a sandbox scenario; reset |
| `GET /factory/items` · `GET /factory/items/:id` | viewer | Work items; item detail with timeline |
| `POST /factory/items/:id/approve` · `/reject` · `/build` | editor | Release a gated change; reject; build a proposal or retry |
| `GET /factory/metrics` · `GET /factory/events` | viewer | DORA, autonomy, customer impact; live feed |
| `POST /factory/hooks/:productId/github` · `/sentry` | signed | Webhooks (HMAC-SHA256 with the product secret) trigger an immediate tick |
| `GET /audit` · `GET /audit/verify` · `GET /export` | admin | Audit log; chain verification; org data export |

Item `body` shapes match the library entries in `public/catalog/*.json` (see `catalogToBody` in `public/js/app.js`).
