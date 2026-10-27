# Workbook: Connector Beta mark + grey text fix

Branch: `feat/connector-beta` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | Owner chose the list-driven Beta mark (no new mock: badge + notice reuse the confirmed connector page); grey-text fix has no new screen | 2be6a01 | 2026-10-27 |
| Dev | done | stage/notice in the contract, Beta badge + notice, Google Calendar Beta in the built-in list; continuationOf cuts the typed text from completions | 2be6a01 | 2026-10-27 |
| Unit tests | pass | Full suite 3692 passed (2 load-only waits fixed with explicit timeouts, then pass); changed lines 100 % | 2be6a01 | 2026-10-27 |
| E2E | pass | npm run e2e: 110 passed, 1 known flake (multi-inbox strict-mode text, now scoped to the message log; project re-run 6/6); npm run e2e:electron-links 17/17 screens | 2be6a01 | 2026-10-27 |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Log

- 2026-10-27 Design: skip — Owner chose the list-driven Beta mark (no new mock: badge + notice reuse the confirmed connector page); grey-text fix has no new screen (2be6a01)
- 2026-10-27 Dev: done — stage/notice in the contract, Beta badge + notice, Google Calendar Beta in the built-in list; continuationOf cuts the typed text from completions (2be6a01)
- 2026-10-27 Unit tests: pass — Full suite 3692 passed (2 load-only waits fixed with explicit timeouts, then pass); changed lines 100 % (2be6a01)
- 2026-10-27 E2E: pass — npm run e2e: 110 passed, 1 known flake (multi-inbox strict-mode text, now scoped to the message log; project re-run 6/6); npm run e2e:electron-links 17/17 screens (2be6a01)
