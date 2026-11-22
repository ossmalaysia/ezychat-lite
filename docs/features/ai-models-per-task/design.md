# AI models per task

Status: **proposal, waiting for the owner's confirmation.** Design and mock only; no production code.
Editions: Lite and Enterprise (core, through the published `@ezychat/web`). EzyChat Cloud is designed in a parallel
session with the same task-group names and labels. Lasting rules and decision log: [docs/ai-models.md](../../ai-models.md).

## Request (owner, verbatim, 2026-11-22)

> we should able to configure diff case for using diff model, cannot one model for all, like main model with chatgpt
> sigin can be balance speed and reasoning, but translation can have diff model, it allow to claude so if we choose
> claude key we can configure diffmodel for it, it should same for enterprise lite and cloud

Trigger: Live translate felt slow. It shares the "Model for suggestions" with several other jobs, and the rest of the
AI work is fixed to either the main or the fast model.

## Mock

Cloned from the latest confirmed mock (`latestConfirmed` in `docs/features/mock-index.json`: **live-translate**,
confirmed 2026-11-19, merged to `main` as `4b112b6`; copied from `main` `6ff85ef`). Every inherited flow still works.

```bash
npx tsx --conditions=ezychat-source docs/features/ai-models-per-task/mock/run.ts --fake-wa
PW_CHROMIUM=/opt/pw-browsers/chromium node docs/features/ai-models-per-task/mock/ai-models-shots.mjs
```

Open `http://localhost:7489/admin/settings/ai`, sign in as `aisyah` / `demo-pass-123`. The **AI models** card is the
second card, under the AI connection. Its dashed **Mock only** strip switches the connection (ChatGPT sign-in, OpenAI
API key, Claude API key) and removes a saved model from the ChatGPT list (Translate was saved on `gpt-5.6-terra`).
Screenshots: [screenshots/](screenshots/) (30 shots: 1280 px and 360 px, light and dark, en/ms/zh-CN, 0 page errors, 0
horizontal overflow; `results.json`).

Intentional changes to the cloned reference (everything else is unchanged):

| File                                             | Change                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `mock/ai-models.ts` (added)                      | Stand-in for `GET/PUT /api/ai/task-models` at `/api/mock/ai-models*`, choices per connection, fallback, audit. |
| `mock/ai-models-shots.mjs` (added)               | The 30 screenshots and the overflow/page-error checks.                                                         |
| `mock/src/mock/aiModels.ts` (added)              | Query hook and types (the proposed shared contract, mock side).                                                |
| `mock/src/admin/AiModelsSection.tsx` (added)     | The AI models card.                                                                                            |
| `mock/src/admin/SettingsPage.tsx`                | Puts the card under the AI connection card.                                                                    |
| `mock/src/admin/ReplySuggestionsSection.tsx`     | The "Model for suggestions" choice moves out; one line points to AI models → Writing help.                     |
| `mock/src/i18n/locales/{en,ms,zh-CN}/admin.json` | `mockAiModels.*`; Live translate's privacy line names the Translate model.                                     |
| `mock/proposal.ts`                               | Registers `ai-models.ts`.                                                                                      |
| `mock/run.ts`                                    | Temp-folder name.                                                                                              |

Checklist (each state is in the screenshots): ChatGPT, OpenAI key and Claude defaults; the model list open; a changed
choice before and after Save (Writing help on the main model with High thinking); Claude keeps its own choice
(Translate on `claude-sonnet-5-5`); a saved model no longer listed (warning + fallback); the Reply suggestions card's
pointer line; dark mode; Malay and Chinese; phone 360 px for all of these.

Not covered by the mock: the Ask Ezy panel and Live translate actually going faster (no model is called), Enterprise's
Inboxes/edition differences (none expected), the Settings search.

## 1. Inventory: every AI call today

`main` = the connection's saved model (ChatGPT: Auto = the first model the account lists; OpenAI key: saved or
`gpt-4.1-mini`; Claude: saved or `claude-sonnet-5-5`). `fast` = ChatGPT: the first of `gpt-6-luna`, `gpt-5.6-luna` the
account lists, else main; OpenAI key: `gpt-4.1-mini`; Claude: `claude-haiku-5-5`. `suggest` = the "Model for
suggestions" setting `ai_reply_suggestions_model` (`fast` default, `agent` = main, or a listed model id).
Thinking (reasoning effort) is sent only on ChatGPT sign-in; the OpenAI key and Claude paths send none today.

