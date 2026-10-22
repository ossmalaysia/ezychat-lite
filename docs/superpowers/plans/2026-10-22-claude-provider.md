# Claude API provider Implementation Plan

> **For agentic workers:** execute task by task; each task is implemented, then reviewed by a fresh agent.

**Goal:** Let an admin run the AI agents on their own Anthropic Claude API key (Lite and Enterprise).
**Spec:** `docs/superpowers/specs/2026-10-22-claude-provider-design.md` (names and values there are binding).
**Tech:** Vercel AI SDK `ai` 7.x + `@ai-sdk/anthropic` 4.x, zod contract, React + TanStack Query.

## Global constraints

- Tests never call Anthropic or OpenAI (fetch stubs / AI SDK mock models). Node 24; vitest `--pool=forks --maxWorkers=2`.
- New response fields get zod `.default()`; a test file that builds `makeTestApp()` or opens a database gets
  `describe(name, { timeout: 30_000 }, …)`.
- Never log, return or audit a key; keep `AgentTurnFailure` kinds; never send OpenAI-only options to Anthropic.
- ≥ 90 % of changed lines covered; `web-client-contract.test.ts` passes; en/ms/zh-CN for every string.
- Subagents do not commit, never run e2e/full suite/screenshots; touch only their files.

## Review focus

1. Switching OpenAI key → Claude → OpenAI key keeps both saved keys and the right one is used.
2. An Anthropic 401/429/529 or a timeout gives the same visible states and log fields as the OpenAI path.
3. The system prompt reaches Anthropic as the system message with cache control; the input JSON stays last.
4. A malformed structured answer from Claude is asked once more, as today (`isMalformedAnswer`).
5. Cloud voice is hidden and refused (409) in `claude` mode; local voice still works.

## Task 1 — Shared + server (files: `packages/shared/src/ai.ts` (+ its tests), `packages/server/src/ai/{settings-keys,claude,chatgpt-direct,key-test,provider-types}.ts`, `packages/server/src/ai/service.ts` (connection, ready, models), `packages/server/src/routes/ai.ts` (connection test, models), `packages/server/package.json` + root lockfile, new tests under `packages/server/test/` and `packages/server/src/ai/*.test.ts`)

Interfaces it produces: `mode` gains `'claude'`; `CLAUDE_MODELS`, `CLAUDE_DEFAULT_MODEL`; status
`hasClaudeApiKey`; `AI_CLAUDE_SECRET_KEY`, `claudeApiKey()`; `claude.ts` `claudeKeyModel`, `generateClaude`,
`extractCustomerClaude`, `rewriteClaude`; `testClaudeKey`; connection test and models routes accept `claude`.

## Task 2 — Mock (files: `docs/features/claude-provider/**`, `docs/features/mock-index.json`, removal of the oldest feature folder per retention)

Clone the custom-agents mock as it is on `main` (revision `117d57e`) into `docs/features/claude-provider/`,
record source + revision in its `design.md`, add the Claude option to Settings → AI, the wizard connect card
and the voice note (mock state only), screenshots 1280/360, `snapshot.mjs --check`, delegated self-review.
Retention: this is the sixth folder → remove the oldest (`docs/features/simple-first-setup`) and record its
last revision in `mock-index.json`.

## Task 3 — Web (after Task 1; files: `apps/web/src/admin/{AiConnectionSection,AiQuickConnect,AiVoiceSection}.tsx` (+ tests), `apps/web/src/api/ai.ts` if needed, `apps/web/src/i18n/locales/*/admin.json`, `docs/ai-sales-agent.md`, `CHANGELOG.md` [Unreleased], AGENTS.md AI section provider sentence)

Match the mock: mode ChatGPT · OpenAI API key · Claude API key; Anthropic key field with saved-note/Replace,
console link, 3-model select, test, save, voice note; voice section hides cloud in `claude` mode.

## Orchestrator (after the tasks)

Typecheck, lint, test:coverage + coverage:changed, e2e, electron-links, Dev Build with a mock model, screen
review 1280/360 (Lite), workbook, PR. Real-Claude check only with the owner's key and consent.
