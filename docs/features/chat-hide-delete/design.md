# Hide chats on Log out, and Delete chat

Status: **confirmed by the owner on 2026-11-12** ("look good", on the quick mock page with these rules).
Branch: `feat/chat-hide-delete`. Requested by the owner on 2026-11-12.

## Owner decisions (2026-11-12)

1. When a WhatsApp number is logged out, its chats leave the inbox. They are **hidden, never deleted**.
2. If the **same** number links again, its hidden chats come back as they were. A **different** number starts with
   an empty inbox, and the old number's chats stay hidden.
3. An admin can **delete one chat**, in EzyChat only: the chat, its messages, notes and files are deleted for good.
   The WhatsApp phone keeps its own copy. If the customer writes again, a new empty chat starts.

## Part A: hide chats on Log out

### When

- Trigger: the inbox status becomes `logged_out` on an inbox whose adapter has `WaCapabilities.qrLink` (a linked
  phone). Both paths end in `wa-bridge/bridge.ts` (status event): the admin's Log out (`routes/wa.ts:45`, Admin →
  WhatsApp and Admin → Inboxes) **and** an unlink from the phone (WhatsApp → Linked devices → Log out,
  `baileys/adapter.ts:516`). A short connection drop (`connecting`, `close` without logout) hides nothing.
- Not for the Business API (no `qrLink`): its connection is changed or removed, not logged out.

### What happens

- Migration 043 adds `chats.hidden_at INTEGER NULL` and `chats.hidden_number TEXT NULL` (the digits of
  `inboxes.own_jid` at that moment, via `numberOfJid`).
- On `logged_out`: one transaction sets both columns on every chat of that inbox that is not hidden yet; audit
  `chats.hidden_on_logout` {inboxId, count, via: `admin` | `phone`}. Pending send jobs of those chats fail as
  `logged_out` (never sent later to the wrong number). AI hand-off timers and group queues of those chats stop.
- The inbox stays; its agents stay bound; assignments are kept (they come back with the chats).

### Relink

`bridge.ts` `onConnected` compares the new number with `hidden_number` **before** `setOwnJid` writes it:

| New number       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same digits      | Chats come back **one by one, only when WhatsApp says the phone still has them** (owner 2026-11-12: "if the chat is still on the phone, show it, else not"). A hidden chat is shown again (history, notes, tags and assignee kept) when, for that number, WhatsApp reports it in the link's history sync (`messaging-history.set` `chats`, no date cutoff), in `chats.upsert`, in the group list (the number is still a member), or with any message. The match goes through `AliasStore.route` (phone-number JID and LID). Chats WhatsApp never reports stay hidden; a later live message from that person still shows the chat. Audit `chats.shown_on_relink` {inboxId, count} once per link. |
| Different digits | The hidden chats are **archived**: each gets a new internal key `<key>~old<n>` and `wa_jid` `<wa_jid>~old<n>` in every chat-keyed table (the move list of `chats/merge.ts`, one transaction). The unique `(inbox_id, wa_jid)` is free again, so a customer who writes to the new number starts a new empty chat. Archived chats stay hidden; nothing is ever sent to them. Audit `chats.archived_on_relink` {inboxId, count}.                                                                                                                                                                                                                                                                   |

Why the archive step: chats are keyed by inbox and customer, not by our own number (`inboxes/keys.ts:32`). Without
it, a customer who wrote to both numbers would land in the old hidden chat and bring its history back.

### Where hidden chats are left out

A hidden chat behaves like a chat that does not exist, for everyone (admins, the AI and MCP too):

- Central checks: `canOpenChat`, `requireChatAccess` / `requireMessageAccess` (404 as today), `usersWhoCanOpenChat`.
- SQL filters: `ChatRepo.list` (list, search, tags), `openCount` / `openChats` / `directChats`, `inboxCondition`
  (stats, activity, Reports), `customers/linked.ts`, Safety lists and report.
- Every other direct `chats` / `messages` query (33 server files): checked one by one, each change tested.
  Scheduled tasks to a hidden chat are skipped (`chat_hidden`), not sent.
- Socket: a `chats:hidden` event {inboxId} makes open web pages drop those chats from their caches.

### Implementation notes (Part A, 2026-11-12)

- Archive key: `chatKey(inbox, '<wa_jid>~old<n>')`, so inbox 1 gets `<key>~old<n>` as above and another inbox
  `<wa_jid>~old<n>#<id>` (the `#<inbox>` suffix stays last, so the key still names its inbox). The moved tables are
  Delete chat's `CHAT_TABLES` plus `avatars` (one list for both features). A hidden chat whose number was not known
  when it was hidden counts as another number (archived).
