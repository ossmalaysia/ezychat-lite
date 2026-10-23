# Workbook: Emoji reactions (receive and show)

Branch: `feat/emoji-reactions` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Mock confirmed by the owner 2026-10-23 (latestConfirmed in mock-index.json) | 2026-10-23 |
| Dev | done | Contract (Message.reactions, message:reactions), WaAdapter reaction event (Baileys mapping untested against real WhatsApp), migration 016 + messages/reactions.ts, dev route fake-reaction, web ReactionBadges | 2026-10-22 |
| Unit tests | done | npm run test:coverage: 258 files, 2963 tests passed; changed lines 100 % (178/178); Enterprise typecheck, lint, 334 tests on the local core | 2026-10-23 |
| E2E | done | npm run e2e: 77 passed (reactions on desktop, mobile, iphone); e2e:electron-links 15/15, after the screen review fixes | 2026-10-23 |
| Dev Build | done | devbuild-reactions-check.mjs: 8/8 incl. restart; real WhatsApp receive test still open (owner) | 2026-10-23 |
| Screen review | done | Real-app demo shots 1280/360 light/dark; fixed badge covering time/ticks and a demo name; docs/screenshots/chat refreshed | 2026-10-23 |

## Log

- 2026-10-22 Design: done — Mock docs/features/emoji-reactions (clone of claude-provider @21d9718); proposal self-reviewed (delegated); owner not yet shown
- 2026-10-22 Dev: done — Contract (Message.reactions, message:reactions), WaAdapter reaction event (Baileys mapping untested against real WhatsApp), migration 016 + messages/reactions.ts, dev route fake-reaction, web ReactionBadges
- 2026-10-22 Unit tests: pass — wa, server (reactions, realtime rooms, bridge, migrate, messages, mcp), shared schemas, web (ReactionBadges, MessageBubble, socket, i18n) pass; typecheck + lint clean; changed-lines coverage about 99% in a targeted run
- 2026-10-22 E2E: todo — e2e/reactions.spec.ts written, not run (orchestrator runs npm run e2e once)
- 2026-10-22 Screen review: todo — Orchestrator: reaction-shots.mjs (7 states, 1280/360, light/dark) and designer review
- 2026-10-23 Design: done — Mock confirmed by the owner 2026-10-23 (latestConfirmed in mock-index.json)
- 2026-10-23 Unit tests: done — npm run test:coverage: 258 files, 2963 tests passed; changed lines 100 % (178/178); Enterprise typecheck, lint, 334 tests on the local core
- 2026-10-23 E2E: done — npm run e2e: 77 passed (reactions on desktop, mobile, iphone); e2e:electron-links 15/15, after the screen review fixes
- 2026-10-23 Screen review: done — Real-app demo shots 1280/360 light/dark; fixed badge covering time/ticks and a demo name; docs/screenshots/chat refreshed
- 2026-10-23 Dev Build: done — devbuild-reactions-check.mjs: 8/8 incl. restart; real WhatsApp receive test still open (owner)
