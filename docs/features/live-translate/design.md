# Live translate

Status: **mock confirmed by the owner 2026-11-19 ("ok mock").** Server: branch `claude/live-translate-server`
(session A); web: a parallel session (B). Mock PR #387, branch `claude/happy-bardeen-p0jwtc`.
Same behaviour, labels and protected-items list as Cloud's proposal (`anchorsprint/ezychat-cloud` PR #107,
`docs/proposals/2026-11-19-live-translate.md`); only the look differs (Calm Desk here, Familiar there). Lasting rules
and the decision log: [docs/live-translate.md](../../live-translate.md).

## Request (owner, verbatim)

> as malay staff, when they want to support via ezychat to customer or external using non malay, it is hard to
> communicate, can we use AI to auto translate mode, e.g: malay staff can enable live translate mode, where they type
> malay, and will send in another language, and when the other side type in diff language will auto translate to
> malay, but they can choose to see original text if they want, if they disable live translate mode, it go back to
> what actual msg they send, this apply to any main language they want to use. implement this to ezychat lite
> enterprise and cloud.

Real case behind it: an Enterprise customer whose Malay-speaking admin cannot serve their Chinese-speaking clients
(not named in this public repository; demo data only).

## Owner decisions (2026-11-19)

1. The preview before sending is **on by default**. Each person can turn on **"Send without preview"** (Account).
2. **No back-translation** in the preview, to save cost.
3. The **customer language is per chat** and shared by all staff. The Live translate switch is still per person.
4. **Search through translations comes later**, not in v1.
5. **All staff** may use it. Admins can switch it off for everyone (Settings → AI).
6. The default daily limit is **200 translations per person**, and admins can change it.
7. **Groups** have one outgoing language per group.
8. The customer sees **no "(translated)" mark**.
9. Incoming text is translated when **less than 70 %** of it is already in My language.
10. The labels and the protected items (numbers, prices, links, emails, phones, mentions, codes) are **the same as
    Cloud's**.

## Problem and users

- **Staff** who read and write one language well (often Malay) serve customers who write another (Chinese, English,
  Tamil, Indonesian, Thai, …). Today they copy text into Google Translate and back, or hand the chat to a colleague.
- **The customer** must get a natural message in their own language, and never a wrong price or number.
- **Teammates** reading the same chat later must see what was really sent, and what the writer typed.
- **The admin** decides whether the team may use it (it uses the AI connection, so it costs money) and how much.

## Rules (v1)

1. **My language** is set per person in Account → My language, and also in the chat's Languages popover. It defaults
   to the app language (en → English, ms → Bahasa Melayu, zh-CN → 中文) until the person picks one, and it is separate
   from the app language. The choices are Bahasa Melayu, English, 中文, Bahasa Indonesia, தமிழ், ไทย, Tiếng Việt,
   العربية, 日本語 and 한국어, each shown in its own name. The list is a constant in `packages/shared`.
2. **The switch is per person and per chat.** The **Translate** button in the chat header (label "Live translate")
   turns it on or off for me in this chat only. It is remembered on the server and stays on until I turn it off. It is
   hidden everywhere while the admin switch is off.
3. **The customer language is shared per chat.** It is detected from the customer's last 10 messages: the script
   decides alone for Chinese, Tamil, Thai, Arabic, Japanese and Korean; for Latin-script text the model decides in the
   same call that translates. It shows as "中文 → Bahasa Melayu · detected", and as "中文 + English" when the customer
   mixes languages. Any teammate can change it under Languages; a chosen language wins over detection and is shared
   with the team. If the customer writes in my language: "This customer writes in your language. Nothing to
   translate." If no language is known yet, replies go out untranslated and the bar says so.
