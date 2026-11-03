# Group agents: several AI agents per number, sheet tabs per agent

Status: **design proposal, not yet confirmed by the owner**. The HTML mock is still owed (see "Mock and
confirmation"). Created 2026-11-03 (creationOrder 28). Branch `claude/determined-feynman-y5uo0g` from `main`
(`1564247`).

## Owner request (2026-11-03)

- "on google sheet connector, can we allow user to define recording like? capture the claim information into
  google sheet?"
- "the instruction should be on agent, connector only control what tab available to use, and now we need allow
  create diff agent to handle diff group chat in enterprise, so that we can allow business to easily create claim
  recording agent, type basic instruction, add gsheet connector and choose the tab for custom use and disable
  other lead, product use, and we define the agent like when receive claim in these format capture it and save
  into tab {tab name} in google sheet".
- Owner answers (2026-11-03):
  1. In a group the claim agent reads **every** member message (not only when tagged or quoted).
  2. No reply setting: whether and how the agent confirms in the group is written in the agent's instructions.
  3. Lite keeps **1** AI agent; Enterprise sets its own agent limit, independent of the number of inboxes.

## Target journey (Enterprise)

1. Admin → Members → **New AI agent** → preset Custom, name "Claims agent", instructions:
   "When a member posts a claim in this format (Policy no, Date, What happened, Amount), save it to the tab
   **Claims**. Reply 'Recorded ✅' quoting the message. If a detail is missing, ask for it."
2. Agent page: **Direct chats** off, **Groups** on.
3. Connectors → Google Sheets → Settings → agent "Claims agent": choose the spreadsheet, tab **Claims** = Add
   rows, every other tab Off (Products, Leads).
4. Group info of each claims group: **AI agent** = Claims agent, **Reads every message** on.
5. A member posts a claim → the agent saves one row to Claims and replies as its instructions say.

## Part A: Google Sheets gives tab access, the agent has the instructions

| Rule      | Proposal                                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings  | Per agent: one spreadsheet (unchanged) and a list of its tabs, each **Off**, **Read** or **Add rows**. Replaces `lookupTab`/`lookup`/`leadsTab`/`addLeads` in the JSON `sheets_agent_settings.settings` (no table change).                                                                                                    |
| Upgrade   | Permanent start-up code maps the old fields: `lookupTab` + `lookup` → Read, `leadsTab` + `addLeads` → Add rows. An agent that used Add leads gets one line appended to its saved instructions only if it has none about the sheet: "Add customers who want to buy to the tab {leadsTab}." (audited, kept as a setup version). |
| Tools     | `read_sheet_rows {tab, query}` and `add_sheet_row {tab, values: {column: value}}`. Their descriptions list only this agent's tabs for that access, each with its column names (first row, read when the turn starts, cached 5 min). No tab on Add rows = no `add_sheet_row`; same for Read.                                   |
| Columns   | Values are matched to the tab's first-row names (case and spacing ignored); unknown names are refused with the list of valid ones. Columns named Date, Name, WhatsApp, AI agent are filled by EzyChat (business time zone, saved/WhatsApp name, the sender's number, agent name) unless the AI passes a value.                |
| Empty tab | Add rows needs a first row; Settings shows "Add column names in the first row of this tab" and the tool is not offered for it.                                                                                                                                                                                                |
| Guards    | Values written with `valueInputOption=RAW`. Every value the AI passes (other than auto columns) must appear in a message of the person it records for (the customer in a direct chat, the member in a group; spacing/case ignored, numbers and dates normalised); else refused with "ask the person for it". Never in Try it. |
| Limit     | At most 20 rows a chat a day per tab, and the same row (same values) never twice in a day (idempotent key: chat, tab, message id). Replaces the one-lead-a-day rule. Migration adds `tab` and `message_id` to `sheets_leads` (renamed in code to sheet rows).                                                                 |
| Prompt    | No sheet text in `CORE_RULES` (unchanged connector-neutral rule). The tool descriptions carry the tabs; the agent's instructions say when to use them.                                                                                                                                                                        |
| Logs      | Activity: who, when, agent, tab, `row_added` / `looked_up` / `failed`; never values. Log lines: tool, tab count, ok, ms.                                                                                                                                                                                                      |
| Presets   | The Sales preset text gets "Add buyers to the leads tab when one is available" so new sales agents keep today's behaviour.                                                                                                                                                                                                    |

## Part B: several agents per WhatsApp number (Enterprise)

