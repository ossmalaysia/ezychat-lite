# Workbook: MCP sign-in (OAuth) for claude.ai / ChatGPT

Branch: `feat/mcp-oauth` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Spec docs/superpowers/specs/2026-10-25-mcp-oauth-design.md; owner waived the HTML mock (asked for the simplest solution, build until it works, release) | 95b42f2 | 2026-10-24 |
| Dev | done | OAuth 2.1 + PKCE + DCR on /mcp, approval page /oauth/authorize, connector card in Settings → Integrations | 95b42f2 | 2026-10-24 |
| Unit tests | done | mcp-oauth.test.ts (real MCP SDK client end to end + edge cases), OAuthConsentPage.test.tsx, IntegrationsSection.test.tsx | 95b42f2 | 2026-10-24 |
| E2E | pass | npm run e2e 84 passed (new OAuth approval spec incl. 360 px); e2e:electron-links 16/16 (oauth-authorize added) | 1110c6d | 2026-10-25 |
| Dev Build | pass | Scripted sign-in 12/12 local + 13/13 through a Quick Tunnel; real claude.ai connector and real ChatGPT custom MCP server both connected, approved and answered with demo data; guide screenshots in docs/guides/connect-ai-apps/ | 653d9ec | 2026-10-25 |
| Screen review | done | Approval page and connector card reviewed from the real-app screenshots (dark, 1280) and e2e at 360 px; light-mode pair not captured separately | 1110c6d | 2026-10-25 |

## Log

- 2026-10-24 Design: done — Spec docs/superpowers/specs/2026-10-25-mcp-oauth-design.md; owner waived the HTML mock (asked for the simplest solution, build until it works, release) (95b42f2)
- 2026-10-24 Dev: done — OAuth 2.1 + PKCE + DCR on /mcp, approval page /oauth/authorize, connector card in Settings → Integrations (95b42f2)
- 2026-10-24 Unit tests: done — mcp-oauth.test.ts (real MCP SDK client end to end + edge cases), OAuthConsentPage.test.tsx, IntegrationsSection.test.tsx (95b42f2)
- 2026-10-25 Dev Build: pass — Scripted sign-in 12/12 local + 13/13 through a Quick Tunnel; real claude.ai connector and real ChatGPT custom MCP server both connected, approved and answered with demo data; guide screenshots in docs/guides/connect-ai-apps/ (653d9ec)
- 2026-10-25 E2E: pass — npm run e2e 84 passed (new OAuth approval spec incl. 360 px); e2e:electron-links 16/16 (oauth-authorize added) (1110c6d)
- 2026-10-25 Screen review: done — Approval page and connector card reviewed from the real-app screenshots (dark, 1280) and e2e at 360 px; light-mode pair not captured separately (1110c6d)
