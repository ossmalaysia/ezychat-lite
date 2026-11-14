# Dream mode — design

Status: draft for owner approval (2026-11-14). Quick mock confirmed by the owner 2026-11-14 ("look good"):
`docs/features/dream-mode/mock/index.html`, screenshots in `docs/features/dream-mode/mock/screens/`.

## Intent

AI agents get better today only when an admin edits the instructions, hand-off rules or Business context by hand (or
asks Ezy). The owner wants agents to "auto improve the agent response quality without human to tune it manually".

Dream mode: each night, at a time the admin picks, an agent reads the day's chats of its inbox, learns from the replies
the team wrote **after taking a chat over from the AI**, and turns those lessons into setup changes. An admin sees what
it learned and changed, and may let it apply fact changes by itself.

## Owner decisions (2026-11-14)

1. Staged path: suggestions first; "Apply by itself" is a switch the admin turns on.
2. The main lesson is a teammate's reply after a take-over from the AI ("consider human agent reply as new context").
3. Each agent has two switches: **Dream mode** (on/off, with a nightly time) and **Apply by itself** (on/off).
4. A **history** shows each night's run and every change: what, why, and its state (applied, waiting, dismissed, undone).
5. "Apply by itself" changes **Business context facts only**. Instructions and hand-off rules always wait for an admin
   (as shown in the confirmed mock).
6. **Forwarded messages are never a learning source** — not the customer's, not the team's — and never enter dream
   mode's prompts. (This rule is for dream mode only; live replies keep showing the AI a customer's forwarded message
   as `[forwarded] …`.)
7. Build approach **B** (two steps, below).

## Goals

- Fewer hand-offs for the same question: a fact the team gave once is known the next day.
- Every change is visible, explained by the team replies it came from, reversible (Undo), and versioned.
- Safe by default: off until an admin turns it on; nothing is ever sent to a customer.

## Non-goals (v1)

- Groups (only direct chats are read).
- Learning from customers' own statements, from AI-only chats, or from chats with no take-over.
- Notifications (push, email) about new suggestions; a "Run now" button in the app (a dev-only route exists for tests).
- Ask Ezy and MCP tools for dream mode.
- Changing connectors, models, switches, files or Internal items.

## Anti-goals (a failure even if it works)

- Customer data in the agent's setup: names, phone numbers, emails, addresses, order numbers.
- A one-off answer turned into a rule ("we gave this customer a 20 % discount" → "always give 20 %").
- A change that makes the agent hand over or answer worse on questions it handled before.
- Silent changes: anything applied without a history row, a version and Undo.
- Internal knowledge leaking into a customer-visible text.

## Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | One AI call per night with all take-over chats | Simple; a busy day does not fit; one bad answer spoils the night | No |
| **B** | **Step 1: one small call per take-over chat finds what the team taught. Step 2: one call merges the lessons into setup changes. Then checks and replay.** | More calls, each small and bounded; fails per chat; reuses enrichment / phrase-list patterns | **Chosen by the owner** |
| C | No AI: copy each team reply into Business context | Cheap; copies names and one-offs; cannot fix instructions | No |

## How it works

### 1. Settings (per agent)

Table `ai_dream_settings` (new migration, next free number — `045` at the time of writing):
`agent_id` (PK, FK `ai_agents` ON DELETE CASCADE), `enabled` (0/1, default 0), `run_time` (`HH:MM`, default `02:00`),
`auto_apply` (0/1, default 0), `updated_at`. Routes (admins, Origin rules as usual):
`GET /api/ai/agents/:agentId/dream`, `PUT …/dream {enabled?, runTime?, autoApply?}`; audit `dream.settings` with before
and after. Times are in the business time zone (`ai_timezone`), every day.

### 2. Schedule

