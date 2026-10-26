# Workbook: Google Calendar connector (Lite)

Branch: `claude/sleepy-fermat-ahpoii` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | doing | Round 2: connector gallery + one page per connector (80 shots, drift check ok); waiting for owner confirmation | 31f4838 | 2026-10-26 |
| Dev | done | Server (Google sign-in, booking rules, AI tools, fake Google) and web (Connectors gallery, Google Calendar page, agent card, Try it and chat lines) | a0840ab | 2026-10-26 |
| Unit tests | pass | changed-lines coverage 97.9 %; connectors, Google Calendar routes and AI tools, web connector pages | a0840ab | 2026-10-26 |
| E2E | pass | e2e/connectors.spec.ts 8 passed; full run: only ai-member (document worker, container-only) and multi-inbox Business API (untouched) fail here | a0840ab | 2026-10-26 |
| Dev Build | pass | e2e/devbuild-calendar-check.mjs 28/28 on the mock model with fake Google; real Google and a real model not yet | a0840ab | 2026-10-26 |
| Screen review | pass | 56 shots 1280/360 light/dark, no errors or overflow; docs/screenshots/connectors refreshed | a0840ab | 2026-10-26 |

## Log

- 2026-10-26 Design: doing — HTML mock docs/features/google-calendar (44 shots, drift check ok); waiting for owner confirmation (027a03e)
- 2026-10-26 Design: doing — Round 2: connector gallery + one page per connector (80 shots, drift check ok); waiting for owner confirmation (31f4838)
- 2026-10-26 Dev: done — Server (Google sign-in, booking rules, AI tools, fake Google) and web (Connectors gallery, Google Calendar page, agent card, Try it and chat lines) (a0840ab)
- 2026-10-26 E2E: pass — e2e/connectors.spec.ts 8 passed; full run: only ai-member (document worker, container-only) and multi-inbox Business API (untouched) fail here (a0840ab)
- 2026-10-26 Unit tests: pass — changed-lines coverage 97.9 %; connectors, Google Calendar routes and AI tools, web connector pages (a0840ab)
- 2026-10-26 Dev Build: pass — e2e/devbuild-calendar-check.mjs 28/28 on the mock model with fake Google; real Google and a real model not yet (a0840ab)
- 2026-10-26 Screen review: pass — 56 shots 1280/360 light/dark, no errors or overflow; docs/screenshots/connectors refreshed (a0840ab)
