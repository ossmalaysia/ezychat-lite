# AI assistants (MCP) for team members

Status: **mock confirmed by the owner 2026-11-20** ("ok approve mcp mock"); production UI built from it.
Owner request (2026-11-20): "allow non admin can use MCP, and MCP permission respect their own permission like chat or
number that grant to them, they can send msg for their own chat using MCP". Lite core only; Enterprise gets it through
the published core with no Enterprise code.

This changes a security invariant ("AI assistant access … accepts only a personal access token … owner rechecked as an
active admin on every call"). Every other invariant stays.

## Scope

- Admin switch **Members can connect AI assistants** (Settings → Integrations, under "AI assistant access"). Default
  **off**; audited `settings.mcp_members` with before/after. Needs AI assistant access itself to be on.
- While it is on, every active team member (role `agent`, agents limited to chosen chats included) can connect Claude /
  ChatGPT for themselves **only through the app sign-in** (OAuth: dynamic client registration → `/oauth/authorize`,
  approve for themselves). Owner decision 2026-11-20: "no need mcp token, use dynamic oauth will do, mcp token still
  consider master token for now" — members never create personal access tokens; those stay admin-only "master tokens".
- Members see their connected apps on **Your account → My AI assistants** (Permissions, Disconnect).
- A member's token sees and does exactly what that person can see and do in the app, rechecked live on every call.
- Not in scope: `inbox:manage` (resolve/reopen, PR #388, not merged): follow-up once #388 is merged; members get it then
  under the same "own chats only" rule. Members never get `ai:setup`.

## Rules

| Rule                      | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who may hold a token      | An active, human admin (as today), or an active human **agent** while AI assistant access **and** the members switch are on. Never the AI member, a disabled user or one who must change their password. Checked live on every `/mcp` call and again right before every tool runs (`tokens.resolve` / `stillValid`): the switch going off, the person being disabled or their role changing stops the token at once.                                                                                                                      |
| Role change               | Any role change (admin → agent **or** agent → admin) revokes all of the person's tokens: a token never gains or loses a whole class of reach silently. Demotion did this already; promotion is new.                                                                                                                                                                                                                                                                                                                                       |
| Switch off                | Turning the members switch off revokes every member's token (audit `settings.mcp_members` carries the count) and member sign-ins stop. Turning AI assistant access off keeps tokens (as today) but `/mcp` answers 404 for everyone.                                                                                                                                                                                                                                                                                                       |
| Which scopes              | Member tokens get `inbox:read`, plus `inbox:send` / `inbox:send_new` only when the owner ticks them. `ai:setup` is never granted to a member and is dropped at resolve time even if stored (defence in depth): a member never sees an AI setup tool.                                                                                                                                                                                                                                                                                      |
| What a member token reads | The same helpers as the app, never a copy: `findChats` checks each chat with `canOpenChat` (inbox scope, chosen chats, hidden chats); `list_chats` lists the chosen chats for an agent limited to chosen chats (`chatJids`, as `GET /api/chats`) and the inbox scope for others; `get_message_file` uses `canOpenChat`. Anything else is "No chat found" / "No message found", never a hint it exists.                                                                                                                                    |
| Stats                     | `get_stats` and `get_activity` are admins only over MCP (`ToolDef.adminOnly`): a member's assistant gets chats only (owner decision 2026-11-20; stats for members may come later). Ask Ezy is unchanged.                                                                                                                                                                                                                                                                                                                                  |
| Sending                   | `send_message` / `send_image` / `send_file` / `send_video` only into an **existing** chat the member may open, as the member, through the normal message service and send queue: same reply window, removed-inbox, media-limit, Safety and per-token rate limits (10 a minute, 100 a day) as an admin token. Audit `mcp.send` {tokenId, chatJid, messageId}, never the text.                                                                                                                                                              |
| New numbers               | `send_to_new_number` needs `inbox:send_new` **and** that the member could start a new chat in the app (New chat service: `new_chat_staff` on, not limited to chosen chats, from an inbox they may open), rechecked on every call; the shared daily limit per number and 20 a day per token apply. The member may tick "Can message new numbers" only while they could start one in the app.                                                                                                                                               |
| Uploads (`/mcp/uploads`)  | Need `inbox:send` as today; the size cap is the largest media limit of the inboxes the member can see (`visibleInboxIds`).                                                                                                                                                                                                                                                                                                                                                                                                                |
| Token pages               | `POST /api/integrations/tokens` (create a personal access token) is **admins only** (403 for members; the service refuses too). `GET`/`PATCH`/`DELETE` accept a member for **only their own** connected apps (list, Can send / Can message new numbers, disconnect; another's id → 404/403). Admins see and revoke every token; the list marks members' entries. `/api` never accepts a token.                                                                                                                                            |
| App sign-in (OAuth)       | `/api/oauth/request` and `/api/oauth/decision` accept a member while the switch is on (else 403 `mcp_members_off`). The approval is always for the signed-in person only (the code carries their user id); there is no way to approve for someone else. The page has **Let it send WhatsApp messages as you** (off by default; `canSend` in the decision, carried in the one-time code, audited on `mcp.app_approve`); the token is `inbox:read` (+ `inbox:send` only if ticked), never `ai:setup`; changeable later on My AI assistants. |
| Audit and logs            | Unchanged shapes: `api_token.create                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | update | revoke`, `mcp.app_approve | deny`, `mcp.send`, `chat.new_number`; tool log lines keep tool, token id, count, ms, outcome; never arguments or text. Failed sign-ins log `members_off`/`not_allowed` reasons. |
| Limits                    | Per-token limits unchanged (60 MCP calls a minute, send 10/min 100/day, files 30/min, uploads as today).                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Screens (mock: `mock/`)

1. **Settings → Integrations** (admin): under the "AI assistant access" switch, a second switch **Members can connect
   AI assistants** with the hint "Team members can connect Claude or ChatGPT to their own account. The assistant sees
   only the chats that member can open, and sends only if they allow it." Turning it off asks first ("Every member's
   assistant is disconnected"). The token list shows each token's owner, with a **Member** badge on members' tokens;
   an admin can revoke any of them.
2. **Your account → My AI assistants** (member): off → a short note "Ask an admin to let members connect AI
   assistants". On → how to connect (add EzyChat as a connector in Claude or ChatGPT with this address; it opens the
   sign-in page here), the address with Copy, and the member's **connected apps** (Connected app / Can send badges;
   Permissions: **Can send WhatsApp messages**, **Can message new numbers** greyed with a tip when they cannot start new
   chats; **Disconnect** with a confirm). Empty state "No assistant connected yet". No Create access token for members.
3. **App sign-in approve page** (`/oauth/authorize`) as a member: "Allow Claude to use EzyChat as **Daniel**? It will
   see the chats you can open." Checkbox **Let it send WhatsApp messages as you** (off; "Only into chats you can open.
   You can change this later in My AI assistants."). Allow / Deny. Switch off: "Your admin has not let members connect
   AI assistants."
4. **Not found behaviour** (shown as a demo panel in the mock, not a real screen): what the assistant gets for a chat
   outside the member's access ("No chat found for …").

States: switch off / on; member normal / limited to chosen chats / may not start new chats; connected apps empty /
filled; approve with and without Let it send; 1280 and 360, light and dark.

## Decisions

- 2026-11-20 (owner): members connect only through the app sign-in (OAuth); personal access tokens stay admin-only
  "master tokens". Send is off by default, ticked by the member on the approval page or later on My AI assistants.

## Open questions for the owner

1. Turning the members switch **off revokes** every member's connected app (they must connect again when it is turned
   back on). Alternative: keep the tokens and refuse them while off. Recommendation: revoke (no surprise reconnects).
