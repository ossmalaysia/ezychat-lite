# Merge LID / Phone-Number Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One inbox row per WhatsApp person: messages addressed by phone-number JID (PN, `<digits>@s.whatsapp.net`) and by WhatsApp ID (LID, `<digits>@lid`) land in a single chat; existing duplicates are merged once (after a pre-merge backup); the UI shows the real phone number or "Phone number hidden", never LID digits; old links and notifications keep working.

**Architecture:** `chats.jid` stays the primary key. A new `jid_aliases` table (migration 004) maps every PN whose LID is known to the LID chat; an in-memory `AliasStore` resolves JIDs at ingest, routes and `chats.upsert`. An `IdentityService` learns explicit WhatsApp pairs, takes a one-time pre-merge backup, and calls `mergeChat` (one synchronous SQLite transaction per pair), then publishes `chat:merged` so the send queue re-keys, the AI Sales Agent follows the chat, and browsers redirect. Replies (human and AI) go to the `wa_remote_jid` of the last inbound message. `mergeChat` also moves the AI Sales Agent's per-chat state (`ai_chat_state`, which would otherwise cascade away with the PN row).

**Tech Stack:** Node 22+, TypeScript strict ESM, better-sqlite3, Fastify, Socket.IO, zod (`packages/shared`), Baileys 7.0.0-rc14 (`packages/wa/src/baileys/**` only), React 19 + TanStack Query + react-i18next (`apps/web`), Vitest.

**Spec:** docs/superpowers/specs/2026-10-05-merge-lid-pn-chats-design.md

## Global Constraints

