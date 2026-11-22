# Workbook: docs/ai-models-per-task

Branch: `docs/ai-models-per-task` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner confirmed 2026-11-22 (all suggested); mock updated to Speed and quality: Faster · Balanced · Smarter, Edit with AI in Writing help | 9433a1a | 2026-11-22 |
| Dev | done | Shared ai-models contract, ai/task-models.ts resolver + start-up migration, every AI call routed (generate/draft/assist/rewrite + reasoningEffort per provider), GET/PUT /api/ai/task-models, AI models card, Reply suggestions note, en/ms/zh-CN | 9433a1a | 2026-11-22 |
| Unit tests | done | Full suite 501 files / 6171 tests green; changed-lines coverage 100 % (188/188); Enterprise on pack:core: typecheck ok, lint 0 errors, 659 tests | 9c3b9d0 | 2026-11-22 |
| E2E | done | npm run e2e: 193 passed; new ai-models.spec fixed (label click, own connection) and re-run green; reports.spec desktop failed once in the full run and passed alone (not touched) | 8189e9e | 2026-11-22 |
| Dev Build | todo |  |  |  |
| Screen review | done | e2e/ai-models-screens.mjs: 36 shots 1280/360, light/dark, en/ms/zh-CN, 0 page errors, 0 overflow (docs/screenshots/ai-models); mock shots re-run with confirmed labels (30, 0 problems) | 9c3b9d0 | 2026-11-22 |

## Log

- 2026-11-22 Design: doing — Inventory of 20 AI calls, five task groups, shared contract, mock (30 shots: 1280/360, light/dark, en/ms/zh-CN); waiting for the owner to confirm the mock (6ff85ef)
- 2026-11-22 Design: done — Owner confirmed 2026-11-22 (all suggested); mock updated to Speed and quality: Faster · Balanced · Smarter, Edit with AI in Writing help (9433a1a)
- 2026-11-22 Dev: done — Shared ai-models contract, ai/task-models.ts resolver + start-up migration, every AI call routed (generate/draft/assist/rewrite + reasoningEffort per provider), GET/PUT /api/ai/task-models, AI models card, Reply suggestions note, en/ms/zh-CN (9433a1a)
- 2026-11-22 E2E: done — npm run e2e: 193 passed; new ai-models.spec fixed (label click, own connection) and re-run green; reports.spec desktop failed once in the full run and passed alone (not touched) (8189e9e)
- 2026-11-22 Unit tests: done — Full suite 501 files / 6171 tests green; changed-lines coverage 100 % (188/188); Enterprise on pack:core: typecheck ok, lint 0 errors, 659 tests (9c3b9d0)
- 2026-11-22 Screen review: done — e2e/ai-models-screens.mjs: 36 shots 1280/360, light/dark, en/ms/zh-CN, 0 page errors, 0 overflow (docs/screenshots/ai-models); mock shots re-run with confirmed labels (30, 0 problems) (9c3b9d0)
