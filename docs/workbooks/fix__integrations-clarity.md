# Workbook: Integrations: sign-in vs token made clear

Branch: `fix/integrations-clarity` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner chose the layout in chat (one card: Recommended sign-in steps first, token under 'For developer tools'; list 'Connected apps' with Signed in / Token) | 21306ed | 2026-10-25 |
| Dev | done | ConnectAppCard, Connected apps list with kind badge, ApiToken.connectedApp (zod default false), texts en/ms/zh-CN | 21306ed | 2026-10-25 |
| Unit tests | done | IntegrationsSection.test.tsx 21/21 (new: closed developer section, kind badges); mcp-oauth connectedApp; 474 affected tests pass | 21306ed | 2026-10-25 |
| E2E | pass | npm run e2e 84 passed; e2e:electron-links 16/16; full unit suite 3078 passed; changed-lines 100 % | 9a6e9eb | 2026-10-25 |
| Dev Build | skip | UI-only change; server change is one response field covered by tests; screenshots taken from a Dev Build with a real signed-in app | 9a6e9eb | 2026-10-25 |
| Screen review | done | Integrations at 1280/360 px, light/dark, developer section closed and open: no overflow; fixed step numbering found in the screenshot; docs/screenshots/ai-assistant refreshed | 9a6e9eb | 2026-10-25 |

## Log

- 2026-10-25 Design: done — Owner chose the layout in chat (one card: Recommended sign-in steps first, token under 'For developer tools'; list 'Connected apps' with Signed in / Token) (21306ed)
- 2026-10-25 Dev: done — ConnectAppCard, Connected apps list with kind badge, ApiToken.connectedApp (zod default false), texts en/ms/zh-CN (21306ed)
- 2026-10-25 Unit tests: done — IntegrationsSection.test.tsx 21/21 (new: closed developer section, kind badges); mcp-oauth connectedApp; 474 affected tests pass (21306ed)
- 2026-10-25 E2E: pass — npm run e2e 84 passed; e2e:electron-links 16/16; full unit suite 3078 passed; changed-lines 100 % (9a6e9eb)
- 2026-10-25 Screen review: done — Integrations at 1280/360 px, light/dark, developer section closed and open: no overflow; fixed step numbering found in the screenshot; docs/screenshots/ai-assistant refreshed (9a6e9eb)
- 2026-10-25 Dev Build: skip — UI-only change; server change is one response field covered by tests; screenshots taken from a Dev Build with a real signed-in app (9a6e9eb)
