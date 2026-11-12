# Workbook: feat/ai-silent-line

Branch: `feat/ai-silent-line` · Every agent updates its stage with
`node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits it with the work.

| Stage | Status | Detail | Commit | Updated |
| --- | --- | --- | --- | --- |
| Design | pass | Owner chose design notes + screenshots instead of a full HTML mock (2026-11-12); every silent turn in direct chats | 470b5e5 | 2026-11-12 |
| Dev | todo |  |  |  |
| Unit tests | todo |  |  |  |
| E2E | todo |  |  |  |
| Dev Build | todo |  |  |  |
| Screen review | todo |  |  |  |

## Design

**Problem.** In a live Enterprise chat (2026-11-12) a customer answered "ya" to the AI's own either/or
question and got no reply. The agent chose `no_reply` (its "Short replies" rule) or a `resolve` that the
off resolution check turned into silence (`resolution.ts#withoutResolution`). The team saw nothing: no
message, no line, no notification, and the AI still held the chat.

**Change.** When a direct-chat turn ends in `no_reply`, the server writes one team-only chat line
(`ai_tool_used` event, actor = the agent's AI user, payload `silent: { kind }`):

| kind | When | English line |
| --- | --- | --- |
| `no_reply` | the model chose `no_reply` (e.g. "ok", "thanks", or a rule like the one above) | "Sales Agent did not reply" |
| `finished` | the model chose `resolve` / `ask_resolution` and the agent's resolution check is off | "Sales Agent did not reply: it saw the chat as finished" |

- Owner decisions (2026-11-12): every silent turn in direct chats, not only suspicious ones; design notes
  + screenshots instead of a full HTML mock (as for mcp-file-upload).
- Not written: in groups (a "Reads every message" agent is silent on most messages), after the thumbs-up
  close (that close shows its own resolved line), when the AI no longer owns the chat.
- Reuses the existing centered event chip (`EventItem`, `bg-muted text-muted-foreground`): no new
  token or component, so `docs/design-system.md` is unchanged.
- Customers never see chat events. No migration: `ai_tool_used` already exists; queries that look at
  chat events skip the AI's own events (`service.ts` teammate-acted check), so the line changes no AI
  decision. Server and web ship in the same build; a web build cached from before this change shows
  the generic "AI looked up Sales Agent · WhatsApp" text for these lines until it refreshes.
- MCP `get_chat` lists the assignment history only, so it does not show these lines (unchanged).
- Lite merge: `chat_events` rows are already copied as they are.

## Log

- 2026-11-12 Design: pass — Owner chose design notes + screenshots instead of a full HTML mock (2026-11-12); every silent turn in direct chats (470b5e5)