| #   | Task                                                          | Code                                                 | Model today                                                          | ChatGPT thinking | Proposed group             |
| --- | ------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------- | -------------------------- |
| 1   | AI agent live replies (direct, groups, "Reads every message") | `service.ts` → `provider.generate` (`agent/turn.ts`) | main                                                                 | model's own      | AI agent replies           |
| 2   | Try it (`POST /api/ai/try`)                                   | `tryAnswer` → `generate`                             | main                                                                 | model's own      | AI agent replies           |
| 3   | Scheduled task turn and its preview                           | `scheduledTurn`                                      | main                                                                 | model's own      | AI agent replies           |
| 4   | Dream mode Try-it previews                                    | `previewWithSetup` → `tryAnswer`                     | main                                                                 | model's own      | AI agent replies           |
| 5   | Ask Ezy, normal question                                      | `assist` (`agent/assist.ts`)                         | fast                                                                 | low              | Ask Ezy                    |
| 6   | Ask Ezy setup (after `start_setup`)                           | `assist` with `main`                                 | main                                                                 | model's own      | fixed: main                |
| 7   | Ask Ezy task preview                                          | `scheduledTurn` (preview)                            | main                                                                 | model's own      | AI agent replies           |
| 8   | Suggest reply                                                 | `draftReply` → `provider.draft`                      | suggest                                                              | low              | Writing help               |
| 9   | Grey-text completion (3 s cap)                                | `draft`                                              | suggest                                                              | low              | Writing help               |
| 10  | Fix English grammar                                           | `fixGrammar` → `draft`                               | suggest                                                              | low              | Writing help               |
| 11  | Live translate: incoming messages                             | `translate` → `draft`                                | suggest                                                              | low              | Translate                  |
| 12  | Live translate: draft before sending                          | `translate` → `draft`                                | suggest                                                              | low              | Translate                  |
| 13  | Phrase list build                                             | `buildPhrases` → `draft`                             | suggest                                                              | low              | Background checks          |
| 14  | Dream mode lessons (per chat)                                 | `dreamLessons` → `draft`                             | suggest                                                              | low              | Background checks          |
| 15  | Dream mode merge (proposed changes)                           | `dreamMerge` → `draft` (`fast: false`)               | main                                                                 | **low**          | fixed: main                |
| 16  | WhatsApp Safety AI check                                      | `checkSafety` → `draft` (`fast: true`)               | fast                                                                 | low              | Background checks          |
| 17  | Customer enrichment                                           | `extractCustomer`                                    | main                                                                 | model's own      | fixed: main                |
| 18  | Edit with AI (`POST /api/ai/edit`)                            | `rewrite`                                            | main                                                                 | model's own      | fixed: main                |
| 19  | Voice-note transcription                                      | `voice/`                                             | local Whisper small, or OpenAI `gpt-4o-transcribe` (OpenAI key only) | n/a              | out of scope (own setting) |
| 20  | API key test                                                  | `key-test.ts`                                        | none (`GET /v1/models`)                                              | n/a              | out of scope               |

Note on 15: every ChatGPT `draft` call runs at `low` thinking, even when it uses the main model. The proposal keeps
that as the default (§3).

## 2. Task groups (what the admin sees)

Five rows in Settings → AI → **AI models**, each in words an owner recognises:

| Row                   | What it covers (shown under the title)                                                      | Default                                   |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **AI agent replies**  | Answers customers in chats and groups, Try it and scheduled messages.                       | Main model                                |
| **Ask Ezy**           | The in-app assistant that answers your questions about chats and reports.                   | Fast                                      |
| **Translate**         | Live translate: customers' messages, and your replies before they are sent.                 | Fast                                      |
| **Writing help**      | Suggest reply, the grey text while you type, and Fix English.                               | Fast (or the old "Model for suggestions") |
| **Background checks** | Safety checks on incoming messages, the phrase list, and what Dream mode learns each night. | Fast                                      |

A fixed line under the rows: **Always the main model**: setting up agents with Ask Ezy, Edit with AI, the changes Dream
mode suggests and filling in customer details, because they change your setup or records. Voice notes keep their own
setting (Settings → AI → Voice notes).

Why these groups:

- **By who waits and what it costs, not by internal call.** A customer waits for agent replies; a teammate waits for
  translation and writing help (seconds matter); nobody waits for background checks (cost matters); the admin waits
  for Ask Ezy. Each row is one trade-off an owner can decide once.
