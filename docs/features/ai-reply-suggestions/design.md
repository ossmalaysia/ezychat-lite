# AI reply suggestions (suggest a reply, complete as you type)

Owner request 2026-10-25 ("Explore how to do ai auto draft, like how to trigger it and human select one?"),
worked out in a brainstorm the same day. A teammate who handles a chat asks the AI for help: the AI suggests
**2 replies** to choose from, or completes the sentence the teammate is typing. The AI never sends anything.
Status: **confirmed** 2026-10-26 (see Confirmation); next: implementation plan.

## Why

Most teams do not want the AI agent to answer customers by itself yet, but they still want help to write
answers faster and with the right facts (prices, delivery, policies) from the business context. Today the AI
help exists only as a fully automatic agent. This feature puts the same knowledge in the hands of the person
who replies, and it works also when the AI agent is off.

**Anti-goal (owner):** suggestions or completions that are **not relevant**. A weak or generic suggestion is
worse than none: the feature must show nothing rather than guess. Relevance is the quality bar for every
decision below and for the Dev Build checks.

## Decisions

"Owner" = decided by the owner in the brainstorm. "Our call" = decided by the designer; the owner may change it.

| Topic                    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | By                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Trigger (suggestions)    | A person starts it: a **✨ Suggest reply** button in the composer. Nothing is generated automatically when a message arrives.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Owner                                   |
| Number and kind          | **2 suggestions**, both relevant to the customer's open request or enquiry, answering it in **two different ways** (e.g. "answer now" vs "ask for the missing detail first", or two different offers). Never two near-copies.                                                                                                                                                                                                                                                                                                                                           | Owner                                   |
| Layout                   | **Short chips** above the composer (layout B of the brainstorm mockup): each chip shows a short label (≤ ~40 characters, e.g. "Yes, M is RM 89, Friday OK…"). Tap/click a chip → the full draft fills the composer.                                                                                                                                                                                                                                                                                                                                                     | Owner                                   |
| Sending                  | The teammate edits the draft and presses Send as usual. The AI never sends; a suggestion is never stored in the chat history.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Owner                                   |
| Ignore and type          | The teammate may ignore the chips and type. Then the AI **completes the sentence** as grey text after the caret.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Owner                                   |
| Completion trigger       | Only after **at least one full word** is typed (a word boundary: space or punctuation), never on every character. Chinese text has no spaces: there the boundary is punctuation (，。？).                                                                                                                                                                                                                                                                                                                                                                               | Owner                                   |
| Who controls it          | **Only an admin**, one switch for the whole team (suggestions and completion together). No per-teammate switch.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner                                   |
| Default                  | **On by default when an AI connection exists** (API key, Claude key or ChatGPT sign-in). Without an AI connection the feature is disabled.                                                                                                                                                                                                                                                                                                                                                                                                                              | Owner                                   |
| Existing installs        | An install **updated** from an older version starts with the switch **off** (completions cost money while people type, so nothing new is charged without the admin's choice); Settings → AI shows "New: reply suggestions" until the admin turns it on. A **new** install starts on. Needs a permanent start-up step or migration that writes `false` for installs that existed before the feature.                                                                                                                                                                     | Owner (2026-10-25, accepted proposal 3) |
| AI-owned chat            | A teammate also gets suggestions in a chat that the AI agent currently answers. Sending a draft is a normal teammate reply, so the teammate takes the chat from the AI as today.                                                                                                                                                                                                                                                                                                                                                                                        | Owner (2026-10-25, accepted proposal 1) |
| Promises                 | A draft states facts from the business context; it never confirms an order, booking, refund or other promise that the business context does not support. When a business hand-off rule matches, no draft shows: a note "Hand-off rule "<rule>": reply yourself."                                                                                                                                                                                                                                                                                                        | Owner (2026-10-25, accepted proposal 2) |
| AI agent off             | The feature works **whether the AI agent is on or off**. It needs only the AI connection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Owner                                   |
| Knowledge                | The prompt uses the business context, instructions and hand-off rules of the **AI agent of the chat's inbox** (`agentForChat`), also when that agent is off. If the inbox has no agent, only the conversation and the customer details are used.                                                                                                                                                                                                                                                                                                                        | Our call                                |
| Prompt                   | Same `GUARDRAILS` block first (unchanged, shared cache prefix), then a new fixed `DRAFT_RULES` block instead of `CORE_RULES` (which is written for the automatic agent: decision format, hand-off, `no_reply`, "Does that answer your question?"), then the agent's instructions; same input order as live replies (`internalKnowledge` → `businessKnowledge` → `conversation` → `currentSituation` with `aiCustomer`). Only `GUARDRAILS` is shared with the live-reply cache; `DRAFT_RULES` is identical for every draft call, so drafts share their own cache prefix. | Our call                                |
| Voice                    | Drafts speak as the team ("we"), never with the AI agent's name and never as "an AI".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Our call                                |
| Fact check on the server | Besides the model's `grounded` flag, the server drops a suggestion or completion that contains a number, price, date or time that does not appear in the conversation, the customer details or the business context sent in the prompt (cheap text check).                                                                                                                                                                                                                                                                                                              | Our call                                |
| Completion model         | Suggestions use the saved model. Completions use the fastest model of the same provider where the app already has a fixed list (Claude: the fastest of `CLAUDE_MODELS`; OpenAI API key: a fixed small model in `ai/agent/models.ts`); ChatGPT sign-in uses the saved model. Low reasoning effort.                                                                                                                                                                                                                                                                       | Our call                                |
| Relevance gate           | The model returns each suggestion with a **grounded** flag: every fact (price, stock, date, policy) must come from the conversation, the customer details or the business context. Ungrounded suggestions are dropped. If the needed fact is missing, the strip shows one neutral chip "No answer in the business context" (tap = nothing is inserted; admins see a link to the agent's Business context). Zero chips is a valid result.                                                                                                                                | Our call                                |
| Language                 | Suggestions and completions use the language the customer wrote in last (English, Malay, Chinese, mixed).                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Our call                                |
| Completion length        | At most the end of the current sentence (≤ ~120 characters). No completion when the model is not confident, when the caret is not at the end of the text, or when the text is a quick-reply command (`/…`).                                                                                                                                                                                                                                                                                                                                                             | Our call                                |
| Completion timing        | Request after a word boundary **and** a ~500 ms pause; a new keystroke aborts the request in flight (`AbortController`, as Edit with AI). A completion that arrives after the text changed is discarded.                                                                                                                                                                                                                                                                                                                                                                | Our call                                |
| Accept / dismiss         | Desktop: **Tab** accepts the grey text, typing continues normally, **Esc** dismisses. Touch: a small "Accept" pill next to the grey text (there is no Tab key).                                                                                                                                                                                                                                                                                                                                                                                                         | Our call                                |
| Chip over typed text     | Composer empty → the chip fills it. Composer has text → the chip replaces it only after an inline "Replace your text?" confirm, so typed work is never lost.                                                                                                                                                                                                                                                                                                                                                                                                            | Our call                                |
| Chips lifetime           | Chips disappear when the teammate sends, when a new customer message arrives, or when the chat changes. Pressing the button again makes 2 new suggestions.                                                                                                                                                                                                                                                                                                                                                                                                              | Our call                                |
| Where it shows           | Wherever the signed-in user may reply in that chat (same rule as the composer): not on a removed inbox's read-only chats. **Direct chats only** in this round; group chats later.                                                                                                                                                                                                                                                                                                                                                                                       | Owner (2026-10-25, accepted proposal 5) |
| Unavailable              | Feature switched off or no AI connection → no button and no grey text (teammates never see a broken button). Connection `expired`/`error` → the button stays, disabled, with "AI suggestions are not available now"; the composer works as usual.                                                                                                                                                                                                                                                                                                                       | Our call                                |

## Non-goals

- No automatic drafts on every incoming message (cost, and the owner chose a person-started trigger).
- No sending by the AI, no "approve to send" queue (that is the separate "AI actions" roadmap item).
- No per-teammate switch, no per-chat switch.
- No storage of suggestions or completions, no learning from what teammates accept.
- No usage tracking or telemetry (Lite never sends usage data).
- No extension look-ups (`agentTools`, e.g. Enterprise connectors) in this round: each look-up is an extra
  model round trip, which conflicts with completion speed. Parked for a later round.

## Server (our call; the builder may refine names)

- **Routes**, per chat, signed-in users (`requireUser`), resolved through `chatJidParam`; **404 outside the
  caller's inboxes** (inbox-access invariant); 403 while the access gate is closed (automatic):
  - `POST /api/chats/:jid/ai/suggestions` → `{ suggestions: [{ label, text }], noAnswer: boolean }` (0–2 items).
  - `POST /api/chats/:jid/ai/complete` with `{ text }` (the composer text, ≤ 4,096 characters) →
    `{ completion: string | null }`.
  - Both: 409 `ai_suggestions_off` when switched off, 503 `ai_unavailable` when there is no usable connection.
  - Closing the strip / a new keystroke aborts the HTTP request, and the server aborts the model call
    (`req.raw` close → `AbortController`, as `POST /api/ai/edit`).
- **Rate limits** per user: suggestions 20 a minute, completions 60 a minute (`WindowLimiter`, as the edit route).
- **Model call**: one `generateText` with a structured output, no tools, `maxRetries: 0` (as `runRewrite`),
  through the provider of the saved connection (`createAiProvider`); low reasoning effort for completions.
  Sums of listed prices (e.g. 2 × RM12) are allowed by the fact check when each part appears in the sources.
  A completion that takes longer than ~3 s is dropped (it would arrive after the teammate moved on).
- **Confidential items**: each suggestion and completion runs through `findLeak` against the agent's Internal
  items; a hit is dropped silently (the teammate could send it to the customer).
- **Setting**: `ai_reply_suggestions` (boolean, default true), changed only by admins on the AI connection
  route or its own admin route; audited (`ai.reply_suggestions.update`, before/after).
- **Status for every user**: `GET /api/reply-suggestions` (any signed-in user; outside `/api/ai`, whose routes are all admin-only) returns `{ enabled, connected,
state: 'on' | 'off' | 'unavailable', upgraded }` so the composer knows whether to show the button (zod schema
  in `packages/shared` first). Our call in the plan: a small route instead of growing the `/api/me` user payload.
- **Logs**: `mod:"ai"`, kind (`suggest`/`complete`), ok, ms, model, count. Never the composer text, the
  suggestions, the conversation or the customer.

## Web (our call)

- `Composer.tsx`: a ✨ icon button (with tooltip "Suggest reply", ≥ 44 px touch target) next to the quick-reply
  and emoji buttons; the chip strip sits where `QuickReplyPicker` opens (above the text box), shows a loading
  state (2 skeleton chips), the chips, or the "No answer…" chip, and an error line if the call failed.
- Grey completion text: an overlay aligned with the `Textarea` text (the textarea itself never contains the
  grey text, so Send never sends it).
- Settings → AI (`admin/AiConnectionSection.tsx`): a switch "Reply suggestions for the team", with a one-line
  cost note ("Each suggestion is one request to your AI provider"). Disabled with a hint when no connection
  is saved.
- All strings through `t()` in `en`, `ms` and `zh-CN`. Works at 360 px; the strip scrolls horizontally inside
  itself if both chips do not fit, never the page.

## Quality checks (the anti-goal)

- Unit tests use a mock provider (never OpenAI/Claude/ChatGPT): grounded/ungrounded filtering, the leak drop,
  the word-boundary + pause trigger, abort on keystroke, stale completion discard, inbox 404, switch off/on.
- **Dev Build check with real model calls** (only with the owner's sign-in and agreement,
  `e2e/devbuild-ai-check.mjs` pattern): a fixed set of ~15 sample chats (price/stock/delivery enquiry, missing
  fact, complaint, Malay, Chinese, mixed) with seeded business context. For each: are both suggestions relevant
  and different, is any fact invented, is the completion relevant. Logged in `docs/dev-build-checks.md`.
  **Pass mark (owner, 2026-10-25, accepted proposal 4):** no invented fact in any of the 15 chats, and in
  at least 12 chats both suggestions are relevant and different. The feature is not reported as working
  until this check passes.

## Source baseline

- Feature **business-api**, path `docs/features/business-api/mock/`, `latestConfirmed` revision
  `078de13510059504a6e7cb6ac78c381e5936dd4b` (on `main` `61e6bb9` the folder differs only in the
  `reference.json` status). Copied without its `screenshots/`. (A first copy was made from upgrade-enterprise
  `2fce4a7` before #183 merged; it was replaced by this baseline.) `snapshot.mjs --check` verifies the frozen app files and the inherited files.
- Reused: `Composer` (Quick replies button row, reply bar position, `pointer-coarse` touch sizes, the
  `Textarea` auto-height), the `CustomerEnrichmentSection` card pattern (switch + `SaveBar`), `Banner`,
  `SegmentedControl` and `Skeleton`, the mock runner's demo provider and seed (Kopi Apong business context).

## Mock

- Run (Node 22 or later): `npx tsx --conditions=ezychat-source docs/features/ai-reply-suggestions/mock/run.ts --fake-wa`,
  then `http://localhost:7489/` (API `7488`). Sign in as `aisyah` / `demo-pass-123`. Walkthrough: `mock/README.md`.
- Effects: `mock/reply-suggestions.ts` stands in for the future routes with canned, grounded drafts per demo
  chat and a word-match completion (no model call): `POST /api/mock/suggestions`, `POST /api/mock/complete`,
  `GET`/`PUT /api/mock/reply-suggestions` (switch, plus the mock-only install kind and AI behaviour:
  normal / slow / error / connection expired). Browser side: `src/mock/replySuggestions.ts`.
- Seed: one extra Malay chat (Siti Rahman, delivery to Bayan Lepas).
- Screenshots: `node docs/features/ai-reply-suggestions/mock/suggest-shots.mjs` (desktop 1280 / mobile 360
  touch, light / dark, 15 states each) into `mock/screenshots/`; it reports page errors and horizontal scroll.
- Screen-review fix during the mock: on phones the two chips stack (one per line), so both labels show in
  full; wider screens keep one row that scrolls inside itself.

## Screen and state checklist

| Area          | States                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer      | button visible (01); loading (02); 2 chips (03); 1 chip (Jason, by hand); "No answer in the business context" (08); hand-off rule note (09); error with Try again (12); disabled with "not available now" (13); hidden (switched off / no connection, by hand) |
| Chip tap      | empty composer fills (04); typed text → "Replace your text?" confirm (05); long draft multi-line (04)                                                                                                                                                          |
| Completion    | grey text after a full word (06: Tab hint on desktop, Accept pill on touch); accepted (07); Esc dismiss and stale discard (by hand)                                                                                                                            |
| Languages     | English (03), Chinese (10), Malay (11)                                                                                                                                                                                                                         |
| Settings → AI | new install, on (14); updated install, off with "New" note (15); no connection: switch disabled with hint (by hand, sign out in the mock)                                                                                                                      |
| Widths        | desktop 1280, mobile 360; light and dark                                                                                                                                                                                                                       |

## Changed and added files (mock)

- Changed (frozen app files, listed in `reference.json` `proposalChanged`): `src/inbox/Composer.tsx`,
  `src/inbox/Conversation.tsx`, `src/admin/SettingsPage.tsx`, `src/i18n/locales/{en,ms,zh-CN}/{inbox,admin}.json`
  (mock-only texts are English in all three catalogs).
- Added: `src/inbox/ReplySuggestions.tsx`, `src/admin/ReplySuggestionsSection.tsx`, `src/mock/replySuggestions.ts`,
  `reply-suggestions.ts`, `suggest-shots.mjs`.
- Runner: `proposal.ts` registers the routes, `seed.ts` adds the Malay chat, `run.ts` ports 7489/7488
  (business-api keeps 7487/7486).

## Retention

This is the 6th feature folder, so the oldest, `claude-provider` (creation order 8), is removed in the same
change; its last revision stays in `mock-index.json` (`archived`).

## Confirmation

Owner viewed the screenshots (chips, draft, replace confirm, completion on phone and desktop, no answer, hand-off rule, Chinese, Malay, connection expired, Settings → AI) and confirmed 2026-10-26 ("ok"). Reference revision `e7bf307` (`mock-index.json` → `latestConfirmed`).
