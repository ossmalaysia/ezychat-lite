# Merge split phone-number / LID chats — design

Date: 2026-10-05 · Status: draft for review (rev. 2: merge at startup only) · Scope: `packages/{wa,shared,server}`, `apps/web`

## 1. Problem

WhatsApp now addresses one person under two JIDs: the phone-number JID (PN, `<digits>@s.whatsapp.net`)
and the LID (`<digits>@lid`, an opaque per-account id). Baileys `7.0.0-rc14` (installed) delivers 1:1
messages under either one. Our `chats.jid` is the raw `key.remoteJid`, so one customer becomes two inbox
rows. Live data: one PN chat with 64 messages and one LID chat with 5 messages share a name; 1257 LID chats,
7 PN chats, 29 LID chats with no known phone.

What exists today:

- The adapter already **learns** PN↔LID pairs (`packages/wa/src/baileys/adapter.ts`): `key.remoteJidAlt` /
  `key.participantAlt` on every message (`ingest`), `lid-mapping.update`, `messaging-history.set.lidPnMappings`,
  `contacts.upsert/update` (`id`, `lid`, `phoneNumber`), and the Signal key store (`keys.get('lid-mapping', …)`)
  in `getContactAliases`. Pairs are normalized by `contact-aliases.ts` (PN→LID orientation, device suffix
  stripped).
- The server uses the pairs **only for names**: `chats/service.ts` keeps an in-memory `Map<jid, Set<jid>>`
  (`link`) and `syncNames` copies saved/push name and `contacts.phone` across the group. Nothing is persisted;
  messages, unread, assignment, events, notes and AI state stay split.
- `messages/service.ts#ingest` calls `chats.ensure(m.chatJid)` with the raw JID; the send queue, `inflight`
  echo de-dup, push `tag`/`url`, media folder and every `/api/chats/:jid/*` route key by that raw JID.
- `apps/web/src/lib/jid.ts#formatJid` prints any 5+ digit user part; for `@lid` it prints the LID digits,
  which the header (`ConversationHeader.tsx`) presents as a phone number.

## 2. Goals / non-goals

Goals: one inbox row per person; existing duplicates merged **once, at server startup**, safely and
idempotently; afterwards new messages land in the right row by **routing only**; header shows the real phone
or "Phone number hidden", never LID digits; old links/notifications keep working.

Non-goals: merging chats while the server runs (rejected by the owner as too complicated); group participant
identity; inferring identity from names or numbers (explicit WhatsApp mappings only); splitting a merge.

## 3. Canonical ID strategy

**LID is canonical when known; PN only while no LID is known.** `chats.jid` stays the primary key and API
identifier. A new `jid_aliases` table maps each PN whose LID is known to that LID.

Why: Baileys 7 / WhatsApp are LID-first (1257 of 1264 DM rows are already LID, so only a handful of PN rows
is ever re-keyed); a LID is stable while a phone number can be recycled; 29 chats have no known phone and
must be LID-keyed anyway.

Alternatives considered:

| Option | Pros | Cons |
| --- | --- | --- |
| **B. PN canonical, LID alias** | Human-readable key | Re-keys most chats; impossible for 29 phone-less chats; recycled numbers merge different people |
| **C. Synthetic `person_id` key** | No re-keying ever | Rewrites every route, socket payload, cursor, push tag, web route and test |
| **D. Display-only grouping** | No destructive step | Unread, assignment, queue, notes, AI state stay split; two owners per customer |
| **E. Merge live when a pair is learned** (rev. 1) | Duplicates disappear immediately | Live re-keying of queue jobs, echo guards, AI timers, open browser tabs; owner rejected it |

## 4. Two phases

1. **Startup identity migration** (once per server start, before anything else touches chats): reads the
   PN↔LID pairs WhatsApp has already stored on disk, persists them, and merges every pair that has two chat
   rows (or re-keys a PN-only chat whose LID is known). No-op when nothing needs merging.
2. **Runtime = routing only**: new pairs are persisted and new messages are routed to an existing chat of
   either JID. The runtime **never** merges, deletes or re-keys a chat. A pair that joins two existing chats
   at runtime is recorded and merged by the next startup.

## 5. Data model — migration `004_jid_aliases.sql`

(`002_user_locale.sql` and `003_ai_member.sql` exist; `PRAGMA user_version` becomes 4.)

