# Workbook: AI agents in WhatsApp groups

Branch: `feat/ai-groups` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Mock confirmed by the owner 2026-10-28 ('confirm'; trigger 'when tagged or quoted'; loop guard only) at ea63248 | d8d0f9f | 2026-10-28 |
| Dev | done | Migration 024, ai/groups.ts (tag/quote detection, loop guard), group turns (no claim, look-ups only, hand-over line + notification), routes, web Groups card/badge/Group info/lines/Try it | d8d0f9f | 2026-10-28 |
| Unit tests | pass | Full suite 3758 passed (321 files) with coverage; changed lines 94.3 %; lines total 90.26 % | bc5d5f80 | 2026-10-28 |
| E2E | pass | Final commit d8d0f9fc, 1 worker: 115 passed, 21 skipped, 1 flake (reactions.spec iphone emoji picker: passed in the previous full run and 3/3 twice alone; no reaction code changed); ai-groups.spec 4 passed; npm run e2e:electron-links 17/17 screens (bc5d5f80) | d8d0f9fc | 2026-10-28 |
| Dev Build | pass | Mock Dev Build: e2e/devbuild-groups-check.mjs ALL PASSED (19 steps, 18 member messages): tag, quote, unrelated, teammate quote, no claim, hand-over, loop guard + teammate reset, group off, Try it | bc5d5f80 | 2026-10-28 |
| Screen review | pass | e2e/groups-screens.mjs 1280/360 light/dark: Groups card, group chat (badge, quoted answers, lines), Group info, Try it Group question; no page errors or overflow; matches the confirmed mock; fixed card intro + quote line texts | bc5d5f80 | 2026-10-28 |

## Log

- 2026-10-28 Design: done — Mock confirmed by the owner 2026-10-28 ('confirm'; trigger 'when tagged or quoted'; loop guard only) at ea63248 (d8d0f9f)
- 2026-10-28 Dev: done — Migration 024, ai/groups.ts (tag/quote detection, loop guard), group turns (no claim, look-ups only, hand-over line + notification), routes, web Groups card/badge/Group info/lines/Try it (d8d0f9f)
- 2026-10-28 Unit tests: pass — Full suite 3758 passed (321 files) with coverage; changed lines 94.3 %; lines total 90.26 % (bc5d5f80)
- 2026-10-28 Dev Build: pass — Mock Dev Build: e2e/devbuild-groups-check.mjs ALL PASSED (19 steps, 18 member messages): tag, quote, unrelated, teammate quote, no claim, hand-over, loop guard + teammate reset, group off, Try it (bc5d5f80)
- 2026-10-28 Screen review: pass — e2e/groups-screens.mjs 1280/360 light/dark: Groups card, group chat (badge, quoted answers, lines), Group info, Try it Group question; no page errors or overflow; matches the confirmed mock; fixed card intro + quote line texts (bc5d5f80)
- 2026-10-28 E2E: pass — Final commit d8d0f9fc, 1 worker: 115 passed, 21 skipped, 1 flake (reactions.spec iphone emoji picker: passed in the previous full run and 3/3 twice alone; no reaction code changed); ai-groups.spec 4 passed; npm run e2e:electron-links 17/17 screens (bc5d5f80) (d8d0f9fc)
