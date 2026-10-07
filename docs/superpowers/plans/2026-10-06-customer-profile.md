# Customer profile (lead info) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every teammate can see and edit a customer profile (name, company, email, other phone,
address/area, tags) on a customer's direct chat. The profile name is used across the inbox and on
that customer's group-chat messages.

**Architecture:**

- New tables `customer_profiles` and `customer_tags`, keyed by the customer's direct chat JID. A new
  `customers` server module (repo + service + routes) owns them.
- The chat read model joins the profile, so `Chat.name`, `Chat.tags` and `Chat.whatsappName` come
  from one place (`rowToChat`). Search and the tag filter extend the existing chat list query.
- Duplicate merges carry profiles along. Group messages gain `senderProfile`, resolved through the
  existing `AliasStore.route()`.
- The web adds a Customer panel next to Notes, tag chips and a tag filter in the inbox, and a profile
  name with a popover on group messages.

**Tech Stack:**

- Node 22, TypeScript strict, Fastify, better-sqlite3, zod (`packages/shared`), Vitest.
- React + TanStack Query + shadcn/ui, i18next (en / ms / zh-CN), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-06-customer-profile-design.md`

## Global Constraints

- Zod schemas in `packages/shared` change first. The server and web import them; never duplicate shapes.
- Migrations are append-only: the new file is `007_customer_profiles.sql`, and existing migrations never change.
- Profiles exist only for direct chats (`chats.type = 'dm'`). Group chats return 400 for profile routes.
- Field limits:
  - name ≤ 120, company ≤ 120, email ≤ 254 (valid email shape), otherPhone ≤ 32 (only `0-9 + - ( )` and spaces), address ≤ 300;
  - tags: ≤ 10, each 1–30 characters, deduplicated case-insensitively, reusing the existing spelling;
  - empty or whitespace-only values are stored as `NULL`.
- Audit action `customer.profile_update` with meta `{ chatJid, changed: [...] }`. Field **values** never go into audit or app logs.
- No timeline event (`chat_events.type` has a SQLite `CHECK`).
- Every signed-in user (admin or agent) may read and edit. Mutating routes keep the existing Origin and Host checks; never bypass them.
- Web:
  - no literal user-facing strings: every key goes into `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json`;
  - only shadcn/app components and token classes, with no raw `<button>`, `<select>` or palette colours (ESLint enforces this);
  - every screen works at 360 px with no horizontal scroll.
- Tests never call OpenAI or ChatGPT.
- Per task: run only the tests of the changed files plus the touched package's typecheck. One consolidated verification at the end (Task 10).
- Conventional Commits, LF, Prettier. User-visible changes go in `CHANGELOG.md` under `[Unreleased]`.

## Review Focus

1. **Tag spelling.** `" VIP "`, `"vip"` and `"Vip"` typed on different customers must end up as one
   tag with the first-used spelling, and must filter together. Tests are in Task 2 and Task 3.
2. **Clearing the name.** Clearing the profile name (saving `""`) must bring back the WhatsApp/saved
   name everywhere, not show an empty title. Test in Task 3.
3. **Search wildcards.** A search for `%`, `_` or `\` must not match every profile: the new search
   columns use the same `ESCAPE` as the existing ones. Test in Task 3.
4. **Merges keep profiles.** A profile saved on the phone-number chat must survive the startup merge
   into the LID chat, newest non-empty field winning. Test in Task 5.
5. **Group sender under the other JID form.** A group message whose `sender_jid` is the phone-number
   form, while the profile sits on the LID chat (or the reverse), still shows the profile name.
   Test in Task 6.

---

### Task 1: Shared contract

**Files:**

- Create: `packages/shared/src/customers.ts`
- Modify: `packages/shared/src/index.ts` (export the new module)
- Modify: `packages/shared/src/models.ts` (`ChatSchema`, `MessageSchema`)
- Modify: `packages/shared/src/api.ts` (`ChatListQuery`)
- Test: `packages/shared/src/customers.test.ts`

**Interfaces:**

- Produces:
  - `CUSTOMER_TAG_LIMIT = 10`, `CUSTOMER_TAG_MAX_CHARS = 30`;
  - `normalizeTag(tag: string): string` (trim + collapse spaces), `customerTagKey(tag: string): string` (normalized + lower-cased);
  - `CustomerProfileBody` (zod; parsed shape: all strings, `tags: string[]`);
  - `CustomerProfileSchema` / `CustomerProfile`, `CustomerProfileResponse` (`{ profile, whatsappName }`);
  - `CustomerTagsQuery` (`{ q?: string }`), `CustomerTagsResponse` (`{ tags: string[] }`);
  - `SenderProfileSchema` (`{ chatJid: string; name: string }`);
  - `Chat.tags?: string[]`, `Chat.whatsappName?: string | null`, `Message.senderProfile?: { chatJid, name } | null`, `ChatListQuery.tag?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/customers.test.ts
import { describe, expect, it } from 'vitest';
import {
  CustomerProfileBody,
  customerTagKey,
  normalizeTag,
  ChatListQuery,
  ChatSchema,
} from './index.js';