```sql
CREATE TABLE jid_aliases (
  alias_jid      TEXT PRIMARY KEY,  -- the PN
  canonical_jid  TEXT NOT NULL,     -- the LID it belongs to
  source         TEXT NOT NULL,     -- 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore'
  learned_at     INTEGER NOT NULL,
  repointed_from TEXT               -- previous LID when the number moved to another person (rule 3)
);
CREATE INDEX idx_jid_aliases_canonical ON jid_aliases(canonical_jid);
ALTER TABLE chats ADD COLUMN phone TEXT;            -- PN digits for display/search, NULL when unknown
ALTER TABLE messages ADD COLUMN wa_remote_jid TEXT; -- JID WhatsApp used for this message
UPDATE messages SET wa_remote_jid = chat_jid;
UPDATE chats SET phone = substr(jid, 1, instr(jid, '@') - 1) WHERE jid LIKE '%@s.whatsapp.net';
-- plus: LID chats take a numeric contacts.phone
```

The SQL migration does **not** merge: the mapping lives in the Baileys key store under `wa-auth/`, not in
SQLite. Merges are recorded in `audit_log` (`action = 'chat.merge'`, `user_id NULL`,
`meta = {from, to, rekeyed, moved:{messages,events,notes,aiState}, assigneeDropped}`); no `chat_events.type`
change (its CHECK constraint would force a table rebuild).

## 6. Reading stored mappings offline (`packages/wa`)

Baileys' `useMultiFileAuthState` (our `auth-store.ts`) writes each key as `<authDir>/<type>-<id>.json`
(`/`→`__`, `:`→`-`). The LID mapping store (`node_modules/baileys/lib/Signal/lid-mapping.js`) writes
`lid-mapping` keys `<pnUser>` → `"<lidUser>"` and `<lidUser>_reverse` → `"<pnUser>"` (JSON strings, users
without device). So:

- `wa-auth/lid-mapping-60123456789.json` contains `"123456789012345"`;
- `wa-auth/lid-mapping-123456789012345_reverse.json` contains `"60123456789"`.

New `packages/wa/src/baileys/stored-lid-mappings.ts` exports `readStoredLidMappings(authDir):
WaContactAlias[]` (re-exported from `packages/wa/src/index.ts`). It uses only `node:fs` (no `baileys` import),
so it runs before any socket exists and in `--fake-wa` mode. Rules: a forward file is the current mapping of
a number; a reverse file only fills in numbers without a forward file (an old LID's reverse file can outlive
a number that moved; two reverse files for one number are ignored); invalid/unreadable files are skipped;
the linked account's own PN/LID (`creds.json` `me.id` / `me.lid`) is excluded; a missing directory returns
`[]`, any other directory error throws. Pairs carry `source: 'keystore'`. Tests use fixture directories.

## 7. Persisted routing — `AliasStore` (`packages/server/src/chats/aliases.ts`)

In-memory cache of `jid_aliases` (loaded at construction), owned by `ctx.services.aliases`.

- `learn(pair, source)` — normalizes with the same rules as `contact-aliases.ts`, never learns the linked
  number, groups, broadcasts or LID↔LID. Rules for pair `{pn, lid}`:
  1. unknown `pn` → insert `pn → lid`, set `chats.phone` on the LID chat;
  2. `pn → lid` known → no-op;
  3. `pn → otherLid` (number recycled) → re-point for **future routing only**, store
     `repointed_from = otherLid`, clear `phone` on `otherLid`, `warn` log. A re-pointed PN's own old chat is
     never merged into, or routed to for, the new person;
  4. a LID is never an alias; a PN is never canonical while its LID is known.
- `resolve(jid)` — PN → its LID, else `jid` (canonical identity, for names).
- `route(jid)` — the chat a DM JID belongs to **now**, without creating or merging: the LID chat if it has
  a row; else an existing, non-re-pointed PN chat of the same person; else the LID for a known PN (new
  chats are LID-keyed); else `jid`.
- `group(jid)` — `[canonical, ...PNs]` for name sync; `pendingMerges()` — aliases whose PN still has a
  chat row and was not re-pointed.

The in-memory `link` map in `chats/service.ts` is replaced by `AliasStore`.

## 8. Startup identity migration (`packages/server/src/chats/identity-migration.ts`)

