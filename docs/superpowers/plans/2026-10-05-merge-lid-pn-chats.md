# Merge LID / Phone-Number Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One inbox row per WhatsApp person. Existing phone-number (PN, `<digits>@s.whatsapp.net`) / WhatsApp ID (LID, `<digits>@lid`) duplicates are merged by a startup identity migration (after a pre-merge backup); afterwards the running server only routes, never merges. The UI shows the real phone number or "Phone number hidden", never LID digits; old links and notifications keep working.

**Architecture:** `chats.jid` stays the primary key. Migration 004 adds `jid_aliases` (PN → LID), `chats.phone` and `messages.wa_remote_jid`. `readStoredLidMappings` (`packages/wa`) reads the PN↔LID pairs Baileys already stored in `<data>/wa-auth/lid-mapping-*.json` without a socket. On every start, `initMessaging` creates the `AliasStore` and runs `runIdentityMigration` **before** the chat/message services (send-queue restore), the AI Sales Agent, HTTP/socket listen and `wa.connect()`: it persists the stored pairs and, only if some pair still has a PN chat row, writes one pre-merge backup and calls `mergeChat` (one SQLite transaction per pair, including `ai_chat_state`). At runtime `AliasStore.learn` only persists pairs and `AliasStore.route` sends each message to the existing chat of either JID (LID chat first); a pair that joins two chats at runtime waits for the next start. Replies (human and AI) go to the `wa_remote_jid` of the last inbound message.

**Tech Stack:** Node 22+, TypeScript strict ESM, better-sqlite3, Fastify, zod (`packages/shared`), Baileys 7.0.0-rc14 (`packages/wa/src/baileys/**` only), React 19 + TanStack Query + react-i18next (`apps/web`), Vitest.

**Spec:** docs/superpowers/specs/2026-10-05-merge-lid-pn-chats-design.md

## Global Constraints

