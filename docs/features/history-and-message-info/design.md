# History import at link, and Message info

Status: **proposal, waiting for the owner's look at the mock** (design only; no production code).
Created 2026-11-26 (creationOrder 52). Requested by the owner on 2026-11-26 for all editions: Lite builds it in the core,
Enterprise gets it through the published `@ezychat/*` packages, Cloud has its own build (anchorsprint/ezychat-cloud
PR #156 for History import, `apps/customer/inbox/conversation.tsx` for Message info).

Two small features share one folder to keep within the five-folder mock retention:

- **A. History import at link.** When an admin links a WhatsApp number, the screen asks how much chat history to bring
  in, before it shows the QR code or the pairing code.
- **B. Message info.** For a message the team sent, a dialog shows when it was Sent, Delivered and Read; in a group,
  who read it and who has it, each with a time.

## Mock

- Interactive app mock: [`mock/index.html`](mock/index.html) (run instructions in [`mock/README.md`](mock/README.md)).
- Cloned from the latest owner-confirmed mock **ai-models-per-task** (`docs/features/ai-models-per-task/mock`, git
  revision `c4584db69e366a7770b40ffdf717b75d1cae66dd`, confirmed 2026-11-22), copied from `main` `0927b552` (the same
  files). Every inherited flow still works. `node mock/snapshot.mjs --check` verifies that only the files listed in
  `reference.json` → `historyAndMessageInfo` changed.
- Screenshots: [`screenshots/`](screenshots/) (47 PNGs, 1280 px and 360 px, light and dark for Message info), made by
  `mock/history-info-shots.mjs`; `screenshots/results.json` lists them (no page errors, no horizontal scroll).

Changed files (13): `src/setup/WaLinkStep.tsx`, `src/admin/SettingsPage.tsx`, `src/admin/WhatsAppPage.tsx`,
`src/admin/InboxesPage.tsx`, `src/inbox/MessageBubble.tsx`, `src/inbox/MessageMoreMenu.tsx`,
`src/inbox/ReactionPicker.tsx`, `src/i18n/locales/{en,ms,zh-CN}/{common,inbox}.json`. Added: `src/wa/HistoryImportChoice.tsx`,
`src/inbox/MessageInfoDialog.tsx`, `message-info.ts` (stand-in routes), `history-info-shots.mjs`. Also `proposal.ts`
(registers the routes), `run.ts` (temp-folder name), `README.md`.

## Reused from the app

| Need | Reused |
| --- | --- |
| The value | The existing `history_days` setting (`admin/settings-service.ts`, `DEFAULT_HISTORY_DAYS` = 3, zod 0–365 in `SettingsPatchBody`), `PATCH /api/settings` (admins), read by the adapter at link time (`main.ts` getter, `baileys/adapter.ts` `historyDays`) |
| Link screens | `setup/WaLinkStep.tsx` (wizard step 2), `admin/WhatsAppPage.tsx` (Re-link confirm, `ConfirmDialog`), `admin/InboxesPage.tsx` (Add inbox dialog, `ResponsiveDialog`) |
| Choice rows | `RadioGroup` cards as in `admin/MemberChatsField.tsx` (bordered row, primary border when chosen, 44 px) |
| Message menu | The ⋮ `MessageMoreMenu` (Forward) and the press-and-hold bar in `ReactionPicker` (Reply, Forward) |
| Dialog | `ResponsiveDialog` (dialog on desktop, bottom sheet below 640 px), `Banner` for failed and still-sending |
| Times | `formatDateTime` ("26 Nov 2026, 21:57"), the same as a bubble's time tooltip |
| Status today | `messages.status` (`pending`/`sent`/`delivered`/`read`/`failed`) via `MessageService.applyStatus`; the adapter's `messages.update` (direct) and `message-receipt.update` (group) handlers |

## A. History import at link

### Flow

1. **Setup wizard → WhatsApp** (Lite and Enterprise, linked phone): the step first shows **History import** with the
   steps text above it. The QR code and the Phone number tab appear only after **Show QR code**. Above the QR:
   "History import: 7 days · Change" (Change goes back to the choice).
2. **Admin → WhatsApp → Re-link** (Lite; also the "Link" button when logged out): the confirm dialog holds the same
   choice under its text. **Re-link** saves the choice, then starts the new link. The Scan to link card shows
   "History import: … · Change"; Change opens the Re-link dialog again.
3. **Admin → Inboxes → Add inbox** (Enterprise, linked phone only; the Business API has no history): the choice sits
   under Inbox name. **Save** checks it, then shows the QR with the summary line.
4. **Settings → App settings → General**: the "History" card becomes **History import** with the same control and the
   hint "Used the next time you link a WhatsApp number." It saves with the page's Save bar, as today.

### Choices and rules

- **No history · 3 days (default) · 7 days · 14 days · 30 days · Custom.** The first five match Cloud
  (`HISTORY_DAY_CHOICES`, labels "No history", "{{count}} days", heading "History import").
- **Custom** opens "Number of days" (whole number 0–365, `inputMode="numeric"`). Owner 2026-11-26: Lite and
  Enterprise have no 30-day cap, "up to 365 cos that is their storage". Empty, letters or above 365: "Enter a number
  from 0 to 365." under the box, shown when the person presses the button (Show QR code / Re-link / Save), and live in
  Settings. A value equal to a preset typed into Custom is fine (it is stored as the number).
- Hint under the rows (all screens, owner text): "More days take longer to load the first time. Photos and files load
  when you open them." Above 30 days it adds: "Your phone sends what it still has, so very old chats may not all
  arrive." (WhatsApp decides how much the phone sends; EzyChat only keeps up to the chosen days.)
- Preselected value: the saved `history_days` (3 on a new install). "(default)" marks 3.
- One value per install (Lite has one number). The link screens save it as the setting before the link starts, so the
  next link starts from it. An Enterprise inbox added later uses the value chosen in its dialog (see open question 1).

### Server plan

- No new table and no migration: the value is the existing `history_days` setting, written through
  `PATCH /api/settings {historyDays}` (admins, audited as today: `audit.fields.historyDays`).
- The Baileys socket sets `syncFullHistory` and `shouldSyncHistoryMessage` from `historyDays` when it is created. A
  choice made after the first QR was already generated (the wizard starts the socket at once) must reach the socket:
  when the value moves between 0 and more than 0, the link restarts the QR (`relink`) after saving. Between two
  non-zero values the cut-off is read per message in `onHistory`, so no restart is needed. **Untested against real
  WhatsApp**; the implementation PR proves it on a Dev Build with a real phone.
- Enterprise inbox dialog: `POST /api/inboxes` (create) gains an optional `historyDays` (zod 0–365, default = the
  setting) that is saved before that inbox's adapter connects (`InboxService.create(…, { beforeConnect })`).
- Nothing is logged but the number of days; no new socket event.

### Screens and states (all in the mock)

| Screen | States | Shots |
| --- | --- | --- |
| Setup wizard WhatsApp step | choice (default), Custom empty (error), Custom 120, QR with summary | `history-09…12` |
| Admin → WhatsApp | Re-link dialog default, Custom invalid, QR with summary (60 days; phone: No history) | `history-06…08` |
| Admin → Inboxes → Add inbox | choice (7 days), QR with summary | `history-04`, `history-05` |
| Settings → General | card, Custom invalid (400), Custom 90 (long-history note) | `history-01…03` |

All at 1280 px and 360 px. Dark mode is unchanged tokens (same `RadioGroup` cards as Members); the Message info shots
cover dark.

## B. Message info

### Flow

- **Entry points** (messages the team sent, `fromMe`): ⋮ → **Message info** (desktop, under Forward), the
  press-and-hold bar → **Message info** (phones), and the message's ticks (one tap; the only way on a phone for a
  message still sending or failed, which has no press-and-hold bar). Never for customers' messages.
