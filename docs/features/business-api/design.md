# WhatsApp Business API inboxes (Enterprise)

Owner request 2026-10-25: "allow EzyChat … use business WhatsApp API as inbox setup, in addition to existing
Baileys". The owner answered the scope questions the same day (below). Status: **proposed, waiting for the
owner's confirmation of the mock**. No production code before that.

## Decisions (owner, 2026-10-25)

| Topic        | Decision                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edition      | **Enterprise only.** Lite stays linked-phone (Baileys) only. Lite gets generic, edition-neutral extension points (below); the Cloud API adapter, its screens and templates live in `anchorsprint/ezychat-enterprise`.                                                                                                                     |
| Webhook      | **The existing Cloudflare tunnel (Phone access).** Meta posts to `https://<tunnel host>/api/ext/wa-cloud/webhook`. EzyChat registers that address with Meta itself (`POST /{waba-id}/subscribed_apps` with `override_callback_uri` + verify token) and again whenever a Quick Tunnel address changes. No relay of ours: data stays local. |
| Onboarding   | **Paste credentials**: Phone number ID, WhatsApp Business Account ID, a permanent system-user access token, App secret, from the customer's own Meta app. Checked live with the Graph API. Embedded Signup / Coexistence is a later phase (needs Meta Tech Provider status).                                                              |
| 24-hour rule | **Send approved templates in v1.** After the customer-service window closes, the composer is replaced by "Send a template" (approved templates synced from the WABA, variables, preview). Templates are created in Meta's WhatsApp Manager, not in EzyChat.                                                                               |
| Licence      | **Same inbox pool**: a Business API inbox uses one slot of the licence's `maxInboxes`. No new licence field, no portal change.                                                                                                                                                                                                            |
| Inbox 1      | **Linked phone by default; the admin may choose Business API** in the setup wizard's WhatsApp step (Enterprise). Added inboxes choose their type in Admin → Inboxes → Add inbox.                                                                                                                                                          |
| AI agent     | **Replies inside the window, else hands off.** The AI never sends a template; when the window has closed it hands the chat to the team (new hand-off reason `window_closed`).                                                                                                                                                             |
| Process      | Design + HTML mock first (this folder), owner confirmation, then Lite hooks PR, then the Enterprise PR.                                                                                                                                                                                                                                   |

## Facts about the Cloud API this design relies on

- Inbound messages, statuses (sent/delivered/read/failed) and template status changes arrive only by webhook
  (HTTPS, valid certificate). Each POST is signed: `X-Hub-Signature-256` = HMAC-SHA256 of the raw body with
  the App secret. Verification is a `GET` with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.
- Meta retries failed webhook deliveries with back-off for up to 7 days, so a PC that is off or a tunnel that
  is down loses nothing short of that.
- Free-form messages only within 24 hours of the customer's last message; otherwise only an approved template.
  Meta bills conversations to the customer's own Meta account.
- No history import, no groups, no linked-device QR, no LIDs. Media is downloaded by media id with the token
  (`GET /{media-id}` → short-lived URL). Reactions, replies (context), read receipts and the typing indicator
  are supported.
- A number on the Cloud API cannot be used in the WhatsApp app at the same time (except Coexistence, which
  needs Embedded Signup).

## Architecture

**Lite (open core, generic hooks only; no Cloud API code):**

1. `ServerExtension.inboxTypes`: an extension registers an inbox type `{ id, label, createAdapter(ctx, row,
secrets) → WaAdapter, capabilities }`. `InboxConnections.build` picks the adapter by the new
   `inboxes.type` column (`linked_phone` default; migration adds the column, existing rows stay linked
   phones). Inbox 1 keeps `wa-auth/` and its keys whatever its type.
2. `WaAdapter` capabilities: `{ qrLink, history, groups, replyWindowHours: number | null, templates }`. The
   core hides QR/pairing, group and history UI by capability, never by type name.
3. Reply window in core: `chats.last_inbound_at` (from ingest); the message service refuses free-form sends
   with 409 `window_closed` when the inbox's adapter reports a window; `present()`/chat list carry
   `replyWindowEndsAt`. AI: `service.ts` hands off with `window_closed` instead of answering. MCP
   `send_message` returns the same refusal; `send_to_new_number` is refused on such inboxes (template only).
4. Public signed extension routes: `routes` entries may set `public: { verify(request) }`. Such a route skips
   session and Origin checks (Meta sends no Origin) but must pass the extension's signature check before the
   body is parsed, keeps the Host allowlist and stays closed while the access gate is closed (Meta retries).
5. `tunnel:url` bus event (exists as `tunnel:status`) is part of the extension context so an extension can
   re-register the webhook when the address changes.
6. Web: an extension may contribute an inbox type to Admin → Inboxes (type card, form, card rows, edit
   section) and to the setup wizard's WhatsApp step; the composer gets a `windowClosed` slot (template
   picker) and messages carry `template: { name } | null`.

**Enterprise (`ent-server` + `ent-web`, extension `wa-cloud`):**

- `CloudApiAdapter implements WaAdapter` over Graph API (pinned version), through a guarded fetch (https,
  `graph.facebook.com` only, timeouts). Token and App secret in encrypted settings per inbox; logs carry
  ids and status codes only, never tokens, numbers or message text.
- Webhook route `/api/ext/wa-cloud/webhook` (GET verify, POST signed), routed to the inbox by
  `phone_number_id`; idempotent by message id; statuses map to the existing acks.
