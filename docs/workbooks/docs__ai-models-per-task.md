# Workbook: docs/ai-models-per-task

Branch: `docs/ai-models-per-task` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner confirmed 2026-11-22 (all suggested); mock updated to Speed and quality: Faster · Balanced · Smarter, Edit with AI in Writing help | 9433a1a | 2026-11-22 |
| Dev | done | Shared ai-models contract, ai/task-models.ts resolver + start-up migration, every AI call routed (generate/draft/assist/rewrite + reasoningEffort per provider), GET/PUT /api/ai/task-models, AI models card, Reply suggestions note, en/ms/zh-CN | 9433a1a | 2026-11-22 |
| Unit tests | todo |  |  |  |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Log

- 2026-11-22 Design: doing — Inventory of 20 AI calls, five task groups, shared contract, mock (30 shots: 1280/360, light/dark, en/ms/zh-CN); waiting for the owner to confirm the mock (6ff85ef)
- 2026-11-22 Design: done — Owner confirmed 2026-11-22 (all suggested); mock updated to Speed and quality: Faster · Balanced · Smarter, Edit with AI in Writing help (9433a1a)
- 2026-11-22 Dev: done — Shared ai-models contract, ai/task-models.ts resolver + start-up migration, every AI call routed (generate/draft/assist/rewrite + reasoningEffort per provider), GET/PUT /api/ai/task-models, AI models card, Reply suggestions note, en/ms/zh-CN (9433a1a)
