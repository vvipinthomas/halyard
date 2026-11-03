# Software Factory

The Software Factory is an agent crew that **builds new products from a brief** and then **operates** them, along with any existing product you hand it.

## Building a product from scratch

```
Brief ─► PRD + architecture ─► [you approve plan] ─► template + build ─► CI + review ─► [you approve launch] ─► live ─► operated
         Product Strategist,                          Builder              Fix Engineer,                         SRE Watch    (loop below)
         Architect                                                         Code Reviewer
```

1. **Brief:** name, who it's for, what the first release must do, and a starter template.
2. **Plan:** the Product Strategist writes a PRD (problem, users, user stories with acceptance criteria, non-goals, success metrics). The Architect designs the smallest architecture and a file plan of at most 12 files, which must include tests. Plans without tests are sent back automatically.
3. **Plan review (human):** approve, or *Request changes* with notes. The crew re-plans with your feedback.
4. **Build:** Halyard commits the **vetted template** (CI/deploy workflow, `package.json`, `wrangler.toml`, README). These are *not* agent-written. The Builder then writes the planned files in batches of three, only under `src/`, `public/` or `tests/`, and only the paths in the approved plan. Every batch goes through the patch guard.
5. **Verify:** the build PR runs CI. On failure, the Fix Engineer repairs the named files (up to `maxAttempts`), then escalates. The Code Reviewer reviews the result.
6. **Launch review (human):** approving merges to `main`. Your pipeline deploys it, and the crew records the live deployment.
7. **Operate:** the product switches to operating, and the loop below takes over.

Templates: **Web app on Cloudflare Workers** (JSON API + static UI + `node:test` tests) and **Static site on Cloudflare**. Both are dependency-free so agents can't add packages. For a live build, create an empty GitHub repository with a README and give the crew a token scoped to it. The token never needs repository-creation rights. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets for the template's deploy job.

## Operating a product

The crew **operates** your software. It watches production and the backlog, fixes what breaks, ships within a risk policy, verifies the release against real error data, and rolls back when a release hurts customers. People stay in charge of anything risky, and anyone can stop the line.

## The loop

```
signals ─► Detected ─► Diagnosing ─► Fix & review ─► Release ─► Watching ─► Done
(Sentry,     Triage      Root-Cause     Fix Engineer    Release     SRE Watch   resolves Sentry issue /
 GitHub,     Lead        Detective      + Code Reviewer Captain                 closes GitHub issue
 CI)           │                              │              │            │
               └─► proposal (Customer Advocate) └─► retry/escalate  └─► Needs you   └─► auto-rollback
```

| Status | Agent | What happens |
|---|---|---|
| `new` → `triaged` | Triage Lead | Classifies (incident, bug, build, feature, noise), sets severity and customer impact. Features become **proposals** drafted by the Customer Advocate. |
| `triaged` → `diagnosed` | Root-Cause Detective | Reads the stack trace and repository tree; names the root cause and ≤3 files. |
| `diagnosed` → `pr_open` | Fix Engineer | Writes the smallest fix. The **patch guard** blocks CI edits, path traversal, credentials, oversize or sprawling changes. Opens a PR on a `halyard/fix-…` branch. |
| `pr_open` → `reviewed` | Code Reviewer | Maker–checker review. "Changes needed" closes the PR and retries (up to `maxAttempts`), then escalates. |
| `reviewed` → `ci_passed` | Release Captain | Waits for GitHub check runs. Failure closes the PR and retries with the CI output. |
| `ci_passed` → `merged` / `awaiting_approval` | Release Captain | Scores risk. Merges only if auto-merge is on, CI passed, risk ≤ threshold, no freeze, line running and deploy budget left. Otherwise a human approves. |
| `merged` → `deployed` | SRE Watch | Waits for the new Cloudflare Workers deployment (from your normal pipeline on merge). |
| `deployed` → `done` / `rolled_back` | SRE Watch | After `monitorMinutes`, checks Sentry for new issues or the original error recurring. Healthy: resolves the source. Regressed: deploys the previous version at 100% and escalates. |

## Risk score
Severity (5–30) + files changed (5 each, max 25) + size of change (max 20) + new files (5 each) + **sensitive path (+40)** + **no CI (+30)** / **CI failed (+100)** + reviewer objection (+30). The default threshold is 40, so a small, reviewed, CI-passing fix to ordinary code ships automatically, and a change to `auth`, `migrations`, `payment`, config or infrastructure always waits for a person.

## Guardrails (per product)
- **Andon cord:** any editor can stop a product line or the whole factory; only admins restart. Stopped lines keep detecting but take no actions.
- **Budgets:** PRs/day, deploys/day, model tokens/day.
- **Freeze:** `freezeUntil` timestamp blocks merges.
- **Sensitive paths:** always need approval.
- **Agents can never edit `.github/`** (CI cannot be weakened by an agent).
- **Untrusted input:** issue text, logs and code are fenced as data in every prompt; outputs must be strict JSON.
- **Everything is audited:** PR opened, approvals, merges, deploys, rollbacks and resolutions go to the hash-chained audit log, plus a per-item timeline.

## Connecting a real product
1. **GitHub** fine-grained token for the repo: Contents (read/write), Pull requests (read/write), Issues (read/write), Checks (read), Actions (read). Turn on **branch protection** requiring CI on the default branch; the factory merges through the API and respects it.
2. **Deploys:** keep your existing pipeline that deploys the Worker when `main` changes (Workers Builds or a GitHub Action running `wrangler deploy`). The factory watches for the resulting deployment; it does not build code itself.
3. **Cloudflare** API token with *Workers Scripts: Edit* on the account (used to list deployments and to roll back).
4. **Sentry** auth token with project read and issue write. Optional but strongly recommended: without it, post-release verification relies on CI only.
5. **Model:** a frontier or OpenAI-compatible provider configured in Settings → Models. (The crew runs on the server, so in-browser WebGPU models can't be used here.)
6. Optional **webhooks** for instant reaction: GitHub (Issues, Check runs) and Sentry, signed with the secret shown when the product is created. The cron tick runs every 5 minutes regardless.

## Sandbox
A sandbox product simulates repo, CI, Cloudflare deployments and Sentry, with a deterministic, clearly labelled stand-in model. A sandbox **build** produces a small, genuinely working items app; the test suite extracts it and runs its own tests. For built products, `null-title` injects a real bug into its code for the crew to fix. For operated demo products, inject scenarios to see each path:
- `null-price`: fixed autonomously.
- `auth-timeout`: sensitive path, so it waits for approval.
- `bad-fix`: regression, so it is rolled back.
- `feature-request`: becomes a proposal; "Build it" ships it.

## KPIs
DORA (deploys/day, lead time detected→live, change failure rate, time to restore), autonomy rate (resolved with no human touch), items awaiting approval or a human, customer impact fixed vs open, and proposals waiting.

## What is and isn't verified
- **Verified in this repository:** build-from-scratch (brief → plan gate → template + build → CI → launch gate → operating), the generated app passing its own tests, the full operate loop, every gate, rollback and the andon cord, end to end in sandbox mode (API and browser tests). Request shapes for the GitHub git-data, check-runs, Sentry issues and Cloudflare Workers deployments APIs are verified with recorded-request tests.
- **Not verified here:** live calls against your GitHub, Cloudflare and Sentry accounts. No credentials were available when this was built. Start a real product with `autoMerge: false` for a week, review every PR it opens, then raise autonomy.
