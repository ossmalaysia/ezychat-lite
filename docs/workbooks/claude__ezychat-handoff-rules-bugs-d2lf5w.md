# Workbook: AI hand-off rules fixes

Branch: `claude/ezychat-handoff-rules-bugs-d2lf5w` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | todo |  |  |  |
| Dev | done | Hand-off rules precedence, consultation = discovery, per-agent resolution question (migration 026, Closing chats card), waiting-after-hand-off push title | de47bf8 | 2026-10-30 |
| Unit tests | pass | resolution, prompt, ai-handoff-rules (3 repros, bite-proofed), push, migrate 026, AgentResolutionCard; 2 pre-existing PDF-worker failures also on main | de47bf8 | 2026-10-30 |
| E2E | todo | not run in this cloud session | de47bf8 | 2026-10-30 |
| Dev Build | todo | real-model try_ai_reply on Anchor Sprint agent 1 (v87) needs owner sign-in | de47bf8 | 2026-10-30 |
| Screen review | todo | Closing chats card: needs mock + 1280/360 screenshots | de47bf8 | 2026-10-30 |

## Log

- 2026-10-30 Dev: done — Hand-off rules precedence, consultation = discovery, per-agent resolution question (migration 026, Closing chats card), waiting-after-hand-off push title (de47bf8)
- 2026-10-30 Unit tests: pass — resolution, prompt, ai-handoff-rules (3 repros, bite-proofed), push, migrate 026, AgentResolutionCard; 2 pre-existing PDF-worker failures also on main (de47bf8)
- 2026-10-30 E2E: todo — not run in this cloud session (de47bf8)
- 2026-10-30 Screen review: todo — Closing chats card: needs mock + 1280/360 screenshots (de47bf8)
- 2026-10-30 Dev Build: todo — real-model try_ai_reply on Anchor Sprint agent 1 (v87) needs owner sign-in (de47bf8)
