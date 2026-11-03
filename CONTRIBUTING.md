# Contributing

Thanks for helping. By contributing you agree your work is licensed under Apache-2.0.

1. Fork and branch from `main`.
2. `npm install`, then make your change.
3. `npm run check && npm test && npm run test:e2e` must pass. Add tests for new behaviour; security-relevant changes need a test in `tests/api/security.test.mjs`.
4. Keep the frontend dependency-free and the engine DOM-free.
5. Never add fabricated data to the catalogue: MCP entries must be registry-verified, and context/memory entries stay templates.
6. Open a pull request describing the change and its risk. Changes to auth, crypto or the proxies need two maintainer approvals.

Commit messages: conventional commits (`feat:`, `fix:`, `docs:` …).

## Development setup

- Node.js 22 or newer (`nvm use` picks it up from `.nvmrc`).
- `npm install && npm run dev`. A `.env` with a fresh encryption key is created on first run.
- `npx playwright install chromium` once before `npm run test:e2e`.
- After UI changes, refresh the guide images with `npm run screenshots`.
