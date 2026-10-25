# AI Reply Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teammate in a direct chat presses **Suggest reply** and gets up to 2 grounded draft chips, or grey completion text after a full word; the AI never sends.

**Architecture:** A new server module builds a draft prompt (`GUARDRAILS` + fixed `DRAFT_RULES`, same input order as live replies), makes one tool-free structured model call through a new optional `AiProvider.draft`, then filters the output (grounded flag, server fact check, leak check). Per-chat routes in a new route file expose it to every signed-in user with inbox access; one admin switch (setting `ai_reply_suggestions`, written `false` by a migration for existing installs). The web composer ports the confirmed mock.

**Tech Stack:** TypeScript strict ESM, Fastify, zod (`packages/shared`), Vercel AI SDK `generateText` + `Output.object`, better-sqlite3 migrations, React + TanStack Query + shadcn/ui, Vitest, Playwright.

**Spec:** `docs/features/ai-reply-suggestions/design.md`; UI reference: the confirmed mock `docs/features/ai-reply-suggestions/mock/` (revision `e7bf307`), files `src/inbox/Composer.tsx`, `src/inbox/ReplySuggestions.tsx`, `src/admin/ReplySuggestionsSection.tsx`, `src/mock/replySuggestions.ts`.

## Global Constraints

- Node 22+ (`node -v`; on this PC put `D:\nvm\v24.13.0` first on PATH). Tests never call OpenAI, Anthropic or ChatGPT: mock providers only.
- Direct chats only (`chat.type === 'dm'`); groups answer 400 `validation`.
- Suggestions: 0–2 items, label ≤ 40 characters, text ≤ 4,096 characters; completion ≤ 120 characters; composer text in ≤ 4,096 characters.
- Completion: only when the text ends with a letter/digit followed by whitespace or punctuation (`/[\p{L}\p{N}][\s,.!?，。？]$/u`), never for text starting with `/`, after a 500 ms pause; a server call longer than 3,000 ms returns `{ completion: null }`.
- Rate limits per user: suggestions 20/min, completions 60/min (`WindowLimiter`, 429).
- Setting `ai_reply_suggestions` (JSON boolean), missing = `true`; migration writes `false` when the DB already has users.
- Errors: 409 `ai_suggestions_off` (switched off), 503 `ai_unavailable` (no usable connection: not `connected`).
- Logs (`mod:"ai"`): `{ event: 'ai_draft', kind, ok, ms, model, count }` only. Never composer text, drafts, conversation or customer data.
- Audit `ai.reply_suggestions.update` with `{ before, after }` booleans.
- Every user-visible string through `t()` in `en`, `ms`, `zh-CN` (`docs/i18n.md`); no raw `<button>`, palette colours; 360 px without horizontal scroll.
- Prompt: `GUARDRAILS` first, unchanged; `DRAFT_RULES` is a constant with no interpolation; then agent instructions + hand-off rules; input JSON keys in order `internalKnowledge`, `businessKnowledge`, `conversation`, `currentSituation` (customer via `aiCustomer`, last). `cacheId = <installId>#agent:<id|0>`.

## Review Focus

1. **Stale completion after fast typing** — a completion for "Hi Nurul " must never show once the text is "Hi Nurul, sure ". Test in Task 8 (`discards a completion for older text`).
2. **Draft with an invented price** — the model marks it grounded but writes "RM15" that no source contains: the chip must not show. Test in Task 3 (`drops a grounded draft with a number not in the sources`).
3. **Internal item copied into a draft** — the teammate could send it to the customer. Test in Task 3 (`drops a draft that leaks an Internal item`).
4. **Agent removed from the inbox / no agent** — drafts still work from the conversation and customer details only. Test in Task 5 (`uses no business context when the inbox has no agent`).
5. **Teammate without access to the inbox** — 404, no model call. Test in Task 6 (`answers 404 outside the caller's inboxes`).

---

### Task 1: Shared contract

**Files:**
- Create: `packages/shared/src/reply-suggestions.ts`
- Modify: `packages/shared/src/index.ts` (export it)
- Test: `packages/shared/test/reply-suggestions.test.ts`

