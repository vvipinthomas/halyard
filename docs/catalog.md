# Catalogue

Built by `npm run build:catalog` from `catalog-src/` into `public/catalog/*.json`. The output is deterministic, and `npm run check` fails if the committed output is stale.

| File | Count | Source |
|---|---|---|
| `agents.json` | 210 | 21 domains × 10 roles in `catalog-src/domains.mjs`; each has a mascot, system prompt, 3 skills, MCP categories and a minutes-saved default |
| `flows.json` | 52 | A pipeline and a maker–checker loop per agent domain, plus 10 cross-team harnesses |
| `skills.json` | 300 | 30 domains × 10; SKILL.md bodies composed from the domain procedure and the skill's purpose |
| `mcp.json` | 197 | `catalog-src/mcp-verified.json`: npm packages ranked by monthly downloads plus verified npm/PyPI lookups, 2026-11-01 |
| `contexts.json` | 500 | 25 domains × 20 context kinds (fill-in tables) |
| `memory.json` | 500 | 25 domains × 20 memory schemas with scope, retention and write policy |

## Adding entries
- **Agents/skills:** edit `catalog-src/domains.mjs`, then rebuild.
- **MCP:** add an entry to `catalog-src/mcp-verified.json` only after confirming it on its registry, and include `source` and `repo`.
- Run `npm test`. The catalogue tests check unique ids, valid flows, resolvable skill references, SKILL.md frontmatter and MCP provenance.
