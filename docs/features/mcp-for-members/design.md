# AI assistants (MCP) for team members

Status: **proposal, waiting for the owner's confirmation of the mock** (server side built and tested behind it).
Owner request (2026-11-20): "allow non admin can use MCP, and MCP permission respect their own permission like chat or
number that grant to them, they can send msg for their own chat using MCP". Lite core only; Enterprise gets it through
the published core with no Enterprise code.

This changes a security invariant ("AI assistant access … accepts only a personal access token … owner rechecked as an
active admin on every call"). Every other invariant stays.

## Scope

- Admin switch **Members can connect AI assistants** (Settings → Integrations, under "AI assistant access"). Default
  **off**; audited `settings.mcp_members` with before/after. Needs AI assistant access itself to be on.
- While it is on, every active team member (role `agent`, agents limited to chosen chats included) can create their
  own access token on **Your account → AI assistant**, and connect Claude / ChatGPT for themselves through the app
  sign-in (OAuth approve page).
- A member's token sees and does exactly what that person can see and do in the app, rechecked live on every call.
- Not in scope: `inbox:manage` (resolve/reopen, PR #388, not merged): follow-up once #388 is merged; members get it then
  under the same "own chats only" rule. Members never get `ai:setup`.

## Rules

| Rule                      | How                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who may hold a token      | An active, human admin (as today), or an active human **agent** while AI assistant access **and** the members switch are on. Never the AI member, a disabled user or one who must change their password. Checked live on every `/mcp` call and again right before every tool runs (`tokens.resolve` / `stillValid`): the switch going off, the person being disabled or their role changing stops the token at once. |
| Role change               | Any role change (admin → agent **or** agent → admin) revokes all of the person's tokens: a token never gains or loses a whole class of reach silently. Demotion did this already; promotion is new.                                                                                                                                                                                                                  |
| Switch off                | Turning the members switch off revokes every member's token (audit `settings.mcp_members` carries the count) and member sign-ins stop. Turning AI assistant access off keeps tokens (as today) but `/mcp` answers 404 for everyone.                                                                                                                                                                                  |
| Which scopes              | Member tokens get `inbox:read`, plus `inbox:send` / `inbox:send_new` only when the owner ticks them. `ai:setup` is never granted to a member and is dropped at resolve time even if stored (defence in depth): a member never sees an AI setup tool.                                                                                                                                                                 |
| What a member token reads | The same helpers as the app, never a copy: `findChats` checks each chat with `canOpenChat` (inbox scope, chosen chats, hidden chats); `list_chats` lists the chosen chats for an agent limited to chosen chats (`chatJids`, as `GET /api/chats`) and the inbox scope for others; `get_message_file` uses `canOpenChat`. Anything else is "No chat found" / "No message found", never a hint it exists.               |
| Stats                     | `get_stats` and `get_activity` over the member's own inboxes (as Ask Ezy already gives team members). Not offered at all to an agent limited to chosen chats (they have no whole inbox; Ask Ezy is off for them too). Owner decision Q2.                                                                                                                                                                             |
| Sending                   | `send_message` / `send_image` / `send_file` / `send_video` only into an **existing** chat the member may open, as the member, through the normal message service and send queue: same reply window, removed-inbox, media-limit, Safety and per-token rate limits (10 a minute, 100 a day) as an admin token. Audit `mcp.send` {tokenId, chatJid, messageId}, never the text.                                         |
| New numbers               | `send_to_new_number` needs `inbox:send_new` **and** that the member could start a new chat in the app (New chat service: `new_chat_staff` on, not limited to chosen chats, from an inbox they may open), rechecked on every call; the shared daily limit per number and 20 a day per token apply. The member may tick "Can message new numbers" only while they could start one in the app.                          |
| Uploads (`/mcp/uploads`)  | Need `inbox:send` as today; the size cap is the largest media limit of the inboxes the member can see (`visibleInboxIds`).                                                                                                                                                                                                                                                                                           |
| Token pages               | `/api/integrations/tokens*` accept a signed-in member: they list, create, change and revoke **only their own** tokens (another's id → 404). Admins keep seeing and revoking every token; the list shows whose it is and marks members' tokens. `/api` still never accepts a token. Create: 10 a minute per user (unchanged).                                                                                         |
| App sign-in (OAuth)       | `/api/oauth/request` and `/api/oauth/decision` accept a member while the switch is on (else 403 `mcp_members_off`). The approval is always for the signed-in person only (the code carries their user id); there is no way to approve for someone else. The issued token is a member token: `inbox:read` only, no send scope (the member may tick sending later on their account page, like an admin).               |
| Audit and logs            | Unchanged shapes: `api_token.create                                                                                                                                                                                                                                                                                                                                                                                  | update | revoke`, `mcp.app_approve | deny`, `mcp.send`, `chat.new_number`; tool log lines keep tool, token id, count, ms, outcome; never arguments or text. Failed sign-ins log `members_off`/`not_allowed` reasons. |
| Limits                    | Per-token limits unchanged (60 MCP calls a minute, send 10/min 100/day, files 30/min, uploads as today).                                                                                                                                                                                                                                                                                                             |

## Screens (mock: `mock/`)

1. **Settings → Integrations** (admin): under the "AI assistant access" switch, a second switch **Members can connect
   AI assistants** with the hint "Team members can connect Claude or ChatGPT to their own account. The assistant sees
   only the chats that member can open, and sends only if they allow it." Turning it off asks first ("Every member's
   assistant is disconnected"). The token list shows each token's owner, with a **Member** badge on members' tokens;
   an admin can revoke any of them.
2. **Your account → AI assistant** (member): off → a short note "Ask an admin to let members connect AI assistants".
   On → the connect steps (address to paste, as the admin page), **Create access token** (name, expiry, **Can send
   WhatsApp messages**, **Can message new numbers** only when they may start new chats in the app, else greyed with a
   tip), their own tokens with Permissions and Revoke. One line says what it can reach: "It sees the same chats you
   see in EzyChat: N chats" (limited agent) or "your inboxes" (others).
3. **App sign-in approve page** (`/oauth/authorize`) as a member: "Allow Claude to use EzyChat as **Daniel**? It will
   see the chats you can open. It cannot send until you allow it on your account page." Approve / Deny. With the switch
   off: "Your admin has not let members connect AI assistants."
4. **Not found behaviour** (shown as a demo panel in the mock, not a real screen): what the assistant gets for a chat
   outside the member's access ("No chat found for …").

States: switch off / on; member normal / limited to chosen chats / may not start new chats; token list empty / filled /
long names; create dialog with the secret shown once; 1280 and 360, light and dark.

## Open questions for the owner

1. Turning the members switch **off revokes** every member's token (they must create or connect again when it is turned
   back on). Alternative: keep the tokens and refuse them while off. Recommendation: revoke (no surprise reconnects).
2. `get_stats` / `get_activity` for members over their own inboxes (same as Ask Ezy today). Alternative: chats only.
3. Should an admin be able to see and revoke members' tokens on Settings → Integrations? Recommendation: yes (shown).
4. `inbox:manage` (resolve/reopen) for members: after PR #388 is merged, members get the same checkbox, limited to
   chats they can open. OK?

## Confirmation

- [ ] Owner confirms the mock screens and the open questions above.

## Mock

Interactive mock: [`mock/`](mock/README.md) (run with `npx tsx --conditions=ezychat-source docs/features/mcp-for-members/mock/run.ts --fake-wa`,
then `node docs/features/mcp-for-members/mock/members-shots.mjs`; screenshots in [`screenshots/`](screenshots/), desktop 1280 and
mobile 360, light and dark).

- **Baseline (source feature/path):** `app-navigation`, `docs/features/app-navigation/mock/` (mock index `latestConfirmed`, confirmed
  2026-11-13, revision `dc0d5ce640bd06322a86a423a25c88f3f54e58f8`); the files were copied from the tree at git revision
  `f4b650b81ae259f6f71d820007d7e53d187f43fc` (last commit touching that folder, 2026-11-14).
- **Mock only:** the members switch and members' tokens are browser state (`mock/src/mock/members.ts`, localStorage); the mock
  calls no new server endpoint. In the app they are the setting `mcp_members`, `/api/integrations/tokens*` for a signed-in
  member (own tokens) and `/api/oauth/*` for a member, as in Rules above. The OAuth approve page is built in the mock only
  (`/oauth/authorize?mock=1`); in the app the server renders it.
- **Intentionally changed or added files** (everything else is byte-equal to the baseline):
  `README.md`, `members-shots.mjs` (new), `run.ts` (temp-folder name), `seed.ts` (AI assistant access on),
  `src/App.tsx` (route `/oauth/authorize`), `src/auth/OAuthConsentPage.tsx` (new), `src/auth/UserMenu.tsx` (account menu: AI assistant),
  `src/nav/AccountPage.tsx` (member section), `src/nav/MemberAssistantCard.tsx` (new), `src/mock/members.ts` (new),
  `src/admin/IntegrationsSection.tsx` (second switch, confirm dialog, owner and Member badge, admin revoke),
  `src/admin/CreateTokenDialog.tsx` and `src/admin/TokenPermissionsDialog.tsx` (member mode: new numbers greyed with a tip),
  `src/lib/tips.ts` (tip `memberNewChats`), and `src/i18n/locales/{en,ms,zh-CN}/{admin,common}.json` (`mockMembers.*`, `mockTips.memberNewChats`).
- **Check that nothing else drifted:**
  `git diff --no-index --name-only docs/features/app-navigation/mock docs/features/mcp-for-members/mock`
  lists exactly the files above (`reference.json` is untouched).
- Mock open points: the member who "may not start new chats" is shown through `ravi` (limited to chosen chats); a member who is not
  limited always may in the mock. Stats for members (Q2) are not shown in the mock.