- **Translate gets its own row** because it is the job that triggered the request and it runs on every message of a
  translated chat: its cost and speed differ from writing help, which runs only when someone asks.
- **Previews follow the agent.** Try it, the scheduled-task preview and Dream's previews must show what the agent would
  really send, so they use the AI agent replies model.
- **Setup and records stay on the main model** (Ask Ezy setup, Edit with AI, Dream merge, customer details). They write
  into the agent's instructions or customer profiles, run rarely and are where a weaker model does harm. A sixth row
  for them would ask the owner a question with only one safe answer. (Deviation from the master's suggested grouping,
  which put enrichment and Dream in Background checks and Edit with AI in Writing help; see the report.)
- **The phrase list is a background check** (it builds by itself, up to 24 calls a day), not writing help, although
  the composer uses its result.

## 3. Choices per row

- **Fast (recommended)** = the connection's fast model; **Main model** = the model chosen in the AI connection card;
  then **every model the current connection lists** (ChatGPT: the account's live list, else `CHATGPT_FALLBACK_MODELS`;
  OpenAI key: `gpt-4.1-mini`, the saved model, `gpt-4.1`, `gpt-5.5`; Claude: `CLAUDE_MODELS`). "(recommended)" is shown
  on the row's default (Main model for AI agent replies, Fast elsewhere).
