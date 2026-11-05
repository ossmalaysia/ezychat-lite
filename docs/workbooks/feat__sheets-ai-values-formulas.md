# Workbook: Sheets: AI values and formulas

Branch: `feat/sheets-ai-values-formulas` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Owner decision 2026-11-05 (no mock round, his words); per-tab switches, design group-agents Part D | 0c3ab10 | 2026-11-05 |
| Dev | done | values/formulas switches + create a new sheet (blank or template layout) | 799b314 | 2026-11-05 |
| Unit tests | done | changed lines 99.1 %; typecheck, lint green | 799b314 | 2026-11-05 |
| E2E | pass | npm run e2e: 152 passed, 1 failed (ask-ezy iphone click timeout, untouched area) that passed alone on re-run (3/3) | 28983d8 | 2026-11-05 |
| Dev Build | done | devbuild-claims-check 22/22 incl. formulas (6) and create sheet (7) | 799b314 | 2026-11-05 |
| Screen review | done | settings switches + create dialog (blank, layout) 1280 light/dark, 360 | 799b314 | 2026-11-05 |

## Log

- 2026-11-05 Design: done — Owner decision 2026-11-05 (no mock round, his words); per-tab switches, design group-agents Part D (0c3ab10)
- 2026-11-05 Dev: done — shared SheetTabSetting.aiValues/formulas, service/tools/values/sheets, web switches (0c3ab10)
- 2026-11-05 Unit tests: done — sheets server + web tests; changed lines 100 %; typecheck, lint green (0c3ab10)
- 2026-11-05 Dev Build: done — e2e/devbuild-claims-check.mjs (mock model, fake Google, temp data): 19/19 incl. formulas step (0c3ab10)
- 2026-11-05 Screen review: done — 1280 light/dark, 360, tip; fix: switches below the access choice on mobile (0c3ab10)
- 2026-11-05 E2E: pass — npm run e2e: 152 passed, 1 failed (ask-ezy iphone click timeout, untouched area) that passed alone on re-run (3/3) (28983d8)
- 2026-11-05 Screen review: done — 1280 light/dark, 360, tip; fix: switches below the access choice on mobile; re-captured after the fix (28983d8)
- 2026-11-05 Dev Build: done — e2e/devbuild-claims-check.mjs (mock model, fake Google, temp data): 19/19 incl. formulas step (28983d8)
- 2026-11-05 Dev Build: done — devbuild-claims-check 22/22 incl. formulas (6) and create sheet (7) (799b314)
- 2026-11-05 Screen review: done — settings switches + create dialog (blank, layout) 1280 light/dark, 360 (799b314)
- 2026-11-05 Dev: done — values/formulas switches + create a new sheet (blank or template layout) (799b314)
- 2026-11-05 Unit tests: done — changed lines 99.1 %; typecheck, lint green (799b314)
