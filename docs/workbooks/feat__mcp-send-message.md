# Workbook: feat/mcp-send-message

Branch: `feat/mcp-send-message` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | doing | Mock adds the new-number option, badge and AI-started chat warning; waits for the owner | 2026-10-20 |
| Dev | done | New numbers: scope inbox:send_new, WaAdapter.checkNumber, send_to_new_number with the ban warning (untested against real WhatsApp) | 2026-10-20 |
| Unit tests | pass | new-number tests 9, number-check 3, fake checkNumber; MCP and token tests 84 of 84 | 2026-10-20 |
| E2E | skip | no production screen changed yet (UI after the mock confirmation) | 2026-10-19 |
| Dev Build | todo | Re-run the MCP send Dev Build check with send_to_new_number on the final commit | 2026-10-20 |
| Screen review | todo | mock screenshots 1280/360 done; review with the production UI after confirmation | 2026-10-19 |

## Log

- 2026-10-19 Design: done — docs/features/mcp-send-message/design.md: rules, tool, UI, plan
- 2026-10-19 Dev: done — server: inbox:send scope, InboxSendPort, send_message, edition-aware MCP name; UI waits for mock confirmation
- 2026-10-19 Unit tests: pass — mcp-send (12) + mcp-send-port (4) via the real /mcp route; full suite 2299 pass; changed lines 97.7 % covered
- 2026-10-19 E2E: skip — no production screen changed yet (UI after the mock confirmation)
- 2026-10-19 Dev Build: pass — e2e/devbuild-mcp-send-check.mjs with the official MCP SDK client: 12/12 PASS
- 2026-10-19 Screen review: todo — mock screenshots 1280/360 done; review with the production UI after confirmation
- 2026-10-20 Dev: done — New numbers: scope inbox:send_new, WaAdapter.checkNumber, send_to_new_number with the ban warning (untested against real WhatsApp)
- 2026-10-20 Unit tests: pass — new-number tests 9, number-check 3, fake checkNumber; MCP and token tests 84 of 84
- 2026-10-20 Design: doing — Mock adds the new-number option, badge and AI-started chat warning; waits for the owner
- 2026-10-20 Dev Build: todo — Re-run the MCP send Dev Build check with send_to_new_number on the final commit