**Interfaces:**
- Produces:
  - `ReplySuggestionsState = z.enum(['on', 'off', 'unavailable'])`
  - `ReplySuggestionsStatus = z.object({ enabled: z.boolean(), connected: z.boolean(), state: ReplySuggestionsState, upgraded: z.boolean().default(false) })` (`upgraded`: the install existed before the feature)
  - `ReplySuggestionsBody = z.strictObject({ enabled: z.boolean() })`
  - `ReplySuggestion = z.object({ label: z.string().min(1).max(40), text: z.string().min(1).max(4096) })`
  - `ReplySuggestionsResult = z.object({ suggestions: z.array(ReplySuggestion).max(2), noAnswer: z.boolean(), handoffRule: z.string().max(200).nullable() })`
  - `ReplyCompleteBody = z.strictObject({ text: z.string().min(1).max(4096) })`
  - `ReplyCompleteResult = z.object({ completion: z.string().max(120).nullable() })`
  - `REPLY_COMPLETION_READY = /[\p{L}\p{N}][\s,.!?，。？]$/u` and `completionReady(text: string): boolean` (also false when `text.trimStart().startsWith('/')`)

- [ ] **Step 1:** Test: `completionReady('Hi Nurul ')` true, `('Hi Nu')` false, `('/menu ')` false, `('你好，')` true, `('')` false; `ReplySuggestionsResult.parse` rejects 3 suggestions and a 41-character label.
- [ ] **Step 2:** Run `npx vitest run packages/shared/test/reply-suggestions.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the schemas and `completionReady`; export from `index.ts`.
- [ ] **Step 4:** Run the test → PASS; `npm run typecheck -w @ezychat/shared` → no errors.
- [ ] **Step 5:** Commit `feat(shared): reply suggestion contract`.

### Task 2: Setting, migration and upgrade path

**Files:**
- Create: `packages/server/src/db/migrations/020_reply_suggestions_existing.sql`
- Create: `packages/server/src/ai/reply-suggestions-setting.ts`
- Modify: `packages/server/test/upgrade-from-oldest.test.ts` (seed + assertion)
- Test: `packages/server/test/reply-suggestions-setting.test.ts`

**Interfaces:**
- Produces: `REPLY_SUGGESTIONS_KEY = 'ai_reply_suggestions'`, `REPLY_SUGGESTIONS_UPGRADED_KEY = 'ai_reply_suggestions_upgraded'`; `replySuggestionsEnabled(settings: SettingsStore): boolean` (missing → `true`); `replySuggestionsUpgraded(settings: SettingsStore): boolean` (missing → `false`); `setReplySuggestions(ctx: AppContext, enabled: boolean, actor: Actor): void` (writes the setting, audits `ai.reply_suggestions.update` `{ before, after }`).

- [ ] **Step 1:** Tests: a fresh test app (`makeTestApp`) → `replySuggestionsEnabled` is `true`; `setReplySuggestions(ctx, false, actor)` → `false` and one audit row with `{ before: true, after: false }`; in `upgrade-from-oldest.test.ts`, the seeded old install (it has users) starts with `ai_reply_suggestions = false` and `ai_reply_suggestions_upgraded = true`.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Migration body: `INSERT OR IGNORE INTO settings (key, value) SELECT 'ai_reply_suggestions', 'false' WHERE EXISTS (SELECT 1 FROM users);` and the same for `'ai_reply_suggestions_upgraded', 'true'` (a new install has no users while migrations run, so it keeps the default `true`). Implement the two functions.
- [ ] **Step 4:** Run both files → PASS.
- [ ] **Step 5:** Commit `feat(ai): reply suggestions setting, off for existing installs`.

### Task 3: Draft prompt and output checks

**Files:**
- Create: `packages/server/src/ai/draft-prompt.ts`
- Create: `packages/server/src/ai/draft-check.ts`
- Test: `packages/server/src/ai/draft-prompt.test.ts`, `packages/server/src/ai/draft-check.test.ts`

**Interfaces:**
- Consumes: `GUARDRAILS`, `businessHandoffRules`, `AiConversationTurn`, `AiCustomer` (`ai/prompt.ts`); `findLeak` (`ai/leak-check.ts`).
- Produces:
  - `DRAFT_RULES: string` (fixed text, see Step 3)
  - `buildDraftPrompt(input: { kind: 'suggest' | 'complete'; instructions: string; handoffRules: string; internalKnowledge: string; businessKnowledge: string; conversation: AiConversationTurn[]; customer: AiCustomer | null; now: Date; timeZone: string; typed?: string }): { instructions: string; input: string }`
  - `DraftOutput = z.object({ suggestions: z.array(z.object({ label: z.string(), text: z.string(), grounded: z.boolean() })).max(2), noAnswer: z.boolean(), handoffRule: z.string().nullable() })`
  - `CompletionOutput = z.object({ completion: z.string().nullable(), grounded: z.boolean() })`
  - `ungroundedNumbers(text: string, sources: string): string[]` — numeric tokens (`/\d+(?:[.,:]\d+)*/g`, e.g. `12`, `3.50`, `1042`, `10:30`) in `text` that are not in `sources`; a token equal to a sum or a product of two numbers from `sources` counts as grounded (2 × RM12 = 24).
  - `acceptDrafts(output: DraftOutput, sources: string, internalTexts: readonly string[]): ReplySuggestionsResult` — drop ungrounded, `ungroundedNumbers` non-empty, `findLeak` true, blank text; drop the second when its text equals the first after whitespace/case normalisation; trim labels to 40 characters (cut at a word, add `…`); if `handoffRule` is set, return no suggestions; `noAnswer` true when nothing is left and no hand-off rule.
  - `acceptCompletion(output: CompletionOutput, typed: string, sources: string, internalTexts: readonly string[]): string | null` — null when not grounded, blank, a leak, a new number, or longer than 120 characters; cut at the first sentence end (`.!?。？`) inclusive.

- [ ] **Step 1:** Prompt tests: `instructions` starts with `GUARDRAILS`; it contains `DRAFT_RULES` and not the `CORE_RULES` decision text "Does that answer your question?"; `JSON.parse(input)` key order is `['internalKnowledge','businessKnowledge','conversation','currentSituation']`; `currentSituation.customer` holds the customer; `currentSituation.typed` exists only for `complete`; two calls with different conversations have identical `instructions` (cache prefix).
- [ ] **Step 2:** Check tests: `drops a grounded draft with a number not in the sources` (sources "Nasi Lemak Ayam RM12", draft "RM15" → removed, `noAnswer` true); `keeps a total of listed prices` ("2 for RM24" with RM12 in sources → kept); `drops a draft that leaks an Internal item` (40-character run); `returns a note instead of drafts when a hand-off rule matches`; `drops a near-copy of the first draft`; `trims a long label at a word`; completion: `cuts at the end of the sentence`, `rejects more than 120 characters`, `rejects an ungrounded completion`.
- [ ] **Step 3:** Run both test files → FAIL. Then implement. `DRAFT_RULES` copy (fixed, English):

```text
You write reply drafts for a team member of this business, who reads, edits and sends them. Write as the team ("we"), never as an AI and never with an agent name.
Use only facts from the conversation, the customer details and the knowledge sections. Never invent a price, stock, date, time, policy or delivery promise, and never confirm an order, booking, payment, refund or cancellation that the knowledge does not support.
Mark a draft grounded only if every fact in it comes from those sources. If the knowledge does not answer the customer's request, return no drafts and noAnswer true.
If one of the business hand-off rules matches the customer's request, return no drafts and set handoffRule to a short name of that rule.
Reply in the language of the customer's last message.
For suggestions: write up to two drafts that answer the customer's open request in two different ways (for example answer now, or ask for one missing detail first). Each has a label of at most 40 characters that says what the draft does.
For a completion: continue the team member's text in currentSituation.typed to the end of the current sentence only; return null when you are not sure.
```

- [ ] **Step 4:** Run both test files → PASS.
- [ ] **Step 5:** Commit `feat(ai): draft prompt and grounded output checks`.

### Task 4: Provider draft call

**Files:**
- Create: `packages/server/src/ai/agent/draft.ts`
- Modify: `packages/server/src/ai/provider-types.ts` (optional `draft`), `packages/server/src/ai/provider.ts`, `packages/server/src/ai/claude.ts`, `packages/server/src/ai/chatgpt-direct.ts`
- Test: `packages/server/src/ai/agent/draft.test.ts`, extend `packages/server/src/ai/claude.test.ts`

**Interfaces:**
- Consumes: `DraftOutput`, `CompletionOutput` (Task 3).
- Produces:
  - `runDraft<T>(call: { model: LanguageModel; prompt: AiRewritePrompt; schema: z.ZodType<T>; signal: AbortSignal; maxOutputTokens: number }): Promise<T>` — like `runRewrite` (`maxRetries: 0`, `Output.object`).
  - `AiProvider.draft?<T>(settings: AiSettings, apiKey: string | null, prompt: AiRewritePrompt, schema: z.ZodType<T>, signal: AbortSignal, options: { fast: boolean }): Promise<{ output: T; model: string }>`
  - `DRAFT_FAST_MODELS = { api: OPENAI_DEFAULT_MODEL, claude: 'claude-haiku-5-5' }`; `fast: true` (completions) uses these; ChatGPT mode always uses the saved model; `maxOutputTokens` 2,000 (suggest) / 300 (complete).

- [ ] **Step 1:** Tests with the AI SDK mock language model (`MockLanguageModelV2` as in `rewrite.test.ts`): `runDraft` parses the structured object, aborts on a pre-aborted signal, and passes `maxRetries: 0`; Claude `draft` with `fast: true` uses `claude-haiku-5-5` even when `claude-opus-5-5` is saved.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement following the `rewrite` path in each provider file (`withOpenAiKey`, `withClaudeKey`, `this.turn`).
- [ ] **Step 4:** Run → PASS; `npm run typecheck -w @ezychat/server`.
- [ ] **Step 5:** Commit `feat(ai): one-call structured draft through each provider`.

### Task 5: AI service draft method

**Files:**
- Modify: `packages/server/src/ai/service.ts` (interface + implementation next to `editText`)
- Test: `packages/server/test/ai-reply-draft.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `agentForInbox(ctx.db, inboxOfKey(jid))` (the chat's agent **whether enabled or not**), `settingsFor`, `contextItems`, `splitKnowledge`, `relevantKnowledge`, `conversation`, `aiCustomer`, `installId`, `resolveAiTimeZone`.
- Produces: `AiService.draftReply(jid: string, request: { kind: 'suggest' } | { kind: 'complete'; typed: string }, signal: AbortSignal): Promise<ReplySuggestionsResult | ReplyCompleteResult>`; throws `HttpError` 409 `ai_suggestions_off` / 503 `ai_unavailable`.

- [ ] **Step 1:** Tests with a mock `AiProvider` whose `draft` records the prompt and returns fixed output: `uses the agent's business context while the agent is off`; `uses no business context when the inbox has no agent` (`businessKnowledge` is `''`); `sends the last 20 messages and the saved customer details`; `throws ai_suggestions_off when switched off` (no provider call); `throws ai_unavailable when the connection is expired`; `returns completion null after 3 s` (provider never resolves; fake timers); `logs kind, ok, ms, model and count only` (log line has no draft or text field).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: knowledge query = last 3 customer messages (as live replies); sources string for checks = business + conversation texts + customer JSON; suggestions use `AbortSignal.any([signal, AbortSignal.timeout(30_000)])`, completions `AbortSignal.timeout(3_000)` (timeout → `{ completion: null }`, not an error).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ai): draft replies from the chat's agent knowledge`.

