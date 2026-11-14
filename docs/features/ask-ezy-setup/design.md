# Ask Ezy sets up agents and scheduled tasks

Status: **confirmed by the owner on 2026-11-12** ("look good, implement", on the quick mock page).
Branch: `feat/ask-ezy-setup`. Requested by the owner on 2026-11-12: "i want to create new agent that greeting to
jee fong at 9am every day", and "ask ezy should support multi turn to aware user need to setup agent or update agent".

## Owner decisions (2026-11-12)

1. Ask Ezy proposes a **scheduled task**; when the user asks for a **new agent** and the edition allows one, it first
   proposes a **new agent**. In Lite (1 agent) it says so and offers the task on the existing agent.
2. Ask Ezy works as a **conversation**: before it proposes, it asks what it needs (new or existing agent, which chat,
   time, days), one question at a time, and it can **update** an existing agent or task the same way.
3. Review: screenshots of a quick mock, not a full app clone (as for chat-hide-delete).

## What exists (reused)

- Ask Ezy (`docs/features/ask-ezy/design.md`): `POST /api/ask-ezy` streams `step` / `answer`; 12 earlier text turns go
  back to the model (`ASK_EZY_HISTORY_TURNS`, panel memory only). Admins get `propose_ai_setup_change`: a change is
  held in memory (`ask-ezy/changes.ts`, 30 min, 20 per user) and saved only by `POST /api/ask-ezy/changes/:id/apply`
  (admins), with Undo. Blocks: stats, bars, heatmap, chats, customer, change, test.
- Scheduled tasks (`docs/features/scheduled-tasks/design.md`): `ScheduledTaskBody` {name, time, dayRule, days, chatJid,
  instruction}, ≤ 10 per agent, one existing chat or group of the agent's inbox, preview (`AiService.scheduledTurn`,
  nothing sent).
- Agents: `maxAgents` from the edition (Lite 1, 409 `agent_limit`), presets sales / faq / custom.

## The conversation

Ezy never guesses a missing or ambiguous detail. It asks **one** short question and offers choices the user taps
(a new `question` block; a tap sends the choice as the next user turn). Examples for "greet Jee Fong at 9am every
day":

| Unclear                    | Ezy asks                                                                 | Choices                                                                       |
| -------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| New or existing agent      | "Use Sales Agent, or create a new agent for this?"                       | Sales Agent · New agent · (Lite: only Sales Agent, with "Lite has one agent") |
| Two chats match "Jee Fong" | "Which Jee Fong?"                                                        | Jee Fong (…0084) · Jee Fong Lim (…5521)                                       |
| No chat matches            | "I can't find a chat named Jee Fong. Which chat?"                        | the 3 closest names · "Not in the list"                                       |
| Time zone unclear          | never asked: the business time zone (`ai_timezone`) is shown on the card |

When everything is known it proposes. Updates work the same way: "move Jee Fong's greeting to 8:30" finds the task,
and proposes an edit card that shows before → after.

## New proposals (admins only, held like today's changes)

- `propose_agent` {name, preset, inboxId, instructions?}: card "New agent" (name, type, number, what it will do). Apply
  creates it **switched off** (`saveMember` path, audit as the app does); the agent limit is checked when proposing
  (refused with the Lite text) and again on Apply (409 `agent_limit`).
- `propose_scheduled_task` {agentId | the pending new agent, chat, name, time, dayRule, days, instruction} and
  `propose_scheduled_task_edit` {taskId, changed fields}: card "Scheduled task" (agent, send to, when with the
  business time zone, instruction, and a **Preview** of the message from `scheduledTurn`, nothing sent). Apply calls
  the normal scheduled-task create/update service (same limits, 400 `chat_not_in_inbox`, ≤ 10 per agent). A task card
  that depends on a pending new agent can be applied only after the agent card (one **Apply both** button when both
  are shown together).
- The model never sees or sends raw ids it invented: chats come from a `find_chats` look-up the user may open, the
  server keeps the chosen chat key in the held proposal, and Apply reads only the held proposal.
- Undo: removes the created task or agent (agent: only while it has no chats and is still off).

## Not in scope

- Turning the new agent on (stays an admin switch on the agent page; the card says so).
- Sending a message now, or to a number that has no chat (scheduled tasks never start a chat).
- Business context files for a new agent (text only, like today).

## Implementation notes (2026-11-12)

Deviations from the text above and the mock, decided while building:

