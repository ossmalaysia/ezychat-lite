# Workbook: Trim connector guard words in linear time (L-29)

Branch: `techdebt/connector-guard-trim` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | tech-debt fix, no design | a4d3711 | 2026-11-24 |
| Dev | done | trimEdges loop replaces the [._+'-]+$ trim in connectors/mcp/guards.ts tokens() | a4d3711 | 2026-11-24 |
| Unit tests | done | rules.test.ts: trim cases + 65,000-dot timing test | a4d3711 | 2026-11-24 |
| E2E | pass | npm run e2e: 196 passed, 32 skipped (3.2 min); partners project alone 7/7 | a4d3711 | 2026-11-24 |
| Dev Build | pass | e2e/devbuild-partner-check.mjs on agents-devbuild.ts + partner MCP test server: 25/25, incl. from_customer refused and met | a4d3711 | 2026-11-24 |
| Screen review | skip | no screen changed | a4d3711 | 2026-11-24 |

## Log

- 2026-11-24 Dev: done — trimEdges loop replaces the [._+'-]+$ trim in connectors/mcp/guards.ts tokens() (a4d3711)
- 2026-11-24 Unit tests: done — rules.test.ts: trim cases + 65,000-dot timing test (a4d3711)
- 2026-11-24 E2E: pass — npm run e2e: 196 passed, 32 skipped (3.2 min); partners project alone 7/7 (a4d3711)
- 2026-11-24 Dev Build: pass — e2e/devbuild-partner-check.mjs on agents-devbuild.ts + partner MCP test server: 25/25, incl. from_customer refused and met (a4d3711)
- 2026-11-24 Screen review: skip — no screen changed (a4d3711)
- 2026-11-24 Design: skip — tech-debt fix, no design (a4d3711)
