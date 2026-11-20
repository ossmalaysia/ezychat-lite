# Live translate

Lasting rules and decision log for Live translate (owner rule: a core feature's decisions outlive its feature
folder). Design and confirmed mock: [docs/features/live-translate/design.md](features/live-translate/design.md)
(pruned later; the revision is in `docs/features/mock-index.json`). Add a decision line here whenever a rule changes.

## What it does

A teammate reads a chat in **My language** and types in it. Incoming text is shown in My language; a reply goes out in
the customer's language after a **"Customer will get"** preview. Every sent reply keeps both texts. Off, every message
shows exactly as sent or received.

## Rules

- **Who:** every signed-in person with access to the chat (limited agents in their chosen chats). One admin switch
  "Live translate for everyone" (setting `live_translate` {enabled, dailyLimit}), **on by default** for new and
  updated installs; off answers 409 `translate_off` on every Live translate route.
- **My language** per person (`users.translate_language`, null = from the app language: en → English, ms → Bahasa
  Melayu, zh-CN → 中文). Languages: `TRANSLATE_LANGUAGES` in `packages/shared/src/live-translate.ts`.
- **Switch** per person and chat (`live_translate_switches`). **Customer language** per chat and shared
  (`chat_languages.chosen` wins over `detected`; `mixed` = a second language with at least 2 of the last 10 customer
  messages). Groups: one shared outgoing language (`outgoing`, else the most used of the last 20 member messages).
- **Detection:** the script decides alone for Chinese, Tamil, Thai, Arabic, Japanese and Korean; Latin text uses common
  words (Indonesian reads as Malay) and the model's `detected` code from translation calls (cached per message).
- **Incoming (70 % rule):** a message is translated only when less than 70 % of its letters are already in My language
  (`shareInLanguage`). Text, captions and voice-note transcripts; our own replies typed with Live translate are never
  translated (the typed text is shown).
- **Protected items** (same list as Cloud): numbers, prices and amounts, dates and times in digits, links, emails,
  phone numbers, @mentions, order/tracking codes (letters with digits), emoji. `protectedItems` / `changedItem` in
  `packages/shared`: every item of the source must appear unchanged in the translation (spaces ignored, not inside a
  longer number). An incoming translation that fails is cached `unsafe` and never shown; a draft that fails is
  `refused` with "X became Y"; a send whose text fails answers 400 `translation_changed`.
- **Send:** `POST /chats/:jid/messages` with `translation {draftId, typedText, typedLanguage, edited}` (the draft must
  be the caller's, for this chat, at most 30 minutes old, else 400 `translation_expired`) or `sentOriginal: true`. The
  typed record (`message_typed`) is stored in the message's insert transaction and follows the id rename. The
  customer sees no "translated" mark.
- **Cost:** one call on the "Model for suggestions" per batch (≤ 50 messages on screen), no tools, no retries, no
  back-translation. Cached per message, revision (`edited_at`) and target, so a reload or a teammate with the same
  language costs nothing. Each translated message and each draft counts one against the person's daily limit
  (default 200, 0 = none; `live_translate_usage`, business time zone). Limits: translations 120 a minute, drafts 60 a
  minute per user.
- **Failures are visible**, nothing is sent or retried by itself: `limit`, `ai_unavailable` (503), `failed` /
  `translate_failed` (503). Send original instead always works.
- **Privacy:** text goes only to the install's own AI connection. Logs `live_translate` hold kind, counts, language
  codes, ms, model and a result code, never text or ids; audit `settings.live_translate` {before, after} and
  `user.translate_language` {language}. Rows go with their message or chat (`DELETE_PLAN`, delete-for-everyone drops
  the cache) and follow alias merges, hide/archive re-keys and the Lite import.

## Decision log

- 2026-11-19: Owner request (Lite, Enterprise, Cloud). Decisions 1–10: preview on by default with a per-person "Send
  without preview"; no back-translation; customer language per chat and shared; search through translations later;
  all staff may use it, admins can switch it off; default daily limit 200 per person; groups have one outgoing
  language; the customer sees no "(translated)" mark; incoming text translated below 70 % in My language; Cloud's
  labels and protected items.
- 2026-11-19: Owner confirmed the mock ("ok mock"). The admin switch is on by default for new and updated installs; the
  off-state hint "Customer writes in 中文 · Translate" is shown.
- 2026-11-19: Server: `Message.typed`/`sentOriginal` are optional fields (not zod defaults) so older fixtures and
  servers keep parsing; extra codes `translation_expired` and `translate_failed`; an alias merge keeps the surviving
  chat's languages and fills a chosen language only the other chat had.
