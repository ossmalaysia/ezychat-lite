# Workbook: Ask Ezy sets up agents and scheduled tasks

Branch: `feat/ask-ezy-setup` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | pass | Owner confirmed the quick mock 2026-11-12 (look good, implement) | d506483 | 2026-11-12 |
| Dev | pass | Fixes A-H after the owner's real-model test; one question per agent by name; no one-choice question | bc52a8e | 2026-11-12 |
| Unit tests | pass | Ask Ezy server, prompt, shared and web tests 247 + 49 on the final prompt; typecheck all workspaces | bc52a8e | 2026-11-12 |
| E2E | pass | npm run e2e (Windows, Node 24, 2 workers): 159 passed, 27 skipped, 0 failed; e2e:electron-links 17/17 screens | d506483 | 2026-11-12 |
| Dev Build | pass | Real-model eval GPA 3.97 (126/126) on b1b0e3f, Lite agent limit; improve-agent repro 4/4 | b1b0e3f6 | 2026-11-13 |
| Screen review | pass | Question, which chat, cards, edit at 1280/360 light/dark on bc52a8e: 16 shots, no errors, no overflow | bc52a8e | 2026-11-12 |

## Log

- 2026-11-12 Design: pass — Owner confirmed the quick mock 2026-11-12 (look good, implement) (d506483)
- 2026-11-12 Dev: pass — Question block, agent/task proposals and edits, Apply both, Undo; 10 review fixes; tool-failure log (d506483)
- 2026-11-12 Unit tests: pass — Ask Ezy setup/ask-ezy server tests, askezy web tests, contract test: 61 pass; earlier full targeted set 234; typecheck all workspaces (d506483)
- 2026-11-12 Dev Build: pass — devbuild-ask-ezy-setup-check.mjs 12/12 on d506483 (mock model over the real tools, temp data) (d506483)
- 2026-11-12 Screen review: pass — Question, which chat, cards, edit at 1280/360 light/dark: 16 shots, no errors, no overflow; duplicate question fixed (d506483)
- 2026-11-12 E2E: pass — npm run e2e (Windows, Node 24, 2 workers): 159 passed, 27 skipped, 0 failed; e2e:electron-links 17/17 screens (d506483)
- 2026-11-12 Dev: pass — Fixes A-H after the owner's real-model test; one question per agent by name; no one-choice question (bc52a8e)
- 2026-11-12 Unit tests: pass — Ask Ezy server, prompt, shared and web tests 247 + 49 on the final prompt; typecheck all workspaces (bc52a8e)
- 2026-11-12 Dev Build: pass — Mock: devbuild-ask-ezy-setup-check.mjs 13/13; real model: ask-ezy-eval.mjs GPA 3.92 (A) PASS, 4.00 rescored after an eval fix (see docs/dev-build-checks.md) (bc52a8e)
- 2026-11-12 Screen review: pass — Question, which chat, cards, edit at 1280/360 light/dark on bc52a8e: 16 shots, no errors, no overflow (bc52a8e)
- 2026-11-13 Dev Build: pass — Real-model eval GPA 3.97 (126/126) on b1b0e3f, Lite agent limit; improve-agent repro 4/4 (b1b0e3f6)
