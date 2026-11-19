# Workbook: techdebt/flag-emoji-font

Branch: `techdebt/flag-emoji-font` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | todo |  |  |  |
| Dev | done | index.css @font-face + font stack; README credit | 94e19a5 | 2026-11-19 |
| Unit tests | skip | No unit-testable logic (CSS only); behaviour covered by e2e/flag-emoji.spec.ts; pack-contract and i18n catalog tests pass | 94e19a5 | 2026-11-19 |
| E2E | pass | npm run e2e on Linux (cloud session): 187 passed, 0 failed; new flag-emoji.spec.ts fails without the CSS change | 94e19a5 | 2026-11-19 |
| Dev Build | pass | Fake-WA Dev Build: flag font fetched from the app and loaded at 1280/360 px, light and dark; flags drawn (docs/dev-build-checks.md 2026-11-19) | 94e19a5 | 2026-11-19 |
| Screen review | pass | Chat with five flags at 1280 and 360 px, light and dark: flags inline at text size, no sideways scroll, no page errors; only glyphs change | 94e19a5 | 2026-11-19 |

## Log

- 2026-11-19 E2E: pass — npm run e2e on Linux (cloud session): 187 passed, 0 failed; new flag-emoji.spec.ts fails without the CSS change (94e19a5)
- 2026-11-19 Dev Build: pass — Fake-WA Dev Build: flag font fetched from the app and loaded at 1280/360 px, light and dark; flags drawn (docs/dev-build-checks.md 2026-11-19) (94e19a5)
- 2026-11-19 Screen review: pass — Chat with five flags at 1280 and 360 px, light and dark: flags inline at text size, no sideways scroll, no page errors; only glyphs change (94e19a5)
- 2026-11-19 Unit tests: skip — No unit-testable logic (CSS only); behaviour covered by e2e/flag-emoji.spec.ts; pack-contract and i18n catalog tests pass (94e19a5)
- 2026-11-19 Dev: done — index.css @font-face + font stack; README credit (94e19a5)
