# SPIKE REPORT — ChatGPT sign-in without the Codex binary (EXPERIMENTAL)

Branch `spike/chatgpt-direct-login`, worktree `D:\dev\wm-spike`. Not committed. Protocol facts with sources: `SPIKE-NOTES.md`.

## What works (unit-tested, mocked network)

- **Switch:** `packages/server/src/ai/provider-factory.ts` → `CHATGPT_TRANSPORT = 'direct'` selects
  `DirectChatGptProvider`; `'codex'` restores the untouched Codex app-server path (`BusinessAiProvider`).
  API-key mode is unchanged (`generateOpenAi`).
- **Sign-in:** `POST /api/ai/chatgpt/login` (admin, Origin/Host checks as before) creates PKCE S256 + random
  state, starts a one-shot listener on `127.0.0.1:1455`, returns `connection.loginUrl`
  (`https://auth.openai.com/oauth/authorize?...`, redirect `http://localhost:1455/auth/callback`).
  Callback: loopback Host only, `GET /auth/callback` only, constant-time state check (a wrong state does
  not end the sign-in), code exchanged, tokens + account id + email saved as ONE encrypted settings secret
  (`ai_chatgpt_direct_tokens`, AES-GCM via `secret.key`), then a "Signed in — you can close this tab" page.
  The listener closes after success, failure, cancel/sign-out, or 5 min. Port in use →
  409 "Port 1455 is in use (another Codex or OpenClaw sign-in may be open)…".
- **Tokens:** refresh 2 min before expiry and once on HTTP 401 (single-flight, refresh-token rotation);
  a 400/401 refresh moves the connection to `error` "ChatGPT sign-in expired. Sign in again."
  `POST /api/ai/chatgpt/logout` cancels sign-in, aborts in-flight answers and deletes the secret. A sign-in/out
  epoch stops late refreshes from re-saving credentials.
- **Models:** `GET /api/ai/models` (admin) → live `GET https://chatgpt.com/backend-api/codex/models?client_version=0.160.0`
  (visibility `list`, by priority, cached 10 min); otherwise `source: 'fallback'` with the documented list
  `gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5`
  (`CHATGPT_FALLBACK_MODELS` in `packages/shared/src/ai.ts`). The shared schema now accepts any model-id-shaped
  value in ChatGPT mode; the server rejects ids not in the cached live list (or the fallback list).
  Auto (`''`) = the first live model (or `gpt-6.1-sol`).
- **Generation:** ChatGPT mode posts to `https://chatgpt.com/backend-api/codex/responses` (stream, `store:false`,
  `text.format` json_schema for the business decision, `reasoning.effort: low`, no tools) and
  aggregates SSE (`response.output_text.delta/done`, `response.completed|done`, `failed/incomplete/error`).
  60 s timeout, aborts on human takeover/logout.
- **Test connection:** `POST /api/ai/chatgpt/test` (admin) sends "Reply with OK" with the saved model and returns
  `{ ok, model, reply | error }`.
- **Web** (`AiMemberPanel`, connection section): "Experimental" warning banner; one-click "Sign in with
  ChatGPT" (opens a blank tab synchronously, saves ChatGPT mode if unsaved, starts sign-in, points the tab at
  the validated authorize URL; if the tab is blocked the existing "Open sign-in" link shows); status polling;
  "Signed in as <email>" + Sign out; Model dropdown "Auto (recommended)" + live models; "Test connection" with
  reply/error. New strings in en, ms, zh-CN; removed now-unused `loginHint`, `saveModeFirst`, `disconnect`,
  `login`, `chatgptModelHint`.
- **Logging/redaction:** only event names, HTTP status and model are logged. `log-redaction.ts` adds token/PKCE
  field names and `redactSecretText` (JWTs, `code=`/`state=`/token query params) for support exports;
  `logger.ts` scrubs message strings through the same function before writing.

## Unverified (needs the controller's live run)

- Nothing was sent to OpenAI. Untested against the real auth server and Codex backend: authorize page
  acceptance of `originator=codex_cli_rs`, the token response fields, the models endpoint and its response
  shape, `text.format` json_schema support on the Codex backend, and the GPT-6.x ids being accepted.
- Account email claim (`https://api.openai.com/profile`.email) and account id claim location (taken from
  OpenClaw/pi-ai; access token first, id token second).
- Browser one-click in a real browser (popup-blocker behaviour); the panel was not opened in a browser.

## Files

New: `packages/server/src/ai/chatgpt-oauth.ts`, `chatgpt-backend.ts`, `chatgpt-direct.ts`, `provider-factory.ts`,
`packages/server/test/ai-chatgpt-direct.test.ts`, `SPIKE-NOTES.md`, `SPIKE-REPORT.md`.
Changed: `packages/shared/src/ai.ts`, `packages/server/src/ai/{provider.ts,provider-types.ts,service.ts}`,
`packages/server/src/routes/ai.ts`, `packages/server/src/{log-redaction.ts,logger.ts}`,
`packages/server/test/ai.test.ts` (accepted ChatGPT ids → `gpt-6-sol`, `gpt-5.5`), `apps/web/src/api/ai.ts`,
`apps/web/src/admin/AiMemberPanel.tsx` + test, `apps/web/src/i18n/locales/{en,ms,zh-CN}/admin.json`,
`docs/LEARNINGS.md`, `CHANGELOG.md`.

## Test results

- `npx vitest run packages/server/test/ai-chatgpt-direct.test.ts packages/server/test/ai.test.ts
  packages/server/test/ai-provider.test.ts packages/server/src/logger.test.ts
  apps/web/src/admin/AiMemberPanel.test.tsx apps/web/src/i18n/catalogs.test.ts` → 6 files, 85 tests passed
  (new: 15 server tests — PKCE RFC 7636 vector, URL params, state, JWT claims, exchange/refresh shapes,
  SSE aggregation incl. split/CRLF/[DONE]/failures, 401 mapping, models filter, redaction, listener
  state/Host/port-in-use, provider sign-in→encrypted storage→401 refresh→retry→sign-out, timeout, route
  admin/Origin checks + model validation; web: dropdown, one-click flow, blocked-tab fallback, test button).
- `npm run typecheck` for shared, server, web: clean. ESLint + Prettier on changed files: clean.
- `npm run build -w @wa-team-inbox/web`: OK. No e2e/full suite run (per instructions).

## Risks

- Non-public endpoint + borrowed Codex OAuth client id/originator/User-Agent (`codex_cli_rs/0.160.0 …
  EzyChat-Lite-experimental`): may break or violate OpenAI terms; OpenAI could block the client.
- Callback is on the server machine's loopback: sign-in only completes from a browser on that computer
  (same as Codex). Remote admins (LAN/tunnel) cannot finish sign-in; no paste-the-URL fallback yet.
- Port 1455 conflicts with a running Codex/OpenClaw sign-in.
- `client_version=0.160.0` is hard-coded; new models may require a newer value.
- The direct path drops the Codex sandbox concerns (no tools are sent), but customer text now goes straight
  to the backend with `store:false`; retention on ChatGPT's side is unknown.
- Tokens are stored encrypted in `app.db` with the per-install `secret.key` (same as API keys), not in the OS
  keyring as the Codex path did.
