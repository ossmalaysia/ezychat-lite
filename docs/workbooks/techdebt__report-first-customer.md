# Workbook: Count the first customer of a new install as new (L-24)

Branch: `techdebt/report-first-customer` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | todo |  |  |  |
| Dev | done | computeReport grace for WhatsApp time vs stored time (LINK_GRACE_MS) | 52d1ca2 | 2026-11-17 |
| Unit tests | done | reports.test.ts failing-first test; 12 passed in report suites | 52d1ca2 | 2026-11-17 |
| E2E | pass | npm run e2e: 184 passed (second run; first run had 1 unrelated Ask Ezy mobile timeout, passes alone, recorded L-25) | 52d1ca2 | 2026-11-17 |
| Dev Build | pass | fresh fake-WA server: 1 new customer with fix, 0 on main | 52d1ca2 | 2026-11-17 |
| Screen review | skip | no screen changed | 52d1ca2 | 2026-11-17 |

## Log

- 2026-11-17 Dev: done — computeReport grace for WhatsApp time vs stored time (LINK_GRACE_MS) (52d1ca2)
- 2026-11-17 Unit tests: done — reports.test.ts failing-first test; 12 passed in report suites (52d1ca2)
- 2026-11-17 E2E: pass — npm run e2e: 184 passed (second run; first run had 1 unrelated Ask Ezy mobile timeout, passes alone, recorded L-25) (52d1ca2)
- 2026-11-17 Dev Build: pass — fresh fake-WA server: 1 new customer with fix, 0 on main (52d1ca2)
- 2026-11-17 Screen review: skip — no screen changed (52d1ca2)