### Task 6: Routes

**Files:**
- Create: `packages/server/src/routes/reply-suggestions.ts`
- Modify: `packages/server/src/routes/index.ts` (register)
- Test: `packages/server/test/reply-suggestions-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5; `chatJidParam` (`routes/chats.ts`), `requireUser`, `WindowLimiter`, the abort-on-close pattern of `POST /ai/edit` in `routes/ai.ts`.
- Produces:
  - `GET /api/ai/reply-suggestions` (any user) → `ReplySuggestionsStatus` (`state`: `off` when disabled or no saved connection, `unavailable` when saved but not `connected`, else `on`; `upgraded` from `replySuggestionsUpgraded`).
  - `PUT /api/ai/reply-suggestions` (admin; recheck role after parse) body `ReplySuggestionsBody` → `ReplySuggestionsStatus`.
  - `POST /api/chats/:jid/ai/suggestions` → `ReplySuggestionsResult`; `POST /api/chats/:jid/ai/complete` body `ReplyCompleteBody` → `ReplyCompleteResult`.

- [ ] **Step 1:** Tests (`makeTestApp`, mock provider): `answers 404 outside the caller's inboxes` (multi-inbox setup as in `multi-inbox-chats.test.ts`; provider not called); `answers 400 for a group chat`; `agent may read the status but not change it` (PUT → 403); `PUT audits before/after`; `rate-limits suggestions at 20 a minute` (21st → 429); `aborts the model call when the client disconnects`; `answers 403 while the access gate is closed`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; keep paths literal so `web-client-contract.test.ts` can read them.
- [ ] **Step 4:** Run this file and `packages/server/test/web-client-contract.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(server): reply suggestion routes`.

