# Workbook: release/0.1.37

Branch: `release/0.1.37` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | skip | Release metadata only; the feature mock was confirmed in PR 94 | 2026-10-15 |
| Dev | done | Root, five workspaces and lockfile at 0.1.37; changelog dated 2026-10-16 (simpler first-time setup, PR 94) | 2026-10-15 |
| Unit tests | pass | PR 94 CI passed Windows/macOS/Linux and SonarCloud; sync-version --check ok | 2026-10-15 |
| E2E | skip | Version-only release; PR 94 full e2e passed after the enrichment spec fix | 2026-10-15 |
| Dev Build | pass | Windows unpacked 0.1.37: health/web 0.1.37, fresh install needs setup and defaults to ChatGPT signed out, messages delivered, new setup strings packaged | 2026-10-15 |
| Screen review | skip | No UI change in release metadata; screen review done in PR 94 | 2026-10-15 |

## Log

- 2026-10-15 Design: skip — Release metadata only; the feature mock was confirmed in PR 94
- 2026-10-15 Dev: done — Root, five workspaces and lockfile at 0.1.37; changelog dated 2026-10-16 (simpler first-time setup, PR 94)
- 2026-10-15 Unit tests: pass — PR 94 CI passed Windows/macOS/Linux and SonarCloud; sync-version --check ok
- 2026-10-15 E2E: skip — Version-only release; PR 94 full e2e passed after the enrichment spec fix
- 2026-10-15 Dev Build: pass — Windows unpacked 0.1.37: health/web 0.1.37, fresh install needs setup and defaults to ChatGPT signed out, messages delivered, new setup strings packaged
- 2026-10-15 Screen review: skip — No UI change in release metadata; screen review done in PR 94
