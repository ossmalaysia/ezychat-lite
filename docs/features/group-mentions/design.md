# Tag (@mention) group members when replying

Status: **proposal — waiting for the owner's confirmation** of the mock before the production composer is built.
Branch `claude/ecstatic-mendel-lr798e` from `main` (`8bfeef9`).

## Owner request (2026-10-31)

- "now ezychat lite and enterprise cannot tag people in group, improve it to allow tag or mention people in group, if
  business whatsapp api allow also support it for enterprise".

## What exists today

- **Incoming** tags already work: Baileys maps `contextInfo.mentionedJid` to `mentionedJids`, the server stores them
  (`messages.mentioned_jids`) and `messages/mentions.ts` shows `@Name` instead of `@60123…` in bubbles, previews and
  push. The AI in groups answers a tag of the business number (`ai/groups.ts`).
- **Outgoing** tags do not: the composer has no member picker, `POST /chats/:jid/messages` takes no mentions and
  `WaAdapter.sendText` sends `{ text }` only. Typing `@60123…` by hand goes out as plain text (WhatsApp shows no tag
  and does not notify the member).

## Baseline

- Cloned from the owner-confirmed **ai-handoff-rules** mock (`latestConfirmed`, revision
  `16a126ec521e9e9e79dbe4a4477c449114bb51fb`, the whole app; unchanged on `main` `8bfeef9`). Its screenshots are not
  copied (git history keeps them).
- Reused, not changed: the composer's quick-reply picker pattern (`/` → `QuickReplyPicker`, cmdk list, focus stays in
  the box, ↑/↓/Enter/Tab/Escape), Group info's member list (`GET /chats/:jid/members`, 5-minute server cache), the
  mention presenter (names in the sent bubble).
- Retention: new feature folder (6th, creation 24); the oldest, `grammar-fix` (19, last revision on `main` `8bfeef9`),
  is pruned in the same change. Its confirmed mock stays in git history.

## Behaviour

| Rule            | Proposal                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where           | Group chats only, in the composer. Typing `@` at the start of the text or after a space opens **Tag a member**; letters after it filter by any word of the name, the username or the number. Direct chats: no picker.          |
| List            | The group's members from Group info (no new WhatsApp call: same cached list), the linked number left out, named members first A–Z, then numbers. Admins carry an **Admin** chip. Loading / failed (type `@` again) / no match. |
| Pick            | Click, tap, Enter or Tab puts `@Name ` in the box; Escape closes the list and keeps the typed text. Up to 50 tags a message.                                                                                                   |
| Send            | Each `@Name` still in the text becomes WhatsApp's own form `@<number>` and the member's address goes in `mentions`. A tag whose name the teammate edited is plain text again. The pending bubble shows `@Name` meanwhile.      |
| WhatsApp        | Baileys sends `{ text, mentions }`: the member sees a real tag and is notified, as from the phone. The stored body keeps `@<number>`; every screen shows `@Name` (existing presenter).                                         |
| Server checks   | `mentions` only in a group (400), only through a connection that can tag (400), each a person's address written as a whole `@<number>` tag in the text (400), duplicates dropped, at most 50.                                  |
| Queue / restart | The tags are stored with the pending message (`mentioned_jids`), so a send that waits for WhatsApp or survives a restart still tags.                                                                                           |
| Not in scope    | Media captions, "@everyone", tagging from the AI's group answers, MCP `send_message`. Each can follow on the same route field.                                                                                                 |

## WhatsApp Business API (Enterprise)

- Meta's Cloud API documents group **sending** (`recipient_type: "group"`) but **no mentions field** on outgoing or
  incoming group messages (Groups API reference, groups messaging, webhooks; checked 2026-10-31; see also the
  Enterprise `wa-cloud-groups` design, row "Not documented"). Only `text.body` is sent, so `@60123…` would arrive as
  plain text without a tag or notification.
- So a new capability decides it, never the type name: `WaCapabilities.mentions` (linked phone `true`; absent =
  `false`). The `wa-cloud` adapter declares none, so its groups show no picker and the server refuses `mentions` for
  them. Enterprise needs no code change now; when Meta documents a mentions field, the adapter sets
  `mentions: true` and maps `WaSendOptions.mentions`, and the picker appears there with no core change.

## Screens (mock checklist)

1. Kopi Lovers Club → type `Morning @`: the picker with every member (Admin chip on Nurul Huda).
2. `@fa`: filtered to Farah Aziz.
3. Enter, then `and @` + click Tan Wei Jie: the box reads `Morning @Farah Aziz and @Tan Wei Jie …`.
4. Send: the bubble shows the names; the fake WhatsApp receives `@60123110021 … @60127020388` and both addresses.
5. `@zzz`: "No member matches".
6. The Reseller group (long name, 14 generated members without names): numbers listed after the named members.
7. A direct chat: no picker. A Business API group: no picker (decided by `capabilities.mentions`; the mock's
   Business API inbox has no group, so this state is covered by the server test, not a screenshot).
8. Desktop 1280 / mobile 360 (touch), light and dark; en, ms, zh-CN texts (`mockMention.*`).

Run: `npx tsx --conditions=ezychat-source docs/features/group-mentions/mock/run.ts --fake-wa`, sign in as `aisyah`
(`demo-pass-123`), open **Kopi Lovers Club**. Screenshots: `node docs/features/group-mentions/mock/mention-shots.mjs`
(`mock/screenshots/`). The mock's composer sends through the real server route, so step 4 exercises the server
change end to end on fake WhatsApp.

Changed or added mock files (the rest is the baseline unchanged): `src/inbox/Composer.tsx`,
`src/inbox/Conversation.tsx`, `src/api/queries.ts`, `src/inbox/MentionPicker.tsx` (new), `src/inbox/mentions.ts` (new),
`src/i18n/locales/{en,ms,zh-CN}/inbox.json` (`mockMention.*`), `run.ts` (temp folder name), `mention-shots.mjs` (new).

## Built in this branch already (no UI)

- `@ezychat/shared`: `SendTextBody.mentions` (≤ 50), `MAX_MESSAGE_MENTIONS`, `InboxCapabilities.mentions` (zod default
  `false`, so an older server never gets mentions).
- `@ezychat/wa`: `WaSendOptions.mentions`, `WaCapabilities.mentions?` (linked phone `true`); Baileys `sendText` passes
  `mentions`; the fake records them.
- Server: `messages/mentions.ts#outgoingMentions`, the checks in `sendText`, `mentioned_jids` on the outgoing row,
  the queue job's `mentions`, `GET /inboxes` reports `capabilities.mentions`. Tests: `test/send-mentions.test.ts`,
  Baileys `adapter.test.ts`.

## Build plan (after confirmation)

1. Web: `inbox/mentions.ts` + `MentionPicker.tsx` from the mock, the composer wiring (shown only when
   `inboxCapabilities(inbox).mentions` and the chat is a group), `useSendText` `mentions`/`shown`, catalog keys in
   en/ms/zh-CN, unit tests (helpers, picker keyboard, send payload), the web contract test.
2. e2e: tag two members in a fake group, check the bubble names and the fake send.
3. Live check on a test number (`untested against real WhatsApp` until then): the member is notified and sees the tag.
4. Enterprise: core bump only; its typecheck, lint and tests on `pack:core` (the optional capability needs no change).

## Confirmation

_Not yet confirmed._
