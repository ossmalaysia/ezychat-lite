# Workbook: AI assistant access via MCP (read-only)

Branch: `feat/mcp-server` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | read-only MCP over tunnel; PAT admins only; approach B (SDK, clean modules) approved; UI mockup after server | 2026-10-08 |
| Dev | doing | server done: api-tokens, /mcp (SDK 1.30.1 web-standard, stateless), 4 read tools, admin token routes; UI next (mockup first) | 2026-10-08 |
| Unit tests | pass | 88 server tests (mcp, api-tokens, integrations routes, stats, redaction, migrate); bundled server.cjs smoke 9/9 on --fake-wa | 2026-10-08 |
| E2E | todo |  |  |
| Dev Build | todo |  |  |
| Screen review | todo |  |  |

## Log

- 2026-10-08 Design: done — read-only MCP over tunnel; PAT admins only; approach B (SDK, clean modules) approved; UI mockup after server
- 2026-10-08 Dev: doing — spike: SDK bundling
- 2026-10-08 Dev: doing — server done: api-tokens, /mcp (SDK 1.30.1 web-standard, stateless), 4 read tools, admin token routes; UI next (mockup first)
- 2026-10-08 Unit tests: pass — 88 server tests (mcp, api-tokens, integrations routes, stats, redaction, migrate); bundled server.cjs smoke 9/9 on --fake-wa
