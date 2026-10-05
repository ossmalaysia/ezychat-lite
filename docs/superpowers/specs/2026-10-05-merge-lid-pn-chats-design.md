# Merge split phone-number / LID chats — design

Date: 2026-10-05 · Status: draft for review · Scope: `packages/{wa,shared,server}`, `apps/web`

## 1. Problem

WhatsApp now addresses one person under two JIDs: the phone-number JID (PN, `<digits>@s.whatsapp.net`)
and the LID (`<digits>@lid`, an opaque per-account id). Baileys `7.0.0-rc14` (installed) delivers 1:1
messages under either one. Our `chats.jid` is the raw `key.remoteJid`, so one customer becomes two inbox
rows. Live data: one PN chat with 64 messages and one LID chat with 5 messages share a name; 1257 LID chats,
7 PN chats, 29 LID chats with no known phone.

What exists today:

- The adapter already **learns** PN↔LID pairs (`packages/wa/src/baileys/adapter.ts`): `key.remoteJidAlt` /
  `key.participantAlt` on every message (`ingest`), `lid-mapping.update`, `messaging-history.set.lidPnMappings`,
  `contacts.upsert/update` (`id`, `lid`, `phoneNumber`), and the Signal key store (`keys.get('lid-mapping', …)`:
  key `<pnUser>` → LID user, key `<lidUser>_reverse` → PN user) in `getContactAliases`. Pairs are normalized
  by `contact-aliases.ts` (PN→LID orientation, device suffix stripped) and contradictions are rejected.
- The server uses the pairs **only for names**: `chats/service.ts` keeps an in-memory
  `Map<jid, Set<jid>>` (`link`) and `syncNames` copies saved/push name and `contacts.phone` across the group.
  Nothing is persisted; messages, unread, assignment, events and notes stay split.
- `messages/service.ts#ingest` calls `chats.ensure(m.chatJid)` with the raw JID; the send queue, `inflight`
  echo de-dup, push `tag`/`url` (`push/service.ts`), media folder (`media-store.ts`, `<chat>/<id>.<ext>`),
  every `/api/chats/:jid/*` route and the socket `chat:updated` payload all key by that raw JID.
- `apps/web/src/lib/jid.ts#formatJid` prints any 5+ digit user part; for `@lid` it prints the LID digits,
  which the header (`ConversationHeader.tsx`, `phone = formatJid(chat.jid)`) presents as a phone number.

## 2. Goals / non-goals

Goals: one inbox row per person; new messages land in that row regardless of addressing; existing duplicates
merged once, safely and idempotently; header shows the real phone or "phone hidden", never LID digits; old
links/notifications to a merged JID keep working.

Non-goals: group participant identity (group `sender_jid` may be LID — names already handled by contacts);
inferring identity from names or numbers (explicit WhatsApp mappings only, as today); splitting a merge.

## 3. Canonical ID strategy

**Recommendation (A): LID is canonical when known; PN only while no LID is known.**
`chats.jid` stays the primary key and API identifier. A new `jid_aliases` table maps every non-canonical JID
to its canonical one. When a PN chat learns its LID, the PN chat is merged into the LID chat.

Why:

- Baileys 7 / WhatsApp are moving to LID-first addressing; 1257 of 1264 DM rows are already LID, so only the
  handful of PN rows ever needs re-keying. The opposite choice re-keys ~1200 chats (URLs, push tags, media
  folders, cursors) the moment their PN is learned.
- A LID is stable for the account; a phone number can change owner (number recycling). With LID as the key a
  recycled PN only re-points the alias for future routing — it never pulls a stranger's history into a chat.
- 29 chats have no known phone at all; they must be LID-keyed in any scheme.

Alternatives considered:

| Option | Pros | Cons |
| --- | --- | --- |
| **B. PN canonical, LID alias** | Human-readable key; matches pre-LID data and `me.jid` | Re-keys most chats when a PN is learned; impossible for 29 phone-less chats (mixed keys forever); recycled numbers merge different people |
| **C. Synthetic `person_id` (integer) keys chats** | Clean model, no re-keying ever | Rewrites every route, socket payload, cursor, push tag, web route and test that uses `jid`; largest migration; still needs alias table to route ingest |
| **D. Display-only grouping (no data merge)** | Smallest change, no destructive step | Unread, assignment, status, send queue, notes and search stay split; two owners can answer one customer; hides the bug rather than fixing it |

## 4. Data model — migration `002_jid_aliases.sql`

