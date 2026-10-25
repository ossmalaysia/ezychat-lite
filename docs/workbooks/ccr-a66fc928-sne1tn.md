# Workbook: WhatsApp Business API inboxes (Enterprise)

Branch: `ccr-a66fc928-sne1tn` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner confirmed the mock 2026-10-25 ("ok impelemnt"); latestConfirmed business-api 078de13 | 078de13 | 2026-10-25 |
| Dev | done | Lite core: inbox types + capabilities, changeType/beforeConnect, reply window (409 window_closed), template routes, AI window_closed, MCP refusals, public extension routes, dev fake-api type; web: type choice/slots, setup choice, reply window, Send a template, chat-list icon, template marker | 80cd677 | 2026-10-25 |
| Unit tests | pass | 3195 passed; 4 document-reader tests fail on Node 22 here and on main too (env); changed-lines coverage 95.6 % (498/521) | bd87277 | 2026-10-25 |
| E2E | pass | 26d5f10: 85 passed incl. multi-inbox 6/6 (2 Business API window/template tests); ai-member upload fails on Node 22 only (env, same on main; CI on Node 24 green); e2e:electron-links not run (Windows only) | 26d5f10 | 2026-10-25 |
| Dev Build | pass | 26d5f10: core Business API pieces on the fake-api inbox type (review-shots.mjs), row in docs/dev-build-checks.md; Enterprise wa-cloud Dev Build 11/11 in anchorsprint/ezychat-enterprise#36 | 26d5f10 | 2026-10-25 |
| Screen review | done | 26d5f10: 19 shots 1280/360 light/dark vs the confirmed mock, match; Enterprise wa-cloud screens reviewed in #36 (docs/features/wa-cloud/devbuild) | 26d5f10 | 2026-10-25 |

## Log

- 2026-10-25 Design: doing — Business API inbox type (Enterprise): owner answered 8 scope questions 2026-10-25; design.md + mock docs/features/business-api (cloned from upgrade-enterprise 2fce4a7), 52 screenshots; waits for the owner's confirmation; 3 open questions (48008cf)
- 2026-10-25 Design: doing — Round 2 owner answers 2026-10-25: Marketing templates allowed, switch inbox type both ways (mock added), media templates listed disabled; waits for the owner's confirmation of the mock (50351f7)
- 2026-10-25 Design: done — Owner confirmed the mock 2026-10-25 ("ok impelemnt"); latestConfirmed business-api 078de13 (078de13)
- 2026-10-25 Dev: done — Lite core: inbox types + capabilities, changeType/beforeConnect, reply window (409 window_closed), template routes, AI window_closed, MCP refusals, public extension routes, dev fake-api type; web: type choice/slots, setup choice, reply window, Send a template, chat-list icon, template marker (80cd677)
- 2026-10-25 E2E: pass — 84 passed + multi-inbox 6/6 incl. 2 new Business API window/template tests; ai-member upload fails on Node 22 (env, same on main); e2e:electron-links not run (Windows only) (80cd677)
- 2026-10-25 Unit tests: pass — 3195 passed; 4 document-reader tests fail on Node 22 here and on main too (env); changed-lines coverage 95.6 % (498/521) (bd87277)
- 2026-10-25 Screen review: doing — Lite screens captured (docs/features/business-api/review, 19: 1280/360, light/dark) vs the confirmed mock: match; fix: Inboxes description names other connection types when an edition adds them. Enterprise screens follow. (18fc72e)
- 2026-10-25 E2E: pass — 26d5f10: 85 passed incl. multi-inbox 6/6 (2 Business API window/template tests); ai-member upload fails on Node 22 only (env, same on main; CI on Node 24 green); e2e:electron-links not run (Windows only) (26d5f10)
- 2026-10-25 Dev Build: pass — 26d5f10: core Business API pieces on the fake-api inbox type (review-shots.mjs), row in docs/dev-build-checks.md; Enterprise wa-cloud Dev Build 11/11 in anchorsprint/ezychat-enterprise#36 (26d5f10)
- 2026-10-25 Screen review: done — 26d5f10: 19 shots 1280/360 light/dark vs the confirmed mock, match; Enterprise wa-cloud screens reviewed in #36 (docs/features/wa-cloud/devbuild) (26d5f10)
