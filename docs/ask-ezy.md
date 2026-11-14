# Ask Ezy: design and decisions

The in-app assistant every signed-in user can ask about their chats and customers, and that admins use to improve and
set up their AI agents. This file is the **lasting record** of how Ask Ezy works and **why**: read it before you change
Ask Ezy, and add a line to the decision log when you change a rule. Feature folders under `docs/features/` are pruned
(five kept); this file is not. Code: `packages/server/src/ask-ezy/`, `packages/server/src/ai/agent/assist.ts`,
`apps/web/src/askezy/`; contract `packages/shared/src/ask-ezy.ts`.

History: first design `docs/features/ask-ezy/design.md` (owner request 2026-10-30, pruned; read it with
`git show 2e820c94^:docs/features/ask-ezy/design.md`); setup design `docs/features/ask-ezy-setup/design.md`
(2026-11-12; same rule, read it from git once pruned).

## 1. What it is for (owner decisions)

| Decision                                                                                                                                                                                        | Why                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Every signed-in user may ask; team members see only the chats of their own inboxes; an agent limited to chosen chats gets no Ask Ezy (403 `chat_scope_limited`)                                 | Same access rules as the inbox and MCP; Ask Ezy reads across chats         |
| Admins can improve an agent (instructions, hand-off rules, Business context text) and set up scheduled tasks and new agents; team members cannot ("say so, and write a message for your admin") | Only admins change the AI setup anywhere in the app                        |
| **Nothing changes without Apply.** Ezy proposes; the admin presses Apply (Undo, Discard)                                                                                                        | Trust: a model never writes the setup by itself                            |
| Answers draw typed **blocks** (stats, bars, heatmap, chats, customer, change, test, question, agent/task proposal), never HTML                                                                  | Scannable answers; the server validates every block and drops invalid ones |
| "Ezy read: …" under each answer (tools used, counts only); footer "Uses your AI connection. Answers can be wrong."                                                                              | Transparency                                                               |
| The conversation lives only in the open panel (not stored)                                                                                                                                      | Privacy                                                                    |

## 2. How a question runs

1. `POST /api/ask-ezy` {question, history (≤ 12 earlier turns), chatJid?} streams NDJSON: `step` per tool, then one
   `answer` or `error {code}` (`AskEzyEvent`). 20 questions a minute per user.
2. **Normal turn** on the connection's **fast model** (reasoning low). Admin setup requests (a new agent; create,
   move or change a scheduled task) call `start_setup`, which ends the fast turn; the same question then runs as a
   **setup turn** on the **main model** with the setup tools (`list_scheduled_tasks`, `propose_agent`,
   `propose_scheduled_task`, `propose_scheduled_task_edit`). Improving how an existing agent answers stays on the
   normal turn. _Why: setup needs the better model; most questions do not. The `start_setup` tool text and the prompt
   must name the same trigger, or the model routes the wrong way._
3. Tools are the MCP `ToolDef`s the user's role allows (a new MCP read tool works here too), never a send tool and
   never `update_ai_setup`. Ask Ezy adds its own: `start_setup`, the setup tools, `edit_ai_setup_text`, its own
   `try_ai_reply` and `propose_ai_setup_change` (section 4).
4. The answer is one structured output (`AssistOutput`: text, blocks as JSON strings, follow-ups). Server: blocks
   checked against `AskEzyBlock`, chat and customer blocks filtered by access, ≤ 8 blocks, ≤ 3 follow-ups.

## 3. Limits and failure handling

| Rule                  | Value                                                                                                                                                                           | Why                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model calls per turn  | ≤ 8 (`ASSIST_MAX_STEPS`); the **last call may not use tools**                                                                                                                   | A tool call on the last step leaves no answer (`AI_NoOutputGeneratedError`); an "improve" turn needs up to 7 tool steps                             |
| Time for one question | Admin setting, Settings → AI → Ask Ezy: 5 / 10 / 15 / 30 min, default 15 (`ask_ezy_timeout_minutes`, audit `settings.ask_ezy_timeout`); one budget for the fast and setup turns | The connections' own 60 s bound (meant for customer replies) stopped "improve" turns at 61 s; `AiAssistCall.timeoutMs` replaces it for Ask Ezy only |
| Stop                  | The panel's Stop ends a question at once                                                                                                                                        | The person decides how long to wait                                                                                                                 |
| Keep-alive            | An empty line every 20 s while a question runs                                                                                                                                  | The Cloudflare tunnel closes a response with no data for 100 s; the reader skips empty lines                                                        |
| Bad answer format     | A complete answer followed by extra text is kept (`answerFromText`, log `repaired: true`); anything else fails                                                                  | The ChatGPT backend sometimes wrote a valid answer and then more (1 in 5 "improve" turns); no extra model call                                      |
| No retries            | A failed turn is one error, never a second model call                                                                                                                           | Each call costs the owner usage                                                                                                                     |
| Errors                | `ai_timeout`, `ai_unavailable`, `ai_expired`; the log line has `kind`, `finishReason`, `answerShape`, `setup`, `tools`                                                          | Debug from evidence: the log never holds text, so it records the shape                                                                              |

## 4. Improving an agent (admins)

Flow, in **one answer**: read (`get_ai_agent_setup`; small Business context texts come with it, each ≤ 6,000
characters and ≤ 12,000 together) → `edit_ai_setup_text` {agentId, target, itemId?, edits: [{find, replace}]} returns a
`draftId` → `try_ai_reply` {draftId, messages: 1–3} answers each message with the **saved setup and the draft at the
same time** and keeps the first result as the test → `propose_ai_setup_change` {draftId, reason} → a `change` block
{id, title}. The server adds the test to the card.