A `dream` service (`ctx.services.dream`) ticks every 60 s (unref'd timer, started after a delay like scheduled tasks).
For each enabled agent it computes the latest nightly slot with `scheduled/time.ts` (all seven days). A slot runs once:
`ai_dream_runs` has `UNIQUE(agent_id, slot)`. It runs only within **60 minutes** of its time; later the slot is recorded
`missed` (PC asleep or app closed) and never caught up. A run is `skipped` with a reason when: the AI connection is not
ready (`AiService.answerReady` false: `ai_unavailable`), the access gate is closed (`access_closed`), or the agent is
switched off (`agent_off`). One run at a time per install.

### 3. What a run reads (the take-over chats)

Window: from the end of the agent's previous finished run (at most 24 h back) to the slot time.

A **take-over chat** is a direct chat of the agent's inbox where, inside the window, the AI held the chat and then a
person replied, in either of two ways:
- **Hand-off then reply:** an `ai.handoff` audit row for this agent, then a reply from a person.
- **Reply over the AI:** a person replied while this agent owned the chat (`claimOnReply`, reason `reply`,
  `messages/service.ts`), with no hand-off row. These are often the best lessons: the AI answered and the team
  corrected it. Step 1 then gets "the team took over" instead of a hand-off reason.

"A person" is a teammate in the app (`sent_by_user_id` = a human user) or the linked phone (`from_me`, no app user —
the owner on the phone). Only replies until the AI owns the chat again count.

From each take-over chat the run takes at most the last 20 messages up to and including the team's replies, and leaves
out (before anything reaches a model):
- **forwarded messages** in either direction (`messages.forwarding_score > 0`) — owner rule;
- deleted (revoked) messages and edits' old text; system and event rows;
- messages Safety rated High or still waiting for their check;
- scheduled-task messages; media without a caption (a caption is kept as text).

At most **30** take-over chats per agent per night (the most recent). The texts are cleaned with the phrase-list
cleaner (`ai/phrases/check.ts#cleanTeamReply`: emails, long numbers and every customer name of the inbox removed) and
messages are referred to by short local ids, never by WhatsApp ids or phone numbers.

### 4. Step 1 — lessons from one chat (fast model)

One structured call per take-over chat on the "Model for suggestions" (`ai_reply_suggestions_model`: the connection's
fast model by default, or what the admin chose there), no tools, no retries, fixed `DREAM_LESSON_RULES`. Input: the cleaned chat, the AI's hand-off reason. Output: 0–3 lessons
`{kind: 'fact' | 'answer' | 'handoff' | 'style', text, teamMessageIds[]}`.

A lesson is kept only when it cites at least one team message of that chat, every number in it appears in the cited
team text (`draft-check.ts#ungroundedNumbers`), and it passes the privacy check (no email, phone-like number or customer
name). A chat that fails or times out is counted and skipped; the run goes on.

### 5. Step 2 — merge lessons into changes (agent's model)

One structured call on the connection's main model (the one live replies use; models belong to the connection, not
to an agent), fixed `DREAM_MERGE_RULES`. Input: the kept lessons; the agent's current
instructions, hand-off rules and Business context **text** items (not Internal items, not files). Output: at most **5**
changes per night: `{target: 'context_text' | 'instructions' | 'handoff_rules', itemId | null (new text item), name,
after, summary, lessonIds[]}`. Rules: generalise only what several chats or one clear team statement support; never
store a one-off arrangement for one customer; keep existing wording; prefer editing the matching item to adding one;
respect the 20-item and size limits (no new item when full).

`fact` and `answer` lessons go to Business context; `handoff` to hand-off rules; `style` to instructions.

### 6. Checks (every change)

1. Privacy: the added text has no email, phone-like number, customer name of the inbox or chat id.
2. Leak: `findLeak` against the agent's Internal items.
3. Grounding: every number in the added text appears in the cited team replies.
4. Replay: Try-it-style previews (no chat, nothing stored or sent) with the **proposed** setup on the customer
   questions of the source chats. Pass rule by target:
   - `context_text` and `instructions`: the AI now answers at least one source question without handing over;
   - `handoff_rules`: the AI now hands over at least one source question that the rule is about.
   Every preview must also pass the leak check.
