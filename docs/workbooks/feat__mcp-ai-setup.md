# Workbook: MCP tools for the AI Sales Agent setup

Branch: `feat/mcp-ai-setup` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | todo |  |  |
| Dev | done | MCP tools: get_ai_agent_setup, get_ai_context_item, try_ai_reply, update_ai_setup, get_ai_setup_history, AI stats in get_stats; versions table; wording fix | 2026-10-09 |
| Unit tests | pass | 1,777 passed (one lazy-locale UserMenu test flaked at 5 s under load; given the 20 s timeout per LEARNINGS); typecheck, lint, web build green | 2026-10-09 |
| E2E | pass | 52 passed | 2026-10-09 |
| Dev Build | pass | real Claude Code refined hand-off rule 4 with reason; versions + audit verified; try_ai_reply not run with a real model | 2026-10-09 |
| Screen review | todo |  |  |

## Log

- 2026-10-09 Dev: done — MCP tools: get_ai_agent_setup, get_ai_context_item, try_ai_reply, update_ai_setup, get_ai_setup_history, AI stats in get_stats; versions table; wording fix
- 2026-10-09 Dev Build: pass — real Claude Code refined hand-off rule 4 with reason; versions + audit verified; try_ai_reply not run with a real model
- 2026-10-09 Unit tests: pass — 1,777 passed (one lazy-locale UserMenu test flaked at 5 s under load; given the 20 s timeout per LEARNINGS); typecheck, lint, web build green
- 2026-10-09 E2E: pass — 52 passed