- Templates: `GET /{waba-id}/message_templates?status=APPROVED`, cached, synced on demand and on the
  `message_template_status_update` webhook; send `type: template` with body parameters.
- Health: token check on start and hourly (`token_invalid` state releases AI claims like an expired AI
  connection), quality rating and messaging limit from `GET /{phone-number-id}`.

## Source baseline

- Feature **upgrade-enterprise**, path `docs/features/upgrade-enterprise/mock/`, `latestConfirmed` revision
  `2fce4a7` (cloned from main `48008cf`; the folder differs only in its notes).
- `mock/reference.json` records the deltas; `node docs/features/business-api/mock/snapshot.mjs --check`
  verifies 139 frozen app files, 37 inherited baseline files (38 before: this proposal changes 10 inherited
  files and freezes the upgrade-enterprise files it does not touch) and 22 added files.

Reused: `InboxesPage` (card, dialog, members, AI agent select), `SetupWizard`/`WaLinkStep` (unchanged phone
step), `Conversation`/`Composer` (composer unchanged inside the window), `MessageBubble` (footer marker like
"via AI assistant"), `TunnelPage` (Phone access), `Banner`, `StatusDot`, `ResponsiveDialog`,
`SegmentedControl`, `EmptyState`, the mock edition switch.

## Mock

- Run: `npx tsx --conditions=ezychat-source docs/features/business-api/mock/run.ts --fake-wa`, open
  `http://localhost:7487/` (API `7486`), sign in as `aisyah` / `demo-pass-123`. `--fresh` for the setup wizard.
  Walkthrough: `mock/README.md`.
- Screenshots: `node docs/features/business-api/mock/business-api-shots.mjs` (seeded) and `… <url> --setup`
  (fresh mock on another port); 52 files in `mock/screenshots/`.

## Screen and state checklist

| Area            | Screen / state                                                                                       | Mock |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---- |
| Admin → Inboxes | Business API card: type line, status, quality, templates count + Sync, AI note, who can open         | yes  |
| Admin → Inboxes | Webhook: Phone access off (warning + Open Phone access), on (address, Quick/named note), failing     | yes  |
| Admin → Inboxes | Token rejected (danger banner, status)                                                               | yes  |
| Add inbox       | Type choice (linked phone default / Business API), Meta form, guide, required, rejected, connected   | yes  |
| Edit inbox      | Meta connection summary, webhook, token saved (last 4), Replace token, mock-only failure toggles     | yes  |
| Remove inbox    | Business API wording (webhook removed, number stays at Meta)                                         | yes  |
| Setup wizard    | Enterprise: How do you connect WhatsApp? QR (default) / Business API, form, connected, Phone access  | yes  |
| Setup wizard    | Lite: unchanged QR step (no choice)                                                                  | yes  |
| Phone access    | Note that Business API inboxes receive messages through it                                           | yes  |
| Chat list       | Closed-window icon on Business API chats                                                             | yes  |
| Conversation    | Window open: "Reply window: 5 h 12 min left" (warning in the last hour)                              | yes  |
| Conversation    | Window closed: banner + Send a template; template sent marker; customer reply reopens the window     | yes  |
| Template dialog | List (name, language, category), variables (first name prefilled), required, preview, marketing note | yes  |
| Template dialog | No approved templates (WhatsApp Manager link, Sync)                                                  | yes  |
| Lite view       | No Business API inbox, type, window or template anywhere                                             | yes  |
| Desktop / phone | 1280 px and 360 px; light and dark for Inboxes, Edit, conversation, template dialog                  | yes  |

## Changed and added files (mock)

- Changed: `src/admin/InboxesPage.tsx`, `src/admin/TunnelPage.tsx`, `src/setup/SetupWizard.tsx`,
  `src/inbox/{Conversation,MessageBubble,ChatListItem}.tsx`, `src/mock/inboxes.ts` (type, `api`, window,
  templates; storage key `mock.businessApi.inboxes.v1`), `src/i18n/locales/{en,ms,zh-CN}/{admin,inbox}.json`
  (`mockApi.*`, `mockWindow.*`, `mockInbox.state.token_invalid`; English in the mock).
- Added: `src/admin/BusinessApiForm.tsx`, `src/setup/WhatsAppStepChoice.tsx`, `src/inbox/ReplyWindow.tsx`,
  `business-api-shots.mjs`.
- Runner: ports 7487/7486, temp-folder prefix, banner text.

## Open questions for the owner

1. Template **categories**: v1 sends Utility and Marketing (marketing note shown). Hide Marketing, or allow?
2. Switching an existing **linked-phone inbox 1 to the Business API** later (keeping its chats): v1 only at
   setup or for added inboxes; a later "Change connection" flow could follow.
3. **Media templates** (header image/document) and buttons: v1 sends body-variable templates only; others are
   listed but disabled with "not supported yet". OK?

## Later (not in v1)

Embedded Signup + Coexistence (Meta Tech Provider), template creation inside EzyChat, AI-sent templates,
interactive messages (buttons/lists), broadcast — never bulk messaging.

## Retention

This sixth feature folder removes the oldest by `creationOrder`, `docs/features/custom-agents` (creation
order 7; clean and committed; last revision with the folder `48008cf`, recorded in `mock-index.json`).

## Confirmation

Pending. The owner reviews the screenshots/running mock; record the answer here and in `mock-index.json`.
