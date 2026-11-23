# Workbook: feat/agent-connectors-summary

Branch: `feat/agent-connectors-summary` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Design-only (mock-index order 51): existing card; design-system patterns 'Way back before the breadcrumb' and 'Set up cue in a summary row'; screenshots docs/screenshots/connectors/agent-card-*, agent-back-link-*. Waiting for the owner's look. | 45b5638 | 2026-11-23 |
| Dev | done | Review fixes: wayBackAgent shared by breadcrumb and picker (stale agent id → no way back, dropped on switch); Set up cue only when connected, not delisted, has tools; cue kept on one line | 45b5638 | 2026-11-23 |
| Unit tests | pass | connectors tests (AgentConnectorsCard, ConnectorDetailPage, GitHub, Drive, Sheets, SQL: 133), web typecheck, eslint | 45b5638 | 2026-11-23 |
| E2E | pass | npm run e2e on 45b5638: 196 passed, 32 skipped (platform skips), 0 failed | 45b5638 | 2026-11-23 |
| Dev Build | done | fresh standalone --fake-wa server, fake Google sign-in, e2e/agent-connectors-screens.mjs (docs/dev-build-checks.md 2026-11-23); stale-agent link checked by unit test only | ce8fad5 | 2026-11-23 |
| Screen review | done | agent-card-setup/attention-* and agent-back-link-* at 1280/360 light/dark; found and fixed: Set up split across lines on phones, shot scrolled | ce8fad5 | 2026-11-23 |

## Log

- 2026-11-22 Design: done — Card already existed (AgentConnectorsCard); small copy/link change, no new screen: mock skipped (02f8a83)
- 2026-11-22 Dev: done — names in rows, Not used by this agent + Set up, Back to AI agent (02f8a83)
- 2026-11-22 E2E: done — npm run e2e 196 passed, 32 skipped (browser only, not electron-links) (02f8a83)
- 2026-11-23 Design: done — Design-only (mock-index order 51): existing card; design-system patterns 'Way back before the breadcrumb' and 'Set up cue in a summary row'; screenshots docs/screenshots/connectors/agent-card-*, agent-back-link-*. Waiting for the owner's look. (45b5638)
- 2026-11-23 Dev: done — Review fixes: wayBackAgent shared by breadcrumb and picker (stale agent id → no way back, dropped on switch); Set up cue only when connected, not delisted, has tools; cue kept on one line (45b5638)
- 2026-11-23 Unit tests: pass — connectors tests (AgentConnectorsCard, ConnectorDetailPage, GitHub, Drive, Sheets, SQL: 133), web typecheck, eslint (45b5638)
- 2026-11-23 E2E: pass — npm run e2e on 45b5638: 196 passed, 32 skipped (platform skips), 0 failed (45b5638)
- 2026-11-23 Dev Build: done — fresh standalone --fake-wa server, fake Google sign-in, e2e/agent-connectors-screens.mjs (docs/dev-build-checks.md 2026-11-23); stale-agent link checked by unit test only (ce8fad5)
- 2026-11-23 Screen review: done — agent-card-setup/attention-* and agent-back-link-* at 1280/360 light/dark; found and fixed: Set up split across lines on phones, shot scrolled (ce8fad5)
