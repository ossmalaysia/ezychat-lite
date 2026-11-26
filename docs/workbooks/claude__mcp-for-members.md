# Workbook: claude/mcp-for-members

Branch: `claude/mcp-for-members` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Mock confirmed by the owner 2026-11-20 (OAuth-only), docs/features/mcp-for-members | c0cfd3b | 2026-11-20 |
| Dev | done | Server + web built from the confirmed mock | c0cfd3b | 2026-11-20 |
| Unit tests | done | After merging main (2026-11-26): full suite 506 files, 6273 passed; 3 EPERM temp-folder failures on a busy Windows PC pass alone (65/65); changed-lines coverage 94.6 % (193/204); Enterprise typecheck, lint and 687 tests pass on this core (use-local-core) | 43d90cf | 2026-11-26 |
| E2E | done | After merging main (2026-11-26, Windows 11): npm run e2e 196 passed, 32 skipped; npm run e2e:electron-links 19/19 screens | 43d90cf | 2026-11-26 |
| Dev Build | pass | Fresh Dev Build on c945611f: member OAuth token on /mcp 13/13; real: Claude Code 2.1.326 as the member's MCP client on b39308cf (chosen-chat member sees only its chat, no stats, send only with Let it send and only into its chats, 401 after the switch is off); docs/dev-build-checks.md 2026-11-26 rows | b39308cf | 2026-11-26 |
| Screen review | done | Re-captured after merging main (c945611f): 40 shots 1280/360 light/dark, no page errors or overflow; Account page with My language and My AI assistants checked on phone and desktop dark | c945611f | 2026-11-26 |

## Log

- 2026-11-20 Design: done — Mock confirmed by the owner 2026-11-20 (OAuth-only), docs/features/mcp-for-members (c0cfd3b)
- 2026-11-20 Dev: done — Server + web built from the confirmed mock (c0cfd3b)
- 2026-11-20 E2E: done — npm run e2e 187 passed, 29 skipped (Linux); e2e:electron-links is Windows-only, not run (c0cfd3b)
- 2026-11-20 Unit tests: done — Full suite 488 files / 5967 passed; changed-lines coverage 94.2 % (180/191) (c0cfd3b)
- 2026-11-20 Screen review: done — Real app 1280/360 light/dark (e2e/mcp-members-screens.mjs, 40 shots, no page errors or overflow) vs the confirmed mock: matches; docs/screenshots/mcp-for-members (c0cfd3b)
- 2026-11-20 Dev Build: doing — Real-app run on a fresh --mode dev --fake-wa server: member OAuth approve + exchange, connected apps, Permissions, switch off (screens script). Real Claude/ChatGPT connector against the owner's test build: not yet (c0cfd3b)
- 2026-11-26 E2E: done — After merging main (2026-11-26, Windows 11): npm run e2e 196 passed, 32 skipped; npm run e2e:electron-links 19/19 screens (43d90cf)
- 2026-11-26 Unit tests: done — After merging main (2026-11-26): full suite 506 files, 6273 passed; 3 EPERM temp-folder failures on a busy Windows PC pass alone (65/65); changed-lines coverage 94.6 % (193/204); Enterprise typecheck, lint and 687 tests pass on this core (use-local-core) (43d90cf)
- 2026-11-26 Dev Build: pass — Fresh Dev Build on c945611f (after merging main): member OAuth token on /mcp, 13/13 checks (tools limited to 4 reads, get_stats refused, 401 after the switch is off); docs/dev-build-checks.md 2026-11-26 row. A real Claude/ChatGPT member connection is still the owner's check (c945611f)
- 2026-11-26 Screen review: done — Re-captured after merging main (c945611f): 40 shots 1280/360 light/dark, no page errors or overflow; Account page with My language and My AI assistants checked on phone and desktop dark (c945611f)
- 2026-11-26 Dev Build: pass — Fresh Dev Build on c945611f: member OAuth token on /mcp 13/13; real: Claude Code 2.1.326 as the member's MCP client on b39308cf (chosen-chat member sees only its chat, no stats, send only with Let it send and only into its chats, 401 after the switch is off); docs/dev-build-checks.md 2026-11-26 rows (b39308cf)
