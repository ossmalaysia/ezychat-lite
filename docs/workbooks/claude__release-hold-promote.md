# Workbook: claude/release-hold-promote

Branch: `claude/release-hold-promote` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | skip | release pipeline only; no screen | a09e3a9 | 2026-11-20 |
| Dev | done | Releases held as drafts; promote-release.yml; release-publish promote plan; updater hold contract test | a09e3a9 | 2026-11-20 |
| Unit tests | done | release-publish and update-checker tests pass; promote steps run against a fake gh (switch-over, no hold_newer, normal, incomplete) | a09e3a9 | 2026-11-20 |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | skip | no screen change | a09e3a9 | 2026-11-20 |

## Log

- 2026-11-20 Dev: done — Releases held as drafts; promote-release.yml; release-publish promote plan; updater hold contract test (a09e3a9)
- 2026-11-20 Unit tests: done — release-publish and update-checker tests pass; promote steps run against a fake gh (switch-over, no hold_newer, normal, incomplete) (a09e3a9)
- 2026-11-20 Design: skip — release pipeline only; no screen (a09e3a9)
- 2026-11-20 Screen review: skip — no screen change (a09e3a9)
