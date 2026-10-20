# Multi-inbox (several WhatsApp numbers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> In this repo the owner chose the **Workflow** tool: the orchestrator runs the waves below, agents own disjoint
> files, only the orchestrator commits, agents never run e2e or the full suite.

**Goal:** One EzyChat install links several WhatsApp numbers (each an *inbox*, a linked phone with a QR scan);
admins see every inbox, an agent sees only the inboxes an admin gave them, everyone works in one unified chat list.

**Architecture:** The core gets an `inboxes` table and an `InboxConnections` registry that owns one `WaAdapter`,
one bridge and one send queue per inbox. A chat keeps its opaque string key in `chats.jid`: for inbox 1 the key is
the WhatsApp JID (no data move, Lite unchanged), for other inboxes it is `<waJid>#<inboxId>`; message ids follow the
same rule. Access is enforced only on the server (404 for other inboxes, `inbox:<id>` socket rooms, filtered push).
Lite passes `maxInboxes: 1`, so no inbox UI shows; Enterprise passes a higher limit through `runCli`.

**Tech Stack:** TypeScript strict ESM, Fastify, better-sqlite3, zod (`@ezychat/shared`), Socket.IO, Baileys,
React + react-query + shadcn/ui, Vitest, Playwright.

**Spec:** `docs/features/multi-inbox/design.md` (confirmed mock: `docs/features/multi-inbox/mock/`, revision
`f585ace8860647ef050c4b786059233cf0dd6227`). Code maps: the five survey reports summarised in this plan.

## Global Constraints

- Inbox 1 is the number linked today: `wa-auth/` stays where it is, its chat keys and message ids stay unchanged,
  no relink. Every existing chat gets `inbox_id = 1`.
- Other inboxes keep their Baileys files in `wa-auth-inboxes/<id>/` (a sibling folder, never inside `wa-auth/`,
  because `AuthStore.wipe()` runs `rm -rf` on the folder).
- Chat key: `chatKey(1, waJid) === waJid`; `chatKey(n, waJid) === \`${waJid}#${n}\`` for n > 1. Message key: same
  rule on the WhatsApp message id. `#` never occurs in a WhatsApp JID or message id.
- Inbox ids are positive integers; inbox 1 always exists and cannot be removed (409 `primary_inbox`).
- Lite: `maxInboxes = 1`. Creating an inbox above the limit answers 409 `{ error: 'inbox_limit' }`.
- `--max-inboxes <n>` is accepted only with `--mode dev` and `--fake-wa` (never env, never in production modes).
- Admins: all inboxes. Agents: the rows in `inbox_members`. The AI member: all inboxes (one AI for all, design
  default 2). An out-of-scope chat, message or media id answers **404**, never 403.
- Inbox UI (chip, filter, per-inbox banner text, Members column) shows only when the user may open more than one
  inbox; the Admin nav shows **Inboxes** instead of **WhatsApp** only when `maxInboxes > 1`. Lite screens stay
  byte-identical.
- Remove inbox: unlink the phone (logout + wipe its own folder), stop its queue, set `removed_at`; its chats stay,
  read only, visible to admins only; sending into them answers 409 `inbox_removed`.
- Tones by creation order: `primary`, `warning`, `info`, `success`, then repeat. Name: 1–40 characters, trimmed.
- Audit actions: `inbox.create`, `inbox.update`, `inbox.remove`, `inbox.access_update`; `wa.*` actions get
  `meta.inboxId`. Logs and audit never hold message text or phone numbers beyond what they hold today.
- No literal UI strings: `t()` with keys in `en`, `ms` and `zh-CN` (real translations). Design-system tokens only.
- Every new route and socket payload is a zod schema in `@ezychat/shared` first.
- ≥ 90 % of changed lines covered; contract test against the real server for every new web call.
- Out of this plan (design "Later" / follow-up): the Business API inbox type, the desktop status window line per
  inbox, per-inbox AI on/off, an inbox limit from the licence.

## Review Focus

1. The same customer JID writes to inbox 1 and inbox 2 → two chats; a reply from each leaves from its own number.
2. The same group message id arrives through two inboxes → both rows are stored (no `INSERT OR IGNORE` loss), and
   receipts and media downloads resolve to the right inbox.
3. An agent without access to inbox 2 gets 404 on every per-chat route, on `/media/:id` and on
   `/messages/:id/retry`, receives no socket event and no push for inbox 2, and is never picked by assignment or AI
   hand-off for it.
4. Inbox 2's phone goes offline → inbox 1's queued messages still send; the banner names inbox 2 only.
5. An existing Lite data dir upgrades → one inbox, `wa-auth/` untouched, every chat key unchanged, `/api/wa/*`
   and every Lite screen behave as before; removing inbox 2 never touches `wa-auth/`.

Each line has its test in the owning task (marked **RF-n**).

---

## Waves (how the workflow runs this plan)