| Rule                | Proposal                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Limit               | `runCli({ maxAgents })` separate from `maxInboxes` (default `maxInboxes`, so Lite stays 1 and nothing changes without the option). Enterprise passes its own number. 409 `agent_limit` unchanged.                                                                                               |
| Direct chats        | Still at most **one** agent per inbox answers direct chats (the agent with Direct chats on). 409 `inbox_has_direct_agent` replaces `inbox_has_agent` for a second one; any number of group-only agents per inbox.                                                                               |
| Groups              | `ai_group_chats` gains `agent_id` (migration). Group info → AI: switch **On** + **AI agent** select (agents of this inbox with Groups on). Existing rows get the inbox's current agent. `agentForChat` for a group = its row's agent; direct chat = the inbox's direct agent.                   |
| Reads every message | `ai_group_chats.listen` (default off). Off = today's rule (tag or quote). On = every live member message of that group starts a turn of that group's agent. The turn may end with `no_reply` (nothing sent). Only live messages, never history, never the linked number's own or an AI message. |
| Writes in groups    | Today a group turn is look-ups only. New: a group turn may use `add_sheet_row` (only this tool; booking and connector writes stay off in groups). Values must come from the message's sender. Group hand-over unchanged.                                                                        |
| Cost guard          | Listen mode: bursts in one group are batched (a turn starts 8 s after the last message, sees all new ones); at most 300 turns a day per group, then a paused line for admins (not in the group). The existing 10-message loop guard still applies.                                              |
| Assign / release    | Removing an agent, turning its Groups off or deleting it turns its groups' AI off (rows kept, agent cleared), never moves them to another agent.                                                                                                                                                |
| Routes              | `PUT /api/chats/:jid/ai-group` {enabled, agentId?, listen?}; `GET` adds `agentId`, `listen`, `agents` (choices). Old body {enabled} keeps working (agent = the only group agent of the inbox, else 400 `agent_required`).                                                                       |
| Audit               | `ai.group_switch` adds agentId and listen before/after.                                                                                                                                                                                                                                         |

## Screens (mock checklist)

1. Admin → Members: two AI agents on one inbox (Sales: direct chats; Claims: groups only), New AI agent allowed
   until the edition's limit; Lite at its limit shows the existing upgrade hint.
2. Agent page Direct chats card: switching on for a second agent of the inbox → error "Sales agent already
   answers direct chats on this number".
3. Google Sheets → Settings per agent: spreadsheet, tab list (Off / Read / Add rows), column names under each tab,
   empty-first-row warning, a tab Google no longer lists, Claims agent with only Claims on Add rows.
4. Agent page → Connectors row: "Reads Products · Adds rows to Claims".
5. Group info: AI switch, AI agent select (one / several / none with Groups on), Reads every message switch with
   InfoTip, daily cap reached note.
6. Group chat: member posts a claim → AI reply per instructions ("Recorded ✅"), missing-detail question, a
   chat message that is not a claim (no reply).
7. Activity tab: row added to Claims, failed (value not in the message).
8. Desktop 1280 / mobile 360, light and dark; en, ms, zh-CN.

## Baseline

Clone of the latest confirmed mock `docs/features/group-mentions/mock` at `f6f0d2b06f53c95c6b31c5994af00ef52cf5def4`
plus the screens of `whatsapp-safety` and `message-edit-delete` (index note), and the Google Sheets screens built
in `apps/web/src/admin/connectors/` (`SheetsSettingsCard.tsx`, no confirmed mock yet). Reused: agent page cards
(`AiMemberPage.tsx`: Direct chats, Groups, Connectors), Group info AI switch (ai-groups), `ConfirmDialog`, `SaveBar`.

Retention: 6th folder; `ai-direct-chats` (creationOrder 23, confirmed, last revision on `main` `1564247`) is
pruned in the same change.

## Open points (my calls, easy to change)

1. Sheet values are checked against the sender's own messages; a member posting a claim for someone else is
   fine as long as the values are in that member's message.
2. Batch window 8 s and 300 turns a day per listening group.
3. Several agents per inbox and listen mode are core code; only the limit comes from the edition, so Lite with
   its 1 agent can also use listen mode in a group.

## Build plan (after confirmation)

1. Shared: `SheetsAgentSettings.tabs`, `AiGroupChat.agentId/listen`, `maxAgents` in health/edition info.
2. Server: start-up settings mapping; `add_sheet_row`/`read_sheet_rows` with tab + columns; guards; migration 031
   (`ai_group_chats.agent_id`, `listen`; sheet row log `tab`, `message_id`); `runCli({ maxAgents })`;
   direct-agent rule; group routing by `agent_id`; listen batching and cap; upgrade test seed.
3. Web: Sheets tab list, Group info agent select + listen switch, agent errors; en/ms/zh-CN.
4. Enterprise: pass `maxAgents` (separate PR after the core release).

## Mock and confirmation

Not done yet: the cumulative HTML mock and the owner's confirmation.