- `chats.shown_on_relink` is written after 30 s without another shown chat: one row for the link's sync, and a small
  row for each later live message that shows a chat.
- New chat and a group member's **Message** show a hidden chat of the same number (the team starts that chat again),
  like the customer's live message does.
- Admin → Inboxes **Link the phone again** logs the phone out first, so it now asks first (title and text of Re-link
  plus the hidden-chats line). Not in the quick mock: confirm with the owner.
- Left as they are (history, never a list of chats): `audit_log` rows and Reports' AI hand-off/resolve counts from
  them, connector Activity names, the phrase list's team replies, Members → "Chats this member can see" (keeps a
  hidden chosen chat so it comes back), Lite import summary counts.

## Part B: Delete chat (admins)

### Screen

- A new admin-only chat header ⋮ menu ("Chat actions") → **Delete chat**. Hidden from agents. (Customer panel / Group info entry: not built, follow-up.)
- Dialog: "Delete this chat?" · name · "48 messages, 3 files" · "Deleted from EzyChat for good. Your WhatsApp phone
  keeps its copy. Backups keep it for up to 7 days." · [Cancel] [Delete chat] (danger button).
- After delete: the chat leaves the list, an open chat page goes back to the inbox, toast "Chat deleted".

### Server

- `DELETE /api/chats/:jid` (admin, Origin check, `chatJidParam` + `requireChatAccess`), 30 a minute per admin.
  Direct chats and groups (a group's next message starts a new empty chat).
- `chats/delete.ts#deleteChat` is the only delete path:
  1. Stop live work for the chat: fail its queued sends, abort an AI turn and its timers, clear group queues.
  2. One transaction deletes the rows of every chat-keyed table (`messages`, `notes`, `chat_events`,
     `customer_profiles`, `customer_tags`, `member_chats`, `ai_group_chats`, `ai_scheduled_tasks`, `safety_items`,
     `message_changes_pending`, calendar, Sheets, Drive, partner-connector and SQL Account tables, `avatars`) and of
     every message-keyed table (`message_reactions`, `message_edits`, `media_refs`, `media_thumbs`), then `chats`
     (`ai_chat_state` cascades). It writes a tombstone `deleted_chats` (inbox_id, wa_jid, deleted_at).
  3. After the commit: remove each message's file (`media_path`, quarantine copy), the chat's media folder and its
     avatar file. A forwarded copy in another chat is its own file (hard link), so it stays.
  4. Audit `chat.deleted` {chatJid, messages, files}; logs ids and counts only, never names or text.
  5. Socket `chat:deleted` {jid} to the chat's rooms; the web removes it from every cache (persisted cache too).
- Coverage test (like `merge-coverage`): every table with a `chat_jid` or message-id column must be in the delete
  plan, so a new table cannot leave orphans.
- Tombstone: history sync or a WhatsApp `chats` upsert never recreates a deleted chat or re-imports messages older
  than `deleted_at`; a **live** message starts a new chat as usual.
- Not touched: `contacts`, `jid_aliases`, `safety_numbers` (shared by every inbox), `audit_log`.

## Upgrade and editions

- Migration 042 (`deleted_chats`, Part B) and 043 (hidden columns, Part A); `upgrade-from-oldest.test.ts` seed extended; Lite merge
  `TABLE_PLAN` gets `deleted_chats` and the new columns.
- Enterprise gets both through the core; no extension API change. Inbox 1 rules unchanged.

## Risks

- **Untested against real WhatsApp:** how complete the link's `chats` list is. If the phone keeps an old chat that
  WhatsApp leaves out of the sync, that chat stays hidden until the person writes again. Check on a real phone with
  a test number before release (`packages/wa/src/baileys/**` rule).
- A chat deleted on the phone and then written to again by the customer comes back with its old history (the
  customer's live message shows it). Accepted: the phone shows that chat again too.

## Not in scope (follow-ups)

- A screen to see or delete hidden / archived chats (they stay invisible).
- Deleting the chat on the WhatsApp phone too.

## Review

Owner choice 2026-11-12: screenshots of a quick mock (`mock/index.html`: Log out dialog, Delete chat menu item and
dialog, toast; 1280 and 360 px, light and dark) instead of a full app clone. Not a mock baseline: the next clone
still starts from latestConfirmed (forward-message).