describe('customer profile contract', () => {
  it('trims fields and defaults missing ones to empty strings and no tags', () => {
    expect(CustomerProfileBody.parse({ name: '  Farah  ' })).toEqual({
      name: 'Farah',
      company: '',
      email: '',
      otherPhone: '',
      address: '',
      tags: [],
    });
  });

  it('enforces the field limits', () => {
    const bad = (body: unknown) => CustomerProfileBody.safeParse(body).success;
    expect(bad({ name: 'x'.repeat(121) })).toBe(false);
    expect(bad({ company: 'x'.repeat(121) })).toBe(false);
    expect(bad({ email: 'not-an-email' })).toBe(false);
    expect(bad({ email: 'farah@example.com' })).toBe(true);
    expect(bad({ otherPhone: '+60 12-345 (6789)' })).toBe(true);
    expect(bad({ otherPhone: '012345678x' })).toBe(false);
    expect(bad({ address: 'x'.repeat(301) })).toBe(false);
    expect(bad({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).toBe(false);
    expect(bad({ tags: ['x'.repeat(31)] })).toBe(false);
    expect(bad({ tags: ['   '] })).toBe(false);
  });

  it('normalizes tags and derives a case-insensitive key', () => {
    expect(normalizeTag('  Halal   catering ')).toBe('Halal catering');
    expect(customerTagKey(' VIP ')).toBe('vip');
    expect(customerTagKey('Vip')).toBe(customerTagKey('vIP'));
  });

  it('accepts an optional tag filter and optional chat profile fields', () => {
    expect(ChatListQuery.parse({ tag: ' VIP ' }).tag).toBe('VIP');
    const chat = ChatSchema.parse({
      jid: '601@s.whatsapp.net',
      type: 'dm',
      name: 'Farah',
      avatarUrl: null,
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      status: 'open',
      assignedTo: null,
      updatedAt: 1,
      phone: '601',
    });
    expect(chat.tags).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run packages/shared/src/customers.test.ts`
Expected: FAIL with an import error: `CustomerProfileBody` is not exported.

- [ ] **Step 3: Write the contract**

```ts
// packages/shared/src/customers.ts
import { z } from 'zod';

export const CUSTOMER_TAG_LIMIT = 10;
export const CUSTOMER_TAG_MAX_CHARS = 30;
// Deliberately simple: one @, something on both sides, a dot in the domain, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-() ]*$/;

/** Trim and collapse inner whitespace: the display spelling of a tag. */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ');
}
/** Case-insensitive identity of a tag ("VIP" = "vip"). */
export function customerTagKey(tag: string): string {
  return normalizeTag(tag).toLowerCase();
}

const text = (max: number) => z.string().trim().max(max).default('');

/** PUT body: the whole profile. Empty strings mean "not set". */
export const CustomerProfileBody = z.object({
  name: text(120),
  company: text(120),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === '' || EMAIL.test(v), { message: 'Enter a valid email address' })
    .default(''),
  otherPhone: z
    .string()
    .trim()
    .max(32)
    .refine((v) => PHONE.test(v), { message: 'Use digits, spaces, +, -, ( or )' })
    .default(''),
  address: text(300),
  tags: z
    .array(
      z
        .string()
        .transform(normalizeTag)
        .pipe(z.string().min(1).max(CUSTOMER_TAG_MAX_CHARS)),
    )
    .max(CUSTOMER_TAG_LIMIT)
    .default([]),
});
export type CustomerProfileBody = z.infer<typeof CustomerProfileBody>;

export const CustomerProfileSchema = z.object({
  name: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  otherPhone: z.string().nullable(),
  address: z.string().nullable(),
  tags: z.array(z.string()),
  /** null when the profile was never saved */
  updatedAt: z.number().nullable(),
  updatedBy: z.number().nullable(),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

export const CustomerProfileResponse = z.object({
  profile: CustomerProfileSchema,
  /** The name WhatsApp/the phone gives the customer, shown under the profile name. */
  whatsappName: z.string().nullable(),
});
export type CustomerProfileResponse = z.infer<typeof CustomerProfileResponse>;

export const CustomerTagsQuery = z.object({
  q: z.string().trim().max(CUSTOMER_TAG_MAX_CHARS).optional(),
});
export const CustomerTagsResponse = z.object({ tags: z.array(z.string()) });
export type CustomerTagsResponse = z.infer<typeof CustomerTagsResponse>;

/** On a group message: the sender's own customer profile name, and the chat it lives on. */
export const SenderProfileSchema = z.object({ chatJid: z.string(), name: z.string() });
export type SenderProfile = z.infer<typeof SenderProfileSchema>;
```

In `packages/shared/src/index.ts` add `export * from './customers.js';` after `export * from './voice.js';`.
`models.ts` must not import from `customers.ts` in a cycle: define the `senderProfile` shape inline.

In `packages/shared/src/models.ts`, inside `ChatSchema` after `phone`:

```ts
  /** Customer profile tags (direct chats only). */
  tags: z.array(z.string()).optional(),
  /** WhatsApp/saved name, shown under a customer profile name (direct chats only). */
  whatsappName: z.string().nullable().optional(),
```

Inside `MessageSchema` after `transcriptStatus`:

```ts
  /** Group messages: the sender's customer profile (from their direct chat), when one is set. */
  senderProfile: z.object({ chatJid: z.string(), name: z.string() }).nullable().optional(),
```

In `packages/shared/src/api.ts`, inside `ChatListQuery` after `q`:

```ts
  /** Customer tag filter, matched case-insensitively. */
  tag: z.string().trim().min(1).max(30).optional(),
```

- [ ] **Step 4: Run the test to check it passes**

Run: `npx vitest run packages/shared/src/customers.test.ts && npm run typecheck -w @wa-team-inbox/shared`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): customer profile contract"
```

---

### Task 2: Migration and customer repository

**Files:**

- Create: `packages/server/src/db/migrations/007_customer_profiles.sql`
- Create: `packages/server/src/customers/repo.ts`
- Test: `packages/server/src/customers/repo.test.ts`

**Interfaces:**

- Consumes: `customerTagKey`, `normalizeTag`, `CUSTOMER_TAG_LIMIT`, `CustomerProfile` (Task 1).
- Produces (`packages/server/src/customers/repo.ts`):
  - `export const PROFILE_FIELDS = ['name', 'company', 'email', 'otherPhone', 'address'] as const`
  - `export type ProfileFields = Record<(typeof PROFILE_FIELDS)[number], string | null>`
  - `export class CustomerRepo`:
    - `constructor(db: DB)`
    - `get(chatJid: string): CustomerProfile | null`
    - `tags(chatJid: string): string[]`
    - `canonicalTags(tags: string[]): string[]`: dedupes by key, reuses the existing spelling, caps at 10
    - `save(chatJid: string, fields: ProfileFields, tags: string[], userId: number | null, now: number): void`
    - `suggest(q: string | undefined, limit?: number): string[]`
    - `namesByChat(chatJids: string[]): Map<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/customers/repo.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/index.js';
import { CustomerRepo } from './repo.js';

let db: DB;
let repo: CustomerRepo;
const A = '601@s.whatsapp.net';
const B = '602@s.whatsapp.net';
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

function chat(jid: string) {
  db.prepare("INSERT INTO chats (jid, type, name, updated_at) VALUES (?, 'dm', '', 0)").run(jid);
}

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'wati-cust-')), 'app.db'));
  repo = new CustomerRepo(db);
  chat(A);
  chat(B);
});

describe('CustomerRepo', () => {
  it('returns null for a chat without a profile, then the saved profile', () => {
    expect(repo.get(A)).toBeNull();
    repo.save(A, { ...empty, name: 'Farah', email: 'f@x.co' }, ['VIP'], 7, 1000);
    expect(repo.get(A)).toEqual({
      ...empty,
      name: 'Farah',
      email: 'f@x.co',
      tags: ['VIP'],
      updatedAt: 1000,
      updatedBy: 7,
    });
  });

  it('dedupes tags ignoring case and reuses the spelling already in use', () => {
    repo.save(A, empty, ['VIP'], 1, 1);
    expect(repo.canonicalTags([' vip ', 'Wholesale', 'WHOLESALE', 'vIp'])).toEqual([
      'VIP',
      'Wholesale',
    ]);
  });

  it('caps tags at 10', () => {
    expect(repo.canonicalTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(10);
  });

  it('replaces tags on save and suggests by prefix, most used first', () => {
    repo.save(A, empty, ['VIP', 'Wholesale'], 1, 1);
    repo.save(B, empty, ['VIP'], 1, 2);
    expect(repo.suggest('v')).toEqual(['VIP']);
    expect(repo.suggest(undefined)).toEqual(['VIP', 'Wholesale']);
    repo.save(A, empty, ['Halal'], 1, 3);
    expect(repo.tags(A)).toEqual(['Halal']);
  });

  it('maps chats to profile names, skipping unnamed profiles', () => {
    repo.save(A, { ...empty, name: 'Farah' }, [], 1, 1);
    repo.save(B, { ...empty, company: 'Only company' }, [], 1, 1);
    expect(repo.namesByChat([A, B, '603@s.whatsapp.net'])).toEqual(new Map([[A, 'Farah']]));
  });

  it('deletes the profile with its chat', () => {
    repo.save(A, { ...empty, name: 'Farah' }, ['VIP'], 1, 1);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(A);
    expect(repo.get(A)).toBeNull();
    expect(repo.suggest(undefined)).toEqual([]);
  });
});
```

Before writing the test, check the exported name and signature of the DB opener in `packages/server/src/db/index.ts`. The comment there reads "Opens (creating if needed) the SQLite db with WAL … runs migrations". Use that function in place of `openDb` if its name differs.

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run packages/server/src/customers/repo.test.ts`
Expected: FAIL: cannot find module `./repo.js`.

- [ ] **Step 3: Write the migration and the repository**

```sql
-- packages/server/src/db/migrations/007_customer_profiles.sql
-- Customer profiles (lead info): one per direct chat. Empty values are stored as NULL.
CREATE TABLE customer_profiles (
  chat_jid TEXT PRIMARY KEY REFERENCES chats(jid) ON DELETE CASCADE,
  name TEXT,
  company TEXT,
  email TEXT,
  other_phone TEXT,
  address TEXT,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE customer_tags (
  chat_jid TEXT NOT NULL REFERENCES chats(jid) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_jid, tag_key)
);
CREATE INDEX idx_customer_tags_key ON customer_tags(tag_key);
```

```ts
// packages/server/src/customers/repo.ts
import {
  CUSTOMER_TAG_LIMIT,
  customerTagKey,
  normalizeTag,
  type CustomerProfile,
} from '@wa-team-inbox/shared';
import type { DB } from '../db/index.js';

export const PROFILE_FIELDS = ['name', 'company', 'email', 'otherPhone', 'address'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileFields = Record<ProfileField, string | null>;

interface ProfileRow {
  name: string | null;
  company: string | null;
  email: string | null;
  other_phone: string | null;
  address: string | null;
  updated_at: number;
  updated_by: number | null;
}

export class CustomerRepo {
  constructor(private readonly db: DB) {}

  get(chatJid: string): CustomerProfile | null {
    const r = this.db
      .prepare('SELECT * FROM customer_profiles WHERE chat_jid = ?')
      .get(chatJid) as ProfileRow | undefined;
    const tags = this.tags(chatJid);
    if (!r && !tags.length) return null;
    return {
      name: r?.name ?? null,
      company: r?.company ?? null,
      email: r?.email ?? null,
      otherPhone: r?.other_phone ?? null,
      address: r?.address ?? null,
      tags,
      updatedAt: r?.updated_at ?? null,
      updatedBy: r?.updated_by ?? null,
    };
  }

  tags(chatJid: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT tag FROM customer_tags WHERE chat_jid = ? ORDER BY created_at, rowid',
        )
        .all(chatJid) as Array<{ tag: string }>
    ).map((r) => r.tag);
  }

  /** Dedupe by key (keeping the first), reuse the spelling already stored anywhere, cap at the limit. */
  canonicalTags(tags: string[]): string[] {
    const existing = this.db.prepare('SELECT tag FROM customer_tags WHERE tag_key = ? LIMIT 1');
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      const tag = normalizeTag(raw);
      const key = customerTagKey(tag);
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      const prior = existing.get(key) as { tag: string } | undefined;
      out.push(prior?.tag ?? tag);
      if (out.length === CUSTOMER_TAG_LIMIT) break;
    }
    return out;
  }

  /** Upsert the fields and replace the tags in one transaction. Tags must already be canonical. */
  save(
    chatJid: string,
    fields: ProfileFields,
    tags: string[],
    userId: number | null,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO customer_profiles (chat_jid, name, company, email, other_phone, address, updated_at, updated_by)
           VALUES (@chatJid, @name, @company, @email, @otherPhone, @address, @now, @userId)
           ON CONFLICT(chat_jid) DO UPDATE SET name = @name, company = @company, email = @email,
             other_phone = @otherPhone, address = @address, updated_at = @now, updated_by = @userId`,
        )
        .run({ chatJid, ...fields, now, userId });
      this.db.prepare('DELETE FROM customer_tags WHERE chat_jid = ?').run(chatJid);
      const insert = this.db.prepare(
        'INSERT INTO customer_tags (chat_jid, tag, tag_key, created_at) VALUES (?, ?, ?, ?)',
      );
      tags.forEach((tag, i) => insert.run(chatJid, tag, customerTagKey(tag), now + i));
    })();
  }

  /** Existing tags for the tag input: prefix matches, most used first. */
  suggest(q: string | undefined, limit = 20): string[] {
    const key = q ? customerTagKey(q) : '';
    const rows = this.db
      .prepare(
        `SELECT MIN(tag) AS tag, COUNT(*) AS uses FROM customer_tags
         WHERE tag_key LIKE @prefix ESCAPE '\\'
         GROUP BY tag_key ORDER BY uses DESC, tag_key ASC LIMIT @limit`,
      )
      .all({ prefix: `${key.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, limit }) as Array<{
      tag: string;
    }>;
    return rows.map((r) => r.tag);
  }

  /** Profile names for the given chats (only those with a name). */
  namesByChat(chatJids: string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (!chatJids.length) return out;
    const marks = chatJids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT chat_jid, name FROM customer_profiles WHERE chat_jid IN (${marks}) AND name IS NOT NULL`,
      )
      .all(...chatJids) as Array<{ chat_jid: string; name: string }>;
    for (const r of rows) out.set(r.chat_jid, r.name);
    return out;
  }
}
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run packages/server/src/customers/repo.test.ts packages/server/src/db/migrate.test.ts`
Expected: PASS. The migrate test also proves `007` applies on top of earlier migrations; if it lists
expected migration files, add `007_customer_profiles.sql` to that list.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/migrations/007_customer_profiles.sql packages/server/src/customers packages/server/src/db/migrate.test.ts
git commit -m "feat(server): customer profile tables and repository"
```

---

### Task 3: Chat read model (display name, tags, search, tag filter)

**Files:**

- Modify: `packages/server/src/chats/repo.ts` (`ChatRow`, `rowToChat`, `get`, `list`, `update` typing)
- Modify: `packages/server/src/chats/service.ts` (pass `tag` to `repo.list`)
- Test: `packages/server/test/customer-profile.test.ts` (new; Tasks 4–6 extend it)

**Interfaces:**

- Consumes: `CustomerRepo.save` (Task 2), `customerTagKey` (Task 1).
- Produces:
  - `ChatRow.profile_name?: string | null`, `ChatRow.profile_tags?: string | null`;
  - `rowToChat` fills `name` (profile name first), `whatsappName`, `tags`;
  - `ChatRepo.list({ …, tag?: string })`;
  - `export const TAG_SEPARATOR = '\u001f'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/test/customer-profile.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatListResponse } from '@wa-team-inbox/shared';
import { makeTestApp, type TestApp } from './helpers.js';
import { createUserAndLogin } from './auth-helpers.js';
import { getChats, getMessages } from '../src/wa-bridge/index.js';
import { CustomerRepo } from '../src/customers/repo.js';

let t: TestApp;
let cookie: string;
const enc = encodeURIComponent;
const FARAH = '60123110021@s.whatsapp.net';
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

async function incoming(chatJid: string, senderName: string, body = 'hi', senderJid = chatJid) {
  await getMessages(t.ctx).ingest(
    {
      id: `m-${Math.random()}`,
      chatJid,
      senderJid,
      senderName,
      fromMe: false,
      type: 'text',
      body,
      quotedId: null,
      timestamp: Date.now(),
      media: null,
    },
    'live',
  );
}
async function listChats(query = '') {
  const r = await t.app.inject({ method: 'GET', url: `/api/chats?${query}`, headers: { cookie } });
  expect(r.statusCode).toBe(200);
  return ChatListResponse.parse(r.json()).chats;
}

beforeEach(async () => {
  t = await makeTestApp();
  ({ cookie } = await createUserAndLogin(t));
});
afterEach(async () => t.close());

describe('chat read model with customer profiles', () => {
  it('shows the profile name with the WhatsApp name kept, and tags', async () => {
    await incoming(FARAH, 'Farah 🌸');
    new CustomerRepo(t.ctx.db).save(FARAH, { ...empty, name: 'Farah Aziz' }, ['VIP'], null, 1);
    const [chat] = await listChats();
    expect(chat).toMatchObject({ name: 'Farah Aziz', whatsappName: 'Farah 🌸', tags: ['VIP'] });
    expect(getChats(t.ctx).get(FARAH)).toMatchObject({ name: 'Farah Aziz' });
  });

  it('falls back to the WhatsApp name when the profile name is cleared', async () => {
    await incoming(FARAH, 'Farah 🌸');
    new CustomerRepo(t.ctx.db).save(FARAH, empty, [], null, 1);
    const [chat] = await listChats();
    expect(chat).toMatchObject({ name: 'Farah 🌸', whatsappName: 'Farah 🌸', tags: [] });
  });

  it('searches profile fields and tags, escaping LIKE wildcards', async () => {
    await incoming(FARAH, 'Farah');
    await incoming('60199999999@s.whatsapp.net', 'Someone else');
    new CustomerRepo(t.ctx.db).save(
      FARAH,
      { ...empty, company: 'Farah Catering Co', email: 'orders@farah.my' },
      ['Halal catering'],
      null,
      1,
    );
    for (const q of ['Catering Co', 'orders@farah', 'halal']) {
      expect((await listChats(`q=${enc(q)}`)).map((c) => c.jid)).toEqual([FARAH]);
    }
    expect(await listChats(`q=${enc('%')}`)).toEqual([]);
    expect(await listChats(`q=${enc('_')}`)).toEqual([]);
  });

  it('filters by tag ignoring case', async () => {
    await incoming(FARAH, 'Farah');
    await incoming('60199999999@s.whatsapp.net', 'Someone else');
    new CustomerRepo(t.ctx.db).save(FARAH, empty, ['VIP'], null, 1);
    expect((await listChats('tag=vip')).map((c) => c.jid)).toEqual([FARAH]);
    expect(await listChats('tag=wholesale')).toEqual([]);
  });

  it('gives group chats no tags or WhatsApp name', async () => {
    await incoming('120363000000001@g.us', 'Member', 'hello group', FARAH);
    const [group] = await listChats();
    expect(group?.tags ?? []).toEqual([]);
    expect(group?.whatsappName ?? null).toBeNull();
  });
});
```

Before writing the test, check how `ctx.db` is named on `AppContext` (`packages/server/src/context.ts`) and
use the real property.

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run packages/server/test/customer-profile.test.ts`
Expected: FAIL. `name` is still `Farah 🌸`, `whatsappName`/`tags` are undefined, and the search and
tag cases return the wrong chats.

- [ ] **Step 3: Implement**

In `packages/server/src/chats/repo.ts`:

```ts
// add to ChatRow
  /** customer_profiles.name, joined by CHAT_SELECT (direct chats). */
  profile_name?: string | null;
  /** customer tags joined by TAG_SEPARATOR, in CHAT_SELECT. */
  profile_tags?: string | null;
```

```ts
export const TAG_SEPARATOR = '\u001f';
/** Chat columns plus the customer profile name and tags; FROM `chats c` with alias `cp`. */
const CHAT_SELECT = `SELECT c.*, cp.name AS profile_name,
  (SELECT group_concat(tag, char(31)) FROM
     (SELECT tag FROM customer_tags WHERE chat_jid = c.jid ORDER BY created_at, rowid)) AS profile_tags
  FROM chats c LEFT JOIN customer_profiles cp ON cp.chat_jid = c.jid`;
```

Replace the body of `rowToChat`:

```ts
export function rowToChat(r: ChatRow): Chat {
  // A LID is an opaque WhatsApp ID, never a phone number: do not show its digits as a name.
  const lidDigits = r.jid.endsWith('@lid') && r.name === jidUser(r.jid);
  const waName =
    (r.name && !lidDigits ? r.name : null) ||
    r.phone ||
    (r.jid.endsWith('@lid') ? '' : jidUser(r.jid));
  const dm = r.type === 'dm';
  const profileName = dm ? r.profile_name?.trim() || null : null;
  return {
    jid: r.jid,
    type: r.type,
    name: profileName ?? waName,
    avatarUrl: `/api/chats/${encodeURIComponent(r.jid)}/avatar`,
    unreadCount: r.unread_count,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: r.last_message_preview,
    status: r.status,
    assignedTo: r.assigned_to,
    updatedAt: r.updated_at,
    phone: r.phone ?? null,
    tags: dm && r.profile_tags ? r.profile_tags.split(TAG_SEPARATOR) : [],
    whatsappName: dm ? waName || null : null,
  };
}
```

`ChatRepo.get` becomes:

```ts
      (this.db.prepare(`${CHAT_SELECT} WHERE c.jid = ?`).get(jid) as ChatRow | undefined) ?? null
```

In `ChatRepo.list`, add `tag?: string` to the filter type. Then:

```ts
    if (f.tag) {
      where.push(
        'EXISTS (SELECT 1 FROM customer_tags tg WHERE tg.chat_jid = c.jid AND tg.tag_key = @tagKey)',
      );
      params.tagKey = customerTagKey(f.tag);
    }
```

Extend the search clause (same escaped `@q`):

```ts
        `(c.name LIKE @q ESCAPE '\\' OR c.jid LIKE @q ESCAPE '\\' OR c.phone LIKE @q ESCAPE '\\'
          OR ct.push_name LIKE @q ESCAPE '\\' OR ct.saved_name LIKE @q ESCAPE '\\' OR ct.phone LIKE @q ESCAPE '\\'
          OR cp.name LIKE @q ESCAPE '\\' OR cp.company LIKE @q ESCAPE '\\' OR cp.email LIKE @q ESCAPE '\\'
          OR cp.other_phone LIKE @q ESCAPE '\\' OR cp.address LIKE @q ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM customer_tags tq WHERE tq.chat_jid = c.jid AND tq.tag LIKE @q ESCAPE '\\'))`,
```

and build the statement from `CHAT_SELECT`:

```ts
    const sql = `${CHAT_SELECT} LEFT JOIN contacts ct ON ct.jid = c.jid
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(c.last_message_at, 0) DESC, c.jid ASC LIMIT @limit`;
```

Import `customerTagKey` from `@wa-team-inbox/shared`.

`ChatRepo.update` must never write the joined columns. Change its parameter type from
`Partial<…ChatRow…>` to `Partial<Omit<ChatRow, 'jid' | 'profile_name' | 'profile_tags'>>`. Then run
`grep -n "repo.update(" packages/server/src -r` and confirm that no caller spreads a whole row into it.

Every other `SELECT * FROM chats` whose rows reach `rowToChat` must use `CHAT_SELECT` instead. Check
with `grep -n "FROM chats" packages/server/src/chats/repo.ts`: the open-chats list and the DM list are
used for merging and resolving, not for rendering. Only switch a query that feeds `rowToChat`.

In `packages/server/src/chats/service.ts` `list(q, userId)`, pass `tag: q.tag` to `repo.list`.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run packages/server/test/customer-profile.test.ts packages/server/test/chats.test.ts packages/server/test/contact-names.test.ts && npm run typecheck -w @wa-team-inbox/server`
Expected: PASS. Existing chat tests are unchanged, because a chat without a profile renders exactly as before.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/chats packages/server/test/customer-profile.test.ts
git commit -m "feat(server): profile name, tags, search and tag filter on chats"
```

---

### Task 4: Customer service and routes

**Files:**

- Create: `packages/server/src/customers/service.ts`
- Create: `packages/server/src/routes/customers.ts`
- Modify: `packages/server/src/services.ts` (register `initCustomers`)
- Modify: `packages/server/src/routes/index.ts` (register the route module)
- Test: `packages/server/test/customer-profile.test.ts` (add a `describe`)

**Interfaces:**

- Consumes: `CustomerRepo` (Task 2), `rowToChat` behaviour (Task 3), `CustomerProfileBody`,
  `CustomerTagsQuery` (Task 1), `getChats(ctx)`, `chatJidParam`, `requireUser`, `audit`, `errors`, `parse`.
- Produces:
  - `ctx.services.customers: CustomerService`:
    - `profile(chatJid: string): CustomerProfileResponse` (throws 404/400);
    - `save(chatJid: string, body: CustomerProfileBody, actor: { userId: number; ip: string | null }): CustomerProfileResponse`;
    - `suggestTags(q?: string): string[]`;
    - `senderProfiles(senderJids: string[]): Map<string, SenderProfile>` (used in Task 6).
  - Routes:
    - `GET /api/chats/:jid/profile`;
    - `PUT /api/chats/:jid/profile`;
    - `GET /api/customer-tags?q=`.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/test/customer-profile.test.ts` (add the imports
`CustomerProfileResponse, CustomerTagsResponse` from shared and `authHeaders` from `./auth-helpers.js`):

```ts
describe('customer profile routes', () => {
  const url = (jid = FARAH) => `/api/chats/${enc(jid)}/profile`;
  const body = {
    name: 'Farah Aziz',
    company: 'Farah Catering Co',
    email: 'orders@farah.my',
    otherPhone: '',
    address: 'Georgetown',
    tags: ['VIP', 'vip ', 'Halal catering'],
  };

  it('requires sign-in', async () => {
    await incoming(FARAH, 'Farah');
    expect((await t.app.inject({ method: 'GET', url: url() })).statusCode).toBe(401);
  });

  it('lets an agent read an empty profile, save one, and audits changed fields only', async () => {
    await incoming(FARAH, 'Farah 🌸');
    const agent = await createUserAndLogin(t, { role: 'agent' });
    const first = await t.app.inject({ method: 'GET', url: url(), headers: { cookie: agent.cookie } });
    expect(CustomerProfileResponse.parse(first.json())).toEqual({
      profile: { ...empty, tags: [], updatedAt: null, updatedBy: null },
      whatsappName: 'Farah 🌸',
    });
    const saved = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: authHeaders(agent.cookie),
      payload: body,
    });
    expect(saved.statusCode).toBe(200);
    expect(CustomerProfileResponse.parse(saved.json()).profile).toMatchObject({
      name: 'Farah Aziz',
      otherPhone: null,
      tags: ['VIP', 'Halal catering'],
      updatedBy: agent.user.id,
    });
    const audits = t.ctx.db
      .prepare("SELECT meta FROM audit_log WHERE action = 'customer.profile_update'")
      .all() as Array<{ meta: string }>;
    expect(audits).toHaveLength(1);
    const meta = JSON.parse(audits[0]!.meta) as { changed: string[] };
    expect(meta.changed.sort()).toEqual(['address', 'company', 'email', 'name', 'tags']);
    expect(audits[0]!.meta).not.toContain('Farah Aziz');
    expect(audits[0]!.meta).not.toContain('orders@farah.my');
  });

  it('writes nothing when nothing changed', async () => {
    await incoming(FARAH, 'Farah');
    const put = () =>
      t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    await put();
    await put();
    const n = t.ctx.db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'customer.profile_update'")
      .get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('rejects invalid fields, group chats, missing chats and cross-origin writes', async () => {
    await incoming(FARAH, 'Farah');
    const bad = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: authHeaders(cookie),
      payload: { email: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('email');

    await incoming('120363000000001@g.us', 'Member', 'hi', FARAH);
    const group = await t.app.inject({
      method: 'GET',
      url: url('120363000000001@g.us'),
      headers: { cookie },
    });
    expect(group.statusCode).toBe(400);

    const missing = await t.app.inject({
      method: 'GET',
      url: url('60100000000@s.whatsapp.net'),
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);

    const cross = await t.app.inject({
      method: 'PUT',
      url: url(),
      headers: { cookie, origin: 'http://evil.example', host: 'localhost' },
      payload: body,
    });
    expect(cross.statusCode).toBe(403);
  });

  it('emits chat:updated with the new name and tags', async () => {
    await incoming(FARAH, 'Farah');
    const seen: Array<{ name: string; tags?: string[] }> = [];
    t.ctx.bus.on('chat:updated', (c) => seen.push(c));
    await t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    expect(seen.at(-1)).toMatchObject({ name: 'Farah Aziz', tags: ['VIP', 'Halal catering'] });
  });

  it('suggests existing tags by prefix', async () => {
    await incoming(FARAH, 'Farah');
    await t.app.inject({ method: 'PUT', url: url(), headers: authHeaders(cookie), payload: body });
    const r = await t.app.inject({
      method: 'GET',
      url: '/api/customer-tags?q=ha',
      headers: { cookie },
    });
    expect(CustomerTagsResponse.parse(r.json()).tags).toEqual(['Halal catering']);
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run packages/server/test/customer-profile.test.ts -t "customer profile routes"`
Expected: FAIL with 404 responses, because the routes do not exist yet.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/customers/service.ts
import type {
  CustomerProfileBody,
  CustomerProfileResponse,
  SenderProfile,
} from '@wa-team-inbox/shared';
import type { AppContext } from '../context.js';
import { audit } from '../db/audit.js';
import { errors } from '../http/errors.js';
import { getChats } from '../wa-bridge/index.js';
import { CustomerRepo, PROFILE_FIELDS, type ProfileFields } from './repo.js';

export interface CustomerService {
  profile(chatJid: string): CustomerProfileResponse;
  save(
    chatJid: string,
    body: CustomerProfileBody,
    actor: { userId: number; ip: string | null },
  ): CustomerProfileResponse;
  suggestTags(q?: string): string[];
  /** Group messages: sender JID → their direct chat's profile name (only when one is set). */
  senderProfiles(senderJids: string[]): Map<string, SenderProfile>;
}

declare module '../context.js' {
  interface Services {
    customers?: CustomerService;
  }
}

const EMPTY = {
  name: null,
  company: null,
  email: null,
  otherPhone: null,
  address: null,
  tags: [] as string[],
  updatedAt: null,
  updatedBy: null,
};

export function createCustomerService(ctx: AppContext): CustomerService {
  const repo = new CustomerRepo(ctx.db);
  const chats = () => getChats(ctx);

  function directChat(chatJid: string) {
    const chat = chats().get(chatJid);
    if (!chat) throw errors.notFound('Chat');
    if (chat.type !== 'dm') throw errors.validation('Group chats have no customer profile');
    return chat;
  }

  const service: CustomerService = {
    profile(chatJid) {
      const chat = directChat(chatJid);
      return { profile: repo.get(chatJid) ?? EMPTY, whatsappName: chat.whatsappName ?? null };
    },
    save(chatJid, body, actor) {
      directChat(chatJid);
      const fields = Object.fromEntries(
        PROFILE_FIELDS.map((f) => [f, body[f].trim() || null]),
      ) as ProfileFields;
      const tags = repo.canonicalTags(body.tags);
      const before = repo.get(chatJid) ?? EMPTY;
      const changed: string[] = PROFILE_FIELDS.filter((f) => before[f] !== fields[f]);
      if (before.tags.join('\u001f') !== tags.join('\u001f')) changed.push('tags');
      if (changed.length) {
        ctx.db.transaction(() => {
          repo.save(chatJid, fields, tags, actor.userId, Date.now());
          // Which fields changed, never their values (personal data).
          audit(ctx.db, {
            userId: actor.userId,
            action: 'customer.profile_update',
            ip: actor.ip,
            meta: { chatJid, changed },
          });
        })();
        const chat = chats().get(chatJid);
        if (chat) ctx.bus.emit('chat:updated', chat);
      }
      return service.profile(chatJid);
    },
    suggestTags(q) {
      return repo.suggest(q);
    },
    senderProfiles(senderJids) {
      const aliases = ctx.services.aliases;
      const byChat = new Map<string, string[]>();
      for (const sender of new Set(senderJids)) {
        const chatJid = aliases ? aliases.route(sender) : sender;
        byChat.set(chatJid, [...(byChat.get(chatJid) ?? []), sender]);
      }
      const names = repo.namesByChat([...byChat.keys()]);
      const out = new Map<string, SenderProfile>();
      for (const [chatJid, name] of names)
        for (const sender of byChat.get(chatJid) ?? []) out.set(sender, { chatJid, name });
      return out;
    },
  };
  return service;
}

export function initCustomers(ctx: AppContext): void {
  ctx.services.customers = createCustomerService(ctx);
}
```

```ts
// packages/server/src/routes/customers.ts
import type { FastifyInstance } from 'fastify';
import { CustomerProfileBody, CustomerTagsQuery } from '@wa-team-inbox/shared';
import { requireUser } from '../auth/guards.js';
import type { AppContext } from '../context.js';
import { clientIp } from '../http/client-ip.js';
import { parse } from '../http/errors.js';
import { chatJidParam } from './chats.js';

export default async function customerRoutes(app: FastifyInstance, ctx: AppContext) {
  const customers = ctx.services.customers!;
  app.addHook('preHandler', requireUser(ctx));

  app.get('/chats/:jid/profile', async (req) =>
    customers.profile(chatJidParam(ctx, req.params)),
  );

  app.put('/chats/:jid/profile', async (req) =>
    customers.save(chatJidParam(ctx, req.params), parse(CustomerProfileBody, req.body), {
      userId: req.user!.id,
      ip: clientIp(req),
    }),
  );

  app.get('/customer-tags', async (req) => ({
    tags: customers.suggestTags(parse(CustomerTagsQuery, req.query).q),
  }));
}
```

Before writing the route, check how other routes get the client IP. The auth routes use
`clientIp(req)`; copy that import exactly as it appears in `packages/server/src/routes/auth.ts`.

In `packages/server/src/services.ts`, append after the voice initializer:

```ts
import { initCustomers } from './customers/service.js';
initializers.push(initCustomers);
```

In `packages/server/src/routes/index.ts`, import `customers from './customers.js'` and add `customers`
after `notes` in `routeModules`.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run packages/server/test/customer-profile.test.ts && npm run typecheck -w @wa-team-inbox/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/customers packages/server/src/routes packages/server/src/services.ts packages/server/test/customer-profile.test.ts
git commit -m "feat(server): customer profile routes with audit and live updates"
```

---

### Task 5: Duplicate merge carries profiles

**Files:**

- Create: `packages/server/src/customers/merge.ts`
- Modify: `packages/server/src/chats/merge.ts` (call it; extend `MergeResult.moved`)
- Test: `packages/server/src/customers/merge.test.ts`

**Interfaces:**

- Consumes: `CustomerRepo` (Task 2), `customerTagKey` (Task 1).
- Produces: `mergeCustomerProfile(db: DB, from: string, to: string): { profiles: number; tags: number }`.
  It must run after the `to` chat row exists and before `DELETE FROM chats WHERE jid = from`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/customers/merge.test.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/index.js';
import { mergeCustomerProfile } from './merge.js';
import { CustomerRepo } from './repo.js';

let db: DB;
let repo: CustomerRepo;
const PN = '60123@s.whatsapp.net';
const LID = '999@lid';
const empty = { name: null, company: null, email: null, otherPhone: null, address: null };

beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), 'wati-cmerge-')), 'app.db'));
  repo = new CustomerRepo(db);
  for (const jid of [PN, LID])
    db.prepare("INSERT INTO chats (jid, type, name, updated_at) VALUES (?, 'dm', '', 0)").run(jid);
});

describe('mergeCustomerProfile', () => {
  it('moves a profile to a chat that has none', () => {
    repo.save(PN, { ...empty, name: 'Farah' }, ['VIP'], 3, 100);
    expect(mergeCustomerProfile(db, PN, LID)).toEqual({ profiles: 1, tags: 1 });
    expect(repo.get(LID)).toMatchObject({ name: 'Farah', tags: ['VIP'], updatedBy: 3 });
    expect(repo.get(PN)).toBeNull();
  });

  it('keeps the newest non-empty value per field and unions tags (max 10)', () => {
    repo.save(PN, { ...empty, name: 'Old name', email: 'only@pn.my' }, ['VIP', 'a', 'b', 'c', 'd', 'e'], 1, 100);
    repo.save(LID, { ...empty, name: 'New name', company: 'Co' }, ['vip', 'f', 'g', 'h', 'i', 'j'], 2, 200);
    mergeCustomerProfile(db, PN, LID);
    const merged = repo.get(LID)!;
    expect(merged).toMatchObject({
      name: 'New name',
      company: 'Co',
      email: 'only@pn.my',
      updatedAt: 200,
      updatedBy: 2,
    });
    expect(merged.tags).toHaveLength(10);
    expect(merged.tags.filter((tag) => tag.toLowerCase() === 'vip')).toHaveLength(1);
  });

  it('does nothing when neither chat has a profile', () => {
    expect(mergeCustomerProfile(db, PN, LID)).toEqual({ profiles: 0, tags: 0 });
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run packages/server/src/customers/merge.test.ts`
Expected: FAIL: cannot find module `./merge.js`.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/customers/merge.ts
import type { DB } from '../db/index.js';
import { CustomerRepo, PROFILE_FIELDS, type ProfileFields } from './repo.js';

/**
 * Startup identity merge: carry `from`'s customer profile into `to`. Newest non-empty value per
 * field wins; tags are unioned (first spelling kept, capped). Runs inside mergeChat's transaction.
 */
export function mergeCustomerProfile(
  db: DB,
  from: string,
  to: string,
): { profiles: number; tags: number } {
  const repo = new CustomerRepo(db);
  const a = repo.get(from);
  if (!a) return { profiles: 0, tags: 0 };
  const b = repo.get(to);
  const fromNewer = !b || (a.updatedAt ?? 0) > (b.updatedAt ?? 0);
  const [newer, older] = fromNewer ? [a, b] : [b, a];
  const fields = Object.fromEntries(
    PROFILE_FIELDS.map((f) => [f, newer?.[f] ?? older?.[f] ?? null]),
  ) as ProfileFields;
  const tags = repo.canonicalTags([...(newer?.tags ?? []), ...(older?.tags ?? [])]);
  repo.save(
    to,
    fields,
    tags,
    newer?.updatedBy ?? null,
    Math.max(a.updatedAt ?? 0, b?.updatedAt ?? 0),
  );
  db.prepare('DELETE FROM customer_profiles WHERE chat_jid = ?').run(from);
  db.prepare('DELETE FROM customer_tags WHERE chat_jid = ?').run(from);
  return { profiles: 1, tags: tags.length };
}
```

`canonicalTags` may pick a spelling stored on `from`. That is still correct, because both rows belong
to the same person.

In `packages/server/src/chats/merge.ts`:

- Extend `MergeResult.moved` to
  `{ messages: number; events: number; notes: number; aiState: number; profiles: number; tags: number }`.
- In the `moved` object, after `aiState`, add (the comment about ordering already applies):

```ts
      ...mergeCustomerProfile(db, from, to),
```

- Add `import { mergeCustomerProfile } from '../customers/merge.js';` at the top.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run packages/server/src/customers/merge.test.ts packages/server/src/chats/merge.test.ts packages/server/test/identity-startup.test.ts && npm run typecheck -w @wa-team-inbox/server`
Expected: PASS. If `merge.test.ts` asserts the exact `moved` object, add `profiles: 0, tags: 0` to
those expectations.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/customers/merge.ts packages/server/src/customers/merge.test.ts packages/server/src/chats/merge.ts packages/server/src/chats/merge.test.ts
git commit -m "feat(server): carry customer profiles through duplicate merges"
```

---

### Task 6: Group messages show the sender's profile name

**Files:**

- Modify: `packages/server/src/messages/service.ts` (`list`, and the `message:new` emit in ingest)
- Test: `packages/server/test/customer-profile.test.ts` (add a `describe`)

**Interfaces:**

- Consumes: `ctx.services.customers.senderProfiles` (Task 4).
- Produces: `Message.senderProfile` on group messages (list and live), otherwise `undefined`.

- [ ] **Step 1: Write the failing test**

```ts
describe('group messages', () => {
  const GROUP = '120363000000001@g.us';

  async function groupMessages() {
    const r = await t.app.inject({
      method: 'GET',
      url: `/api/chats/${enc(GROUP)}/messages`,
      headers: { cookie },
    });
    return (r.json() as { messages: Array<{ senderJid: string; senderProfile?: unknown }> })
      .messages;
  }

  it('carries the sender profile from their direct chat, list and live', async () => {
    await incoming(FARAH, 'Farah');
    new CustomerRepo(t.ctx.db).save(FARAH, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    const live: unknown[] = [];
    t.ctx.bus.on('message:new', (m) => live.push(m.senderProfile));
    await incoming(GROUP, 'Farah 🌸', 'hello group', FARAH);
    expect(live.at(-1)).toEqual({ chatJid: FARAH, name: 'Farah Aziz' });
    const [msg] = await groupMessages();
    expect(msg?.senderProfile).toEqual({ chatJid: FARAH, name: 'Farah Aziz' });
  });

  it('resolves a sender written under the other JID form', async () => {
    const LID = '888000111@lid';
    await incoming(LID, 'Farah');
    t.ctx.services.aliases!.learn({ jid: FARAH, alias: LID }, 'test');
    new CustomerRepo(t.ctx.db).save(LID, { ...empty, name: 'Farah Aziz' }, [], null, 1);
    await incoming(GROUP, 'Farah 🌸', 'hello group', FARAH);
    const [msg] = await groupMessages();
    expect(msg?.senderProfile).toEqual({ chatJid: LID, name: 'Farah Aziz' });
  });

  it('leaves senders without a direct chat alone', async () => {
    await incoming(GROUP, 'Stranger', 'hi', '60111111111@s.whatsapp.net');
    const [msg] = await groupMessages();
    expect(msg?.senderProfile ?? null).toBeNull();
  });
});
```

Before writing the second test, check `AliasStore.learn`'s argument order and the accepted
`AliasSource` values in `packages/server/src/chats/aliases.ts`. Use the real names; learning must make
`route(FARAH)` return the LID chat.

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run packages/server/test/customer-profile.test.ts -t "group messages"`
Expected: FAIL, because `senderProfile` is undefined.

- [ ] **Step 3: Implement**

In `packages/server/src/messages/service.ts` add a helper inside `createMessageService` (or the
factory there):

```ts
  /** Group messages: attach each sender's customer profile name (one batched lookup per page). */
  function withSenderProfiles(chatJid: string, list: Message[]): Message[] {
    const customers = ctx.services.customers;
    if (!customers || !chatJid.endsWith('@g.us')) return list;
    const senders = list.filter((m) => !m.fromMe && m.senderJid).map((m) => m.senderJid!);
    if (!senders.length) return list;
    const profiles = customers.senderProfiles(senders);
    return list.map((m) =>
      !m.fromMe && m.senderJid ? { ...m, senderProfile: profiles.get(m.senderJid) ?? null } : m,
    );
  }
```

In `list(jid, q)`, replace `messages: page.reverse().map(rowToMessage),` with:

```ts
        messages: withSenderProfiles(jid, page.reverse().map(rowToMessage)),
```

In ingest, replace `const msg = rowToMessage(final);` (just before `ctx.bus.emit('message:new', msg)`)
with:

```ts
      const msg = withSenderProfiles(chatJid, [rowToMessage(final)])[0]!;
```

Check `grep -n "rowToMessage(" packages/server/src/messages/service.ts` for any other place that emits
`message:new`; outbound messages (`fromMe`) never need it.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run packages/server/test/customer-profile.test.ts packages/server/test/messages.test.ts && npm run typecheck -w @wa-team-inbox/server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/messages/service.ts packages/server/test/customer-profile.test.ts
git commit -m "feat(server): group messages carry the sender's customer profile name"
```

---

### Task 7: Web data layer

**Files:**

- Modify: `apps/web/src/api/queries.ts`
- Test: `apps/web/src/api/queries.test.ts` (add cases)

**Interfaces:**

- Consumes: `CustomerProfileResponse`, `CustomerProfileBody`, `CustomerTagsResponse` (Task 1); routes (Task 4).
- Produces:
  - `ChatFilters.tag?: string`;
  - `qk.customerProfile(jid)`, `qk.customerTags(q)`;
  - `useCustomerProfile(jid: string | null | undefined)`, enabled only when `jid` is set;
  - `useSaveCustomerProfile(jid: string)`, a mutation taking `CustomerProfileBody`;
  - `useCustomerTags(q: string)`.

- [ ] **Step 1: Write the failing test**

Follow the existing `queries.test.ts` style: find how it mocks `fetch` and how it wraps
hooks with a `QueryClientProvider`, and copy that setup exactly. Then add:

```ts
it('sends the tag filter in the chat list query', async () => {
  const calls = mockFetchJson({ chats: [], nextCursor: null });
  renderHook(() => useChats({ assigned: 'any', tag: 'VIP' }), { wrapper });
  await waitFor(() => expect(calls[0]).toContain('tag=VIP'));
});

it('saves a customer profile and stores the response in the cache', async () => {
  const response = {
    profile: {
      name: 'Farah Aziz',
      company: null,
      email: null,
      otherPhone: null,
      address: null,
      tags: ['VIP'],
      updatedAt: 1,
      updatedBy: 1,
    },
    whatsappName: 'Farah',
  };
  mockFetchJson(response);
  const { result } = renderHook(() => useSaveCustomerProfile('601@s.whatsapp.net'), { wrapper });
  await act(() =>
    result.current.mutateAsync({
      name: 'Farah Aziz',
      company: '',
      email: '',
      otherPhone: '',
      address: '',
      tags: ['VIP'],
    }),
  );
  expect(queryClient.getQueryData(qk.customerProfile('601@s.whatsapp.net'))).toEqual(response);
});
```

`mockFetchJson`, `wrapper` and `queryClient` are whatever the existing test file uses under those
roles; reuse its helpers rather than adding new ones.

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run apps/web/src/api/queries.test.ts`
Expected: FAIL: `useSaveCustomerProfile` is not exported, and `tag` is not sent.

- [ ] **Step 3: Implement**

In `apps/web/src/api/queries.ts`:

```ts
export interface ChatFilters {
  status?: ChatStatus;
  assigned: 'me' | 'none' | 'any';
  q?: string;
  /** customer tag filter */
  tag?: string;
}
```

Add to `qk`:

```ts
  customerProfile: (jid: string) => ['customer-profile', jid] as const,
  customerTags: (q: string) => ['customer-tags', q] as const,
```

In `useChats` add `if (filters.tag) p.set('tag', filters.tag);` after the `q` line.

```ts
export function useCustomerProfile(jid: string | null | undefined) {
  return useQuery({
    queryKey: qk.customerProfile(jid ?? ''),
    queryFn: ({ signal }) =>
      api<CustomerProfileResponse>(`/chats/${enc(jid ?? '')}/profile`, { signal }),
    enabled: !!jid,
  });
}

export function useSaveCustomerProfile(jid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerProfileBody) =>
      api<CustomerProfileResponse>(`/chats/${enc(jid)}/profile`, { method: 'PUT', body }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.customerProfile(jid), saved);
      void qc.invalidateQueries({ queryKey: ['customer-tags'] });
    },
  });
}

export function useCustomerTags(q: string) {
  return useQuery({
    queryKey: qk.customerTags(q),
    queryFn: ({ signal }) =>
      api<CustomerTagsResponse>(`/customer-tags?q=${encodeURIComponent(q)}`, { signal }),
    select: (r) => r.tags,
    staleTime: 30_000,
  });
}
```

Import the three types from `@wa-team-inbox/shared`. The live `chat:updated` handler already patches
chats in the cache. Also invalidate the open profile: in `apps/web/src/api/socket.ts`, inside
`socket.on('chat:updated', (c) => { … })`, add:

```ts
      void qc.invalidateQueries({ queryKey: qk.customerProfile(c.jid) });
```

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run apps/web/src/api/queries.test.ts apps/web/src/api/socket.test.tsx && npm run typecheck -w @wa-team-inbox/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): customer profile queries and tag filter param"
```

---

### Task 8: Customer panel in the conversation

**Files:**

- Create: `apps/web/src/inbox/CustomerPanel.tsx`
- Create: `apps/web/src/inbox/TagInput.tsx`
- Modify: `apps/web/src/inbox/ConversationHeader.tsx` (Customer button, direct chats only)
- Modify: `apps/web/src/inbox/Conversation.tsx` (open state; `?customer=1` opens it)
- Modify: `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json` (`customer.*`, `header.customer*`)
- Test: `apps/web/src/inbox/CustomerPanel.test.tsx`, `apps/web/src/inbox/TagInput.test.tsx`

**Interfaces:**

- Consumes: `useCustomerProfile`, `useSaveCustomerProfile`, `useCustomerTags` (Task 7), `Directory`
  (`./useDirectory`, for "Updated by" names), `formatRelative`/`formatDateTime` from `../lib/format`.
- Produces:
  - `<CustomerPanel jid open directory onClose />`, which mirrors `NotesPanel`: a `Sheet` from the right
    on wide screens and from the bottom on phones;
  - `<TagInput value onChange suggestions />`;
  - `<CustomerDetails profile whatsappName directory />`, exported for reuse in Task 9.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/inbox/TagInput.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { TagInput } from './TagInput';
import { renderWithI18n } from '../test/i18n'; // use the repo's existing i18n test wrapper

function Harness({ initial = [] as string[] }) {
  const [tags, setTags] = useState(initial);
  return (
    <>
      <TagInput value={tags} onChange={setTags} suggestions={['VIP', 'Wholesale']} />
      <output data-testid="tags">{tags.join('|')}</output>
    </>
  );
}

describe('TagInput', () => {
  it('adds on Enter and comma, ignores case duplicates, removes with Backspace', async () => {
    renderWithI18n(<Harness />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'VIP{Enter}wholesale,vip{Enter}');
    expect(screen.getByTestId('tags')).toHaveTextContent('VIP|wholesale');
    await userEvent.type(input, '{Backspace}');
    expect(screen.getByTestId('tags')).toHaveTextContent('VIP');
  });

  it('stops at 10 tags', async () => {
    renderWithI18n(<Harness initial={Array.from({ length: 10 }, (_, i) => `t${i}`)} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
```

```tsx
// apps/web/src/inbox/CustomerPanel.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CustomerPanel } from './CustomerPanel';
// Use the same render-with-providers and fetch mocking helpers NotesPanel/Conversation tests use.

const directory = { nameOf: () => 'Mei Ling' } as never; // build a real Directory the way other tests do

describe('CustomerPanel', () => {
  it('shows an empty state, then saves edited details', async () => {
    const put = mockApi({
      'GET /api/chats/601%40s.whatsapp.net/profile': {
        profile: {
          name: null,
          company: null,
          email: null,
          otherPhone: null,
          address: null,
          tags: [],
          updatedAt: null,
          updatedBy: null,
        },
        whatsappName: 'Farah 🌸',
      },
      'PUT /api/chats/601%40s.whatsapp.net/profile': (body: unknown) => ({
        profile: {
          ...(body as object),
          otherPhone: null,
          address: null,
          tags: [],
          updatedAt: 1,
          updatedBy: 1,
        },
        whatsappName: 'Farah 🌸',
      }),
    });
    renderWithProviders(
      <CustomerPanel jid="601@s.whatsapp.net" open directory={directory} onClose={() => {}} />,
    );
    expect(await screen.findByText('No details yet')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Add details' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Farah Aziz');
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid email address')).toBeVisible();
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(await screen.findByText('Farah Aziz')).toBeVisible();
    expect(screen.getByText('WhatsApp: Farah 🌸')).toBeVisible();
  });
});
```

Before writing these, open `apps/web/src/inbox/NotesPanel.test.tsx` (or the nearest panel test) and
`Composer.test.tsx` to find the repo's real helpers for rendering with i18n and QueryClient and for
mocking `api`. Replace `renderWithI18n`, `renderWithProviders`, `mockApi` and the `directory` stub
with those exact helpers. Do not add new test infrastructure.

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run apps/web/src/inbox/TagInput.test.tsx apps/web/src/inbox/CustomerPanel.test.tsx`
Expected: FAIL: the modules do not exist.

- [ ] **Step 3: Implement**

`TagInput.tsx` is a shadcn `Input` with `role="combobox"` (it has a listbox of suggestions) and the
current tags as `Badge`s, each with a remove `Button` (`variant="ghost"`, `size="icon"`, aria-label
`t('customer.removeTag', { tag })`). Behaviour:

- **Adding.** Enter or `,` adds `normalizeTag(input)` unless empty or already present ignoring case.
- **Removing.** Backspace on an empty input removes the last tag.
- **Limit.** The input is `disabled` at `CUSTOMER_TAG_LIMIT`, and its placeholder becomes
  `t('customer.tagLimit')`.
- **Suggestions.** Filtered by prefix (ignoring case), minus the tags already chosen, shown as
  `Button variant="ghost"` items under the input; clicking one adds it.

Use `normalizeTag`, `customerTagKey` and `CUSTOMER_TAG_LIMIT` from `@wa-team-inbox/shared`.

`CustomerPanel.tsx` mirrors `NotesPanel.tsx` (same `Sheet`/`useMediaQuery` split, header with title and
close button):

- **Loading:** `useCustomerProfile(jid)` while `open`, with a `Skeleton` while pending.
- **Read view** (`CustomerDetails`, exported):
  - the name (or `t('customer.noName')`);
  - `t('customer.whatsappName', { name })` when `whatsappName` differs from the name;
  - company, email (as a `mailto:` link), other phone (as a `tel:` link), address, and the tags as `Badge`s;
  - `t('customer.updatedBy', { name, when })` when `updatedAt` is set;
  - empty fields are not rendered;
  - with no data at all: `t('customer.empty')` and a `Button` `t('customer.addDetails')`; otherwise
    `Button` `t('customer.edit')`.
- **Edit view:**
  - a `<form>` of `Label`/`Input` pairs for name, company, email (`type="email"`), other phone
    (`inputMode="tel"`), address (`Textarea`, 2 rows), plus `TagInput` with `useCustomerTags(input)`
    suggestions;
  - on submit: `CustomerProfileBody.safeParse(values)`; show zod issues under their fields (by
    `issue.path[0]`); otherwise call `useSaveCustomerProfile(jid).mutate`, return to the read view on
    success, and `toast.error(errorMessage(err))` on failure;
  - **Save** (`type="submit"`, spinner while pending) and **Cancel** buttons;
  - Ctrl/Cmd+Enter submits;
  - Esc with unchanged values cancels. With changes, Esc opens the existing `AlertDialog` with
    `t('customer.discardTitle')` / `t('customer.discard')`, never a browser `confirm()`.

`ConversationHeader.tsx`:

- **New props:** `showCustomer: boolean`, `customerOpen: boolean`, `onToggleCustomer(): void`.
- **The button:** render it before the Notes button when `showCustomer`, with the same classes as the
  Notes button, the icon `UserRound` (lucide), label `t('header.customer')`, aria-label
  `t('header.customerLabel')`, and `aria-pressed={customerOpen}`.

`Conversation.tsx`:

- Add `const [customerOpen, setCustomerOpen] = useState(false)`.
- Initialise it to true when `useSearchParams().get('customer') === '1'`. Check how this file
  reads router state; the app uses react-router.
- Pass `showCustomer={chat.type === 'dm'}`. Opening Customer closes Notes and the reverse, so only one
  sheet shows at a time.
- Render `<CustomerPanel jid={jid} open={customerOpen} directory={directory} onClose={() => setCustomerOpen(false)} />`
  next to `NotesPanel`.

i18n: add to `apps/web/src/i18n/locales/en/inbox.json`:

```json
"customer": {
  "title": "Customer",
  "description": "Details your team keeps about this customer",
  "close": "Close customer details",
  "empty": "No details yet",
  "addDetails": "Add details",
  "edit": "Edit",
  "save": "Save",
  "cancel": "Cancel",
  "saveFailed": "Could not save customer details",
  "noName": "No name set",
  "whatsappName": "WhatsApp: {{name}}",
  "updatedBy": "Updated by {{name}} · {{when}}",
  "name": "Name",
  "company": "Company",
  "email": "Email",
  "otherPhone": "Other phone",
  "address": "Address / area",
  "tags": "Tags",
  "tagPlaceholder": "Add a tag and press Enter",
  "tagLimit": "Up to 10 tags",
  "removeTag": "Remove tag {{tag}}",
  "discardTitle": "Discard your changes?",
  "discard": "Discard",
  "keepEditing": "Keep editing",
  "open": "Open chat"
}
```

and under `header`: `"customer": "Customer"`, `"customerLabel": "Customer details"`.

Add the same keys to `ms` and `zh-CN`:

- **ms:** "Pelanggan", "Butiran yang disimpan pasukan tentang pelanggan ini", "Tutup butiran pelanggan",
  "Belum ada butiran", "Tambah butiran", "Sunting", "Simpan", "Batal",
  "Tidak dapat menyimpan butiran pelanggan", "Tiada nama", "WhatsApp: {{name}}",
  "Dikemas kini oleh {{name}} · {{when}}", "Nama", "Syarikat", "E-mel", "Telefon lain",
  "Alamat / kawasan", "Tag", "Tambah tag dan tekan Enter", "Sehingga 10 tag", "Buang tag {{tag}}",
  "Buang perubahan anda?", "Buang", "Teruskan menyunting", "Buka sembang";
  header: "Pelanggan", "Butiran pelanggan".
- **zh-CN:** "客户", "团队为此客户保存的资料", "关闭客户资料", "暂无资料", "添加资料", "编辑", "保存",
  "取消", "无法保存客户资料", "未设置姓名", "WhatsApp：{{name}}", "由 {{name}} 更新 · {{when}}",
  "姓名", "公司", "电子邮箱", "其他电话", "地址 / 地区", "标签", "输入标签后按回车", "最多 10 个标签",
  "移除标签 {{tag}}", "放弃更改？", "放弃", "继续编辑", "打开对话"; header: "客户", "客户资料".

The catalog tests (`catalogs.test.ts`) enforce identical key sets.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run apps/web/src/inbox/TagInput.test.tsx apps/web/src/inbox/CustomerPanel.test.tsx apps/web/src/inbox/ConversationHeader.test.tsx apps/web/src/i18n && npm run typecheck -w @wa-team-inbox/web && npx eslint apps/web/src/inbox`
Expected: PASS, with no ESLint errors (no raw buttons, palette colours or literal strings).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/inbox apps/web/src/i18n
git commit -m "feat(web): customer panel with tag input in the conversation"
```

---

### Task 9: Inbox chips, tag filter and group sender names

**Files:**

- Modify: `apps/web/src/inbox/ChatListItem.tsx` (tag chips)
- Modify: `apps/web/src/inbox/ChatFilters.tsx` (tag filter)
- Modify: `apps/web/src/inbox/InboxPage.tsx` (only if filter persistence needs the new key; it stores the whole object)
- Modify: `apps/web/src/inbox/MessageBubble.tsx` (profile name + popover)
- Modify: `apps/web/src/i18n/locales/{en,ms,zh-CN}/inbox.json` (`filters.tag*`, `chatListItem.moreTags`)
- Test: `apps/web/src/inbox/ChatListItem.test.tsx`, `apps/web/src/inbox/ChatFilters.test.tsx`, `apps/web/src/inbox/MessageBubble.test.tsx`

**Interfaces:**

- Consumes: `Chat.tags`, `Message.senderProfile`, `ChatFilters.tag`, `useCustomerTags`,
  `useCustomerProfile`, `CustomerDetails` (Task 8).
- Produces: the visible inbox behaviour only.

- [ ] **Step 1: Write the failing tests**

Add to the existing test files, reusing each file's render helper and chat/message fixtures:

```tsx
// ChatListItem.test.tsx
it('shows up to two tags and a +N count', () => {
  renderItem({ chat: { ...baseChat, tags: ['VIP', 'Wholesale', 'Halal', 'Repeat'] } });
  expect(screen.getByText('VIP')).toBeVisible();
  expect(screen.getByText('Wholesale')).toBeVisible();
  expect(screen.queryByText('Halal')).toBeNull();
  expect(screen.getByText('+2')).toBeVisible();
});
```

```tsx
// ChatFilters.test.tsx
it('sets and clears the tag filter', async () => {
  const onChange = vi.fn();
  mockTags(['VIP', 'Wholesale']); // the file's fetch mock returning { tags: [...] } for /customer-tags
  renderFilters({ value: { assigned: 'any' }, onChange });
  await userEvent.click(screen.getByRole('button', { name: 'Filter by tag' }));
  await userEvent.click(await screen.findByRole('option', { name: 'VIP' }));
  expect(onChange).toHaveBeenLastCalledWith({ assigned: 'any', tag: 'VIP' });
});
```

```tsx
// MessageBubble.test.tsx
it('shows the sender profile name in groups and opens their details', async () => {
  renderBubble({
    message: {
      ...inbound,
      senderName: 'Farah 🌸',
      senderProfile: { chatJid: '601@s.whatsapp.net', name: 'Farah Aziz' },
    },
    showSender: true,
  });
  await userEvent.click(screen.getByRole('button', { name: 'Farah Aziz' }));
  expect(await screen.findByRole('link', { name: 'Open chat' })).toHaveAttribute(
    'href',
    '/chats/601%40s.whatsapp.net?customer=1',
  );
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run apps/web/src/inbox/ChatListItem.test.tsx apps/web/src/inbox/ChatFilters.test.tsx apps/web/src/inbox/MessageBubble.test.tsx`
Expected: FAIL. The new assertions are not met.

- [ ] **Step 3: Implement**

`ChatListItem.tsx`, after the assignee `Badge`:

```tsx
          {chat.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="max-w-24 shrink-0 truncate text-[11px]">
              {tag}
            </Badge>
          ))}
          {(chat.tags?.length ?? 0) > 2 && (
            <Badge
              variant="outline"
              className="shrink-0 text-[11px]"
              title={chat.tags!.slice(2).join(', ')}
            >
              {t('chatListItem.moreTags', { count: chat.tags!.length - 2 })}
            </Badge>
          )}
```

with `"moreTags": "+{{count}}"` in all three catalogs. Keep the row free of horizontal overflow at
360 px: chips are `shrink-0` with `max-w-24 truncate`, and the name keeps `min-w-0 truncate`.

`ChatFilters.tsx` gets a `Popover` + `Command` (both in `components/ui`):

- **Trigger:** `Button variant="outline" size="sm"`, aria-label `t('filters.tagLabel')` ("Filter by
  tag"), showing `value.tag ?? t('filters.tag')` with a `Tag` icon.
- **List:** `CommandInput` (placeholder `t('filters.tagSearch')`) and `CommandItem`s from
  `useCustomerTags(search)`. Selecting one calls `onChange({ ...value, tag })`.
- **Clearing:** when `value.tag` is set, the trigger is followed by a ghost icon `Button` (aria-label
  `t('filters.tagClear')`) that calls `onChange({ ...value, tag: undefined })`.
- **Empty list:** `t('filters.tagEmpty')`.

The keys are `tag` "Tag", `tagLabel` "Filter by tag", `tagSearch` "Search tags", `tagClear` "Clear tag
filter", `tagEmpty` "No tags yet". In ms: "Tag", "Tapis mengikut tag", "Cari tag", "Kosongkan tapisan
tag", "Belum ada tag". In zh-CN: "标签", "按标签筛选", "搜索标签", "清除标签筛选", "暂无标签".

`InboxPage.tsx` already stores the whole filters object in `sessionStorage`. Check `loadFilters()`:
if it validates known keys, allow `tag` (a string ≤ 30 characters).

`MessageBubble.tsx`:

```tsx
  const profile = !out ? (m.senderProfile ?? null) : null;
```

When `showSender && profile`, render the sender line as a `Popover`. Its trigger is a
`Button variant="link"` with `className="h-auto p-0 text-xs font-semibold text-primary"` and the text
`profile.name`. `PopoverContent` holds `<SenderProfileCard chatJid={profile.chatJid} />`, a small
component in the same file. That component:

- calls `useCustomerProfile(chatJid)`;
- renders `CustomerDetails` (from `./CustomerPanel`) read-only;
- ends with a `Link` (react-router, styled with `buttonVariants({ variant: 'outline', size: 'sm' })`)
  to `` `/chats/${encodeURIComponent(chatJid)}?customer=1` `` and the text `t('customer.open')`.

Without a profile, keep today's plain sender name.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npx vitest run apps/web/src/inbox apps/web/src/i18n && npm run typecheck -w @wa-team-inbox/web && npx eslint apps/web/src/inbox`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/inbox apps/web/src/i18n
git commit -m "feat(web): customer tags in the inbox, tag filter and group sender names"
```

---

### Task 10: End-to-end, smoke, screenshots, docs and final verification

**Files:**

- Create: `e2e/customer-profile.spec.ts`
- Modify: `e2e/screens.smoke.mjs` (open-panel route)
- Modify: `e2e/marketing-screenshots.mjs` (seed a profile)
- Modify: `docs/screenshots/chat/*`, `docs/screenshots/inbox/*` (regenerated)
- Modify: `CHANGELOG.md`, `AGENTS.md` (architecture line), `docs/LEARNINGS.md` (only for real lessons)

**Interfaces:**

- Consumes: everything above; the e2e helpers `fakeIncoming`, `customerJid`, `chatItem`, `inboxHeading`
  from `e2e/helpers.ts`.

- [ ] **Step 1: Write the e2e test**

```ts
// e2e/customer-profile.spec.ts
import { chatItem, customerJid, expect, fakeIncoming, inboxHeading, test } from './helpers';

test('edit a customer profile, see it in the inbox, filter by tag, live in a second tab', async ({
  page,
  context,
  baseURL,
}, info) => {
  const jid = customerJid(info, 41);
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();
  await fakeIncoming(page, baseURL!, { chatJid: jid, senderName: 'Farah 🌸', text: 'Hi!' });
  await chatItem(page, 'Farah 🌸').click();

  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('tab', { name: 'All' }).click();
  await expect(chatItem(second, 'Farah 🌸')).toBeVisible();

  await page.getByRole('button', { name: 'Customer details' }).click();
  await page.getByRole('button', { name: 'Add details' }).click();
  await page.getByLabel('Name').fill('Farah Aziz');
  await page.getByLabel('Company').fill('Farah Catering Co');
  await page.getByRole('combobox').fill('VIP');
  await page.getByRole('combobox').press('Enter');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('WhatsApp: Farah 🌸')).toBeVisible();

  // Live in the other tab, with the tag chip.
  await expect(chatItem(second, 'Farah Aziz')).toBeVisible();
  await expect(chatItem(second, 'Farah Aziz').getByText('VIP')).toBeVisible();

  // Tag filter.
  await second.getByRole('button', { name: 'Filter by tag' }).click();
  await second.getByRole('option', { name: 'VIP' }).click();
  await expect(chatItem(second, 'Farah Aziz')).toBeVisible();
});
```

Check `e2e/helpers.ts` for the real signatures of `fakeIncoming` and `chatItem` and adapt the calls.
The test must pass in both Playwright projects (desktop and mobile). On mobile, the panel is a bottom
sheet, and opening a chat hides the list, so use the existing `backToList` pattern from
`inbox.spec.ts` before checking the list.

- [ ] **Step 2: Extend the smoke and screenshot scripts**

- **`e2e/screens.smoke.mjs`:**
  - add the route `['conversation-customer', `/chats/${encodeURIComponent(CHAT)}?customer=1`]` after
    `conversation`;
  - before the screens loop, save a profile for `CHAT` through
    `page.request.put('/api/chats/…/profile', { data: {...}, headers: { origin: BASE } })` with a long
    CJK name (`'陈伟杰（槟城分店采购负责人）'`) to exercise truncation.
- **`e2e/marketing-screenshots.mjs`:**
  - after seeding chats, `PUT` a profile for Farah (`name: 'Farah Aziz'`,
    `company: 'Farah Catering Co'`, `email: 'orders@farahcatering.example'`, `address: 'Georgetown'`,
    `tags: ['VIP', 'Catering']`) and give Priya the tag `Repeat`;
  - add the shot `['chat', 'customer', '/chats/<Farah>?customer=1', ['desktop', 'mobile']]`.

- [ ] **Step 3: Docs**

`CHANGELOG.md`, under `## [Unreleased]` → `### Added`:

```markdown
- **Customer details:** every teammate can save a customer's name, company, email, other phone,
  address and tags from the chat. The name shows across the inbox (with the WhatsApp name kept),
  search finds these details, the inbox can be filtered by tag, and the customer's name also shows on
  their messages in group chats.
```

`AGENTS.md`, Architecture: after the **Events** paragraph, add:

```markdown
**Customer profiles.** `packages/server/src/customers/`: one profile per direct chat
(`customer_profiles`, `customer_tags`), edited by any teammate, audited by changed field names only.
`rowToChat` prefers the profile name and adds `tags`/`whatsappName`; startup merges carry profiles
(`customers/merge.ts`); group messages get `senderProfile` via `AliasStore.route()`.
```

- [ ] **Step 4: Final consolidated verification (only once, here)**

Run, in order:

```bash
npm run typecheck
npm test
npm run lint
npm run build -w @wa-team-inbox/web
npm run e2e
```

Then:

1. Start a fresh `--fake-wa --mode standalone` server on a temp `--data` dir.
2. Run `node e2e/screens.smoke.mjs http://127.0.0.1:<port> <tmp>/screens`, then
   `SMOKE_LOCALE=ms node e2e/screens.smoke.mjs …`.
3. Expected: no page errors and no overflow.
4. Review the conversation-customer shots at 1280 and 360 px top to bottom.
5. Regenerate the screenshot library with `node e2e/marketing-screenshots.mjs <port> docs/screenshots`
   on a fresh server.

Expected: everything is green. Any failure is fixed in its owning task's files, followed by a re-run
of the failing command only.

- [ ] **Step 5: Commit and open the PR**

```bash
git add e2e docs CHANGELOG.md AGENTS.md
git commit -m "test(e2e): customer profile flow; docs and screenshots"
git push
gh pr create --base main --head feat/customer-profile --title "feat: customer profiles (lead info)" --body-file <scratchpad>/customer-profile-pr.md
```

The PR body lists what changed, the validation run above, and "untested against real WhatsApp"
for group sender matching.
