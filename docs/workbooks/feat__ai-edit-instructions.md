# Workbook: Edit with AI (instructions and hand-off rules)

Branch: `feat/ai-edit-instructions` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | popup mockup approved by owner (desktop + phone) | 2026-10-08 |
| Dev | done | server /api/ai/edit + web dialog; review fixes: bounded diff, cancellable, log rule | 2026-10-08 |
| Unit tests | pass | 1,676 passed (local); CI per OS green | 2026-10-08 |
| E2E | pass | 50 passed after review fixes | 2026-10-08 |
| Dev Build | pass | 3 real ChatGPT checks (hand-off, 27-line instructions, already covered, 360 px Malay) | 2026-10-08 |
| Screen review | done | 8 findings fixed and re-captured at 1280 and 360 px | 2026-10-08 |

## Log

- 2026-10-08 Design: done — popup mockup approved by owner (desktop + phone)
- 2026-10-08 Dev: done — server /api/ai/edit + web dialog; review fixes: bounded diff, cancellable, log rule
- 2026-10-08 Unit tests: pass — 1,676 passed (local); CI per OS green
- 2026-10-08 E2E: pass — 50 passed after review fixes
- 2026-10-08 Dev Build: pass — 3 real ChatGPT checks (hand-off, 27-line instructions, already covered, 360 px Malay)
- 2026-10-08 Screen review: done — 8 findings fixed and re-captured at 1280 and 360 px
