# AI phrase list (instant grey text) and the model for suggestions

Status: **confirmed** 2026-10-26 (mock revision `360997a`).
Mock: [mock/index.html](mock/index.html) ([run it](mock/README.md)). Screenshots: `mock/screenshots/` (`phrase-shots.mjs`).

## Baseline

- Cloned from the owner-confirmed **ai-reply-suggestions** mock (`latestConfirmed`, revision `e7bf307`); the folder on
  main `149b5b9` differs only in `reference.json` status. Every existing flow is kept; the drift check
  (`snapshot.mjs --check`) freezes the inherited files.
- App at proposal: 0.1.58 (`149b5b9`) plus the speed fix in PR #188 (fast model, completion without the knowledge
  base, type-through, half-word trigger). The mock composer carries the PR #188 behaviour.
- Reused app parts: Settings → AI (`ReplySuggestionsSection`, `AiConnectionSection` model `Select`), the composer
  grey text (`completion-ghost`, Tab / Esc, the Accept pill on touch), `Dialog`, `SearchField`, `SegmentedControl`,
  `Badge`, `Banner`, `SaveBar`.

## Why

The owner's test of 0.1.58 (2026-10-26): no grey text at all with ChatGPT sign-in; then, with the fast model,
grey text still needs ~1.5 s while people type on. The owner asked for something faster than an LLM call on
each pause: "build the autocomplete dictionary using AI".

## Decisions

| Item                  | Decision                                                                                                                                                                                                                                                                                                                                     | From                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Idea                  | The AI builds a phrase list in the background; the composer matches it locally on every key, so a phrase shows at once (measured in the mock: 1–2 ms after the last key). When no phrase matches, the fast-model completion runs as in PR #188.                                                                                              | Owner (2026-10-26)                                                                            |
| Sources               | The business context, the AI instructions and the team's own sent replies. Customer names and phone numbers are removed. Internal items are never used.                                                                                                                                                                                      | Owner (2026-10-26, recommended option)                                                        |
| Review                | Automatic: new phrases are used at once; an admin can see, add, edit and delete any phrase in Settings → AI.                                                                                                                                                                                                                                 | Owner (2026-10-26, recommended option)                                                        |
| Languages             | Each language has its own phrases, written natively (not translations), only for the languages the team uses.                                                                                                                                                                                                                                | Owner (2026-10-26: "diff language have diff write phrases")                                   |
| Build triggers        | App start (when there is no list, it is older than 24 h, or the business context changed since the last build; ~2 min after start); a business context save (debounced 1 min); every 30 new team replies, or once an hour while the team is active; a nightly clean-up of AI phrases unused for 30 days; a weekly full rebuild; Rebuild now. | Owner (2026-10-26: "continue improve and enrich ... when got interaction, and during launch") |
| Learning              | Tab / Accept on a phrase counts it up; Esc or typing past it counts it down; most used first. Counts stay in the install's database (no tracking). This reverses the ai-reply-suggestions non-goal "no learning from what teammates accept".                                                                                                 | Owner (2026-10-26)                                                                            |
| Switch                | Part of the core (Lite and Enterprise), under the same Reply suggestions switch. Switch off = the build worker stops (no builds, no AI calls, no phrase grey text); the saved phrases stay. Switch on again = one rebuild when the list is stale.                                                                                            | Owner (2026-10-26: "if people turn off this feature the build phase worker also turn off")    |
| Limits                | At most ~300 phrases per language; at most ~24 AI calls a day for the list; nothing while the switch is off, without an AI connection, or while the access gate is closed.                                                                                                                                                                   | Our call                                                                                      |
| Facts                 | A phrase with a number (price, hours) is checked against the current business context with the draft fact check before it shows; a business context save rebuilds the fact phrases.                                                                                                                                                          | Our call                                                                                      |
| Matching              | The last 2–4 typed words (each Chinese character counts as a word; the last word may be half typed) must appear in a phrase; the rest of that phrase is the grey text (≤ 120 characters). Quick-reply commands (`/…`) never match.                                                                                                           | Our call                                                                                      |
| Model for suggestions | Settings → AI → Reply suggestions: **Fast (recommended)** = the connection's fast model (ChatGPT `gpt-6-luna`, OpenAI key `gpt-4.1-mini`, Claude `claude-haiku-5-5`); **Same as the AI agent** (slower); or any model of the connection. Used by Suggest reply, the completion and the phrase build.                                         | Owner (2026-10-26: "can we have this setting", also for Anthropic)                            |

## Screens and states (mock checklist)

- Composer: phrase grey text in English, inside a half-typed word, Malay, Chinese; model grey text when no phrase
  matches; Tab / Accept counts the phrase.
- Settings → AI → Reply suggestions: the model choice (Fast, Same as the AI agent, each model), its hint.
- Settings → AI → Phrase list card: ready (count, languages, last update and why, next update, AI calls today),
  building, empty (Build now), error, switched off (info note, Rebuild disabled); the privacy line.
- Phrase list dialog: all, language filter, search, no match, add, edit, delete; source badge, use count, fact note.
- Desktop 1280 px and mobile 360 px touch, light and dark: `phrase-shots.mjs` (64 shots, no page errors, no
  horizontal overflow).

## Not in this round

- Phrases for group chats (direct chats only, as reply suggestions).
- Per-teammate phrases (one list per AI agent, shared by the team).
- Streaming or pre-fetching Suggest reply (listed as other speed options; not chosen yet).

## Server plan (for the build, our call)

- Table `reply_phrases` (`agent_id`, `language`, `text`, `source` context|team|admin, `uses`, `fact`, timestamps),
  per agent; a numbered migration.
- A phrase worker in `ai/phrases/` started by the AI service: triggers above, one structured call per build on the
  "Model for suggestions" model, the draft fact check and the leak check on every phrase, name/phone removal on team
  replies before the prompt, logs counts only (`phrase_build` {trigger, phrases, ms, model, ok}).
- Routes: `GET /api/reply-phrases` (any user with access: id, text, language of the visible agent's list) for the
  composer; admin `GET/POST/PUT/DELETE /api/ai/phrases…`, `POST /api/ai/phrases/rebuild`; `POST /api/reply-phrases/:id/used`.
- Setting `ai_reply_suggestions_model` (`fast` | `agent` | model id), validated against the connection.

## Confirmation

The owner viewed the review page with the screenshots (phrase grey text in English, a half-typed word, Malay and
Chinese; the model completion when no phrase matches; the model choice; the Phrase list card ready, switched off,
building and empty; the list, the Malay filter, Add phrase, the phone layout) and confirmed on 2026-10-26: "ok
implement it". Confirmed mock revision: `360997a`.