- Each listed model carries a plain tier: **faster** / **balanced** / **smarter, costs more** (shared table
  `AI_MODEL_INFO`; an unknown model shows no tier). The hint under the box repeats it as a sentence ("Answers sooner and
  costs less.", "A good balance of speed and quality.", "Smartest answers. Slower and costs more.").
- **Thinking: Low / Medium / High** appears only when the chosen model has a thinking level: every ChatGPT model, and
  OpenAI reasoning models on a key (`gpt-5.5` in today's list). Claude shows none (we use no extended thinking). Default:
  **Low** for every row except AI agent replies, whose default is **Medium** = the model's own (today nothing is sent
  there; the implementation keeps sending nothing for the default). Hints: "Low thinking: quickest.", "Medium
  thinking: balanced.", "High thinking: best answers, slowest, uses more of your plan."
- Writing help on anything but Fast adds: "The grey text while you type may not appear in time with a slower model."
  (the completion keeps its 3 s cap).
- **Use default** on a changed row returns it to its default (saved as no entry).
- **Per connection.** Choices are stored per connection mode; switching to the Claude key shows Claude models and the
  Claude choices; switching back restores the ChatGPT ones. The card's first line names the connection, the main model
  and the fast model, and says "Each connection keeps its own choices."
- **A model no longer listed** (ChatGPT account changed, a model retired): the row runs on its fallback (AI agent
  replies → Main model, every other row → Fast) at the default thinking, and shows a warning: "gpt-5.6-terra is no
  longer offered by your AI connection. EzyChat uses Fast (gpt-6-luna) until you choose another model." The saved
  choice is kept, so it comes back if the account lists the model again. Same rule as today's `draftChoice`.

## 4. Shared contract (`packages/shared/src/ai-models.ts`, proposed)

```ts
export const AI_TASK_GROUPS = [
  'agentReplies',
  'askEzy',
  'translate',
  'writing',
  'background',
] as const;
export const AiTaskGroup = z.enum(AI_TASK_GROUPS);
export const AiThinking = z.enum(['low', 'medium', 'high']);
/** `fast`, `main` or a model id of the connection (CHATGPT_MODEL_ID shape). */
export const AiTaskChoice = z.union([
  z.literal('fast'),
  z.literal('main'),
  z.string().regex(CHATGPT_MODEL_ID),
]);
export const AiTaskModel = z
  .object({ choice: AiTaskChoice, thinking: AiThinking.optional() })
  .strict();

/** Setting `ai_task_models`: per connection mode, per group; a missing group = its default. */
export const AiTaskModelsSetting = z.partialRecord(
  AiConnectionMode,
  z.partialRecord(AiTaskGroup, AiTaskModel),
);

export const AiModelInfo = z.object({
  id: z.string(),
  thinking: z.boolean(),
  tier: z.enum(['fast', 'balanced', 'smart']).nullable(),
});
export const AiTaskModelState = z.object({
  choice: AiTaskChoice,
  thinking: AiThinking.nullable(), // saved; null = default
  model: z.string(), // what runs now (after fallback)
  effectiveThinking: AiThinking.nullable(), // null = no thinking level
  unavailable: z.string().nullable(), // saved model the connection no longer lists
  isDefault: z.boolean(),
});
export const AiTaskModelsStatus = z.object({
  mode: AiConnectionMode,
  mainModel: z.string(),
  fastModel: z.string(),
  models: z.array(AiModelInfo),
  tasks: z.record(AiTaskGroup, AiTaskModelState),
  defaults: z.record(AiTaskGroup, z.object({ choice: z.enum(['fast', 'main']) })),
});
/** PUT body: only the groups that change; null = back to the default. Saves for the current connection only. */
export const AiTaskModelsBody = z
  .object({ tasks: z.partialRecord(AiTaskGroup, AiTaskModel.nullable()) })
  .strict();
```

New response fields of existing schemas get zod defaults (Enterprise compatibility rule).

### Routes (admins)

- `GET /api/ai/task-models` → `AiTaskModelsStatus` for the current connection.
- `PUT /api/ai/task-models` `AiTaskModelsBody` → `AiTaskModelsStatus`. 30 a minute per admin. Errors: 400
  `model_not_listed` (a model id the connection does not list now), 400 `thinking_not_supported` (thinking for a model
  without a level), 400 `invalid_body`. A save never touches another connection's choices.
- Kept for older clients (web-client contract test and Enterprise): `GET /api/ai/reply-suggestions/model` reads the
  Writing help row (`fast` / `agent` for `main` / id); `PUT /api/ai/reply-suggestions {model}` writes it. Remove after
  Enterprise and the web stop calling them.

### Server

- One resolver `ai/task-models.ts#taskModel(group, settings) → { settings, fast, reasoningEffort }` replaces
  `draftChoice` / `fast: true` / `main` flags at every call site of the inventory. Provider calls take an optional
  `reasoningEffort` (`low | medium | high`; undefined = send nothing): ChatGPT always honours it, the OpenAI key path
  only for models with `thinking`, Claude ignores it. The ChatGPT `draft` path stops hard-coding `low`.
- Ask Ezy's turn budget follows its model: 90 s on Fast, the setup budget (150 s) otherwise.
- Validation: the server re-checks a saved choice at every call (fallback rule above) because the ChatGPT list is live.

### Upgrade (permanent start-up code, `migrateTaskModels`)

Runs while `ai_task_models` is missing; idempotent; `upgrade-from-oldest.test.ts` seed gets an old
`ai_reply_suggestions_model`.

- `ai_reply_suggestions_model` = `agent` → Writing help `main`; a model id → Writing help that id, under the connection
  mode saved at upgrade; `fast` or missing → nothing (default).
- Translate is **not** copied: it starts on Fast (owner: Translate defaults to Fast everywhere).
- Phrase list and Dream lessons move to Background checks (Fast). An install that had changed the "Model for
  suggestions" gets them back on Fast (noted in the CHANGELOG line).
- The old key is left in place (downgrade safety) and no longer read.

### Audit and logs

- Audit `settings.ai_task_model` {mode, task, before {choice, thinking}, after {choice, thinking}} once per changed row;
  choices and model ids only.
- Every model-call log line that already carries `model` (`ai answer`, `ask_ezy_call`, `fix_grammar`,
  `live_translate`, `phrase_build`, `dream_*`, Safety) adds `task` (the group) and `thinking`. Never text.

### Enterprise and extensions

- Core only. Enterprise gets the card through `@ezychat/web` and the routes through the core; no extension point
  changes. `ServerExtension.agentTools` turns follow AI agent replies.
- `AiService` methods Enterprise may call keep their signatures; the resolver is internal. Before the shared-contract
  change is ready, run the Enterprise typecheck, lint and tests on a `pack:core` build (AGENTS.md rule).
- EzyChat Cloud: same five rows and labels (parallel Cloud session).

## 5. Security and privacy

No new network listener, no new outbound host, no secret. Model ids are not secrets; the choice is admin-only and
audited. Nothing changes in what text goes to the AI provider; only which of the connection's own models receives it.

## Open questions for the owner

1. Is keeping setup and records work (Ask Ezy setup, Edit with AI, Dream's proposed changes, customer details) fixed on
   the main model right, rather than giving them a row?
2. Thinking defaults: Low everywhere except AI agent replies (= today). Should Translate default to Low as well (fastest)?
   Proposed: yes.
3. The old "Model for suggestions" moves to Writing help. OK to drop the select from the Reply suggestions card (one
   line points to AI models instead)?

## Confirmation record

- 2026-11-22: proposal and mock opened as a draft PR. Waiting for the owner.
