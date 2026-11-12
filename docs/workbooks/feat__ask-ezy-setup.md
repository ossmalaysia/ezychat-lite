# Workbook: Ask Ezy sets up agents and scheduled tasks

Branch: `feat/ask-ezy-setup` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | pass | Owner confirmed the quick mock 2026-11-12 (look good, implement) | d506483 | 2026-11-12 |
| Dev | pass | Question block, agent/task proposals and edits, Apply both, Undo; 10 review fixes; tool-failure log | d506483 | 2026-11-12 |
| Unit tests | pass | Ask Ezy setup/ask-ezy server tests, askezy web tests, contract test: 61 pass; earlier full targeted set 234; typecheck all workspaces | d506483 | 2026-11-12 |
| E2E | todo |  |  |  |
| Dev Build | pass | devbuild-ask-ezy-setup-check.mjs 12/12 on d506483 (mock model over the real tools, temp data) | d506483 | 2026-11-12 |
| Screen review | pass | Question, which chat, cards, edit at 1280/360 light/dark: 16 shots, no errors, no overflow; duplicate question fixed | d506483 | 2026-11-12 |

## Log

- 2026-11-12 Design: pass — Owner confirmed the quick mock 2026-11-12 (look good, implement) (d506483)
- 2026-11-12 Dev: pass — Question block, agent/task proposals and edits, Apply both, Undo; 10 review fixes; tool-failure log (d506483)
- 2026-11-12 Unit tests: pass — Ask Ezy setup/ask-ezy server tests, askezy web tests, contract test: 61 pass; earlier full targeted set 234; typecheck all workspaces (d506483)
- 2026-11-12 Dev Build: pass — devbuild-ask-ezy-setup-check.mjs 12/12 on d506483 (mock model over the real tools, temp data) (d506483)
- 2026-11-12 Screen review: pass — Question, which chat, cards, edit at 1280/360 light/dark: 16 shots, no errors, no overflow; duplicate question fixed (d506483)
