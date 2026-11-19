# Workbook: MCP: resolve and reopen chats

Branch: `claude/mcp-resolve-chat` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Clone of app-navigation mock + Can resolve chats checkbox/badge; design.md; awaiting owner confirmation of the checkbox | a09e3a9 | 2026-11-19 |
| Dev | done | inbox:manage scope, InboxManagePort (chats.patch), resolve_chat/reopen_chat, token UI | a09e3a9 | 2026-11-19 |
| Unit tests | done | mcp-manage 11, mcp-manage-port 4, api-token-permissions +3, IntegrationsSection +2; related suites 242 pass | a09e3a9 | 2026-11-19 |
| E2E | done | npm run e2e: 187 passed, 29 skipped (Linux; e2e:electron-links is Windows-only, not run) | ead591e | 2026-11-19 |
| Dev Build | todo |  |  |  |
| Screen review | done | Mock shots 1280/360 light/dark (token list, Permissions, Create): no overflow, no page errors; one checkbox in the existing pattern, no findings | a09e3a9 | 2026-11-19 |

## Log

- 2026-11-19 Design: done — Clone of app-navigation mock + Can resolve chats checkbox/badge; design.md; awaiting owner confirmation of the checkbox (a09e3a9)
- 2026-11-19 Dev: done — inbox:manage scope, InboxManagePort (chats.patch), resolve_chat/reopen_chat, token UI (a09e3a9)
- 2026-11-19 Unit tests: done — mcp-manage 11, mcp-manage-port 4, api-token-permissions +3, IntegrationsSection +2; related suites 242 pass (a09e3a9)
- 2026-11-19 Screen review: done — Mock shots 1280/360 light/dark (token list, Permissions, Create): no overflow, no page errors; one checkbox in the existing pattern, no findings (a09e3a9)
- 2026-11-19 E2E: done — npm run e2e: 187 passed, 29 skipped (Linux; e2e:electron-links is Windows-only, not run) (ead591e)
