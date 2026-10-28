# Workbook: feat/ai-groups-open-chat

Branch: `feat/ai-groups-open-chat` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Mock confirmed by the owner 2026-10-28 ('confirm can implement') at 8776f52b; religion added as a sensitive topic and defaults (Selected groups only, Tag and quote) accepted | 946d2fa4 | 2026-10-28 |
| Dev | done | Migration 025, ai/group-gate.ts (Open-chat decision + sensitive check on the fast model), scope/mode/per-group choice, GUARDRAILS topic rule with business exceptions, web Groups card + Group info choice + badges + lines; review fixes | 718417b5 | 2026-10-28 |
| Unit tests | pass | Full suite on 69730848 with coverage: 3814 passed, 2 failed (GroupPanel test of the old switch, fixed; pack-contract needs a fresh local dist build, CI builds it); changed lines 97.7 %, lines 90.49 %; after the review fixes the changed files' tests pass (server ai-groups 29, shared, web 55) | 718417b5 | 2026-10-28 |
| E2E | pass | Full npm run e2e on 69730848 (1 worker): 114 passed, 3 failed = ai-groups.spec locator (fixed); ai-groups.spec on 718417b5: 5 passed; npm run e2e:electron-links 17/17 screens | 718417b5 | 2026-10-28 |
| Dev Build | pass | Mock-model Dev Build on 718417b5: e2e/devbuild-groups-check.mjs ALL PASSED (30 steps): Tag and quote, Open chat open question/follow-up/name, question for a person, politics with and without a tag, halal answered; logs hold no message text | 718417b5 | 2026-10-28 |
| Screen review | pass | e2e/groups-screens.mjs 1280/360 light/dark on the Dev Build: Groups card, Open chat chat lines, polite line, Group info choice; matches the confirmed mock; fixed Group info title squeeze; docs/screenshots/ai-groups | 718417b5 | 2026-10-28 |

## Log

- 2026-10-28 Design: done — Mock confirmed by the owner 2026-10-28 ('confirm can implement') at 8776f52b; religion added as a sensitive topic and defaults (Selected groups only, Tag and quote) accepted (946d2fa4)
- 2026-10-28 Dev: done — Migration 025, ai/group-gate.ts (Open-chat decision + sensitive check on the fast model), scope/mode/per-group choice, GUARDRAILS topic rule with business exceptions, web Groups card + Group info choice + badges + lines; review fixes (718417b5)
- 2026-10-28 Unit tests: pass — Full suite on 69730848 with coverage: 3814 passed, 2 failed (GroupPanel test of the old switch, fixed; pack-contract needs a fresh local dist build, CI builds it); changed lines 97.7 %, lines 90.49 %; after the review fixes the changed files' tests pass (server ai-groups 29, shared, web 55) (718417b5)
- 2026-10-28 E2E: pass — Full npm run e2e on 69730848 (1 worker): 114 passed, 3 failed = ai-groups.spec locator (fixed); ai-groups.spec on 718417b5: 5 passed; npm run e2e:electron-links 17/17 screens (718417b5)
- 2026-10-28 Dev Build: pass — Mock-model Dev Build on 718417b5: e2e/devbuild-groups-check.mjs ALL PASSED (30 steps): Tag and quote, Open chat open question/follow-up/name, question for a person, politics with and without a tag, halal answered; logs hold no message text (718417b5)
- 2026-10-28 Screen review: pass — e2e/groups-screens.mjs 1280/360 light/dark on the Dev Build: Groups card, Open chat chat lines, polite line, Group info choice; matches the confirmed mock; fixed Group info title squeeze; docs/screenshots/ai-groups (718417b5)
