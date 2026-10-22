# Claude API as an AI provider

Status: design written 2026-10-22. The owner delegated the mock review ("You review it yourself"); the
self-review is recorded in `docs/features/claude-provider/design.md`.

## Intent

Today the AI agents run on OpenAI: an OpenAI API key, or the experimental ChatGPT sign-in. Some businesses
already pay for Anthropic and want their **own Claude API key** to run the agents. The owner wants
vendor-neutral AI (memory: ChatGPT, Claude, Gemini, any client). Lite and Enterprise both get it (Enterprise
by moving to the next `@ezychat/*` release; nothing in Enterprise reads the mode).

## Owner decisions (2026-10-22)

| Decision | Choice |
|---|---|
| Sign-in | **API key only** (from console.anthropic.com); no Claude account sign-in |
| Models | **3 fixed models**: Claude Sonnet 5.5 (default), Claude Opus 5.5, Claude Haiku 5.5 |
| Voice notes | **Local voice only** with Claude: cloud transcription needs an OpenAI key, so it is hidden; a short note says why |
| Mock review | Delegated: the agent reviews the mock itself |

## Goals

1. Settings → AI and the setup wizard's AI step offer a third connection: **Claude API key**.
2. Every AI call that uses the connection works with Claude: agent replies (live and Try it), Edit with AI,
   customer enrichment. Same structured decision, same tools, same ≤ 4 steps, same hand-over rules.
3. The key is checked before saving (`GET https://api.anthropic.com/v1/models`), stored encrypted, never
   logged or returned.
4. Switching between OpenAI key, ChatGPT and Claude keeps each saved key; no chat side effects beyond today's
   connection-change behaviour (the AI releases its chats on a failing connection, as now).

## Non-goals

Claude account sign-in; a model list read from the account; per-agent provider or model (one connection for
the install stays); Gemini (later, same pattern); cloud voice with an extra OpenAI key.

## Anti-goals

- A key appears in any log, audit row, API response or error message.
- An OpenAI-only option (`store`, encrypted reasoning, `prompt_cache_key`, `imageDetail`) is sent to Anthropic.
- A Claude failure becomes a generic error the log cannot tell apart (keep `AgentTurnFailure` kinds).
- The prompt order changes (GUARDRAILS → core → role → hand-over → input JSON with dynamic data last).

## Design (my calls)

### Shared (`packages/shared/src/ai.ts`) — additive
- `mode: z.enum(['api', 'chatgpt', 'claude'])` (`api` keeps meaning the OpenAI API key; no rename, so older
  clients and Enterprise keep working).
- `CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const`,
  `CLAUDE_DEFAULT_MODEL = 'claude-sonnet-5-5'`; in `claude` mode the model must be `''` (= default) or one of
  `CLAUDE_MODELS` (same refine pattern as ChatGPT).
- Status gains `hasClaudeApiKey: z.boolean().default(false)` (default for older servers; see LEARNINGS).

### Server
- `ai/settings-keys.ts`: `AI_CLAUDE_SECRET_KEY = 'ai_claude_api_key'`; `claudeApiKey(settings)` (the key only
  in `claude` mode, like `openAiApiKey`). Saving a connection with `apiKey` stores it under the selected
  mode's key (`api` → `ai_api_key`, `claude` → `ai_claude_api_key`); the other key is kept.
- New `ai/claude.ts` (only file that imports `@ai-sdk/anthropic`, version matching `ai` 7.x — 4.x):
  `claudeKeyModel({ apiKey, modelId })`, `generateClaude`, `extractCustomerClaude`, `rewriteClaude` with the
  same signatures as the OpenAI ones in `provider.ts`. `maxOutputTokens: 2000`. Requests go through the same
  safe fetch rules as the OpenAI wrapper (no redirects, fixed error messages, never read or log error bodies).
- **Prompt caching**: the system instructions (GUARDRAILS … hand-over rules) are sent as the system message
  with `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }`; the input JSON stays the last user
  content. `cacheId`/`prompt_cache_key` are not sent to Anthropic.
- `chatgpt-direct.ts` (the provider facade that routes by mode) adds the `claude` branch for generate,
  extractCustomer and rewrite; `service.ts` `ready()` treats `claude` like `api` (ready when a key is saved).
- Images: Claude takes images; the OpenAI-only `imageDetail` option is not sent.
- Errors: 401/403 → `invalid_key`-style provider failure (the connection shows "key rejected", as for OpenAI);
  429 → rate limit; 529 overloaded and 5xx → provider failure; timeouts as today. All keep `AgentTurnFailure`
  `kind`, `causeName`, `status` for the `AI answer unavailable` log line.
- `ai/key-test.ts`: `testClaudeKey(key)` = `GET https://api.anthropic.com/v1/models` with `x-api-key` and
  `anthropic-version: 2023-06-01`; 401 → `invalid_key` (blocks saving), other failures warn only (as today).
  `POST /api/ai/connection/test` accepts `{ mode: 'claude', apiKey }`.
- `GET /api/ai/models` in `claude` mode returns `CLAUDE_MODELS` (no network call).
- Voice: no change needed — `openAiApiKey()` already returns null outside `api` mode, so cloud voice is off.

### Web
- Settings → AI (`AiConnectionSection.tsx`) and the wizard's connect card (`AiQuickConnect.tsx`): connection
  mode **ChatGPT · OpenAI API key · Claude API key**. Claude shows: "Anthropic API key" field (password,
  saved-note + Replace like OpenAI), a link "Get a key at console.anthropic.com" (opens in the OS), a model
  select with the 3 models ("Claude Sonnet 5.5 (recommended)", "Claude Opus 5.5", "Claude Haiku 5.5"), Test
  connection, Save. Note under it: "Voice notes use the on-device model with Claude (cloud transcription needs
  an OpenAI key)."
- Voice section: when the mode is `claude`, the cloud option is hidden with that note.
- en/ms/zh-CN for every string.

### Tests (never call Anthropic)
- `fetch` stubs for the Messages API shape and `/v1/models`; agent turn with tools + structured decision on a
  mocked Claude model (AI SDK `MockLanguageModel` or a stubbed fetch), cache control on the system message,
  no OpenAI options in the request, error mapping per status, key never in logs, settings save keeps both
  keys, models route, connection test route, voice cloud hidden in `claude` mode.
- Dev Build check with a mock model for the wiring; a real-Claude check only with the owner's key and consent.

## Left to the builder

Component split, exact copy within the design system, the AI SDK mock style in tests.
