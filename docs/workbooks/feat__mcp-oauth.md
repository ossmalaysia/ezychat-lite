# Workbook: MCP sign-in (OAuth) for claude.ai / ChatGPT

Branch: `feat/mcp-oauth` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Spec docs/superpowers/specs/2026-10-25-mcp-oauth-design.md; owner waived the HTML mock (asked for the simplest solution, build until it works, release) | 95b42f2 | 2026-10-24 |
| Dev | done | OAuth 2.1 + PKCE + DCR on /mcp, approval page /oauth/authorize, connector card in Settings → Integrations | 95b42f2 | 2026-10-24 |
| Unit tests | done | mcp-oauth.test.ts (real MCP SDK client end to end + edge cases), OAuthConsentPage.test.tsx, IntegrationsSection.test.tsx | 95b42f2 | 2026-10-24 |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Log

- 2026-10-24 Design: done — Spec docs/superpowers/specs/2026-10-25-mcp-oauth-design.md; owner waived the HTML mock (asked for the simplest solution, build until it works, release) (95b42f2)
- 2026-10-24 Dev: done — OAuth 2.1 + PKCE + DCR on /mcp, approval page /oauth/authorize, connector card in Settings → Integrations (95b42f2)
- 2026-10-24 Unit tests: done — mcp-oauth.test.ts (real MCP SDK client end to end + edge cases), OAuthConsentPage.test.tsx, IntegrationsSection.test.tsx (95b42f2)