### Task 7: Mock-model Dev Build runner support

**Files:**
- Modify: `e2e/agents-devbuild.ts` (mock provider gets `draft`)
- Create: `e2e/devbuild-suggestions-check.mjs`

**Interfaces:**
- Produces: the mock `draft` returns, for `suggest`, two drafts built from the business-context line that shares the most words with the last customer message (`grounded: true`), or `noAnswer` when none matches; for `complete`, the rest of that line after the typed words, else null. The check script signs in, links fake WhatsApp, seeds context + a customer message, and asserts both routes, the switch and the 404 for an agent without access.

- [ ] **Step 1:** Write the check script with the assertions above.
- [ ] **Step 2:** Run the runner (`npx tsx --conditions=ezychat-source e2e/agents-devbuild.ts --fake-wa --port 7491`) and the script → FAIL (no `draft`).
- [ ] **Step 3:** Add `draft` to the mock provider.
- [ ] **Step 4:** Run again → all assertions pass.
- [ ] **Step 5:** Commit `test(e2e): mock-model Dev Build check for reply suggestions`.

### Task 8: Web composer

**Files:**
- Create: `apps/web/src/api/reply-suggestions.ts`, `apps/web/src/inbox/ReplySuggestions.tsx`
- Modify: `apps/web/src/inbox/Composer.tsx`, `apps/web/src/inbox/Conversation.tsx`, `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json`
- Test: `apps/web/src/inbox/Composer.test.tsx` (extend), `apps/web/src/inbox/ReplySuggestions.test.tsx`

