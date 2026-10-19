# Workbook: feat/mcp-send-message

Branch: `feat/mcp-send-message` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | docs/features/mcp-send-message/design.md: rules, tool, UI, plan | 2026-10-19 |
| Dev | done | server: inbox:send scope, InboxSendPort, send_message, edition-aware MCP name; UI waits for mock confirmation | 2026-10-19 |
| Unit tests | pass | mcp-send (12) + mcp-send-port (4) via the real /mcp route; full suite 2299 pass; changed lines 97.7 % covered | 2026-10-19 |
| E2E | skip | no production screen changed yet (UI after the mock confirmation) | 2026-10-19 |
| Dev Build | pass | e2e/devbuild-mcp-send-check.mjs with the official MCP SDK client: 12/12 PASS | 2026-10-19 |
| Screen review | todo | mock screenshots 1280/360 done; review with the production UI after confirmation | 2026-10-19 |

## Log

- 2026-10-19 Design: done — docs/features/mcp-send-message/design.md: rules, tool, UI, plan
- 2026-10-19 Dev: done — server: inbox:send scope, InboxSendPort, send_message, edition-aware MCP name; UI waits for mock confirmation
- 2026-10-19 Unit tests: pass — mcp-send (12) + mcp-send-port (4) via the real /mcp route; full suite 2299 pass; changed lines 97.7 % covered
- 2026-10-19 E2E: skip — no production screen changed yet (UI after the mock confirmation)
- 2026-10-19 Dev Build: pass — e2e/devbuild-mcp-send-check.mjs with the official MCP SDK client: 12/12 PASS
- 2026-10-19 Screen review: todo — mock screenshots 1280/360 done; review with the production UI after confirmation
