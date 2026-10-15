# Workbook: release/0.1.36

Branch: `release/0.1.36` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | skip | Release metadata only; the fix and its signature check are in PR 89 | 2026-10-15 |
| Dev | done | Root, five workspaces and lockfile synchronized to 0.1.36; changelog dated 2026-10-15 (macOS Apple Silicon signing fix #89, Sales Agent handover notifications #86) | 2026-10-15 |
| Unit tests | pass | PR 89 CI passed Windows/macOS/Linux and SonarCloud; versions and lockfile synchronized (sync-version --check) | 2026-10-15 |
| E2E | skip | Version-only release; CI does not run e2e; PR 89 changes packaging config only | 2026-10-15 |
| Dev Build | pass | Windows unpacked 0.1.36: /api/health and web bundle identify 0.1.36; setup, login, inbound/reply delivered, logout with isolated fake-WA data | 2026-10-15 |
| Screen review | skip | No layout or copy changes | 2026-10-15 |

## Log

- 2026-10-15 Design: skip — Release metadata only; the fix and its signature check are in PR 89
- 2026-10-15 Dev: done — Root, five workspaces and lockfile synchronized to 0.1.36; changelog dated 2026-10-15 (macOS Apple Silicon signing fix #89, Sales Agent handover notifications #86)
- 2026-10-15 Screen review: skip — No layout or copy changes
- 2026-10-15 Dev Build: pass — Windows unpacked 0.1.36: /api/health and web bundle identify 0.1.36; setup, login, inbound/reply delivered, logout with isolated fake-WA data
- 2026-10-15 Unit tests: pass — PR 89 CI passed Windows/macOS/Linux and SonarCloud; versions and lockfile synchronized (sync-version --check)
- 2026-10-15 E2E: skip — Version-only release; CI does not run e2e; PR 89 changes packaging config only