- Node 22+, TypeScript strict, ESM (`.js` suffixes in relative imports).
- zod schema first: change `packages/shared` before server and web use a new field.
- Only `packages/wa/src/baileys/**` imports `baileys`; the server imports only from `@wa-team-inbox/wa`. `readStoredLidMappings` lives in `packages/wa/src/baileys/` but uses only `node:fs`.
- **Merging happens only in `runIdentityMigration` at startup.** Runtime code (ingest, contacts, aliases, routes, send queue, AI) never merges, deletes or re-keys a chat row. No `chat:merged` socket/bus event, no send-queue rekey, no AI timer moves.
- Startup order (`packages/server/src/wa-bridge/index.ts#initMessaging`, run by `main.ts#runInitializers` before `buildApp`/`app.listen`/`attachRealtime`/`ctx.wa.connect()`; `initAi` is registered after `initMessaging` in `services.ts`): `AliasStore` → `runIdentityMigration` → `createChatService` → `createMessageService` (restores pending jobs) → `attachWaBridge`.
- `VACUUM INTO` (backups) cannot run inside a SQLite transaction: the pre-merge backup runs synchronously before any merge transaction, never from inside `db.transaction`.
- Never use the real app data folder (`%APPDATA%\WA Team Inbox\data`, `C:\ProgramData\…`); tests use temp dirs (`makeTestApp`, `mkdtempSync`). Never send WhatsApp messages from a real linked number; the real-WhatsApp smoke (Task 9) is done by the owner on a test number.
- Run tests with `npx vitest run <paths>` (only the files you touched) plus `npm run typecheck -w @wa-team-inbox/<pkg>` for the package you touched. No e2e and no full suite inside a task; Task 9 is the single consolidated verification.
- Migration file is `004_jid_aliases.sql` (`002_user_locale.sql`, `003_ai_member.sql` exist); `PRAGMA user_version` becomes 4.
- AI Sales Agent (#18): `ai_chat_state(chat_jid PK REFERENCES chats(jid) ON DELETE CASCADE)`; AI replies go through `MessageService.sendText` and the send queue (`sendJob` calls `ai.canSend(job.chatJid, …)`); the AI member is a `users` row with `kind = 'ai'`. `mergeChat` moves `ai_chat_state` before deleting the PN row; `job.chatJid` stays the chat (queue key), `job.targetJid` is the WhatsApp address; `message:received` stays in `ingest`, keyed by the routed chat.
- Web UI: shadcn primitives and token classes only, every screen works at 360px, routes stay inside the existing `ErrorBoundary`.
- Every user-visible string goes through i18n with EN, MS and zh-CN in the same commit (`apps/web/src/i18n/locales/*/*.json`, `packages/server/src/i18n/messages.ts`); the catalog tests enforce parity.
- Changes under `packages/wa/src/baileys/**` are reported as "untested against real WhatsApp" until the owner's smoke test.
- Merges and aliases come only from explicit WhatsApp PN↔LID pairs, never from a name or number match.
- No feature flag. The pre-merge backup is the restore point and is kept 30 days.
- Conventional Commits; stage explicit paths only (never `git add -A`; leave plugin-injected `CLAUDE.md` changes out). CHANGELOG/LEARNINGS/AGENTS in Task 9.
- Out of scope: the owner-only-reply composer lock (separate follow-up feature).

## Review Focus

The failure modes most likely to hurt users, each with an owning test:

1. **`wa-auth` is missing or unreadable at startup.** The server must still start, merge nothing it cannot prove, and still merge pairs already saved in `jid_aliases`. Task 2 (`stored-lid-mappings.test.ts`: missing dir → `[]`, a file instead of a dir throws, corrupt/non-string/own-account files skipped) and Task 5 (`identity-startup.test.ts` "starts and merges nothing when wa-auth is missing", "an unreadable wa-auth still starts, and saved aliases still merge").
2. **The pre-merge backup fails.** No merge may run; both chats keep working (new messages route to the LID chat, the PN chat stays reachable); a later start merges. Task 5 (`identity-startup.test.ts` "leaves chats separate when the pre-merge backup fails…").
3. **A pair is learned at runtime while both chats exist.** Nothing merges; new PN messages land in the LID chat; `/api/chats/<pn>` still opens the PN chat; the next start merges. Task 6 (`bridge.test.ts` "a pair learned while both chats exist…", `chats.test.ts` "a phone-number chat that stays separate until the next start is still reachable…").
4. **A PN-only chat is re-keyed to the LID.** Old `/chats/<pn>` links and push URLs must open the LID chat, and the browser must follow. Task 5 (`identity-startup.test.ts` "re-keys a phone-number-only chat…"), Task 6 (`chats.test.ts` "old phone-number URLs … after the startup re-key"), Task 8 (`InboxPage.test.tsx` "follows an old phone-number link…").
5. **A send was still pending in the PN chat when the server stopped.** After the startup merge it must be restored into the LID chat and sent exactly once, to the PN the customer used. Task 7 (`identity-startup.test.ts` "a send pending in the phone-number chat before the update is sent once…").
6. **The AI Sales Agent had state or ownership on the PN chat.** `ai_chat_state` would cascade away with the PN row; a teammate must keep ownership over the AI. Task 4 (`merge.test.ts` AI state and owner tables), Task 5 (`identity-startup.test.ts` first test moves `ai_chat_state`), Task 7 (`ai.test.ts` AI reply goes to the customer's last address).
7. **A number is recycled to a different person.** It only re-points future routing; its old PN chat never merges into or receives the new person's messages, and replies never go to the moved number. Task 3 (`aliases.test.ts` rule 3 + "a re-pointed number never routes…"), Task 5 (`contact-names.test.ts` rewrite), Task 7 (`messages.test.ts` "never replies to a phone number that moved…").

---

## Task 1: Shared contract, migration 004, chat phone and `wa_remote_jid` columns

**Files:**
- Create: `packages/server/src/db/migrations/004_jid_aliases.sql`
- Modify: `packages/server/src/db/migrate.test.ts` (user_version 3 → 4, `jid_aliases` in `TABLES`, new upgrade test)
- Modify: `packages/shared/src/models.ts` (`ChatSchema.phone`)
- Modify: `packages/shared/src/api.ts` (`FakeIncomingBody.chatJidAlt`)
- Modify: `packages/shared/src/schemas.test.ts`
- Modify: `packages/server/src/chats/repo.ts` (`ChatRow.phone`, `rowToChat`, `ensure`, `phoneFor`, `list` search)
- Modify: `packages/server/src/messages/repo.ts` (`MessageRow.wa_remote_jid`, `insert`)
- Modify: `packages/server/src/messages/service.ts` (three `MessageRow` literals)
- Modify (fixtures): `packages/server/test/chats.test.ts`, `packages/server/test/contact-names.test.ts`, `packages/server/src/push/service.test.ts`, `apps/web/src/inbox/ChatList.test.tsx`, `apps/web/src/inbox/InboxPage.test.tsx` (no other `Chat`/`ChatRow` literals exist; `test/ai.test.ts` builds chats through `ingest`)

**Interfaces:**
- Produces: `ChatSchema` gains `phone: z.string().nullable()` → `Chat['phone']: string | null` (PN digits without `+`).
- Produces: `FakeIncomingBody` gains `chatJidAlt?: string`.
- Produces: `ChatRow.phone: string | null`; `ChatRepo.phoneFor(jid: string): string | null`; `MessageRow.wa_remote_jid: string | null`.
- Produces: table `jid_aliases(alias_jid PK, canonical_jid, source, learned_at, repointed_from)`, columns `chats.phone`, `messages.wa_remote_jid`.

- [ ] **Step 1: Write the failing migration test**

In `packages/server/src/db/migrate.test.ts` (already imports `migrationsDir` and `readFileSync` since #18):
- add `'jid_aliases',` after `'ai_chat_state',` in `TABLES`;
- change every `toBe(3)` on `user_version` to `toBe(4)` — 4 occurrences, lines 33, 51, 66 (the "upgrades a main-branch locale database…" test migrates to the latest version) and 86; leave its `db.pragma('user_version = 2')` setup line alone;

then append inside `describe('migrate', …)`:

```ts
  it('004 adds jid_aliases and backfills wa_remote_jid and chats.phone on an existing v3 database', () => {
    const db = new Database(':memory:');
    try {
      for (const f of ['001_init.sql', '002_user_locale.sql', '003_ai_member.sql']) {
        db.exec(readFileSync(join(migrationsDir(), f), 'utf8'));
      }
      db.pragma('user_version = 3');
      db.exec(`
        INSERT INTO chats (jid, type, name, updated_at) VALUES
          ('60111@s.whatsapp.net', 'dm', 'A', 1), ('999@lid', 'dm', '', 1),
          ('888@lid', 'dm', '', 1), ('1-2@g.us', 'group', 'G', 1);
        INSERT INTO contacts (jid, phone) VALUES ('999@lid', '60222'), ('888@lid', NULL);
        INSERT INTO messages (id, chat_jid, type, timestamp, created_at) VALUES
          ('m1', '60111@s.whatsapp.net', 'text', 1, 1), ('m2', '999@lid', 'text', 2, 2);
      `);
      migrate(db);
      expect(db.pragma('user_version', { simple: true })).toBe(4);
      expect(db.prepare('SELECT id, wa_remote_jid FROM messages ORDER BY id').all()).toEqual([
        { id: 'm1', wa_remote_jid: '60111@s.whatsapp.net' },
        { id: 'm2', wa_remote_jid: '999@lid' },
      ]);
      expect(db.prepare('SELECT jid, phone FROM chats ORDER BY jid').all()).toEqual([
        { jid: '1-2@g.us', phone: null },
        { jid: '60111@s.whatsapp.net', phone: '60111' },
        { jid: '888@lid', phone: null },
        { jid: '999@lid', phone: '60222' },
      ]);
      expect(
        (db.prepare('PRAGMA table_info(jid_aliases)').all() as Array<{ name: string }>).map(
          (c) => c.name,
        ),
      ).toEqual(['alias_jid', 'canonical_jid', 'source', 'learned_at', 'repointed_from']);
      expect(() => migrate(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/server/src/db/migrate.test.ts`
Expected: FAIL — `expected 3 to be 4` (no migration 004 yet).

- [ ] **Step 3: Create the migration**

`packages/server/src/db/migrations/004_jid_aliases.sql`:

```sql
-- One person, two WhatsApp addresses. A phone-number JID (PN) whose WhatsApp ID (LID) is known
-- routes to the LID chat (chats/aliases.ts). Existing duplicates are merged only by the startup
-- identity migration (chats/identity-migration.ts), never by this SQL.
CREATE TABLE jid_aliases (
  alias_jid      TEXT PRIMARY KEY,  -- the PN
  canonical_jid  TEXT NOT NULL,     -- the LID it belongs to
  source         TEXT NOT NULL,     -- 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore'
  learned_at     INTEGER NOT NULL,
  repointed_from TEXT               -- previous LID when the number moved to another person; its old
                                    -- PN chat is then never merged or routed to
);
CREATE INDEX idx_jid_aliases_canonical ON jid_aliases(canonical_jid);

ALTER TABLE chats ADD COLUMN phone TEXT;            -- PN digits for display/search; NULL when unknown
ALTER TABLE messages ADD COLUMN wa_remote_jid TEXT; -- JID WhatsApp used for this message (replies, read receipts)

UPDATE messages SET wa_remote_jid = chat_jid;
UPDATE chats SET phone = substr(jid, 1, instr(jid, '@') - 1) WHERE jid LIKE '%@s.whatsapp.net';
UPDATE chats
   SET phone = (SELECT ct.phone FROM contacts ct WHERE ct.jid = chats.jid)
 WHERE phone IS NULL
   AND jid LIKE '%@lid'
   AND (SELECT ct.phone FROM contacts ct WHERE ct.jid = chats.jid) <> ''
   AND (SELECT ct.phone FROM contacts ct WHERE ct.jid = chats.jid) NOT GLOB '*[^0-9]*';
```

- [ ] **Step 4: Run the migration test again**

Run: `npx vitest run packages/server/src/db/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing shared schema test**

In `packages/shared/src/schemas.test.ts` add `ChatSchema` and `FakeIncomingBody` to the `./index.js` import and append inside `describe('shared schemas', …)`:

```ts
  it('a chat carries its phone number, or null when WhatsApp hides it', () => {
    const chat = {
      jid: '1@lid',
      type: 'dm',
      name: '',
      avatarUrl: null,
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      status: 'open',
      assignedTo: null,
      updatedAt: 1,
    };
    expect(ChatSchema.safeParse(chat).success).toBe(false);
    expect(ChatSchema.parse({ ...chat, phone: null }).phone).toBeNull();
    expect(ChatSchema.parse({ ...chat, phone: '60111' }).phone).toBe('60111');
    expect(
      FakeIncomingBody.parse({ chatJid: '60111@s.whatsapp.net', text: 'hi', chatJidAlt: '1@lid' })
        .chatJidAlt,
    ).toBe('1@lid');
  });
```

Run: `npx vitest run packages/shared/src/schemas.test.ts`
Expected: FAIL — `expected true to be false` (phone not required yet).

- [ ] **Step 6: Change the shared contract**

`packages/shared/src/models.ts`, inside `ChatSchema` after `updatedAt: z.number(),`:

```ts
  /** Phone-number digits without `+`; null when WhatsApp has only revealed the WhatsApp ID (LID). */
  phone: z.string().nullable(),
```

`packages/shared/src/api.ts`, `FakeIncomingBody`, after `chatJid: z.string(),`:

```ts
  /** fake WA only: the other address of the same person (PN for a LID chat, or the reverse) */
  chatJidAlt: z.string().max(256).optional(),
```

Run: `npx vitest run packages/shared/src/schemas.test.ts` → PASS.

- [ ] **Step 7: Write the failing server tests for phone and LID names**

In `packages/server/test/chats.test.ts`: change the import from `../src/chats/repo.js` to `import { ChatRepo, rowToChat, type ChatRow } from '../src/chats/repo.js';`, add `phone: null,` to the `ChatRow` literal at line 194 (after `updated_at: Date.now(),`), and append inside `describe('chat profile images', …)`:

```ts
  it('rowToChat never shows WhatsApp ID digits as a name and exposes the phone number', () => {
    const base = {
      type: 'dm',
      avatar_path: null,
      unread_count: 0,
      last_message_at: null,
      last_message_preview: null,
      status: 'open',
      assigned_to: null,
      updated_at: 1,
    } as const;
    expect(rowToChat({ ...base, jid: '123456789@lid', name: '', phone: null })).toMatchObject({
      name: '',
      phone: null,
    });
    expect(
      rowToChat({ ...base, jid: '123456789@lid', name: '123456789', phone: '60111' }),
    ).toMatchObject({ name: '60111', phone: '60111' });
    expect(
      rowToChat({ ...base, jid: '60111@s.whatsapp.net', name: '', phone: '60111' }),
    ).toMatchObject({ name: '60111', phone: '60111' });
    expect(
      rowToChat({ ...base, type: 'group', jid: '1-2@g.us', name: 'Team', phone: null }),
    ).toMatchObject({ name: 'Team', phone: null });
  });

  it('search matches the chat phone number and new phone-number chats store it', () => {
    const repo = new ChatRepo(t.ctx.db);
    repo.ensure('555@lid', { name: 'Hidden Person' }, 1);
    repo.update('555@lid', { phone: '60199999999' });
    expect(repo.ensure('60188888888@s.whatsapp.net', {}, 1).phone).toBe('60188888888');
    const res = getChats(t.ctx).list({ assigned: 'any', limit: 10, q: '60199999999' }, 1);
    expect(res.chats.map((c) => c.jid)).toEqual(['555@lid']);
  });
```

In `packages/server/test/contact-names.test.ts` line 186 change `expect(chats.get(LID)?.name).toBe('123456789');` to `expect(chats.get(LID)?.name).toBe('');` (LID digits are no longer a display name).

Run: `npx vitest run packages/server/test/chats.test.ts`
Expected: FAIL — unknown `phone` property / `expected '123456789' to be '60111'`.

- [ ] **Step 8: Implement repo changes**

`packages/server/src/chats/repo.ts`:

In `ChatRow` after `updated_at: number;` add `phone: string | null;`.

Replace `rowToChat`:

```ts
export function rowToChat(r: ChatRow): Chat {
  // A LID is an opaque WhatsApp ID, never a phone number: do not show its digits as a name.
  const lidDigits = r.jid.endsWith('@lid') && r.name === jidUser(r.jid);
  const name =
    (r.name && !lidDigits ? r.name : null) ||
    r.phone ||
    (r.jid.endsWith('@lid') ? '' : jidUser(r.jid));
  return {
    jid: r.jid,
    type: r.type,
    name,
    avatarUrl: `/api/chats/${encodeURIComponent(r.jid)}/avatar`,
    unreadCount: r.unread_count,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    status: r.status,
    assignedTo: r.assigned_to,
    updatedAt: r.updated_at,
    phone: r.phone ?? null,
  };
}
```

In `ChatRepo`, add after `get()`:

```ts
  /** PN digits for a DM: from a PN JID itself, or from the newest phone number aliased to a LID. */
  phoneFor(jid: string): string | null {
    if (jid.endsWith('@s.whatsapp.net')) return jidUser(jid);
    if (!jid.endsWith('@lid')) return null;
    const row = this.db
      .prepare(
        'SELECT alias_jid FROM jid_aliases WHERE canonical_jid = ? ORDER BY learned_at DESC LIMIT 1',
      )
      .get(jid) as { alias_jid: string } | undefined;
    return row ? jidUser(row.alias_jid) : null;
  }
```

In `ensure`, replace the INSERT statement:

```ts
    this.db
      .prepare(
        `INSERT INTO chats (jid, type, name, unread_count, status, updated_at, phone)
         VALUES (?, ?, ?, 0, 'open', ?, ?) ON CONFLICT(jid) DO NOTHING`,
      )
      .run(jid, type, name, now, type === 'dm' ? this.phoneFor(jid) : null);
```

In `list`, change the search clause to:

```ts
      where.push(
        `(c.name LIKE @q ESCAPE '\\' OR c.jid LIKE @q ESCAPE '\\' OR c.phone LIKE @q ESCAPE '\\'
          OR ct.push_name LIKE @q ESCAPE '\\' OR ct.saved_name LIKE @q ESCAPE '\\' OR ct.phone LIKE @q ESCAPE '\\')`,
      );
```

`packages/server/src/messages/repo.ts`: in `MessageRow` after `client_id: string | null;` add:

```ts
  /** JID WhatsApp used for this message (PN or LID); replies and read receipts go back to it */
  wa_remote_jid: string | null;
```

and replace the `insert` SQL:

```ts
      .prepare(
        `INSERT OR IGNORE INTO messages (id, chat_jid, sender_jid, sender_name, from_me, sent_by_user_id, type, body,
           media_path, media_mime, media_name, media_status, quoted_id, status, error, timestamp, created_at, client_id,
           wa_remote_jid)
         VALUES (@id, @chat_jid, @sender_jid, @sender_name, @from_me, @sent_by_user_id, @type, @body,
           @media_path, @media_mime, @media_name, @media_status, @quoted_id, @status, @error, @timestamp, @created_at, @client_id,
           @wa_remote_jid)`,
      )
```

`packages/server/src/messages/service.ts`: add `wa_remote_jid` after `client_id` in the three row literals — `ingest` (`client_id: null,`): `wa_remote_jid: m.chatJid,`; `sendText` (`client_id: body.clientId,`) and `sendMedia` (`client_id: clientId,`): `wa_remote_jid: jid,` (Tasks 6 and 7 refine these). The AI Sales Agent sends through `sendText`, so it gets the same column.

Fixtures: add `phone: null,` after `updatedAt: 0,` in `apps/web/src/inbox/ChatList.test.tsx` `chat()`; add `phone: '60123456789',` after `updatedAt: now,` in `apps/web/src/inbox/InboxPage.test.tsx` `chat`; add `phone: '60123',` after `updatedAt: 1,` in `packages/server/src/push/service.test.ts` `chat()`.

- [ ] **Step 9: Run the touched tests**

Run: `npx vitest run packages/server/src/db/migrate.test.ts packages/shared/src/schemas.test.ts packages/server/test/chats.test.ts packages/server/test/contact-names.test.ts packages/server/test/messages.test.ts packages/server/src/push/service.test.ts apps/web/src/inbox/ChatList.test.tsx apps/web/src/inbox/InboxPage.test.tsx`
Expected: PASS.

- [ ] **Step 10: Typecheck touched workspaces**

Run: `npm run typecheck -w @wa-team-inbox/shared && npm run typecheck -w @wa-team-inbox/server && npm run typecheck -w @wa-team-inbox/web`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/db/migrations/004_jid_aliases.sql packages/server/src/db/migrate.test.ts packages/shared/src/models.ts packages/shared/src/api.ts packages/shared/src/schemas.test.ts packages/server/src/chats/repo.ts packages/server/src/messages/repo.ts packages/server/src/messages/service.ts packages/server/test/chats.test.ts packages/server/test/contact-names.test.ts packages/server/src/push/service.test.ts apps/web/src/inbox/ChatList.test.tsx apps/web/src/inbox/InboxPage.test.tsx
git commit -m "feat(shared,server): jid_aliases table, chat phone and message wa_remote_jid"
```

---

## Task 2: WhatsApp package — stored LID mappings reader, `chatJidAlt`, alias sources, fake helper

**Files:**
- Create: `packages/wa/src/baileys/stored-lid-mappings.ts`
- Test: `packages/wa/src/baileys/stored-lid-mappings.test.ts`
- Modify: `packages/wa/src/index.ts` (export the reader)
- Modify: `packages/wa/src/types.ts` (`WaIncomingMessage.chatJidAlt`, `WaAliasSource`, `WaContactAlias.source`)
- Modify: `packages/wa/src/baileys/mapping.ts` (fill `chatJidAlt`)
- Modify: `packages/wa/src/baileys/adapter.ts` (alias sources)
- Modify: `packages/wa/src/fake/fake-adapter.ts` (`chatJidAlt`, `simulateContactAliases`)
- Test: `packages/wa/src/baileys/mapping.test.ts`, `packages/wa/src/baileys/adapter.test.ts`, `packages/wa/src/fake/fake-adapter.test.ts`

**Interfaces:**
- Produces: `export function readStoredLidMappings(authDir: string): WaContactAlias[]` (from `@wa-team-inbox/wa`). Reads Baileys `useMultiFileAuthState` files written by `node_modules/baileys/lib/Signal/lid-mapping.js` → `keys.set({'lid-mapping': {[pnUser]: lidUser, [`${lidUser}_reverse`]: pnUser}})`, i.e. `<authDir>/lid-mapping-<pnUser>.json` = `"<lidUser>"` and `<authDir>/lid-mapping-<lidUser>_reverse.json` = `"<pnUser>"` (JSON strings; users have no device suffix and contain no `/` or `:`, so `fixFileName` leaves them unchanged). Returns `{ jid: <pn>@s.whatsapp.net, alias: <lid>@lid, source: 'keystore' }` sorted by phone number; missing dir → `[]`; other directory errors throw; bad files skipped; the linked account (`creds.json` `me.id`/`me.lid`) excluded.
- Produces: `WaIncomingMessage.chatJidAlt?: string | null` (DM only; the other address of the same person, device suffix stripped; null/absent for groups).
- Produces: `export type WaAliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore';` and `WaContactAlias.source?: WaAliasSource`.
- Produces: `FakeWaAdapter.simulateContactAliases(pairs: WaContactAlias[]): void`; `simulateIncoming` accepts `chatJidAlt`.

- [ ] **Step 1: Write the failing reader tests**

`packages/wa/src/baileys/stored-lid-mappings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStoredLidMappings } from './stored-lid-mappings.js';

let dir: string;
const put = (name: string, content: string) => writeFileSync(join(dir, name), content);
const json = (v: unknown) => JSON.stringify(v);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-wa-auth-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readStoredLidMappings', () => {
  it('reads the forward and reverse lid-mapping files Baileys writes into wa-auth', () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net' } }));
    put('pre-key-1.json', json({ public: 'x' }));
    put('session-123456789.0.json', json({}));
    put('lid-mapping-60111111111.json', json('123456789'));
    put('lid-mapping-123456789_reverse.json', json('60111111111'));
    put('lid-mapping-222_reverse.json', json('60222222222')); // only the reverse file survived
    expect(readStoredLidMappings(dir)).toEqual([
      { jid: '60111111111@s.whatsapp.net', alias: '123456789@lid', source: 'keystore' },
      { jid: '60222222222@s.whatsapp.net', alias: '222@lid', source: 'keystore' },
    ]);
  });

  it("trusts a number's forward file over a stale reverse file and ignores ambiguous reverse files", () => {
    put('lid-mapping-60111111111.json', json('999'));
    put('lid-mapping-123456789_reverse.json', json('60111111111')); // the number moved to 999
    put('lid-mapping-301_reverse.json', json('60333333333'));
    put('lid-mapping-302_reverse.json', json('60333333333'));
    expect(readStoredLidMappings(dir)).toEqual([
      { jid: '60111111111@s.whatsapp.net', alias: '999@lid', source: 'keystore' },
    ]);
  });

  it('skips the linked account and unreadable, non-string or non-numeric files', () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net', lid: '500:12@lid' } }));
    put('lid-mapping-60000000000.json', json('500'));
    put('lid-mapping-60444444444.json', 'not json');
    put('lid-mapping-60555555555.json', json(555));
    put('lid-mapping-60666666666.json', json('abc'));
    expect(readStoredLidMappings(dir)).toEqual([]);
  });

  it('returns nothing for a missing directory and throws when wa-auth is not a directory', () => {
    expect(readStoredLidMappings(join(dir, 'missing'))).toEqual([]);
    put('wa-auth', 'not a directory');
    expect(() => readStoredLidMappings(join(dir, 'wa-auth'))).toThrow();
  });
});
```

Run: `npx vitest run packages/wa/src/baileys/stored-lid-mappings.test.ts`
Expected: FAIL — `Failed to load url ./stored-lid-mappings.js`.

- [ ] **Step 2: Implement the reader**

`packages/wa/src/baileys/stored-lid-mappings.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WaContactAlias } from '../types.js';
import { contactAliasPair, normalizeContactJid } from './contact-aliases.js';

// Baileys' useMultiFileAuthState stores key `<id>` of type `lid-mapping` as `lid-mapping-<id>.json`.
// LIDMappingStore writes `<pnUser>` -> "<lidUser>" and `<lidUser>_reverse` -> "<pnUser>".
const FORWARD = /^lid-mapping-(\d+)\.json$/;
const REVERSE = /^lid-mapping-(\d+)_reverse\.json$/;

function readUser(file: string): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** The linked account's own PN and LID (never aliased). */
function ownJids(authDir: string): Set<string> {
  try {
    const creds = JSON.parse(readFileSync(join(authDir, 'creds.json'), 'utf8')) as {
      me?: { id?: unknown; lid?: unknown };
    };
    return new Set(
      [normalizeContactJid(creds.me?.id), normalizeContactJid(creds.me?.lid)].filter(
        (j): j is string => !!j,
      ),
    );
  } catch {
    return new Set();
  }
}

/**
 * PN↔LID pairs WhatsApp already gave this account, read offline from the multi-file auth store
 * (no socket, no `baileys` import) so the server can merge chats at startup. A number's forward file
 * is its current WhatsApp ID; a reverse file only fills numbers without one (an old ID's reverse file
 * can outlive a number that moved). Missing dir → []; any other directory error throws.
 */
export function readStoredLidMappings(authDir: string): WaContactAlias[] {
  let names: string[];
  try {
    names = readdirSync(authDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lidOf = new Map<string, string>();
  const reverse = new Map<string, Set<string>>();
  for (const name of names) {
    const forward = FORWARD.exec(name);
    if (forward) {
      const lid = readUser(join(authDir, name));
      if (lid) lidOf.set(forward[1]!, lid);
      continue;
    }
    const back = REVERSE.exec(name);
    if (back) {
      const pn = readUser(join(authDir, name));
      if (pn) reverse.set(pn, (reverse.get(pn) ?? new Set()).add(back[1]!));
    }
  }
  for (const [pn, lids] of reverse) {
    if (!lidOf.has(pn) && lids.size === 1) lidOf.set(pn, [...lids][0]!);
  }
  const own = ownJids(authDir);
  const out: WaContactAlias[] = [];
  for (const [pn, lid] of [...lidOf].sort(([a], [b]) => a.localeCompare(b))) {
    const pair = contactAliasPair(`${pn}@s.whatsapp.net`, `${lid}@lid`);
    if (pair && !own.has(pair.jid) && !own.has(pair.alias)) out.push({ ...pair, source: 'keystore' });
  }
  return out;
}
```

`packages/wa/src/index.ts`, add after the `createBaileysAdapter` export:

```ts
export { readStoredLidMappings } from './baileys/stored-lid-mappings.js';
```

(`source: 'keystore'` type-checks after Step 4 adds `WaContactAlias.source`; run the reader test after Step 4.)

- [ ] **Step 3: Write the failing mapping and fake adapter tests**

Append inside `describe('mapWAMessage', …)` in `packages/wa/src/baileys/mapping.test.ts`:

```ts
  it('carries the alternate address of a direct chat without its device suffix', () => {
    const m = mapWAMessage(
      base({
        key: {
          remoteJid: '123456789@lid',
          remoteJidAlt: '60123456789:12@s.whatsapp.net',
          fromMe: false,
          id: 'ALT',
        },
        message: { conversation: 'hi' },
      }),
    );
    expect(m?.chatJid).toBe('123456789@lid');
    expect(m?.chatJidAlt).toBe('60123456789@s.whatsapp.net');
  });

  it('has no alternate address for groups or when WhatsApp sends none', () => {
    expect(mapWAMessage(base({ message: { conversation: 'x' } }))?.chatJidAlt).toBeNull();
    const g = mapWAMessage(
      base({
        key: {
          remoteJid: '1203@g.us',
          remoteJidAlt: '60123456789@s.whatsapp.net',
          participant: '60123456789@s.whatsapp.net',
          fromMe: false,
          id: 'G',
        },
        message: { conversation: 'x' },
      }),
    );
    expect(g?.chatJidAlt).toBeNull();
  });
```

In `packages/wa/src/fake/fake-adapter.test.ts` change line 4 to `import type { WaContactAlias, WaIncomingMessage, WaMessageStatusUpdate } from '../index.js';` and append inside `describe('FakeWaAdapter', …)`:

```ts
  it('simulateIncoming carries chatJidAlt; simulateContactAliases emits explicit pairs', () => {
    const wa = new FakeWaAdapter();
    const seen: WaIncomingMessage[] = [];
    wa.on('message', (m) => seen.push(m));
    wa.simulateIncoming({ chatJid: '1@lid', chatJidAlt: '601@s.whatsapp.net', body: 'x' });
    wa.simulateIncoming({ chatJid: '602@s.whatsapp.net', body: 'y' });
    expect(seen.map((m) => m.chatJidAlt)).toEqual(['601@s.whatsapp.net', null]);

    const batches: WaContactAlias[][] = [];
    wa.on('contactAliases', (b) => batches.push(b));
    wa.simulateContactAliases([{ jid: '601@s.whatsapp.net', alias: '1@lid' }]);
    expect(batches).toEqual([[{ jid: '601@s.whatsapp.net', alias: '1@lid' }]]);
  });
```

Run: `npx vitest run packages/wa/src/baileys/mapping.test.ts packages/wa/src/fake/fake-adapter.test.ts`
Expected: FAIL — `expected undefined to be '60123456789@s.whatsapp.net'` and `wa.simulateContactAliases is not a function`.

- [ ] **Step 4: Implement types, mapping and fake adapter**

`packages/wa/src/types.ts`: in `WaIncomingMessage` after `chatJid: string;`:

```ts
  /**
   * DM only: the same person's other address as WhatsApp delivered it (`key.remoteJidAlt`), PN for a
   * LID chat or the reverse, device suffix stripped. Null/absent for groups or when not provided.
   */
  chatJidAlt?: string | null;
```

Replace `WaContactAlias`:

```ts
/** Where an explicit PN/LID association was learned (stored in jid_aliases.source). */
export type WaAliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore';

export interface WaContactAlias {
  jid: string;
  alias: string;
  source?: WaAliasSource;
}
```

`packages/wa/src/baileys/mapping.ts`: add `import { normalizeContactJid } from './contact-aliases.js';` and before `return {` at the end of `mapWAMessage`:

```ts
  // The same person's other address (PN for a LID chat or the reverse); only for direct chats.
  // remoteJidAlt is on Baileys' WAMessageKey, not on proto.IMessageKey.
  const alt = isGroup ? null : normalizeContactJid((key as WAMessage['key']).remoteJidAlt);
  const chatJidAlt = alt && alt.endsWith('@lid') !== chatJid.endsWith('@lid') ? alt : null;
```

and add `chatJidAlt,` after `chatJid,` in the returned object.

`packages/wa/src/fake/fake-adapter.ts`:
- in `simulateIncoming`'s `msg` literal after `chatJid: p.chatJid,` add `chatJidAlt: p.chatJidAlt ?? null,`
- add after `setMedia`:

```ts
  /** Emit explicit PN/LID pairs as the adapter does when WhatsApp reveals them. */
  simulateContactAliases(pairs: WaContactAlias[]): void {
    this.emitTyped('contactAliases', pairs.map((p) => ({ ...p })));
  }
```

Run: `npx vitest run packages/wa/src/baileys/mapping.test.ts packages/wa/src/fake/fake-adapter.test.ts packages/wa/src/baileys/stored-lid-mappings.test.ts` → PASS.

- [ ] **Step 5: Tag alias sources in the Baileys adapter (failing test first)**

In `packages/wa/src/baileys/adapter.test.ts` update the alias payload assertions:
- line 234: `expect(aliases[0]).toEqual({ ...ALIAS, source: 'history' });`
- line 239: `await expect(a.getContactAliases([PN, LID])).resolves.toEqual([{ ...ALIAS, source: 'keystore' }]);`
- line 255: `expect(aliases).toEqual([{ ...ALIAS, source: 'contacts' }]);`
- line 284: `expect(aliases).toEqual([{ ...ALIAS, source: 'message' }, { jid: '60111111111@s.whatsapp.net', alias: '999@lid', source: 'message' }]);`
- line 299: `await expect(a.getContactAliases([jid])).resolves.toEqual([{ ...ALIAS, source: 'keystore' }]);`
- line 367: `expect(aliases).toEqual([{ ...ALIAS, source: 'lid-mapping' }]);`
- lines 207-208 (`contactAliasPair(...)`) stay unchanged: the pure helper returns no `source`.

Run: `npx vitest run packages/wa/src/baileys/adapter.test.ts`
Expected: FAIL — payloads lack `source`.

- [ ] **Step 6: Implement sources in `adapter.ts`**

Add `type WaAliasSource` to the `../types.js` import. Then:
- `lid-mapping.update` handler: `if (alive()) this.emitAliasPairs([[lid, pn]], 'lid-mapping');`
- `ingest`: second argument `source === 'history' ? 'history' : 'message'` on the `emitAliasPairs([...])` call.
- `onHistory`: `this.emitAliasPairs((h.lidPnMappings ?? []).map(({ lid, pn }) => [lid, pn]), 'history');`
- `emitContacts`: pass `'contacts'` as the second argument of `this.emitAliasPairs(cs.flatMap(…))`.
- Replace `emitAliasPairs`:

```ts
  /** Cache and emit only explicit PN/LID associations; reject contradictory associations. */
  private emitAliasPairs(pairs: Array<[unknown, unknown]>, source: WaAliasSource): void {
    const out: WaContactAlias[] = [];
    for (const [first, second] of pairs) {
      const pair = contactAliasPair(first, second);
      if (pair && this.rememberAlias(pair)) out.push({ ...pair, source });
    }
    if (out.length) {
      this.logger.debug({ mappingCount: out.length, source }, 'contact aliases received');
      this.emitTyped('contactAliases', out);
    }
  }
```

- In `getContactAliases`, change the final loop body to `if (pair) out.set(pair.jid, { ...pair, source: 'keystore' });`.

- [ ] **Step 7: Run the wa tests and typecheck**

Run: `npx vitest run packages/wa/src/baileys/stored-lid-mappings.test.ts packages/wa/src/baileys/mapping.test.ts packages/wa/src/baileys/adapter.test.ts packages/wa/src/fake/fake-adapter.test.ts` → PASS.
Run: `npm run typecheck -w @wa-team-inbox/wa && npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 8: Commit** (note in the PR: Baileys changes are untested against real WhatsApp until Task 9)

```bash
git add packages/wa/src/baileys/stored-lid-mappings.ts packages/wa/src/baileys/stored-lid-mappings.test.ts packages/wa/src/index.ts packages/wa/src/types.ts packages/wa/src/baileys/mapping.ts packages/wa/src/baileys/mapping.test.ts packages/wa/src/baileys/adapter.ts packages/wa/src/baileys/adapter.test.ts packages/wa/src/fake/fake-adapter.ts packages/wa/src/fake/fake-adapter.test.ts
git commit -m "feat(wa): read stored LID mappings offline; expose chatJidAlt and alias sources"
```

---

## Task 3: `AliasStore` — persisted PN → LID routing (never merging)

**Files:**
- Create: `packages/server/src/chats/aliases.ts`
- Test: `packages/server/src/chats/aliases.test.ts`

**Interfaces:**
- Consumes: `WaContactAlias` (Task 2), table `jid_aliases` and column `chats.phone` (Task 1).
- Produces:
  - `export type AliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore';` (equal to `WaAliasSource`)
  - `export type LearnOutcome = { kind: 'ignored' } | { kind: 'unchanged'; pn: string; lid: string } | { kind: 'added'; pn: string; lid: string } | { kind: 'repointed'; pn: string; lid: string; previous: string };`
  - `export function normalizePn(jid: string | null | undefined): string | null`, `normalizeLid(...)`, `orientPair(p: { jid: string; alias: string }): { pn: string; lid: string } | null`
  - `export interface AliasStoreOptions { ownJid(): string | null; now(): number; log: Pick<Logger, 'warn' | 'info'> }`
  - `export class AliasStore { constructor(db: DB, opts: AliasStoreOptions); reload(): void; resolve(jid: string): string; route(jid: string): string; aliasesOf(lid: string): string[]; group(jid: string): string[]; learn(pair: { jid: string; alias: string }, source: AliasSource): LearnOutcome; pendingMerges(): Array<{ from: string; to: string }> }`
  - `export function createAliasStore(ctx: AppContext): AliasStore`; `export function getAliases(ctx: AppContext): AliasStore`; `Services.aliases?: AliasStore` (module augmentation).

- [ ] **Step 1: Write the failing tests**

`packages/server/src/chats/aliases.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Logger } from 'pino';
import { migrate } from '../db/migrate.js';
import { AliasStore, normalizeLid, normalizePn, orientPair } from './aliases.js';

const PN = '60111111111@s.whatsapp.net';
const PN2 = '60222222222@s.whatsapp.net';
const LID = '123456789@lid';
const OTHER_LID = '987654321@lid';
const ME = '60000000000@s.whatsapp.net';

let db: Database.Database;
let clock: number;
let warn: ReturnType<typeof vi.fn>;
const store = () =>
  new AliasStore(db, {
    ownJid: () => ME,
    now: () => clock,
    log: { warn, info: vi.fn() } as unknown as Pick<Logger, 'warn' | 'info'>,
  });
const chat = (jid: string, phone: string | null = null) =>
  db
    .prepare("INSERT INTO chats (jid, type, name, updated_at, phone) VALUES (?, 'dm', '', 1, ?)")
    .run(jid, phone);
const phoneOf = (jid: string) =>
  (db.prepare('SELECT phone FROM chats WHERE jid = ?').get(jid) as { phone: string | null }).phone;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  clock = 1000;
  warn = vi.fn();
});

describe('orientPair / normalize', () => {
  it('orients explicit pairs as {pn, lid} in either order and strips device suffixes', () => {
    expect(orientPair({ jid: PN, alias: LID })).toEqual({ pn: PN, lid: LID });
    expect(
      orientPair({ jid: '123456789:4@lid', alias: '60111111111:2@s.whatsapp.net' }),
    ).toEqual({ pn: PN, lid: LID });
    expect(normalizePn('60111111111@c.us')).toBe(PN);
    expect(normalizeLid('123456789:9@lid')).toBe(LID);
  });

  it('rejects groups, broadcasts, two PNs, two LIDs and malformed ids', () => {
    const bad: Array<[string, string]> = [
      [PN, '1203@g.us'],
      [PN, 'status@broadcast'],
      [PN, PN2],
      [LID, OTHER_LID],
      [PN, 'letters@lid'],
    ];
    for (const [jid, alias] of bad) expect(orientPair({ jid, alias })).toBeNull();
  });
});

describe('AliasStore', () => {
  it('resolves unknown JIDs to themselves and a learned PN (with or without device) to its LID', () => {
    const s = store();
    expect(s.resolve(PN)).toBe(PN);
    expect(s.learn({ jid: LID, alias: PN }, 'message')).toEqual({ kind: 'added', pn: PN, lid: LID });
    expect(s.resolve(PN)).toBe(LID);
    expect(s.resolve('60111111111:3@s.whatsapp.net')).toBe(LID);
    expect(s.resolve(LID)).toBe(LID);
    expect(s.resolve('1203@g.us')).toBe('1203@g.us');
    expect(s.group(PN)).toEqual([LID, PN]);
  });

  it('rule 1: stores a new pair with its source and sets the phone on the LID chat', () => {
    chat(LID);
    store().learn({ jid: PN, alias: LID }, 'lid-mapping');
    expect(db.prepare('SELECT * FROM jid_aliases').all()).toEqual([
      { alias_jid: PN, canonical_jid: LID, source: 'lid-mapping', learned_at: 1000, repointed_from: null },
    ]);
    expect(phoneOf(LID)).toBe('60111111111');
  });

  it('rule 2: a known pair is a no-op', () => {
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    clock = 2000;
    expect(s.learn({ jid: PN, alias: LID }, 'message')).toEqual({ kind: 'unchanged', pn: PN, lid: LID });
    expect(db.prepare('SELECT source, learned_at FROM jid_aliases').get()).toEqual({
      source: 'contacts',
      learned_at: 1000,
    });
  });

  it('rule 3: a recycled number re-points future routing only, clears the old phone and warns', () => {
    chat(LID);
    chat(OTHER_LID);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    expect(s.learn({ jid: PN, alias: OTHER_LID }, 'message')).toEqual({
      kind: 'repointed',
      pn: PN,
      lid: OTHER_LID,
      previous: LID,
    });
    expect(s.resolve(PN)).toBe(OTHER_LID);
    expect(phoneOf(LID)).toBeNull();
    expect(phoneOf(OTHER_LID)).toBe('60111111111');
    expect(s.aliasesOf(LID)).toEqual([]);
    expect(s.aliasesOf(OTHER_LID)).toEqual([PN]);
    expect(db.prepare('SELECT repointed_from FROM jid_aliases WHERE alias_jid = ?').get(PN)).toEqual({
      repointed_from: LID,
    });
    expect(warn).toHaveBeenCalledWith(
      { pn: PN, from: LID, to: OTHER_LID, source: 'message' },
      'phone number moved to a different WhatsApp ID',
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toEqual({ n: 2 });
  });

  it('rule 4 and own number: never stores LID↔LID, groups, or the linked number', () => {
    const s = store();
    expect(s.learn({ jid: LID, alias: OTHER_LID }, 'contacts')).toEqual({ kind: 'ignored' });
    expect(s.learn({ jid: '1203@g.us', alias: LID }, 'contacts')).toEqual({ kind: 'ignored' });
    expect(s.learn({ jid: ME, alias: LID }, 'contacts')).toEqual({ kind: 'ignored' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });

  it('keeps every old number of one person pointing at the same LID', () => {
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    s.learn({ jid: PN2, alias: LID }, 'contacts');
    expect(s.aliasesOf(LID)).toEqual([PN, PN2]);
    expect(s.group(LID)).toEqual([LID, PN, PN2]);
  });

  it('route: the LID chat first, else an existing phone-number chat of the person, else the LID; never writes chats', () => {
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    expect(s.route(PN)).toBe(LID); // no chat yet: new chats are LID-keyed
    expect(s.route(LID)).toBe(LID);
    chat(PN);
    expect(s.route(LID)).toBe(PN); // only the PN chat exists: the LID joins it until the next start
    expect(s.route(PN)).toBe(PN);
    chat(LID);
    expect(s.route(PN)).toBe(LID); // both exist (pair learned at runtime): the LID chat wins
    expect(s.route('60999999999@s.whatsapp.net')).toBe('60999999999@s.whatsapp.net');
    expect(s.route('555@lid')).toBe('555@lid');
    expect(s.route('1203@g.us')).toBe('1203@g.us');
    expect(s.route('customer@s.whatsapp.net')).toBe('customer@s.whatsapp.net');
    expect(db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toEqual({ n: 2 });
  });

  it("a re-pointed number never routes the new person into, or merges, the old phone-number chat", () => {
    chat(PN);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    s.learn({ jid: PN, alias: OTHER_LID }, 'message');
    expect(s.route(PN)).toBe(OTHER_LID);
    expect(s.route(OTHER_LID)).toBe(OTHER_LID);
    expect(s.pendingMerges()).toEqual([]);
    expect(store().route(OTHER_LID)).toBe(OTHER_LID); // survives a reload
  });

  it('reloads the routing table from the database', () => {
    store().learn({ jid: PN, alias: LID }, 'keystore');
    expect(store().resolve(PN)).toBe(LID);
    expect(store().aliasesOf(LID)).toEqual([PN]);
  });

  it('lists aliases that still have their own chat row as pending merges', () => {
    chat(PN);
    chat(LID);
    const s = store();
    s.learn({ jid: PN, alias: LID }, 'contacts');
    expect(s.pendingMerges()).toEqual([{ from: PN, to: LID }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/server/src/chats/aliases.test.ts`
Expected: FAIL — `Failed to load url ./aliases.js`.

- [ ] **Step 3: Implement `aliases.ts`**

```ts
import type { Logger } from 'pino';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';

declare module '../context.js' {
  interface Services {
    /** persisted PN → LID routing (chats/aliases.ts) */
    aliases?: AliasStore;
  }
}

export type AliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore';

export type LearnOutcome =
  | { kind: 'ignored' }
  | { kind: 'unchanged'; pn: string; lid: string }
  | { kind: 'added'; pn: string; lid: string }
  | { kind: 'repointed'; pn: string; lid: string; previous: string };

const PN_RE = /^(\d+)(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/;
const LID_RE = /^(\d+)(?::\d+)?@lid$/;

/** `60123:4@s.whatsapp.net` / `60123@c.us` → `60123@s.whatsapp.net`; anything else → null. */
export function normalizePn(jid: string | null | undefined): string | null {
  const m = jid ? PN_RE.exec(jid) : null;
  return m ? `${m[1]}@s.whatsapp.net` : null;
}

/** `123:9@lid` → `123@lid`; anything else → null. */
export function normalizeLid(jid: string | null | undefined): string | null {
  const m = jid ? LID_RE.exec(jid) : null;
  return m ? `${m[1]}@lid` : null;
}

/** An explicit WhatsApp pair as {pn, lid}; null unless one side is a PN and the other a LID. */
export function orientPair(p: { jid: string; alias: string }): { pn: string; lid: string } | null {
  const pn = normalizePn(p.jid) ?? normalizePn(p.alias);
  const lid = normalizeLid(p.jid) ?? normalizeLid(p.alias);
  return pn && lid ? { pn, lid } : null;
}

const digits = (pn: string) => pn.slice(0, pn.indexOf('@'));

export interface AliasStoreOptions {
  /** the linked number; never aliased */
  ownJid(): string | null;
  now(): number;
  log: Pick<Logger, 'warn' | 'info'>;
}

/**
 * Persisted PN → LID routing (`jid_aliases`) with an in-memory cache. The LID is canonical once
 * known. Learning and routing never create, merge or delete chats: existing duplicates are merged
 * only by the startup identity migration (identity-migration.ts).
 */
export class AliasStore {
  /** PN → LID */
  private readonly canonical = new Map<string, string>();
  /** LID → its PNs */
  private readonly byLid = new Map<string, Set<string>>();
  /** PNs that moved to another person (rule 3): their old chat is never merged or routed to */
  private readonly repointed = new Set<string>();

  constructor(
    private readonly db: DB,
    private readonly opts: AliasStoreOptions,
  ) {
    this.reload();
  }

  reload(): void {
    this.canonical.clear();
    this.byLid.clear();
    this.repointed.clear();
    const rows = this.db
      .prepare('SELECT alias_jid, canonical_jid, repointed_from FROM jid_aliases')
      .all() as Array<{ alias_jid: string; canonical_jid: string; repointed_from: string | null }>;
    for (const r of rows) this.remember(r.alias_jid, r.canonical_jid, r.repointed_from !== null);
  }

  private remember(pn: string, lid: string, repointed: boolean): void {
    const old = this.canonical.get(pn);
    if (old) this.byLid.get(old)?.delete(pn);
    this.canonical.set(pn, lid);
    const set = this.byLid.get(lid) ?? new Set<string>();
    set.add(pn);
    this.byLid.set(lid, set);
    if (repointed) this.repointed.add(pn);
    else this.repointed.delete(pn);
  }

  private hasChat(jid: string): boolean {
    return this.db.prepare('SELECT 1 FROM chats WHERE jid = ?').get(jid) !== undefined;
  }

  /** Canonical identity: the LID for a PN whose LID is known, else `jid` unchanged. */
  resolve(jid: string): string {
    const pn = normalizePn(jid);
    return (pn && this.canonical.get(pn)) || jid;
  }

  /**
   * The chat a DM JID belongs to now: the LID chat when it exists, else an existing (not re-pointed)
   * phone-number chat of the same person — re-keyed to the LID by the next startup — else the LID
   * for a known PN (new chats are LID-keyed), else `jid`. Never creates or merges anything.
   */
  route(jid: string): string {
    const pn = normalizePn(jid);
    const lid = pn ? this.canonical.get(pn) : normalizeLid(jid);
    if (!lid) return jid;
    if (this.hasChat(lid)) return lid;
    const pnChat = this.aliasesOf(lid).find((a) => !this.repointed.has(a) && this.hasChat(a));
    return pnChat ?? (pn ? lid : jid);
  }

  /** Every PN that currently routes to `lid`, sorted. */
  aliasesOf(lid: string): string[] {
    return [...(this.byLid.get(lid) ?? [])].sort();
  }

  /** `[canonical, ...its PNs]`: every JID of the person, for name sync. */
  group(jid: string): string[] {
    const canonical = this.resolve(jid);
    return [canonical, ...this.aliasesOf(canonical)];
  }

  learn(pair: { jid: string; alias: string }, source: AliasSource): LearnOutcome {
    const p = orientPair(pair);
    if (!p) return { kind: 'ignored' };
    const own = normalizePn(this.opts.ownJid());
    if (own && p.pn === own) return { kind: 'ignored' };
    const previous = this.canonical.get(p.pn);
    if (previous === p.lid) return { kind: 'unchanged', ...p };
    const phone = digits(p.pn);
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at, repointed_from)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(alias_jid) DO UPDATE SET canonical_jid = excluded.canonical_jid,
             source = excluded.source, learned_at = excluded.learned_at,
             repointed_from = excluded.repointed_from`,
        )
        .run(p.pn, p.lid, source, this.opts.now(), previous ?? null);
      if (previous) {
        this.db.prepare('UPDATE chats SET phone = NULL WHERE jid = ? AND phone = ?').run(previous, phone);
      }
      this.db.prepare('UPDATE chats SET phone = ? WHERE jid = ?').run(phone, p.lid);
    })();
    this.remember(p.pn, p.lid, previous !== undefined);
    if (previous) {
      // Number recycled / re-registered: future routing only. Never join `previous` and `lid`.
      this.opts.log.warn(
        { pn: p.pn, from: previous, to: p.lid, source },
        'phone number moved to a different WhatsApp ID',
      );
      return { kind: 'repointed', ...p, previous };
    }
    if (this.hasChat(p.pn) && this.hasChat(p.lid)) {
      this.opts.log.info(
        { pn: p.pn, lid: p.lid, source },
        'phone-number chat stays separate until the next start merges it',
      );
    }
    return { kind: 'added', ...p };
  }

  /** Aliases whose PN still has its own chat row (and was not re-pointed): merged at startup. */
  pendingMerges(): Array<{ from: string; to: string }> {
    return this.db
      .prepare(
        `SELECT a.alias_jid AS "from", a.canonical_jid AS "to" FROM jid_aliases a
         JOIN chats c ON c.jid = a.alias_jid
         WHERE a.repointed_from IS NULL ORDER BY a.learned_at, a.alias_jid`,
      )
      .all() as Array<{ from: string; to: string }>;
  }
}

