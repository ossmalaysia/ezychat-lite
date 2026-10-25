# Workbook: WhatsApp Business API inboxes (Enterprise)

Branch: `ccr-a66fc928-sne1tn` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner confirmed the mock 2026-10-25 ("ok impelemnt"); latestConfirmed business-api 078de13 | 078de13 | 2026-10-25 |
| Dev | done | Lite core: inbox types + capabilities, changeType/beforeConnect, reply window (409 window_closed), template routes, AI window_closed, MCP refusals, public extension routes, dev fake-api type; web: type choice/slots, setup choice, reply window, Send a template, chat-list icon, template marker | 80cd677 | 2026-10-25 |
| Unit tests | todo |  |  |  |
| E2E | pass | 84 passed + multi-inbox 6/6 incl. 2 new Business API window/template tests; ai-member upload fails on Node 22 (env, same on main); e2e:electron-links not run (Windows only) | 80cd677 | 2026-10-25 |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Log

- 2026-10-25 Design: doing — Business API inbox type (Enterprise): owner answered 8 scope questions 2026-10-25; design.md + mock docs/features/business-api (cloned from upgrade-enterprise 2fce4a7), 52 screenshots; waits for the owner's confirmation; 3 open questions (48008cf)
- 2026-10-25 Design: doing — Round 2 owner answers 2026-10-25: Marketing templates allowed, switch inbox type both ways (mock added), media templates listed disabled; waits for the owner's confirmation of the mock (50351f7)
- 2026-10-25 Design: done — Owner confirmed the mock 2026-10-25 ("ok impelemnt"); latestConfirmed business-api 078de13 (078de13)
- 2026-10-25 Dev: done — Lite core: inbox types + capabilities, changeType/beforeConnect, reply window (409 window_closed), template routes, AI window_closed, MCP refusals, public extension routes, dev fake-api type; web: type choice/slots, setup choice, reply window, Send a template, chat-list icon, template marker (80cd677)
- 2026-10-25 E2E: pass — 84 passed + multi-inbox 6/6 incl. 2 new Business API window/template tests; ai-member upload fails on Node 22 (env, same on main); e2e:electron-links not run (Windows only) (80cd677)