| Wave | Tasks (parallel inside a wave, disjoint files) | Commit after |
|---|---|---|
| 1 | Task 1 (foundation) | yes |
| 2 | Task 2 (messages + bridge + queues), Task 3 (chats, aliases, groups, backup), Task 6 (web data layer + inbox screens), Task 7 (admin Inboxes + Members + nav) | yes |
| 3 | Task 4 (access, routes, socket, push), Task 5 (MCP, AI, stats) | yes |
| 4 | Task 8 (orchestrator only): e2e spec, docs, consolidated verification, screen review, Dev Build check | yes |

Each implementation agent is followed by a reviewer agent (spec compliance + code quality) before the wave ends.

---

### Task 1: Foundation — contract, migration, inbox registry, test helpers

**Files:**
- Create: `packages/shared/src/inboxes.ts` (export from `packages/shared/src/index.ts`)
- Modify: `packages/shared/src/models.ts` (`ChatSchema`), `packages/shared/src/socket.ts`
- Create: `packages/server/src/db/migrations/014_inboxes.sql`
- Create: `packages/server/src/inboxes/keys.ts`, `inboxes/repo.ts`, `inboxes/connections.ts`, `inboxes/access.ts`
- Modify: `packages/server/src/context.ts`, `main.ts`, `run-cli.ts`, `config.ts`, `cli.ts` (flag parse only)
- Modify: `packages/wa/src/fake/fake-adapter.ts` (constructor options)
- Modify: `packages/server/test/helpers.ts` (`makeTestApp`)
- Test: `packages/shared/test/inboxes.test.ts`, `packages/server/test/inboxes-foundation.test.ts`,
  `packages/server/src/inboxes/keys.test.ts`, `packages/wa/test/fake-adapter.test.ts` (extend)

**Interfaces:**
- Produces (shared):
  - `InboxTone = z.enum(['primary','warning','info','success'])`
  - `InboxSchema = z.object({ id: z.number().int().positive(), name: z.string().min(1).max(40), tone: InboxTone,
    number: z.string().nullable(), status: WaStatusSchema, removed: z.boolean(),
    memberIds: z.array(z.number().int().positive()).optional() /* admins only */ })`
  - `InboxListResponse = z.object({ inboxes: z.array(InboxSchema), maxInboxes: z.number().int().positive(),
    canAdd: z.boolean() })`
  - `CreateInboxBody = z.object({ name: z.string().trim().min(1).max(40), memberIds: z.array(...).default([]) })`
  - `UpdateInboxBody = z.object({ name?, memberIds? })` refined: at least one field
  - `SetUserInboxesBody = z.object({ inboxIds: z.array(z.number().int().positive()) })`
  - `InboxStatusPayload = z.object({ inboxId, status: WaStatusSchema })`
  - `ChatSchema` gains `inboxId: z.number().int().positive()` and `waJid: z.string()`
  - `UserSchema` gains optional `inboxIds: z.array(z.number().int().positive()).optional()` (admin responses only)
  - `DirectoryUser` gains `inboxIds: z.union([z.literal('all'), z.array(z.number().int().positive())])`
  - Server→client socket events: `'inbox:status': (p: InboxStatusPayload) => void`, `'inboxes:changed': () => void`
    (`'wa:status'` stays, for inbox 1 only)
- Produces (server):
  - `keys.ts`: `PRIMARY_INBOX_ID = 1`, `chatKey(inboxId: number, waJid: string): string`,
    `parseChatKey(key: string): { inboxId: number; waJid: string }`, `messageKey(inboxId, waId): string`,
    `waMessageId(key: string): string`, `inboxOfKey(key: string): number`
  - `repo.ts`: `InboxRow { id, name, tone, auth_dir, own_jid, created_at, removed_at }`;
    `class InboxRepo { list(): InboxRow[]; active(): InboxRow[]; get(id): InboxRow | null;
    insert(name, tone, now): InboxRow; rename(id, name); markRemoved(id, now); setOwnJid(id, jid | null);
    members(inboxId): number[]; setMembers(inboxId, userIds: number[]); userInboxIds(userId): number[];
    setUserInboxes(userId, inboxIds: number[]) }`
  - `connections.ts`: `class InboxConnections { adapter(inboxId): WaAdapter; forChatKey(key): WaAdapter;
    statuses(): Map<number, WaStatus>; ownJids(): Set<string>; add(row: InboxRow): Promise<WaAdapter>;
    remove(inboxId): Promise<void>; connectAll(): Promise<void>; disconnectAll(): Promise<void>;
    on('added'|'removed', (inboxId: number, wa: WaAdapter) => void); maxInboxes(): number }`
  - `access.ts`: `type InboxScope = 'all' | ReadonlySet<number>`; `scopeFor(ctx, user: User): InboxScope`;
    `canOpen(scope, inboxId): boolean`; `scopeIds(ctx, scope): number[]` (active inbox ids in scope);
    `usersWhoCanOpen(ctx, inboxId): number[]` (active humans: admins + members)
  - `AppContext.inboxes: { repo: InboxRepo; connections: InboxConnections }`; `ctx.wa` stays and equals
    `connections.adapter(1)`
  - `CliProduct.maxInboxes?: number`, `startServer(cfg, { …, maxInboxes })`, `createContext(cfg, { …, maxInboxes,
    inboxAdapters?: Record<number, WaAdapter> })`; `ServerConfig.maxInboxes?: number` (dev flag)
  - `FakeWaAdapter(opts?: { autoOpen?: boolean; me?: { jid: string; name: string }; idPrefix?: string })`
  - `makeTestApp({ …, maxInboxes?: number, inboxes?: number })` returns `TestApp & { inboxWa(id: number):
    FakeWaAdapter; addInbox(name: string, memberIds?: number[]): Promise<number> }`