`runIdentityMigration(ctx, deps?)` is called by `wa-bridge/index.ts#initMessaging` right after the
`AliasStore` is created and **before** `createChatService` / `createMessageService` (whose constructor
restores pending send jobs). `initMessaging` runs inside `main.ts#runInitializers`, which completes before
`buildApp`, `app.listen`, `attachRealtime` and `ctx.wa.connect()`; `initAi` (AI timers restored from
`ai_chat_state`) is registered after it. So the migration runs before the WA adapter connects, before the
send queue restores jobs, before AI timers, and before HTTP/socket clients exist. It is synchronous.

Steps:

1. `readStoredLidMappings(<data>/wa-auth)`; on error log `warn` and continue with stored aliases only.
2. `aliases.learn(pair, 'keystore')` for each pair (persists aliases and phones).
3. `pending = aliases.pendingMerges()`. Empty → log `info` summary and return (no backup).
4. One pre-merge backup: `runBackupSync(dataDir, db, now, { label: 'premerge' })` →
   `backups/app-premerge-YYYYMMDD.db` + `wa-auth-premerge-YYYYMMDD/`, outside any transaction (SQLite
   refuses `VACUUM INTO` inside one), kept 30 days (outside the 7-day rotation). If it throws: log `error`,
   merge nothing (chats stay split and keep working), try again next start.
5. `mergeChat(db, pn, lid)` per pair, each in its own transaction; a failing pair is logged and left split.
6. Log `info {mod:'contacts', storedPairs, learned, pending, merged, rekeyed, failed, backup}`.

Runs on every start; idempotent (merged PN rows are gone, so the second start has no pending pairs).

## 9. Merge rules — `mergeChat` (`packages/server/src/chats/merge.ts`)

One synchronous `db.transaction` per pair (`from` = PN, `to` = LID):