export function createAliasStore(ctx: AppContext): AliasStore {
  return new AliasStore(ctx.db, {
    ownJid: () => ctx.wa.status.me?.jid ?? null,
    now: Date.now,
    log: ctx.log.child({ mod: 'contacts' }),
  });
}

export function getAliases(ctx: AppContext): AliasStore {
  const s = ctx.services.aliases;
  if (!s) throw new Error('alias store not initialized');
  return s;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run packages/server/src/chats/aliases.test.ts` → PASS (12 tests).
Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/chats/aliases.ts packages/server/src/chats/aliases.test.ts
git commit -m "feat(server): AliasStore persists phone-number/WhatsApp ID pairs and routes without merging"
```

---

## Task 4: `mergeChat` and the labelled pre-merge backup (kept 30 days)

**Files:**
- Create: `packages/server/src/chats/merge.ts`
- Test: `packages/server/src/chats/merge.test.ts`
- Modify: `packages/server/src/backup/backup.ts` (`runBackupSync`, label, 30-day pre-merge retention)
- Test: `packages/server/src/backup/backup.test.ts`

**Interfaces:**
- Consumes: `ChatRepo`, `ChatRow`, `jidUser` (`chats/repo.ts`), `audit` (`db/audit.ts`); tables `ai_chat_state` and `users.kind` (migration 003, #18).
- Produces:
  - `export interface MergeResult { from: string; to: string; rekeyed: boolean; moved: { messages: number; events: number; notes: number; aiState: number }; assignedTo: number | null; assigneeDropped: number | null }`
  - `export function mergeChat(db: DB, from: string, to: string, opts: { now: number }): MergeResult | null` — only called by the startup identity migration (Task 5).
  - Owner rule: one owner kept; a teammate (`users.kind = 'human'`) beats the AI Sales Agent member; otherwise the chat with the newest inbound message keeps its owner; a dropped owner gets an `assigned` chat event `{assignedTo, previous, reason:'merge'}` (actor NULL).
  - AI state rule: `ai_chat_state` of `from` moves to `to`; both present → the newer-inbound chat's state wins, `paused` if either was paused (then `awaiting_confirmation = 0`, `due_at = NULL`).
  - `export const PREMERGE_KEEP_DAYS = 30;`
  - `export function runBackupSync(dataDir: string, db: DB, now?: Date, opts?: { label?: string }): string`; `runBackup(dataDir, db, now?)` keeps its signature and delegates.

- [ ] **Step 1: Write the failing backup tests**

In `packages/server/src/backup/backup.test.ts` change the import to `import { backupStamp, hasBackupFor, runBackup, runBackupSync } from './backup.js';` and append inside `describe('runBackup', …)`:

```ts
  it('writes a labelled pre-merge backup that the daily rotation never deletes', () => {
    const now = new Date(2026, 9, 5, 9, 0);
    const file = runBackupSync(dir, db, now, { label: 'premerge' });
    expect(file).toBe(join(dir, 'backups', 'app-premerge-20261005.db'));
    expect(
      readFileSync(join(dir, 'backups', 'wa-auth-premerge-20261005', 'creds.json'), 'utf8'),
    ).toBe('{"a":1}');
    for (let d = 6; d <= 14; d++) runBackupSync(dir, db, new Date(2026, 9, d, 3, 0));
    const names = readdirSync(join(dir, 'backups'));
    expect(names).toContain('app-premerge-20261005.db');
    expect(names.filter((n) => /^app-\d{8}\.db$/.test(n))).toHaveLength(7);
    expect(hasBackupFor(dir, now)).toBe(false);
  });

  it('removes pre-merge backups after 30 days', () => {
    runBackupSync(dir, db, new Date(2026, 9, 5), { label: 'premerge' });
    runBackupSync(dir, db, new Date(2026, 10, 3));
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261005.db'))).toBe(true);
    runBackupSync(dir, db, new Date(2026, 10, 5));
    expect(existsSync(join(dir, 'backups', 'app-premerge-20261005.db'))).toBe(false);
    expect(existsSync(join(dir, 'backups', 'wa-auth-premerge-20261005'))).toBe(false);
  });
```

Run: `npx vitest run packages/server/src/backup/backup.test.ts`
Expected: FAIL — `runBackupSync is not a function`.

- [ ] **Step 2: Implement the backup changes**

In `packages/server/src/backup/backup.ts` replace the whole `runBackup` function (its doc comment through the closing brace) with:

```ts
/** Days a pre-merge backup (`app-premerge-YYYYMMDD.db`) is kept; the daily rotation ignores it. */
export const PREMERGE_KEEP_DAYS = 30;

function prunePremerge(dir: string, now: Date): void {
  const cutoff = backupStamp(new Date(now.getTime() - PREMERGE_KEEP_DAYS * 24 * 60 * 60 * 1000));
  for (const n of readdirSync(dir)) {
    const m = /^(?:app|wa-auth)-premerge-(\d{8})(?:\.db)?$/.exec(n);
    if (m && m[1]! < cutoff) rmSync(join(dir, n), { recursive: true, force: true });
  }
}

/**
 * Synchronous backup: `VACUUM INTO backups/app-[label-]YYYYMMDD.db` plus a copy of `wa-auth`.
 * Must not run inside a SQLite transaction (VACUUM INTO fails there). Daily backups keep the newest
 * 7; labelled pre-merge backups are kept PREMERGE_KEEP_DAYS days. Returns the db backup path.
 */
export function runBackupSync(
  dataDir: string,
  db: DB,
  now: Date = new Date(),
  opts: { label?: string } = {},
): string {
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = opts.label ? `${opts.label}-${backupStamp(now)}` : backupStamp(now);

  const dbFile = join(dir, `app-${stamp}.db`);
  rmSync(dbFile, { force: true });
  db.prepare('VACUUM INTO ?').run(dbFile);

  const authSrc = join(dataDir, 'wa-auth');
  if (existsSync(authSrc)) {
    const authDst = join(dir, `wa-auth-${stamp}`);
    rmSync(authDst, { recursive: true, force: true });
    cpSync(authSrc, authDst, { recursive: true });
  }

  prune(dir, /^app-\d{8}\.db$/, BACKUP_KEEP);
  prune(dir, /^wa-auth-\d{8}$/, BACKUP_KEEP);
  prunePremerge(dir, now);
  return dbFile;
}

/** Nightly backup (see runBackupSync). */
export async function runBackup(dataDir: string, db: DB, now: Date = new Date()): Promise<string> {
  return runBackupSync(dataDir, db, now);
}
```

Run: `npx vitest run packages/server/src/backup/backup.test.ts` → PASS.

- [ ] **Step 3: Write the failing merge tests**

`packages/server/src/chats/merge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../db/index.js';
import { mergeChat } from './merge.js';
import type { ChatRow } from './repo.js';

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
let dir: string;
let db: DB;

type Seed = Partial<
  Pick<
    ChatRow,
    | 'name'
    | 'avatar_path'
    | 'unread_count'
    | 'last_message_at'
    | 'last_message_preview'
    | 'status'
    | 'assigned_to'
    | 'phone'
  >
>;

function seedChat(jid: string, f: Seed = {}): void {
  db.prepare(
    `INSERT INTO chats (jid, type, name, avatar_path, unread_count, last_message_at, last_message_preview,
       status, assigned_to, updated_at, phone)
     VALUES (@jid, 'dm', @name, @avatar_path, @unread_count, @last_message_at, @last_message_preview,
       @status, @assigned_to, 1, @phone)`,
  ).run({
    jid,
    name: 'Aisyah',
    avatar_path: null,
    unread_count: 0,
    last_message_at: null,
    last_message_preview: null,
    status: 'open',
    assigned_to: null,
    phone: null,
    ...f,
  });
}

function seedMessages(jid: string, n: number, startTs: number): void {
  const ins = db.prepare(
    `INSERT INTO messages (id, chat_jid, from_me, type, body, timestamp, created_at, wa_remote_jid)
     VALUES (?, ?, 0, 'text', ?, ?, ?, ?)`,
  );
  for (let i = 0; i < n; i++) ins.run(`${jid}#${i}`, jid, `m${i}`, startTs + i, startTs + i, jid);
}

const count = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;
const chat = (jid: string) =>
  db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid) as ChatRow | undefined;