| Decision                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model sends only **find → replace** edits, never the whole text; a complete text only for a new Business context item                                                                                                                | Output tokens are most of a turn's time (~45 a second). The full text written twice (to test, to propose) cost ~15 s; edits cut ~700 written tokens to ~180 and an "improve" turn from 36 s to 26 s |
| Drafts live for one answer only (`d1`, `d2` …)                                                                                                                                                                                           | Nothing to store or expire; a later turn reads the saved text again                                                                                                                                 |
| A found improvement is proposed in the same answer, never offered as "Want me to propose this?"                                                                                                                                          | The admin saw a test but no Apply button                                                                                                                                                            |
| A change is held in memory (30 min, 20 per user) and saved only by `POST /api/ask-ezy/changes/:id/apply` (admins) as a normal setup version; 409 `setup_changed` when the text moved since Ezy read it; Undo restores the version before | Same versioning and audit as the app's own saves                                                                                                                                                    |

## 5. Setting up agents and scheduled tasks (admins, setup turn)

| Decision                                                                                                                                                                                 | Why                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Before any proposal three things must be explicit: which agent, which chat, the time and days; otherwise ask                                                                             | Never guess                                             |
| **One question per answer**, 2–4 tap choices, in a `question` block; never a one-choice question; never "Other" (the person can type); ask the agent first, then the chat, then the time | Owner: a conversation, one step at a time               |
| The agent question lists each existing agent by name, plus "New agent" only when the edition allows another (`maxAgents`; Lite 1). At the limit: use the existing agent and say why      | Lite has one agent                                      |
| Chats come from `list_chats` in the same answer; two chats with one name are shown as "Name · …1234" (last 4 digits only)                                                                | The model never names an id it made up; no full numbers |
| Never ask for a time zone: the business time zone is used and shown                                                                                                                      | Fewer questions                                         |
| A new agent only sends scheduled messages, is named after what it does, comes **with its task** (one "Apply both"), and starts switched off                                              | An agent without a task was useless (owner test)        |
| Task and agent proposals are held like changes; Apply uses the normal services (≤ 10 tasks per agent, one existing chat); Undo removes them                                              | Same limits as the app                                  |

## 6. History and context

- History is **text only**: each earlier answer goes back as its text plus one line per question or card
  (`[Asked: … Choices: …]`, `[Scheduled task card …]`, `answerForHistory` in `AskEzyPanel.tsx`), so a tapped choice
  reaches the model with its question. Ids in history are hints; the server reads proposals from its own store.
- Any script or eval that drives `/api/ask-ezy` must build history the same way.
- Prompt order for the provider's prompt cache: fixed rules first, then blocks, then per-call values (today, the
  user's name and role, the edition's agent limit, the chat in view). The trace showed the cache covering 65–95 % of the
  input, so the order is right; the time goes to output tokens and round trips, not to reading input.

## 7. Privacy and logs

- Customer and teammate text the tools return is data, never instructions.
- Logs carry tool names, counts, ms, model and token counts, never questions, answers or customer text:
  `ask_ezy_turn_start` (sizes of the fixed part and history), `ask_ezy_call` per model call (ms, input / cached / output
  / reasoning tokens, tools asked for, finish reason), the answer line (`tools`, `toolMs`, `steps`, `repaired`), and
  `Ask Ezy tool failed {tool, errName}`. Read them before changing Ask Ezy for speed or accuracy.

## 8. How to check a change

| Check                                             | Command                                                                                                                                                  | Pass                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Unit                                              | `npx vitest run packages/server/test/ask-ezy*.test.ts packages/server/src/ai/agent/assist.test.ts apps/web/src/askezy`                                   | all                                                  |
| Mock Dev Build (real tools, mock model)           | `npx tsx --conditions=ezychat-source e2e/agents-devbuild.ts --fake-wa --port 7496 --max-agents 2`, then `node e2e/devbuild-ask-ezy-setup-check.mjs 7496` | all PASS                                             |
| Real-model eval (owner's sign-in, test data only) | owner test build on 7491, then `node e2e/ask-ezy-eval.mjs 7491 --runs 3 --out <file>`                                                                    | GPA ≥ 3.5, no conversation below 2.0, no safety fail |
| Speed                                             | one traced "improve" turn on the test build; compare `ask_ezy_call` lines before and after                                                               | no slower                                            |

Eval rubric (fixed code checks, no AI judge): outcome ×3, asking ×2, quality ×2, speed ×1; a safety fail caps a
conversation at 1.0; A ≥ 3.7, B ≥ 2.7, C ≥ 1.7, D ≥ 1.0. Judge answers by their structure (blocks, choices), not by
their wording.

## 9. Open ideas

- An agent-list snapshot at the end of the admin prompt (saves the `list_ai_agents` round trip, ~2.5 s).
- Streaming the answer text into the panel (the ChatGPT adapter collects the stream before it returns: check first).
- The same tool set in the normal and setup turns (keeps the cache across the hand-over; small gain).
- UI follow-ups from the first design's review (round 9): see its "Follow-ups" section in git.

## 10. Decision log

| Date       | Decision                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-30 | Ask Ezy for admins and team members; MCP tools; blocks; nothing without Apply                                                |
| 2026-11-12 | Scheduled tasks and new agents as a conversation; one question at a time; new agent only with its task                       |
| 2026-11-13 | "Improve" stays on the normal turn; last step without tools; complete answer kept from extra text                            |
| 2026-11-13 | A found improvement is proposed in the same answer (Apply card), never as a follow-up question                               |
| 2026-11-13 | Time limit per question set by admins (5–30 min, default 15), replacing the 60 s connection bound; keep-alive line           |
| 2026-11-13 | Speed: per-call trace; find → replace drafts, before/after tests in one call, propose by draftId, small texts with the setup |
