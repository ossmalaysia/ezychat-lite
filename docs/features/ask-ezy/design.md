# Ask Ezy (in-app assistant)

Status: **proposal, round 1** (rubric review below). Branch `feat/ask-ezy` from `main` (`f984dfd`).

## Owner request (2026-10-30)

- "add new ask ezy feature where lite and enterprise also have this feature where they can bring up agent and ask
  and configure ezychat, like check my chat history, and suggest improvement of kb and setup for me".
- Example: "check the recent handoff scenario, suggest improvement of knowledge file and handoff rule".
- Changes are **shown first; the admin approves, then they apply**.
- **Admins and team members** can use it; team members see only the chats of their own inboxes.
- First version: **the same tools as the MCP server today** (what Claude or ChatGPT can do over MCP), no new tools
  or skills. List of what MCP does not expose yet: discussed in chat, kept for later.
- **Dynamic UI**: answers draw blocks, not only text. The owner approved the 7 blocks below ("look fine for this 7").
- Goal (2026-10-30, `/goal`): build the mock, **validate it with a rubric score** on usability and other dimensions,
  improve until it meets the rubric, then implement with tests, PR and release.

## Baseline

- Cloned from the owner-confirmed **grammar-fix** mock (`latestConfirmed`, revision
  `4a6cde7762f4aa1c1787896700d1d4c632615fec`), the whole app; its screenshots are not copied (git history keeps them).
- Retention: new feature folder (6th); the oldest, `reports` (creation order 15, last revision on `main` `f984dfd`), is
  pruned in the same change.
- Reused, not changed: the Reports chart parts (`ChartCard`, `RankedBars`, `HoursHeatmap`), `Sheet`, `Button`,
  `Badge`, `Textarea`, the AI-setup versions (`ai_setup_versions`, Undo = restore the version before).
- Reused on the server (implementation): the MCP `ToolDef` list (`mcp/tools.ts`, `mcp/ai-tools.ts`) and its ports
  (`InboxReadPort`, `AiSetupPort`), the agent turn on the Vercel AI SDK (`ai/agent/turn.ts`), the business AI
  connection (`ai/agent/models.ts`).

## Behaviour (proposal)

| Rule            | Default                                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who             | Every signed-in user. Admins: all inboxes + AI setup changes. Team members: only chats of their inboxes (same `inboxes/access.ts` rules as the inbox and MCP), no setup changes ("Only an admin can change the AI agent").                       |
| Entry           | "Ask Ezy" button (bot-in-bubble icon) in the inbox header and the admin header; "Ask Ezy about this chat" in a direct chat's header (opens scoped to that chat and asks for a summary at once).                                                                                   |
| Panel           | Side panel 480 px on desktop, full screen on a phone. Empty: greeting, what Ezy does and does not do, 3–5 suggested questions (different for admins and team members). Conversation: questions right, answers left with blocks, follow-up chips. |
| Model           | The business AI connection (Settings → AI: ChatGPT sign-in, OpenAI or Claude key); the "Model for suggestions" is not used: one agent turn with the MCP tools, up to 6 tool steps. Costs model usage like the AI agent.                           |
| Tools           | The MCP tools the user's role allows: `list_chats`, `get_chat`, `get_messages`, `get_stats`, `get_activity`; admins also `list_ai_agents`, `get_ai_agent_setup`, `get_ai_context_item`, `get_ai_setup_history`, `try_ai_reply`. Never the send tools. |
| Changes         | `update_ai_setup` never writes from Ask Ezy: it returns a **change card** (old/new text, reason). **Apply** (admins) saves it as a normal setup version with an audit row; **Undo** restores the version before; **Discard** drops it.          |
| Blocks          | The model fills typed blocks, never HTML: number cards, bar chart, busy-hours heatmap, chat list, customer summary, change card, test result. Unknown or malformed blocks are dropped (text stays).                                                   |
| Transparency    | Under each answer: "Ezy read: …" (the tools it used, counts only). Footer: "Uses your AI connection. Answers can be wrong."                                                                                                                         |
| States          | Thinking (spinner, Stop), error (Try again), no AI connection (admin: Open Settings → AI; member: ask your admin), stopped.                                                                                                                         |
| Privacy         | The conversation lives only in the open panel (not stored). Log lines: tool names, counts, ms; never questions, answers or customer text. Customer text the tools return is data, never instructions.                                          |

## Rubric (validation gate)

