# Workbook: Reconnect promptly when reopening the PWA

Branch: `fix/pwa-foreground-reconnect` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | skip | Connection lifecycle only; existing banner, layout and translations retained | 2026-10-13 |
| Dev | done | Resume/page-show/online reconnect cancels pending backoff; hidden/offline/live/in-flight/inactive sessions are guarded; late close events handled | 2026-10-13 |
| Unit tests | pass | Full verification: 183 files, 1898 tests passed and 1 skipped; all-workspace/E2E typechecks, ESLint and web build passed | 2026-10-13 |
| E2E | pass | Full suite: 59 passed and 8 skipped; corrected the new test counter to include native online events, then all 4 focused setup/desktop/mobile/iPhone checks passed; retry timers frozen and late-close recovery verified | 2026-10-13 |
| Dev Build | pass | Fresh-temp fake-WA Dev Build recovered in 27-32 ms locally; missed message restored; warning retained during outage; no browser/server errors; real phone/Cloudflare behavior not yet checked | 2026-10-13 |
| Screen review | skip | No visual or copy changes; exercise existing reconnect banner during Dev Build checks | 2026-10-13 |

## Log

- 2026-10-13 Design: skip — Connection lifecycle only; existing banner, layout and translations retained
- 2026-10-13 Dev: doing — Add foreground/online reconnect with in-flight and session guards
- 2026-10-13 Screen review: skip — No visual or copy changes; exercise existing reconnect banner during Dev Build checks
- 2026-10-13 Unit tests: pass — 21 focused tests passed, including 12 lifecycle cases; regression tests failed before implementation; web typecheck passed
- 2026-10-13 Dev: done — Resume/page-show/online reconnect cancels pending backoff; hidden/offline/live/in-flight/inactive sessions are guarded; late close events handled
- 2026-10-13 Unit tests: pass — 23 focused tests passed, including 14 lifecycle cases; event-order regression failed before fix; web and E2E typechecks passed
- 2026-10-13 Dev Build: pass — Fresh-temp fake-WA Dev Build recovered in 27-32 ms locally; missed message restored; warning retained during outage; no browser/server errors; real phone/Cloudflare behavior not yet checked
- 2026-10-13 Unit tests: pass — Full verification: 183 files, 1898 tests passed and 1 skipped; all-workspace/E2E typechecks, ESLint and web build passed
- 2026-10-13 E2E: doing — Run full browser suite, including frozen-timer resume and late-drop cases, across desktop/mobile/iPhone Chromium
- 2026-10-13 E2E: pass — Full suite: 59 passed and 8 skipped; corrected the new test counter to include native online events, then all 4 focused setup/desktop/mobile/iPhone checks passed; retry timers frozen and late-close recovery verified