4. **Incoming, when on:** text, captions, voice-note transcripts (when one exists) and the AI agent's replies show in
   My language when **less than 70 %** of the text is already in My language. A mostly-Malay message with a Chinese
   word stays as it is and has no label. Each translated bubble reads "Translated from 中文 · Show original"; **Show
   original** opens the original under the translation in the same bubble. The bar's **Show originals** switch opens
   all of them in this chat. Our own replies without a typed record (the AI agent's, or ones sent from the phone)
   read "Sent in 中文 · Show sent text".
5. **Outgoing, when on** (a direct chat whose language is known and differs from mine, or a group whose outgoing
   language differs): the person types in My language. **Send** (or Enter) shows **"Customer will get · 中文"** above
   the composer. It contains:
   - _You wrote (Bahasa Melayu)_, with **Change** → **Translate again**;
   - the translated text, in the outbound colour;
   - "Kept unchanged:" with the protected items as chips;
   - the buttons **Send** (primary, Ctrl+Enter), **Edit translation** (edits only the translated text, then **Done**;
     the text is then marked "edited") and **Send original instead**;
   - ✕ **Keep editing** (Esc).

   There is no back-translation. The customer gets only the sent text, with no "translated" mark.

6. **Send without preview** (Account, per person, off by default): Send translates and sends at once. The protected
   items check still runs. A refusal or failure opens the same card with the reason, and nothing is sent.
7. **Each sent message keeps both texts.** The message row is what WhatsApp got; a record stores what was typed, its
   language, the sent language and whether the translation was edited. With the switch on, the writer sees what they
   typed, with "Sent in 中文 · Show sent text". Everyone else, and the writer with it off, sees the real sent text with
   "Written in Bahasa Melayu · Show what was typed". This needs no AI call because it is stored. **Send original
   instead** marks the bubble "Sent without translation" for whoever has it on.
8. **Off:** every message shows exactly as sent or received. Turning it off never changes stored messages.
9. **Protected items (same list as Cloud):**
   - numbers, prices and amounts;
   - dates and times written in digits;
   - links and emails;
   - phone numbers;
   - @mentions;
   - order and tracking codes (letters with digits);
   - emoji.

   The server takes them from the source text and checks that each one appears unchanged in the translation (spaces
   ignored). If one is missing or changed, the translation is **refused with the reason**: "RM1,260.00 became
   RM4,260.00. Nothing was sent.", with **Try again** and **Send original instead**. An incoming translation that
   changed one is never shown: the bubble shows the original with "Could not translate safely".

10. **Failures are visible, and nothing is sent silently or retried by itself:**
    - no connection: "Cannot translate. No connection. Nothing was sent.";
    - no AI: "Live translate needs AI. Ask an admin to connect AI in Settings → AI. Nothing was sent.";
    - model error: "Could not translate. Nothing was sent.";
    - daily limit: "Daily limit used (200 translations). Nothing was sent.";
    - an admin switched it off meanwhile.

    **Send original instead** always works. Incoming messages show the original with "Not translated: daily limit
    used / Live translate needs AI / no connection", or "Could not translate · Try again".

11. **Admin (Settings → AI → Live translate):**
    - "Live translate for everyone": **on by default**, so all staff may use it. Turning it off hides it everywhere.
    - "Daily limit per person": default **200**, 0 = no limit.
    - A privacy line and today's usage.

    The model is the install's "Model for suggestions" (no separate choice, as in Cloud). Changes are audited before
    and after as `settings.live_translate`.

12. **Cost and cache:** each translated message and each sent translation counts one against the person's daily
    limit. A translation is cached per message, revision and target language, so a reload, Show originals or a
    teammate with the same language costs nothing. A chat translates only the messages on screen, at most 50 per
    request.
13. **Privacy:** message text goes to the install's own AI connection, as it does for reply suggestions. Logs and
    audit hold counts, language codes, model, ms and result codes only, never text or message ids in analytics.
    Translation rows are deleted with their message or chat.

## Interplay decisions (same as Cloud)

| With                            | Decision                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fix English                     | Off in a chat while Live translate is on there (the person types in My language).                                                                                                                     |
| AI agent replies                | The agent keeps answering in the customer's language. With the switch on, staff see its replies in My language with "Sent in 中文 · Show sent text". The prompt is unchanged.                         |
| Reply suggestions / Complete    | With the switch on, suggestions are drafted in My language and go through the same preview at Send.                                                                                                   |
| Quick replies                   | Inserted as written, then translated at Send like typed text.                                                                                                                                         |
| Forward                         | Forwards the real sent or received text.                                                                                                                                                              |
| Search                          | Searches the real message text only in v1. Searching through translations comes later.                                                                                                                |
| Ask Ezy, MCP, Reports, Dream    | Use the real text. MCP `get_messages` may add `typedText` / `typedLanguage` on translated team replies (read only).                                                                                   |
| Chat list                       | When my switch is on for that chat, the last-message line shows the cached translation, if there is one, with the language icon. The list never calls AI.                                             |
| Push notifications              | Real text.                                                                                                                                                                                            |
| Groups                          | Incoming: each message is translated from its own language. Outgoing: one language per group, chosen under Languages (default: the most used language of the last 20 messages; shared with the team). |
| Business API window / templates | Free-form sends follow the window as today. Templates are never translated.                                                                                                                           |
| Edits and deletes               | An edited incoming message is translated again (new revision). Editing a sent translated reply edits the sent text; the typed text stays. Deleting removes the translation rows.                      |
| Reply quotes                    | A quote shows the same view as its bubble.                                                                                                                                                            |
| Limited agents (chosen chats)   | Same feature, in the chats they can open.                                                                                                                                                             |

## Implementation contract (Lite; two sessions in parallel)

The contract below is final for v1. Session **A** (server) and session **B** (web) build against it at the same time.
Session A lands `packages/shared` first, in its own commit, so that B can rebase onto it.

### Shared: `packages/shared/src/live-translate.ts` (exported from `index.ts`)

```ts
export const TRANSLATE_LANGUAGES = [
  'ms',
  'en',
  'zh',
  'id',
  'ta',
  'th',
  'vi',
  'ar',
  'ja',
  'ko',
] as const;
export const TranslateLanguage = z.enum(TRANSLATE_LANGUAGES);
export const LIVE_TRANSLATE_DEFAULT_DAILY_LIMIT = 200;
export const LIVE_TRANSLATE_MAX_BATCH = 50;
export const LIVE_TRANSLATE_SAME_LANGUAGE_SHARE = 0.7; // translate only below 70 % in My language

export const LiveTranslateSettings = z.object({
  enabled: z.boolean().default(true),
  dailyLimit: z.number().int().min(0).max(10_000).default(200),
});
export const LiveTranslateSettingsBody = LiveTranslateSettings.partial();
export const LiveTranslateStatus = LiveTranslateSettings.extend({
  connected: z.boolean(), // AI connection ready ("Model for suggestions")
  usedToday: z.number().int(), // mine
  peopleToday: z.number().int().optional(), // admins only
  translationsToday: z.number().int().optional(), // admins only
});
// /api/me gains (zod defaults so older clients/servers keep working):
//   translateLanguage: TranslateLanguage.nullable().default(null)  (null = from the app language)
//   sendWithoutPreview: z.boolean().default(false)
export const ChatTranslateState = z.object({
  on: z.boolean(), // my switch
  customerLanguage: TranslateLanguage.nullable(), // chosen (shared)
  detected: TranslateLanguage.nullable(),
  mixed: TranslateLanguage.nullable(),
  outgoingLanguage: TranslateLanguage.nullable(), // groups: chosen (shared)
  outgoingDetected: TranslateLanguage.nullable(), // groups: most used of the last 20
});
export const ChatTranslateBody = z.object({
  on: z.boolean().optional(),
  customerLanguage: TranslateLanguage.nullable().optional(),
  outgoingLanguage: TranslateLanguage.nullable().optional(),
});
export const TranslationsBody = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(50),
  target: TranslateLanguage,
});
export const MessageTranslation = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), text: z.string(), from: TranslateLanguage }),
  z.object({ status: z.literal('same_language') }),
  z.object({ status: z.literal('unsafe'), from: TranslateLanguage }),
  z.object({ status: z.literal('limit') }),
  z.object({ status: z.literal('ai_unavailable') }),
  z.object({ status: z.literal('failed') }),
]);
export const TranslationsResponse = z.object({
  translations: z.record(z.string(), MessageTranslation),
});
export const TranslateDraftBody = z.object({
  text: z.string().min(1).max(4096),
  target: TranslateLanguage,
});
export const TranslateDraft = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    translation: z.string(),
    from: TranslateLanguage,
    protected: z.array(z.string()),
    draftId: z.string(),
  }),
  z.object({ status: z.literal('refused'), item: z.string(), became: z.string() }),
]);
export const SendTranslation = z.object({
  // optional block on the existing send body
  draftId: z.string(),
  typedText: z.string().min(1).max(4096),
  typedLanguage: TranslateLanguage,
  edited: z.boolean().default(false),
});
export const TypedRecord = z
  .object({
    // on Message, optional, default absent
    typedText: z.string(),
    typedLanguage: TranslateLanguage,
    sentLanguage: TranslateLanguage,
    edited: z.boolean(),
  })
  .nullable()
  .default(null);
// Message gains `typed: TypedRecord` and `sentOriginal: z.boolean().default(false)` ("Send original instead").
export function protectedItems(text: string): string[]; // shared, pure: the web shows the chips
export function changedItem(
  source: string,
  translation: string,
): { item: string; became: string } | null;
export function shareInLanguage(text: string, lang: TranslateLanguage): number; // script/word share, 0..1
```

### Server (session A): routes, all under `/api`, Origin rule as usual

| Method | Path                              | Who                     | Body → answer                                                                                                                                                                                                                                                        |
| ------ | --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/live-translate`                 | any user                | → `LiveTranslateStatus`                                                                                                                                                                                                                                              |
| PUT    | `/live-translate/settings`        | admins                  | `LiveTranslateSettingsBody` → `LiveTranslateStatus`; audit `settings.live_translate` {before, after}                                                                                                                                                                 |
| PATCH  | `/me` (existing)                  | the user                | adds `translateLanguage`, `sendWithoutPreview`; audit `user.translate_language` {language} only                                                                                                                                                                      |
| GET    | `/chats/:jid/live-translate`      | inbox access (else 404) | → `ChatTranslateState`                                                                                                                                                                                                                                               |
| PUT    | `/chats/:jid/live-translate`      | inbox access            | `ChatTranslateBody` → `ChatTranslateState`; a language change is shared, `on` is mine                                                                                                                                                                                |
| POST   | `/chats/:jid/translations`        | inbox access            | `TranslationsBody` → `TranslationsResponse`; cached first; one AI call for the rest; 120 a minute per user                                                                                                                                                           |
| POST   | `/chats/:jid/translate-draft`     | inbox access            | `TranslateDraftBody` → `TranslateDraft`; counts one; 60 a minute per user; 409 `translate_off`, 429 `translate_limit`, 503 `ai_unavailable`                                                                                                                          |
| POST   | `/chats/:jid/messages` (existing) | as today                | optional `translation: SendTranslation` (or `sentOriginal: true`): the server checks the draft belongs to the caller and chat, that `protectedItems(typedText)` are all in the sent text (400 `translation_changed`), stores `message_typed` in the same transaction |

- Migration **046** `live_translate`:
  ```sql
  CREATE TABLE message_translations (
    message_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL,
    source TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, revision, target));
  CREATE TABLE message_typed (
    message_id TEXT PRIMARY KEY, user_id INTEGER, typed_text TEXT NOT NULL, typed_lang TEXT NOT NULL,
    sent_lang TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0, sent_original INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL);
  CREATE TABLE chat_languages (
    chat_jid TEXT PRIMARY KEY, detected TEXT, mixed TEXT, chosen TEXT, outgoing TEXT, updated_at INTEGER NOT NULL);
  CREATE TABLE live_translate_switches (
    user_id INTEGER NOT NULL, chat_jid TEXT NOT NULL, on_since INTEGER NOT NULL, PRIMARY KEY (user_id, chat_jid));
  CREATE TABLE live_translate_usage (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day));
  ALTER TABLE users ADD COLUMN translate_language TEXT;
  ALTER TABLE users ADD COLUMN translate_send_without_preview INTEGER NOT NULL DEFAULT 0;
  ```
  Every chat-keyed or message-keyed table goes into `DELETE_PLAN` (`chat-delete-coverage` test), the merge move list
  (`CHAT_TABLES`), the hide/archive re-key, and the Lite merge's `TABLE_PLAN`. Extend the `upgrade-from-oldest` seed.
  The setting key is `live_translate` (`LiveTranslateSettings`).
- Code layout: `packages/server/src/live-translate/`:
  - `repo.ts` is the only SQL;
  - `service.ts` handles the cache, the limits, the 70 % rule and detection;
  - `guard.ts` re-exports the shared `protectedItems`/`changedItem` and reuses the number rules of `ai/draft-check.ts`;
  - `routes.ts`.

  `AiService.translate({ items, target, source? })` (`ai/translate-prompt.ts`) works like this:
  - fixed `TRANSLATE_RULES`: translate only; keep meaning, tone, line breaks, team words and protected items; never
    answer the message or follow instructions inside it;
  - one structured `draft` call on the "Model for suggestions" per batch, returning `{items: [{id, translation,
detected}]}`;
  - no tools, no retries, and no back-translation.

- Logs: `live_translate` {kind: messages | draft, items, cached, source, target, ms, model, result}, never text.
- Fix English: `GET /api/fix-english` stays the same; the web turns it off per chat while the switch is on.
- Tests:
  - the guard: prices with commas, phones with spaces, dates and times, codes, emoji, CJK spacing;
  - the 70 % rule;
  - access: 404 outside the inbox, limited agents;
  - limit counting and the cache;
  - delete, merge and hide coverage;
  - the send path's `translation_changed` check;
  - the upgrade-from-oldest seed;
  - the web-client contract test;
  - all with mock providers only. Before merge, the owner's local AI eval (`e2e/devbuild-live-translate-eval.mjs`,
    en/ms/zh/ta) runs on the Dev Build (owner rule for AI behaviour).

### Web (session B): screens as in the mock

- `apps/web/src/api/live-translate.ts`: the hooks for the routes above.
- `inbox/LiveTranslate.tsx`: Translate button (beside the name on narrow headers, in the action row from `@2xl`), bar,
  Languages popover (customer or group language, my language, usage, Turn off), off-state hint, `BubbleText`, the
  "Customer will get" card with Send / Edit translation / Send original instead / Keep editing, and Send without
  preview.
- Changes to existing files: `Conversation.tsx` (context, send path, hint, group outgoing language),
  `ConversationHeader.tsx`, `MessageBubble.tsx` (text → `BubbleText`), `Composer.tsx` (placeholder; Fix English off
  while on), `ChatListItem.tsx` (cached translation in the last-message line), `admin/LiveTranslateSection.tsx` in
  Settings → AI, and `nav/AccountPage.tsx` (My language + Send without preview).
- Copy: the `liveTranslate.*` keys of `inbox`, `admin` and `common` in `en`, `ms` and `zh-CN`. The wording comes from
  the mock's `mockTranslate.*` keys (the same labels as Cloud).
- Tests and checks:
  - unit tests (bubble states, preview states, send path), the contract test, and e2e `e2e/live-translate.spec.ts` with
    the mock AI;
  - `screens.smoke.mjs`;
  - a screen review against this mock at 1280 and 360, light and dark;
  - design-system entries for "Translated text" and the "Customer will get" preview.

### Editions

1. **Lite (core, free):** everything above ships in `packages/{shared,server}` and `apps/web`, with no edition gate.
2. **Enterprise:** gets it through the published `@ezychat/*` core with no Enterprise code. Before merge, run the
   Enterprise typecheck, lint and tests on `npm run pack:core` tarballs.
3. **Cloud:** ports it separately (anchorsprint/ezychat-cloud PR #107). The rules, labels, protected items and API
   shapes above are kept the same; Cloud stores the data in its Workspace Durable Object and counts usage against its
   AI allowance.

## Screen and state checklist (mock `mock/`, shots `screenshots/`, `-d1280-light` unless noted)

| #   | Screen / state                                                                         | Shot                                                                          |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Settings → AI → Live translate (for everyone, daily limit 200, privacy, usage)         | `01-settings-ai` (+ `-m360-light`)                                            |
| 2   | Account → My language and Send without preview                                         | `02-account-my-language` (+ `-m360-light`), `25-account-send-without-preview` |
| 3   | On: translated bubbles, long text, mixed "中文 + English", a mostly-Malay message kept | `03-chat-on` (+ dark, `-m360-*`, `-ms`, `-zh-CN`)                             |
| 4   | Show original on one bubble                                                            | `04-show-original` (+ `-m360-*`)                                              |
| 5   | Show originals for the whole chat                                                      | `05-show-originals-all`                                                       |
| 6   | Languages popover (customer language shared, my language, usage, Turn off)             | `06-languages-popover` (+ `-m360-*`)                                          |
| 7   | Customer will get · 中文 (Kept unchanged chips)                                        | `07-preview` (+ dark, `-m360-*`)                                              |
| 8   | Edit translation, then edited                                                          | `08-preview-editing`, `08b-preview-edited`                                    |
| 9   | Sent: what I typed, "Sent in 中文 · Show sent text"                                    | `09-sent`, `10-sent-show-sent-text`                                           |
| 10  | The customer writes again                                                              | `11-customer-writes`                                                          |
| 11  | Refused: "RM1,260.00 became RM4,260.00. Nothing was sent."                             | `12-preview-refused`                                                          |
| 12  | Daily limit used                                                                       | `13-preview-limit`                                                            |
| 13  | No connection; no AI                                                                   | `14-no-connection`, `14b-no-ai`                                               |
| 14  | Incoming failed (Could not translate · Try again)                                      | `15-translation-failed`                                                       |
| 15  | Send original instead → "Sent without translation"                                     | `16-sent-original`                                                            |
| 16  | Turned off: real messages, "Written in … · Show what was typed"                        | `17-chat-off`                                                                 |
| 17  | English customer: hint while off, turned on, preview into English                      | `18-english-off-hint`, `19-english-on`, `20-english-preview`                  |
| 18  | Group: each member's language; one outgoing language                                   | `21-group-on`, `21b-group-languages`                                          |
| 19  | Teammate with it off                                                                   | `22-teammate-off`, `23-teammate-show-typed`                                   |
| 20  | Admin switched it off: no Translate button                                             | `24-admin-off-chat`                                                           |
| 21  | Send without preview: sent at once                                                     | `26-sent-without-preview`                                                     |

`screenshots/results.json` lists the 43 shots; every shot was checked for page errors and horizontal overflow, and
none had either. The mock does not cover: voice-note transcript translation (it takes the same path as text), the chat
list line, editing a sent reply, reply suggestions in My language, and Fix English being turned off (no English is
typed in the demo).

## Closed after the owner's look (2026-11-19)

1. **Hint while off** ("Customer writes in 中文 · Translate"): shown, as in Cloud, and dismissable per chat.
2. **Admin default:** "Live translate for everyone" is **on** for new and updated installs. Cloud should align to on.

## Mock

Source: a clone of the owner-confirmed **app-navigation** mock (`docs/features/app-navigation/mock`, recorded revision
`dc0d5ce640bd06322a86a423a25c88f3f54e58f8`), copied from `main` at `a09e3a9b` without its screenshots. How to run it
and the file list: [mock/README.md](mock/README.md); the frozen-file manifest is in `mock/reference.json`
(`snapshot.mjs --check` passes). Everything else is the baseline unchanged. These files are new or changed on purpose:

- Added:
  - `mock/live-translate.ts`: stand-in routes `/api/mock/live-translate*`, the phrase table, detection, the 70 % rule,
    the protected items and the seed;
  - `mock/translate-shots.mjs`;
  - `mock/src/mock/liveTranslate.ts`;
  - `mock/src/mock/MyLanguageField.tsx`;
  - `mock/src/inbox/LiveTranslate.tsx`;
  - `mock/src/admin/LiveTranslateSection.tsx`.
- Changed:
  - `mock/proposal.ts`, `mock/seed.ts`, `mock/run.ts`, `mock/reference.json`, `mock/README.md`;
  - `mock/src/inbox/Conversation.tsx`, `mock/src/inbox/ConversationHeader.tsx`, `mock/src/inbox/MessageBubble.tsx`;
  - `mock/src/admin/SettingsPage.tsx`, `mock/src/nav/AccountPage.tsx`;
  - the `mockTranslate` keys of `src/i18n/locales/{en,ms,zh-CN}/{inbox,admin,common}.json`.

The mock never calls a model. Translations come from a fixed phrase table; text outside it gets a marked
"(Chinese · demo) …" translation.

## Confirmation record

- 2026-11-19: owner decisions 1–10 above, relayed by the main session (session_01J4pmGkCf1Mvdepudm8WQAd); the mock
  was updated to them.
- 2026-11-19: **the owner confirmed the updated mock ("ok mock")**, relayed by the main session, with the final
  decisions: the admin switch is on by default for new and updated installs, and the off-state hint "Customer writes
  in 中文 · Translate" is shown. Confirmed revision `ea070366d62d4ecf72a57479c0829861d74cfee5`;
  `docs/features/mock-index.json` `latestConfirmed` now points to it.

## Implementation notes (server, session A)

Deviations from the contract above, agreed by keeping clients working:

- `Message.typed` and `Message.sentOriginal` are **optional** on `Message` (`typed?: TypedRecordValue | null`,
  `sentOriginal?: boolean`) instead of zod defaults, so existing fixtures and older servers keep parsing. Read them as
  `typed ?? null` and `sentOriginal ?? false`. `TypedRecord` (nullable, default null) is still exported.
- `PatchMeBody` fields are all optional; `MeResponse` = `UserSchema` plus `translateLanguage` and `sendWithoutPreview`.
- Extra error codes: 400 `translation_expired` (the draft is unknown, older than 30 minutes, or not the caller's or
  this chat's: translate again) and 503 `translate_failed` (the model call failed: "Could not translate. Nothing was
  sent.").
- Extra shared helpers: `TRANSLATE_LANGUAGE_NAMES`, `translateLanguageForLocale`, `guessLanguage`,
  `LIVE_TRANSLATE_TEXT_CHARACTERS`.
