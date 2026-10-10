# Workbook: Peak times and who replies (MCP get_activity)

Branch: `feat/mcp-activity` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | skip | MCP only, no UI (owner: no analytics page) | 2026-10-10 |
| Dev | done | get_activity tool + Codex fixes (long-open waits, same-second order) | 2026-10-10 |
| Unit tests | pass | 28 passed locally (activity + MCP tests); CI green on 3 OS | 2026-10-10 |
| E2E | skip | no UI change; MCP covered by server tests | 2026-10-10 |
| Dev Build | doing | Claude Code over MCP: counts match DB; realistic multi-day data not yet checked | 2026-10-10 |
| Screen review | skip | no UI change | 2026-10-10 |

## Log

- 2026-10-10 Design: skip — MCP only, no UI (owner: no analytics page)
- 2026-10-10 Dev: done — get_activity tool + Codex fixes (long-open waits, same-second order)
- 2026-10-10 Unit tests: pass — 28 passed locally (activity + MCP tests); CI green on 3 OS
- 2026-10-10 E2E: skip — no UI change; MCP covered by server tests
- 2026-10-10 Dev Build: doing — Claude Code over MCP: counts match DB; realistic multi-day data not yet checked
- 2026-10-10 Screen review: skip — no UI change
