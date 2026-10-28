# Workbook: Fix English (grammar fix)

Branch: `claude/compassionate-euler-tpgs37` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Fix English mock confirmed by the owner 2026-10-28 (mock revision 4a6cde77) | 77966fc | 2026-10-28 |
| Dev | done | Server (fix-grammar route, words, switch, migration 025) and web (dictionary spelling, composer marks, Settings card) | 77966fc | 2026-10-28 |
| Unit tests | pass | Changed-lines coverage 97.5% (541/555); new tests: fix-english routes 15, grammar diff 7, shared 8, spelling 11, composer 13, FixEnglish 8, Settings 4, dictionary 2; full suite: only 5 failures that also fail on clean main (document worker on Node 22, get_stats near MYT midnight) | 77966fc | 2026-10-28 |
| E2E | pass | Full npm run e2e on 77966fc (119 passed; only ai-member upload failed: document worker on Node 22, also on main); after the scroll fix e2e/fix-english.spec.ts re-run on desktop, Android and iPhone: all pass. Desktop-window link check not run (Linux cloud, no Windows desktop). | 82e0eed | 2026-10-28 |
| Dev Build | pass | agents-devbuild :7491: devbuild-fix-english-check 11/11; fix-english-screens 36 shots, no errors/overflow after fixing the phone card and stale grammar marks | 77966fc | 2026-10-28 |
| Screen review | pass | fix-english-screens.mjs re-run on 82e0eed: 36 shots at 1280/360, light/dark, no errors or overflow; reviewed: card kept on screen, stale Fix N fixed; docs/screenshots/fix-english refreshed | 82e0eed | 2026-10-28 |

## Log

- 2026-10-28 Design: doing — Fix English HTML mock (docs/features/grammar-fix): cloned from ai-groups ea63248f; underlines, card, Fix all + Ctrl+J, Undo, Malay skip, unavailable, Settings -> AI card; grammar-shots.mjs 40/40 desktop+mobile light+dark; waiting for owner confirmation (8a3f44f)
- 2026-10-28 Design: doing — Round 2 (owner chose option B): spelling from a browser dictionary (stand-in for nspell + dictionary-en-gb, ~0.2 MB), grammar from the AI after a pause, team word list (card Add to team words, Settings -> AI list); grammar-shots.mjs 52/52 desktop+mobile light+dark; waiting for owner confirmation (ee05e11)
- 2026-10-28 Dev: done — Server (fix-grammar route, words, switch, migration 025) and web (dictionary spelling, composer marks, Settings card) (77966fc)
- 2026-10-28 Unit tests: pass — Changed-lines coverage 97.5% (541/555); new tests: fix-english routes 15, grammar diff 7, shared 8, spelling 11, composer 13, FixEnglish 8, Settings 4, dictionary 2; full suite: only 5 failures that also fail on clean main (document worker on Node 22, get_stats near MYT midnight) (77966fc)
- 2026-10-28 Dev Build: pass — agents-devbuild :7491: devbuild-fix-english-check 11/11; fix-english-screens 36 shots, no errors/overflow after fixing the phone card and stale grammar marks (77966fc)
- 2026-10-28 Screen review: pass — 1280/360 light/dark reviewed: card kept on screen, stale Fix N fixed; docs/screenshots/fix-english (77966fc)
- 2026-10-28 Design: done — Fix English mock confirmed by the owner 2026-10-28 (mock revision 4a6cde77) (77966fc)
- 2026-10-28 E2E: pass — npm run e2e: Fix English passes on desktop, Android and iPhone (iPhone first failed: the card closed when focus scrolled the box; it now follows the word). Other failure: ai-member upload (document worker on Node 22, recorded in LEARNINGS, fails on main too). 119 passed, 25 skipped. (77966fc)
- 2026-10-28 E2E: pass — Full npm run e2e on 77966fc (119 passed; only ai-member upload failed: document worker on Node 22, also on main); after the scroll fix e2e/fix-english.spec.ts re-run on desktop, Android and iPhone: all pass. Desktop-window link check not run (Linux cloud, no Windows desktop). (82e0eed)
- 2026-10-28 Screen review: pass — fix-english-screens.mjs re-run on 82e0eed: 36 shots at 1280/360, light/dark, no errors or overflow; reviewed: card kept on screen, stale Fix N fixed; docs/screenshots/fix-english refreshed (82e0eed)
