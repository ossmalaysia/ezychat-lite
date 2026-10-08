# Workbook: AI assistant access via MCP (read-only)

Branch: `feat/mcp-server` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | read-only MCP over tunnel; PAT admins only; approach B (SDK, clean modules) approved; UI mockup after server | 2026-10-08 |
| Dev | done | server + Settings → Integrations tab (workflow: build agent + e2e writer + reviewer); 6 review findings fixed (listening port, audit token rows, Gemini merge hint, wording, ms/zh text, tests) | 2026-10-08 |
| Unit tests | pass | 1,749 passed, 1 skipped (full suite); typecheck, lint, web build green | 2026-10-08 |
| E2E | pass | 51 passed (incl. new integrations spec: token on /mcp 200, revoked 401, 360 px) | 2026-10-08 |
| Dev Build | todo | real MCP clients (Claude Code, Gemini CLI) through a real tunnel on a Dev Build | 2026-10-08 |
| Screen review | done | states A-D vs approved mockup at 1280/360, light+dark, en+ms: no errors or overflow | 2026-10-08 |

## Log

- 2026-10-08 Design: done — read-only MCP over tunnel; PAT admins only; approach B (SDK, clean modules) approved; UI mockup after server
- 2026-10-08 Dev: doing — spike: SDK bundling
- 2026-10-08 Dev: doing — server done: api-tokens, /mcp (SDK 1.30.1 web-standard, stateless), 4 read tools, admin token routes; UI next (mockup first)
- 2026-10-08 Unit tests: pass — 88 server tests (mcp, api-tokens, integrations routes, stats, redaction, migrate); bundled server.cjs smoke 9/9 on --fake-wa
- 2026-10-08 Dev: done — server + Settings → Integrations tab (workflow: build agent + e2e writer + reviewer); 6 review findings fixed (listening port, audit token rows, Gemini merge hint, wording, ms/zh text, tests)
- 2026-10-08 Unit tests: pass — 1,749 passed, 1 skipped (full suite); typecheck, lint, web build green
- 2026-10-08 E2E: pass — 51 passed (incl. new integrations spec: token on /mcp 200, revoked 401, 360 px)
- 2026-10-08 Screen review: done — states A-D vs approved mockup at 1280/360, light+dark, en+ms: no errors or overflow
- 2026-10-08 Dev Build: todo — real MCP clients (Claude Code, Gemini CLI) through a real tunnel on a Dev Build