const aiState = (jid: string, f: { paused?: number; customer: string; dueAt: number | null }) =>
  db
    .prepare(
      `INSERT INTO ai_chat_state (chat_jid, paused, awaiting_confirmation, last_customer_message_id, due_at)
       VALUES (?, ?, 1, ?, ?)`,
    )
    .run(jid, f.paused ?? 0, f.customer, f.dueAt);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-merge-'));
  db = openDb(join(dir, 'app.db'));
  const user = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?, ?, 'x', 'agent', 1)",
  );
  user.run('u1', 'U1');
  user.run('u2', 'U2');
  // id 3: the AI Sales Agent member (#18; at most one `kind = 'ai'` user, always an agent)
  db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, kind, created_at) VALUES ('ai-1', 'Sales Agent', '', 'agent', 'ai', 1)",
  ).run();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('mergeChat', () => {
  it('merges the live shape: 64 PN + 5 LID messages, events, notes, a pending send and media rows', () => {
    seedChat(PN, {
      unread_count: 2,
      last_message_at: 1063,
      last_message_preview: 'pn last',
      status: 'resolved',
      phone: '60111111111',
    });
    seedChat(LID, {
      unread_count: 1,
      last_message_at: 2004,
      last_message_preview: 'lid last',
      avatar_path: 'lid.jpg',
    });
    seedMessages(PN, 64, 1000);
    seedMessages(LID, 5, 2000);
    db.prepare(
      `INSERT INTO messages (id, chat_jid, from_me, sent_by_user_id, type, body, status, timestamp, created_at,
         client_id, wa_remote_jid)
       VALUES ('local-c1', ?, 1, 1, 'text', 'queued', 'pending', 1500, 1500, 'c1', ?)`,
    ).run(PN, PN);
    db.prepare(
      `INSERT INTO messages (id, chat_jid, type, media_path, media_mime, media_status, timestamp, created_at,
         wa_remote_jid)
       VALUES ('pn-media', ?, 'image', 'pn-folder/pn-media.jpg', 'image/jpeg', 'ok', 900, 900, ?)`,
    ).run(PN, PN);
    db.prepare("INSERT INTO chat_events (chat_jid, type, payload, at) VALUES (?, 'resolved', '{}', 1100)").run(PN);
    db.prepare("INSERT INTO notes (chat_jid, user_id, body, created_at) VALUES (?, 1, 'VIP', 1200)").run(PN);

    const r = mergeChat(db, PN, LID, { now: 5000 });

    expect(r).toEqual({
      from: PN,
      to: LID,
      rekeyed: false,
      moved: { messages: 66, events: 1, notes: 1, aiState: 0 },
      assignedTo: null,
      assigneeDropped: null,
    });
    expect(chat(PN)).toBeUndefined();
    expect(chat(LID)).toMatchObject({
      unread_count: 3,
      last_message_at: 2004,
      last_message_preview: 'lid last',
      status: 'open',
      avatar_path: 'lid.jpg',
      phone: '60111111111',
      name: 'Aisyah',
      updated_at: 5000,
    });
    expect(count('SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ?', LID)).toBe(71);
    expect(
      db.prepare("SELECT chat_jid, wa_remote_jid, status FROM messages WHERE id = 'local-c1'").get(),
    ).toEqual({ chat_jid: LID, wa_remote_jid: PN, status: 'pending' });
    expect(db.prepare("SELECT media_path FROM messages WHERE id = 'pn-media'").get()).toEqual({
      media_path: 'pn-folder/pn-media.jpg',
    });
    expect(count('SELECT COUNT(*) AS n FROM chat_events WHERE chat_jid = ?', LID)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM notes WHERE chat_jid = ?', LID)).toBe(1);
    const auditRow = db
      .prepare("SELECT user_id, meta FROM audit_log WHERE action = 'chat.merge'")
      .get() as { user_id: number | null; meta: string };
    expect(auditRow.user_id).toBeNull();
    expect(JSON.parse(auditRow.meta)).toEqual({
      from: PN,
      to: LID,
      rekeyed: false,
      moved: { messages: 66, events: 1, notes: 1, aiState: 0 },
      assigneeDropped: null,
    });
  });

  it('takes the newer last message and stays open when either chat is open', () => {
    seedChat(PN, { last_message_at: 3000, last_message_preview: 'newer on PN', status: 'open' });
    seedChat(LID, { last_message_at: 2000, last_message_preview: 'older on LID', status: 'resolved' });
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)).toMatchObject({
      last_message_at: 3000,
      last_message_preview: 'newer on PN',
      status: 'open',
    });
  });

  it('stays resolved only when both chats are resolved', () => {
    seedChat(PN, { status: 'resolved' });
    seedChat(LID, { status: 'resolved' });
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)!.status).toBe('resolved');
  });

  it.each([
    { pnOwner: 1, lidOwner: 1, pnNewest: true, kept: 1, dropped: null },
    { pnOwner: null, lidOwner: 2, pnNewest: true, kept: 2, dropped: null },
    { pnOwner: 1, lidOwner: null, pnNewest: false, kept: 1, dropped: null },
    { pnOwner: 1, lidOwner: 2, pnNewest: true, kept: 1, dropped: 2 },
    { pnOwner: 1, lidOwner: 2, pnNewest: false, kept: 2, dropped: 1 },
    // 3 = the AI Sales Agent: a teammate always wins, whichever chat is newer
    { pnOwner: 3, lidOwner: 2, pnNewest: true, kept: 2, dropped: 3 },
    { pnOwner: 1, lidOwner: 3, pnNewest: false, kept: 1, dropped: 3 },
    { pnOwner: 3, lidOwner: null, pnNewest: false, kept: 3, dropped: null },
  ])(
    'one owner: PN=$pnOwner LID=$lidOwner (PN has newest inbound: $pnNewest) keeps $kept',
    ({ pnOwner, lidOwner, pnNewest, kept, dropped }) => {
      seedChat(PN, { assigned_to: pnOwner });
      seedChat(LID, { assigned_to: lidOwner });
      seedMessages(PN, 1, pnNewest ? 3000 : 1000);
      seedMessages(LID, 1, 2000);
      const r = mergeChat(db, PN, LID, { now: 5000 })!;
      expect(chat(LID)!.assigned_to).toBe(kept);
      expect(r.assignedTo).toBe(kept);
      expect(r.assigneeDropped).toBe(dropped);
      const events = (
        db
          .prepare(
            "SELECT actor_id, payload, at FROM chat_events WHERE chat_jid = ? AND type = 'assigned'",
          )
          .all(LID) as Array<{ actor_id: number | null; payload: string; at: number }>
      ).map((e) => ({ ...e, payload: JSON.parse(e.payload) as unknown }));
      if (dropped === null) {
        expect(events).toEqual([]);
      } else {
        expect(events).toEqual([
          {
            actor_id: null,
            payload: { assignedTo: kept, previous: dropped, reason: 'merge' },
            at: 5000,
          },
        ]);
        const meta = db.prepare("SELECT meta FROM audit_log WHERE action = 'chat.merge'").get() as {
          meta: string;
        };
        expect(JSON.parse(meta.meta).assigneeDropped).toBe(dropped);
      }
    },
  );

  it.each([
    { savedOn: PN, pnName: 'Push Aisyah', lidName: 'Other', expected: 'Saved Aisyah' },
    { savedOn: null, pnName: 'Aisyah Real', lidName: '', expected: 'Aisyah Real' },
    { savedOn: null, pnName: '60111111111', lidName: '123456789', expected: '123456789' },
  ])('name: saved contact > real name > LID chat name ($expected)', ({ savedOn, pnName, lidName, expected }) => {
    seedChat(PN, { name: pnName });
    seedChat(LID, { name: lidName });
    if (savedOn) db.prepare("INSERT INTO contacts (jid, saved_name) VALUES (?, 'Saved Aisyah')").run(savedOn);
    mergeChat(db, PN, LID, { now: 5000 });
    expect(chat(LID)!.name).toBe(expected);
  });

  it('re-keys the phone-number chat when the WhatsApp ID has no chat yet', () => {
    seedChat(PN, {
      name: '60111111111',
      unread_count: 4,
      assigned_to: 2,
      last_message_at: 10,
      last_message_preview: 'hi',
    });
    seedMessages(PN, 3, 1);
    const r = mergeChat(db, PN, LID, { now: 5000 })!;
    expect(r).toMatchObject({
      rekeyed: true,
      moved: { messages: 3, events: 0, notes: 0, aiState: 0 },
    });
    expect(chat(PN)).toBeUndefined();
    expect(chat(LID)).toMatchObject({
      type: 'dm',
      name: '',
      unread_count: 4,
      assigned_to: 2,
      last_message_at: 10,
      last_message_preview: 'hi',
      phone: '60111111111',
      updated_at: 5000,
    });
  });

  it('is idempotent: a second run finds nothing to merge', () => {
    seedChat(PN);
    seedChat(LID);
    expect(mergeChat(db, PN, LID, { now: 5000 })).not.toBeNull();
    expect(mergeChat(db, PN, LID, { now: 6000 })).toBeNull();
    expect(mergeChat(db, LID, LID, { now: 6000 })).toBeNull();
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(1);
  });

  it('rolls back everything when a statement inside the merge fails', () => {
    seedChat(PN);
    seedChat(LID);
    seedMessages(PN, 2, 1);
    db.exec("CREATE TRIGGER fail_merge BEFORE DELETE ON chats BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(() => mergeChat(db, PN, LID, { now: 5000 })).toThrow('boom');
    expect(chat(PN)).toBeDefined();
    expect(count('SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ?', PN)).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(0);
  });

  it("moves the AI Sales Agent's chat state with a re-keyed phone-number chat", () => {
    seedChat(PN, { assigned_to: 3 });
    seedMessages(PN, 1, 1000);
    aiState(PN, { customer: `${PN}#0`, dueAt: 9000 });
    const r = mergeChat(db, PN, LID, { now: 5000 })!;
    expect(r.moved.aiState).toBe(1);
    expect(chat(LID)!.assigned_to).toBe(3);
    expect(db.prepare('SELECT * FROM ai_chat_state').all()).toEqual([
      {
        chat_jid: LID,
        paused: 0,
        awaiting_confirmation: 1,
        last_customer_message_id: `${PN}#0`,
        last_replied_message_id: null,
        due_at: 9000,
      },
    ]);
  });

  it.each([
    { pnNewest: true, lidPaused: 0, paused: 0, customer: `${PN}#0`, dueAt: 9000, awaiting: 1 },
    { pnNewest: false, lidPaused: 0, paused: 0, customer: `${LID}#0`, dueAt: 8000, awaiting: 1 },
    { pnNewest: true, lidPaused: 1, paused: 1, customer: `${PN}#0`, dueAt: null, awaiting: 0 },
  ])(
    'keeps the newer AI state and stays paused if either chat was handed off (PN newest: $pnNewest, LID paused: $lidPaused)',
    ({ pnNewest, lidPaused, paused, customer, dueAt, awaiting }) => {
      seedChat(PN);
      seedChat(LID);
      seedMessages(PN, 1, pnNewest ? 3000 : 1000);
      seedMessages(LID, 1, 2000);
      aiState(PN, { customer: `${PN}#0`, dueAt: 9000 });
      aiState(LID, { paused: lidPaused, customer: `${LID}#0`, dueAt: 8000 });
      expect(mergeChat(db, PN, LID, { now: 5000 })!.moved.aiState).toBe(1);
      expect(db.prepare('SELECT * FROM ai_chat_state').all()).toEqual([
        {
          chat_jid: LID,
          paused,
          awaiting_confirmation: awaiting,
          last_customer_message_id: customer,
          last_replied_message_id: null,
          due_at: dueAt,
        },
      ]);
    },
  );
});
```

Run: `npx vitest run packages/server/src/chats/merge.test.ts`
Expected: FAIL — `Failed to load url ./merge.js`.

- [ ] **Step 4: Implement `merge.ts`**

```ts
import { audit } from '../db/audit.js';
import type { DB } from '../db/index.js';
import { ChatRepo, jidUser, type ChatRow } from './repo.js';

export interface MergeResult {
  from: string;
  to: string;
  /** `to` had no chat row: `from` was renamed instead */
  rekeyed: boolean;
  /** `aiState`: 1 when the AI Sales Agent's `ai_chat_state` row of `from` was moved/merged */
  moved: { messages: number; events: number; notes: number; aiState: number };
  assignedTo: number | null;
  /** owner removed because both chats had different owners (one owner per chat) */
  assigneeDropped: number | null;
}

