# Workbook: Change what an access token may do

Branch: `feat/token-permissions` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | doing | Mock at docs/features/token-permissions (Permissions button + dialog, phone layout); waits for the owner | 2026-10-20 |
| Dev | doing | Server done: PATCH /api/integrations/tokens/:id, owner only, audit api_token.update; UI after the mock confirmation | 2026-10-20 |
| Unit tests | pass | api-token-permissions.test.ts (4) + admin-only route list; integrations and contract tests pass | 2026-10-20 |
| E2E | todo |  |  |
| Dev Build | todo |  |  |
| Screen review | todo |  |  |

## Log

- 2026-10-20 Design: doing — Mock at docs/features/token-permissions (Permissions button + dialog, phone layout); waits for the owner
- 2026-10-20 Dev: doing — Server done: PATCH /api/integrations/tokens/:id, owner only, audit api_token.update; UI after the mock confirmation
- 2026-10-20 Unit tests: pass — api-token-permissions.test.ts (4) + admin-only route list; integrations and contract tests pass