| Data | Rule |
| --- | --- |
| `messages` | `UPDATE … SET chat_jid = to` (global PKs). `wa_remote_jid` unchanged; pending `local-%` rows move too, so restored send jobs keep their stored target. |
| `chat_events`, `notes` | `UPDATE … SET chat_jid = to`. |
| `ai_chat_state` (#18) | Has `ON DELETE CASCADE` → moved before the `from` row is deleted. Both present: the state of the chat with the newer inbound wins; `paused` if either was paused (handoff), then `due_at` cleared. |
| `unread_count` | sum. |
| `last_message_at` / `preview` | from the row with the larger `last_message_at`. |
| `status` | `open` if either is `open`. |
| `assigned_to` | one owner: equal → keep; one NULL → the other; both set → a teammate (`users.kind = 'human'`) beats the AI Sales Agent, else the owner of the chat with the latest inbound message. The dropped owner goes into the audit meta and an `assigned` event `{assignedTo, previous, reason:'merge'}`. |
| `name` | saved contact name > non-fallback name > `to.name`. |
| `avatar_path` | `to` if set, else `from`. |
| `phone` | PN digits of `from`. |
| `chats` row `from` | `DELETE`. |
| media files | not moved: `media_path` is stored per message and stays valid. |

If `to` has no row, `from` is re-keyed (insert `to` with `from`'s fields, move children, delete `from`).
Returns `null` when `from` has no row.

## 10. Runtime routing (never merging)

- `packages/wa`: `WaIncomingMessage.chatJidAlt` (DM only, from `key.remoteJidAlt`, device stripped);
  `WaContactAlias.source`; `FakeWaAdapter.simulateContactAliases(pairs)` and `chatJidAlt` in
  `simulateIncoming`.
- `ingest` (DM): `aliases.learn({jid: m.chatJid, alias: m.chatJidAlt})` when present; `chatJid =
  aliases.route(m.chatJid)`; store `chat_jid = chatJid`, `wa_remote_jid = m.chatJid`; unread, reopen,
  `message:received` (AI trigger), `inbound:notify`, media folder use `chatJid`. The echo guard checks the
  routed chat and the raw JID.
- If only the PN chat exists, a LID message routes to it; the next startup re-keys it to the LID. If a pair
  learned at runtime finds two chats, nothing merges; new messages go to the LID chat; the PN chat stays
  reachable by its own URL until the next startup merges it.
- `upsertFromWa` (history `chats.upsert`) routes DM JIDs before `ensure`; `upsertContacts` /
  `upsertContactAliases` learn pairs (outside the name transaction) and sync names over `aliases.group`.
- Routes: every `/api/chats/:jid*` handler uses `ChatService.resolveJid(jid)` = `jid` when it has a row,
  else `aliases.route(jid)`; `ChatService.get` falls back the same way.

## 11. Sending replies

- Queue key stays the chat (`SendJob.chatJid`); `SendJob.targetJid` is where WhatsApp sends.
- Target = `wa_remote_jid` of the chat's latest inbound message, unless that PN now routes to a different
  person (recycled number) → the chat's own JID. Stored on the `local-%` row as `wa_remote_jid` at enqueue,
  so restored jobs (including after a startup merge) are deterministic. Applies to AI Sales Agent replies
  (they use `MessageService.sendText`).
- `composing` presence uses `targetJid`.
- `markRead` groups the last 20 inbound ids by `wa_remote_jid` and calls `wa.markRead(jid, ids)` per group.

## 12. Contract changes (`packages/shared`)

- `ChatSchema.phone: z.string().nullable()` — PN digits without `+`.
- `FakeIncomingBody.chatJidAlt?: string` (fake WA only).
- No new socket or bus event. `GET /api/chats/:jid` returns the routed chat (its `jid` may differ).
- Search: `chats/repo.ts#list` also matches `c.phone`.

## 13. Web (`apps/web`)

- `lib/jid.ts`: `formatJid` returns `''` for `@lid`; `formatPhone(chat)` → `+<phone>` or `null`.
- `inbox/chat-title.ts`: name, else `+phone`, else "Unknown contact" (never LID digits); used by
  `ChatListItem` and `ConversationHeader`. Header subtitle `+phone` or muted "Phone number hidden".
- `useCanonicalChatRedirect`: when the detail response `jid` differs from the URL,
  `navigate('/chats/' + encodeJid(jid), { replace: true })`.
- Audit log label for `chat.merge`. All strings in EN, MS and zh-CN; 360px layout unchanged.
- Server push: title falls back to "Unknown contact" (server i18n) instead of an empty string.

## 14. Rollback and safety

- Restore point: stop the server, copy `backups/app-premerge-*.db` over `app.db`.
- Downgrade: older builds ignore the `user_version 4` table/columns and work on merged data; they would only
  split new messages again.
- No feature flag. Merges only from explicit WhatsApp pairs, never from names or numbers.
- Development and tests use `--data <temp>` only.

## 15. Top failure modes (each has a test in the plan)

1. `wa-auth` missing or unreadable at startup → stored aliases only, no crash, server starts.
2. Backup fails → no merge, both chats keep working, merged on a later start.
3. Pair learned at runtime while two chats exist → new messages route to the LID chat, the PN chat stays
   reachable, merged at the next start.
4. PN-only chat re-keyed to the LID → old `/chats/<pn>` links and push URLs open the LID chat (web redirects).
5. Pending send jobs restored after a startup merge → queued in the LID chat, sent once to the PN target.
6. AI Sales Agent state on the PN chat → moved to the LID chat; a teammate keeps ownership over the AI.
7. Recycled number → re-pointed for future routing only; its old PN chat never joins the new person.

## 16. Untested against real WhatsApp

Must be smoke-tested on a linked test number before release (AGENTS.md): presence of `lid-mapping-*.json`
for existing chats in a real `wa-auth`; `remoteJidAlt` on live/history messages in rc14; sending to a LID vs
PN target; read receipts with LID keys; echo `remoteJid` of our own sends to a PN target.

## 17. Decisions (2026-10-05, from the owner)

- **Merge during migration; in future everything follows the new rules.** Merging happens only in the
  startup identity migration (every start, no-op when nothing to do); runtime code routes only.
- Replies go to the **last inbound `wa_remote_jid`** (human and AI).
- Chats without a known phone show **"Phone number hidden"**.
- **One owner per chat** after a merge (teammate beats the AI, else owner of the latest inbound chat). The
  "only the owner may reply" composer lock is a separate follow-up feature.
- **The LID always wins** when both IDs are known; a chat whose LID is unknown keeps its PN JID until the
  LID is known, then the next startup re-keys it. Old URLs keep working through aliases.
- **No feature flag.** Pre-merge backup kept **30 days**.