const isFallback = (name: string, jid: string) =>
  !name.trim() || name === jid || name === jidUser(jid);
const pnDigits = (jid: string) => (jid.endsWith('@s.whatsapp.net') ? jidUser(jid) : null);

function lastInboundAt(db: DB, jid: string): number {
  const r = db
    .prepare('SELECT MAX(timestamp) AS ts FROM messages WHERE chat_jid = ? AND from_me = 0')
    .get(jid) as { ts: number | null };
  return r.ts ?? -1;
}

const isAiMember = (db: DB, id: number | null): boolean =>
  id !== null &&
  (db.prepare('SELECT kind FROM users WHERE id = ?').get(id) as { kind: string } | undefined)
    ?.kind === 'ai';

interface AiStateRow {
  paused: number;
  awaiting_confirmation: number;
  last_customer_message_id: string | null;
  last_replied_message_id: string | null;
  due_at: number | null;
}

/**
 * Moves the AI Sales Agent's per-chat state: `ai_chat_state` has ON DELETE CASCADE and would vanish
 * with the `from` row. Both present: the newer-inbound chat's state wins, and a handoff (paused) in
 * either chat keeps the AI out until a teammate acts. Returns 1 when a row was moved or merged.
 */
function mergeAiState(db: DB, from: string, to: string, fromNewer: boolean): number {
  const get = db.prepare('SELECT * FROM ai_chat_state WHERE chat_jid = ?');
  const a = get.get(from) as AiStateRow | undefined;
  if (!a) return 0;
  const b = get.get(to) as AiStateRow | undefined;
  if (!b) {
    db.prepare('UPDATE ai_chat_state SET chat_jid = ? WHERE chat_jid = ?').run(to, from);
    return 1;
  }
  const keep = fromNewer ? a : b;
  const paused = Math.max(a.paused, b.paused);
  db.prepare(
    `UPDATE ai_chat_state SET paused = ?, awaiting_confirmation = ?, last_customer_message_id = ?,
       last_replied_message_id = ?, due_at = ? WHERE chat_jid = ?`,
  ).run(
    paused,
    paused ? 0 : keep.awaiting_confirmation,
    keep.last_customer_message_id,
    keep.last_replied_message_id,
    paused ? null : keep.due_at,
    to,
  );
  db.prepare('DELETE FROM ai_chat_state WHERE chat_jid = ?').run(from);
  return 1;
}

/** saved contact name > a real (non-fallback) chat name > the canonical chat's name */
function bestName(db: DB, from: ChatRow, to: ChatRow): string {
  const saved = db
    .prepare(
      `SELECT saved_name FROM contacts WHERE jid IN (?, ?) AND saved_name IS NOT NULL AND saved_name <> ''
       ORDER BY jid = ? DESC LIMIT 1`,
    )
    .get(to.jid, from.jid, to.jid) as { saved_name: string } | undefined;
  if (saved) return saved.saved_name;
  if (!isFallback(to.name, to.jid)) return to.name;
  if (!isFallback(from.name, from.jid)) return from.name;
  return to.name;
}

/**
 * Merges chat `from` (the PN) into `to` (the LID) in one synchronous transaction. Only the startup
 * identity migration calls this. Returns null when `from` has no chat row (idempotent). Media files
 * are not moved: `media_path` stays valid. `jid_aliases` is not touched (the pair already exists).
 */
export function mergeChat(db: DB, from: string, to: string, opts: { now: number }): MergeResult | null {
  if (from === to) return null;
  const repo = new ChatRepo(db);
  return db.transaction((): MergeResult | null => {
    const a = repo.get(from);
    if (!a) return null;
    const b = repo.get(to);
    // Decide before any message moves: which chat heard from the customer last.
    const fromNewer = lastInboundAt(db, from) > lastInboundAt(db, to);
    const phone = pnDigits(from) ?? a.phone;
    let assignedTo = a.assigned_to;
    let assigneeDropped: number | null = null;

    if (!b) {
      db.prepare(
        `INSERT INTO chats (jid, type, name, avatar_path, unread_count, last_message_at, last_message_preview,
           status, assigned_to, updated_at, phone)
         VALUES (@jid, 'dm', @name, @avatar, @unread, @lastAt, @preview, @status, @assigned, @now, @phone)`,
      ).run({
        jid: to,
        name: isFallback(a.name, from) ? '' : a.name,
        avatar: a.avatar_path,
        unread: a.unread_count,
        lastAt: a.last_message_at,
        preview: a.last_message_preview,
        status: a.status,
        assigned: a.assigned_to,
        now: opts.now,
        phone,
      });
    } else {
      const newest = (b.last_message_at ?? -1) >= (a.last_message_at ?? -1) ? b : a;
      if (a.assigned_to === null || b.assigned_to === null || a.assigned_to === b.assigned_to) {
        assignedTo = b.assigned_to ?? a.assigned_to;
      } else {
        // A teammate always beats the AI Sales Agent (human ownership cancels AI work);
        // otherwise the chat with the newest inbound keeps its owner.
        const aiFrom = isAiMember(db, a.assigned_to);
        const aiTo = isAiMember(db, b.assigned_to);
        const keepFrom = aiFrom !== aiTo ? aiTo : fromNewer;
        assignedTo = keepFrom ? a.assigned_to : b.assigned_to;
        assigneeDropped = keepFrom ? b.assigned_to : a.assigned_to;
      }
      repo.update(to, {
        type: 'dm',
        name: bestName(db, a, b),
        avatar_path: b.avatar_path ?? a.avatar_path,
        unread_count: a.unread_count + b.unread_count,
        last_message_at: newest.last_message_at,
        last_message_preview: newest.last_message_preview,
        status: a.status === 'open' || b.status === 'open' ? 'open' : 'resolved',
        assigned_to: assignedTo,
        phone: phone ?? b.phone,
        updated_at: opts.now,
      });
    }

    const moved = {
      messages: db.prepare('UPDATE messages SET chat_jid = ? WHERE chat_jid = ?').run(to, from).changes,
      events: db.prepare('UPDATE chat_events SET chat_jid = ? WHERE chat_jid = ?').run(to, from).changes,
      notes: db.prepare('UPDATE notes SET chat_jid = ? WHERE chat_jid = ?').run(to, from).changes,
      // must run before DELETE FROM chats (cascade) and after the `to` row exists (foreign key)
      aiState: mergeAiState(db, from, to, fromNewer),
    };
    if (assigneeDropped !== null) {
      repo.insertEvent({
        chatJid: to,
        type: 'assigned',
        actorId: null,
        payload: { assignedTo, previous: assigneeDropped, reason: 'merge' },
        at: opts.now,
      });
    }
    db.prepare('DELETE FROM chats WHERE jid = ?').run(from);
    audit(db, {
      userId: null,
      action: 'chat.merge',
      ip: null,
      meta: { from, to, rekeyed: !b, moved, assigneeDropped },
    });
    return { from, to, rekeyed: !b, moved, assignedTo, assigneeDropped };
  })();
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run packages/server/src/chats/merge.test.ts packages/server/src/backup/backup.test.ts` → PASS.
Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/chats/merge.ts packages/server/src/chats/merge.test.ts packages/server/src/backup/backup.ts packages/server/src/backup/backup.test.ts
git commit -m "feat(server): merge duplicate chats in one transaction; pre-merge backup kept 30 days"
```

---

## Task 5: Startup identity migration, wiring, and chat-service integration

**Files:**
- Create: `packages/server/src/chats/identity-migration.ts`
- Create: `packages/server/test/identity-startup.test.ts`
- Modify: `packages/server/src/wa-bridge/index.ts` (`initMessaging`: alias store → migration → services)
- Modify: `packages/server/src/chats/service.ts` (remove in-memory `aliases`/`link`; `resolveJid`; `get`; `upsertFromWa`; `upsertContacts`; `upsertContactAliases`)
- Modify: `packages/server/test/contact-names.test.ts:112-135` (rule 3 replaces "rejects conflicting")

**Interfaces:**
- Consumes: `readStoredLidMappings`, `WaContactAlias` (Task 2); `AliasStore`, `createAliasStore`, `getAliases` (Task 3); `mergeChat`, `runBackupSync` (Task 4).
- Produces:
  - `export interface IdentityMigrationDeps { now?: () => number; readPairs?: (authDir: string) => WaContactAlias[]; backup?: (dataDir: string, db: DB, now: Date) => string }`
  - `export interface IdentityMigrationSummary { storedPairs: number; learned: number; pending: number; merged: number; rekeyed: number; failed: number; backup: string | null; result: 'idle' | 'merged' | 'backup-failed' }`
  - `export function runIdentityMigration(ctx: AppContext, deps?: IdentityMigrationDeps): IdentityMigrationSummary` (synchronous; logs `mod:'contacts'`)
  - `ChatService.resolveJid(jid: string): string` — `jid` when it has its own chat row (a chat left separate until the next start stays reachable), else `aliases.route(jid)`.
  - `ChatService.get(jid)` falls back to the routed chat; `upsertFromWa` routes DM JIDs (history `chats.upsert` never recreates a merged PN row).

- [ ] **Step 1: Write the failing startup tests**

`packages/server/test/identity-startup.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
let dir: string;
let t: TestApp | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-identity-'));
});
afterEach(async () => {
  await t?.close();
  t = null;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** Writes app.db as the previous build left it (schema already at the latest version). */
function seed(sql: string): void {
  const db = openDb(join(dir, 'app.db'));
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
/** What Baileys' multi-file auth state stores for a PN↔LID pair. */
function lidMapping(pnUser: string, lidUser: string): void {
  mkdirSync(join(dir, 'wa-auth'), { recursive: true });
  writeFileSync(join(dir, 'wa-auth', `lid-mapping-${pnUser}.json`), JSON.stringify(lidUser));
  writeFileSync(join(dir, 'wa-auth', `lid-mapping-${lidUser}_reverse.json`), JSON.stringify(pnUser));
}
/** A server start on `dir` (initializers run before WhatsApp connects, like startServer). */
async function start(): Promise<TestApp> {
  t = await makeTestApp({ config: { dataDir: dir } });
  return t;
}
async function restart(): Promise<TestApp> {
  await t?.close();
  t = null;
  return start();
}
const jids = (app: TestApp) =>
  (app.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
    (r) => r.jid,
  );
const premerge = (): string[] => {
  try {
    return readdirSync(join(dir, 'backups')).filter((n) => n.startsWith('app-premerge-'));
  } catch {
    return [];
  }
};
const merges = (app: TestApp) =>
  app.ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'chat.merge'").get();

const TWO_CHATS = `
  INSERT INTO chats (jid, type, name, unread_count, last_message_at, last_message_preview, status, updated_at) VALUES
    ('${PN}', 'dm', 'Aisyah', 2, 1063, 'pn last', 'resolved', 1),
    ('${LID}', 'dm', 'Aisyah', 1, 2004, 'lid last', 'open', 1);
  INSERT INTO messages (id, chat_jid, from_me, type, body, timestamp, created_at, wa_remote_jid) VALUES
    ('P-1', '${PN}', 0, 'text', 'old', 1063, 1063, '${PN}'),
    ('L-1', '${LID}', 0, 'text', 'new', 2004, 2004, '${LID}');
`;

describe('startup identity migration', () => {
  it('merges a phone-number chat into its WhatsApp ID chat before WhatsApp connects, after one backup', async () => {
    seed(`${TWO_CHATS}
      INSERT INTO ai_chat_state (chat_jid, paused, awaiting_confirmation, last_customer_message_id, due_at)
        VALUES ('${PN}', 0, 0, 'P-1', NULL);`);
    lidMapping('60111111111', '123456789');
    const app = await start();
    expect(jids(app)).toEqual([LID]);
    expect(getChats(app.ctx).get(LID)).toMatchObject({
      unreadCount: 3,
      phone: '60111111111',
      status: 'open',
      lastMessagePreview: 'lid last',
    });
    expect(app.ctx.db.prepare('SELECT chat_jid FROM ai_chat_state').all()).toEqual([{ chat_jid: LID }]);
    expect(premerge()).toHaveLength(1);
    expect(merges(app)).toEqual({ n: 1 });
    // history chats.upsert for the merged number never recreates its chat
    expect(getChats(app.ctx).upsertFromWa({ jid: PN, type: 'dm', name: 'Aisyah' }).jid).toBe(LID);
    expect(jids(app)).toEqual([LID]);
    expect(getChats(app.ctx).get(PN)?.jid).toBe(LID);
  });

  it('is a no-op on the next start: no backup and no second merge', async () => {
    seed(TWO_CHATS);
    lidMapping('60111111111', '123456789');
    await start();
    rmSync(join(dir, 'backups'), { recursive: true, force: true });
    const app = await restart();
    expect(jids(app)).toEqual([LID]);
    expect(premerge()).toEqual([]);
    expect(merges(app)).toEqual({ n: 1 });
  });

  it('re-keys a phone-number-only chat to its WhatsApp ID; the phone number still finds it', async () => {
    seed(`
      INSERT INTO chats (jid, type, name, unread_count, status, assigned_to, updated_at)
        VALUES ('${PN}', 'dm', 'Aisyah', 1, 'open', NULL, 1);
      INSERT INTO messages (id, chat_jid, from_me, type, body, timestamp, created_at, wa_remote_jid)
        VALUES ('P-1', '${PN}', 0, 'text', 'hi', 10, 10, '${PN}');`);
    lidMapping('60111111111', '123456789');
    const app = await start();
    expect(jids(app)).toEqual([LID]);
    expect(getChats(app.ctx).resolveJid(PN)).toBe(LID);
    expect(getChats(app.ctx).get(LID)).toMatchObject({ name: 'Aisyah', phone: '60111111111' });
  });

  it('starts and merges nothing when wa-auth is missing', async () => {
    seed(TWO_CHATS);
    const app = await start();
    expect(jids(app)).toEqual([LID, PN]);
    expect(premerge()).toEqual([]);
    expect(app.ctx.db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });

  it('an unreadable wa-auth still starts, and saved aliases still merge', async () => {
    seed(`${TWO_CHATS}
      INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at) VALUES ('${PN}', '${LID}', 'message', 1);`);
    writeFileSync(join(dir, 'wa-auth'), 'not a directory');
    const app = await start();
    expect(jids(app)).toEqual([LID]);
    expect(premerge()).toHaveLength(1);
  });

  it('leaves chats separate when the pre-merge backup fails; both keep working; a later start merges', async () => {
    seed(TWO_CHATS);
    lidMapping('60111111111', '123456789');
    writeFileSync(join(dir, 'backups'), 'not a directory');
    const app = await start();
    expect(jids(app)).toEqual([LID, PN]);
    expect(merges(app)).toEqual({ n: 0 });
    expect(getChats(app.ctx).resolveJid(PN)).toBe(PN);
    await getMessages(app.ctx).ingest(
      {
        id: 'P-2',
        chatJid: PN,
        senderJid: PN,
        senderName: 'Aisyah',
        fromMe: false,
        type: 'text',
        body: 'still here',
        quotedId: null,
        timestamp: 3000,
        media: null,
      },
      'live',
    );
    expect(app.ctx.db.prepare("SELECT chat_jid FROM messages WHERE id = 'P-2'").get()).toEqual({
      chat_jid: LID,
    });

    rmSync(join(dir, 'backups'), { force: true });
    const next = await restart();
    expect(jids(next)).toEqual([LID]);
    expect(premerge()).toHaveLength(1);
  });
});
```

(The `P-2` ingest assertion passes only after Task 6 routes ingest; until then this test is expected to fail at that line — Task 6 Step 4 re-runs this file.)

In `packages/server/test/contact-names.test.ts` add `import { getAliases } from '../src/chats/aliases.js';` and replace the test `'rejects conflicting and malformed mappings without combining different people'` (lines 112-135) with:

```ts
  it('re-points a recycled phone number for future routing without combining different people', () => {
    const chats = getChats(t.ctx);
    const otherPN = '60222222222@s.whatsapp.net';
    const otherLID = '987654321@lid';
    chats.upsertFromWa({ jid: LID, type: 'dm', name: null });
    chats.upsertFromWa({ jid: otherLID, type: 'dm', name: null });
    chats.upsertContacts([
      { jid: LID, savedName: 'Alice', pushName: null },
      { jid: otherLID, savedName: 'Bob', pushName: null },
    ]);
    chats.upsertContactAliases([
      { jid: PN, alias: LID },
      { jid: otherPN, alias: otherLID },
    ]);
    chats.upsertContactAliases([
      { jid: PN, alias: otherLID },
      { jid: PN, alias: 'letters@lid' },
    ]);
    expect(getAliases(t.ctx).resolve(PN)).toBe(otherLID);
    expect(chats.get(LID)).toMatchObject({ name: 'Alice', phone: null });
    expect(chats.get(otherLID)).toMatchObject({ name: 'Bob', phone: '60111111111' });
    expect(
      chats
        .list({ assigned: 'any', limit: 10 }, 1)
        .chats.map((c) => c.jid)
        .sort(),
    ).toEqual([LID, otherLID]);
    expect(new ChatRepo(t.ctx.db).getContact('letters@lid')).toBeNull();
  });
```

Run: `npx vitest run packages/server/test/identity-startup.test.ts packages/server/test/contact-names.test.ts`
Expected: FAIL — two chats remain after start (`expected [ '123456789@lid', '60111111111@s.whatsapp.net' ] to deeply equal [ '123456789@lid' ]`) and `getAliases` throws `alias store not initialized`.

- [ ] **Step 2: Implement `identity-migration.ts`**

