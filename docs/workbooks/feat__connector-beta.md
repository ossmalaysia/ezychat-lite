# Workbook: Connector Beta mark + grey text fix

Branch: `feat/connector-beta` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | Owner chose the list-driven Beta mark (no new mock: badge + notice reuse the confirmed connector page); grey-text fix has no new screen | 2be6a01 | 2026-10-27 |
| Dev | done | stage/notice in the contract, Beta badge + notice, Google Calendar Beta in the built-in list; continuationOf cuts the typed text from completions | 2be6a01 | 2026-10-27 |
| Unit tests | pass | Full suite 3692 passed (2 load-only waits fixed with explicit timeouts, then pass); changed lines 100 % | 2be6a01 | 2026-10-27 |
| E2E | pass | Final commit 957decf: npm run e2e 112 passed, 19 skipped, 0 failed; npm run e2e:electron-links 17/17 screens | 957decf | 2026-10-27 |
| Dev Build | pass | Mock Dev Build :7493: devbuild-suggestions-check 11/11 (grey text 'Ayam RM12 on your menu.' after 'Our Nasi Lemak ', ' Ayam…' after 'Our Nasi Lemak'), devbuild-calendar-check 29/29 | 24e9125 | 2026-10-27 |
| Screen review | pass | connectors-screens 1280/360 light/dark: Beta badge on the Google Calendar card and header, Beta notice above the Google account; no page errors or overflow | 24e9125 | 2026-10-27 |

## Log

- 2026-10-27 Design: skip — Owner chose the list-driven Beta mark (no new mock: badge + notice reuse the confirmed connector page); grey-text fix has no new screen (2be6a01)
- 2026-10-27 Dev: done — stage/notice in the contract, Beta badge + notice, Google Calendar Beta in the built-in list; continuationOf cuts the typed text from completions (2be6a01)
- 2026-10-27 Unit tests: pass — Full suite 3692 passed (2 load-only waits fixed with explicit timeouts, then pass); changed lines 100 % (2be6a01)
- 2026-10-27 E2E: pass — npm run e2e: 110 passed, 1 known flake (multi-inbox strict-mode text, now scoped to the message log; project re-run 6/6); npm run e2e:electron-links 17/17 screens (2be6a01)
- 2026-10-27 Dev Build: pass — Mock Dev Build :7493: devbuild-suggestions-check 11/11 (grey text 'Ayam RM12 on your menu.' after 'Our Nasi Lemak ', ' Ayam…' after 'Our Nasi Lemak'), devbuild-calendar-check 29/29 (24e9125)
- 2026-10-27 Screen review: pass — connectors-screens 1280/360 light/dark: Beta badge on the Google Calendar card and header, Beta notice above the Google account; no page errors or overflow (24e9125)
- 2026-10-27 E2E: pass — Final commit 957decf: npm run e2e 112 passed, 19 skipped, 0 failed; npm run e2e:electron-links 17/17 screens (957decf)
