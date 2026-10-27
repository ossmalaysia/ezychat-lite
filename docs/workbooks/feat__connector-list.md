# Workbook: Connector list (externally managed connectors)

Branch: `feat/connector-list` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | mock confirmed by the owner 2026-10-27 ("yes, build it") at 9a5643920855cdc27449cbb4f4c3c7d6965eee06; sign-in types added; latestConfirmed updated | 9a56439 | 2026-10-26 |
| Dev | done | List module (signed list, local copy, built-in list), partner MCP connections (5 sign-in types, migration 023, guards, AI tools), web screens, test partner server | eeeb577 | 2026-10-26 |
| Unit tests | pass | 290 connector/related unit tests pass (server list + MCP + guards, web connectors, contract, migrate, upgrade-from-oldest, calendar); review fixes: limits reservation, fail-closed guards, schema-checked args, write switch keeps access, single-use consent, callback after disconnect, dev-only allowance, whole-token match | eeeb577 | 2026-10-26 |
| E2E | pass | Full e2e once on the rebased branch: 112 passed, 19 skipped, 0 failed (desktop, mobile, iphone, multi-inbox, new partners project 7/7) | 5cc03a3 | 2026-10-27 |
| Dev Build | pass | Mock Dev Build + partner MCP test server: e2e/devbuild-partner-check.mjs 25/25 (list, sign-in, every guard, Try it, partner down, Disconnect); logged in dev-build-checks.md | 5cc03a3 | 2026-10-27 |
| Screen review | pass | 60 shots (1280/360, light/dark) via e2e/partner-screens.mjs: no errors/overflow, matches mock; fixed raw argument names in the rules box; docs/screenshots/connectors/partner-* | 5cc03a3 | 2026-10-27 |

## Log

- 2026-10-26 Design: doing — design.md written (owner decisions 2026-10-27: list in anchorsprint/ezychat-connectors, signed, schemaVersion, no secrets, Google MCP confirmed, declared guards); mock being built from google-calendar f46aab96 + reports + Bookings tab (846775d)
- 2026-10-26 Design: doing — mock ready for the owner: 136 shots (1280/360, light/dark, Lite/Enterprise), no page errors or overflow; review page https://claude.ai/artifact/7LRhQpYTRKRfPDB1o71irs; waiting for confirmation and the 4 open questions (520c9e8)
- 2026-10-26 Design: done — mock confirmed by the owner 2026-10-27 ("yes, build it") at 9a5643920855cdc27449cbb4f4c3c7d6965eee06; sign-in types added; latestConfirmed updated (9a56439)
- 2026-10-26 Dev: done — List module (signed list, local copy, built-in list), partner MCP connections (5 sign-in types, migration 023, guards, AI tools), web screens, test partner server (eeeb577)
- 2026-10-26 Unit tests: pass — 290 connector/related unit tests pass (server list + MCP + guards, web connectors, contract, migrate, upgrade-from-oldest, calendar); review fixes: limits reservation, fail-closed guards, schema-checked args, write switch keeps access, single-use consent, callback after disconnect, dev-only allowance, whole-token match (eeeb577)
- 2026-10-27 E2E: pass — Full e2e once on the rebased branch: 112 passed, 19 skipped, 0 failed (desktop, mobile, iphone, multi-inbox, new partners project 7/7) (5cc03a3)
- 2026-10-27 Dev Build: pass — Mock Dev Build + partner MCP test server: e2e/devbuild-partner-check.mjs 25/25 (list, sign-in, every guard, Try it, partner down, Disconnect); logged in dev-build-checks.md (5cc03a3)
- 2026-10-27 Screen review: pass — 60 shots (1280/360, light/dark) via e2e/partner-screens.mjs: no errors/overflow, matches mock; fixed raw argument names in the rules box; docs/screenshots/connectors/partner-* (5cc03a3)
