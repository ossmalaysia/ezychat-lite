# SPIKE notes — ChatGPT (Codex) direct sign-in protocol

EXPERIMENTAL. Non-public endpoint; borrows the Codex CLI OAuth client identity. Owner-approved spike.
No tokens, codes or account ids are recorded here.

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

| Item | Value | Source |
| --- | --- | --- |
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann` (Codex CLI's public client) | pi-ai `openai-codex.js` `CLIENT_ID` |
| authorize | `https://auth.openai.com/oauth/authorize` | `AUTHORIZE_URL` |
| token | `https://auth.openai.com/oauth/token` | `TOKEN_URL` |
| redirect_uri | `http://localhost:1455/auth/callback` (listener binds `127.0.0.1:1455`) | `REDIRECT_URI`, `startLocalOAuthServer` |
| scope | `openid profile email offline_access` | `SCOPE` |
| PKCE | verifier = random base64url; challenge = base64url(SHA-256(verifier)); `code_challenge_method=S256` | `createAuthorizationFlow` |
| state | random 16 bytes hex; callback rejects mismatch | `createState`, callback handler |
| extra params | `response_type=code`, `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=<id>` (pi-ai default `pi`; Codex uses `codex_cli_rs`) | `createAuthorizationFlow` |

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
