# Customer profile (lead info): design

Status: approved in conversation on 2026-10-06; waiting for written-spec review.

## Goal

Every teammate can see and edit who a customer is: proper name, company, email, other phone, address/area
and tags. Any teammate who opens the chat then knows the customer at a glance. Phase 1 is a simple
customer profile. It is not a CRM.

### Decided with the owner

| Topic             | Decision                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Purpose (overall) | Remember who the customer is now; AI use and export later                                                          |
| Permissions       | Every signed-in teammate sees and edits; every change is audited (who, when, which fields)                         |
| Profile fields    | Name, company, email, other phone, address/area, tags                                                              |
| Sales pipeline    | Not built ("that is CRM already, keep simple")                                                                     |
| AI Sales Agent    | Not in phase 1                                                                                                      |
| Export            | Not in phase 1                                                                                                      |
| Tags              | Free text with suggestions from existing tags; the inbox can filter by tag                                         |
| Profile name      | Used everywhere in EzyChat (inbox, header, search); the WhatsApp name stays visible; the phone's contacts never change |
| Storage approach  | New tables keyed by the one-to-one chat (approach 1 of 3)                                                          |

### Out of scope (later phases; the data model must not block them)

- AI reads the profile and suggests details it heard in the chat.
- CSV export for admins.
- CRM sync (Enterprise).
- Sales pipeline (stage, value, follow-up).

## 1. Data and rules

### Storage: migration `007_customer_profiles.sql`

```sql
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
  tag TEXT NOT NULL,            -- display spelling
  tag_key TEXT NOT NULL,        -- lower-cased, trimmed: uniqueness and filtering
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_jid, tag_key)
);
CREATE INDEX idx_customer_tags_key ON customer_tags(tag_key);
```

- Profiles exist only for one-to-one chats (`chats.type = 'dm'`). Group chats have none.
- **Keying.** The key is the chat JID, because the chat is already the app's single identity for a
  person: phone-number and LID chats are merged, and runtime code never merges. This avoids the
  phone-number/LID "twin" problem that a `contacts`-keyed design would have.
- An empty or whitespace-only field is stored as `NULL`, meaning "not set".

### Field rules

There is one zod schema in `packages/shared`, `CustomerProfileBody`, and both the server and the web use it.

| Field         | Rule                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `name`        | trimmed, ≤ 120 characters                                                  |
| `company`     | trimmed, ≤ 120 characters                                                  |
| `email`       | trimmed, ≤ 254 characters, valid email shape                               |
| `otherPhone`  | trimmed, ≤ 32 characters, only digits, spaces, `+`, `-`, `(`, `)`          |
| `address`     | trimmed, ≤ 300 characters                                                  |
| `tags`        | ≤ 10 tags, each trimmed, 1–30 characters; duplicates ignored ignoring case |

**Tag spelling.** On save, a tag whose key (lower-cased and trimmed) already exists on any customer
takes the existing display spelling, so "vip" becomes "VIP" when "VIP" already exists. Otherwise
the typed spelling is kept.

### Display name

- The chat's display name is the profile `name` when it is set. Otherwise it is today's name
  (WhatsApp saved or push name, then the phone number).
- `Chat` gains `whatsappName` (the previous display source), so the UI can show it underneath.

### Search

The existing inbox search (`chats/repo.ts`, `LIKE … ESCAPE`) also matches the profile name,
company, email, other phone and tags.

### Audit

- Each save that changes something writes an audit log entry (`customer.profile_update`), meta
  `{ chatJid, changed: ['name', 'tags', …] }`. It never holds the field values, because they are
  personal data.
- A save with no changes writes nothing.
- The panel shows "Updated by <teammate> · <relative time>".
- There is no timeline line. `chat_events.type` has a `CHECK` limited to
  assigned/unassigned/resolved/reopened, and widening it means rebuilding the table in SQLite. That
  is not worth it for this line. (Changed after the conversation; see "Changes from the conversation".)

### Duplicate merge (`chats/merge.ts`)

When the startup identity migration merges chat B into chat A:

- **Fields:** for each field, the non-empty value with the newer `updated_at` wins. The surviving row
  keeps the newer `updated_at` and `updated_by`.
- **Tags:** the union of both sets, deduplicated by `tag_key`, capped at 10 (the oldest beyond 10 are
  dropped and logged by count only).
- `merge.ts`'s `moved` report gains `profiles` and `tags` counts. The pre-merge backup already
  covers the tables.

## 2. API and live updates

All routes need a signed-in user (any role). Mutating routes go through the existing Host and
Origin checks.