```ts
import { join } from 'node:path';
import { readStoredLidMappings, type WaContactAlias } from '@wa-team-inbox/wa';
import { runBackupSync } from '../backup/backup.js';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { getAliases } from './aliases.js';
import { mergeChat } from './merge.js';

export interface IdentityMigrationDeps {
  now?: () => number;
  /** default: readStoredLidMappings(<data>/wa-auth) */
  readPairs?: (authDir: string) => WaContactAlias[];
  /** default: runBackupSync(dataDir, db, now, { label: 'premerge' }) */
  backup?: (dataDir: string, db: DB, now: Date) => string;
}

export interface IdentityMigrationSummary {
  /** pairs read from the Baileys auth store */
  storedPairs: number;
  /** pairs that were new or re-pointed */
  learned: number;
  pending: number;
  merged: number;
  rekeyed: number;
  failed: number;
  backup: string | null;
  /** 'idle' = nothing to merge (no backup); 'backup-failed' = chats stay separate until a later start */
  result: 'idle' | 'merged' | 'backup-failed';
}

/**
 * Startup identity migration (spec §8): the only place chats are merged. Runs synchronously from
 * initMessaging before the chat/message services (send-queue restore), the AI Sales Agent,
 * HTTP/socket listen and the WhatsApp connection. A no-op without a backup when nothing needs merging.
 */
export function runIdentityMigration(
  ctx: AppContext,
  deps: IdentityMigrationDeps = {},
): IdentityMigrationSummary {
  const log = ctx.log.child({ mod: 'contacts' });
  const now = deps.now ?? Date.now;
  const aliases = getAliases(ctx);

  let pairs: WaContactAlias[] = [];
  try {
    pairs = (deps.readPairs ?? readStoredLidMappings)(join(ctx.config.dataDir, 'wa-auth'));
  } catch (err) {
    log.warn({ err }, 'stored WhatsApp ID mappings unreadable; using saved aliases only');
  }
  let learned = 0;
  for (const pair of pairs) {
    const o = aliases.learn(pair, 'keystore');
    if (o.kind === 'added' || o.kind === 'repointed') learned++;
  }

  const pending = aliases.pendingMerges();
  const summary: IdentityMigrationSummary = {
    storedPairs: pairs.length,
    learned,
    pending: pending.length,
    merged: 0,
    rekeyed: 0,
    failed: 0,
    backup: null,
    result: 'idle',
  };
  if (!pending.length) {
    log.info(summary, 'identity migration: nothing to merge');
    return summary;
  }

  // One restore point before the first change; VACUUM INTO must run outside any transaction.
  const backup =
    deps.backup ?? ((dataDir, db, at) => runBackupSync(dataDir, db, at, { label: 'premerge' }));
  try {
    summary.backup = backup(ctx.config.dataDir, ctx.db, new Date(now()));
  } catch (err) {
    summary.result = 'backup-failed';
    log.error({ err, ...summary }, 'pre-merge backup failed; chats stay separate until a later start');
    return summary;
  }

  for (const p of pending) {
    try {
      const r = mergeChat(ctx.db, p.from, p.to, { now: now() });
      if (!r) continue;
      summary.merged++;
      if (r.rekeyed) summary.rekeyed++;
      log.info(
        { from: r.from, to: r.to, rekeyed: r.rekeyed, ...r.moved, assigneeDropped: r.assigneeDropped },
        'chats merged',
      );
    } catch (err) {
      summary.failed++;
      log.error({ err, from: p.from, to: p.to }, 'chat merge failed; chats stay separate');
    }
  }
  summary.result = 'merged';
  log.info(summary, 'identity migration completed');
  return summary;
}
```

- [ ] **Step 3: Wire the migration into startup**

`packages/server/src/wa-bridge/index.ts`: add `import { createAliasStore } from '../chats/aliases.js';` and `import { runIdentityMigration } from '../chats/identity-migration.js';`, and replace `initMessaging`:

```ts
/**
 * Service initializer (registered in services.ts, before initPush/initAi; runInitializers finishes
 * before HTTP listen and wa.connect()). The startup identity migration — the only place chats are
 * merged — runs before the message service restores pending sends and before the AI Sales Agent.
 */
export function initMessaging(ctx: AppContext): void {
  ctx.services.aliases = createAliasStore(ctx);
  runIdentityMigration(ctx);
  ctx.services.chats = createChatService(ctx);
  ctx.services.messages = createMessageService(ctx);
  const detach = attachWaBridge(ctx);
  ctx.services.waBridge = { shutdown: detach };
}
```

- [ ] **Step 4: Route the chat service through the alias store**

`packages/server/src/chats/service.ts`:
- add `import { getAliases } from './aliases.js';`
- in `ChatService` add after `get(jid: string): Chat | null;`:

```ts
  /** `jid` when it has its own chat row, else the chat it routes to (old links, push URLs). */
  resolveJid(jid: string): string;
```

- replace `const aliases = new Map<string, Set<string>>();` (line 53) with `const aliases = getAliases(ctx);` and delete the whole `link` function (lines 62-71).
- replace `get`:

```ts
    get(jid) {
      const r = repo.get(jid) ?? repo.get(aliases.route(jid));
      return r ? rowToChat(r) : null;
    },

    resolveJid(jid) {
      return repo.get(jid) ? jid : aliases.route(jid);
    },
```

- in `upsertFromWa`, insert as the first line `const jid = info.type === 'dm' ? aliases.route(info.jid) : info.jid;` and replace every `info.jid` in the function body with `jid` (history `chats.upsert` must not recreate a merged PN row).
- replace `upsertContacts` and `upsertContactAliases`:

```ts
    upsertContacts(list) {
      const t = now();
      // Learn pairs outside the name transaction so the alias cache never outlives a rollback.
      for (const c of list) {
        if (chatTypeOf(c.jid) !== 'dm') continue;
        for (const alias of c.aliases ?? []) aliases.learn({ jid: c.jid, alias }, 'contacts');
      }
      const renamed = ctx.db.transaction((items: WaContactInfo[]) => {
        const out = new Set<string>();
        for (const c of items) {
          if (chatTypeOf(c.jid) !== 'dm') continue;
          for (const jid of syncNames(aliases.group(c.jid), t, c)) out.add(jid);
        }
        return out;
      })(list);
      for (const jid of renamed) emitChat(jid);
      log.info(
        { contactCount: list.length, renamedCount: renamed.size },
        'contact names synchronized',
      );
    },

    upsertContactAliases(list) {
      const outcomes = list.map((p) => aliases.learn(p, p.source ?? 'contacts'));
      const changed = ctx.db.transaction(() => {
        const out = new Set<string>();
        for (const o of outcomes) {
          if (o.kind === 'ignored') continue;
          for (const jid of syncNames(aliases.group(o.lid), now())) out.add(jid);
        }
        return out;
      })();
      // a newly known phone number shows in the WhatsApp ID chat's header
      for (const o of outcomes) {
        if ((o.kind === 'added' || o.kind === 'repointed') && repo.get(o.lid)) changed.add(o.lid);
      }
      for (const jid of changed) emitChat(jid);
      log.info(
        { aliasCount: list.length, renamedCount: changed.size },
        'contact aliases synchronized',
      );
    },
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/server/test/identity-startup.test.ts packages/server/test/contact-names.test.ts packages/server/test/chats.test.ts packages/server/src/wa-bridge/bridge.test.ts`
Expected: PASS, except the `P-2` routing assertion in "leaves chats separate when the pre-merge backup fails…" (ingest is routed in Task 6).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/chats/identity-migration.ts packages/server/test/identity-startup.test.ts packages/server/src/wa-bridge/index.ts packages/server/src/chats/service.ts packages/server/test/contact-names.test.ts
git commit -m "feat(server): merge phone-number and WhatsApp ID chats in a startup identity migration"
```

---

## Task 6: Runtime routing — ingest, routes, dev `fake-incoming`, push title

**Files:**
- Modify: `packages/server/src/messages/service.ts` (`ingest`, including the AI's `message:received` emit added by #18)
- Modify: `packages/server/src/routes/chats.ts` (`chatJidParam`; avatar, detail, patch, read), `packages/server/src/routes/messages.ts`, `packages/server/src/routes/notes.ts`
- Modify: `packages/server/src/routes/dev.ts`
- Modify: `packages/server/src/push/service.ts` (title fallback), `packages/server/src/i18n/messages.ts` (`push.unknownContact` in en/ms/zh-CN)
- Test: `packages/server/src/wa-bridge/bridge.test.ts`, `packages/server/test/chats.test.ts`, `packages/server/test/admin.test.ts`, `packages/server/src/push/service.test.ts`

**Interfaces:**
- Consumes: `getAliases(ctx).learn/route` (Task 3), `ChatService.resolveJid` (Task 5), `runIdentityMigration` (Task 5), `WaIncomingMessage.chatJidAlt` and `FakeWaAdapter.simulateContactAliases` (Task 2), `FakeIncomingBody.chatJidAlt` and `MessageRow.wa_remote_jid` (Task 1).
- Produces: inbound DM rows stored with `chat_jid = aliases.route(m.chatJid)` and `wa_remote_jid = m.chatJid`; `message:new`, `message:received` (AI trigger), `chat:updated`, `inbound:notify` and the media folder use the routed chat; `export function chatJidParam(ctx: AppContext, params: unknown): string` in `routes/chats.ts`; `POST /api/dev/fake-incoming` returns `{ id, chatJid: <routed chat>, timestamp }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/wa-bridge/bridge.test.ts` (add `import { getAliases } from '../chats/aliases.js';` and `import { runIdentityMigration } from '../chats/identity-migration.js';`):

```ts
const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
const chatJids = () =>
  (t.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
    (r) => r.jid,
  );

describe('one chat per person at runtime (routing only, never merging)', () => {
  it('a WhatsApp ID message joins the existing phone-number chat; the next start re-keys it', async () => {
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'first', senderName: 'Aisyah' });
    await settle();
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, chatJidAlt: PN, body: 'second', senderName: 'Aisyah' });
    await settle();
    expect(chatJids()).toEqual([PN]);
    expect(getChats(t.ctx).get(PN)).toMatchObject({ unreadCount: 2 });
    expect(
      t.ctx.db.prepare('SELECT id, chat_jid, wa_remote_jid FROM messages ORDER BY id').all(),
    ).toEqual([
      { id: 'L-1', chat_jid: PN, wa_remote_jid: LID },
      { id: 'P-1', chat_jid: PN, wa_remote_jid: PN },
    ]);
    // what the next server start does
    expect(runIdentityMigration(t.ctx)).toMatchObject({ merged: 1, rekeyed: 1 });
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)).toMatchObject({ unreadCount: 2, phone: '60111111111' });
  });

  it('a first message on the WhatsApp ID opens one LID chat; later phone-number messages follow it (and the AI trigger names it)', async () => {
    const received: string[] = [];
    t.ctx.bus.on('message:received', ({ chat, message }) =>
      received.push(`${chat.jid}/${message.chatJid}`),
    );
    const notified: string[] = [];
    t.ctx.bus.on('inbound:notify', ({ chat }) => notified.push(chat.jid));
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, chatJidAlt: PN, body: 'hi', senderName: 'Aisyah' });
    await settle();
    t.wa.simulateIncoming({ id: 'P-2', chatJid: PN, body: 'again' });
    await settle();
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)).toMatchObject({ unreadCount: 2, phone: '60111111111', name: 'Aisyah' });
    expect(received).toEqual([`${LID}/${LID}`, `${LID}/${LID}`]);
    expect(notified).toEqual([LID, LID]);
    expect(t.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE id = 'P-2'").get()).toEqual({
      chat_jid: LID,
      wa_remote_jid: PN,
    });
  });

  it('a pair learned while both chats exist routes new messages to the LID chat and merges nothing until the next start', async () => {
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'old', senderName: 'Aisyah' });
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, body: 'new', senderName: 'Aisyah' });
    await settle();
    t.wa.simulateContactAliases([{ jid: PN, alias: LID }]);
    await settle();
    expect(chatJids()).toEqual([LID, PN]);
    t.wa.simulateIncoming({ id: 'P-2', chatJid: PN, body: 'again' });
    await settle();
    expect(t.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE id = 'P-2'").get()).toEqual({
      chat_jid: LID,
      wa_remote_jid: PN,
    });
    expect(getChats(t.ctx).resolveJid(PN)).toBe(PN);
    expect(getAliases(t.ctx).pendingMerges()).toEqual([{ from: PN, to: LID }]);
    expect(runIdentityMigration(t.ctx)).toMatchObject({ merged: 1, rekeyed: 0 });
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)!.unreadCount).toBe(3);
  });

  it('history chats.upsert for a known phone number does not create a phone-number row', async () => {
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, chatJidAlt: PN, body: 'hi' });
    await settle();
    t.wa.emit('chats', [{ jid: PN, type: 'dm', name: 'Aisyah' }]);
    await settle();
    expect(chatJids()).toEqual([LID]);
  });

  it('never learns an alternate address for a group', async () => {
    t.wa.simulateIncoming({
      id: 'G-1',
      chatJid: '1203@g.us',
      chatJidAlt: PN,
      senderJid: PN,
      body: 'group',
    });
    await settle();
    expect(getAliases(t.ctx).resolve(PN)).toBe(PN);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });
});
```

Append inside `describe('chats routes', …)` in `packages/server/test/chats.test.ts` (add `import { runIdentityMigration } from '../src/chats/identity-migration.js';`):

```ts
  it('old phone-number URLs (links, push notifications) open the WhatsApp ID chat after the startup re-key', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const h = authHeaders(cookie);
    const PN = '60155555555@s.whatsapp.net';
    const LID = '555555555@lid';
    await seedChat(PN, 'Eve', 1000);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: LID }]);
    expect(runIdentityMigration(t.ctx)).toMatchObject({ merged: 1, rekeyed: 1 });

    const detail = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(PN)}`, headers: h });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().chat.jid).toBe(LID);
    const list = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(PN)}/messages`, headers: h });
    expect(list.json().messages.map((m: { id: string }) => m.id)).toEqual([`seed-${PN}`]);
    const note = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(PN)}/notes`,
      headers: h,
      payload: { body: 'merged note' },
    });
    expect(note.statusCode).toBe(201);
    expect(note.json().chatJid).toBe(LID);
    const notes = await t.app.inject({ method: 'GET', url: `/api/chats/${enc(PN)}/notes`, headers: h });
    expect(notes.json().notes.map((n: { body: string }) => n.body)).toEqual(['merged note']);
    const sent = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(PN)}/messages`,
      headers: h,
      payload: { clientId: 'route-merge', text: 'hello' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().chatJid).toBe(LID);
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/chats/${enc(PN)}`,
      headers: h,
      payload: { status: 'resolved' },
    });
    expect(patch.json().jid).toBe(LID);
    const read = await t.app.inject({ method: 'POST', url: `/api/chats/${enc(PN)}/read`, headers: h });
    expect(read.statusCode).toBe(200);
  });

  it('a phone-number chat that stays separate until the next start is still reachable under its own URL', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const PN = '60166666666@s.whatsapp.net';
    const LID = '666666666@lid';
    await seedChat(PN, 'Fay', 1000);
    await seedChat(LID, 'Fay', 2000);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: LID }]);
    const get = (jid: string) =>
      t.app.inject({ method: 'GET', url: `/api/chats/${enc(jid)}`, headers: authHeaders(cookie) });
    expect((await get(PN)).json().chat.jid).toBe(PN);
    expect((await get(LID)).json().chat.jid).toBe(LID);
  });
```

Append inside `describe('dev fake-incoming', …)` in `packages/server/test/admin.test.ts`:

```ts
  it('accepts chatJidAlt and reports the routed chat', async () => {
    t = await makeTestApp();
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const r = await t.app.inject({
      method: 'POST',
      url: '/api/dev/fake-incoming',
      headers: authHeaders(agent.cookie),
      payload: { chatJid: '60123456789@s.whatsapp.net', chatJidAlt: '123456789@lid', text: 'hi' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().chatJid).toBe('123456789@lid');
  });
```

Append inside `describe('PushService', …)` in `packages/server/src/push/service.test.ts`:

```ts
  it('titles a chat without a name or phone "Unknown contact" and links its own JID', async () => {
    const a = mkUser('a1');
    const { push, sent } = setup(new Set());
    push.subscribe(a.id, sub('a'));
    await push.notifyInbound({ ...chat(a.id), jid: '123456789@lid', name: '', phone: null }, message);
    expect(sent[0]!.payload).toMatchObject({
      title: 'Unknown contact',
      url: '/chats/123456789%40lid',
      tag: '123456789@lid',
    });
  });
```

Run: `npx vitest run packages/server/src/wa-bridge/bridge.test.ts packages/server/test/chats.test.ts packages/server/test/admin.test.ts packages/server/src/push/service.test.ts`
Expected: FAIL — the LID message opens a second chat (`expected [ '123456789@lid', '60111111111@s.whatsapp.net' ] to deeply equal [ '60111111111@s.whatsapp.net' ]`); the PN messages URL returns `[]`; `expected '60123456789@s.whatsapp.net' to be '123456789@lid'`; push title is `''`. ("…still reachable under its own URL" and the history `chats.upsert` test already pass after Task 5 and guard against regressions.)

- [ ] **Step 2: Implement ingest routing**

`packages/server/src/messages/service.ts`: add `import { getAliases } from '../chats/aliases.js';` and replace `ingest` with:

```ts
    async ingest(m, source) {
      if (repo.exists(m.id)) return null;
      const isGroup = m.chatJid.endsWith('@g.us');
      const aliases = getAliases(ctx);
      if (!isGroup && m.chatJidAlt) {
        // Persist the pair; routing never merges (a second chat waits for the next start).
        aliases.learn(
          { jid: m.chatJid, alias: m.chatJidAlt },
          source === 'history' ? 'history' : 'message',
        );
      }
      // One person, one chat: the existing chat of either address (the LID chat first).
      const chatJid = isGroup ? m.chatJid : aliases.route(m.chatJid);
      // Our own send may echo before the queue has committed its WhatsApp id and sender. The guard
      // is keyed by the chat the send came from: the routed chat, or a PN chat still kept separate.
      const guard = m.fromMe ? (inflight.get(chatJid) ?? inflight.get(m.chatJid)) : undefined;
      if (guard) {
        await guard;
        if (repo.exists(m.id)) return null;
      }
      const t = now();
      const chatBefore = chats.ensure(
        chatJid,
        { name: !isGroup && !m.fromMe ? m.senderName : null },
        t,
      );

      const row: MessageRow = {
        id: m.id,
        chat_jid: chatJid,
        sender_jid: m.senderJid,
        sender_name: m.senderName,
        from_me: m.fromMe ? 1 : 0,
        sent_by_user_id: null,
        type: m.type,
        body: m.body,
        media_path: null,
        media_mime: m.media?.mime ?? null,
        media_name: m.media?.fileName ?? null,
        media_status: m.media ? 'pending' : 'none',
        quoted_id: m.quotedId,
        status: m.fromMe ? 'sent' : 'delivered',
        error: null,
        timestamp: m.timestamp,
        created_at: t,
        client_id: null,
        wa_remote_jid: m.chatJid,
      };
      if (!repo.insert(row)) return null; // concurrent duplicate

      const isNewLiveInbound = source === 'live' && !m.fromMe;
      let reopened = false;
      ctx.db.transaction(() => {
        touchChat(row, t);
        if (isNewLiveInbound) {
          ctx.db
            .prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE jid = ?')
            .run(chatJid);
          const cur = chats.get(chatJid)!;
          if (cur.status === 'resolved') {
            chats.update(chatJid, { status: 'open', updated_at: t });
            reopened = true;
          }
        }
        if (!isGroup && !m.fromMe && m.senderName && isFallbackName(chatBefore.name, chatJid)) {
          chats.setName(chatJid, m.senderName, t);
        }
        if (m.senderJid && m.senderName && !m.fromMe) {
          chats.upsertContact({ jid: m.senderJid, pushName: m.senderName, savedName: null });
        }
      })();
      if (reopened) {
        const ev = chats.insertEvent({
          chatJid,
          type: 'reopened',
          actorId: null,
          payload: { reason: 'inbound' },
          at: t,
        });
        ctx.bus.emit('chat:event', ev);
      }

      if (source === 'live') {
        // AI Sales Agent trigger (#18): keyed by the routed chat, where its ai_chat_state lives.
        ctx.bus.emit('message:received', {
          chat: rowToChat(chats.get(chatJid)!),
          message: rowToMessage(row),
        });
      }

      // History media stays 'pending' (mime/name kept) and is fetched on demand (ensureMedia /
      // redownload): eagerly pulling every history file from the CDN floods the network and used
      // to crash the server on a single ECONNRESET. Live media downloads through the limiter.
      if (m.media && source === 'live') {
        const dl = m.media.download;
        try {
          const buf = await downloads.run(() => dl());
          const rel = media.save(chatJid, m.id, buf, extFor(m.media.mime, m.media.fileName));
          repo.update(m.id, { media_path: rel, media_status: 'ok' });
        } catch (err) {
          log.warn({ err, id: m.id }, 'media download failed');
          repo.update(m.id, { media_status: 'failed' });
        }
      }

      const final = repo.get(m.id);
      if (!final) return null;
      const msg = rowToMessage(final);
      ctx.bus.emit('message:new', msg);
      const chat = emitChat(chatJid);
      if (isNewLiveInbound && chat) ctx.bus.emit('inbound:notify', { chat, message: msg });
      return msg;
    },
```