**Interfaces:**
- Consumes: Task 1 schemas and `completionReady`; Task 6 routes.
- Produces: `useReplySuggestionsStatus()` (query key `['ai', 'replySuggestions']`, staleTime 60 s), `fetchSuggestions(jid, signal)`, `fetchCompletion(jid, text, signal)`; `Composer` prop `aiSuggest?: { chatJid: string; lastCustomerMessageId: string | null; isAdmin: boolean } | null` (as in the mock); `ReplySuggestions` props as in the mock (`strip`, `isAdmin`, `onPick`, `onRetry`, `onClose`).

- [ ] **Step 1:** Tests (fake timers, mocked `api`): button hidden when state `off`, disabled with the "not available" text when `unavailable`; two chips after a click; a chip fills an empty box; with typed text a chip asks `Replace your text with this suggestion?` and **Keep my text** keeps it; `requests a completion only after a full word and a 500 ms pause` (typing "Hi Nu" → no call); `discards a completion for older text`; Tab accepts, Esc dismisses; Send never sends the grey text; a new `lastCustomerMessageId` clears the chips; the strip has no horizontal page overflow class (`overflow-x-auto` only on `sm:`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port the mock files: replace `@/mock/replySuggestions` with `@/api/reply-suggestions`; keep the layout (phones stack chips, `sm:` row), touch sizes, overlay and keys exactly; catalog keys under `composer.suggest.*` (rename from `mockSuggest.*`) with real `ms` and `zh-CN` translations.
- [ ] **Step 4:** Run the web tests → PASS; `npm run lint`; `npm run typecheck -w @ezychat/web`.
- [ ] **Step 5:** Commit `feat(web): suggest reply chips and completion in the composer`.

### Task 9: Settings → AI switch, docs and changelog

**Files:**
- Create: `apps/web/src/admin/ReplySuggestionsSection.tsx`
- Modify: `apps/web/src/admin/SettingsPage.tsx` (after `<AiConnectionSection />`), `apps/web/src/i18n/locales/{en,ms,zh-CN}/admin.json`, `CHANGELOG.md` (`[Unreleased]`), `AGENTS.md` (one sentence in **AI agents**), `docs/ai-sales-agent.md` (short section)
- Test: `apps/web/src/admin/ReplySuggestionsSection.test.tsx`

**Interfaces:**
- Consumes: Task 6 `GET`/`PUT /api/ai/reply-suggestions`.

- [ ] **Step 1:** Tests: switch on/off + Save calls PUT with `{ enabled }`; switch disabled with the no-connection hint when `connected` is false; the "New: reply suggestions" note shows when `enabled` is false and `upgraded` is true.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Port the mock card without the dashed "Mock only" box; keys `settings.replySuggestions.*`.
- [ ] **Step 4:** Run → PASS; lint; typecheck.
- [ ] **Step 5:** Commit `feat(web): reply suggestions switch in Settings → AI`.

### Task 10: Final verification (main agent only)

- [ ] **Step 1:** `npm run typecheck`, `npm test`, `npm run lint`, web build, `npm run test:coverage` + `npm run coverage:changed` (≥ 90 % of changed lines).
- [ ] **Step 2:** `npm run e2e` (add `e2e/reply-suggestions.spec.ts`: switch, hidden/visible button, the error strip with a placeholder key's failed call is **not** exercised — no model call; use the mock runner of Task 7 for behaviour) and `npm run e2e:electron-links`.
- [ ] **Step 3:** Screen review against the mock screenshots (desktop 1280 / mobile 360, light/dark); refresh `docs/screenshots/`.
- [ ] **Step 4:** Dev Build check: Task 7 script on the final commit; the real-model check (15 sample chats, pass mark: no invented fact in any chat, both chips relevant and different in ≥ 12) only with the owner's sign-in and agreement; log both in `docs/dev-build-checks.md`.
- [ ] **Step 5:** Record each stage with `node scripts/build-summary.mjs record …`; update `docs/LEARNINGS.md`; commit and push.