| Route                          | Behaviour                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/chats/:jid/profile`  | `{ profile: { name, company, email, otherPhone, address, tags, updatedAt, updatedBy }, whatsappName }`. Empty profile if none; 400 for group chats |
| `PUT /api/chats/:jid/profile`  | Validate `CustomerProfileBody`, save the whole profile in one transaction (last write wins), return the profile                                  |
| `GET /api/customer-tags?q=`    | Existing tags for suggestions: prefix match first, most used first, ≤ 20                                                                         |
| `GET /api/chats?tag=<tag>`     | `ChatListQuery` gains optional `tag` (matched by key), combined with the existing filters                                                       |

- `:jid` resolves through the existing `chatJidParam`, so an old alias reaches the merged chat.
- **Live updates:** a save emits the existing `chat:updated` with the new display name, `whatsappName`
  and `tags`. No new socket channels.
- **Contract:** `ChatSchema` gains `tags: string[]` and `whatsappName: string | null`. `ChatListQuery`
  gains `tag`. The schemas change first.
- **Errors:** validation errors return field-level messages, the same format as other forms. A
  missing chat returns 404, and the web follows the existing canonical-chat redirect.

## 3. Screens

- **Customer button.** The chat header gets a **Customer** button next to **Notes**.
  - Desktop: a right-hand panel beside the conversation.
  - Phones: a bottom sheet (`ResponsiveDialog`), like Notes.
  - It works at 360 px with no horizontal scroll.
- **Read view.**
  - The name, with "WhatsApp: <whatsappName>" underneath.
  - Company, email, other phone, address and tag chips. Empty fields are hidden.
  - "Updated by <teammate> · <relative time>".
  - When nothing is set: "No details yet" and an **Add details** button.
- **Edit view.**
  - The same panel becomes a form (shadcn inputs).
  - The tag input suggests tags from `/customer-tags`. Enter or comma adds a tag; Backspace on an
    empty input removes the last one.
  - **Save** and **Cancel**. Ctrl/Cmd+Enter saves. Esc cancels when nothing has changed; otherwise
    it asks to discard.
- **Inbox list.** Each customer shows the profile name, with up to 2 tag chips plus "+N".
- **Tag filter.** It joins the Mine/Unassigned/All and Open/Resolved filters, picked from the
  suggestions, and stays remembered while switching chats.
- **Text and style.** All text goes through `t()` with keys in `en`, `ms` and `zh-CN`. Only design-system
  components and tokens (Calm Desk). Every route keeps its `ErrorBoundary`.

## 4. Testing

- **Server unit tests:**
  - validation limits;
  - tag cleanup (trim, case-insensitive dedupe, existing spelling reused, cap of 10);
  - empty means `NULL`;
  - display name and `whatsappName`;
  - search over the new fields;
  - the merge rule (newest non-empty field wins, tags unioned and capped);
  - the audit meta lists changed fields only and never values;
  - a no-change save writes nothing.
- **Route tests:**
  - signed-in only;
  - agents can edit;
  - 400 for groups;
  - Origin check on PUT;
  - an alias JID resolves to the merged chat;
  - the `tag` filter.
- **Web tests:**
  - panel read, empty, edit, save and cancel;
  - the tag input (add, remove, suggestions, cap);
  - inbox chips with "+N";
  - the tag filter.
- **End-to-end** (`e2e/customer-profile.spec.ts`), desktop and mobile:
  - edit a profile, and the inbox shows the new name and chips;
  - filter by tag;
  - a second page updates live.
- **Smoke test:** `screens.smoke.mjs` covers the open panel at 1280 and 360 px, plus a Malay pass.
- **Screenshot library:** `e2e/marketing-screenshots.mjs` seeds a profile, and the `chat/` and `inbox/`
  shots are refreshed.

## Changes from the conversation

- **Timeline line dropped.** Section 1 proposed a "<teammate> updated customer details" line in the
  chat timeline. `chat_events.type` is restricted by a SQLite `CHECK`, so adding a type needs a table
  rebuild. Who and when are shown in the panel and recorded in the audit log instead.

## Risks and notes

- **Personal data.** The profile adds personal data (email, address). It stays in the local SQLite
  database and the nightly backups, as chats already do. Audit logs and app logs never contain the
  values. The privacy wording in `docs/` and the website already says customer data stays on the
  computer.
- **Last write wins.** Two teammates saving at the same moment: the later save wins. The live update
  shows the result immediately. A small team does not need locking.
- **Tag growth.** Free tags can multiply. The suggestions and key-based deduplication keep spelling
  consistent. An admin tag manager (rename or merge tags) is a later phase.