- [ ] **Step 3: Routes, dev route, push title**

`packages/server/src/routes/chats.ts`, after `JidParams`:

```ts
/** Parses `:jid`; a phone number re-keyed to its WhatsApp ID opens that chat (old links, push). */
export function chatJidParam(ctx: AppContext, params: unknown): string {
  const { jid } = parse(JidParams, params);
  return getChats(ctx).resolveJid(jid);
}
```

Replace each `const { jid } = parse(JidParams, req.params);` with `const jid = chatJidParam(ctx, req.params);` in `routes/chats.ts` (4 handlers: lines 27, 71, 78, 84), `routes/messages.ts` (lines 23, 30, 37) and `routes/notes.ts` (lines 14, 20). In `messages.ts` and `notes.ts` change `import { JidParams } from './chats.js';` to `import { chatJidParam } from './chats.js';`.

`packages/server/src/routes/dev.ts`, replace the `/dev/fake-incoming` handler body:

```ts
  app.post('/dev/fake-incoming', { preHandler: requireUser(ctx) }, async (req) => {
    const body = parse(FakeIncomingBody, req.body ?? {});
    const waitIngest = Boolean(ctx.services.messages);
    let expectId: string | null = null;
    let ingestedChatJid: string | null = null;
    let onNew: ((m: Message) => void) | null = null;
    let done: () => void = () => undefined;
    const ingested = new Promise<void>((resolve) => {
      done = resolve;
    });
    let timer: NodeJS.Timeout | null = null;
    if (waitIngest) {
      timer = setTimeout(done, INGEST_WAIT_MS);
      onNew = (m: Message) => {
        // The bridge may emit synchronously inside simulateIncoming (before expectId is known), so also
        // match on content. A known phone number is stored in its WhatsApp ID chat.
        const routed = ctx.services.aliases?.route(body.chatJid) ?? body.chatJid;
        const match =
          expectId !== null
            ? m.id === expectId
            : (m.chatJid === routed || m.chatJid === body.chatJid) &&
              m.body === body.text &&
              !m.fromMe;
        if (match) {
          ingestedChatJid = m.chatJid;
          done();
        }
      };
      ctx.bus.on('message:new', onNew);
    } else {
      done();
    }
    try {
      const msg = wa.simulateIncoming({
        chatJid: body.chatJid,
        ...(body.chatJidAlt ? { chatJidAlt: body.chatJidAlt } : {}),
        body: body.text,
        senderName: body.senderName ?? null,
        type: body.type ?? 'text',
      });
      expectId = msg.id;
      await ingested;
      return { id: msg.id, chatJid: ingestedChatJid ?? msg.chatJid, timestamp: msg.timestamp };
    } finally {
      if (timer) clearTimeout(timer);
      if (onNew) ctx.bus.off('message:new', onNew);
    }
  });
```

(`ctx.services.aliases` is typed by the module augmentation in `chats/aliases.ts`, which is part of the program through `wa-bridge/index.ts`; no new import.)

`packages/server/src/i18n/messages.ts`: add `unknownContact` under `push` in each catalog — en: `unknownContact: 'Unknown contact',`; ms: `unknownContact: 'Kenalan tidak dikenali',`; zh-CN: `unknownContact: '未知联系人',`.

`packages/server/src/push/service.ts` line 218: `title: (chat.name || t(locale, 'push.unknownContact')).slice(0, 200),`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/server/src/wa-bridge/bridge.test.ts packages/server/test/chats.test.ts packages/server/test/admin.test.ts packages/server/src/push/service.test.ts packages/server/src/i18n packages/server/test/identity-startup.test.ts packages/server/test/messages.test.ts packages/server/test/contact-names.test.ts packages/server/test/ai.test.ts`
Expected: PASS (`ai.test.ts` proves the AI still triggers on `message:received` and its echo/ownership checks hold; `identity-startup.test.ts` now passes completely).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/messages/service.ts packages/server/src/routes/chats.ts packages/server/src/routes/messages.ts packages/server/src/routes/notes.ts packages/server/src/routes/dev.ts packages/server/src/push/service.ts packages/server/src/push/service.test.ts packages/server/src/i18n/messages.ts packages/server/src/wa-bridge/bridge.test.ts packages/server/test/chats.test.ts packages/server/test/admin.test.ts
git commit -m "feat(server): route phone-number and WhatsApp ID messages and URLs to one chat without merging"
```

---

## Task 7: Replies to the last inbound address, grouped read receipts, presence (human and AI)

**Files:**
- Modify: `packages/server/src/messages/send-queue.ts` (`SendJob.targetJid`, `presence(job)`)
- Modify: `packages/server/src/messages/repo.ts` (`lastInboundRemoteJid`)
- Modify: `packages/server/src/messages/service.ts` (`sendJob`, queue `presence`, `jobFromRow`, `replyTarget`, `sendText`, `sendMedia`)
- Modify: `packages/server/src/chats/service.ts` (`markRead` grouped by `wa_remote_jid`)
- Test: `packages/server/src/messages/send-queue.test.ts`, `packages/server/test/messages.test.ts`, `packages/server/test/ai.test.ts`, `packages/server/test/identity-startup.test.ts`

**Interfaces:**
- Consumes: `MessageRow.wa_remote_jid` (Task 1), `getAliases(ctx).resolve/route` (Task 3), startup migration (Task 5), ingest routing (Task 6).
- Produces:
  - `SendJob.targetJid: string` (JID passed to `wa.sendText/sendMedia/sendPresence`; `chatJid` stays the queue key and the chat passed to `ai.canSend`)
  - `SendQueueDeps.presence?: (job: SendJob) => Promise<void>`
  - `MessageRepo.lastInboundRemoteJid(chatJid: string): string | null`
  - Reply target: the last inbound `wa_remote_jid` of the chat, unless that address now belongs to another person (a recycled number), then the chat's own JID; stored on the `local-%` row, so restored jobs keep it. AI Sales Agent replies (via `sendText`) follow the same rule.

- [ ] **Step 1: Write the failing send-queue test**

In `packages/server/src/messages/send-queue.test.ts`:
- `job()` becomes `return { localId, chatJid, targetJid: chatJid, createdAt, kind: 'text', text: localId };`
- in `makeQueue`, the `sent` array type becomes `Array<{ id: string; at: number; target: string; chat: string }>`, the push becomes `sent.push({ id: j.localId, at: now(), target: j.targetJid, chat: j.chatJid });`, and `presence: async (j) => { presence.push(j.targetJid); },`.

Append inside `describe('SendQueue', …)`:

```ts
  it('sends to the job target with composing presence on it; the chat stays the queue key', async () => {
    const { q, sent, presence } = makeQueue();
    q.enqueue({ ...job('a1', 'LID', Date.now()), targetJid: 'PN' });
    await flush();
    expect(sent).toEqual([expect.objectContaining({ id: 'a1', target: 'PN', chat: 'LID' })]);
    expect(presence).toEqual(['PN']);
    q.stop();
  });
```

Run: `npx vitest run packages/server/src/messages/send-queue.test.ts`
Expected: FAIL — TypeScript error `targetJid does not exist in type SendJob`.

- [ ] **Step 2: Implement the queue changes**

`packages/server/src/messages/send-queue.ts`:
- in `SendJob` after `chatJid: string;`:

```ts
  /** JID WhatsApp sends to (the customer's last inbound address); `chatJid` is the queue key */
  targetJid: string;
```

- `SendQueueDeps.presence?: (job: SendJob) => Promise<void>;`
- in `run()` replace `if (this.deps.presence) await this.deps.presence(chatJid).catch(() => undefined);` with `if (this.deps.presence) await this.deps.presence(job).catch(() => undefined);`

Run: `npx vitest run packages/server/src/messages/send-queue.test.ts` → PASS.

- [ ] **Step 3: Write the failing service tests**

Append to `packages/server/test/messages.test.ts` (add `import { createMessageService } from '../src/messages/service.js';`):

```ts
describe('replies and receipts for one person with two addresses', () => {
  const PN = '60111111111@s.whatsapp.net';
  const LID = '123456789@lid';
  const inbound = (id: string, chatJid: string, ts: number, chatJidAlt: string | null = null) =>
    getMessages(t.ctx).ingest(
      {
        id,
        chatJid,
        chatJidAlt,
        senderJid: chatJid,
        senderName: 'Aisyah',
        fromMe: false,
        type: 'text',
        body: id,
        quotedId: null,
        timestamp: ts,
        media: null,
      },
      'live',
    );

  it('replies go to the address of the last inbound message and composing uses it too', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    getMessages(t.ctx).sendText(LID, { clientId: 'reply-1', text: 'hello' }, user.id);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(PN);
    expect(t.wa.presences.some((p) => p.chatJid === PN && p.presence === 'composing')).toBe(true);
    expect(
      t.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE client_id = 'reply-1'").get(),
    ).toEqual({ chat_jid: LID, wa_remote_jid: PN });
  });

  it('never replies to a phone number that has since moved to another WhatsApp ID', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: '987654321@lid' }]); // number recycled
    getMessages(t.ctx).sendText(LID, { clientId: 'moved-1', text: 'hello' }, user.id);
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(LID);
  });

  it('read receipts are sent per WhatsApp address', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    const r = await t.app.inject({
      method: 'POST',
      url: `/api/chats/${enc(LID)}/read`,
      headers: authHeaders(cookie),
    });
    expect(r.statusCode).toBe(200);
    expect(t.wa.reads).toEqual([
      { chatJid: LID, messageIds: ['L-1'] },
      { chatJid: PN, messageIds: ['P-2'] },
    ]);
  });

  it('the echo of our own send to the PN is stored once, in the LID chat', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    getMessages(t.ctx).sendText(LID, { clientId: 'echo-1', text: 'echo me' }, user.id);
    await waitFor(() => t.wa.sent.length === 1);
    const waId = t.wa.sent[0]!.id;
    t.wa.simulateIncoming({ id: waId, chatJid: PN, fromMe: true, body: 'echo me' });
    await settle();
    expect(t.ctx.db.prepare('SELECT chat_jid FROM messages WHERE id = ?').all(waId)).toEqual([
      { chat_jid: LID },
    ]);
  });

  it('restored pending sends after a restart still go to their stored target', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('L-1', LID, 1000, PN);
    await inbound('P-2', PN, 2000);
    t.wa.setConnected(false);
    getMessages(t.ctx).sendText(LID, { clientId: 'restart-1', text: 'after restart' }, user.id);
    getMessages(t.ctx).shutdown();
    const restarted = createMessageService(t.ctx);
    t.wa.setConnected(true);
    restarted.queue.onConnected();
    await waitFor(() => t.wa.sent.length === 1);
    expect(t.wa.sent[0]!.chatJid).toBe(PN);
    restarted.shutdown();
  });
});
```

Append to `packages/server/test/identity-startup.test.ts` (inside `describe('startup identity migration', …)`; add `const waitFor = async (fn: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };` after the `merges` helper):

```ts
  it('a send pending in the phone-number chat before the update is sent once, to the phone number, from the merged chat', async () => {
    const queuedAt = Date.now();
    seed(`${TWO_CHATS}
      INSERT INTO messages (id, chat_jid, from_me, type, body, status, timestamp, created_at, client_id, wa_remote_jid)
        VALUES ('local-q1', '${PN}', 1, 'text', 'queued before the update', 'pending', ${queuedAt}, ${queuedAt}, 'q1', '${PN}');`);
    lidMapping('60111111111', '123456789');
    const app = await start();
    await waitFor(() => app.wa.sent.length === 1);
    expect(app.wa.sent.map((s) => s.chatJid)).toEqual([PN]);
    expect(
      app.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE client_id = 'q1'").get(),
    ).toEqual({ chat_jid: LID, wa_remote_jid: PN });
    await new Promise((r) => setTimeout(r, 50));
    expect(app.wa.sent).toHaveLength(1);
  });
```

Append to `packages/server/test/ai.test.ts`:

```ts
it('replies to the address the customer last wrote from when one person has a phone number and a WhatsApp ID', async () => {
  clock();
  const PN = '60111111111@s.whatsapp.net';
  const LID = '123456789@lid';
  await incoming('l-1', 'Hello', 'history', LID);
  getChats(t.ctx).upsertContactAliases([{ jid: PN, alias: LID }]);
  await incoming('p-1', 'What are your opening hours?', 'live', PN);
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 2000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.wa.sent.map((s) => s.chatJid)).toEqual([PN]);
  const ai = t.ctx.services.ai!.status().member!;
  expect(getChats(t.ctx).get(LID)?.assignedTo).toBe(ai.id);
  expect(
    t.ctx.db.prepare('SELECT chat_jid, wa_remote_jid FROM messages WHERE sent_by_user_id = ?').all(ai.id),
  ).toEqual([{ chat_jid: LID, wa_remote_jid: PN }]);
});
```

Run: `npx vitest run packages/server/test/messages.test.ts packages/server/test/identity-startup.test.ts packages/server/test/ai.test.ts`
Expected: FAIL — `expected '123456789@lid' to be '60111111111@s.whatsapp.net'` (replies go to the chat JID), receipts arrive as one LID group with both ids, the startup pending send goes to the LID.

- [ ] **Step 4: Implement service changes**

`packages/server/src/messages/repo.ts`, add to `MessageRepo`:

```ts
  /** The JID WhatsApp used for the newest inbound message of a chat (where replies should go). */
  lastInboundRemoteJid(chatJid: string): string | null {
    const r = this.db
      .prepare(
        `SELECT wa_remote_jid FROM messages WHERE chat_jid = ? AND from_me = 0 AND wa_remote_jid IS NOT NULL
         ORDER BY timestamp DESC, id DESC LIMIT 1`,
      )
      .get(chatJid) as { wa_remote_jid: string } | undefined;
    return r?.wa_remote_jid ?? null;
  }
```

`packages/server/src/messages/service.ts` (the `getAliases` import exists since Task 6):
- in `sendJob`: keep the AI check `ctx.services.ai?.canSend(job.chatJid, …)` and the `inflight`/`reconciliations` guard keyed by `job.chatJid` unchanged; use `job.targetJid` as the first argument of `ctx.wa.sendText(…)` and `ctx.wa.sendMedia(…)`.
- queue construction: `presence: (job) => ctx.wa.sendPresence(job.targetJid, 'composing'),`
- `jobFromRow`'s `base` adds `targetJid: r.wa_remote_jid ?? r.chat_jid,` after `chatJid: r.chat_jid,`.
- after `jobFromRow` add:

```ts
  /**
   * Where a reply goes: the address of the customer's last inbound message (PN or LID, as WhatsApp
   * delivered it), unless that address now belongs to someone else (a recycled number) → the chat JID.
   */
  const replyTarget = (chatJid: string): string => {
    const last = repo.lastInboundRemoteJid(chatJid);
    if (!last || last === chatJid) return chatJid;
    const aliases = getAliases(ctx);
    return aliases.resolve(last) === chatJid || aliases.route(last) === chatJid ? last : chatJid;
  };
```

- `sendText` and `sendMedia` rows: `wa_remote_jid: replyTarget(jid),` (replacing the Task 1 `wa_remote_jid: jid,`). The retry path renames/updates the existing row and keeps its stored `wa_remote_jid`.

`packages/server/src/chats/service.ts`, replace `markRead`:

```ts
    async markRead(jid, _userId) {
      const cur = repo.get(jid);
      if (!cur) throw errors.notFound('Chat');
      const rows = ctx.db
        .prepare(
          `SELECT id, COALESCE(wa_remote_jid, chat_jid) AS remote FROM messages
           WHERE chat_jid = ? AND from_me = 0 ORDER BY timestamp DESC, id DESC LIMIT 20`,
        )
        .all(jid) as Array<{ id: string; remote: string }>;
      if (cur.unread_count !== 0) {
        repo.update(jid, { unread_count: 0, updated_at: now() });
        emitChat(jid);
      }
      if (rows.length && ctx.wa.status.state === 'open') {
        // Receipt keys carry remoteJid = the address WhatsApp used; never mix PN and LID ids.
        const byRemote = new Map<string, string[]>();
        for (const r of rows.reverse()) {
          const ids = byRemote.get(r.remote) ?? [];
          ids.push(r.id);
          byRemote.set(r.remote, ids);
        }
        for (const [remote, ids] of byRemote) {
          try {
            await ctx.wa.markRead(remote, ids);
          } catch (err) {
            ctx.log.debug({ err, jid: remote }, 'wa markRead failed (ignored)');
          }
        }
      }
    },
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/server/src/messages/send-queue.test.ts packages/server/test/messages.test.ts packages/server/test/identity-startup.test.ts packages/server/test/ai.test.ts packages/server/test/chats.test.ts packages/server/src/wa-bridge/bridge.test.ts`
Expected: PASS (including every pre-existing AI ownership, echo and cancellation test).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/messages/send-queue.ts packages/server/src/messages/send-queue.test.ts packages/server/src/messages/repo.ts packages/server/src/messages/service.ts packages/server/src/chats/service.ts packages/server/test/messages.test.ts packages/server/test/identity-startup.test.ts packages/server/test/ai.test.ts
git commit -m "feat(server): reply to the customer's last address and send read receipts per address"
```

---

## Task 8: Web — real phone or "Phone number hidden", never LID digits, old links redirect (EN/MS/zh-CN)

**Files:**
- Modify: `apps/web/src/lib/jid.ts` (`formatJid` blanks `@lid`; `formatPhone`)
- Create: `apps/web/src/lib/jid.test.ts`
- Create: `apps/web/src/inbox/chat-title.ts`
- Modify: `apps/web/src/inbox/ChatListItem.tsx:8,31-35`
- Modify: `apps/web/src/inbox/ConversationHeader.tsx:13,44-45,85-88`
- Create: `apps/web/src/inbox/ChatListItem.test.tsx`, `apps/web/src/inbox/ConversationHeader.test.tsx`
- Create: `apps/web/src/inbox/useCanonicalChatRedirect.ts`
- Modify: `apps/web/src/inbox/InboxPage.tsx`, `apps/web/src/inbox/InboxPage.test.tsx`
- Modify: `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json`, `apps/web/src/i18n/locales/{en,ms,zh-CN}/admin.json`
- Modify: `apps/web/src/admin/audit-actions.ts`; Create: `apps/web/src/admin/audit-actions.test.ts`

**Interfaces:**
- Consumes: `Chat.phone` (Task 1); detail responses carry the routed `chat.jid` (Task 6).
- Produces: `export function formatPhone(chat: Pick<Chat, 'phone'>): string | null`; `export function chatTitle(chat: Pick<Chat, 'name' | 'phone' | 'type'>, t: TFunction<'inbox'>): string`; `export function useCanonicalChatRedirect(jid: string | null): void`; i18n keys `inbox:chatListItem.unknownContact`, `inbox:header.phoneHidden`, `admin:audit.actions.chatMerge`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/jid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatJid, formatPhone } from './jid';

describe('jid formatting', () => {
  it('prints phone-number JIDs as +digits and never prints WhatsApp ID (LID) digits', () => {
    expect(formatJid('60123456789@s.whatsapp.net')).toBe('+60123456789');
    expect(formatJid('60123456789:3@s.whatsapp.net')).toBe('+60123456789');
    expect(formatJid('123456789012345@lid')).toBe('');
    expect(formatJid('123456789012345:7@lid')).toBe('');
  });

  it('formatPhone uses the chat phone or null', () => {
    expect(formatPhone({ phone: '60123456789' })).toBe('+60123456789');
    expect(formatPhone({ phone: null })).toBeNull();
  });
});
```