- [ ] **Step 1: Write the failing tests**
  - `keys.test.ts`: `chatKey(1,'6012@s.whatsapp.net') === '6012@s.whatsapp.net'`;
    `chatKey(2,'6012@s.whatsapp.net') === '6012@s.whatsapp.net#2'`; `parseChatKey('x@g.us#3')` →
    `{inboxId:3, waJid:'x@g.us'}`; `parseChatKey('x@g.us')` → `{inboxId:1,…}`; `parseChatKey('a#0')`,
    `'a#x'`, `'a#2#3'` throw; same for `messageKey`/`waMessageId`.
  - `inboxes-foundation.test.ts`:
    - "upgrades an existing data dir to one inbox" (**RF-5**): build a data dir at `user_version 13` with two chats
      and a `wa-auth/creds.json`, start → `inboxes` has exactly row 1 (`auth_dir 'wa-auth'`), both chats
      `inbox_id = 1` and `wa_jid = jid`, `wa-auth/creds.json` unchanged (same bytes).
    - "Lite refuses a second inbox": `makeTestApp()` → `connections.maxInboxes() === 1`.
    - "each inbox gets its own adapter and folder": `makeTestApp({ maxInboxes: 3, inboxes: 2 })` →
      `inboxWa(2) !== inboxWa(1)`, `inboxWa(2).status.me.jid !== inboxWa(1).status.me.jid`, row 2 `auth_dir ===
      'wa-auth-inboxes/2'`.
    - "--max-inboxes only in dev with fake WhatsApp": `parseConfig(['--max-inboxes','3'])` without
      `--fake-wa --mode dev` throws; with both it gives `maxInboxes: 3`.
  - `inboxes.test.ts` (shared): `CreateInboxBody` trims, rejects `''` and 41 characters;
    `UpdateInboxBody.parse({})` fails.
  - fake adapter: two instances with different `idPrefix` never produce the same message id.
- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run packages/server/src/inboxes packages/server/test/inboxes-foundation.test.ts packages/shared/test/inboxes.test.ts packages/wa/test/fake-adapter.test.ts`
  Expected: FAIL (modules not found).
- [ ] **Step 3: Write `014_inboxes.sql`**
  - `inboxes(id INTEGER PRIMARY KEY, name TEXT NOT NULL, tone TEXT NOT NULL, auth_dir TEXT NOT NULL UNIQUE,
    own_jid TEXT, created_at INTEGER NOT NULL, removed_at INTEGER)`; insert `(1, '<WhatsApp>', 'primary',
    'wa-auth', NULL, <now ms via strftime>, NULL)` — the name is `'WhatsApp'` (admins rename it).
  - `inbox_members(inbox_id INTEGER NOT NULL REFERENCES inboxes(id), user_id INTEGER NOT NULL REFERENCES users(id)
    ON DELETE CASCADE, PRIMARY KEY(inbox_id, user_id))`.
  - `ALTER TABLE chats ADD COLUMN inbox_id INTEGER NOT NULL DEFAULT 1`; `ALTER TABLE chats ADD COLUMN wa_jid TEXT`;
    `UPDATE chats SET wa_jid = jid`; `CREATE UNIQUE INDEX idx_chats_inbox_wa ON chats(inbox_id, wa_jid)`;
    `CREATE INDEX idx_chats_inbox_last ON chats(inbox_id, last_message_at DESC)`.
  - No child-table change (keys stay strings).
- [ ] **Step 4: Implement keys, repo, connections, access, context wiring, CLI flag, fake options, test helper**
  - `connections.add(row)`: fake mode → `new FakeWaAdapter({ me: { jid: \`6000000000${row.id}@s.whatsapp.net\`,
    name: row.name }, idPrefix: \`FAKE${row.id}\` })` for rows > 1 (row 1 keeps today's fake identity); real mode →
    `createRealWaAdapter({ authDir: join(dataDir, row.auth_dir), historyDays, logger: log.child({ mod: 'wa',
    inboxId: row.id }) })`. A new inbox row gets `auth_dir = 'wa-auth-inboxes/<id>'`.
  - `startServer`: `connectAll()` staggered 500 ms apart; shutdown `disconnectAll()` with `Promise.allSettled`.
  - `ctx.wa` is defined once as the inbox 1 adapter (`deps.wa` still means inbox 1 for Enterprise tests).
- [ ] **Step 5: Run the tests of Step 2 and `npm run typecheck -w @ezychat/server -w @ezychat/shared -w @ezychat/wa`**
  Expected: PASS. Every existing server test still passes unchanged (`npx vitest run packages/server` is allowed
  here only for the files that import `makeTestApp`… run `npx vitest run packages/server/test/auth.test.ts
  packages/server/test/extensions.test.ts` as the smoke).
- [ ] **Step 6: Record the stage** — `node scripts/build-summary.mjs record Dev in-progress "Task 1 foundation"`.

---

### Task 2: Messages, bridge and one send queue per inbox

**Files:**
- Modify: `packages/server/src/wa-bridge/bridge.ts`, `wa-bridge/index.ts`
- Modify: `packages/server/src/messages/service.ts`, `messages/send-queue.ts` (only if a dep changes),
  `messages/repo.ts`, `messages/media-store.ts`, `messages/mentions.ts`, `voice/service.ts`
- Modify: `packages/server/src/routes/dev.ts`, `packages/shared/src/api.ts` (`FakeIncomingBody.inboxId?`),
  `packages/shared/src/groups.ts` (`FakeGroupBody.inboxId?`)
- Test: `packages/server/src/wa-bridge/bridge.test.ts` (extend), `packages/server/test/multi-inbox-messages.test.ts`

**Interfaces:**
- Consumes: Task 1 `keys.ts`, `ctx.inboxes.connections` (`adapter`, `on('added'|'removed')`, `statuses`).
- Produces:
  - `attachWaBridge(ctx, inboxId: number, wa: WaAdapter): () => void`; `initMessaging` attaches one bridge per
    inbox and attaches/detaches on `added`/`removed`.
  - `messages.ingest(m: WaMessage, source, inboxId: number)`; `applyStatus(u, inboxId)`;
    `chats.upsertFromWa(c, inboxId)` is called with the inbox (Task 3 implements its side).
  - `messages.queueFor(inboxId): SendQueue` (one `SendQueue` per inbox, deps closed over that adapter);
    `messages.queue` stays as `queueFor(1)` for existing callers.
  - Bus: `'wa:status'` keeps `[WaStatus]` for inbox 1; new `'inbox:status': [InboxStatusPayload]` for every inbox.
  - `ctx.services.waStatus` stays (inbox 1); `ctx.inboxes.connections.statuses()` is the per-inbox view.
  - Dev: `POST /api/dev/fake-incoming` and `/api/dev/fake-group` take optional `inboxId` (default 1);
    new `POST /api/dev/fake-link { inboxId }` sets that fake adapter connected (for e2e "scan").

- [ ] **Step 1: Write the failing tests** (`multi-inbox-messages.test.ts`, `makeTestApp({ maxInboxes: 3, inboxes: 2 })`)
  - "same customer, two numbers, two chats" (**RF-1**): `inboxWa(1).simulateIncoming({ chatJid: C })` and
    `inboxWa(2).simulateIncoming({ chatJid: C })` → chats `C` (inboxId 1) and `C#2` (inboxId 2), each with one
    message; `POST /api/chats/C%232/messages {text}` → `inboxWa(2).sent` has it, `inboxWa(1).sent` has none.
  - "same group message id in two inboxes" (**RF-2**): both fakes deliver id `G1` in group `g@g.us` → messages
    `G1` and `G1#2` both exist; `inboxWa(2).simulateStatus` receipt for `G1` updates only `G1#2`.
  - "one phone offline does not stop the other" (**RF-4**): `inboxWa(2).setConnected(false)`; send into inbox 1
    chat → sent; send into inbox 2 chat → stays `pending`; `inboxWa(2).setConnected(true)` → sent.
  - "outgoing rows carry the inbox's own number": `sender_jid` of a reply in inbox 2 equals `inboxWa(2)` `me.jid`.
  - "media download asks the chat's own adapter": redownload of an inbox 2 media message calls
    `inboxWa(2).downloadMedia('<wa id>')` (suffix removed).
  - "restore after restart": a pending inbox 2 row restored on start goes to `queueFor(2)`.
  - bridge test: detaching inbox 2's bridge stops ingest from `inboxWa(2)` only.
- [ ] **Step 2: Run them and see them fail** — `npx vitest run packages/server/test/multi-inbox-messages.test.ts packages/server/src/wa-bridge`
- [ ] **Step 3: Implement** — ingest maps `(inboxId, m.chatJid)` → `chatKey`, `m.id` → `messageKey`, quoted ids the
  same; sending uses `parseChatKey(chat.jid).waJid`/`chat.waJid` as `targetJid` and `waMessageId` toward
  WhatsApp; `MediaStore` paths keep using the keys (check that `#` is safe in the path helper and encode it if
  the helper sanitises). Sending into a removed inbox throws `errors.conflict('inbox_removed')`.
- [ ] **Step 4: Run Step 2 again plus `npx vitest run packages/server/test/messages*.test.ts packages/server/test/send*.test.ts` and the server typecheck** — PASS.

---

### Task 3: Chats, aliases, merge, identity migration, groups, avatars, backups

**Files:**
- Modify: `packages/server/src/chats/{repo,service,aliases,merge,identity-migration,activity,stats}.ts`
  (activity/stats: only the `inbox_id IN (…)` parameter, used by Task 5)
- Modify: `packages/server/src/customers/{sql,service}.ts` (sender profiles stay inside the group's inbox)
- Modify: `packages/server/src/groups/service.ts`, `packages/server/src/http/profile-images.ts`
- Modify: `packages/server/src/backup/backup.ts`
- Test: `packages/server/test/multi-inbox-chats.test.ts`, extend `backup` and `identity-migration` tests

**Interfaces:**
- Consumes: Task 1 keys, repo, connections (`ownJids`, `forChatKey`).
- Produces:
  - `ChatRepo.ensure(inboxId, waJid, init, now)` → key; `ChatRepo.byWa(inboxId, waJid): ChatRow | null`;
    `ChatRepo.list(f & { inboxIds: number[]; inbox?: number })` (empty `inboxIds` → `[]`);
    `ChatRepo.get(key)` unchanged; `rowToChat` fills `inboxId`, `waJid` and parses JID shape from `wa_jid`.
  - `chats.upsertFromWa(c, inboxId)`, `chats.resolveJid(key)` (alias routing stays inside the key's inbox).
  - `AliasStore.route(inboxId, jid): string` (returns a chat key); `learn()` ignores every `ownJids()` member;
    `pendingMerges()` returns `{ inboxId, from, to }` and `mergeChat` refuses keys of two inboxes.
  - `runIdentityMigration` loops over `inboxes.repo.active()` auth dirs.
  - Groups: cache key `${inboxId}|${groupJid}`; `startChat` creates the DM in the group's inbox; `myJids()` from
    the group's inbox status.
  - `markRead`, avatars and profile pictures use `connections.forChatKey(key)`.
  - Backup: copies `wa-auth` as today and `wa-auth-inboxes` to `backups/wa-auth-inboxes-<stamp>`; prune regexes
    cover both names.

- [ ] **Step 1: Write the failing tests** (`multi-inbox-chats.test.ts`)
  - "a LID alias learned in inbox 2 never routes into inbox 1": inbox 1 has chat `P@s.whatsapp.net`; inbox 2
    learns `P ↔ L@lid` and receives from `L@lid` → lands in `L@lid#2` (or `P…#2`), inbox 1 chat untouched.
  - "startup merge stays inside one inbox": duplicates in inbox 2 merge; a PN chat in inbox 1 and its LID chat in
    inbox 2 do not.
  - "own numbers of every inbox are ignored by alias learning".
  - "group member chat opens in the group's inbox": `POST /chats/g@g.us%232/members/<m>/chat` creates `<m>#2`.
  - "list filters by inboxIds and inbox": three chats over two inboxes; `list({inboxIds:[2]})` returns only
    inbox 2; `inboxIds: []` returns none; `inbox: 1` narrows.
  - "backup keeps every inbox's WhatsApp folder and never moves wa-auth" (**RF-5**): after `runBackupSync`,
    `backups/wa-auth-<stamp>/creds.json` and `backups/wa-auth-inboxes-<stamp>/2/creds.json` exist; old copies of
    both names are pruned to 7.
- [ ] **Step 2: Fail** — `npx vitest run packages/server/test/multi-inbox-chats.test.ts packages/server/test/backup*.test.ts packages/server/test/identity*.test.ts`
- [ ] **Step 3: Implement** (28 JID-shape sites read `wa_jid`/`type`, never parse the key).
- [ ] **Step 4: Pass** — Step 2 command + `npx vitest run packages/server/test/chats*.test.ts packages/server/test/groups*.test.ts packages/server/test/aliases*.test.ts` + server typecheck.

---

### Task 4: Access, inbox routes, socket rooms, push, assignment

**Files:**
- Create: `packages/server/src/routes/inboxes.ts`, `packages/server/src/inboxes/service.ts`
- Modify: `packages/server/src/routes/{chats,messages,media,notes,customers,groups,wa,users,directory}.ts`,
  `packages/server/src/routes/index.ts` (register), `packages/server/src/realtime/socket.ts`,
  `packages/server/src/push/service.ts`, `packages/server/src/chats/service.ts` (`patch` assignee check only —
  coordinate: Task 3 has finished with this file in wave 2), `packages/server/src/customers/repo.ts` (`suggest`)
- Test: `packages/server/test/inbox-access.test.ts`, `packages/server/test/inboxes-routes.test.ts`,
  `packages/server/test/inbox-realtime.test.ts`, extend `push` tests

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (HTTP, all under `/api`):
  - `GET /inboxes` (any user) → `InboxListResponse` with the inboxes in the caller's scope; `status.qr` only for
    admins; `memberIds` only for admins; removed inboxes only for admins.
  - `POST /inboxes` (admin) `CreateInboxBody` → `Inbox` (409 `inbox_limit`); audit `inbox.create`.
  - `PATCH /inboxes/:id` (admin) `UpdateInboxBody` → `Inbox`; audit `inbox.update` with changed field names.
  - `DELETE /inboxes/:id` (admin) → 204 (409 `primary_inbox` for 1); audit `inbox.remove`.
  - `POST /inboxes/:id/wa/{logout,relink,takeover}`, `POST /inboxes/:id/wa/pairing-code` (admin) — same bodies and
    audit as `/wa/*` plus `meta.inboxId`; `/wa/*` stays as inbox 1.
  - `PUT /users/:id/inboxes` (admin) `SetUserInboxesBody` → `User`; audit `inbox.access_update`; unassigns that
    user's open chats in inboxes they lost.
  - `GET /users` adds `inboxIds` for agents; `GET /users/directory` adds `inboxIds` (`'all'` for admins and AI).
  - `GET /chats?inbox=<id>`.
  - `requireChatAccess(ctx, req, key): ChatRow` in `inboxes/access.ts`-backed helper replacing `chatJidParam`
    use in every per-chat route; message-id routes look up message → chat first.
- Produces (socket): sockets join `inbox:<id>` for each id in scope (admins: all, AI n/a); every chat/message/
  note/event/typing emit goes to `inbox:${inboxOfKey(chatJid)}`; `'inbox:status'` → `admins` (with QR) and
  `inbox:<id>` (QR removed); `'inboxes:changed'` → `all`; `onInboxAccessChanged(userId)` rebuilds rooms.
- Produces (push): `recipients(chat)` = `usersWhoCanOpen(inboxId)` for unassigned, assignee only while they can
  open it; WhatsApp-offline alerts are per inbox (`Map<number, state>`), text names the inbox when more than one
  is active, URL `/admin/inboxes` then.
- `ChatService.patch`: assignee must be the AI member or `canOpen(scopeFor(assignee), chat.inboxId)` else 400
  `assignee_no_access`.

- [ ] **Step 1: Write the failing tests**
  - `inbox-access.test.ts` (**RF-3**), table-driven over every per-chat route (GET/PATCH `/chats/:k`,
    `/read`, `/avatar`, `/messages` GET/POST, `/media` POST, `/notes` GET/POST, `/profile` GET/PUT, `/members`,
    `/members/:m/about|avatar|chat`) plus `GET /media/:id`, `POST /media/:id/redownload`,
    `POST /messages/:id/retry`: agent with access to inbox 1 only → 404 for the inbox 2 chat, 2xx/4xx-other for
    inbox 1; admin → never 404. `GET /chats` for that agent never returns an inbox 2 chat, also with `q` and `tag`.
    `GET /customer-tags` omits tags used only in inbox 2.
  - `inboxes-routes.test.ts`: Lite `POST /inboxes` → 409 `inbox_limit`; with `maxInboxes 3`: create (tone order),
    rename, members round-trip with `PUT /users/:id/inboxes`, `DELETE /inboxes/1` → 409, delete 2 →
    `inboxWa(2).logout` called, `wa-auth/` still has `creds.json` (**RF-5**), chats of 2 visible to admin only,
    send into them → 409 `inbox_removed`; agents never see `memberIds` or `qr`; audit rows exist with ids only.
  - `inbox-realtime.test.ts`: two socket clients (admin, agent with inbox 1) — an inbox 2 `message:new`,
    `chat:updated`, `typing` and `inbox:status` reach the admin only; after `PUT /users/:id/inboxes [1,2]` the agent
    gets the next inbox 2 event without reconnecting; after removing access it stops.
  - push: unassigned inbox 2 inbound notifies admins + inbox 2 members only; assignment to an agent without access
    → 400 `assignee_no_access`.
- [ ] **Step 2: Fail** — `npx vitest run packages/server/test/inbox-access.test.ts packages/server/test/inboxes-routes.test.ts packages/server/test/inbox-realtime.test.ts packages/server/test/push*.test.ts`
- [ ] **Step 3: Implement** the service, routes, guard, rooms and push changes.
- [ ] **Step 4: Pass** — Step 2 + `npx vitest run packages/server/test/web-client-contract.test.ts packages/server/test/wa*.test.ts packages/server/test/users*.test.ts` + server typecheck.

---

### Task 5: MCP, AI member, stats and activity

**Files:**
- Modify: `packages/server/src/mcp/{inbox,tools,send,send-tool,server}.ts`, `packages/shared/src/mcp.ts`
- Modify: `packages/server/src/ai/service.ts`, `packages/server/src/customers/enrichment.ts` (keys only)
- Modify: `packages/server/src/chats/stats.ts`, `chats/activity.ts` (consume Task 3's `inboxIds` parameter)
- Test: `packages/server/test/mcp-multi-inbox.test.ts`, extend `ai-service` hand-off tests

**Interfaces:**
- Consumes: Tasks 1–4 (`scopeFor`, `usersWhoCanOpen`, keys, connections).
- Produces:
  - Inbox tools take the token owner's scope (admins today: all). `list_chats`, `get_stats`, `get_activity` accept
    optional `inboxId`; results carry `inboxId` and `inboxName` per chat; `get_stats` adds `byInbox:
    { inboxId, name, open, waiting, … }[]` when more than one inbox is active.
  - `send_message` replies from the chat's inbox. `send_to_new_number` input gains optional `inboxId`
    (`McpSendToNewNumberInput`), required when more than one inbox is active (error `inbox_required` with the
    list of ids and names); the "own number" check uses `ownJids()`; `queued` uses that inbox's status.
  - AI hand-off candidates require `usersWhoCanOpen(chat.inboxId)`; releases and due scans use chat keys.
- [ ] **Step 1: Write the failing tests**
  - MCP: with two inboxes, `send_to_new_number` without `inboxId` → `inbox_required`; with `inboxId: 2` →
    `inboxWa(2).checkNumber` called and the new chat is `<n>#2`; texting inbox 1's own number from inbox 2 →
    refused; `get_stats` has `byInbox` with two rows; Lite (one inbox) tool schemas and results are unchanged
    (snapshot of `tools/list` input schema without `inboxId` required).
  - AI: hand-off of an inbox 2 chat never picks an agent who only has inbox 1 (**RF-3**).
- [ ] **Step 2: Fail** — `npx vitest run packages/server/test/mcp-multi-inbox.test.ts packages/server/test/ai*.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Pass** — Step 2 + `npx vitest run packages/server/test/mcp*.test.ts` + server typecheck.

---

### Task 6: Web data layer and the inbox screens (chat list, filter, chip, header, conversation, banner)

**Files:**
- Modify: `apps/web/src/api/queries.ts` (`qk.inboxes`, `useInboxes`, `ChatFilters.inbox`, assignable filter),
  `apps/web/src/api/socket.ts` (`inbox:status`, `inboxes:changed`)
- Create: `apps/web/src/inbox/InboxChip.tsx`, `apps/web/src/inbox/useVisibleInboxes.ts` (ported from the mock,
  typed on shared `Inbox`, no client access logic)
- Modify: `apps/web/src/inbox/{ChatList,ChatListItem,ChatFilters,ConversationHeader,Conversation,WaBanner}.tsx`,
  `apps/web/src/inbox/useDirectory.ts` (assignable per inbox)
- Modify: `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json` (`inboxFilter.*`, `waBanner.*` with `{{name}}`)
- Test: co-located `*.test.tsx` for each changed component

**Interfaces:**
- Consumes: Task 1 shared schemas only (server routes may still be in progress; tests mock `api()` like the
  existing component tests).
- Produces: `useInboxes(): UseQueryResult<InboxListResponse>`; `useVisibleInboxes(): Inbox[]` (active, in scope);
  `useInboxStatus(inboxId): WaStatus | undefined`; `InboxChip({ inbox: Pick<Inbox,'name'|'tone'>, className })`.
- Behaviour from the mock: chip after the customer name and before the number in the header, "All inboxes (n)"
  filter above Mine/Unassigned/All (value in `ChatFilters.inbox`, persisted like the other filters); all hidden
  with fewer than 2 visible inboxes. Conversation composer state uses the chat's inbox status. Banner: one per
  visible inbox that is not open, titled with the inbox name only when 2+ are visible (Lite text unchanged).
  The assign dropdown offers only members whose `inboxIds` include the chat's inbox. ChatList dedupe and keys use
  `chat.jid` (the key) as today. Do **not** port the mock's `accessOf`/`canOpen`, its no-access screen (404 uses
  the existing not-found state) or its `startedByAssistant` rewrite.
- [ ] **Step 1: Write the failing tests** — "one inbox shows no chip, no filter and today's banner text" (**RF-5**);
  "two visible inboxes show the chip, the filter with counts, and 'Catering is offline'"; "the filter sets
  `inbox` in the chats query"; "assign lists only members of the chat's inbox"; "the composer of an inbox 1 chat is
  not blocked while inbox 2 is offline" (**RF-4**).
- [ ] **Step 2: Fail** — `npx vitest run apps/web/src/inbox apps/web/src/api`
- [ ] **Step 3: Implement**; real ms and zh-CN text.
- [ ] **Step 4: Pass** — Step 2 + `npx vitest run apps/web/src/i18n` + `npm run typecheck -w @ezychat/web` + `npm run lint`.

---

### Task 7: Admin → Inboxes, inbox access on Members, nav swap, desktop deep link

**Files:**
- Create: `apps/web/src/api/inbox-mutations.ts`, `apps/web/src/admin/InboxesPage.tsx`, `apps/web/src/admin/InboxAccess.tsx`,
  `apps/web/src/admin/inbox-status.ts` (WaState → card status tone/label)
- Modify: `apps/web/src/admin/{AdminLayout,MembersPage,WhatsAppPage}.tsx`, `apps/web/src/wa/PhoneLink.tsx`
  (optional `inboxId`), `apps/web/src/admin/audit-actions.ts` (four `inbox.*` labels),
  `apps/web/src/extensions/types.ts` (`'inboxes'` in `WEB_EXTENSION_ADMIN_SECTIONS`)
- Modify: `apps/web/src/i18n/locales/{en,ms,zh-CN}/admin.json` (`inboxes.*`, from the mock's `mockInbox.*`
  without `simulateScan`, `scanning`, `scanOk`)
- Modify: `apps/desktop/src/notifications.ts` (allow `/admin/inboxes`)
- Test: co-located tests (`InboxesPage.test.tsx`, `InboxAccess.test.tsx`, `AdminLayout.test.tsx`,
  `MembersPage.test.tsx`, `audit-actions.test.ts`, desktop `notifications.test.ts`)

**Interfaces:**
- Consumes: Task 1 schemas; Task 6 `useInboxes`, `InboxChip`, `useInboxStatus` (wave 2 runs both: Task 7 imports
  them by these exact names; if Task 6 is not merged yet, Task 7 writes against the names and the reviewer checks).
- Produces: mutations `useCreateInbox`, `useUpdateInbox`, `useRemoveInbox`, `useInboxWaAction(inboxId)`,
  `useInboxPairingCode(inboxId)`, `useSetUserInboxes(userId)` in a new file `apps/web/src/api/inbox-mutations.ts`
  (Task 6 owns `queries.ts`; Task 7 only imports `qk` and `useInboxes` from it).
- Behaviour = the confirmed mock: cards (chip, number or "Shown after the scan", "WhatsApp app (linked phone)",
  status, who can open, Edit, Remove), Add/Edit dialog with name + **Who can open it** (admins as badges, agents
  as tick boxes, warning when none), Save then the real QR from `inbox:status` (and the pairing-code link through
  `PhoneLink inboxId`), "Link the phone again", remove confirm. Members: Inbox access column / phone line,
  dialog with tick boxes. Nav: `inboxes` replaces `whatsapp` only when `maxInboxes > 1`; `/admin/whatsapp`
  redirects to `/admin/inboxes` then.
- [ ] **Step 1: Write the failing tests** — "Lite nav shows WhatsApp, not Inboxes" (**RF-5**); "maxInboxes 3 shows
  Inboxes and /admin/whatsapp redirects"; "Add inbox posts name + memberIds then shows the QR from the status";
  "Edit inbox ticks the current members and saves the changed set"; "Remove is not offered for inbox 1";
  "Members shows 'No inbox: this agent sees no chats' for an agent without inboxes".
- [ ] **Step 2: Fail** — `npx vitest run apps/web/src/admin apps/desktop/src/notifications.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Pass** — Step 2 + `npx vitest run apps/web/src/i18n` + web typecheck + lint.

---

### Task 8 (orchestrator): e2e, docs, verification, screen review, Dev Build

- [ ] **Step 1:** Add a second Playwright `webServer` (port 7498, `.e2e-data-multi`, `--max-inboxes 3 --fake-wa
  --mode dev`) and project `multi-inbox` running `e2e/multi-inbox.spec.ts`: admin adds "Catering" with Mei Ling,
  `POST /api/dev/fake-link`, fake inbound into both inboxes for the same customer, unified list shows two rows with
  chips, filter narrows, agent Daniel (inbox 1) sees one row and gets the not-found state on the inbox 2 URL, Mei
  Ling sees only Catering, remove Catering.
- [ ] **Step 2:** Docs: `AGENTS.md` architecture paragraph "Inboxes" + security invariant (scope, 404, rooms);
  `docs/editions-engineer-guide.md` "Limits" (`maxInboxes`); `CHANGELOG.md` `[Unreleased]`; `docs/LEARNINGS.md`;
  workbook stages; `design.md` status.
- [ ] **Step 3:** One consolidated verification: `npm run typecheck`, `npm test`, `npm run lint`, web build,
  `npm run test:coverage` + `npm run coverage:changed`, `npm run e2e`, `npm run e2e:electron-links`.
- [ ] **Step 4:** Screen review (1280 / 360, light and dark) against the mock; refresh `docs/screenshots/`.
- [ ] **Step 5:** Dev Build check (fake WhatsApp, temp data, two inboxes) logged in `docs/dev-build-checks.md`;
  real-WhatsApp linking of a second phone stays "untested against real WhatsApp" until the owner links one.
- [ ] **Step 6:** Push; report readiness. No merge without the owner's request. Enterprise follow-up after the next
  Lite release: pass `maxInboxes` in `ezychat-enterprise/apps/desktop/src/cli.ts` and bump the `@ezychat/*` pins.
