# Workbook: Agent tool hooks for editions

Branch: `feat/agent-tool-hooks` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Updated |
| --- | --- | --- | --- |
| Design | skip | Extension API only; UI reference is the Enterprise Connectors mock (owner-confirmed) | 2026-10-17 |
| Dev | done | agentTools hook, ToolHandoverError/lookup_failed, ai:tool_call, ai_tool_used chat line, tryAgentReply, tunnelPublicUrls; web agentSections, route section, nav useBadge; docs updated | 2026-10-17 |
| Unit tests | pass | extension-tools, ai-extension-tools, migrate, extensions.test.tsx, AiMemberPage, EventItem (vitest per file) | 2026-10-17 |
| E2E | todo | Main agent: one consolidated npm run e2e | 2026-10-17 |
| Dev Build | todo | Main agent: Enterprise Dev Build with connector testkit (look-up line, lookup_failed hand-over, nav badge) | 2026-10-17 |
| Screen review | todo | Main agent: AI looked up line, lookup_failed reason, agent section row, nav badge at 1280/360 light+dark | 2026-10-17 |

## Log

- 2026-10-17 Design: skip — Extension API only; UI reference is the Enterprise Connectors mock (owner-confirmed)
- 2026-10-17 Dev: done — agentTools hook, ToolHandoverError/lookup_failed, ai:tool_call, ai_tool_used chat line, tryAgentReply, tunnelPublicUrls; web agentSections, route section, nav useBadge; docs updated
- 2026-10-17 Unit tests: pass — extension-tools, ai-extension-tools, migrate, extensions.test.tsx, AiMemberPage, EventItem (vitest per file)
- 2026-10-17 E2E: todo — Main agent: one consolidated npm run e2e
- 2026-10-17 Dev Build: todo — Main agent: Enterprise Dev Build with connector testkit (look-up line, lookup_failed hand-over, nav badge)
- 2026-10-17 Screen review: todo — Main agent: AI looked up line, lookup_failed reason, agent section row, nav badge at 1280/360 light+dark