Each dimension is scored 1–5 by a fresh UI/UX reviewer from the screenshots (desktop 1280, phone 360, light/dark)
and this document, with evidence per score; **Jev** (TypeSafe `score`) turns each dimension's evidence into the
number, so the scale stays the same between rounds. **Pass: every dimension ≥ 4 and the average ≥ 4.3.**

**Owner decision (2026-10-30), stop rule:** Jev keeps any dimension with one medium problem near 3, and each fresh
reviewer finds new medium problems, so the Jev gate did not converge after 8 rounds (reviewer levels 4.25, Jev
3.6). Round 9 is the last round: it passes when the review has no high problem and every reviewer level is ≥ 4.
Medium and low problems left after round 9 go to "Follow-ups" below.

| #   | Dimension                       | 5 means                                                                                                       |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Task success and flow           | Each of the owner's tasks (hand-over fix, summary, waiting chats, weekly overview) takes ≤ 2 actions, no dead ends |
| 2   | Discoverability                 | A new user finds the entry and understands what to ask without help                                            |
| 3   | Trust and control               | Nothing changes without Apply; what Ezy read is visible; Undo exists; role limits are clear                     |
| 4   | Feedback and error recovery     | Every state (thinking, error, stopped, no connection) says what happened and offers the next step              |
| 5   | Consistency with Calm Desk      | Tokens, components, spacing, type and wording match neighbouring screens (Reports, Settings → AI)              |
| 6   | Accessibility                   | Labels, focus, live region, 44 px touch targets, contrast in both themes, no colour-only meaning                |
| 7   | Phone (360 px)                  | Full-screen panel, no overflow, readable blocks, thumb-reachable actions                                      |
| 8   | Clarity of content              | Plain words, scannable blocks, numbers with context, no jargon                                                |

## Screens and states (checklist)

`mock/ask-ezy-shots.mjs` (desktop 1280 / mobile 360 touch, light / dark): entry button; empty (admin, member); number
cards; bar chart; heatmap; chat list; change cards; test result; applied with Undo; customer summary from a chat;
thinking; error with Try again; no AI connection (admin); admin entry; member asking for a change.

## Implementation plan

- **Contract** (`packages/shared/src/ask-ezy.ts`): `AskEzyRequest` (question ≤ 2,000 characters, up to 12 earlier turns,
  optional `chatJid`), `AskBlock` (the 7 block types, each zod-checked), `AskEzyAnswer` (`text`, `blocks`, `steps`,
  `followUps`), `AskEzyChange` and the apply/undo/discard results.
- **Server** (`packages/server/src/ask-ezy/`): `tools.ts` turns the MCP `ToolDef`s into AI SDK tools for the
  signed-in user (team members: inbox tools only; admins: plus the read-only AI setup tools; never the send tools);
  `update_ai_setup` is replaced by `propose_ai_setup_change`, which only records a pending change (in memory, per
  user, 30 minutes) and returns its id. `prompt.ts` holds fixed instructions; `service.ts` runs one turn through a
  new provider method `assist` (same three paths as `draft`: OpenAI key, Claude key, ChatGPT sign-in; up to 6 steps,
  60 s bound, no transport retries), validates the blocks (malformed ones dropped) and logs tool names, counts and ms
  only. Routes `POST /api/ask-ezy` (signed in, 20 a minute per user), `POST /api/ask-ezy/changes/:id/apply|discard|undo`
  (admins). Apply saves through `AiService.saveAgent` / the context-text methods with actor `via: 'app'` and the
  reason "Ask Ezy: …", so it gets a setup version and an audit row like a Save; Undo saves the text from before.
- **Web** (`apps/web/src/askezy/`): the panel, blocks and button from the confirmed mock, reading the real routes;
  entry points in the inbox header, the admin layout and the conversation header; `askEzy.*` keys in `en`, `ms`,
  `zh-CN`.
- **Tests**: shared schema tests; server tests with a mock language model (`ai/test`): role filtering (a team member
  never gets AI-setup tools and only sees chats of their inboxes), propose → apply → undo → discard, malformed blocks
  dropped, no connection 409, rate limit, logs without text; web component tests for every block and state; one e2e
  spec (entry, empty state, no AI connection) and the web-client contract test. Tests never call a real model.

## Review rounds

