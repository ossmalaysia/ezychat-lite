# Workbook: AI hand-off rules fixes

Branch: `claude/ezychat-handoff-rules-bugs-d2lf5w` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | done | Closing chats mock confirmed by the owner 2026-10-30 with the default off for every agent; mock index latestConfirmed = 16a126e | 16a126e | 2026-10-30 |
| Dev | done | Hand-off rules precedence, consultation = discovery, per-agent resolution question (migration 026, Closing chats card), waiting-after-hand-off push title | de47bf8 | 2026-10-30 |
| Unit tests | pass | CI green on 30c9372: ubuntu (test:coverage, coverage:changed 100 %), macos, windows (one re-run of the known ai-agents-repo 30 s timeout, see PR comment); SonarCloud gate passed | 30c9372 | 2026-10-30 |
| E2E | pass | npm run e2e on 30c9372 (local Chromium): 126 passed, 1 failed = ai-member file upload 'Cannot read this document' (Node 22.22 parser worker, see LEARNINGS; passes in CI). e2e:electron-links green in CI (windows-latest) on 30c9372 | 30c9372 | 2026-10-30 |
| Dev Build | pass | upgrade from released 0.1.65 data 10/10 on 16a126e (all agents off); mock-model hand-off check 14/14 on 30c9372 (sales path unchanged); real-model try_ai_reply after merge with the owner's sign-in | 16a126e | 2026-10-30 |
| Screen review | done | on 30c9372: Closing chats card at 1280/360, light/dark, off/on: no page errors, no horizontal scroll, switch saves on click; shots docs/screenshots/ai-member/closing-chats-* (unchanged); mock docs/features/ai-handoff-rules awaiting owner confirmation | 30c9372 | 2026-10-30 |

## Log

- 2026-10-30 Dev: done — Hand-off rules precedence, consultation = discovery, per-agent resolution question (migration 026, Closing chats card), waiting-after-hand-off push title (de47bf8)
- 2026-10-30 Unit tests: pass — resolution, prompt, ai-handoff-rules (3 repros, bite-proofed), push, migrate 026, AgentResolutionCard; 2 pre-existing PDF-worker failures also on main (de47bf8)
- 2026-10-30 E2E: todo — not run in this cloud session (de47bf8)
- 2026-10-30 Screen review: todo — Closing chats card: needs mock + 1280/360 screenshots (de47bf8)
- 2026-10-30 Dev Build: todo — real-model try_ai_reply on Anchor Sprint agent 1 (v87) needs owner sign-in (de47bf8)
- 2026-10-30 E2E: pass — npm run e2e (local Chromium): 126 passed, 1 failed = ai-member file upload 'Cannot read this document' (container document parser; same unit tests fail on clean main here, pass in CI). Desktop-window link check not run here; CI runs it on Windows (2b541b5)
- 2026-10-30 Screen review: done — Closing chats card at 1280/360, light/dark, off/on: no page errors, no horizontal scroll, switch saves on click, 44px target like the Groups card; shots in docs/screenshots/ai-member/closing-chats-*. No separate HTML mock: one switch on the confirmed Groups card pattern (owner to confirm) (2b541b5)
- 2026-10-30 Unit tests: pass — CI green on 825abb9: ubuntu (incl. test:coverage + coverage:changed), macos, windows; SonarCloud gate passed (825abb9)
- 2026-10-30 E2E: pass — npm run e2e on 825abb9 (local Chromium): 126 passed, 1 failed = ai-member file upload 'Cannot read this document' (container document parser; same unit tests fail on clean main here, pass in CI). e2e:electron-links green in CI (windows-latest) on 825abb9 (825abb9)
- 2026-10-30 Screen review: done — Closing chats card at 1280/360, light/dark, off/on: no page errors, no horizontal scroll, switch saves on click, 44px target like the Groups card; shots docs/screenshots/ai-member/closing-chats-*. Card unchanged since 2b541b5. No separate HTML mock (Groups card pattern; owner to confirm) (825abb9)
- 2026-10-30 Design: done — HTML mock docs/features/ai-handoff-rules (clone of confirmed grammar-fix 4a6cde77 + Closing chats card; 12 shots, 0 problems; snapshot --check ok); google-calendar folder pruned; waiting for owner confirmation (7d2e926)
- 2026-10-30 Dev Build: pass — mock-model Dev Build 14/14 (devbuild-handoff-check.mjs) + real upgrade from released 0.1.65 data 10/10 (devbuild-upgrade-026-check.mjs) on f2bed1f; real-model try_ai_reply on the Anchor Sprint agent needs the owner's sign-in (f2bed1f)
- 2026-10-30 Design: done — HTML mock docs/features/ai-handoff-rules: clone of the confirmed concept-tips mock (360d3be5) + Closing chats card; 12 shots, 0 problems; snapshot --check ok; connector-list folder pruned; waiting for owner confirmation (5d33e66)
- 2026-10-30 Dev Build: pass — mock-model Dev Build 14/14 (devbuild-handoff-check.mjs) + real upgrade from released 0.1.65 data 10/10 (devbuild-upgrade-026-check.mjs) on 3b58a2d; real-model try_ai_reply on the Anchor Sprint agent needs the owner's sign-in (3b58a2d)
- 2026-10-30 Dev Build: pass — mock-model Dev Build 14/14 (devbuild-handoff-check.mjs) + real upgrade from released 0.1.65 data 10/10 (devbuild-upgrade-026-check.mjs) on 5fbb743; real-model try_ai_reply on the Anchor Sprint agent needs the owner's sign-in (5fbb743)
- 2026-10-30 Unit tests: pass — CI green on 30c9372: ubuntu (test:coverage, coverage:changed 100 %), macos, windows (one re-run of the known ai-agents-repo 30 s timeout, see PR comment); SonarCloud gate passed (30c9372)
- 2026-10-30 E2E: pass — npm run e2e on 30c9372 (local Chromium): 126 passed, 1 failed = ai-member file upload 'Cannot read this document' (Node 22.22 parser worker, see LEARNINGS; passes in CI). e2e:electron-links green in CI (windows-latest) on 30c9372 (30c9372)
- 2026-10-30 Dev Build: pass — on 30c9372: mock-model Dev Build 14/14 (devbuild-handoff-check.mjs) + real upgrade from released 0.1.65 data 10/10 (devbuild-upgrade-026-check.mjs); real-model try_ai_reply on the Anchor Sprint agent needs the owner's sign-in (30c9372)
- 2026-10-30 Screen review: done — on 30c9372: Closing chats card at 1280/360, light/dark, off/on: no page errors, no horizontal scroll, switch saves on click; shots docs/screenshots/ai-member/closing-chats-* (unchanged); mock docs/features/ai-handoff-rules awaiting owner confirmation (30c9372)
- 2026-10-30 Dev Build: pass — upgrade from released 0.1.65 data 10/10 on 16a126e (all agents off); mock-model hand-off check 14/14 on 30c9372 (sales path unchanged); real-model try_ai_reply after merge with the owner's sign-in (16a126e)
- 2026-10-30 Design: done — Closing chats mock confirmed by the owner 2026-10-30 with the default off for every agent; mock index latestConfirmed = 16a126e (16a126e)
