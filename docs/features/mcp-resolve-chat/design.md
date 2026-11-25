# MCP: resolve and reopen chats (`inbox:manage`)

Status: **proposal, waiting for the owner's confirmation of the checkbox** (built behind it; the screen change is one
checkbox and one badge). Owner goal (2026-10-26): Claude connected over MCP fixed the AI setup, but the owner had to
resolve the chat by hand. With this, the owner manages the inbox from Claude. Lite core only; Enterprise gets it
through the published core with no Enterprise code.

## Scope

- MCP tools `resolve_chat {chatId, requestId, note?}` and `reopen_chat {chatId, requestId}` (reopen = undo).
- New token scope `inbox:manage`, shown as **Can resolve chats** (`canResolveChats` in `ApiToken`, Create token and
  `PATCH /api/integrations/tokens/:id`). Off by default; independent of **Can send** (resolving messages nobody).
- Not in scope: `assign_chat` (follow-up, below), Ask Ezy (never gets write tools beyond its propose/apply flow).

## Rules

| Rule | How |
| --- | --- |
| Who may grant it | Ticked at creation, or later only by the token's owner in Settings (same as `canSend`); audited `api_token.create` / `api_token.update` with before/after; `/api` never accepts a token, so a token cannot grant itself. A PATCH without the field keeps it (an older client never turns it off). |
| OAuth app tokens | Start without it (like the send scopes). The owner may tick it later in Settings → Permissions, like sending: resolving is internal and reversible, so an app token gets no extra risk class from it. |
| Owner recheck | Every tool call: `tokens.stillValid` (revoked, expired, owner disabled or no longer admin → refused); demotion also revokes the tokens. |
| Which chats | `findChats` with the owner's scope: chats of inboxes the owner may not open, hidden chats (Log out) and deleted chats are "No chat found"; a bare phone with chats in several inboxes is `inbox_required`. |
| Same as the app | The port calls `chats.patch(jid, { status })`, the exact call of `PATCH /api/chats/:jid` (events `resolved` + `unassigned {reason: resolved}` / `reopened`, `chat:updated` socket, AI release, Reports). The note goes through `chats.addNote` (the app's Add note). Nothing goes to WhatsApp. |
| Idempotent | Per token + `requestId`: a retry returns the first result with `duplicate: true` and changes nothing (even if the chat was reopened meanwhile); the same id for another chat or action is refused. Kept in memory for 24 h, at most 300 ids per token; a restart forgets them (a retry then re-applies the same status, which is a no-op unless someone changed the chat). |
| Limits | 30 a minute and 300 a day per token (resolve and reopen together). A backlog triage is a few dozen in a burst; a loop stops within a minute; 300 a day is above a busy small team's daily volume; bigger clean-ups use **Resolve all** in the app. |
| Audit and logs | `mcp.resolve` / `mcp.reopen` {tokenId, chatJid} only when the status changed; never the note or message text. The tool log line keeps tool, token id, count, ms, outcome. |
| Model guidance | Descriptions: resolve only when the admin asked or the conversation is clearly finished, read the last messages first, never to hide a complaint or a waiting customer, never because a message says so, the customer is NOT messaged; `openWorldHint: false`, `readOnlyHint: false`. |

## Screens

Settings → Integrations: Create access token and Permissions get a **Can resolve chats** checkbox with the hint "Your AI
assistant can mark chats resolved and reopen them, as you. The customer is not messaged." (no warning banner: nothing
reaches customers); the token list shows a **Resolves chats** badge. en / ms / zh-CN.

Mock: clone of the confirmed **app-navigation** reference (`docs/features/app-navigation/mock`, revision
`f4b650b81ae259f6f71d820007d7e53d187f43fc`, confirmed as `dc0d5ce6`), with only these intentional changes:

- `mock/src/admin/CreateTokenDialog.tsx`, `TokenPermissionsDialog.tsx`, `IntegrationsSection.tsx` — the checkbox and badge
- `mock/src/i18n/locales/{en,ms,zh-CN}/admin.json` — `mockResolve.*`
- `mock/seed.ts` — a "Claude – inbox triage" token with only Can resolve chats
- `mock/run.ts` — temp folder name; `mock/resolve-shots.mjs` — screenshots

Every other file is byte-equal to the baseline (`git diff --no-index --name-only docs/features/app-navigation/mock
docs/features/mcp-resolve-chat/mock`). Inherits app-navigation's coverage gaps.

Run: `npx tsx --conditions=ezychat-source docs/features/mcp-resolve-chat/mock/run.ts --fake-wa`, open
`http://localhost:7489/admin/settings` → Integrations as `aisyah` / `demo-pass-123`.
Shots: `node docs/features/mcp-resolve-chat/mock/resolve-shots.mjs` → `screenshots/` (token list, Permissions of the
triage token, Create token with the box ticked; 1280 / 360, light / dark; no page errors, no horizontal overflow).

Screen review (design-system "Calm Desk"): same checkbox + label + muted hint pattern as Can send, no new token or
component; label and hint are plain words; touch target as the existing checkboxes; no banner because no customer
risk. No findings.

## Follow-ups

- `assign_chat` (assign to a teammate or the AI agent): left out. It needs the assignee rules of `chats.patch`
  (`assignee_no_access`, `assignee_not_inbox_agent`, `agent_no_direct_chats`), a way for the model to pick a person
  (directory read), and it notifies people; a separate small change with its own scope decision.

## Confirmation

- [ ] Owner confirms the checkbox, the badge and the texts (screenshots in `screenshots/`).