2. `get_stats` / `get_activity` for members over their own inboxes (same as Ask Ezy today). Alternative: chats only.
3. Should an admin be able to see and revoke members' tokens on Settings → Integrations? Recommendation: yes (shown).
4. `inbox:manage` (resolve/reopen) for members: after PR #388 is merged, members get the same checkbox, limited to
   chats they can open. OK?

## Confirmation

- [x] Owner confirmed the mock on 2026-11-20 ("ok approve mcp mock"), relayed by the master session, with the
      OAuth-only change. Answers: (1) switch off cancels members' connections (revokes); (2) stats for members later,
      chats only now; (3) admins see and revoke members' connected apps in Integrations: yes; (4) resolve/reopen for
      members after #388 merges, limited to their chats (follow-up); (5) read always, send optional and off by default;
      (6) any role change revokes.

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
- **Intentionally changed or added files** (everything else is byte-equal to the baseline; `src/admin/CreateTokenDialog.tsx` is
  unchanged: members never create tokens): `README.md`, `members-shots.mjs` (new), `run.ts` (temp-folder name), `seed.ts` (AI assistant
  access on), `src/App.tsx` (route `/oauth/authorize`), `src/auth/OAuthConsentPage.tsx` (new; box "Let it send WhatsApp messages as you"),
  `src/auth/UserMenu.tsx` (account menu: My AI assistants), `src/nav/AccountPage.tsx` (member section),
  `src/nav/MemberAssistantCard.tsx` (new: how to connect, connected assistants, Permissions, Disconnect, Mock only panel),
  `src/mock/members.ts` (new), `src/admin/IntegrationsSection.tsx` (second switch, confirm dialog, owner and Member / Connected app
  badges, admin revoke), `src/admin/TokenPermissionsDialog.tsx` (member mode: new numbers greyed with a tip), `src/lib/tips.ts`
  (tip `memberNewChats`), and `src/i18n/locales/{en,ms,zh-CN}/{admin,common}.json` (`mockMembers.*`, `mockTips.memberNewChats`).
- **Check that nothing else drifted:**
  `git diff --no-index --name-only docs/features/app-navigation/mock docs/features/mcp-for-members/mock`
  lists exactly the files above (`reference.json` is untouched).
- Owner decision 2026-11-20 ("no need mcp token, use dynamic oauth will do, mcp token still consider master token for now"):
  this mock shows members connecting only through the app sign-in; the Rules and Screens sections above still describe the
  earlier member-created tokens and need the matching update when the design is revised.
- Mock open points: the member who "may not start new chats" is shown through `ravi` (limited to chosen chats); a member who is not
  limited always may in the mock. Stats for members (Q2) are not shown in the mock.
