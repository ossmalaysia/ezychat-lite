# Workbook: Integrations: sign-in vs token made clear

Branch: `fix/integrations-clarity` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner chose the layout in chat (one card: Recommended sign-in steps first, token under 'For developer tools'; list 'Connected apps' with Signed in / Token) | 21306ed | 2026-10-25 |
| Dev | done | ConnectAppCard, Connected apps list with kind badge, ApiToken.connectedApp (zod default false), texts en/ms/zh-CN | 21306ed | 2026-10-25 |
| Unit tests | done | IntegrationsSection.test.tsx 21/21 (new: closed developer section, kind badges); mcp-oauth connectedApp; 474 affected tests pass | 21306ed | 2026-10-25 |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Log

- 2026-10-25 Design: done — Owner chose the layout in chat (one card: Recommended sign-in steps first, token under 'For developer tools'; list 'Connected apps' with Signed in / Token) (21306ed)
- 2026-10-25 Dev: done — ConnectAppCard, Connected apps list with kind badge, ApiToken.connectedApp (zod default false), texts en/ms/zh-CN (21306ed)
- 2026-10-25 Unit tests: done — IntegrationsSection.test.tsx 21/21 (new: closed developer section, kind badges); mcp-oauth connectedApp; 474 affected tests pass (21306ed)