| Round | Reviewer levels (1–8)   | Jev scores (1–8)                                   | Average (Jev) | Gate |
| ----- | ----------------------- | -------------------------------------------------- | ------------- | ---- |
| 1     | 4, 3, 4, 3, 3, 3, 3, 4  | 2.93, 2.09, 2.87, 2.11, 2.65, 2.21, 2.56, 3.03     | 2.56          | fail |
| 2     | 4, 4, 4, 4, 4, 4, 4, 4  | 1.48, 3.07, 3.01, 1.91, 3.08, 3.01, 2.99, 3.17     | 2.71          | fail |
| 3     | 4, 4, 4, 4, 4, 4, 4, 4  | 3.18, 3.01, 3.05, 3.98, 3.98, 3.93, 3.01, 3.10     | 3.40          | fail |
| 4     | 4, 4, 4, 5, 4, 4, 4, 4  | 3.05, 3.02, 3.01, 4.03, 3.94, 3.06, 3.05, 3.07     | 3.28          | fail |
| 5     | 4, 4, 4, 5, 4, 4, 4, 4  | 3.04, 3.01, 3.03, 4.04, 3.98, 3.12, 3.03, 3.08     | 3.29          | fail |
| 6     | 4, 4, 5, 4, 4, 4, 4, 4  | 2.96, 3.06, 4.03, 3.00, 3.99, 3.99, 2.96, 3.99     | 3.50          | fail |
| 7     | 4, 4, 5, 5, 4, 4, 4, 4  | 3.01, 3.02, 4.02, 4.02, 3.98, 3.16, 3.93, 4.00     | 3.64          | fail |
| 8     | 5, 4, 4, 5, 4, 4, 4, 4  | 4.00, 3.04, 2.95, 3.95, 3.96, 3.00, 4.00, 3.99     | 3.61          | fail |
| 9     | 4, 4, 5, 5, 4, 4, 5, 4  | 3.18, 3.98, 4.01, 4.01, 3.98, 4.00, 4.96, 4.00     | 4.01          | **pass (stop rule)** |

