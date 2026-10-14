# Workbook: Open-core editions

Branch: `feat/open-core-extension-points` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | done | Agreed design: docs/superpowers/specs/2026-10-15-open-core-editions-design.md (Enterprise consumes published @ezychat/* npm packages, never a submodule) | 2026-10-14 |
| Dev | done | Server ServerExtension + runCli, web WebExtension/createInboxApp, desktop product.ts identity, @ezychat/* rename, dist builds + ezychat-source condition, web library, pack:core, publish workflow, per-package vitest configs | 2026-10-14 |
| Unit tests | done | Each agent ran vitest on its touched files + workspace typecheck + eslint; pack contract test; desktop byte-identity check of generated service/updater scripts | 2026-10-14 |
| E2E | todo | Pending: main agent runs the consolidated verification once at the end | 2026-10-14 |
| Dev Build | pass | Server-level checks 2026-10-15 (docs/dev-build-checks.md): Enterprise-style runCli extension (migration, init, /api/ext route, Origin 403), Lite control, packed @ezychat/server tarball, Enterprise enterprise-hello bundle. Untested: packaged --dir build, published packages, Enterprise desktop | 2026-10-14 |
| Screen review | skip | Not needed: no visible UI change in Lite | 2026-10-14 |

## Log

- 2026-10-14 Design: done — Agreed design: docs/superpowers/specs/2026-10-15-open-core-editions-design.md (Enterprise consumes published @ezychat/* npm packages, never a submodule)
- 2026-10-14 Dev: done — Server ServerExtension + runCli, web WebExtension/createInboxApp, desktop product.ts identity, @ezychat/* rename, dist builds + ezychat-source condition, web library, pack:core, publish workflow, per-package vitest configs
- 2026-10-14 Unit tests: done — Each agent ran vitest on its touched files + workspace typecheck + eslint; pack contract test; desktop byte-identity check of generated service/updater scripts
- 2026-10-14 Dev Build: pass — Server-level checks 2026-10-15 (docs/dev-build-checks.md): Enterprise-style runCli extension (migration, init, /api/ext route, Origin 403), Lite control, packed @ezychat/server tarball, Enterprise enterprise-hello bundle. Untested: packaged --dir build, published packages, Enterprise desktop
- 2026-10-14 E2E: todo — Pending: main agent runs the consolidated verification once at the end
- 2026-10-14 Screen review: skip — Not needed: no visible UI change in Lite
