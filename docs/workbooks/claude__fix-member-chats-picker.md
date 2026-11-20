# Workbook: Member chat picker fix

Branch: `claude/fix-member-chats-picker` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | bug fix, no new feature design | adc5946 | 2026-11-20 |
| Dev | done | picker searches on the server; inbox name for same-named chats | adc5946 | 2026-11-20 |
| Unit tests | pass | web MemberChats 10 tests, server chats.test; coverage:changed 100% | adc5946 | 2026-11-20 |
| E2E | pass | npm run e2e 187 passed, 29 skipped (before the inbox-name change) | adc5946 | 2026-11-20 |
| Dev Build | todo |  |  |  |
| Screen review | done | 20 shots 1280/360 light+dark, all viewed, docs/screenshots/member-chats | adc5946 | 2026-11-20 |

## Log

- 2026-11-20 Design: skip — bug fix, no new feature design (adc5946)
- 2026-11-20 Dev: done — picker searches on the server; inbox name for same-named chats (adc5946)
- 2026-11-20 Unit tests: pass — web MemberChats 10 tests, server chats.test; coverage:changed 100% (adc5946)
- 2026-11-20 E2E: pass — npm run e2e 187 passed, 29 skipped (before the inbox-name change) (adc5946)
- 2026-11-20 Screen review: done — 20 shots 1280/360 light+dark, all viewed, docs/screenshots/member-chats (adc5946)