`packages/server/src/db/migrations/002_jid_aliases.sql` (pure SQL, run by `migrate.ts` inside its transaction):

```sql
CREATE TABLE jid_aliases (
  alias_jid     TEXT PRIMARY KEY,          -- non-canonical JID (normally the PN)
  canonical_jid TEXT NOT NULL,             -- chats.jid it routes to (normally the LID)
  source        TEXT NOT NULL,             -- 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore'
  learned_at    INTEGER NOT NULL
);
CREATE INDEX idx_jid_aliases_canonical ON jid_aliases(canonical_jid);

ALTER TABLE chats ADD COLUMN phone TEXT;            -- PN digits for display/search, NULL when unknown
ALTER TABLE messages ADD COLUMN wa_remote_jid TEXT; -- JID WhatsApp used for this message (for read receipts / replies)
UPDATE messages SET wa_remote_jid = chat_jid;
UPDATE chats SET phone = substr(jid, 1, instr(jid, '@') - 1) WHERE jid LIKE '%@s.whatsapp.net';
```

Notes: no `chat_events.type` change (the CHECK constraint would force a table rebuild) — merges are recorded
in `audit_log` (`action = 'chat.merge'`, `user_id NULL`, `meta = {from, to, moved:{messages,events,notes},
assigneeDropped}`). `contacts` keeps one row per JID (already synced by `syncNames`). The SQL migration does
**not** merge: the mapping lives in the Baileys key store under `wa-auth/`, not in SQLite (see §6).

## 5. Learning and persisting the mapping

- `packages/wa`: keep all current sources. Add `chatJidAlt: string | null` to `WaIncomingMessage`
  (`types.ts`), filled in `mapping.ts#mapWAMessage` from `normalizeContactJid(key.remoteJidAlt)` for DMs, so
  ingest can route without relying on event ordering. Add `source` to `WaContactAlias` (optional) for the
  `jid_aliases.source` column. `FakeWaAdapter` gets `simulateContactAliases(pairs)` and `chatJidAlt` in
  `simulateIncoming`; `getContactAliases` returns pairs set via a test helper.
- New `packages/server/src/chats/aliases.ts` (`AliasStore`): `resolve(jid)` (alias → canonical, else `jid`;
  in-memory cache loaded from `jid_aliases` at startup), `learn(pair, source)` returning the merge it requires.
  Replaces the in-memory `aliases` map in `chats/service.ts#link`; `syncNames` keeps working on
  `[canonical, ...aliasesOf(canonical)]`.
- Conflict rules in `learn` (pair `{pn, lid}`):
  1. No row for `pn` → insert `pn → lid`; also set `chats.phone` on the LID chat.
  2. `pn → lid` already → no-op.
  3. `pn → otherLid` (number recycled / re-registered) → re-point the alias to the new LID for **future**
     routing only, never merge `otherLid` and `lid`; clear `phone` on `otherLid` if it equals this PN;
     log `warn {mod:'contacts', pn, from: otherLid, to: lid}` (PN digits are not secret but avoid message text).
  4. A LID is never an alias of another LID; a PN never canonical while its LID is known.
- Never alias `ctx.wa.status.me.jid` / own LID, groups, broadcast or newsletter JIDs (reuse `normalizeContactJid`).

## 6. Merging existing duplicates

New `packages/server/src/chats/merge.ts`: `mergeChat(db, from, to): MergeResult | null`, called by
`AliasStore.learn` whenever both `chats` rows exist, and by a startup sweep over `jid_aliases` where
`alias_jid` still has a `chats` row (idempotent leftovers). Existing data is merged on the first connect after
upgrade, because `wa-bridge/bridge.ts#restoreContactAliases` already reads every contact/chat JID from the key
store and feeds `upsertContactAliases`.

**Backup first.** Before the first merge in a process run, if setting `lid_merge_backup_at` is unset, call
`runBackup` (`backup/backup.ts`) with a new optional label → `backups/app-premerge-YYYYMMDD.db`
(+ `wa-auth-…`), then store the setting. Merge refuses to run (logs `error`, leaves chats split) if the
backup throws. The pre-merge backup is excluded from the 7-day rotation for 30 days.

**One `db.transaction` per pair** (`from` = alias JID, `to` = canonical), synchronous, no awaits inside:

