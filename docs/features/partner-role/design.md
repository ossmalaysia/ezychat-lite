# Partner role (outside agents who see only shared chats)

Status: **proposal: mock ready for owner review, not confirmed.** No production code until the owner confirms the mock.
Created 2026-11-06 (creationOrder 35). Owner request (Jazz, 2026-11-06, relayed by the main session): a **Partner** role
in the Lite core (so Lite and Enterprise both get it). An admin invites an outsourced agent who may manage **only** the
direct chats and groups the admin chooses.

Owner decisions so far: in the Lite core (confirmed). Proposed defaults (owner may change at mock review): a partner
sees the **full history** of a shared chat, with a per-share switch **"Only messages from today on"**; **internal notes
hidden** from partners (one team switch).

Mock: [mock/index.html](mock/index.html) (run instructions in [mock/README.md](mock/README.md)), screenshots in
[mock/screenshots](mock/screenshots) (16 states × desktop 1280 / mobile 360 × light / dark, `partner-shots.mjs`, 64 shots,
0 page errors, 0 overflow). Workbook: [docs/workbooks/feat__partner-role.md](../../workbooks/feat__partner-role.md).

## Mock baseline

- Cloned from `latestConfirmed` **google-drive**, `docs/features/google-drive/mock` at **442b6317254a1a86b7df66bb86335f2d0047caec**
  (confirmed 2026-11-05; byte-identical to `main` 171f3aa). Screenshots not copied.
- As the index asked, the confirmed **sql-accounting** mock (e33aabbd) was merged in: the diff of
  `group-management@26116d59` → `sql-accounting` (4 added files, 14 changed) applied on the clone; the 6 catalog JSON
  conflicts merged key by key (only new keys added), `ConnectorsGalleryPage.tsx` and `run.ts` by hand. README /
  reference.json rewritten below.
- Inherited gaps (unchanged): message-edit-delete, whatsapp-safety, group-agents and claims-template screens.
- Files changed for this proposal: see `mock/reference.json` → `partnerRoleChanges`. Everything else is identical to the
  clone + SQL Account merge.

## Scope

1. **Role `partner`** beside `admin` and `agent` (`Role` in `packages/shared/src/enums.ts`). Invited from
   Admin → Members → Add member (Role: Partner, optional **Partner company**). Signs in like any user (loopback, LAN,
   tunnel); first sign-in changes the temporary password. The role is chosen only when inviting: an admin cannot turn a
   partner into an agent or back by one edit (a partner would otherwise get whole inboxes); they add the person again.
2. **Chat-level grants**: table `chat_shares` (below). An admin shares a chat from the **chat header → Share** dialog
   (pick a partner, end date, "Only messages from today on") or from the **partner's page** (Admin → Members → the
   partner: "Chats Ravi can see", Share a chat, remove, end dates shown as "Ends in 3 days"). Removal and expiry act
   live: the chat vanishes from the partner's list and an open chat turns into **No longer shared**.
