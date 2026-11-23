# Workbook: Agent name links to setup

Branch: `feat/agent-name-link-to-setup` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Design-only (mock-index order 50, as ai-silent-line/ai-completion-rate): a link on an existing label, no new screen; design-system pattern 'Inline link in a bubble'; screenshots docs/screenshots/chat/agent-link-*. Waiting for the owner's look at the shots. | 91b3d17 | 2026-11-23 |
| Dev | done | Review fixes: long press/swipe on the name drops the click and blocks the touch link menu; dotted underline cue; 44 px touch hit area; focus ring no longer clipped; aria-label uses the agent name without (AI) | 91b3d17 | 2026-11-23 |
| Unit tests | pass | MessageList + MessageBubble (33), web typecheck, eslint | c835f7c | 2026-11-23 |
| E2E | pass | npm run e2e on c835f7c: 196 passed, 32 skipped (platform skips), 0 failed | c835f7c | 2026-11-23 |
| Dev Build | done | fresh standalone --fake-wa server, e2e/agent-link-screens.mjs (docs/dev-build-checks.md row 2026-11-23); real touch hardware untested | c835f7c | 2026-11-23 |
| Screen review | done | agent-link-* at 1280/360, light/dark, admin vs team member, focus, opened page; checked against design-system | c835f7c | 2026-11-23 |

## Log

- 2026-11-22 Design: skip — Small enhancement of an existing screen: AGENTS.md mock rule needs a mock for features that require UI; this adds a link on an existing label, no new screen or state. Design-system tokens only. (02f8a83)
- 2026-11-22 Dev: done — MessageList builds outboundHref (admin, AI sender, not deleted); MessageBubble renders a Link; i18n en/ms/zh-CN; no contract change (directory has aiAgentId/aiDeleted) (02f8a83)
- 2026-11-22 Unit tests: pass — MessageList + MessageBubble tests, web typecheck, eslint (02f8a83)
- 2026-11-22 E2E: todo — not run in this session (02f8a83)
- 2026-11-22 Dev Build: todo — not run (02f8a83)
- 2026-11-22 Screen review: todo — screenshots not captured (02f8a83)
- 2026-11-23 Design: done — Design-only (mock-index order 50, as ai-silent-line/ai-completion-rate): a link on an existing label, no new screen; design-system pattern 'Inline link in a bubble'; screenshots docs/screenshots/chat/agent-link-*. Waiting for the owner's look at the shots. (91b3d17)
- 2026-11-23 Dev: done — Review fixes: long press/swipe on the name drops the click and blocks the touch link menu; dotted underline cue; 44 px touch hit area; focus ring no longer clipped; aria-label uses the agent name without (AI) (91b3d17)
- 2026-11-23 Unit tests: pass — MessageList + MessageBubble (33), web typecheck, eslint (91b3d17)
- 2026-11-23 Screen review: done — agent-link-* at 1280/360, light/dark, admin vs team member, keyboard focus, opened page (e2e/agent-link-screens.mjs, no overflow, no page errors); cue, ring and hit area checked against design-system (91b3d17)
- 2026-11-23 E2E: pass — npm run e2e on c835f7c: 196 passed, 32 skipped (platform skips), 0 failed (c835f7c)
- 2026-11-23 Dev Build: done — fresh standalone --fake-wa server, e2e/agent-link-screens.mjs (docs/dev-build-checks.md row 2026-11-23); real touch hardware untested (c835f7c)
- 2026-11-23 Screen review: done — agent-link-* at 1280/360, light/dark, admin vs team member, focus, opened page; checked against design-system (c835f7c)
- 2026-11-23 Unit tests: pass — MessageList + MessageBubble (33), web typecheck, eslint (c835f7c)
