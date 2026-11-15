# Workbook: Google picker and sign-in from a remote device

Branch: `fix/picker-remote-device` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | todo |  |  |  |
| Dev | done | Fix A: onThisComputer on the Calendar, Sheets and Drive statuses, 409 host_only on connect and picker start, RemoteOnlyNotice in the cards | d7bd15d | 2026-11-15 |
| Unit tests | pass | typecheck, lint, npm test 5936 passed, changed-lines coverage 100 % (34/34), web-client contract test | d7bd15d | 2026-11-15 |
| E2E | pass | npm run e2e on d7bd15d: 183 passed; message-changes.spec failed once (not this PR's code, known live-event flake) and passed on re-run (3 projects) | d7bd15d | 2026-11-15 |
| Dev Build | skip | needs real Google and a real tunnel: the owner's check | d7bd15d | 2026-11-15 |
| Screen review | pass | Sheets, Drive and Calendar sign-in in the remote state at 1280 and 360 px, light and dark: Banner info tone per design-system, tokens only, no overflow, no page errors, no extra tab; docs/screenshots/connectors/remote-device-* | d7bd15d | 2026-11-15 |

## Log

- 2026-11-15 Dev: done — Fix A: onThisComputer on the Calendar, Sheets and Drive statuses, 409 host_only on connect and picker start, RemoteOnlyNotice in the cards (d7bd15d)
- 2026-11-15 Unit tests: pass — typecheck, lint, npm test 5936 passed, changed-lines coverage 100 % (34/34), web-client contract test (d7bd15d)
- 2026-11-15 E2E: pass — npm run e2e on d7bd15d: 183 passed; message-changes.spec failed once (not this PR's code, known live-event flake) and passed on re-run (3 projects) (d7bd15d)
- 2026-11-15 Screen review: pass — Sheets, Drive and Calendar sign-in in the remote state at 1280 and 360 px, light and dark: Banner info tone per design-system, tokens only, no overflow, no page errors, no extra tab; docs/screenshots/connectors/remote-device-* (d7bd15d)
- 2026-11-15 Dev Build: skip — needs real Google and a real tunnel: the owner's check (d7bd15d)