**Round 1 → 2 changes** (from the review's problems):

- No AI connection: checked when the panel opens; an info `Banner` replaces the starters and the box is disabled
  (admin: Open Settings → AI; member: ask your admin). Errors use a warning `Banner` (Calm Desk keeps red for
  irreversible actions) with one message and next step per code: provider error, timeout, expired sign-in, too
  many questions; "Stopped. Nothing was changed." with Ask again.
- Entry: labelled "✨ Ask Ezy" in the inbox header (the Admin button is icon-only on phones to make room); on admin
  pages an outline button under the "Admin" title, apart from the page list; the chat-header button has its own
  screenshot.
- Progress: the answer is streamed (NDJSON): a line per tool Ezy uses ("Read hand-overs (7 days, 9 chats)") while it
  works; Stop is a labelled button; a hidden status region announces "Answer ready" instead of a live list.
- Busy hours: the three busiest times as text on every screen size; on wider screens a simple grid for the eye only
  (`aria-hidden`), legend "Darker = more new conversations". No hover-only values.
- Changes: each change card says what and where ("Adds 1 line · Business context · AI agent Aina"), marks lines
  with visible "+ Added" / "− Removed" badges, hides unchanged lines behind "1 line stays the same", and carries its
  own test (Now / After the change). "Apply all 2" above the cards; Discarded → "Show again"; an Apply conflict shows
  "Not applied: the setup changed since Ezy read it". Apply's result stays in the card next to Undo instead of a toast
  (the toast covered the panel header and Close on phones).
- Content: deltas always say "vs last week", values have units ("Chats answered by AI"), "Waiting" shows the longest
  wait; "Ezy read:" lists nouns with counts; the customer card shows only facts the tools return (first message,
  message count, tags, assignee), never order counts; member placeholder and starter ("Summarise my latest chat").
- Phone: subtitle hidden below 640 px, short footer, a new answer scrolls to its first line.
- Not changed: dark-mode Apply contrast was flagged as a doubt; the tokens are `#04201d` on `#14b8a6` (about 8:1).

**Round 2 → 3 changes:** a conflict replaces Apply with a primary "Ask again" (and Discard), and the panel scrolls
to the card's result row; "Copy answer" (team members: "Copy for your admin"); test columns say "Before the change"
/ "After the change"; follow-ups match the block ("Summarise Priya Nair"); "Apply both changes" is outline with a
one-line summary of what changes; the customer summary is built only from what the chat shows; fixed version
numbers; a setup-first view without an AI connection (no greeting, no starters, input off); warning and info
messages put their buttons under the text; "Working…" while Ezy works; heatmap legend "Stronger colour", hour
labels and short counts; clearer change titles and rules ("If an order is more than 2 days late, ask for the
order number, then hand over to the team.").

**Round 3 → 4 changes:** "Apply both changes" above the cards; tests in change cards start folded on phones; a
bot-in-bubble icon for every Ask Ezy entry (the question-mark circle read as Help); only grounded next steps
and busy-hours claims; "Edit question" after a timeout; finished steps stay visible after Stop; "Setup history"
link next to "saved as version N"; sentence-case labels; "Ezy read" in 14 px.

**Round 4 → 5 changes:** "New conversation" asks first when proposed or undoable changes would be lost; the
folded test and "lines stay the same" toggles are 44 px rows with a chevron; busy-hours text states ties; member
answers name their inboxes; phone entries carry a visible label; follow-ups point to the next useful step instead
of repeating the last one; only Apply is a filled button; one term per idea ("AI agent", "last 7 days").

**Round 5 → 6 changes:** the proposed rule now matches its test ("hand off to the team with the order number
the customer gave"); the composer entry says "Summarise chat" (its own name, separate from the global "Ask Ezy"
button) with "Ask Ezy about this chat" as its accessible name; the admin phone top bar uses the compact button so
the title is not cut; "Questions answered" carries a note that a chat can have several questions; the before/after
test uses an English question; a Farah follow-up drafts a reply to copy (never sent); "Check Settings → AI" is an
outline button; "Try one" is sentence case; Copy sits on its own right-aligned row; chat rows show a chevron; the
heatmap legend starts with "Each row is a day of the week"; the no-connection view says what Ezy does first;
"hand-over" becomes "hand-off" everywhere.

**Round 6 → 7 changes:** from 1024 px the panel docks beside the page (no overlay; the page makes room), so the
chat it summarises stays usable; Settings links open Settings → AI; every Ask Ezy entry uses the bot-in-bubble
icon; the text box takes focus on open only with a mouse (a phone keyboard no longer covers the starters); the
composer entry is "Summarise with Ezy", icon only on phones so it stays on the composer row; heatmap labels are
12 px; the follow-up that repeated the card's test is gone.

**Round 7 → 8 changes:** the panel docks only from 1280 px and is 400 px wide there (the chat keeps about 520 px;
below 1280 px it opens over the page); the composer entry shows "Ezy" on phones and "Summarise with Ezy" on wider
screens, with the visible text inside its accessible name, and the composer tools fit one row at 360 px; a scoped
chat summary has "Back to chat" below 1280 px; "Apply both changes" comes after the cards; the header action is
"Start over" (so "conversation" stays the customer's); the test disclosure is "Test: before and after"; the live
region reads the answer's first sentence; "hand off" is the one term in every text.

**Round 8 → 9 changes:** no promise of a setup-history screen the app does not have: an applied card says
"Applied to Aina's setup. Undo stays here until you start over." and links to the AI agent page, and the
Start-over dialog says applied changes are edited there afterwards (no "version N" shown); Apply, Discard and
Undo move focus to the card's title instead of the page top; the in-chat entry on phones reads "Ask Ezy"
("about this chat" for screen readers) and the three composer tools fit one row at 360 px; the stat change
says "better" or "worse" in words, not only in colour; the Start-over dialog button is "Start over"; the test
answer uses the same question as the change card.

**Round 9 result:** no high problem, every reviewer level ≥ 4 (average 4.4): the stop rule passes. Its one medium
problem was fixed without a new round: a team member who asks for an improvement now gets a short message to send
to their admin (prompt rule for members, scripted in the mock, tested in `ask-ezy-prompt.test.ts`).

## Follow-ups (after round 9)

- Phone admin header: the Ask Ezy entry is icon only (a label does not fit beside the page title).
- "Undo stays here until you start over" is also lost on a page reload; keep proposed and applied changes for
  the session, or say "until you close or start over".
- Phone: "Ezy read" and the folded test sit below "Apply both changes".
- Enter while Ezy works does nothing; show "Wait for the answer or press Stop".
- The card title that takes focus after Apply shows no focus ring.
- Phone Start-over confirmation is a centred dialog, not a bottom drawer; its icon reads as "new message".
- Change sub-line ("Adds 1 line · Business context · Delivery areas · Aina") is dense.
- Customer summary fact chips look like tags.
- Mock only: fixed change ids make "Ask again" after a conflict show "Not applied" again.