- Node 22+, TypeScript strict, ESM (`.js` suffixes in relative imports).
- zod schema first: change `packages/shared` before server and web use a new field or event.
- Only `packages/wa/src/baileys/**` imports `baileys`; the server never imports from `packages/wa/src/baileys` directly.
- Never use the real app data folder (`%APPDATA%\WA Team Inbox\data`, `C:\ProgramData\…`); tests use temp dirs (`makeTestApp`, `mkdtempSync`).
- Never send WhatsApp messages from a real linked number; the real-WhatsApp smoke (Task 12) is done by the owner on a test number.
- Run tests with `npx vitest run <paths>` (only the files you touched) plus `npm run typecheck -w @wa-team-inbox/<pkg>` for the package you touched.
- No e2e and no full suite inside a task; Task 12 is the single consolidated verification.
- Migration file is `004_jid_aliases.sql` (`002_user_locale.sql` and `003_ai_member.sql` already exist); `PRAGMA user_version` becomes 4.
- AI Sales Agent (#18): `ai_chat_state(chat_jid PK REFERENCES chats(jid) ON DELETE CASCADE)` holds per-chat AI state; AI replies go through `MessageService.sendText` and the send queue (`sendJob` calls `ai.canSend(job.chatJid, …)`); the AI member is a `users` row with `kind = 'ai'`. Every merge/send/ingest change must keep these working: move `ai_chat_state` before deleting a chat row, keep `job.chatJid` the canonical chat (queue key) and put the WhatsApp address in `job.targetJid`, and keep the live `message:received` bus event (the AI's trigger) in `ingest`, keyed by the canonical chat.
- `VACUUM INTO` (backups) cannot run inside a SQLite transaction: alias learning that can trigger a merge must run outside `db.transaction`.
- Web UI: shadcn primitives and token classes only (no raw `<button>`, no palette/hex colours), every screen works at 360px, routes stay inside the existing `ErrorBoundary`.
- Every user-visible string goes through i18n with EN, MS and zh-CN in the same commit (`apps/web/src/i18n/locales/*/*.json`, `packages/server/src/i18n/messages.ts`); the catalog tests enforce parity.
- Changes under `packages/wa/src/baileys/**` must be reported as "untested against real WhatsApp" until the owner's smoke test.
- Conventional Commits; stage explicit paths only (never `git add -A`; leave plugin-injected `CLAUDE.md` changes out).
- Add the user-visible change to `CHANGELOG.md` under `[Unreleased]` and a dated entry to `docs/LEARNINGS.md` (Task 11).
- Merges never come from a name or number match: only explicit WhatsApp PN↔LID pairs.
- No feature flag. The pre-merge backup is the restore point and is kept 30 days.
- Out of scope: the owner-only-reply composer lock (separate follow-up feature).

## Review Focus

The six failure modes most likely to hurt users, each with an owning test:

1. **The same customer is open in two browser tabs during a merge.** One tab shows the PN chat and keeps replying to `/api/chats/<pn>/…`. Covered by Task 8 (`chats.test.ts` "old phone-number URLs resolve…": POSTing a message or note to the PN URL lands in the LID chat) and Task 10 (`socket.test.tsx` + `InboxPage.test.tsx`: `chat:merged` points the open detail at the LID and the page redirects).
2. **A send is queued in the PN chat when the merge happens.** It must neither be lost nor sent twice, and it must still go to the address the customer used. Covered by Task 7 (`send-queue.test.ts` rekey tests + `messages.test.ts` "a send queued in the PN chat during a merge is delivered once, to the PN, from the LID chat").
3. **A push notification still points at the old PN URL.** Covered by Task 8 (`chats.test.ts` route resolution) and Task 8 (`push/service.test.ts`: new notifications use the canonical JID and never use LID digits as the title).
4. **The pre-merge backup fails.** Chats must stay split, both must stay reachable, and the merge must run later. Covered by Task 5 (`identity.test.ts` "leaves chats split when the backup fails…") and Task 8 (`bridge.test.ts` "the connect sweep merges a pair left split…" + `chats.test.ts` "a chat left split by a failed backup stays reachable").
5. **History sync `chats.upsert` recreates the PN row after the merge.** Covered by Task 5 (`identity.test.ts` "upsertFromWa for a merged phone number never recreates its chat") and Task 6 (`bridge.test.ts` "history chats.upsert for a merged PN does not recreate the PN row").
6. **The AI Sales Agent is waiting to answer, or is mid-reply, in the PN chat when it merges.** `ai_chat_state` cascades away with the PN row, the AI's in-memory timer/generation stay keyed by the PN, and the reply is either lost, sent twice, or sent while a teammate owns the merged chat. Covered by Task 3 (`merge.test.ts` "moves the AI Sales Agent's chat state…", "keeps the newer AI state and stays paused…", and the owner table rows where a human beats the AI member) and Task 7 (`ai.test.ts` "follows a phone-number chat merged into its WhatsApp ID chat…", "a reply being written when the chats merge is sent once…", "a merge that gives the chat to a teammate stops the AI").

Also covered: a recycled number (PN → other LID) only re-points future routing and never joins two people (Task 2 `aliases.test.ts` rule 3; Task 5 `contact-names.test.ts` rewrite).

---

## Task 1: Shared contract, migration 004, chat phone and `wa_remote_jid` columns

**Files:**
- Create: `packages/server/src/db/migrations/004_jid_aliases.sql`
- Modify: `packages/server/src/db/migrate.test.ts` (user_version 3 → 4, `jid_aliases` in `TABLES`, new upgrade test)
- Modify: `packages/shared/src/models.ts:35-47` (`ChatSchema.phone`)
- Modify: `packages/shared/src/socket.ts` (`ChatMergedPayload`, `'chat:merged'`)
- Modify: `packages/shared/src/api.ts:204-209` (`FakeIncomingBody.chatJidAlt`)
- Modify: `packages/shared/src/schemas.test.ts`
- Modify: `packages/server/src/bus.ts:2-29` (`'chat:merged'`)
- Modify: `packages/server/src/chats/repo.ts` (`ChatRow.phone`, `rowToChat`, `ensure`, `phoneFor`, `list` search)
- Modify: `packages/server/src/messages/repo.ts` (`MessageRow.wa_remote_jid`, `insert`)
- Modify: `packages/server/src/messages/service.ts` (three `MessageRow` literals)
- Modify (fixtures): `packages/server/test/chats.test.ts:194`, `packages/server/test/contact-names.test.ts:186`, `packages/server/src/push/service.test.ts:25`, `apps/web/src/inbox/ChatList.test.tsx:50`, `apps/web/src/inbox/InboxPage.test.tsx:21` (no other `Chat`/`ChatRow` literals exist; `test/ai.test.ts` builds chats through `ingest`)

**Interfaces:**
- Produces: `ChatSchema` gains `phone: z.string().nullable()` → `Chat['phone']: string | null` (PN digits without `+`).
- Produces: `export interface ChatMergedPayload { from: string; to: string }`; `ServerToClientEvents['chat:merged']: (p: ChatMergedPayload) => void`; `BusEvents['chat:merged']: [ChatMergedPayload]`.
- Produces: `FakeIncomingBody` gains `chatJidAlt?: string`.
- Produces: `ChatRow.phone: string | null`; `ChatRepo.phoneFor(jid: string): string | null`; `MessageRow.wa_remote_jid: string | null`.
- Produces: tables/columns `jid_aliases(alias_jid PK, canonical_jid, source, learned_at)`, `chats.phone`, `messages.wa_remote_jid`.

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
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jid_aliases'").get(),
      ).toEqual({ name: 'jid_aliases' });
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
-- routes to the LID chat. Rows are written by chats/aliases.ts; merges by chats/merge.ts.
CREATE TABLE jid_aliases (
  alias_jid     TEXT PRIMARY KEY,   -- non-canonical JID (normally the PN)
  canonical_jid TEXT NOT NULL,      -- chats.jid it routes to (normally the LID)
  source        TEXT NOT NULL,      -- 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore' | 'merge'
  learned_at    INTEGER NOT NULL
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
Expected: PASS (5 tests).

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

`packages/shared/src/socket.ts`, after `TypingPayload`:

```ts
/** A phone-number chat was merged into the same person's WhatsApp ID (LID) chat. */
export interface ChatMergedPayload {
  from: string;
  to: string;
}
```

and in `ServerToClientEvents` after `'chat:event': …`:

```ts
  'chat:merged': (p: ChatMergedPayload) => void;
```

`packages/server/src/bus.ts`: add `ChatMergedPayload` to the `@wa-team-inbox/shared` type import and in `BusEvents` after `'chat:event': [ChatEvent];`:

```ts
  /** `from` chat merged into `to` (after commit); send queue re-keys, sockets redirect */
  'chat:merged': [ChatMergedPayload];
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
Expected: FAIL — TypeScript/vitest error on unknown `phone` property / `expected '123456789' to be '60111'`.

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

`packages/server/src/messages/service.ts`: add `wa_remote_jid` after `client_id` in the three row literals — `ingest` (`client_id: null,` at line 369): `wa_remote_jid: m.chatJid,`; `sendText` (`client_id: body.clientId,` at line 460) and `sendMedia` (`client_id: clientId,` at line 494): `wa_remote_jid: jid,` (Tasks 6 and 7 refine these). The AI Sales Agent sends through `sendText`, so it gets the same column.

Fixtures: add `phone: null,` after `updatedAt: 0,` in `apps/web/src/inbox/ChatList.test.tsx` `chat()`; add `phone: '60123456789',` after `updatedAt: now,` in `apps/web/src/inbox/InboxPage.test.tsx` `chat`; add `phone: '60123',` after `updatedAt: 1,` in `packages/server/src/push/service.test.ts` `chat()`.

- [ ] **Step 9: Run the touched tests**

Run: `npx vitest run packages/server/src/db/migrate.test.ts packages/shared/src/schemas.test.ts packages/server/test/chats.test.ts packages/server/test/contact-names.test.ts packages/server/test/messages.test.ts packages/server/src/push/service.test.ts apps/web/src/inbox/ChatList.test.tsx apps/web/src/inbox/InboxPage.test.tsx`
Expected: PASS.

- [ ] **Step 10: Typecheck touched workspaces**

Run: `npm run typecheck -w @wa-team-inbox/shared && npm run typecheck -w @wa-team-inbox/server && npm run typecheck -w @wa-team-inbox/web`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/db/migrations/004_jid_aliases.sql packages/server/src/db/migrate.test.ts packages/shared/src/models.ts packages/shared/src/socket.ts packages/shared/src/api.ts packages/shared/src/schemas.test.ts packages/server/src/bus.ts packages/server/src/chats/repo.ts packages/server/src/messages/repo.ts packages/server/src/messages/service.ts packages/server/test/chats.test.ts packages/server/test/contact-names.test.ts packages/server/src/push/service.test.ts apps/web/src/inbox/ChatList.test.tsx apps/web/src/inbox/InboxPage.test.tsx
git commit -m "feat(shared,server): jid_aliases table, chat phone and message wa_remote_jid"
```

---

## Task 2: `AliasStore` — persisted PN → LID routing

**Files:**
- Create: `packages/server/src/chats/aliases.ts`
- Test: `packages/server/src/chats/aliases.test.ts`

**Interfaces:**
- Consumes: `WaContactAlias` from `@wa-team-inbox/wa` (`{ jid: string; alias: string; source?: … }`), table `jid_aliases`, column `chats.phone` (Task 1).
- Produces:
  - `export type AliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore' | 'merge';`
  - `export type LearnOutcome = { kind: 'ignored' } | { kind: 'unchanged'; pn: string; lid: string } | { kind: 'added'; pn: string; lid: string } | { kind: 'repointed'; pn: string; lid: string; previous: string };`
  - `export function normalizePn(jid: string | null | undefined): string | null`
  - `export function normalizeLid(jid: string | null | undefined): string | null`
  - `export function orientPair(p: { jid: string; alias: string }): { pn: string; lid: string } | null`
  - `export interface AliasStoreOptions { ownJid(): string | null; now(): number; log: Pick<Logger, 'warn'> }`
  - `export class AliasStore { constructor(db: DB, opts: AliasStoreOptions); reload(): void; resolve(jid: string): string; aliasesOf(canonical: string): string[]; learn(pair: { jid: string; alias: string }, source: AliasSource): LearnOutcome; pendingMerges(): Array<{ from: string; to: string }> }`

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
    log: { warn } as unknown as Pick<Logger, 'warn'>,
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
  });

  it('rule 1: stores a new pair with its source and sets the phone on the LID chat', () => {
    chat(LID);
    store().learn({ jid: PN, alias: LID }, 'lid-mapping');
    expect(db.prepare('SELECT * FROM jid_aliases').all()).toEqual([
      { alias_jid: PN, canonical_jid: LID, source: 'lid-mapping', learned_at: 1000 },
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
    expect(s.resolve(LID)).toBe(LID);
    expect(phoneOf(LID)).toBeNull();
    expect(phoneOf(OTHER_LID)).toBe('60111111111');
    expect(s.aliasesOf(LID)).toEqual([]);
    expect(s.aliasesOf(OTHER_LID)).toEqual([PN]);
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
  });

  it('reloads the routing table from the database', () => {
    store().learn({ jid: PN, alias: LID }, 'keystore');
    expect(store().resolve(PN)).toBe(LID);
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
Expected: FAIL — `Failed to load url ./aliases.js` (module does not exist).

- [ ] **Step 3: Implement `aliases.ts`**

```ts
import type { Logger } from 'pino';
import type { DB } from '../db/index.js';

export type AliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore' | 'merge';

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
  log: Pick<Logger, 'warn'>;
}

/**
 * Persisted PN → LID routing (`jid_aliases`) with an in-memory cache. The LID is canonical once
 * known; a PN stays canonical until then. Only explicit WhatsApp pairs are learned.
 */
export class AliasStore {
  private readonly canonical = new Map<string, string>();

  constructor(
    private readonly db: DB,
    private readonly opts: AliasStoreOptions,
  ) {
    this.reload();
  }

  reload(): void {
    this.canonical.clear();
    const rows = this.db.prepare('SELECT alias_jid, canonical_jid FROM jid_aliases').all() as Array<{
      alias_jid: string;
      canonical_jid: string;
    }>;
    for (const r of rows) this.canonical.set(r.alias_jid, r.canonical_jid);
  }

  /** Canonical chat JID: the LID for a PN whose LID is known, else `jid` unchanged. */
  resolve(jid: string): string {
    const pn = normalizePn(jid);
    return (pn && this.canonical.get(pn)) || jid;
  }

  /** Every alias JID that currently routes to `canonical`, sorted. */
  aliasesOf(canonical: string): string[] {
    const out: string[] = [];
    for (const [alias, to] of this.canonical) if (to === canonical) out.push(alias);
    return out.sort();
  }

  learn(pair: { jid: string; alias: string }, source: AliasSource): LearnOutcome {
    const p = orientPair(pair);
    if (!p) return { kind: 'ignored' };
    const own = normalizePn(this.opts.ownJid());
    if (own && p.pn === own) return { kind: 'ignored' };
    const previous = this.canonical.get(p.pn);
    if (previous === p.lid) return { kind: 'unchanged', ...p };
    const t = this.opts.now();
    const phone = digits(p.pn);
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(alias_jid) DO UPDATE SET canonical_jid = excluded.canonical_jid,
             source = excluded.source, learned_at = excluded.learned_at`,
        )
        .run(p.pn, p.lid, source, t);
      if (previous) {
        this.db.prepare('UPDATE chats SET phone = NULL WHERE jid = ? AND phone = ?').run(previous, phone);
      }
      this.db.prepare('UPDATE chats SET phone = ? WHERE jid = ?').run(phone, p.lid);
    })();
    this.canonical.set(p.pn, p.lid);
    if (previous) {
      // Number recycled / re-registered: future routing only. Never join `previous` and `lid`.
      this.opts.log.warn(
        { pn: p.pn, from: previous, to: p.lid, source },
        'phone number moved to a different WhatsApp ID',
      );
      return { kind: 'repointed', ...p, previous };
    }
    return { kind: 'added', ...p };
  }

  /** Aliases whose JID still has its own chat row: merges that have not run yet. */
  pendingMerges(): Array<{ from: string; to: string }> {
    return this.db
      .prepare(
        `SELECT a.alias_jid AS "from", a.canonical_jid AS "to" FROM jid_aliases a
         JOIN chats c ON c.jid = a.alias_jid ORDER BY a.learned_at, a.alias_jid`,
      )
      .all() as Array<{ from: string; to: string }>;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/server/src/chats/aliases.test.ts` → PASS (10 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/chats/aliases.ts packages/server/src/chats/aliases.test.ts
git commit -m "feat(server): AliasStore routes phone-number JIDs to their WhatsApp ID chat"
```

---

## Task 3: `mergeChat` and the labelled pre-merge backup (kept 30 days)

**Files:**
- Create: `packages/server/src/chats/merge.ts`
- Test: `packages/server/src/chats/merge.test.ts`
- Modify: `packages/server/src/backup/backup.ts` (`runBackupSync`, label, 30-day pre-merge retention)
- Test: `packages/server/src/backup/backup.test.ts`

**Interfaces:**
- Consumes: `ChatRepo`, `ChatRow`, `jidUser` (`chats/repo.ts`), `audit` (`db/audit.ts`), `AliasSource` (Task 2); tables `ai_chat_state` and `users.kind` (migration 003, #18).
- Produces:
  - `export interface MergeResult { from: string; to: string; rekeyed: boolean; moved: { messages: number; events: number; notes: number; aiState: number }; assignedTo: number | null; assigneeDropped: number | null; events: ChatEvent[] }`
  - Owner rule: one owner kept; a teammate (`users.kind = 'human'`) always beats the AI Sales Agent member; otherwise the chat with the newest inbound message keeps its owner.
  - AI state rule: `ai_chat_state` of `from` moves to `to` (it has `ON DELETE CASCADE` and would vanish with the `from` row); when both exist, the newer-inbound chat's state wins and `paused` is kept if either chat was paused (handoff).
  - `export function mergeChat(db: DB, from: string, to: string, opts: { now: number; source?: AliasSource }): MergeResult | null`
  - `export const PREMERGE_KEEP_DAYS = 30;`
  - `export function runBackupSync(dataDir: string, db: DB, now?: Date, opts?: { label?: string }): string`
  - `runBackup(dataDir, db, now?)` keeps its signature and delegates to `runBackupSync`.

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

In `packages/server/src/backup/backup.ts` replace `runBackup` (lines 84-106) with:

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
const aiState = (jid: string, f: { paused?: number; customer: string; dueAt: number | null }) =>
  db
    .prepare(
      `INSERT INTO ai_chat_state (chat_jid, paused, awaiting_confirmation, last_customer_message_id, due_at)
       VALUES (?, ?, 1, ?, ?)`,
    )
    .run(jid, f.paused ?? 0, f.customer, f.dueAt);
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

    expect(r).toMatchObject({
      from: PN,
      to: LID,
      rekeyed: false,
      moved: { messages: 66, events: 1, notes: 1, aiState: 0 },
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
    expect(db.prepare('SELECT canonical_jid FROM jid_aliases WHERE alias_jid = ?').get(PN)).toEqual({
      canonical_jid: LID,
    });
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
      if (dropped === null) {
        expect(r.events).toEqual([]);
      } else {
        expect(r.events).toEqual([
          expect.objectContaining({
            chatJid: LID,
            type: 'assigned',
            actorId: null,
            payload: { assignedTo: kept, previous: dropped, reason: 'merge' },
            at: 5000,
          }),
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
    expect(count('SELECT COUNT(*) AS n FROM jid_aliases')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM audit_log')).toBe(0);
  });

  it('re-points aliases that routed to the merged chat and keeps an existing alias for `from`', () => {
    seedChat(PN);
    seedChat(LID);
    db.prepare(
      "INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at) VALUES ('60999@s.whatsapp.net', ?, 'contacts', 1)",
    ).run(PN);
    db.prepare(
      "INSERT INTO jid_aliases (alias_jid, canonical_jid, source, learned_at) VALUES (?, '555@lid', 'message', 1)",
    ).run(PN);
    mergeChat(db, PN, LID, { now: 5000 });
    expect(
      db.prepare("SELECT canonical_jid FROM jid_aliases WHERE alias_jid = '60999@s.whatsapp.net'").get(),
    ).toEqual({ canonical_jid: LID });
    expect(db.prepare('SELECT canonical_jid FROM jid_aliases WHERE alias_jid = ?').get(PN)).toEqual({
      canonical_jid: '555@lid',
    });
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
import type { ChatEvent } from '@wa-team-inbox/shared';
import { audit } from '../db/audit.js';
import type { DB } from '../db/index.js';
import type { AliasSource } from './aliases.js';
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
  /** events inserted by the merge; publish them after commit */
  events: ChatEvent[];
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
 * Merges chat `from` (normally the PN) into `to` (normally the LID) in one synchronous transaction.
 * Returns null when `from` has no chat row (idempotent). Media files are not moved: `media_path`
 * stays valid. The caller publishes `result.events`, `chat:merged` and `chat:updated` after commit.
 */
export function mergeChat(
  db: DB,
  from: string,
  to: string,
  opts: { now: number; source?: AliasSource },
): MergeResult | null {
  if (from === to) return null;
  const repo = new ChatRepo(db);
  return db.transaction((): MergeResult | null => {
    const a = repo.get(from);
    if (!a) return null;
    const b = repo.get(to);
    // Decide before any message moves: which chat heard from the customer last.
    const fromNewer = lastInboundAt(db, from) > lastInboundAt(db, to);
    const phone = pnDigits(from) ?? a.phone;
    const events: ChatEvent[] = [];
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
      events.push(
        repo.insertEvent({
          chatJid: to,
          type: 'assigned',
          actorId: null,
          payload: { assignedTo, previous: assigneeDropped, reason: 'merge' },
          at: opts.now,
        }),
      );
    }
    db.prepare('DELETE FROM chats WHERE jid = ?').run(from);
    // Keep an existing alias for `from` (a re-pointed recycled number must stay re-pointed).
    db.prepare(
      'INSERT OR IGNORE INTO jid_aliases (alias_jid, canonical_jid, source, learned_at) VALUES (?, ?, ?, ?)',
    ).run(from, to, opts.source ?? 'merge', opts.now);
    db.prepare('UPDATE jid_aliases SET canonical_jid = ? WHERE canonical_jid = ?').run(to, from);
    audit(db, {
      userId: null,
      action: 'chat.merge',
      ip: null,
      meta: { from, to, rekeyed: !b, moved, assigneeDropped },
    });
    return { from, to, rekeyed: !b, moved, assignedTo, assigneeDropped, events };
  })();
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/server/src/chats/merge.test.ts packages/server/src/backup/backup.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/chats/merge.ts packages/server/src/chats/merge.test.ts packages/server/src/backup/backup.ts packages/server/src/backup/backup.test.ts
git commit -m "feat(server): merge duplicate chats in one transaction; pre-merge backup kept 30 days"
```

---

## Task 4: WhatsApp adapter `chatJidAlt`, alias sources, fake adapter helpers

**Files:**
- Modify: `packages/wa/src/types.ts` (`WaIncomingMessage.chatJidAlt`, `WaAliasSource`, `WaContactAlias.source`)
- Modify: `packages/wa/src/baileys/mapping.ts` (fill `chatJidAlt`)
- Modify: `packages/wa/src/baileys/adapter.ts:354-356, 466-487, 495-500, 535-547, 588-592` (alias sources)
- Modify: `packages/wa/src/fake/fake-adapter.ts` (`chatJidAlt`, `simulateContactAliases`, `setContactAliases`, `getContactAliases`)
- Test: `packages/wa/src/baileys/mapping.test.ts`, `packages/wa/src/baileys/adapter.test.ts`, `packages/wa/src/fake/fake-adapter.test.ts`

**Interfaces:**
- Produces: `WaIncomingMessage.chatJidAlt?: string | null` (DM only; other addressing of the same person, device suffix stripped; null/absent for groups).
- Produces: `export type WaAliasSource = 'message' | 'history' | 'contacts' | 'lid-mapping' | 'keystore';` and `WaContactAlias.source?: WaAliasSource`.
- Produces: `FakeWaAdapter.simulateContactAliases(pairs: WaContactAlias[]): void`, `FakeWaAdapter.setContactAliases(pairs: WaContactAlias[]): void`, `FakeWaAdapter.getContactAliases(jids: string[]): Promise<WaContactAlias[]>` (returns stored pairs whose `jid` or `alias` is in `jids`).

- [ ] **Step 1: Write the failing mapping and fake adapter tests**

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
  it('simulateIncoming carries chatJidAlt; alias helpers emit and answer local lookups', async () => {
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

    wa.setContactAliases([
      { jid: '601@s.whatsapp.net', alias: '1@lid' },
      { jid: '603@s.whatsapp.net', alias: '3@lid' },
    ]);
    await expect(wa.getContactAliases(['1@lid'])).resolves.toEqual([
      { jid: '601@s.whatsapp.net', alias: '1@lid' },
    ]);
    await expect(wa.getContactAliases(['9@lid'])).resolves.toEqual([]);
  });
```

Run: `npx vitest run packages/wa/src/baileys/mapping.test.ts packages/wa/src/fake/fake-adapter.test.ts`
Expected: FAIL — `expected undefined to be '60123456789@s.whatsapp.net'` and `wa.simulateContactAliases is not a function`.

- [ ] **Step 2: Implement types, mapping and fake adapter**

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
- in the class fields after `presences`: `private aliases: WaContactAlias[] = [];`
- replace `getContactAliases`:

```ts
  async getContactAliases(jids: string[]): Promise<WaContactAlias[]> {
    const wanted = new Set(jids);
    return this.aliases.filter((p) => wanted.has(p.jid) || wanted.has(p.alias)).map((p) => ({ ...p }));
  }
```

- in `simulateIncoming`'s `msg` literal after `chatJid: p.chatJid,` add `chatJidAlt: p.chatJidAlt ?? null,`
- add test helpers after `setMedia`:

```ts
  /** Emit explicit PN/LID pairs as the adapter does when WhatsApp reveals them. */
  simulateContactAliases(pairs: WaContactAlias[]): void {
    this.emitTyped('contactAliases', pairs.map((p) => ({ ...p })));
  }

  /** Pairs returned by getContactAliases (the local key store on reconnect). */
  setContactAliases(pairs: WaContactAlias[]): void {
    this.aliases = pairs.map((p) => ({ ...p }));
  }
```

Run: `npx vitest run packages/wa/src/baileys/mapping.test.ts packages/wa/src/fake/fake-adapter.test.ts` → PASS.

- [ ] **Step 3: Tag alias sources in the Baileys adapter (failing test first)**

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

- [ ] **Step 4: Implement sources in `adapter.ts`**

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

- [ ] **Step 5: Run the wa tests**

Run: `npx vitest run packages/wa/src/baileys/mapping.test.ts packages/wa/src/baileys/adapter.test.ts packages/wa/src/fake/fake-adapter.test.ts` → PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/wa && npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 7: Commit** (note in the PR: Baileys changes are untested against real WhatsApp until Task 12)

```bash
git add packages/wa/src/types.ts packages/wa/src/baileys/mapping.ts packages/wa/src/baileys/mapping.test.ts packages/wa/src/baileys/adapter.ts packages/wa/src/baileys/adapter.test.ts packages/wa/src/fake/fake-adapter.ts packages/wa/src/fake/fake-adapter.test.ts
git commit -m "feat(wa): expose chatJidAlt and alias sources; fake adapter alias helpers"
```

---

## Task 5: `IdentityService` and chat-service integration (names, `upsertFromWa`, lookups)

**Files:**
- Create: `packages/server/src/chats/identity.ts`
- Test: `packages/server/src/chats/identity.test.ts`
- Modify: `packages/server/src/chats/service.ts` (remove in-memory `aliases`/`link`; use identity; `resolveJid`; `get`; `upsertFromWa`; `upsertContacts`; `upsertContactAliases`)
- Modify: `packages/server/src/wa-bridge/index.ts:22-28` (`initMessaging` creates identity first)
- Modify: `packages/server/test/contact-names.test.ts:112-135` (rule 3 replaces "rejects conflicting")

**Interfaces:**
- Consumes: `AliasStore`, `LearnOutcome`, `AliasSource` (Task 2); `mergeChat`, `MergeResult`, `runBackupSync` (Task 3); `BusEvents['chat:merged']` (Task 1).
- Produces:
  - `export const PREMERGE_BACKUP_SETTING = 'lid_merge_backup_at';`
  - `export interface IdentityService { resolve(jid: string): string; group(jid: string): string[]; learn(pairs: WaContactAlias[], source: AliasSource): { outcomes: LearnOutcome[]; merges: MergeResult[] }; sweep(): MergeResult[] }`
  - `export interface IdentityDeps { now?: () => number; backup?: (dataDir: string, db: DB, now: Date) => string }`
  - `export function createIdentityService(ctx: AppContext, deps?: IdentityDeps): IdentityService`
  - `export function getIdentity(ctx: AppContext): IdentityService` (+ `Services.identity?: IdentityService` augmentation)
  - `ChatService.resolveJid(jid: string): string` — the jid itself when it has a chat row (a chat left split by a refused merge stays reachable), else its canonical JID.
  - `ChatService.get(jid)` falls back to the canonical chat.

- [ ] **Step 1: Write the failing identity tests**

`packages/server/src/chats/identity.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestApp, type TestApp } from '../../test/helpers.js';
import { getChats } from '../wa-bridge/index.js';
import { ChatRepo } from './repo.js';
import { getIdentity, PREMERGE_BACKUP_SETTING } from './identity.js';

const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const backups = () => join(t.ctx.config.dataDir, 'backups');
const premergeFiles = () => readdirSync(backups()).filter((n) => n.startsWith('app-premerge-'));
const jids = () =>
  (t.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
    (r) => r.jid,
  );
function seed(pn = PN, lid = LID) {
  const repo = new ChatRepo(t.ctx.db);
  repo.ensure(pn, { name: 'Aisyah' }, 1);
  repo.ensure(lid, { name: 'Aisyah' }, 1);
}
function blockBackups() {
  rmSync(backups(), { recursive: true, force: true });
  writeFileSync(backups(), 'not a directory');
}

describe('identity service', () => {
  it('writes one pre-merge backup, merges, and publishes chat:merged then chat:updated after commit', () => {
    seed();
    const order: string[] = [];
    const atMerge: Array<{ inTransaction: boolean; pnRow: boolean }> = [];
    t.ctx.bus.on('chat:merged', (p) => {
      order.push(`merged:${p.from}->${p.to}`);
      atMerge.push({
        inTransaction: t.ctx.db.inTransaction,
        pnRow: !!new ChatRepo(t.ctx.db).get(PN),
      });
    });
    t.ctx.bus.on('chat:updated', (c) => order.push(`updated:${c.jid}`));

    const { merges } = getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');

    expect(merges).toHaveLength(1);
    expect(jids()).toEqual([LID]);
    expect(order).toEqual([`merged:${PN}->${LID}`, `updated:${LID}`]);
    expect(atMerge).toEqual([{ inTransaction: false, pnRow: false }]);
    expect(t.ctx.settings.get<number | null>(PREMERGE_BACKUP_SETTING, null)).not.toBeNull();
    expect(premergeFiles()).toHaveLength(1);

    // later merges reuse the first backup
    rmSync(join(backups(), premergeFiles()[0]!));
    seed('60222222222@s.whatsapp.net', '222@lid');
    getIdentity(t.ctx).learn([{ jid: '60222222222@s.whatsapp.net', alias: '222@lid' }], 'contacts');
    expect(premergeFiles()).toHaveLength(0);
    expect(jids()).toEqual([LID, '222@lid']);
  });

  it('leaves chats split when the backup fails, keeps both reachable, and the sweep merges later', () => {
    seed();
    blockBackups();
    const merged = vi.fn();
    t.ctx.bus.on('chat:merged', merged);
    const identity = getIdentity(t.ctx);

    expect(identity.learn([{ jid: PN, alias: LID }], 'contacts').merges).toEqual([]);
    expect(jids()).toEqual([LID, PN]);
    expect(identity.resolve(PN)).toBe(LID);
    expect(getChats(t.ctx).resolveJid(PN)).toBe(PN);
    expect(t.ctx.settings.get<number | null>(PREMERGE_BACKUP_SETTING, null)).toBeNull();
    expect(merged).not.toHaveBeenCalled();

    rmSync(backups(), { force: true });
    expect(identity.sweep()).toHaveLength(1);
    expect(jids()).toEqual([LID]);
    expect(merged).toHaveBeenCalledWith({ from: PN, to: LID });
  });

  it('refuses to take the backup inside a transaction and merges nothing', () => {
    seed();
    const r = t.ctx.db.transaction(() =>
      getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts'),
    )();
    expect(r.merges).toEqual([]);
    expect(jids()).toEqual([LID, PN]);
  });

  it('never learns the linked number itself', () => {
    const me = t.wa.status.me!.jid;
    expect(getIdentity(t.ctx).learn([{ jid: me, alias: '1@lid' }], 'contacts').outcomes).toEqual([
      { kind: 'ignored' },
    ]);
  });

  it('upsertFromWa for a merged phone number never recreates its chat', () => {
    seed();
    getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
    const chat = getChats(t.ctx).upsertFromWa({ jid: PN, type: 'dm', name: 'Aisyah' });
    expect(chat.jid).toBe(LID);
    expect(jids()).toEqual([LID]);
    expect(getChats(t.ctx).get(PN)?.jid).toBe(LID);
    expect(getChats(t.ctx).resolveJid(PN)).toBe(LID);
  });
});
```

In `packages/server/test/contact-names.test.ts` add `import { getIdentity } from '../src/chats/identity.js';` and replace the test `'rejects conflicting and malformed mappings without combining different people'` (lines 112-135) with:

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
    expect(getIdentity(t.ctx).resolve(PN)).toBe(otherLID);
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

Run: `npx vitest run packages/server/src/chats/identity.test.ts packages/server/test/contact-names.test.ts`
Expected: FAIL — `Failed to load url ./identity.js` / `../src/chats/identity.js`.

- [ ] **Step 2: Implement `identity.ts`**

```ts
import type { WaContactAlias } from '@wa-team-inbox/wa';
import { runBackupSync } from '../backup/backup.js';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { AliasStore, type AliasSource, type LearnOutcome } from './aliases.js';
import { mergeChat, type MergeResult } from './merge.js';
import { ChatRepo, rowToChat } from './repo.js';

declare module '../context.js' {
  interface Services {
    identity?: IdentityService;
  }
}

/** Set once the pre-merge backup exists; merges never run without it. */
export const PREMERGE_BACKUP_SETTING = 'lid_merge_backup_at';

export interface IdentityService {
  /** canonical chat JID (the LID once known) */
  resolve(jid: string): string;
  /** `[canonical, ...aliases]`: every JID of the person, for name sync */
  group(jid: string): string[];
  /** Learn explicit WhatsApp pairs and merge chats they join. Call outside db transactions. */
  learn(
    pairs: WaContactAlias[],
    source: AliasSource,
  ): { outcomes: LearnOutcome[]; merges: MergeResult[] };
  /** Merge aliases that still have their own chat (e.g. after a failed backup). */
  sweep(): MergeResult[];
}

export interface IdentityDeps {
  now?: () => number;
  backup?: (dataDir: string, db: DB, now: Date) => string;
}

export function createIdentityService(ctx: AppContext, deps: IdentityDeps = {}): IdentityService {
  const now = deps.now ?? Date.now;
  const backup =
    deps.backup ?? ((dataDir, db, at) => runBackupSync(dataDir, db, at, { label: 'premerge' }));
  const log = ctx.log.child({ mod: 'contacts' });
  const repo = new ChatRepo(ctx.db);
  const store = new AliasStore(ctx.db, {
    ownJid: () => ctx.wa.status.me?.jid ?? null,
    now,
    log,
  });

  const ensureBackup = (): boolean => {
    if (ctx.settings.get<number | null>(PREMERGE_BACKUP_SETTING, null) !== null) return true;
    if (ctx.db.inTransaction) {
      log.error('pre-merge backup cannot run inside a transaction; chats left split');
      return false;
    }
    try {
      const file = backup(ctx.config.dataDir, ctx.db, new Date(now()));
      ctx.settings.set(PREMERGE_BACKUP_SETTING, now());
      log.info({ file }, 'pre-merge backup written');
      return true;
    } catch (err) {
      log.error({ err }, 'pre-merge backup failed; chats left split');
      return false;
    }
  };

  const publish = (r: MergeResult) => {
    for (const e of r.events) ctx.bus.emit('chat:event', e);
    ctx.bus.emit('chat:merged', { from: r.from, to: r.to });
    const row = repo.get(r.to);
    if (row) ctx.bus.emit('chat:updated', rowToChat(row));
    log.info(
      { from: r.from, to: r.to, rekeyed: r.rekeyed, ...r.moved, assigneeDropped: r.assigneeDropped },
      'chats merged',
    );
  };

  const mergeAll = (pairs: Array<{ from: string; to: string }>): MergeResult[] => {
    const todo = pairs.filter((p) => p.from !== p.to && repo.get(p.from));
    if (!todo.length || !ensureBackup()) return [];
    const out: MergeResult[] = [];
    for (const p of todo) {
      try {
        const r = mergeChat(ctx.db, p.from, p.to, { now: now() });
        if (r) {
          out.push(r);
          publish(r);
        }
      } catch (err) {
        log.error({ err, from: p.from, to: p.to }, 'chat merge failed; chats left split');
      }
    }
    return out;
  };

  return {
    resolve: (jid) => store.resolve(jid),
    group(jid) {
      const canonical = store.resolve(jid);
      return [canonical, ...store.aliasesOf(canonical)];
    },
    learn(pairs, source) {
      const outcomes = pairs.map((p) => store.learn(p, p.source ?? source));
      const merges: Array<{ from: string; to: string }> = [];
      for (const o of outcomes) {
        if (o.kind === 'added' || o.kind === 'unchanged') merges.push({ from: o.pn, to: o.lid });
        // A recycled number's leftover PN chat belongs to the previous person.
        else if (o.kind === 'repointed') merges.push({ from: o.pn, to: o.previous });
      }
      return { outcomes, merges: mergeAll(merges) };
    },
    sweep: () => mergeAll(store.pendingMerges()),
  };
}

export function getIdentity(ctx: AppContext): IdentityService {
  const s = ctx.services.identity;
  if (!s) throw new Error('identity service not initialized');
  return s;
}
```

- [ ] **Step 3: Wire identity into the chat service**

`packages/server/src/wa-bridge/index.ts`, `initMessaging`:

```ts
export function initMessaging(ctx: AppContext): void {
  ctx.services.identity = createIdentityService(ctx);
  ctx.services.chats = createChatService(ctx);
  ctx.services.messages = createMessageService(ctx);
  const detach = attachWaBridge(ctx);
  ctx.services.waBridge = { shutdown: detach };
}
```

with `import { createIdentityService } from '../chats/identity.js';`.

`packages/server/src/chats/service.ts`:
- add `import { getIdentity } from './identity.js';`
- in `ChatService` add after `get(jid: string): Chat | null;`:

```ts
  /** `jid` when it has its own chat row, else its canonical (LID) JID. Routes use this. */
  resolveJid(jid: string): string;
```

- delete `const aliases = new Map<string, Set<string>>();` (line 53) and the whole `link` function (lines 62-71).
- replace `get`:

```ts
    get(jid) {
      const r = repo.get(jid) ?? repo.get(getIdentity(ctx).resolve(jid));
      return r ? rowToChat(r) : null;
    },

    resolveJid(jid) {
      return repo.get(jid) ? jid : getIdentity(ctx).resolve(jid);
    },
```

- in `upsertFromWa`, insert as the first line `const jid = info.type === 'dm' ? getIdentity(ctx).resolve(info.jid) : info.jid;` and replace every `info.jid` in the function body with `jid` (history `chats.upsert` must not recreate a merged PN row).
- replace `upsertContacts` and `upsertContactAliases`:

```ts
    upsertContacts(list) {
      const t = now();
      const identity = getIdentity(ctx);
      // Learn (and possibly merge, which takes a backup) before opening the name transaction.
      const pairs = list
        .filter((c) => chatTypeOf(c.jid) === 'dm')
        .flatMap((c) => (c.aliases ?? []).map((alias) => ({ jid: c.jid, alias })));
      if (pairs.length) identity.learn(pairs, 'contacts');
      const renamed = ctx.db.transaction((items: WaContactInfo[]) => {
        const out = new Set<string>();
        for (const c of items) {
          if (chatTypeOf(c.jid) !== 'dm') continue;
          for (const jid of syncNames(identity.group(c.jid), t, c)) out.add(jid);
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
      const identity = getIdentity(ctx);
      const { outcomes } = identity.learn(list, 'contacts');
      const renamed = ctx.db.transaction(() => {
        const changed = new Set<string>();
        for (const o of outcomes) {
          if (o.kind === 'ignored') continue;
          for (const jid of syncNames(identity.group(o.lid), now())) changed.add(jid);
        }
        return changed;
      })();
      for (const jid of renamed) emitChat(jid);
      log.info(
        { aliasCount: list.length, renamedCount: renamed.size },
        'contact aliases synchronized',
      );
    },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/server/src/chats/identity.test.ts packages/server/test/contact-names.test.ts packages/server/test/chats.test.ts packages/server/src/wa-bridge/bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/chats/identity.ts packages/server/src/chats/identity.test.ts packages/server/src/chats/service.ts packages/server/src/wa-bridge/index.ts packages/server/test/contact-names.test.ts
git commit -m "feat(server): identity service merges chats when WhatsApp links a phone number and LID"
```

---

## Task 6: Ingest routing and dev `fake-incoming` `chatJidAlt`

**Files:**
- Modify: `packages/server/src/messages/service.ts:336-434` (`ingest`, including the AI's `message:received` emit added by #18)
- Modify: `packages/server/src/routes/dev.ts`
- Test: `packages/server/src/wa-bridge/bridge.test.ts`, `packages/server/test/admin.test.ts`

**Interfaces:**
- Consumes: `getIdentity(ctx).learn/resolve` (Task 5), `WaIncomingMessage.chatJidAlt` (Task 4), `FakeIncomingBody.chatJidAlt` (Task 1), `MessageRow.wa_remote_jid` (Task 1).
- Produces: inbound DM rows stored with `chat_jid = identity.resolve(m.chatJid)` and `wa_remote_jid = m.chatJid`; `message:new`, `message:received` (AI Sales Agent trigger), `chat:updated`, `inbound:notify` and the media folder use the canonical JID; `POST /api/dev/fake-incoming` returns `{ id, chatJid: <canonical>, timestamp }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/wa-bridge/bridge.test.ts` (add `import { getIdentity } from '../chats/identity.js';`):

```ts
const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
const chatJids = () =>
  (t.ctx.db.prepare('SELECT jid FROM chats ORDER BY jid').all() as Array<{ jid: string }>).map(
    (r) => r.jid,
  );

describe('one chat per person (phone number / WhatsApp ID)', () => {
  it('inbound on PN then on LID with chatJidAlt lands in one LID chat; unread and notify follow it', async () => {
    const notified: string[] = [];
    t.ctx.bus.on('inbound:notify', ({ chat }) => notified.push(chat.jid));
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'first', senderName: 'Aisyah' });
    await settle();
    t.wa.simulateIncoming({
      id: 'L-1',
      chatJid: LID,
      chatJidAlt: PN,
      body: 'second',
      senderName: 'Aisyah',
    });
    await settle();
    expect(chatJids()).toEqual([LID]);
    expect(getChats(t.ctx).get(LID)).toMatchObject({
      unreadCount: 2,
      phone: '60111111111',
      name: 'Aisyah',
    });
    expect(
      t.ctx.db.prepare('SELECT id, chat_jid, wa_remote_jid FROM messages ORDER BY id').all(),
    ).toEqual([
      { id: 'L-1', chat_jid: LID, wa_remote_jid: LID },
      { id: 'P-1', chat_jid: LID, wa_remote_jid: PN },
    ]);
    expect(notified).toEqual([PN, LID]);
  });

  it('a later message on the PN goes straight to the LID chat (and the AI trigger names that chat)', async () => {
    const received: string[] = [];
    t.ctx.bus.on('message:received', ({ chat, message }) =>
      received.push(`${chat.jid}/${message.chatJid}`),
    );
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, chatJidAlt: PN, body: 'hi' });
    await settle();
    t.wa.simulateIncoming({ id: 'P-2', chatJid: PN, body: 'again' });
    await settle();
    expect(chatJids()).toEqual([LID]);
    expect(received).toEqual([`${LID}/${LID}`, `${LID}/${LID}`]);
    expect(t.ctx.db.prepare("SELECT chat_jid, wa_remote_jid FROM messages WHERE id = 'P-2'").get()).toEqual({
      chat_jid: LID,
      wa_remote_jid: PN,
    });
  });

  it('history chats.upsert for a merged PN does not recreate the PN row', async () => {
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
    expect(getIdentity(t.ctx).resolve(PN)).toBe(PN);
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM jid_aliases').get()).toEqual({ n: 0 });
  });
});
```

Append inside `describe('dev fake-incoming', …)` in `packages/server/test/admin.test.ts`:

```ts
  it('accepts chatJidAlt and reports the canonical chat', async () => {
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

Run: `npx vitest run packages/server/src/wa-bridge/bridge.test.ts packages/server/test/admin.test.ts`
Expected: FAIL — `expected [ '123456789@lid', '60111111111@s.whatsapp.net' ] to deeply equal [ '123456789@lid' ]` and `expected '60123456789@s.whatsapp.net' to be '123456789@lid'`.

- [ ] **Step 2: Implement ingest routing**

`packages/server/src/messages/service.ts`: add `import { getIdentity } from '../chats/identity.js';` and replace `ingest` (lines 336-434) with:

```ts
    async ingest(m, source) {
      if (repo.exists(m.id)) return null;
      const isGroup = m.chatJid.endsWith('@g.us');
      const identity = getIdentity(ctx);
      if (!isGroup && m.chatJidAlt) {
        // Learn first: the PN and LID may already have separate chats that this pair merges.
        identity.learn(
          [{ jid: m.chatJid, alias: m.chatJidAlt }],
          source === 'history' ? 'history' : 'message',
        );
      }
      // One person, one chat: a phone-number JID whose WhatsApp ID is known lands in the LID chat.
      const chatJid = isGroup ? m.chatJid : identity.resolve(m.chatJid);
      if (m.fromMe && inflight.has(chatJid)) {
        // Our own send may echo before the queue has committed its WhatsApp id and sender.
        await inflight.get(chatJid);
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
        // AI Sales Agent trigger (#18): keyed by the canonical chat so its ai_chat_state, timers
        // and replies follow the one chat per person.
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
      const chat = emitChat(final.chat_jid);
      if (isNewLiveInbound && chat) ctx.bus.emit('inbound:notify', { chat, message: msg });
      return msg;
    },
```

(`emitChat(final.chat_jid)` — not `chatJid` — so a merge during a live media download still publishes the surviving chat.)

- [ ] **Step 3: Implement the dev route**

Replace the handler body in `packages/server/src/routes/dev.ts`:

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
        // match on content. A known phone number is stored in its WhatsApp ID (canonical) chat.
        const canonical = ctx.services.identity?.resolve(body.chatJid) ?? body.chatJid;
        const match =
          expectId !== null
            ? m.id === expectId
            : (m.chatJid === canonical || m.chatJid === body.chatJid) &&
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

No new import is needed: `ctx.services.identity` is typed by the module augmentation in `chats/identity.ts`, which is part of the program through `wa-bridge/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/server/src/wa-bridge/bridge.test.ts packages/server/test/admin.test.ts packages/server/test/messages.test.ts packages/server/test/contact-names.test.ts packages/server/test/ai.test.ts`
Expected: PASS (`ai.test.ts` proves the AI still triggers on `message:received` and its echo/ownership checks still hold).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/messages/service.ts packages/server/src/routes/dev.ts packages/server/src/wa-bridge/bridge.test.ts packages/server/test/admin.test.ts
git commit -m "feat(server): route inbound phone-number and LID messages to one canonical chat"
```

---

## Task 7: Replies to the last inbound address, send-queue rekey, grouped read receipts, presence, AI Sales Agent follows merges

**Files:**
- Modify: `packages/server/src/messages/send-queue.ts` (`SendJob.targetJid`, `presence(job)`, `rekey`, in-flight guard)
- Modify: `packages/server/src/messages/repo.ts` (`lastInboundRemoteJid`)
- Modify: `packages/server/src/messages/service.ts:137-235, 237-255, 436-496, 595-597` (`sendJob` + its echo-guard reconciliation, queue `presence`, `jobFromRow`, `sendText`, `sendMedia`, `chat:merged` listener, `shutdown`)
- Modify: `packages/server/src/chats/service.ts:294-315` (`markRead` grouped by `wa_remote_jid`)
- Modify: `packages/server/src/ai/service.ts:290-390, 455-460, 598-603` (`respond` follows the canonical chat; `chat:merged` listener moves timers/generations)
- Test: `packages/server/src/messages/send-queue.test.ts`, `packages/server/test/messages.test.ts`, `packages/server/test/ai.test.ts`

**Interfaces:**
- Consumes: `BusEvents['chat:merged']` (Task 1, emitted by Task 5), `MessageRow.wa_remote_jid`, `ChatService.resolveJid` (Task 5), merged `ai_chat_state` (Task 3).
- Produces:
  - `SendJob.targetJid: string` (JID passed to `wa.sendText/sendMedia/sendPresence`; `chatJid` stays the queue key and the chat passed to `ai.canSend`)
  - `SendQueueDeps.presence?: (job: SendJob) => Promise<void>`
  - `SendQueue.rekey(from: string, to: string): void`
  - `MessageRepo.lastInboundRemoteJid(chatJid: string): string | null`
  - AI Sales Agent replies (sent through `MessageService.sendText`) target the customer's last inbound address like human replies; a pending AI timer or running AI reply in a merged chat continues in the canonical chat and is recorded there (no lost or duplicate reply).

- [ ] **Step 1: Write the failing send-queue tests**

In `packages/server/src/messages/send-queue.test.ts`:
- `job()` becomes `return { localId, chatJid, targetJid: chatJid, createdAt, kind: 'text', text: localId };`
- in `makeQueue`, the `sent` array type becomes `Array<{ id: string; at: number; target: string; chat: string }>`, the push becomes `sent.push({ id: j.localId, at: now(), target: j.targetJid, chat: j.chatJid });`, and `presence: async (j) => { presence.push(j.targetJid); },`.

Append inside `describe('SendQueue', …)`:

```ts
  it('rekey moves jobs waiting for a connection into the canonical chat, in creation order, with spacing', async () => {
    let clock = 1_000_000;
    const { q, sent, setConnected } = makeQueue({
      connected: false,
      now: () => clock,
      sleep: async (ms) => {
        if (ms > 10_000) await new Promise<void>(() => undefined); // parked until onConnected
        clock += ms;
      },
    });
    q.enqueue(job('pn-1', 'PN', clock));
    q.enqueue(job('lid-1', 'LID', clock + 1));
    q.enqueue(job('pn-2', 'PN', clock + 2));
    await flush();
    q.rekey('PN', 'LID');
    setConnected(true);
    q.onConnected();
    await flush(50);
    expect(sent.map((s) => s.id)).toEqual(['pn-1', 'lid-1', 'pn-2']);
    expect(sent.map((s) => s.chat)).toEqual(['LID', 'LID', 'LID']);
    expect(sent.map((s) => s.target)).toEqual(['PN', 'LID', 'PN']);
    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(1000);
    expect(sent[2]!.at - sent[1]!.at).toBeGreaterThanOrEqual(1000);
    q.stop();
  });

  it('a job already being sent finishes with its own target; the canonical chat waits for it', async () => {
    let clock = 1;
    let release!: () => void;
    const sent: Array<{ id: string; target: string; chat: string; at: number }> = [];
    const q = new SendQueue({
      send: async (j): Promise<SendResult> => {
        if (j.localId === 'pn-1') await new Promise<void>((r) => (release = r));
        sent.push({ id: j.localId, target: j.targetJid, chat: j.chatJid, at: clock });
        return { id: `WA-${j.localId}`, timestamp: clock };
      },
      onSent: () => undefined,
      onFailed: () => undefined,
      isConnected: () => true,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      spacingMs: 1000,
      maxAgeMs: 600_000,
    });
    q.enqueue(job('pn-1', 'PN', clock));
    q.enqueue(job('pn-2', 'PN', clock));
    await flush();
    q.rekey('PN', 'LID');
    q.enqueue(job('lid-1', 'LID', clock));
    await flush();
    expect(sent).toEqual([]);
    release();
    await flush(50);
    expect(sent.map((s) => s.id)).toEqual(['pn-1', 'pn-2', 'lid-1']);
    expect(sent[0]).toMatchObject({ target: 'PN', chat: 'PN' });
    expect(sent[1]).toMatchObject({ target: 'PN', chat: 'LID' });
    expect(sent[1]!.at - sent[0]!.at).toBeGreaterThanOrEqual(1000);
    q.stop();
  });
```

Run: `npx vitest run packages/server/src/messages/send-queue.test.ts`
Expected: FAIL — TypeScript error `targetJid does not exist in type SendJob` / `q.rekey is not a function`.

- [ ] **Step 2: Implement the queue changes**

`packages/server/src/messages/send-queue.ts`:
- in `SendJob` after `chatJid: string;`:

```ts
  /** JID the message is sent to (the customer's last inbound address); `chatJid` is the queue key */
  targetJid: string;
```

- `SendQueueDeps.presence?: (job: SendJob) => Promise<void>;`
- new fields after `lastSentAt`:

```ts
  /** chat → its send currently in WhatsApp's hands */
  private readonly inFlight = new Map<string, Promise<SendResult>>();
  /** merged chat → canonical chat, while the merged chat still has a send in flight */
  private readonly movedTo = new Map<string, string>();
```

- new public method after `restore`:

```ts
  /**
   * Chat `from` was merged into `to`: move its waiting jobs to `to` (creation order, `to`'s 1s
   * spacing). A job already being sent finishes under `from` with its own targetJid, and `to`
   * waits for it so the person never gets two sends at once.
   */
  rekey(from: string, to: string): void {
    if (from === to || this.stopped) return;
    const sending = this.inFlight.has(from);
    if (sending) this.movedTo.set(from, to);
    const src = this.queues.get(from);
    const moving = src ? src.splice(sending ? 1 : 0) : [];
    if (src && !src.length) this.queues.delete(from);
    const last = this.lastSentAt.get(from);
    if (last !== undefined) this.lastSentAt.set(to, Math.max(last, this.lastSentAt.get(to) ?? 0));
    if (!moving.length) return;
    let dst = this.queues.get(to);
    if (!dst) {
      dst = [];
      this.queues.set(to, dst);
    }
    // mutate in place: a running worker holds a reference to this array
    const keep = this.inFlight.has(to) ? 1 : 0;
    const rest = [...dst.slice(keep), ...moving.map((j) => ({ ...j, chatJid: to }))].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    dst.splice(keep, dst.length - keep, ...rest);
    this.kick(to);
  }

  private blockerFor(chatJid: string): Promise<SendResult> | null {
    for (const [from, to] of this.movedTo) {
      if (to !== chatJid) continue;
      const p = this.inFlight.get(from);
      if (p) return p;
    }
    return null;
  }
```

- in `run()`: the "no job" branch becomes

```ts
      if (!q || !job) {
        this.queues.delete(chatJid);
        this.movedTo.delete(chatJid);
        return;
      }
```

  after the spacing block (before presence) insert

```ts
      const blocker = this.blockerFor(chatJid);
      if (blocker) {
        await blocker.catch(() => undefined);
        continue; // re-check spacing after the merged chat's last send
      }
```

  replace the presence/send section with

```ts
      if (this.deps.presence) await this.deps.presence(job).catch(() => undefined);
      if (this.stopped) return;
      // a merge may have moved this job to another chat while we awaited presence
      if (this.queues.get(chatJid)?.[0] !== job) continue;

      const p = this.deps.send(job);
      this.inFlight.set(chatJid, p);
      try {
        const r = await p;
        q.shift();
        this.markSent(chatJid);
        this.safe(() => this.deps.onSent(job, r));
      } catch (err) {
        if (isUnavailable(err)) {
          // Connection dropped mid-send: stay pending. Our status may still read 'open' for a moment
          // (the close event lags the failed send), so back off briefly before re-checking.
          if (this.deps.isConnected()) await this.sleep(UNAVAILABLE_RETRY_MS);
          continue;
        }
        q.shift();
        this.markSent(chatJid);
        this.safe(() => this.deps.onFailed(job, err instanceof Error ? err : new Error(String(err))));
      } finally {
        if (this.inFlight.get(chatJid) === p) this.inFlight.delete(chatJid);
      }
```

  and add

```ts
  private markSent(chatJid: string): void {
    const t = this.now();
    this.lastSentAt.set(chatJid, t);
    const moved = this.movedTo.get(chatJid);
    if (moved) this.lastSentAt.set(moved, Math.max(t, this.lastSentAt.get(moved) ?? 0));
  }
```

  (Note: `finally` runs before the `continue` of the unavailable branch completes its loop iteration — the in-flight entry is cleared before the retry, as required.)

Run: `npx vitest run packages/server/src/messages/send-queue.test.ts` → PASS (10 tests).

- [ ] **Step 3: Write the failing messages-service tests**

Append to `packages/server/test/messages.test.ts` (add `import { getIdentity } from '../src/chats/identity.js';`):

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

  it('a send queued in the PN chat during a merge is delivered once, to the PN, from the LID chat', async () => {
    const { user } = await createUserAndLogin(t, { role: 'agent' });
    await inbound('P-1', PN, 1000);
    t.wa.setConnected(false);
    getMessages(t.ctx).sendText(PN, { clientId: 'queued-1', text: 'queued' }, user.id);
    getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
    expect(
      t.ctx.db.prepare("SELECT chat_jid FROM messages WHERE client_id = 'queued-1'").get(),
    ).toEqual({ chat_jid: LID });
    t.wa.setConnected(true);
    await waitFor(() => t.wa.sent.length === 1);
    await settle();
    expect(t.wa.sent.map((s) => s.chatJid)).toEqual([PN]);
    expect(
      t.ctx.db.prepare("SELECT chat_jid, status FROM messages WHERE client_id = 'queued-1'").get(),
    ).toEqual({ chat_jid: LID, status: 'delivered' });
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

Add `import { createMessageService } from '../src/messages/service.js';` to the file. (`status: 'delivered'` comes from the fake adapter's `setImmediate` delivered ack; `settle()` lets it land.)

Run: `npx vitest run packages/server/test/messages.test.ts`
Expected: FAIL — first test `expected '123456789@lid' to be '60111111111@s.whatsapp.net'`; receipts test receives one LID group containing both ids.

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

`packages/server/src/messages/service.ts`:
- in `sendJob` (lines 137-182; since #18 the echo guard is a `reconciliations` closure released by `onSent`/`onFailed`, not a `finally`):
  - keep the AI check `ctx.services.ai?.canSend(job.chatJid, …)` unchanged — `job.chatJid` is the canonical chat (re-keyed by `rekey`), which is where `ai_chat_state` lives after a merge;
  - use `job.targetJid` as the first argument of `ctx.wa.sendText(…)` and `ctx.wa.sendMedia(…)`;
  - in the `reconciliations.set(job.localId, () => { … })` closure replace `if (inflight.get(job.chatJid) === guard) inflight.delete(job.chatJid);` with:

```ts
        // the guard may also have been copied to the canonical chat by a merge
        for (const [k, v] of inflight) if (v === guard) inflight.delete(k);
```

- queue construction: `presence: (job) => ctx.wa.sendPresence(job.targetJid, 'composing'),`
- `jobFromRow`'s `base` adds `targetJid: r.wa_remote_jid ?? r.chat_jid,`
- `sendText` row: `wa_remote_jid: repo.lastInboundRemoteJid(jid) ?? jid,`; `sendMedia` row: same.
- after `const queue = new SendQueue({…});` add:

```ts
  // A merged chat's waiting sends and echo guard move to the canonical chat (Task 5 emits this).
  const onMerged = ({ from, to }: { from: string; to: string }) => {
    queue.rekey(from, to);
    const p = inflight.get(from);
    if (p && !inflight.has(to)) inflight.set(to, p);
  };
  ctx.bus.on('chat:merged', onMerged);
```

- `shutdown()` becomes `{ ctx.bus.off('chat:merged', onMerged); queue.stop(); }`.

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

- [ ] **Step 5: Write the failing AI Sales Agent tests**

The AI Sales Agent (#18) keeps per-chat state in `ai_chat_state` (moved by `mergeChat`, Task 3) but its
timers and running replies are in-memory maps keyed by chat JID, and `respond(jid)` re-reads the chat
and state by that JID. Without this step a PN chat that merges while the AI's 10-second timer runs is
never answered, and a reply being written during the merge is sent but not recorded on the LID state,
so the AI answers the same customer message twice.

Append to `packages/server/test/ai.test.ts` (add `import { getIdentity } from '../src/chats/identity.js';`):

```ts
const PN = '60111111111@s.whatsapp.net';
const LID = '123456789@lid';
const aiStateOf = (chatJid: string) =>
  t.ctx.db.prepare('SELECT * FROM ai_chat_state WHERE chat_jid = ?').get(chatJid) as
    | { last_replied_message_id: string | null; awaiting_confirmation: number; paused: number }
    | undefined;

it('follows a phone-number chat merged into its WhatsApp ID chat: one reply, to the address the customer used', async () => {
  clock();
  await incoming('p-1', 'What are your opening hours?', 'live', PN);
  getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
  expect(t.ctx.db.prepare('SELECT chat_jid FROM ai_chat_state').all()).toEqual([{ chat_jid: LID }]);
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 2000);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.wa.sent.map((s) => s.chatJid)).toEqual([PN]);
  const ai = t.ctx.services.ai!.status().member!;
  expect(getChats(t.ctx).get(LID)?.assignedTo).toBe(ai.id);
  expect(aiStateOf(LID)).toMatchObject({ last_replied_message_id: 'p-1' });
  expect(
    t.ctx.db.prepare('SELECT chat_jid, wa_remote_jid FROM messages WHERE sent_by_user_id = ?').all(ai.id),
  ).toEqual([{ chat_jid: LID, wa_remote_jid: PN }]);
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(t.wa.sent).toHaveLength(1);
});

it('a reply being written when the chats merge is sent once and recorded on the merged chat', async () => {
  clock();
  let release!: () => void;
  vi.mocked(provider.generate).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return { reply: 'We open at 9am. Has this answered your question?', action: 'ask_resolution' };
  });
  await incoming('p-1', 'What are your opening hours?', 'live', PN);
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
  release();
  await vi.advanceTimersByTimeAsync(2000);
  expect(t.wa.sent.map((s) => s.chatJid)).toEqual([PN]);
  expect(aiStateOf(LID)).toMatchObject({ last_replied_message_id: 'p-1', awaiting_confirmation: 1 });
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(t.wa.sent).toHaveLength(1);
});

it('a merge that gives the chat to a teammate stops the AI', async () => {
  clock();
  const teammate = human('teammate');
  await incoming('l-1', 'Hello', 'live', LID);
  getChats(t.ctx).patch(LID, { assignedTo: teammate.id }, actor.userId);
  await incoming('p-1', 'What are your opening hours?', 'live', PN);
  getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
  await vi.advanceTimersByTimeAsync(AI_FALLBACK_MS + 2000);
  expect(provider.generate).not.toHaveBeenCalled();
  expect(t.wa.sent).toHaveLength(0);
  expect(getChats(t.ctx).get(LID)?.assignedTo).toBe(teammate.id);
  expect(aiStateOf(LID)).toMatchObject({ paused: 1 });
});
```

Run: `npx vitest run packages/server/test/ai.test.ts`
Expected: FAIL — first test `expected "spy" to be called 1 times, but got 0 times` (the PN timer fires, finds no PN state and gives up); second test `expected [] to deeply equal [ '60111111111@s.whatsapp.net' ]` (the running reply re-reads the PN state, finds none and drops the answer; without the generation hand-over in Step 6 it would instead be sent but not recorded on the LID state and answered twice). The third test is a guard (passes once Tasks 3 and 5 are in).

- [ ] **Step 6: Make the AI Sales Agent follow merges**

`packages/server/src/ai/service.ts`:

Replace the head of `respond` (lines 290-306, from `async function respond(jid: string) {` through `const history = messages.list(jid, { limit: 20 }).messages;`) with:

```ts
  async function respond(start: string) {
    if (!eligible(start)) return;
    const user = member()!;
    const customerId = state(start)!.last_customer_message_id!;
    const controller = new AbortController();
    generations.set(start, controller);
    // A merge (phone number → WhatsApp ID) can re-key this chat mid-reply: follow the canonical chat.
    const key = () => chats.resolveJid(start);
    const owned = () =>
      !controller.signal.aborted &&
      chats.get(key())?.assignedTo === user.id &&
      state(key())?.last_customer_message_id === customerId &&
      !state(key())?.paused &&
      !member()?.disabled;
    try {
      if (chats.get(key())!.assignedTo === null)
        chats.patch(key(), { assignedTo: user.id }, user.id);
      if (!owned()) return;
      const current = settings();
      const history = messages.list(key(), { limit: 20 }).messages;
```

In the rest of `respond`, replace every remaining use of `jid` with `key()`: the two `log.warn({ jid, … })` calls become `log.warn({ jid: key(), … })`, `sendReply(key(), user.id, customerId, decision.reply, controller.signal)`, the final `UPDATE ai_chat_state … WHERE chat_jid = ?` runs with `key()`, `handoff(key(), user.id)` (both calls), `chats.patch(key(), { status: 'resolved' }, user.id)` and `meta: { chatJid: key() }`. Replace the `finally` body with:

```ts
      // the generation may have been moved to the canonical chat by onMerged
      for (const [k, c] of generations) if (c === controller) generations.delete(k);
```

After `onDisabled` add:

```ts
  /** A PN chat merged into its LID chat (ai_chat_state already moved by mergeChat): move timers and work. */
  const onMerged = ({ from, to }: { from: string; to: string }) => {
    const timer = timers.get(from);
    if (timer) clearTimeout(timer);
    timers.delete(from);
    const generation = generations.get(from);
    if (generation) {
      generations.delete(from);
      // respond() follows the canonical chat; cancel(to) must reach it. Two replies at once: keep one.
      if (generations.has(to)) generation.abort();
      else generations.set(to, generation);
    }
    const s = state(to);
    // schedule() cancels pending AI sends of `to`, so never while a reply is being written there.
    if (!generations.has(to) && s && !s.paused && s.due_at !== null)
      schedule(to, Math.max(Date.now() + 300, s.due_at));
  };
```

(`identity.ts` publishes `chat:merged` only after the merge transaction commits, so `state(to)` already reads the moved row.)

register it with `.on('chat:merged', onMerged)` after `.on('user:disabled', onDisabled)` and unregister it in `shutdown()` with `.off('chat:merged', onMerged)` after `.off('user:disabled', onDisabled)`.

`canSend` is unchanged: the send queue passes the canonical `job.chatJid` (re-keyed by `rekey`), whose `ai_chat_state` row `mergeChat` kept. `onChat` needs no change either: the merge publishes `chat:updated` for the LID chat, which pauses the AI when a teammate owns it and clears its state when the merged chat is resolved.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/server/src/messages/send-queue.test.ts packages/server/test/messages.test.ts packages/server/test/chats.test.ts packages/server/src/wa-bridge/bridge.test.ts packages/server/test/ai.test.ts`
Expected: PASS (including every pre-existing AI ownership, echo and cancellation test).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/messages/send-queue.ts packages/server/src/messages/send-queue.test.ts packages/server/src/messages/repo.ts packages/server/src/messages/service.ts packages/server/src/chats/service.ts packages/server/test/messages.test.ts packages/server/src/ai/service.ts packages/server/test/ai.test.ts
git commit -m "feat(server): reply to the customer's last address, rekey queued sends on merge, per-address receipts, AI follows merges"
```

---

## Task 8: Routes resolve merged JIDs, `chat:merged` socket event, connect sweep, push title

**Files:**
- Modify: `packages/server/src/routes/chats.ts` (`chatJidParam`; avatar, detail, patch, read)
- Modify: `packages/server/src/routes/messages.ts`, `packages/server/src/routes/notes.ts`
- Modify: `packages/server/src/realtime/socket.ts` (broadcast `chat:merged` to `all`)
- Modify: `packages/server/src/wa-bridge/bridge.ts:26-44` (sweep after alias recovery)
- Modify: `packages/server/src/push/service.ts:218` (title fallback)
- Modify: `packages/server/src/i18n/messages.ts` (`push.unknownContact` in en/ms/zh-CN)
- Test: `packages/server/test/chats.test.ts`, `packages/server/test/realtime.test.ts`, `packages/server/src/wa-bridge/bridge.test.ts`, `packages/server/src/push/service.test.ts`

**Interfaces:**
- Consumes: `ChatService.resolveJid` (Task 5), `getIdentity(ctx).sweep()` (Task 5), `ServerToClientEvents['chat:merged']` (Task 1), `FakeWaAdapter.setContactAliases` (Task 4).
- Produces: `export function chatJidParam(ctx: AppContext, params: unknown): string` in `routes/chats.ts`; every `/api/chats/:jid*` route serves the canonical chat for a merged PN; socket `chat:merged` to room `all`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('chats routes', …)` in `packages/server/test/chats.test.ts` (add `import { getIdentity } from '../src/chats/identity.js';`, `import { rmSync, writeFileSync } from 'node:fs';`, `import { join } from 'node:path';`):

```ts
  it('old phone-number URLs (links, push notifications, a second tab) resolve to the merged chat', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const h = authHeaders(cookie);
    const PN = '60155555555@s.whatsapp.net';
    const LID = '555555555@lid';
    await seedChat(PN, 'Eve', 1000);
    getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');

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

  it('a chat left split by a failed backup stays reachable under its own JID', async () => {
    const { cookie } = await createUserAndLogin(t, { role: 'agent' });
    const PN = '60166666666@s.whatsapp.net';
    const LID = '666666666@lid';
    await seedChat(PN, 'Fay', 1000);
    await seedChat(LID, 'Fay', 2000);
    const backups = join(t.ctx.config.dataDir, 'backups');
    rmSync(backups, { recursive: true, force: true });
    writeFileSync(backups, 'not a directory');
    getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
    const detail = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(PN)}`,
      headers: authHeaders(cookie),
    });
    expect(detail.json().chat.jid).toBe(PN);
  });
```

Append inside `describe('realtime', …)` in `packages/server/test/realtime.test.ts`:

```ts
  it('broadcasts chat:merged to every signed-in member', async () => {
    const { cookie } = await createUserAndLogin(t);
    const s = connect(cookie);
    await waitConnect(s);
    const p = waitEvent(s, 'chat:merged');
    t.ctx.bus.emit('chat:merged', { from: '60111@s.whatsapp.net', to: '111@lid' });
    const [payload] = (await p) as [{ from: string; to: string }];
    expect(payload).toEqual({ from: '60111@s.whatsapp.net', to: '111@lid' });
  });
```

Append inside the `describe('one chat per person …')` block of `packages/server/src/wa-bridge/bridge.test.ts` (add `import { rmSync, writeFileSync } from 'node:fs';` and `import { join } from 'node:path';`):

```ts
  it('reconnect recovery merges existing duplicates from the local key store', async () => {
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'old', senderName: 'Aisyah' });
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, body: 'new', senderName: 'Aisyah' });
    await settle();
    expect(chatJids()).toEqual([LID, PN]);
    const merged: Array<{ from: string; to: string }> = [];
    t.ctx.bus.on('chat:merged', (p) => merged.push(p));
    t.wa.setContactAliases([{ jid: PN, alias: LID }]);
    t.wa.setConnected(false);
    t.wa.setConnected(true);
    await settle();
    expect(chatJids()).toEqual([LID]);
    expect(merged).toEqual([{ from: PN, to: LID }]);
    expect(getChats(t.ctx).get(LID)!.unreadCount).toBe(2);
  });

  it('the connect sweep merges a pair left split by an earlier failed backup', async () => {
    t.wa.simulateIncoming({ id: 'P-1', chatJid: PN, body: 'old' });
    t.wa.simulateIncoming({ id: 'L-1', chatJid: LID, body: 'new' });
    await settle();
    const backups = join(t.ctx.config.dataDir, 'backups');
    rmSync(backups, { recursive: true, force: true });
    writeFileSync(backups, 'not a directory');
    getIdentity(t.ctx).learn([{ jid: PN, alias: LID }], 'contacts');
    expect(chatJids()).toEqual([LID, PN]);
    rmSync(backups, { force: true });
    t.wa.setConnected(false);
    t.wa.setConnected(true);
    await settle();
    expect(chatJids()).toEqual([LID]);
  });
```

Append inside `describe('PushService', …)` in `packages/server/src/push/service.test.ts`:

```ts
  it('titles a chat without a name or phone "Unknown contact" and links its canonical JID', async () => {
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

Run: `npx vitest run packages/server/test/chats.test.ts packages/server/test/realtime.test.ts packages/server/src/wa-bridge/bridge.test.ts packages/server/src/push/service.test.ts`
Expected: FAIL — the PN messages URL returns `[]` instead of the merged history (the detail route already falls back through `ChatService.get` from Task 5, the other routes do not); `timeout waiting for chat:merged`; sweep test still has two chats; push title is `''`. ("a chat left split…" and "reconnect recovery…" already pass after Task 5 and guard against regressions.)

- [ ] **Step 2: Route resolution**

`packages/server/src/routes/chats.ts`, after `JidParams`:

```ts
/** Parses `:jid`; a merged phone-number JID resolves to its WhatsApp ID chat (old links, push). */
export function chatJidParam(ctx: AppContext, params: unknown): string {
  const { jid } = parse(JidParams, params);
  return getChats(ctx).resolveJid(jid);
}
```

Replace each `const { jid } = parse(JidParams, req.params);` with `const jid = chatJidParam(ctx, req.params);` in `routes/chats.ts` (4 handlers: avatar, detail, patch, read), `routes/messages.ts` (3 handlers) and `routes/notes.ts` (2 handlers). In `messages.ts` and `notes.ts` change `import { JidParams } from './chats.js';` to `import { chatJidParam } from './chats.js';`.

- [ ] **Step 3: Socket broadcast**

`packages/server/src/realtime/socket.ts`: add `ChatMergedPayload` to the shared type import; add `const onChatMerged = (p: ChatMergedPayload) => io.to('all').emit('chat:merged', p);` next to `onChatEvent`; register `bus.on('chat:merged', onChatMerged);` after `bus.on('chat:event', onChatEvent);` and `bus.off('chat:merged', onChatMerged);` after `bus.off('chat:event', onChatEvent);`.

- [ ] **Step 4: Connect sweep**

`packages/server/src/wa-bridge/bridge.ts`: add `import { getIdentity } from '../chats/identity.js';` and in `restoreContactAliases` replace the success block with:

```ts
        chats.upsertContactAliases(aliases);
        // Pairs learned while a backup failed (or by an older build) still have two chats.
        const merged = getIdentity(ctx).sweep();
        log.info(
          { contactCount: jids.length, aliasCount: aliases.length, mergedCount: merged.length },
          'local contact alias recovery completed',
        );
```

- [ ] **Step 5: Push title**

`packages/server/src/i18n/messages.ts`: add `unknownContact` under `push` in each catalog — en: `unknownContact: 'Unknown contact',`; ms: `unknownContact: 'Kenalan tidak dikenali',`; zh-CN: `unknownContact: '未知联系人',`.

`packages/server/src/push/service.ts`: `title: (chat.name || t(locale, 'push.unknownContact')).slice(0, 200),`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/server/test/chats.test.ts packages/server/test/realtime.test.ts packages/server/src/wa-bridge/bridge.test.ts packages/server/src/push/service.test.ts packages/server/src/i18n packages/server/test/messages.test.ts packages/server/test/contact-names.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @wa-team-inbox/server` → no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/chats.ts packages/server/src/routes/messages.ts packages/server/src/routes/notes.ts packages/server/src/realtime/socket.ts packages/server/src/wa-bridge/bridge.ts packages/server/src/wa-bridge/bridge.test.ts packages/server/src/push/service.ts packages/server/src/push/service.test.ts packages/server/src/i18n/messages.ts packages/server/test/chats.test.ts packages/server/test/realtime.test.ts
git commit -m "feat(server): resolve merged JIDs in routes, broadcast chat:merged, merge leftovers on connect"
```

---

## Task 9: Web — real phone or "Phone number hidden", never LID digits (EN/MS/zh-CN)

**Files:**
- Modify: `apps/web/src/lib/jid.ts` (`formatJid` blanks `@lid`; `formatPhone`)
- Create: `apps/web/src/lib/jid.test.ts`
- Create: `apps/web/src/inbox/chat-title.ts`
- Modify: `apps/web/src/inbox/ChatListItem.tsx:8,31-35`
- Modify: `apps/web/src/inbox/ConversationHeader.tsx:13,44-45,85-88`
- Create: `apps/web/src/inbox/ChatListItem.test.tsx`, `apps/web/src/inbox/ConversationHeader.test.tsx`
- Modify: `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json`, `apps/web/src/i18n/locales/{en,ms,zh-CN}/admin.json`
- Modify: `apps/web/src/admin/audit-actions.ts`; Create: `apps/web/src/admin/audit-actions.test.ts`

**Interfaces:**
- Consumes: `Chat.phone` (Task 1).
- Produces: `export function formatPhone(chat: Pick<Chat, 'phone'>): string | null`; `export function chatTitle(chat: Pick<Chat, 'name' | 'phone' | 'type'>, t: TFunction<'inbox'>): string`; i18n keys `inbox:chatListItem.unknownContact`, `inbox:header.phoneHidden`, `admin:audit.actions.chatMerge`.

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

it('labels automatic chat merges in the audit log', () => {
  expect(auditActionLabel('chat.merge', i18n.getFixedT('en', 'admin'))).toBe('Chats merged');
});
```

Run: `npx vitest run apps/web/src/lib/jid.test.ts apps/web/src/inbox/ConversationHeader.test.tsx apps/web/src/inbox/ChatListItem.test.tsx apps/web/src/admin/audit-actions.test.ts`
Expected: FAIL — `formatPhone is not a function`, heading `123456789012345`, `expected 'chat.merge' to be 'Chats merged'`.

- [ ] **Step 2: Implement helpers, components and catalogs**

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

Run: `npm run typecheck -w @wa-team-inbox/web && npx eslint apps/web/src/lib/jid.ts apps/web/src/inbox/chat-title.ts apps/web/src/inbox/ChatListItem.tsx apps/web/src/inbox/ConversationHeader.tsx apps/web/src/admin/audit-actions.ts`
Expected: no errors (no literal strings, token classes only).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/jid.ts apps/web/src/lib/jid.test.ts apps/web/src/inbox/chat-title.ts apps/web/src/inbox/ChatListItem.tsx apps/web/src/inbox/ChatListItem.test.tsx apps/web/src/inbox/ConversationHeader.tsx apps/web/src/inbox/ConversationHeader.test.tsx apps/web/src/i18n/locales/en/inbox.json apps/web/src/i18n/locales/ms/inbox.json apps/web/src/i18n/locales/zh-CN/inbox.json apps/web/src/i18n/locales/en/admin.json apps/web/src/i18n/locales/ms/admin.json apps/web/src/i18n/locales/zh-CN/admin.json apps/web/src/admin/audit-actions.ts apps/web/src/admin/audit-actions.test.ts
git commit -m "feat(web): show the real phone number or 'Phone number hidden', never WhatsApp ID digits"
```

---

## Task 10: Web — follow merged chats live and from old links

**Files:**
- Modify: `apps/web/src/api/queries.ts` (`applyChatMergedInCache`)
- Modify: `apps/web/src/api/socket.ts:115-125` (`chat:merged` handler)
- Create: `apps/web/src/inbox/useCanonicalChatRedirect.ts`
- Modify: `apps/web/src/inbox/InboxPage.tsx:35-42`
- Test: `apps/web/src/api/queries.test.ts`, `apps/web/src/api/socket.test.tsx`, `apps/web/src/inbox/InboxPage.test.tsx`

**Interfaces:**
- Consumes: `ServerToClientEvents['chat:merged']`, `ChatMergedPayload` (Task 1); server detail responses carry the canonical `chat.jid` (Task 8).
- Produces: `export function applyChatMergedInCache(qc: QueryClient, p: ChatMergedPayload): void`; `export function useCanonicalChatRedirect(jid: string | null): void`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/api/queries.test.ts` change the imports to `import type { Chat, ChatDetailResponse, Message } from '@wa-team-inbox/shared';` and `import { applyChatMergedInCache, patchMessageInCache, qk, upsertMessageInCache, type ChatsData, type MessagesData } from './queries';`, then append:

```ts
describe('chat:merged cache handling', () => {
  const PN = '60111@s.whatsapp.net';
  const LID = '111@lid';
  const mk = (jid: string): Chat => ({
    jid,
    type: 'dm',
    name: 'Aisyah',
    avatarUrl: null,
    unreadCount: 0,
    lastMessageAt: 1,
    lastMessagePreview: 'x',
    status: 'open',
    assignedTo: null,
    updatedAt: 1,
    phone: '60111',
  });

  it('drops the merged chat from lists, points its detail at the canonical chat and forgets its messages', () => {
    const qc = new QueryClient();
    const listKey = qk.chats({ assigned: 'any', status: 'open' });
    qc.setQueryData<ChatsData>(listKey, {
      pages: [{ chats: [mk(PN), mk(LID)], nextCursor: null }],
      pageParams: [null],
    });
    qc.setQueryData<ChatDetailResponse>(qk.chat(PN), { chat: mk(PN), events: [] });
    qc.setQueryData<MessagesData>(qk.messages(PN), {
      pages: [{ messages: [], nextBefore: null }],
      pageParams: [null],
    });
    applyChatMergedInCache(qc, { from: PN, to: LID });
    expect(qc.getQueryData<ChatsData>(listKey)!.pages[0]!.chats.map((c) => c.jid)).toEqual([LID]);
    expect(qc.getQueryData<ChatDetailResponse>(qk.chat(PN))!.chat.jid).toBe(LID);
    expect(qc.getQueryData(qk.messages(PN))).toBeUndefined();
    qc.clear();
  });
});
```

Append to `apps/web/src/api/socket.test.tsx` (add `import type { ChatDetailResponse } from '@wa-team-inbox/shared';` and `import { qk } from './queries';`):

```tsx
it('a chat:merged event redirects an open merged chat to the canonical chat', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RealtimeProvider>
        <span />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(socket.listeners.has('chat:merged')).toBe(true));
  const pn = '60111@s.whatsapp.net';
  qc.setQueryData<ChatDetailResponse>(qk.chat(pn), {
    chat: {
      jid: pn,
      type: 'dm',
      name: 'Aisyah',
      avatarUrl: null,
      unreadCount: 0,
      lastMessageAt: 1,
      lastMessagePreview: 'x',
      status: 'open',
      assignedTo: null,
      updatedAt: 1,
      phone: '60111',
    },
    events: [],
  });
  act(() => socket.listeners.get('chat:merged')!({ from: pn, to: '111@lid' }));
  expect(qc.getQueryData<ChatDetailResponse>(qk.chat(pn))!.chat.jid).toBe('111@lid');
  qc.clear();
});
```

Append inside `describe('InboxPage', …)` in `apps/web/src/inbox/InboxPage.test.tsx`:

```tsx
  it('follows an old phone-number link to the merged WhatsApp ID chat', async () => {
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

Run: `npx vitest run apps/web/src/api/queries.test.ts apps/web/src/api/socket.test.tsx apps/web/src/inbox/InboxPage.test.tsx`
Expected: FAIL — `applyChatMergedInCache is not a function`; no `chat:merged` listener; InboxPage never requests the LID messages.

- [ ] **Step 2: Implement cache handling, socket listener and redirect**

`apps/web/src/api/queries.ts` (add `ChatMergedPayload` to the shared type import), after `upsertChatInCache`:

```ts
/**
 * A phone-number chat was merged into its WhatsApp ID chat: drop `from` from every list, point an
 * open `from` detail at `to` (useCanonicalChatRedirect then navigates) and refresh `to`.
 */
export function applyChatMergedInCache(qc: QueryClient, p: ChatMergedPayload): void {
  qc.setQueriesData<ChatsData>({ queryKey: qk.chatsAll }, (old) => {
    if (!old?.pages) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        chats: page.chats.filter((c) => c.jid !== p.from),
      })),
    };
  });
  qc.setQueryData<ChatDetailResponse>(qk.chat(p.from), (old) =>
    old ? { ...old, chat: { ...old.chat, jid: p.to } } : old,
  );
  qc.removeQueries({ queryKey: qk.messages(p.from), exact: true });
  qc.removeQueries({ queryKey: qk.notes(p.from), exact: true });
  void qc.invalidateQueries({ queryKey: qk.chat(p.to) });
  void qc.invalidateQueries({ queryKey: qk.messages(p.to) });
  void qc.invalidateQueries({ queryKey: qk.notes(p.to) });
}
```

`apps/web/src/api/socket.ts`: add `applyChatMergedInCache` to the `./queries` import and after the `chat:event` listener:

```ts
    socket.on('chat:merged', (p) => {
      applyChatMergedInCache(qc, p);
      refreshChats();
    });
```

`apps/web/src/inbox/useCanonicalChatRedirect.ts`:

```ts
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChat } from '../api/queries';
import { encodeJid } from '../lib/jid';

/** Old links, push notifications and merged chats: follow the server's canonical chat JID. */
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

- [ ] **Step 3: Run the tests**

Run: `npx vitest run apps/web/src/api/queries.test.ts apps/web/src/api/socket.test.tsx apps/web/src/inbox/InboxPage.test.tsx apps/web/src/inbox/ChatList.test.tsx`
Expected: PASS.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck -w @wa-team-inbox/web && npx eslint apps/web/src/api/queries.ts apps/web/src/api/socket.ts apps/web/src/inbox/useCanonicalChatRedirect.ts apps/web/src/inbox/InboxPage.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/queries.ts apps/web/src/api/queries.test.ts apps/web/src/api/socket.ts apps/web/src/api/socket.test.tsx apps/web/src/inbox/useCanonicalChatRedirect.ts apps/web/src/inbox/InboxPage.tsx apps/web/src/inbox/InboxPage.test.tsx
git commit -m "feat(web): follow merged chats live and redirect old phone-number links"
```

---

## Task 11: CHANGELOG, LEARNINGS and AGENTS architecture note

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `docs/LEARNINGS.md` (append; the file may already carry an uncommitted 2026-10-05 entry from planning — keep it)
- Modify: `AGENTS.md` (Architecture → WhatsApp boundary)

**Interfaces:** none (documentation).

- [ ] **Step 1: CHANGELOG**

In `CHANGELOG.md`, under `## [Unreleased]` (currently empty — `## [0.1.20]` with the AI Sales Agent follows it), add:

```markdown
### Fixed

- Chats for the same person under phone number and WhatsApp ID are merged: one inbox row per
  customer, with all messages, notes, history and unread counts together. Existing duplicates are
  merged automatically on the first connection after the update (a backup named
  `app-premerge-YYYYMMDD.db` is written first and kept 30 days). Replies, including the AI Sales
  Agent's, go to the address the customer last used, and the AI Sales Agent continues in the merged
  chat without answering twice; a teammate who owns either chat keeps it over the AI. When WhatsApp
  has not revealed a customer's number, the chat shows "Phone number hidden" instead of an internal
  ID. Old links and notifications open the merged chat.
```

- [ ] **Step 2: LEARNINGS**

Append under the most fitting section of `docs/LEARNINGS.md`:

```markdown
- 2026-10-05 — One customer showed as two inbox rows (phone-number JID and LID) → `chats.jid` was the raw `remoteJid` and PN↔LID pairs were only used for names → key chats by the LID once known, route PNs through `jid_aliases`, merge duplicates in one transaction after a pre-merge backup, and resolve `:jid` in every route so old links keep working.
- 2026-10-05 — A merge needs a backup first, but alias learning ran inside `db.transaction` → SQLite refuses `VACUUM INTO` inside a transaction → learn aliases (and anything that can merge) before opening a transaction; check `db.inTransaction` before backing up.
- 2026-10-05 — The merge plan was written before the AI Sales Agent (#18) landed: `ai_chat_state` cascades away with a deleted chat row and the AI keys timers and running replies by chat JID → anything that re-keys or deletes a chat must move every `chat_jid`-keyed table (check `REFERENCES chats` / `ON DELETE CASCADE` in all migrations) and notify in-memory per-chat workers (`chat:merged`).
```

- [ ] **Step 3: AGENTS.md**

In `AGENTS.md`, at the end of the **WhatsApp boundary** paragraph add:

```markdown
One person can arrive under a phone-number JID and a LID: chats are keyed by the LID once known
(`chats/aliases.ts`, table `jid_aliases`), PN chats are merged into it by `chats/merge.ts` after a
one-time pre-merge backup (`chats/identity.ts`), routes resolve `:jid` through `chatJidParam`, and
replies go to the `wa_remote_jid` of the last inbound message. Never merge on a name or number match.
A merge moves every `chat_jid`-keyed row (messages, events, notes, `ai_chat_state`) and publishes
`chat:merged` so the send queue and the AI Sales Agent re-key their in-memory per-chat work.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/LEARNINGS.md AGENTS.md
git commit -m "docs: changelog, learnings and architecture note for merged phone-number/LID chats"
```

---

## Task 12: Consolidated verification and manual real-WhatsApp smoke

Run once, alone on the machine (no other agents running tests). Only the orchestrator runs this task.

- [ ] **Step 1: Typecheck everything**

Run: `npm run typecheck` → no errors.

- [ ] **Step 2: Full unit suite**

Run: `npm test` → all projects PASS. If native PowerShell tests time out under load, rerun only those files with one worker (see LEARNINGS) before changing anything.

- [ ] **Step 3: Lint**

Run: `npm run lint` → no errors.

- [ ] **Step 4: Web build**

Run: `npm run build -w @wa-team-inbox/web` → succeeds.

- [ ] **Step 5: e2e (once)**

Run: `npm run e2e` → PASS. Then `node e2e/screens.smoke.mjs <url> <outDir>` and `SMOKE_LOCALE=ms node e2e/screens.smoke.mjs <url> <outDir>` against a `--fake-wa` server on a temp data dir; review the conversation header at 360px in Malay ("Nombor telefon disembunyikan" must not overflow).

- [ ] **Step 6: Fake-WA manual check (agent may do this; temp data dir only)**

```bash
npx tsx packages/server/src/cli.ts --data <scratchpad>/lidpn --port 7433 --fake-wa --mode dev --web-dist apps/web/dist
```

Sign in, then `POST /api/dev/fake-incoming` with `{ "chatJid": "60111111111@s.whatsapp.net", "text": "one" }`, then `{ "chatJid": "123456789@lid", "chatJidAlt": "60111111111@s.whatsapp.net", "text": "two" }`. Expect one chat whose header shows `+60111111111`, `backups/app-premerge-*.db` in the temp data dir, and a `"chats merged"` line (`mod:"contacts"`) in `<data>/logs/*.log`. Open `/chats/60111111111%40s.whatsapp.net` and confirm it redirects to the LID URL.

- [ ] **Step 7: Owner-only real-WhatsApp smoke (spec §12; on a linked TEST number, never the live number; agents must not send messages)**

Checklist for the owner, recording results in the PR:
1. After upgrading, the first connect writes `backups/app-premerge-YYYYMMDD.db` and logs `chats merged` lines with counts; the inbox has one row per person.
2. A live message from a customer whose chat was PN-keyed arrives with `remoteJidAlt` (check `wa_remote_jid` and `jid_aliases.source = 'message'`) and lands in the LID chat.
3. History sync after relink: `remoteJidAlt` is present on history messages; no PN rows reappear.
4. Reply in a merged chat: the customer receives it (target = last inbound `wa_remote_jid`, LID and PN both tried across two customers); our own echo is not duplicated.
5. Read receipts: blue ticks appear for messages that arrived under the LID and under the PN.
6. `lid-mapping` key-store coverage: count of LID chats with `phone` set before/after first connect; chats still showing "Phone number hidden" are the ones WhatsApp has not revealed.
7. Push notification from before the upgrade (PN URL) opens the merged chat.
8. With the AI Sales Agent enabled on the test install, a second test phone writes to the linked number; after its chat merges, the AI answers once, to the address that phone used, and `ai_chat_state` has a single row for the LID chat.

- [ ] **Step 8: Report**

State in the PR description: test/typecheck/lint/build/e2e results, and either the owner's smoke results or "Baileys changes untested against real WhatsApp".
