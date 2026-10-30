# Workbook: feat/ask-ezy

Branch: `feat/ask-ezy` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Mock docs/features/ask-ezy, 9 review rounds; round 9 passes the owner's stop rule (no high problem, reviewer levels >= 4, avg 4.4) | d3f4f40 | 2026-10-30 |
| Dev | done | Server ask-ezy routes/service/tools/changes, assist provider paths, web askezy panel and entry points | d3f4f40 | 2026-10-30 |
| Unit tests | done | 3911 tests pass; changed-lines coverage 94.8 % | ad8a4ed | 2026-10-30 |
| E2E | done | npm run e2e: 121 passed + Ask Ezy specs 7/7 (desktop, Pixel, iPhone); e2e:electron-links 17/17; run on ad8a4ed, same app code after the rebase onto #208 (tooling only) | f24c79e | 2026-10-30 |
| Dev Build | done | Real ChatGPT in the owner test env: 8-13 s per answer on the fast model (was 13-23 s); dev-build-checks.md | f24c79e | 2026-10-30 |
| Screen review | done | 9 designer review rounds on the mock (92 shots: desktop 1280 + phone 360, light/dark, every state); the app uses the same askezy components; round 9 passed the owner's stop rule. docs/screenshots not refreshed (follow-up) | f24c79e | 2026-10-30 |

## Log

- 2026-10-30 Design: done — Mock docs/features/ask-ezy, 9 review rounds; round 9 passes the owner's stop rule (no high problem, reviewer levels >= 4, avg 4.4) (d3f4f40)
- 2026-10-30 Dev: done — Server ask-ezy routes/service/tools/changes, assist provider paths, web askezy panel and entry points (d3f4f40)
- 2026-10-30 Dev Build: done — Real ChatGPT in the owner test env: 8-13 s per answer on the fast model (was 13-23 s); logged in dev-build-checks.md (ad8a4ed)
- 2026-10-30 E2E: done — npm run e2e: 121 passed + Ask Ezy specs fixed (7/7 desktop, Pixel, iPhone); e2e:electron-links 17/17 (ad8a4ed)
- 2026-10-30 Unit tests: done — 3911 tests pass; changed-lines coverage 94.8 % (ad8a4ed)
- 2026-10-30 E2E: done — npm run e2e: 121 passed + Ask Ezy specs 7/7 (desktop, Pixel, iPhone); e2e:electron-links 17/17; run on ad8a4ed, same app code after the rebase onto #208 (tooling only) (f24c79e)
- 2026-10-30 Dev Build: done — Real ChatGPT in the owner test env: 8-13 s per answer on the fast model (was 13-23 s); dev-build-checks.md (f24c79e)
- 2026-10-30 Screen review: done — 9 designer review rounds on the mock (92 shots: desktop 1280 + phone 360, light/dark, every state); the app uses the same askezy components; round 9 passed the owner's stop rule. docs/screenshots not refreshed (follow-up) (f24c79e)
