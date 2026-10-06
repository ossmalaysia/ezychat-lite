# ChatGPT direct sign-in protocol (EXPERIMENTAL)

Non-public endpoint; borrows the Codex CLI OAuth client identity. Owner-approved. The Codex app-server
helper is no longer bundled or used. No tokens, codes or account ids are recorded here.

Code: `packages/server/src/ai/chatgpt-oauth.ts` (sign-in), `chatgpt-backend.ts` (requests, SSE, models),
`chatgpt-direct.ts` (provider: token storage, refresh, states). Web: `apps/web/src/admin/AiConnectionSection.tsx`.

Sources (owner's machine):

- OpenClaw 2026.4.14 delegates to its bundled `@mariozechner/pi-ai`:
  - `D:\nodejs\node_modules\openclaw\node_modules\@mariozechner\pi-ai\dist\utils\oauth\openai-codex.js` (OAuth)
  - `D:\nodejs\node_modules\openclaw\node_modules\@mariozechner\pi-ai\dist\providers\openai-codex-responses.js` (requests, SSE)
  - `D:\nodejs\node_modules\openclaw\dist\openai-codex-auth-identity-kN3qCOI4.js` (email / expiry from JWT)
  - `D:\nodejs\node_modules\openclaw\dist\openai-codex-catalog-BFm7S8Qb.js` (base URL)
  - `D:\nodejs\node_modules\openclaw\dist\provider-openai-codex-oauth-tls-BKgB0akY.js` (only a TLS preflight probe; confirms redirect URI)
- OpenClaw 2026.4.14 has NO live model-list call and knows only GPT-5.x ids (default `openai-codex/gpt-5.4`,
  `dist\default-models-RayHq4AA.js`). The models endpoint and GPT-6.x ids come from Codex 0.160:
  - `%USERPROFILE%\.codex\models_cache.json` (non-secret cache written by Codex 0.160.0: `client_version`, `models[]`)
  - strings in `D:\nvm4w\nodejs\node_modules\@openai\codex\...\codex.exe` (`/models`, `client_version=`,
    `chatgpt-account-id`, `codex_cli_rs`, `responses_websockets=2026-02-06`)

## OAuth (authorization code + PKCE S256)

| Item         | Value                                                                                                                                                        | Source                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| client_id    | `app_EMoamEEZ73f0CkXaXp7hrann` (Codex CLI's public client)                                                                                                   | pi-ai `openai-codex.js` `CLIENT_ID`     |
| authorize    | `https://auth.openai.com/oauth/authorize`                                                                                                                    | `AUTHORIZE_URL`                         |
| token        | `https://auth.openai.com/oauth/token`                                                                                                                        | `TOKEN_URL`                             |
| redirect_uri | `http://localhost:1455/auth/callback` (listener binds `127.0.0.1:1455`)                                                                                      | `REDIRECT_URI`, `startLocalOAuthServer` |
| scope        | `openid profile email offline_access`                                                                                                                        | `SCOPE`                                 |
| PKCE         | verifier = random base64url; challenge = base64url(SHA-256(verifier)); `code_challenge_method=S256`                                                          | `createAuthorizationFlow`               |
| state        | random 16 bytes hex; callback rejects mismatch                                                                                                               | `createState`, callback handler         |
| extra params | `response_type=code`, `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=<id>` (pi-ai default `pi`; Codex uses `codex_cli_rs`) | `createAuthorizationFlow`               |

Token exchange: `POST TOKEN_URL`, `Content-Type: application/x-www-form-urlencoded`, body
`grant_type=authorization_code&client_id=…&code=…&code_verifier=…&redirect_uri=…`.
Response JSON: `access_token`, `refresh_token`, `id_token`, `expires_in` (seconds). (`exchangeAuthorizationCode`)

Refresh: `POST TOKEN_URL`, form body `grant_type=refresh_token&refresh_token=…&client_id=…`. Response has a NEW
`refresh_token` (rotate and store it) + `access_token` + `expires_in`. (`refreshAccessToken`)

Account id: decode the ACCESS token JWT payload (base64url), claim `["https://api.openai.com/auth"].chatgpt_account_id`
(`getAccountId`, `extractAccountId`). Email: access-token claim `["https://api.openai.com/profile"].email`
(`resolveCodexAuthIdentity`); id_token `email` as a fallback. Expiry may also be read from JWT `exp`.

## Codex responses endpoint

- URL: `https://chatgpt.com/backend-api/codex/responses` (`DEFAULT_CODEX_BASE_URL` + `resolveCodexUrl`)
- Headers (`buildBaseCodexHeaders`, `buildSSEHeaders`):
  - `Authorization: Bearer <access_token>`
  - `chatgpt-account-id: <account id>`
  - `originator: pi` (pi-ai) — Codex itself sends `codex_cli_rs`
  - `User-Agent: pi (<platform> <release>; <arch>)`
  - `OpenAI-Beta: responses=experimental`
  - `accept: text/event-stream`, `content-type: application/json`
  - optional `session_id: <uuid>` (also used as `prompt_cache_key`)
- Body (`buildRequestBody`): `{ model, store: false, stream: true, instructions, input: [Responses input items],
text: { verbosity }, include: ["reasoning.encrypted_content"], prompt_cache_key, tool_choice: "auto",
parallel_tool_calls: true, tools?, reasoning?: { effort, summary } }`. `store:false` + `stream:true` are required by
  the backend. Codex maps an output schema to `text.format = { type: "json_schema", name, strict, schema }`.
- SSE (`parseSSE`, `mapCodexEvents`): events separated by blank line; join `data:` lines; ignore `[DONE]`;
  `type` values: `response.output_text.delta` (`delta`), `response.output_text.done`, `response.completed` /
  `response.done` / `response.incomplete` (final `response` with `status`, `output[]`), `response.failed`
  (`response.error.message`), `error` (`code`, `message`).
- Errors (`parseErrorResponse`): JSON `{ error: { code|type, message, plan_type, resets_at } }`; usage limit codes
  `usage_limit_reached`, `usage_not_included`, `rate_limit_exceeded`, or HTTP 429. Retryable: 429/500/502/503/504.
- A WebSocket transport also exists (`OpenAI-Beta: responses_websockets=2026-02-06`); not used here.

## Models list

- `GET https://chatgpt.com/backend-api/codex/models?client_version=<codex version>` with the same auth headers.
  Response shape matches Codex's cache: `{ models: [{ slug, display_name, visibility: "list"|"hide",
supported_in_api, priority, default_reasoning_level, supported_reasoning_levels[], minimal_client_version? }] }`.
  Models carry `minimal_client_version`, so `client_version` must be recent (we send `0.160.0`).
- Source: Codex binary strings + `models_cache.json` structure. NOT used by OpenClaw; unverified live from this app.
- Live list in owner's Codex 0.160 cache (visibility `list`, by priority): `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`,
  `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` (hidden: `gpt-reserve`, `codex-auto-review`).
  All support reasoning effort `low`.

## How the final implementation uses this

- **Sign-in.** `POST /api/ai/chatgpt/login` creates PKCE + `state` and starts a one-shot listener on
  `127.0.0.1:1455` (closes after success, failure, cancel/sign-out or 5 minutes; port in use returns 409).
  The listener accepts loopback `Host` and `GET /auth/callback` only and compares `state` in constant time.
  When the admin is on another computer (tunnel or LAN) the redirect lands on their own machine, so the page
  offers a paste field: `POST /api/ai/chatgpt/callback` takes the final address, checks `state` exactly like
  the listener, and only one exchange runs per sign-in.
- **Storage.** One encrypted setting `ai_chatgpt_direct_tokens` (AES-GCM, `secret.key`): tokens, account id,
  email. Sign out deletes it and aborts in-flight answers; a sign-in/out epoch stops late refreshes from
  re-saving credentials.
- **Refresh.** 2 minutes before expiry and once after an HTTP 401, single-flight. Refresh tokens rotate, so
  a late 401 first reuses stored tokens newer than the ones that failed instead of replaying a spent token.
- **States.** `expired`: the refresh was rejected (400/401, `invalid_grant`). `error`: the backend answered
  403/404, an HTML page, or 200 with no recognised SSE events (blocked or changed). In both states the AI
  stops claiming chats and releases the ones it owns without messaging customers, and both AI screens show a
  banner. API-key mode is the supported fallback.
- **Request.** `store: false`, `stream: true`, no tools, `text.format` json_schema for the decision,
  `reasoning.effort: low`, 60 s timeout. User agent
  `codex_cli_rs/<client_version> (<os>; <arch>) EzyChat-Lite-experimental`; `client_version` is pinned in
  `CODEX_BACKEND` and must be recent enough for the models' `minimal_client_version`.
- **Models.** Settings → AI lists the live `/codex/models` result (visibility `list`, by priority, cached
  10 minutes), else a documented fallback list. Auto (empty model) resolves to the first live model. A saved
  model that is no longer offered falls back to Auto.
- **Prompt cache key (stable).** `prompt_cache_key` is `ezychat-` + the first 16 hex of
  SHA-256(`ai_install_id` + `
` + model). `ai_install_id` is a random per-install setting; the key never
  contains customer data. It used to be a fresh UUID per request, which made caching impossible. The
  backend accepted the stable key in live checks.
- **Shared `session_id` risk.** As in pi-ai, the same value is also sent as the `session_id` header. Every
  conversation of an install therefore shares one session id; only one install-wide value is sent, so it
  identifies the install, not a customer. If the backend ever rate-limits, groups or rejects by session id,
  the symptom would be errors on all chats at once; the fix is to send a per-request `session_id` and keep
  only `prompt_cache_key` stable. The id is not in support exports (verify before changing exports).
- **Logging.** Only event names, HTTP status and model are logged. Redaction scrubs OAuth URLs, JWTs,
  `code=`/`state=`/token parameters and Bearer values from messages, nested objects, arrays and Errors.

## Not verified

- Terms of use: the borrowed client id and `originator` may violate OpenAI's terms and may be blocked.
- Retention of customer text on ChatGPT's side with `store: false` is unknown.
- `client_version` and the model ids change over time; the endpoint can change without notice.
