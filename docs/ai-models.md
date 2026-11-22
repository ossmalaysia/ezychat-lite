# AI models per task

Lasting rules and decision log for which AI model does each job (owner rule: a core feature's decisions outlive its
feature folder). Design, full inventory and mock: [docs/features/ai-models-per-task/design.md](features/ai-models-per-task/design.md)
(pruned later; the revision is in `docs/features/mock-index.json`). Add a decision line here whenever a rule changes.

## Rules

- **Five rows** in Settings → AI → AI models: AI agent replies, Ask Ezy, Translate, Writing help, Background checks.
  Same names and labels in Lite, Enterprise and Cloud.
- **What each row covers:** AI agent replies = live replies, Try it, scheduled tasks and every preview of what the agent
  would send (scheduled-task, Ask Ezy task and Dream previews). Ask Ezy = normal questions. Translate = Live translate
  (incoming and drafts). Writing help = Suggest reply, the grey-text completion, Fix English. Background checks =
  WhatsApp Safety AI check, phrase list, Dream mode lessons.
- **Always the main model** (no row): Ask Ezy setup, Edit with AI, Dream mode merge, customer enrichment; they write
  setup or records. Voice transcription keeps its own setting.
- **Choices:** Fast (the connection's fast model), Main model (the AI connection card's model), or any model the current
  connection lists. Thinking Low / Medium / High only for models that have it (ChatGPT, OpenAI reasoning models).
- **Defaults equal the behaviour before the feature**, except Translate: AI agent replies Main + model's own thinking
  (shown Medium, nothing sent); every other row Fast + Low.
- **Per connection:** choices are stored per mode (`ai_task_models[mode][group]`); a save changes only the current mode.
- **Fallback:** a saved model the connection no longer lists runs as Main (agent replies) or Fast (others) at the
  default thinking, with a warning on the row; the saved choice is kept.
- **Validation:** a saved model id must be on the connection's list (400 `model_not_listed`); thinking only for a model
  that has it (400 `thinking_not_supported`).
- **Audit and logs:** `settings.ai_task_model` {mode, task, before, after}; model-call logs add `task` and `thinking`,
  never text.

## Decision log

- 2026-11-22: owner request ("cannot one model for all … translation can have diff model … same for enterprise lite and
  cloud"). Proposal: five rows; Translate defaults to Fast everywhere; setup and records work stays on the main model;
  the "Model for suggestions" becomes Writing help (migrated); phrase list and Dream lessons move to Background checks.
  Waiting for the owner's confirmation of the mock.