| Data | Rule |
| --- | --- |
| `messages` | `UPDATE messages SET chat_jid = to WHERE chat_jid = from` (ids are global PKs; no collisions). `wa_remote_jid` unchanged. Pending `local-%` rows move too. |
| `chat_events`, `notes` | `UPDATE … SET chat_jid = to`. Ordering by `at`/`created_at` interleaves naturally. |
| `unread_count` | sum of both. |
| `last_message_at` / `preview` | from the row with the larger `last_message_at`. |
| `status` | `open` if either is `open` (never hide a live conversation). |
| `assigned_to` | equal → keep; one NULL → the other; both set and differ → owner of the chat with the latest inbound message; the dropped owner is written to the audit meta and an `assigned` event `{assignedTo, previous, reason:'merge'}` is inserted (`chat:event` emitted after commit). |
| `name` | saved contact name > non-fallback name (`isFallbackName`) > `to.name`. |
| `avatar_path` | `to` if set, else `from`. |
| `phone` | PN digits of `from` when `from` is a PN, else existing. |
| `type`, `updated_at` | `dm`; `now`. |
| `chats` row `from` | `DELETE`. |
| `jid_aliases` | ensure `from → to`; re-point any alias whose canonical was `from`. |
| media files | **not moved**: `media_path` is stored per message relative to the media root and stays valid; new media for the merged chat is written under `to`. |

If `to` has no `chats` row but `from` has, re-key instead (insert `to` with `from`'s fields, move children,
delete `from`). After commit: `queue.rekey(from, to)`, move `inflight` entry, emit `chat:merged`
(§9) then `chat:updated` for `to`, and log `info {mod:'contacts', from, to, messages, events, notes}`.
Idempotence: a second run finds no `from` row and returns `null`.

## 7. Ingest-time routing

`messages/service.ts#ingest` for DMs:

1. If `m.chatJidAlt` is present, `aliases.learn({jid: m.chatJid, alias: m.chatJidAlt}, 'message')` first
   (may merge).
2. `chatJid = aliases.resolve(m.chatJid)`; store `chat_jid = chatJid`, `wa_remote_jid = m.chatJid`.
3. `inflight` echo de-dup, `ensure`, unread/reopen, `inbound:notify` all use the resolved JID.

`applyStatus` is id-based and unaffected. `upsertFromWa` (`chats` events) resolves the JID before `ensure`
so history `chats.upsert` cannot recreate a merged PN row. `contacts`/`upsertContactAliases` keep name sync.
Every `/api/chats/:jid*` route (`routes/chats.ts`, `messages.ts`, `notes.ts`) resolves `:jid` through the
alias store, so `/chats/<pn>` and old push notifications open the canonical chat.

## 8. Sending replies

- Send-queue key stays the canonical `chat_jid` (FIFO, 1s spacing and `composing` per person).
- Target JID per job: `wa_remote_jid` of the latest inbound message in the chat, else `chats.jid`. This
  replies in the addressing the customer last used, which is what WhatsApp itself delivered. Stored on the
  job (`SendJob.targetJid`) at enqueue and on the `local-%` message row as `wa_remote_jid`, so restore after
  restart is deterministic.
- `SendQueue.rekey(from, to)` (`messages/send-queue.ts`): append `from`'s pending jobs to `to`'s queue in
  `created_at` order; a job already running finishes with its own `targetJid`.
- `markRead`: group the last 20 inbound ids by `wa_remote_jid` and call `wa.markRead(jid, ids)` per group
  (the adapter builds keys with `remoteJid = chatJid`, so mixed ids would send wrong receipt keys).
- `sendPresence` uses the same target JID as the next send.

## 9. Contract changes (`packages/shared`)

- `ChatSchema` (`models.ts`): add `phone: z.string().nullable()` — PN digits without `+`, `null` when unknown.
- New socket event in `socket.ts` + `bus.ts`: `'chat:merged': (p: { from: string; to: string }) => void`,
  broadcast to room `all` by `realtime/socket.ts`.
- `ChatDetailResponse` unchanged; `GET /api/chats/:jid` returns the canonical chat (its `jid` may differ
  from the request).
- `POST /api/dev/fake-incoming` accepts optional `chatJidAlt` (fake WA only).
- Search: `chats/repo.ts#list` also matches `c.phone`.

## 10. Web (`apps/web`)

- `lib/jid.ts`: `formatJid` returns `''` for `@lid`; new `formatPhone(chat)` → `+<phone>` or `null`.
- `ConversationHeader.tsx`: subtitle shows `+<phone>` when known, otherwise muted "Phone number hidden".
  `ChatListItem.tsx` fallback name uses phone, then "Unknown contact" — never LID digits.