3. **What a partner can do** (only in shared chats): read, reply, send media and voice notes, react, reply suggestions,
   Fix English, take over from the AI agent, assign the chat to themselves, read and resolve.
   **Cannot**: start a new chat, open/start a chat from a group member, see group members' phone numbers (names only),
   see or search any other chat, customer profiles outside shared chats, Admin (members, settings, reports, connectors,
   Safety admin, AI agent pages, audit), Ask Ezy, MCP tokens and OAuth approval, Send feedback (it can attach the
   business's log), share-the-app, log download, exports, team Fix English words.
4. **Notes**: team switch `partner_notes` (Admin → a partner's page, card "Partners see internal notes", default off).
   Off: `GET /chats/:jid/notes` answers `[]` and `POST` 403 for a partner, notes never reach their sockets.
5. Out of scope (v1): partner groups/teams, per-partner permission sets, partner-visible reports, a partner admin who
   invites sub-partners, sharing a whole inbox with a partner (use the Agent role).

## Data (migration 036)

```sql
-- 036_partner_role.sql
-- users.role has CHECK (role IN ('admin','agent')) since 001_init: rebuild `users` with
-- CHECK (role IN ('admin','agent','partner')) (12-step table rebuild, foreign keys off, like 003/015).
CREATE TABLE chat_shares (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_jid     TEXT    NOT NULL,          -- opaque chat key; no FK (chats can merge, see below)
  granted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at   INTEGER NOT NULL,
  expires_at   INTEGER,                   -- NULL = until removed
  history_from INTEGER,                   -- NULL = full history, else first visible timestamp (start of the business day)
  PRIMARY KEY (user_id, chat_jid)
);
CREATE INDEX idx_chat_shares_chat ON chat_shares(chat_jid);
CREATE TABLE partner_profiles (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company TEXT NOT NULL DEFAULT '');
```

- `mergeChat` (identity migration and alias merges) must move `chat_shares` rows (it moves every table keyed by
  `chat_jid`): `INSERT OR IGNORE … SELECT` then delete, keeping the earlier `history_from` and the later `expires_at`.
- Disabling or deleting a partner keeps rows for the audit but they grant nothing (scope checks `disabled_at`).
- `upgrade-from-oldest.test.ts`: the migration only adds tables; the seed needs no change, but the test asserts
  `chat_shares` exists and an old data dir starts with no partners. Lite→Enterprise: tables are core, nothing to move.
- Expiry: no timer needed for safety (every scope read filters `expires_at > now`); a 1-minute sweep emits
  `chat:unshared` + audit `chat_share.expired` so screens update live.

## Enforcement: one choke point

Extend `inboxes/access.ts` from inbox-level to chat-level:

```ts
export type InboxScope = 'all' | ReadonlySet<number> | PartnerScope;
interface PartnerScope { kind: 'chats'; chats: ReadonlyMap<string, { historyFrom: number | null }> }
export function scopeFor(ctx, user) {
  if (user.role === 'partner') return partnerScope(ctx, user.id);   // BEFORE the admin/AI and isSingleInbox checks
  …
}
export function canOpenChat(scope, chat: { jid: string; inbox_id: number }): boolean
export function historyFrom(scope, jid): number | null
```

- `isSingleInbox` (Lite "everyone opens inbox 1") **never** applies to a partner: the partner branch returns first.
  `usersWhoCanOpen(inboxId)` keeps excluding partners (`role IN ('admin','agent')` + members); a new
  `usersWhoCanOpenChat(jid)` = `usersWhoCanOpen(inbox)` ∪ active partners with a live share.
- `canOpen(scope, inboxId)` answers **false** for a partner scope (no inbox-wide access anywhere). Every caller that
  needs a chat must use `canOpenChat`; a grep test fails on `canOpen(` in per-chat code.
- `requireChatAccess` / `requireMessageAccess` (`inboxes/service.ts`) switch to `canOpenChat` (+ for messages, a
  `timestamp < history_from` row answers 404). All `:jid` routes already go through `chatJidParam` (chats, messages,
  media, notes, groups, customers profile, reply suggestions, fix-english, templates, safety chat, ai-groups) and all
  message-id routes through `requireMessageAccess`, so they answer 404 outside shared chats with no per-route change.
- **Lists and filters**: `ChatListScope` gains `chatJids`; `GET /chats` (list, search, tag filter, counts),
  `/customer-tags` (tags of shared direct chats only), `GET /chats/:jid/messages` (`timestamp >= history_from`),
  `/messages/:id/locate`, `chat events` (from `history_from`), reactions (`present()` only for visible messages).
- **Route guards (partner refused, 403 `partner_not_allowed`)**: `requireStaff` = admin or agent on: `/users/directory`
  (partner gets only itself + names of people in its shared chats' events), `/inboxes`, `/wa/status` (partner gets
  connected/offline only, no number), `/quick-replies` read (allowed: open question 4), `/ask-ezy*`, `/feedback*`,
  `/fix-english/words` POST, `/logs/download`, `/integrations/*` (already admin), `/oauth/*` approval, `/reports*`,
  `/safety*` (admin) and every admin route (already `requireAdmin`).
- **Group routes**: `GET /chats/:jid/members` for a partner strips `phone`, `lid`, `username`, `chatJid`, `about`;
  `/members/:member/about`, `/members/:member/avatar` 404; `POST /members/:member/chat` 403; group management
  (`/chats/:jid/group*`) is admin only already.
- **Assignment**: a partner may set `assignedTo` only to themselves or `null` (400 `assignee_not_self`). An admin/agent may
  assign a shared chat to a partner who has a live share of it (the `assignee_no_access` check uses `canOpenChat`).
  Removing a share unassigns the partner (system line "Ravi stopped having access", no customer message).
- **Sending**: text, media, voice, reactions, edits/deletes of own messages go through the same routes, so the 404
  rule covers them. `messages.sent_by_user_id` = the partner; audit `partner.sent` {userId, chatJid, messageId} (ids only).
- **Sockets** (`realtime/socket.ts`): a partner joins `user:<id>` and new rooms `chat:<jid>` for each live share (never
  `all`, `admins` or `inbox:<id>`). Chat events are emitted to `inbox:<id>` **and** `chat:<jid>`; `syncInboxRooms` becomes
  `syncRooms` and also runs on `share:changed`. Events that today go to `all` (e.g. directory, `wa:status`) are checked
  one by one: chat-carrying ones move to inbox/chat rooms; global ones a partner may not see skip partner sockets.
  `typing` is accepted from a partner only for a shared chat. Messages before `history_from` are never emitted (they
  are not new, so only edits/reactions on old messages matter: filtered in the presenter).
- **Push and notifications** (`push/service.ts`, `ai/service.ts` hand-off): recipients from `usersWhoCanOpenChat(jid)`;
  `notification:new` only to those. An unassigned shared chat notifies the partner like a teammate.
- **AI**: hand-off to a partner only if `canOpenChat`; the AI never names partners to customers; reply suggestions,
  completions and phrases for a partner read only messages from `history_from` on. Customer enrichment unchanged.
- **MCP and Ask Ezy**: token creation and OAuth approval are admin-only already; Ask Ezy refused for partners; the
  `InboxReadPort` gets the partner scope anyway (defence in depth) so a future non-admin token cannot widen it.
- **Customer profiles**: a partner reads the profile of a shared direct chat (name, company, tags; **no phone, email,
  other phone or address**: open question 3) and cannot edit it. `linkedChats` never reveals another inbox's chat.
- **Reports, audit, stats**: partners are counted like teammates for reply times (they reply to customers); Reports adds
  no partner page in v1.

## API (shared zod first)

- `CreateUserBody.role` adds `'partner'` + optional `company` (≤ 80); `PatchUserBody.role` refuses changing to or from
  `partner` (400 `role_change_not_allowed`).
- `GET /api/users/:id/shares` (admin) → `{ shares: ChatShare[] }`; `POST /api/users/:id/shares`
  `{chatJid, expiresAt?, historyFrom?: 'all'|'today'}` (upsert); `DELETE /api/users/:id/shares/:jid`.
- `GET /api/chats/:jid/shares` (admin), same POST/DELETE from the chat side (one service, `shares/service.ts`, the
  only SQL in `shares/repo.ts`).
- `GET /api/me` adds `partner: { company, shares: ChatShare[] } | null`; socket `chat:shared` / `chat:unshared` to the
  partner, `share:changed` to admins.
- `PUT /api/settings` `{ partnerNotes: boolean }` (admin), audited before/after.
- `ChatShare = { userId, chatJid, chatName, chatType, grantedBy, grantedAt, expiresAt|null, historyFrom|null }`.

## Audit (ids only, never message text)

`user.create` (role partner), `chat_share.add` {targetId, chatJid, expiresAt, historyFrom}, `chat_share.change`,
`chat_share.remove`, `chat_share.expired` (actor system), `partner.sent` {chatJid, messageId}, `settings.partner_notes`
{before, after}. The partner page's **What changed** card reads these rows for that partner.

## Proposed security invariant (AGENTS.md)

> - Partners (`role = 'partner'`, `inboxes/access.ts`): access is per chat (`chat_shares`, live and not expired), never per
>   inbox: `scopeFor` returns the partner scope before every other branch, so the single-inbox shortcut, admin and AI
>   rules never apply to them. Every per-chat, media and message-id route answers **404** outside a live share and for
>   messages before its `history_from`; lists, search, tags, stats and reactions are filtered; partner sockets join only
>   `user:<id>` and `chat:<jid>` rooms (rebuilt on every share change); push, assignment and AI hand-off reach a partner
>   only for a shared chat. A partner never receives group members' numbers or IDs, internal notes (unless the team
>   switch is on), the directory, inboxes, settings, Ask Ezy, feedback, logs or tokens; may assign only to themselves;
>   never starts a chat. Removal or expiry ends access at once. The role is set only at creation.

## Test plan

Unit (server, `packages/server/test/partner-*.test.ts`, real `makeTestApp`):

- scope: partner with 0/1/2 shares; expired share; disabled partner; Lite single inbox (partner still scoped, agent
  still `'all'`); `canOpen` false for partner scope; merged chat keeps the share.
- route matrix: every route of `web-client-contract` route table called as a partner on a shared and an unshared chat
  → 2xx / 404 / 403 exactly as listed; a test fails when a new `:jid` route is not in the matrix.
- history: messages/events/reactions before `history_from` absent from messages, locate, search, socket, suggestions.
- group members stripped; about/avatar 404; member chat 403.
- notes switch off/on; assignment self-only; assign-to-partner requires a share; unshare unassigns.
- sockets: partner receives events of shared chats only; share/unshare re-syncs rooms without reconnect; typing filtered.
- push/notification recipients; AI hand-off recipients.
- role change refused; `CreateUserBody` partner + company; audit rows carry ids only.
- `upgrade-from-oldest.test.ts` runs migration 036; `mergeChat` moves `chat_shares`.
  Web unit: Members role select, partner page states, Share dialog, partner list filter, "No longer shared".
  E2E (`e2e/partner-role.spec.ts`, fake WA): invite partner → share a chat → sign in as partner sees only it → reply →
  admin removes → partner sees No longer shared live; group info names only; desktop + mobile.
  Dev Build check: tunnel sign-in as partner from a second browser; owner test env `D:\dev\test-env\lite`.
  Security review (`/security-review`): no listener change, but an access-control change: run it and attach to the PR.

## States in the mock (checklist)

| #     | State                                                              | Screenshot                 |
| ----- | ------------------------------------------------------------------ | -------------------------- |
| 1     | Members with Partner role and shared-chat count                    | `01-members`               |
| 2     | Add member → Role: Partner + company                               | `02-invite-partner`        |
| 3     | Partner page filled (ending share, "from today on" share)          | `03-partner-page`          |
| 4     | Share a chat from the partner page                                 | `04-add-chat-dialog`       |
| 5     | Long list (43 chats, search, Show more)                            | `05-partner-long-list`     |
| 6     | Partner with no chats                                              | `06-partner-empty`         |
| 7     | Chat header → Share dialog (already shared with Ravi)              | `07-chat-share-dialog`     |
| 8     | Share dialog: new share, 30 days, today on                         | `08-chat-share-new`        |
| 9     | Partner's list (only shared chats, banner)                         | `09-partner-list`          |
| 10    | Partner in a shared chat (no Notes, no Share, assign to self only) | `10-partner-chat`          |
| 11    | Group shared "from today on" (history cut line)                    | `11-partner-group-history` |
| 12–13 | Group info names only; member detail without number or Message     | `12-…`, `13-…`             |
| 14    | No longer shared                                                   | `14-partner-not-shared`    |
| 15    | Account menu "Partner · BrightDesk Outsourcing", no feedback/share | `15-partner-menu`          |
| 16    | Partner with nothing shared                                        | `16-partner-no-chats`      |

Also interactive (not shot): remove a share (confirm), Mock only "End Jason Lim now" (live expiry), notes switch.
Desktop 1280 and mobile 360, light and dark; en / ms / zh-CN strings for every new text (`admin.json` → `partner.*`,
`common.json` → `roles.partner`).

## Open questions for the owner

1. **Full history by default** with "Only messages from today on" per share: keep? (Alternative: today-on by default.)
2. **Internal notes hidden** by default, one team switch (not per partner): keep?
3. **Customer details in a shared direct chat**: partner sees name/company/tags only, no phone, email or address,
   read only. OK, or should partners see the phone number of their own shared direct chats?
4. **Quick replies**: partners may use the team's quick replies (read only). OK?
5. **End date choices**: Never / 7 / 30 / 90 days. Need a pick-a-date option?
6. **Limit**: no cap on partners in Lite (they count as users). Should Lite cap partners (e.g. 2) as an Enterprise upsell?
7. **Reports**: count partner replies with the team (proposed) or separately?

## Mock and confirmation

- 2026-11-06: proposal mock built (this folder). **Awaiting owner confirmation.**
