# Workbook: Hide chats on Log out, and Delete chat

Branch: `feat/chat-hide-delete` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | pass | Owner confirmed the quick mock and rules 2026-11-12; answers during the build in design.md | 49150c7 | 2026-11-12 |
| Dev | pass | Part B delete.ts + tombstone (042); Part A hide.ts (043); 7 code-review fixes | 49150c7 | 2026-11-12 |
| Unit tests | pass | 209 targeted tests (chat-hide, chat-delete, coverage, contract, upgrade, Lite merge, scheduled, ai, web pages, socket), typecheck shared/server/web | 49150c7 | 2026-11-12 |
| E2E | todo |  |  |  |
| Dev Build | pass | devbuild-hide-delete-check.mjs 16/16 on 49150c7 (fake WhatsApp, temp data); see docs/dev-build-checks.md | 49150c7 | 2026-11-12 |
| Screen review | pass | Chat menu, Delete dialog, Log out dialog at 1280/360 light/dark: 12 shots, no errors, no overflow; tense/plural fixed | 49150c7 | 2026-11-12 |

## Log

- 2026-11-12 Design: pass — Owner confirmed the quick mock and rules 2026-11-12; answers during the build in design.md (49150c7)
- 2026-11-12 Dev: pass — Part B delete.ts + tombstone (042); Part A hide.ts (043); 7 code-review fixes (49150c7)
- 2026-11-12 Unit tests: pass — 209 targeted tests (chat-hide, chat-delete, coverage, contract, upgrade, Lite merge, scheduled, ai, web pages, socket), typecheck shared/server/web (49150c7)
- 2026-11-12 Dev Build: pass — devbuild-hide-delete-check.mjs 16/16 on 49150c7 (fake WhatsApp, temp data); see docs/dev-build-checks.md (49150c7)
- 2026-11-12 Screen review: pass — Chat menu, Delete dialog, Log out dialog at 1280/360 light/dark: 12 shots, no errors, no overflow; tense/plural fixed (49150c7)