- The dialog (sheet on phones): the message (first 160 characters, or the file name) in a quote block, then:
  - **Direct chat:** rows **Sent**, **Delivered**, **Read**, each with its time, "Not yet", or **"Yes, time not known"**.
    Note: "Times come from WhatsApp. If the customer turned off read receipts, Read stays empty."
  - **Group:** **Sent** row, then **Read by N**, **Delivered to N**, **Not delivered yet · N**, one row per member
    (name wraps, time on the right). Nobody yet: "No one has received it yet." Note: "Times come from WhatsApp.
    Members who turned off read receipts show under Delivered."
  - **Still sending:** info banner "Waiting to send · It goes out when WhatsApp is connected. Times show here after
    that."
  - **Failed:** danger banner "Not sent · WhatsApp did not take this message. Press Retry under it in the chat."
- **Close** at the end. Opens for any user who can open the chat (same 404 rule as every message route).

### Rule: never fake a time

A time is shown only when WhatsApp sent one. A status we know without its time (history import, a receipt from before
this feature, the status raised by a later receipt) shows "Yes, time not known". A higher status implies the lower
ones (read ⇒ delivered ⇒ sent), so a read message never says "Delivered: Not yet"; the implied ones show "Yes, time not
known" unless their own time is stored.

### Server and data plan (implementation PR)

