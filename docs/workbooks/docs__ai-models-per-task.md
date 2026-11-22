# Workbook: docs/ai-models-per-task

Branch: `docs/ai-models-per-task` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner confirmed 2026-11-22 (all suggested); mock updated to Speed and quality: Faster · Balanced · Smarter, Edit with AI in Writing help | 9433a1a | 2026-11-22 |
| Dev | done | Second review fixes: expired list stays authoritative, 503 on unchecked save, migration only listed ids, default pick saves null, picker shows kept live-only model | 324ea39 | 2026-11-22 |
| Unit tests | done | 6178 tests green, changed lines 99.0 % (205/207) | 324ea39 | 2026-11-22 |
| E2E | done | npm run e2e: 196 passed, 32 skipped (4.1m) | 324ea39 | 2026-11-22 |
| Dev Build | done | ai-models-screens 36 shots 0 problems; kept live-only model shown | 324ea39 | 2026-11-22 |
| Screen review | done | Re-captured 36 shots at 1280/360 light+dark+ms+zh-CN; fixed the empty Translate picker for a kept live-only model (now shows the id with its level); no overflow, no page errors | 3f48182 | 2026-11-22 |

## Log

- 2026-11-22 Design: doing — Inventory of 20 AI calls, five task groups, shared contract, mock (30 shots: 1280/360, light/dark, en/ms/zh-CN); waiting for the owner to confirm the mock (6ff85ef)
- 2026-11-22 Design: done — Owner confirmed 2026-11-22 (all suggested); mock updated to Speed and quality: Faster · Balanced · Smarter, Edit with AI in Writing help (9433a1a)
- 2026-11-22 Dev: done — Shared ai-models contract, ai/task-models.ts resolver + start-up migration, every AI call routed (generate/draft/assist/rewrite + reasoningEffort per provider), GET/PUT /api/ai/task-models, AI models card, Reply suggestions note, en/ms/zh-CN (9433a1a)
- 2026-11-22 E2E: done — npm run e2e: 193 passed; new ai-models.spec fixed (label click, own connection) and re-run green; reports.spec desktop failed once in the full run and passed alone (not touched) (8189e9e)
- 2026-11-22 Unit tests: done — Full suite 501 files / 6171 tests green; changed-lines coverage 100 % (188/188); Enterprise on pack:core: typecheck ok, lint 0 errors, 659 tests (9c3b9d0)
- 2026-11-22 Screen review: done — e2e/ai-models-screens.mjs: 36 shots 1280/360, light/dark, en/ms/zh-CN, 0 page errors, 0 overflow (docs/screenshots/ai-models); mock shots re-run with confirmed labels (30, 0 problems) (9c3b9d0)
- 2026-11-22 Dev Build: done — Real server + fake WhatsApp, no model: AI models card read/save/fallback/Claude in the browser (docs/dev-build-checks.md). Real-model AI eval left for the owner (c4584db)
- 2026-11-22 E2E: done — npm run e2e: 193 passed; new ai-models.spec fixed (label click, own connection) and re-run green on desktop and mobile; reports.spec desktop failed once in the full run and passed alone (not touched) (c4584db)
- 2026-11-22 Screen review: done — e2e/ai-models-screens.mjs: 36 shots 1280/360, light/dark, en/ms/zh-CN, 0 page errors, 0 overflow (docs/screenshots/ai-models); mock shots re-run with confirmed labels (30, 0 problems) (c4584db)
- 2026-11-22 Unit tests: done — Full suite 501 files / 6174 tests green; changed-lines coverage 100 % (201/201) on 656b2f1; Enterprise on pack:core: typecheck ok, lint 0 errors, 659 tests (84c052c)
- 2026-11-22 E2E: done — npm run e2e: 196 passed, 0 failed (ai-models spec no longer changes the shared connection) (84c052c)
- 2026-11-22 Screen review: done — e2e/ai-models-screens.mjs: 36 shots 1280/360, light/dark, en/ms/zh-CN, 0 page errors, 0 overflow (docs/screenshots/ai-models); mock shots re-run with confirmed labels (84c052c)
- 2026-11-22 Dev Build: done — Re-run on the final code d767e61: AI models card read/save/fallback/Claude on the real server, fake WhatsApp, no model (36 shots, 0 problems) (d767e61)
- 2026-11-22 Dev: done — Second review fixes: expired list stays authoritative, 503 on unchecked save, migration only listed ids, default pick saves null, picker shows kept live-only model (324ea39)
- 2026-11-22 Unit tests: done — 6178 tests green, changed lines 99.0 % (205/207) (324ea39)
- 2026-11-22 Dev Build: done — ai-models-screens 36 shots 0 problems; kept live-only model shown (324ea39)
- 2026-11-22 E2E: done — npm run e2e: 196 passed, 32 skipped (4.1m) (324ea39)
- 2026-11-22 Screen review: done — Re-captured 36 shots at 1280/360 light+dark+ms+zh-CN; fixed the empty Translate picker for a kept live-only model (now shows the id with its level); no overflow, no page errors (3f48182)
