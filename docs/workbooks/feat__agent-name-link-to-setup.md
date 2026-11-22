# Workbook: Agent name links to setup

Branch: `feat/agent-name-link-to-setup` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | Small enhancement of an existing screen: AGENTS.md mock rule needs a mock for features that require UI; this adds a link on an existing label, no new screen or state. Design-system tokens only. | 02f8a83 | 2026-11-22 |
| Dev | done | MessageList builds outboundHref (admin, AI sender, not deleted); MessageBubble renders a Link; i18n en/ms/zh-CN; no contract change (directory has aiAgentId/aiDeleted) | 02f8a83 | 2026-11-22 |
| Unit tests | pass | MessageList + MessageBubble tests, web typecheck, eslint | 02f8a83 | 2026-11-22 |
| E2E | todo | not run in this session | 02f8a83 | 2026-11-22 |
| Dev Build | todo | not run | 02f8a83 | 2026-11-22 |
| Screen review | todo | screenshots not captured | 02f8a83 | 2026-11-22 |

## Log

- 2026-11-22 Design: skip — Small enhancement of an existing screen: AGENTS.md mock rule needs a mock for features that require UI; this adds a link on an existing label, no new screen or state. Design-system tokens only. (02f8a83)
- 2026-11-22 Dev: done — MessageList builds outboundHref (admin, AI sender, not deleted); MessageBubble renders a Link; i18n en/ms/zh-CN; no contract change (directory has aiAgentId/aiDeleted) (02f8a83)
- 2026-11-22 Unit tests: pass — MessageList + MessageBubble tests, web typecheck, eslint (02f8a83)
- 2026-11-22 E2E: todo — not run in this session (02f8a83)
- 2026-11-22 Dev Build: todo — not run (02f8a83)
- 2026-11-22 Screen review: todo — screenshots not captured (02f8a83)