- **Contract** (`packages/shared`, zod first): `MessageInfo { messageId, status, sent: Stamp, delivered: Stamp,
  read: Stamp, members: MemberReceipt[] | null }`, `Stamp { done: boolean, at: number | null }`,
  `MemberReceipt { jid, name, delivered: Stamp, read: Stamp }`. Route `GET /api/messages/:id/info`
  (`requireMessageAccess`: 404 outside the caller's inboxes or chosen chats; 404 for a message not `fromMe`).
  Members are named like Group info does (contacts and existing chats only, never inferred; a member without a name
  shows the formatted number, a LID-only member "Unknown"). 60 a minute per user.
- **Migration 048** (`048_message_receipts.sql`):
  - `ALTER TABLE messages ADD COLUMN sent_at INTEGER` / `delivered_at INTEGER` / `read_at INTEGER` (NULL = time not
    known; no backfill: older rows keep NULL and their status).
  - `CREATE TABLE message_member_receipts (message_id TEXT NOT NULL, member_jid TEXT NOT NULL, delivered_at INTEGER,
    read_at INTEGER, delivered INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (message_id,
    member_jid))`, `member_jid` alias-resolved like reactions (`AliasStore`), one row per member and message.
- **Where the times come from** (Baileys, `packages/wa/src/baileys/**`, untested against real WhatsApp until the
  Dev Build check): direct-chat receipts arrive as `messages.update` with `update.messageTimestamp = receipt t`
  (`messages-recv.js handleReceipt`); group receipts as `message-receipt.update` with
  `receipt.receiptTimestamp` / `readTimestamp` per `userJid`. The adapter's `WaMessageStatusUpdate` gains an optional
  `at` (seconds → ms) and a `member` jid; `applyStatus` writes `delivered_at` / `read_at` only when it moves the
  status and only the first time (never overwrite a time; `COALESCE`). `sent_at` = the server ack of our send. History
  messages carry no receipt time; `userReceipt` entries in history give member rows with their times when present.
  The fake adapter (`--fake-wa`) gets `simulateReceipt({ id, member?, status, at })` and
  `POST /api/dev/fake-receipt` so a Dev Build can show every state.
- **Follows the message:** the queued-send id rename (`local-<clientId>` → WhatsApp id) moves
  `message_member_receipts` rows in the same transaction (like `message_typed`); early receipts kept by
  `rememberEarlyStatus` carry their time.
- **Lists to extend** (each has a test that fails otherwise): `DELETE_PLAN` (`chats/delete.ts`, message-keyed table;
  `test/chat-delete-coverage.test.ts`), `CHAT_TABLES` (`chats/hide.ts` archive re-key: rows follow their messages, no
  `chat_jid` column, so the re-key needs nothing but the test list names it), the alias merge (`chats/merge.ts`: message
  ids do not change; member JIDs are re-pointed when a PN/LID pair is learned, keeping the earliest time), the Lite
  import `TABLE_PLAN` (`lite-import/merge-tables.ts`: copy with the messages), and
  `test/upgrade-from-oldest.test.ts` (seed a delivered message; after the upgrade its times are NULL and the dialog says
  "time not known").
- **Privacy:** no message text, names or numbers in logs; the route logs nothing per call. Receipts never notify and
  never reach the AI prompt. Socket: `message:status` gains the times so an open dialog updates (no new event).
- **Editions:** Business API inboxes report delivered/read through their webhook; Enterprise's adapter fills the same
  `at`. An adapter that gives no time leaves NULL ("time not known").

### Screens and states (all in the mock)

| State | Shots (desktop + mobile; dark where noted) |
| --- | --- |
| ⋮ menu with Message info | `info-00-menu-desktop-light` |
| Direct: all times | `info-01-direct-all-times-*` (light + dark) |
| Direct: read, time not known | `info-02-direct-read-no-time-*` (light + dark) |
| Direct: sent only | `info-03-direct-sent-only-*` |
| Still sending | `info-04-direct-pending-*` |
| Failed | `info-05-direct-failed-*` |
| Group: several members (read, read without time, delivered, not yet) | `info-06-group-several-*` (light + dark) |
| Group: long names | `info-07-group-long-names-*` (light + dark) |
| Group: none yet | `info-08-group-none-yet-*` |

The dashed **Mock only** row in the dialog picks what WhatsApp reported; the stand-in route is
`/api/mock/message-info/:id` (`message-info.ts`, fixed offsets from the message time, nothing stored).

## Cloud alignment

| | Lite / Enterprise (this mock) | Cloud (today) |
| --- | --- | --- |
| History choices | No history, 3, 7, 14, 30, **Custom 0–365** | No history, 3, 7, 14, 30 (cap 30) |
| History heading / hint | "History import" + the owner's hint | same |
| Message info rows | Sent / Delivered / Read; group Read by · Delivered to · Not delivered yet | Sent / Delivered / Read; one row per member |
| Known without a time | "Yes, time not known" | "Not available" (to change: owner rule "never fake a time" and this wording) |
| Not happened yet | "Not yet" | "Not available" |

## Open questions for the owner

1. **One history value or per number?** The mock keeps one install-wide value (the Settings one), which the link
   screens save. In Enterprise with several numbers, should each number remember its own choice (shown on its inbox
   row), with Settings only the default for new numbers?
2. **Wording "Yes, time not known"** (your words) on the Sent / Delivered / Read rows. OK as is, or "Yes · time not
   known"? Cloud should use the same words; today it says "Not available" for both "not yet" and "no time".
3. **Ticks open Message info** (one tap on the ✓✓). Fine, or only the ⋮ / press-and-hold menu like WhatsApp?
4. **Re-link with history in the dialog** (Admin → WhatsApp): keep the choice inside the confirm dialog, or move it to
   the Scan to link card?
5. **Played** (voice notes): WhatsApp also reports "played". Add a fourth row for voice notes now, or later?

## Confirmation record

- 2026-11-26: mock and screenshots built; waiting for the owner.
