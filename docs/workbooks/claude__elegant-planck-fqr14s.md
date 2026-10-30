# Workbook: AI agent: answer direct chats (group-only agents)

Branch: `claude/elegant-planck-fqr14s` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | owner confirmed the ai-direct-chats mock 2026-10-30 | 4cfbe96 | 2026-10-30 |
| Dev | done | answer_direct (migration 026), ai/direct.ts, releaseDirect, assign refusal, directory aiNoDirect, Direct chats card, i18n | 4cfbe96 | 2026-10-30 |
| Unit tests | pass | server ai-direct-chats (8), groups/migrate/upgrade/routes-access; web card (5), directory; changed lines 95.8 %. Full run: 5 failures all in the document-parser worker (unchanged code, fails in this container) | e1fd44b | 2026-10-30 |
| E2E | pass | npm run e2e: 126 passed, 1 failed (ai-member document upload: same parser-worker container failure); ai-groups spec incl. new direct test 4/4 | e1fd44b | 2026-10-30 |
| Dev Build | pass | devbuild-direct-check 15/15 PASS (mock model, fake WA); Business API path unit-tested only | e1fd44b | 2026-10-30 |
| Screen review | pass | Direct chats card on/confirm/group-only at 1280 and 360, light and dark; matches confirmed mock | e1fd44b | 2026-10-30 |

## Log

- 2026-10-30 Design: doing — ai-direct-chats mock + design.md (direct-shots: 24 shots, no problems); waiting for owner confirmation (cc0a759)
- 2026-10-30 Design: done — owner confirmed the ai-direct-chats mock 2026-10-30 (4cfbe96)
- 2026-10-30 Dev: done — answer_direct (migration 026), ai/direct.ts, releaseDirect, assign refusal, directory aiNoDirect, Direct chats card, i18n (4cfbe96)
- 2026-10-30 Dev Build: pass — devbuild-direct-check 15/15 PASS (mock model, fake WA); Business API path unit-tested only (e1fd44b)
- 2026-10-30 Screen review: pass — Direct chats card on/confirm/group-only at 1280 and 360, light and dark; matches confirmed mock (e1fd44b)
- 2026-10-30 Unit tests: pass — server ai-direct-chats (8), groups/migrate/upgrade/routes-access; web card (5), directory; changed lines 95.8 %. Full run: 5 failures all in the document-parser worker (unchanged code, fails in this container) (e1fd44b)
- 2026-10-30 E2E: pass — npm run e2e: 126 passed, 1 failed (ai-member document upload: same parser-worker container failure); ai-groups spec incl. new direct test 4/4 (e1fd44b)