- **No `find_chats` tool.** The model looks chats up with the existing `list_chats` (query = the name). The server keeps
  the chat ids `list_chats` / `get_chat` returned in the same answer, and a task proposal may name only one of those
  (plus `canOpenChat` and "on the agent's number"). After a tapped choice, the next turn looks the chat up again.
- **`list_scheduled_tasks`** (admins) is new: an edit needs the task id, and history carries only text.
- **The question block has an optional `note` + `tone`** (warning / error) for the Lite text (state 5) and the
  "other number" error (state 7); the model writes the note from the tool error.
- **The task card carries time, day rule and days**, not a "when" sentence: the page writes it in the person's
  language with the Scheduled tasks card's own format ("Every day · 9:00").
- **Preview of a pending new agent** (state 3): a draft turn (`scheduledTurn` with `draft`: the proposed name,
  preset texts and instructions, no business context, no look-ups); nothing is stored or sent. Proposal previews
  have their own limit (10 a minute per admin), not the agent page's 20, and stop with the Ask Ezy request.
- **Chats without a name** are never shown by their number: the card says "Chat …6789" (last 4 digits).
- **Undo is careful (code review 2026-11-12):** a task edited on the agent page since Apply, or a new agent the
  admin changed since Apply (texts, items, groups, connectors, any `agent_id` row), is not undone (409
  `setup_changed`). In Lite (one agent) Undo never deletes the new agent: the task goes, the agent card says it
  stays, switched off. Undo of a new agent discards the task proposals still waiting for it.
- **"Apply both" failed half-way:** the agent card stands alone (Applied, its own Undo, "Open the agent"); a retried
  task Apply re-checks that the agent still exists (409 `agent_gone`).
- **History:** the panel adds one line per question and card (`[Asked: … Choices: …]`, `[New agent card …,
agentProposalId …]`) to the assistant's text, so a tapped choice answers that question. The server trusts none of
  it: proposals are read only from its own store by id.
- **"Apply both"** is one request to the task's Apply; the server creates the agent first. If the task then fails,
  the answer is 200 with `failed` and the agent stays (it is off); the task card says why. While the task stands applied
  with its new agent, the agent card has no Undo of its own: the task's Undo removes both.
- "Open scheduled tasks" goes to `/admin/members/ai/:agentId#scheduled-tasks`; the card scrolls into view.

### After the owner's real-model test (2026-11-12)

The owner tested with `gpt-6-luna` (the fast model) and got an unusable "New AI agent" with the FAQ help-desk text
and no task. Owner-chosen fixes:

- **Setup runs on the main model.** A normal admin turn (fast model) offers only `start_setup`; calling it reruns the
  same request (same history) on the connection's saved model with the setup rules and tools. Normal questions stay
  fast. Team members never get it.
- **A new agent is written by the server**: always preset `custom`, "Answer direct chats" off, its role text from the
  required `purpose` (what it sends, to whom, when; that it does not answer chats; the presets' language rules);
  `instructions` only adds detail. Generic names ("New AI agent", "Assistant", "Agent 2") and an existing agent's
  name are refused with a hint ("Morning greeter").
- **A new agent comes only with its task** (chosen over "refuse propose_agent", because the server can check the whole
  answer): an agent card without a task card that needs it is dropped and a note asks what it should send; the route
  refuses Apply of an agent proposal (409 `agent_needs_task`); the panel shows no Apply on an agent card.
- **The agent-limit sentence uses the real limit**: Lite with one agent keeps the mock's text; otherwise "This EzyChat
  allows N AI agents and all are in use, so I can't add a new one."
- **Time limits:** a preview gets 20 s (then the card comes without it: "The preview took too long…"); a whole turn
  gets 90 s (fast) or 150 s (setup), then `ai_timeout` (a turn once hung for over 5 minutes with no log line).
- **Prompt:** before any proposal the agent, the chat and the time/days must be explicit; one question = one unknown,
  agent first, then chat, then time; never a choice like "I'll clarify".

## Screens (quick mock)

Ask Ezy panel, desktop 1280 and phone 360, light and dark: (1) the question with choices (new or existing agent);
(2) "Which Jee Fong?"; (3) the New agent card + Scheduled task card with Apply both; (4) applied (with links "Open
agent", "Open scheduled tasks"); (5) Lite: one agent only; (6) edit card 09:00 → 08:30; (7) error: the chat is not in the
agent's number.
