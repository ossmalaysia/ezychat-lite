# Workbook: claude/mcp-for-members

Branch: `claude/mcp-for-members` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Mock confirmed by the owner 2026-11-20 (OAuth-only), docs/features/mcp-for-members | c0cfd3b | 2026-11-20 |
| Dev | done | Server + web built from the confirmed mock | c0cfd3b | 2026-11-20 |
| Unit tests | done | Full suite 488 files / 5967 passed; changed-lines coverage 94.2 % (180/191) | c0cfd3b | 2026-11-20 |
| E2E | done | npm run e2e 187 passed, 29 skipped (Linux); e2e:electron-links is Windows-only, not run | c0cfd3b | 2026-11-20 |
| Dev Build | doing | Real-app run on a fresh --mode dev --fake-wa server: member OAuth approve + exchange, connected apps, Permissions, switch off (screens script). Real Claude/ChatGPT connector against the owner's test build: not yet | c0cfd3b | 2026-11-20 |
| Screen review | done | Real app 1280/360 light/dark (e2e/mcp-members-screens.mjs, 40 shots, no page errors or overflow) vs the confirmed mock: matches; docs/screenshots/mcp-for-members | c0cfd3b | 2026-11-20 |

## Log

- 2026-11-20 Design: done — Mock confirmed by the owner 2026-11-20 (OAuth-only), docs/features/mcp-for-members (c0cfd3b)
- 2026-11-20 Dev: done — Server + web built from the confirmed mock (c0cfd3b)
- 2026-11-20 E2E: done — npm run e2e 187 passed, 29 skipped (Linux); e2e:electron-links is Windows-only, not run (c0cfd3b)
- 2026-11-20 Unit tests: done — Full suite 488 files / 5967 passed; changed-lines coverage 94.2 % (180/191) (c0cfd3b)
- 2026-11-20 Screen review: done — Real app 1280/360 light/dark (e2e/mcp-members-screens.mjs, 40 shots, no page errors or overflow) vs the confirmed mock: matches; docs/screenshots/mcp-for-members (c0cfd3b)
- 2026-11-20 Dev Build: doing — Real-app run on a fresh --mode dev --fake-wa server: member OAuth approve + exchange, connected apps, Permissions, switch off (screens script). Real Claude/ChatGPT connector against the owner's test build: not yet (c0cfd3b)
