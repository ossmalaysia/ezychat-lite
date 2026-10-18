# Workbook: feat/edition-licensing-hooks

Branch: `feat/edition-licensing-hooks` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | todo |  |  |
| Dev | done | Edition hooks for licensing: access gate + host-only routes (server), banner slot, lock screen, configurable links, brand assets (web), status sections + URL update feed (desktop) | 2026-10-17 |
| Unit tests | done | Final commit f0026e4: 2242 tests pass (207 files), typecheck and lint clean | 2026-10-18 |
| E2E | done | Final commit f0026e4: npm run e2e 65 passed | 2026-10-18 |
| Dev Build | done | Enterprise Dev Build (fake WA) against local portal: 27/28 checks + 1 false alarm (same-shape answer echoes the typed email). Register, trial, activate, revoke lock, re-activate, host-only refuses tunnel | 2026-10-17 |
| Screen review | done | Real build screens 1280/360 light/dark: Enterprise sign-in logo, slim trial bar, lock screen (Turned off), portal installs + detail; 0 page errors/overflow. Fix: duplicate 'turns back on' line on host lock view | 2026-10-17 |

## Log

- 2026-10-17 Dev: done — Edition hooks for licensing: access gate + host-only routes (server), banner slot, lock screen, configurable links, brand assets (web), status sections + URL update feed (desktop)
- 2026-10-17 Unit tests: done — Full suite 2239 tests pass (207 files) incl. access-gate (10), send-queue pause, tunnel pause, AI pause, web access/lock/links, desktop status sections
- 2026-10-17 E2E: done — npm run e2e: 65 passed, 8 skipped
- 2026-10-17 Dev Build: done — Enterprise Dev Build (fake WA) against local portal: 27/28 checks + 1 false alarm (same-shape answer echoes the typed email). Register, trial, activate, revoke lock, re-activate, host-only refuses tunnel
- 2026-10-17 Screen review: done — Real build screens 1280/360 light/dark: Enterprise sign-in logo, slim trial bar, lock screen (Turned off), portal installs + detail; 0 page errors/overflow. Fix: duplicate 'turns back on' line on host lock view
- 2026-10-18 Unit tests: done — Final commit f0026e4: 2242 tests pass (207 files), typecheck and lint clean
- 2026-10-18 E2E: done — Final commit f0026e4: npm run e2e 65 passed
