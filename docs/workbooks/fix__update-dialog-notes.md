# Workbook: Update dialog: what's new, no stale result

Branch: `fix/update-dialog-notes` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Owner chose: notes inside the update dialog only (no page) | 2026-10-21 |
| Dev | done | Feed notes list, What's new title, last-update rule | 2026-10-21 |
| Unit tests | done | update-checker 52, DesktopUpdates+i18n 37 | 2026-10-21 |
| E2E | done | 67 passed; electron-links 15/15 | 2026-10-21 |
| Dev Build | skip | Desktop-host dialog only; checked with the e2e bridge fixture, not in a packaged build | 2026-10-21 |
| Screen review | done | Dialog at 1280 and 360 from the e2e fixture; stale banner gone | 2026-10-21 |

## Log

- 2026-10-21 Design: done — Owner chose: notes inside the update dialog only (no page)
- 2026-10-21 Dev: done — Feed notes list, What's new title, last-update rule
- 2026-10-21 Unit tests: done — update-checker 52, DesktopUpdates+i18n 37
- 2026-10-21 E2E: done — 67 passed; electron-links 15/15
- 2026-10-21 Screen review: done — Dialog at 1280 and 360 from the e2e fixture; stale banner gone
- 2026-10-21 Dev Build: skip — Desktop-host dialog only; checked with the e2e bridge fixture, not in a packaged build
