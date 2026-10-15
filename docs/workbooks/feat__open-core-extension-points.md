# Workbook: Open-core editions

Branch: `feat/open-core-extension-points` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Agreed design: docs/superpowers/specs/2026-10-15-open-core-editions-design.md (Enterprise consumes published @ezychat/* npm packages, never a submodule) | 2026-10-14 |
| Dev | done | Server ServerExtension + runCli, web WebExtension/createInboxApp, desktop product.ts identity, @ezychat/* rename, dist builds + ezychat-source condition, web library, pack:core, publish workflow, per-package vitest configs | 2026-10-14 |
| Unit tests | done | Each agent ran vitest on its touched files + workspace typecheck + eslint; pack contract test; desktop byte-identity check of generated service/updater scripts | 2026-10-14 |
| E2E | pass | After merging 0.1.37: 64 passed, 8 skipped, 1 known flake (pwa-resume clock, fixed in #88; 5/5 alone); unit 2146 passed | 2026-10-15 |
| Dev Build | pass | After merging 0.1.37: Lite fresh install 33/33 screens + new wizard, packaged --dir smoke, Enterprise on the merged core (wizard and sidebar say EzyChat Enterprise, hello extension, status 401/200) | 2026-10-15 |
| Screen review | pass | Lite screens unchanged (smoke 33/33); Enterprise sidebar name fixed and rechecked at 1280/360 px | 2026-10-15 |

## Log

- 2026-10-14 Design: done — Agreed design: docs/superpowers/specs/2026-10-15-open-core-editions-design.md (Enterprise consumes published @ezychat/* npm packages, never a submodule)
- 2026-10-14 Dev: done — Server ServerExtension + runCli, web WebExtension/createInboxApp, desktop product.ts identity, @ezychat/* rename, dist builds + ezychat-source condition, web library, pack:core, publish workflow, per-package vitest configs
- 2026-10-14 Unit tests: done — Each agent ran vitest on its touched files + workspace typecheck + eslint; pack contract test; desktop byte-identity check of generated service/updater scripts
- 2026-10-14 Dev Build: pass — Server-level checks 2026-10-15 (docs/dev-build-checks.md): Enterprise-style runCli extension (migration, init, /api/ext route, Origin 403), Lite control, packed @ezychat/server tarball, Enterprise enterprise-hello bundle. Untested: packaged --dir build, published packages, Enterprise desktop
- 2026-10-14 E2E: todo — Pending: main agent runs the consolidated verification once at the end
- 2026-10-14 Screen review: skip — Not needed: no visible UI change in Lite
- 2026-10-14 E2E: done — Consolidated: typecheck, lint, web build pass; 2070 unit tests passed (1 skipped); e2e 65 passed, 8 skipped
- 2026-10-15 E2E: done — Final commit: typecheck, lint, web build pass; 2076 unit tests passed (1 skipped); e2e 64 passed, 8 skipped, 1 flaky (pwa-resume clock, pre-existing; fixed separately in #88, 30/30 after fix)
- 2026-10-15 Dev Build: pass — Lite: seeded Dev Build, 33/33 screens, inbound/reply delivered, packaged --dir server + PDF worker. Enterprise: 33/33 core screens, hello page + admin nav desktop/mobile, admin-only API; product-name defect found and fixed
- 2026-10-15 Screen review: pass — Lite screens unchanged (smoke 33/33); Enterprise sidebar name fixed and rechecked at 1280/360 px
- 2026-10-15 Dev Build: pass — After merging 0.1.37: Lite fresh install 33/33 screens + new wizard, packaged --dir smoke, Enterprise on the merged core (wizard and sidebar say EzyChat Enterprise, hello extension, status 401/200)
- 2026-10-15 E2E: pass — After merging 0.1.37: 64 passed, 8 skipped, 1 known flake (pwa-resume clock, fixed in #88; 5/5 alone); unit 2146 passed
