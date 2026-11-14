# Workbook: App navigation (rail and bottom tabs)

Branch: `feat/app-navigation` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | pass | Owner confirmed the mock 2026-11-13 (dc0d5ce6); design-system 'App navigation' entry added | 10005a0 | 2026-11-13 |
| Dev | pass | nav/AppNav, AccountPage, PhoneBar; AdminLayout Settings menu and phone list; GET /api/chats/unread-count; review findings fixed | 10005a0 | 2026-11-13 |
| Unit tests | pass | web 1768/1768 (before review fixes) + nav/admin/login/extension/server scope tests after; typecheck + lint clean | 10005a0 | 2026-11-13 |
| E2E | pass | full npm run e2e: 174 passed, 0 failed (27 skipped); new e2e/app-navigation.spec.ts; e2e:electron-links 19/19 screens (after npm run build -w @ezychat/desktop) | c0cb99b | 2026-11-13 |
| Dev Build | pass | screens 39/41 (OAuth page unchanged) + 17/17 menu checks on the final commit; see dev-build-checks.md | 10005a0 | 2026-11-13 |
| Screen review | pass | Desktop 1280/1440 and phone 360/390 shots checked against the confirmed mock; title fix App settings; one h1 per phone page; docs/screenshots refreshed (39) | 10005a0 | 2026-11-13 |

## Log

- 2026-11-13 Design: pass — Owner confirmed the mock 2026-11-13 (dc0d5ce6); design-system 'App navigation' entry added (10005a0)
- 2026-11-13 Dev: pass — nav/AppNav, AccountPage, PhoneBar; AdminLayout Settings menu and phone list; GET /api/chats/unread-count; review findings fixed (10005a0)
- 2026-11-13 Unit tests: pass — web 1768/1768 (before review fixes) + nav/admin/login/extension/server scope tests after; typecheck + lint clean (10005a0)
- 2026-11-13 E2E: pass — full npm run e2e: 174 passed, 0 failed (27 skipped); new e2e/app-navigation.spec.ts; e2e:electron-links left to CI (no window from this shell) (10005a0)
- 2026-11-13 Dev Build: pass — screens 39/41 (OAuth page unchanged) + 17/17 menu checks on the final commit; see dev-build-checks.md (10005a0)
- 2026-11-13 Screen review: pass — Desktop 1280/1440 and phone 360/390 shots checked against the confirmed mock; title fix App settings; one h1 per phone page; docs/screenshots refreshed (39) (10005a0)
- 2026-11-13 E2E: pass — full npm run e2e: 174 passed, 0 failed (27 skipped); new e2e/app-navigation.spec.ts; e2e:electron-links 19/19 screens (after npm run build -w @ezychat/desktop) (c0cb99b)