- `api/queries.ts`: on `chat:merged` remove `from` from every chat-list page, drop `qk.chat(from)` and its
  message/notes queries, invalidate `qk.chat(to)`.
- Conversation route: if the open chat is `from` (socket event) or the detail response `jid` differs from the
  URL, `navigate('/chats/' + encodeJid(to), { replace: true })`. Wrapped by the existing `ErrorBoundary`; 360px
  layout unchanged.

## 11. Rollback and safety

- Pre-merge backup (§6) is the restore point: stop server, copy `app-premerge-*.db` over `app.db`.
- Downgrade: older builds ignore `user_version 2` columns/table and keep working on merged data; they would
  only split new messages again.
- No feature flag: the merge is a permanent migration. Recovery from a bad merge is the pre-merge backup.
- All merges are logged and audited with counts; no merge ever happens from a name or number match.
- Real data: development and tests use `--data <temp>` only; the live merge is first observed on the user's
  machine after a manual backup check.

## 12. Tests

Unit / integration (Vitest, no e2e in the feature branch):

- `packages/server/src/chats/merge.test.ts`: fixture DB built by `migrate()` on a temp file, seeded with the
  live shape (PN chat 64 msgs, LID chat 5 msgs, same name; plus events, notes, a pending `local-` row, media
  rows). Assert counts moved, unread sum, last message, open-wins, all assignee cases, audit row, alias row,
  PN chat deleted, second run returns `null`, rollback on a thrown error inside the transaction.
- `packages/server/src/db/migrate.test.ts`: v1 DB with data → 002 applies, backfills `wa_remote_jid` and
  `chats.phone`.
- `packages/server/src/chats/aliases.test.ts`: resolve, conflict rules 1–4, own JID and groups ignored,
  cache reload from DB.
- `packages/server/src/wa-bridge/bridge.test.ts` with `FakeWaAdapter`: inbound on PN then LID with
  `chatJidAlt` → one chat; `simulateContactAliases` after both exist → merge + `chat:merged`; reconnect
  recovery via `getContactAliases` merges; unread/notify go to canonical.
- `packages/server/src/messages/send-queue.test.ts`: `rekey` preserves order and spacing; restore uses
  `targetJid`.
- Messages service: reply target = last inbound `wa_remote_jid`; `markRead` groups by `wa_remote_jid`;
  echo de-dup across PN/LID.
- Route tests: `/api/chats/<pn>` returns canonical chat; notes/messages routes resolve aliases.
- `packages/wa/src/baileys/mapping.test.ts`: `chatJidAlt` from `remoteJidAlt`, device suffix stripped, null for
  groups. Web: `jid.test.ts`, `ConversationHeader` phone/hidden, `chat:merged` cache handling + redirect.

**Untested against real WhatsApp** (must be smoke-tested on a linked test number before release, per
AGENTS.md): presence and contents of `remoteJidAlt` on live and history messages in rc14; sending to a LID
vs PN target; read receipts with LID keys; `lid-mapping` key-store coverage for the 1257 existing chats; echo
`remoteJid` of our own sends to a PN target.

## 13. Rollout

1. Shared schema + migration 002 + `AliasStore` + merge (server) with tests.
2. Adapter `chatJidAlt`, fake adapter helpers.
3. Ingest/send/markRead routing; route alias resolution.
4. Web header/list/merge handling.
5. Consolidated verification once; manual smoke on a test number; release note in `CHANGELOG.md`
   ("Chats for the same person under phone number and WhatsApp ID are merged").

## 14. Decisions (2026-10-05, from the owner)

- Merges run **automatically on first connect** after the upgrade (backup first, idempotent).
- Replies go to the **last inbound `wa_remote_jid`**.
- Chats without a known phone show **"Phone number hidden"** in the header.
- **One owner per chat.** A merged chat keeps exactly one owner (owner of the chat with the latest inbound
  message, per §6). Owner's stated rule for the product, recorded here and planned as a **separate follow-up
  feature, not part of this merge**: once a chat has an owner, other agents cannot reply — their composer is
  greyed out with an "Assign to me" action; replying requires assigning the chat to yourself first.
- **The LID always wins** when both IDs are known, following WhatsApp's new standard. Backward compatible:
  a chat whose LID is not known keeps its phone-number JID and the old display format (`+<phone>`) until
  WhatsApp reveals the LID, then it is merged/rekeyed like any other pair. Old URLs keep working through aliases.
- **No feature flag** — permanent migration.
- Pre-merge backup kept **30 days**.