5. No regression: the same preview on up to **10** customer questions the AI answered last night without a hand-off;
   none may now hand over (for a `handoff_rules` change: none outside the rule's subject). At most **40** previews per
   run, one at a time. Previews may use the agent's read look-ups (as Try it does), so they count against those
   connectors' own rate limits; a preview that fails on a look-up counts as "could not check", which fails the change.

A change that fails any check is **dropped**: it is never stored and never shown; the run counts it ("2 dropped by
the checks"). Only changes that pass every check are saved (as `waiting`, or `applied` under Apply by itself). The
checks and their results are stored with a saved change and shown in "See change".

**Build note (code checked 2026-11-14):** today's preview (`ai/try-agent.ts`, `AiService.tryAnswer`) can replace only
the instructions and hand-off rules; Business context always comes from the saved items. The builder adds an override
of the Business context items for previews (no write), used only by dream mode.

### 7. Applying

Table `ai_dream_changes`: `id`, `run_id`, `agent_id`, `target`, `item_id`, `item_name`, `before`, `after`, `summary`,
`source_message_ids` (JSON of stored message ids), `checks` (JSON), `status`
(`waiting | applied | dismissed | undone | stale | expired`), `version_id`, `decided_by` (user id; NULL = applied by
itself), `created_at`, `decided_at`.

- **Apply by itself on:** a `context_text` change (a new text item, or an edit of an existing text item, also one an
  admin wrote, as the confirmed mock shows for "Opening hours") is applied at once. Undo always restores the old text.
- Everything else waits. An admin: **Apply**, **Dismiss**, **See change**; an applied change: **Undo**.
- Apply and Undo follow Ask Ezy's rules: apply only while the target still holds `before` (else `stale`, 409
  `setup_changed`); Undo only while it still holds `after`. Ask Ezy keeps its changes in memory for a signed-in user
  (`ask-ezy/changes.ts`), so the builder moves its apply/undo core into a shared helper that both use, taking an actor
  that may be "dream mode" (no user). Each change writes `ai_setup_versions` with a new `SetupVia` value `'dream'`
  (`ai/setup-versions.ts`) and `reason: 'Dream mode: <summary>'`. Waiting changes expire after 14 days.
- "See change" shows before/after, the source messages read live from `messages` (a deleted chat simply shows fewer),
  and the checks. Source quotes are never copied into the dream tables.

### 8. History and UI (confirmed mock)

Agent page, a **Dream mode** card between Business context and Closing chats: intro line, Dream mode switch, nightly
time, Apply by itself switch with its scope line, then **History** (last 30 runs: date, chats read, take-overs,
changes; each change with its state chip and actions). Off state: intro + switch. Paused state: a note when the AI is
not connected. "See change" dialog: before/after, why (team replies), checks, Dismiss/Apply. Phone 360 px and dark as in
the mock. Strings in en, ms, zh-CN. Routes: `GET …/dream/history?before=<runId>`, `GET …/dream/changes/:id`,
`POST …/dream/changes/:id/{apply,dismiss,undo}`.

### 9. Logs, audit, privacy

Logs: run id, agent id, counts, ms, model, outcome — never message text, lessons or change text. Audit:
`dream.settings`, `dream.change.applied` {changeId, auto: bool}, `dream.change.dismissed`, `dream.change.undone`.
Dream tables hold setup text and stored message ids only.

### 10. Editions, upgrades, tests

- Core feature (Lite and Enterprise), per agent; Lite has one agent.
- Lite import (`TABLE_PLAN`): copy `ai_dream_settings` with `enabled = 0`; do not copy runs or changes.
- `upgrade-from-oldest.test.ts` keeps passing; new tables only (adds-only migration).
- Tests never call a model: mock providers script step 1 and step 2 outputs. Dev route
  `POST /api/dev/dream-run {agentId}` (only with `--mode dev --fake-wa`) runs the agent's dream now for e2e and Dev
  Build checks.
- `docs/features/` retention: adding `dream-mode` removes the oldest feature folder per `mock-index.json`.

## Left to the builder

Prompt wording of `DREAM_LESSON_RULES` / `DREAM_MERGE_RULES` (within the rules above); file layout under
`packages/server/src/ai/dream/`; component split in `apps/web`; exact tick timing; the history page size (≥ 30 runs).