`apps/web/src/inbox/ConversationHeader.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Chat } from '@wa-team-inbox/shared';
import { ConversationHeader } from './ConversationHeader';
import { buildDirectory } from './useDirectory';

const base: Chat = {
  jid: '123456789012345@lid',
  type: 'dm',
  name: '',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: null,
  lastMessagePreview: null,
  status: 'open',
  assignedTo: null,
  updatedAt: 0,
  phone: null,
};

function renderHeader(chat: Chat) {
  return render(
    <ConversationHeader
      chat={chat}
      directory={buildDirectory(null, false, [])}
      onBack={vi.fn()}
      onAssign={vi.fn()}
      onToggleStatus={vi.fn()}
      notesOpen={false}
      notesCount={0}
      onToggleNotes={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe('ConversationHeader identity', () => {
  it('shows "Unknown contact" and "Phone number hidden" for a WhatsApp ID chat, never its digits', () => {
    const view = renderHeader(base);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Unknown contact');
    expect(screen.getByText('Phone number hidden')).toBeTruthy();
    expect(view.container.textContent).not.toContain('123456789012345');
  });

  it('shows the real phone number once WhatsApp has revealed it', () => {
    renderHeader({ ...base, name: 'Aisyah', phone: '60123456789' });
    expect(screen.getByText('+60123456789')).toBeTruthy();
    expect(screen.queryByText('Phone number hidden')).toBeNull();
  });

  it('uses +phone as the title when the chat has no name', () => {
    renderHeader({
      ...base,
      jid: '60123456789@s.whatsapp.net',
      name: '60123456789',
      phone: '60123456789',
    });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('+60123456789');
  });
});
```

`apps/web/src/inbox/ChatListItem.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Chat } from '@wa-team-inbox/shared';
import { ChatListItem } from './ChatListItem';

const lidChat: Chat = {
  jid: '123456789012345@lid',
  type: 'dm',
  name: '',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: null,
  lastMessagePreview: 'hello',
  status: 'open',
  assignedTo: null,
  updatedAt: 0,
  phone: null,
};

afterEach(cleanup);

describe('ChatListItem identity', () => {
  it('never shows WhatsApp ID digits as the chat name', () => {
    const view = render(
      <MemoryRouter>
        <ChatListItem chat={lidChat} active={false} assigneeName={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Unknown contact')).toBeTruthy();
    expect(view.container.textContent).not.toContain('123456789012345');
  });

  it('uses +phone when the chat has no name', () => {
    render(
      <MemoryRouter>
        <ChatListItem chat={{ ...lidChat, phone: '60123456789' }} active={false} assigneeName={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('+60123456789')).toBeTruthy();
  });
});
```

`apps/web/src/admin/audit-actions.test.ts`:

```ts
import { expect, it } from 'vitest';
import { i18n } from '../i18n';
import { auditActionLabel } from './audit-actions';

it('labels startup chat merges in the audit log', () => {
  expect(auditActionLabel('chat.merge', i18n.getFixedT('en', 'admin'))).toBe('Chats merged');
});
```

Append inside `describe('InboxPage', …)` in `apps/web/src/inbox/InboxPage.test.tsx`:

```tsx
  it('follows an old phone-number link to the WhatsApp ID chat', async () => {
    const lid = '123456789012345@lid';
    const merged: Chat = { ...chat, jid: lid };
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        if ((init?.method ?? 'GET') !== 'GET') return json({ ok: true });
        if (url === '/api/me') return json(me);
        if (url === '/api/wa/status') return json({ state: 'open', me: null, qr: null, lastError: null });
        if (url.startsWith('/api/chats?')) return json({ chats: [merged], nextCursor: null });
        if (url === `/api/chats/${encodeURIComponent(jid)}` || url === `/api/chats/${encodeURIComponent(lid)}`)
          return json({ chat: merged, events: [] });
        if (url.startsWith(`/api/chats/${encodeURIComponent(lid)}/messages`))
          return json({ messages: messages.map((m) => ({ ...m, chatJid: lid })), nextBefore: null });
        if (url.startsWith(`/api/chats/${encodeURIComponent(jid)}/messages`))
          return json({ messages: [], nextBefore: null });
        if (url.endsWith('/notes')) return json([]);
        if (url === '/api/quick-replies') return json([]);
        return json({ error: { code: 'not_found', message: 'nope' } }, 404);
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/chats/${encodeURIComponent(jid)}`]}>
          <Routes>
            <Route path="/chats/:jid" element={<InboxPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // The PN conversation unmounts on redirect, so query the document, not its message log.
    expect(await screen.findByText('Hello')).toBeTruthy();
    expect(urls.some((u) => u.startsWith(`/api/chats/${encodeURIComponent(lid)}/messages`))).toBe(true);
  });
```

Run: `npx vitest run apps/web/src/lib/jid.test.ts apps/web/src/inbox/ConversationHeader.test.tsx apps/web/src/inbox/ChatListItem.test.tsx apps/web/src/admin/audit-actions.test.ts apps/web/src/inbox/InboxPage.test.tsx`
Expected: FAIL — `formatPhone is not a function`, heading `123456789012345`, `expected 'chat.merge' to be 'Chats merged'`, InboxPage never requests the LID messages.

- [ ] **Step 2: Implement helpers, components, redirect and catalogs**

`apps/web/src/lib/jid.ts`: add `import type { Chat } from '@wa-team-inbox/shared';` at the top; in `formatJid` add as the second line `if (jid.endsWith('@lid')) return ''; // opaque WhatsApp ID: never shown as a number`; and add:

```ts
/** `+<digits>` when WhatsApp has told us the chat's phone number, else null (WhatsApp ID only). */
export function formatPhone(chat: Pick<Chat, 'phone'>): string | null {
  return chat.phone ? `+${chat.phone}` : null;
}
```

`apps/web/src/inbox/chat-title.ts`:

```ts
import type { TFunction } from 'i18next';
import type { Chat } from '@wa-team-inbox/shared';
import { formatPhone } from '../lib/jid';

/** Chat title: its name, else +phone, else a translated placeholder. Never WhatsApp ID digits. */
export function chatTitle(chat: Pick<Chat, 'name' | 'phone' | 'type'>, t: TFunction<'inbox'>): string {
  if (chat.name && chat.name !== chat.phone) return chat.name;
  return (
    formatPhone(chat) ??
    (chat.type === 'group' ? t('chatListItem.group') : t('chatListItem.unknownContact'))
  );
}
```

`apps/web/src/inbox/ChatListItem.tsx`: change the jid import to `import { encodeJid } from '../lib/jid';`, add `import { chatTitle } from './chat-title';`, and replace lines 31-35 with:

```tsx
  // Subscribes to language changes so the localized list time re-renders.
  const { t } = useTranslation('inbox');
  const name = chatTitle(chat, t);
  const unread = chat.unreadCount > 0;
  const { pathname } = useLocation();
```

`apps/web/src/inbox/ConversationHeader.tsx`: change the jid import to `import { formatPhone } from '../lib/jid';`, add `import { chatTitle } from './chat-title';`, replace lines 44-45 with:

```tsx
  const name = chatTitle(chat, t);
  const subtitle =
    chat.type === 'group'
      ? t('chatListItem.group')
      : (formatPhone(chat) ?? t('header.phoneHidden'));
```

and the subtitle paragraph body `{phone}` with `{subtitle}`.

`apps/web/src/inbox/useCanonicalChatRedirect.ts`:

```ts
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChat } from '../api/queries';
import { encodeJid } from '../lib/jid';

/** Old links and push notifications: follow the chat JID the server answered with. */
export function useCanonicalChatRedirect(jid: string | null): void {
  const chat = useChat(jid);
  const navigate = useNavigate();
  const location = useLocation();
  const canonical = chat.data?.chat.jid;
  useEffect(() => {
    if (jid && canonical && canonical !== jid) {
      navigate(`/chats/${encodeJid(canonical)}`, { replace: true, state: location.state });
    }
  }, [jid, canonical, navigate, location.state]);
}
```

`apps/web/src/inbox/InboxPage.tsx`: add `import { useCanonicalChatRedirect } from './useCanonicalChatRedirect';` and after `const version = useAppVersion();` add `useCanonicalChatRedirect(jid);`.

Catalogs (keep JSON key order; add the lines shown):
- `en/inbox.json`: in `chatListItem` after `"group": "Group",` add `"unknownContact": "Unknown contact",`; in `header` after `"back": "Back to chats",` add `"phoneHidden": "Phone number hidden",`.
- `ms/inbox.json`: `"unknownContact": "Kenalan tidak dikenali",` and `"phoneHidden": "Nombor telefon disembunyikan",`.
- `zh-CN/inbox.json`: `"unknownContact": "未知联系人",` and `"phoneHidden": "电话号码已隐藏",`.
- `en/admin.json` `audit.actions`: after `"chatsResolveAll": …,` add `"chatMerge": "Chats merged",`; `ms`: `"chatMerge": "Sembang digabungkan",`; `zh-CN`: `"chatMerge": "已合并聊天",`.

`apps/web/src/admin/audit-actions.ts`: after `'chats.resolve_all': 'audit.actions.chatsResolveAll',` add `'chat.merge': 'audit.actions.chatMerge',`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run apps/web/src/lib/jid.test.ts apps/web/src/inbox/ConversationHeader.test.tsx apps/web/src/inbox/ChatListItem.test.tsx apps/web/src/admin/audit-actions.test.ts apps/web/src/i18n apps/web/src/inbox/ChatList.test.tsx apps/web/src/inbox/InboxPage.test.tsx`
Expected: PASS (catalog test confirms all three locales have the new keys).

- [ ] **Step 4: Typecheck and lint the web workspace**

Run: `npm run typecheck -w @wa-team-inbox/web && npx eslint apps/web/src/lib/jid.ts apps/web/src/inbox/chat-title.ts apps/web/src/inbox/ChatListItem.tsx apps/web/src/inbox/ConversationHeader.tsx apps/web/src/inbox/useCanonicalChatRedirect.ts apps/web/src/inbox/InboxPage.tsx apps/web/src/admin/audit-actions.ts`
Expected: no errors (no literal strings, token classes only).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/jid.ts apps/web/src/lib/jid.test.ts apps/web/src/inbox/chat-title.ts apps/web/src/inbox/ChatListItem.tsx apps/web/src/inbox/ChatListItem.test.tsx apps/web/src/inbox/ConversationHeader.tsx apps/web/src/inbox/ConversationHeader.test.tsx apps/web/src/inbox/useCanonicalChatRedirect.ts apps/web/src/inbox/InboxPage.tsx apps/web/src/inbox/InboxPage.test.tsx apps/web/src/i18n/locales/en/inbox.json apps/web/src/i18n/locales/ms/inbox.json apps/web/src/i18n/locales/zh-CN/inbox.json apps/web/src/i18n/locales/en/admin.json apps/web/src/i18n/locales/ms/admin.json apps/web/src/i18n/locales/zh-CN/admin.json apps/web/src/admin/audit-actions.ts apps/web/src/admin/audit-actions.test.ts
git commit -m "feat(web): show the real phone number or 'Phone number hidden' and follow old phone-number links"
```

---

## Task 9: Documentation and consolidated verification

Run the verification steps once, alone on the machine (no other agents running tests). Only the orchestrator runs this task.

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `docs/LEARNINGS.md` (append; keep the existing 2026-10-05 planning entries, including "reshape existing data once at startup…")
- Modify: `AGENTS.md` (Architecture → WhatsApp boundary)

- [ ] **Step 1: CHANGELOG**

In `CHANGELOG.md`, under `## [Unreleased]` (currently empty — `## [0.1.20]` with the AI Sales Agent follows it), add:

```markdown
### Fixed

- Chats for the same person under phone number and WhatsApp ID are merged: one inbox row per
  customer, with all messages, notes, history, unread counts and AI Sales Agent state together.
  Existing duplicates are merged when the server starts after the update (a backup named
  `app-premerge-YYYYMMDD.db` is written first and kept 30 days); new messages then go to the right
  chat automatically. Replies, including the AI Sales Agent's, go to the address the customer last
  used. When WhatsApp has not revealed a customer's number, the chat shows "Phone number hidden"
  instead of an internal ID. Old links and notifications open the merged chat.
```

- [ ] **Step 2: LEARNINGS**

Append under the most fitting section of `docs/LEARNINGS.md`:

```markdown
- 2026-10-05 — One customer showed as two inbox rows (phone-number JID and LID) → `chats.jid` was the raw `remoteJid` and PN↔LID pairs were only used for names → key chats by the LID once known, persist pairs in `jid_aliases`, merge existing duplicates only in the startup identity migration (before queue restore, AI, HTTP and WhatsApp), and make runtime code route only.
- 2026-10-05 — Baileys' LID mappings are needed before the socket opens → `useMultiFileAuthState` stores them as plain JSON files (`wa-auth/lid-mapping-<pn>.json` = `"<lid>"`, `…-<lid>_reverse.json` = `"<pn>"`) → read them with `node:fs` (`readStoredLidMappings`) instead of starting Baileys; trust the forward file over a stale reverse file.
- 2026-10-05 — `ai_chat_state` cascades away with a deleted chat row → anything that re-keys or deletes a chat must move every `chat_jid`-keyed table (check `REFERENCES chats` / `ON DELETE CASCADE` in all migrations) inside the same transaction.
```

- [ ] **Step 3: AGENTS.md**

In `AGENTS.md`, at the end of the **WhatsApp boundary** paragraph add:

```markdown
One person can arrive under a phone-number JID and a LID: chats are keyed by the LID once known
(`chats/aliases.ts`, table `jid_aliases`). Existing duplicates are merged only by the startup identity
migration (`chats/identity-migration.ts`, run by `initMessaging` before the message service, AI, HTTP
and `wa.connect()`; pairs read offline by `readStoredLidMappings`; pre-merge backup first). Runtime code
never merges: `AliasStore.route` picks the existing chat of either JID, routes resolve `:jid` through
`chatJidParam`, and replies go to the `wa_remote_jid` of the last inbound message. Never merge on a
name or number match.
```

- [ ] **Step 4: Commit the docs**

```bash
git add CHANGELOG.md docs/LEARNINGS.md AGENTS.md
git commit -m "docs: changelog, learnings and architecture note for merged phone-number/LID chats"
```

- [ ] **Step 5: Typecheck, unit suite, lint, web build**

Run: `npm run typecheck` → no errors.
Run: `npm test` → all projects PASS. If native PowerShell tests time out under load, rerun only those files with one worker (see LEARNINGS) before changing anything.
Run: `npm run lint` → no errors.
Run: `npm run build -w @wa-team-inbox/web` → succeeds.

- [ ] **Step 6: e2e (once)**

Run: `npm run e2e` → PASS. Then `node e2e/screens.smoke.mjs <url> <outDir>` and `SMOKE_LOCALE=ms node e2e/screens.smoke.mjs <url> <outDir>` against a `--fake-wa` server on a temp data dir; review the conversation header at 360px in Malay ("Nombor telefon disembunyikan" must not overflow).

- [ ] **Step 7: Fake-WA startup check (agent may do this; temp data dir only)**

```bash
npx tsx packages/server/src/cli.ts --data <scratchpad>/lidpn --port 7433 --fake-wa --mode dev --web-dist apps/web/dist
```

Sign in, `POST /api/dev/fake-incoming` with `{ "chatJid": "60111111111@s.whatsapp.net", "text": "one" }` and `{ "chatJid": "123456789@lid", "text": "two" }` (two chats). Stop the server, write `<scratchpad>/lidpn/wa-auth/lid-mapping-60111111111.json` = `"123456789"`, start it again. Expect one chat whose header shows `+60111111111`, `backups/app-premerge-*.db`, and `"chats merged"` then `"identity migration completed"` (`mod:"contacts"`) in `<data>/logs/*.log`, logged before `"server listening"`. Open `/chats/60111111111%40s.whatsapp.net` and confirm it redirects to the LID URL. Start a third time: the log says `"identity migration: nothing to merge"` and no new pre-merge backup appears.

- [ ] **Step 8: Owner-only real-WhatsApp smoke (spec §16; on a linked TEST number, never the live number; agents must not send messages)**

Checklist for the owner, recording results in the PR:
1. Before upgrading, count `wa-auth/lid-mapping-*.json` files and DM chats; after the first start, `backups/app-premerge-YYYYMMDD.db` exists, the log shows `storedPairs`/`merged` counts before `server listening`, and the inbox has one row per person.
2. Restart: `identity migration: nothing to merge`, no new backup.
3. A live message from a customer whose chat was PN-keyed arrives with `remoteJidAlt` (check `wa_remote_jid` and `jid_aliases.source = 'message'`) and lands in the LID chat.
4. History sync after relink: no PN rows reappear.
5. Reply in a merged chat: the customer receives it (target = last inbound `wa_remote_jid`, LID and PN both tried across two customers); our own echo is not duplicated.
6. Read receipts: blue ticks appear for messages that arrived under the LID and under the PN.
7. Push notification from before the upgrade (PN URL) opens the merged chat.
8. With the AI Sales Agent enabled on the test install, a second test phone writes to the linked number; the AI answers once, to the address that phone used, and `ai_chat_state` has a single row for the LID chat.

- [ ] **Step 9: Report**

State in the PR description: test/typecheck/lint/build/e2e results, and either the owner's smoke results or "Baileys changes untested against real WhatsApp".
