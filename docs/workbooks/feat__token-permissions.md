# Workbook: Change what an access token may do

Branch: `feat/token-permissions` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Mock confirmed by the owner 2026-10-20 at 58346c1 | 2026-10-20 |
| Dev | done | Server + UI: PATCH route, Permissions button and dialog, phone layout, en/ms/zh-CN | 2026-10-20 |
| Unit tests | pass | server permission tests, web tests (Permissions dialog, own tokens only, error), full suite 2342 pass | 2026-10-20 |
| E2E | pass | npm run e2e 67 passed / 0 failed (new permissions test included); e2e:electron-links 15/15 | 2026-10-20 |
| Dev Build | pass | devbuild-mcp-send-check.mjs 25/25 (permission change reaches the same token) | 2026-10-20 |
| Screen review | pass | ai-assistant module incl. token-permissions at 1280/360; matches the confirmed mock; screens.smoke 33/33 in English and Malay | 2026-10-20 |

## Log

- 2026-10-20 Design: doing — Mock at docs/features/token-permissions (Permissions button + dialog, phone layout); waits for the owner
- 2026-10-20 Dev: doing — Server done: PATCH /api/integrations/tokens/:id, owner only, audit api_token.update; UI after the mock confirmation
- 2026-10-20 Unit tests: pass — api-token-permissions.test.ts (4) + admin-only route list; integrations and contract tests pass
- 2026-10-20 Design: done — Mock confirmed by the owner 2026-10-20 at 58346c1
- 2026-10-20 Dev: done — Server + UI: PATCH route, Permissions button and dialog, phone layout, en/ms/zh-CN
- 2026-10-20 Unit tests: pass — server permission tests, web tests (Permissions dialog, own tokens only, error), full suite 2342 pass
- 2026-10-20 E2E: pass — npm run e2e 67 passed / 0 failed (new permissions test included); e2e:electron-links 15/15
- 2026-10-20 Dev Build: pass — devbuild-mcp-send-check.mjs 25/25 (permission change reaches the same token)
- 2026-10-20 Screen review: pass — ai-assistant module incl. token-permissions at 1280/360; matches the confirmed mock; screens.smoke 33/33 in English and Malay
