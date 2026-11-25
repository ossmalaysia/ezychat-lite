# AI models per task

Lasting rules and decision log for which AI model does each job (owner rule: a core feature's decisions outlive its
feature folder). Design, full inventory and mock: [docs/features/ai-models-per-task/design.md](features/ai-models-per-task/design.md)
(pruned later; the revision is in `docs/features/mock-index.json`). Add a decision line here whenever a rule changes.

## Rules

- **Five rows** in Settings → AI → AI models: AI agent replies, Ask Ezy, Translate, Writing help, Background checks.
  Same names and labels in Lite, Enterprise and Cloud.
- **What each row covers:** AI agent replies = live replies, Try it, scheduled tasks and every preview of what the agent
  would send (scheduled-task, Ask Ezy task and Dream previews). Ask Ezy = normal questions. Translate = Live translate
  (incoming and drafts). Writing help = Suggest reply, the grey-text completion, Fix English, Edit with AI. Background
  checks = WhatsApp Safety AI check, phrase list, Dream mode lessons.
- **Always the main model** (no row): Ask Ezy setup, Dream mode merge, customer enrichment; they write setup or
  records. Voice transcription keeps its own setting.
- **Choices:** Fast (the connection's fast model), Main model (the AI connection card's model), or any model the current
  connection lists. **Speed and quality: Faster · Balanced · Smarter** (= reasoning effort low · medium · high) only for
  models that have it: every ChatGPT model and OpenAI reasoning models (gpt-5…, o-series) on a key. Claude: none (Claude
  thinking for Balanced/Smarter is phase 2). Same words in Lite, Enterprise and Cloud.
- **Defaults equal the behaviour before the feature**, except Translate and Edit with AI: AI agent replies Main +
  Balanced (the model's own level; nothing is sent); every other row Fast + Faster (Translate was the "Model for
  suggestions"; Edit with AI was the main model).
- **No picker elsewhere:** the Reply suggestions card has no model choice; one line points to AI models → Writing help.
- **Per connection:** choices are stored per mode (`ai_task_models[mode][group]`); a save changes only the current mode.
- **Fallback:** a saved model the connection no longer lists runs as Main (agent replies) or Fast (others) at the
  default thinking, with a warning on the row; the saved choice is kept.
- **Validation:** a saved model id must be on the connection's list (400 `model_not_listed`; 503
  `model_list_unavailable` while a ChatGPT account's list cannot be read); thinking only for a model that has it (400
  `thinking_not_supported`).
- **Audit and logs:** `settings.ai_task_model` {mode, task, before, after}; model-call logs add `task` and `thinking`,
  never text.

## Decision log

- 2026-11-22: owner request ("cannot one model for all … translation can have diff model … same for enterprise lite and
  cloud"). Proposal: five rows; Translate defaults to Fast everywhere; setup and records work stays on the main model;
  the "Model for suggestions" becomes Writing help (migrated); phrase list and Dream lessons move to Background checks.
  Waiting for the owner's confirmation of the mock.
- 2026-11-22: owner confirmed ("Yes, all suggested"): the extra control is **Speed and quality: Faster · Balanced ·
  Smarter** (not Thinking Low/Medium/High; Faster = low, Balanced = medium or the model's own, Smarter = high; Cloud uses
  the same words); Translate defaults to Fast + Faster; Edit with AI joins Writing help (default Fast); Ask Ezy setup and
  the Dream mode merge stay on the main model with no setting; the Reply suggestions card loses its model picker and
  gets a note; Claude thinking for Balanced/Smarter is phase 2.
- 2026-11-22: built. Ask Ezy's turn budget is the admin's question time limit (docs/ask-ezy.md), so it does not change with
  the row's model (the proposal's 90 s / 150 s split predates that limit). On Fast, draft calls keep the provider's own
  fast-model pick (`fast: true`), so a ChatGPT account's live list still decides it.
- 2026-11-22: review fix. ChatGPT's model list is the built-in one until the account's live list is read, so a saved
  model only the live list offers runs as saved until then (the provider checks it on the call); opening or saving AI
  models reads the live list first. No level for o1-mini, o1-preview, -chat or -pro models on an OpenAI key.
- 2026-11-22: second review fix. "Never read" and "expired" are different: once the account's list was read, even an
  expired copy is the list, so a model the account lost falls back to the row default with the warning (not to Auto).
  A save of a name the list does not show answers 503 while the account's list cannot be read, never stores it. The
  start-up migration moves an old suggestions model only when the connection saved now lists it. Picking the row's
  default again saves it as the default. A kept live-only model shows in the picker with its level.
- 2026-11-22: third review fix. A saved ChatGPT model the account's list has not confirmed yet (list unread after a
  start or sign-in) runs on the row's default for that call and starts the list read; the screen still shows the
  saved choice. The start-up migration keeps an old ChatGPT suggestions model (checked on use). A reasoning model on an
  OpenAI key gets reasoning headroom on top of a draft call's small answer cap (low 2,000 · medium 8,000 · high 24,000
  tokens, `REASONING_HEADROOM`), so a completion or Safety check at Smarter is not cut off; the ChatGPT backend takes
  no cap. The older `PUT /api/ai/reply-suggestions {model}` reads the list first and has the same 30-a-minute limit.
- 2026-11-22: fourth review fix. The reasoning headroom also goes to the AI agent turn (decision cap 2,000), Ask Ezy
  (3,000) and Edit with AI (12,000) on an OpenAI key, and to every OpenAI model that reasons, also those that take no level of ours (o1-mini,
  o1-preview, -pro; `openAiModelReasons`). After a ChatGPT list read fails, AI calls wait 5 minutes before the next
  try. The older suggestions route checks the model before it changes the switch.
