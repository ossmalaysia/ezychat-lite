# WhatsApp Business API inboxes: implementation spec

Design and owner decisions: [design.md](design.md). Confirmed mock: [mock/](mock/README.md) (the screen
reference). This file fixes the contracts so the Lite server, the Lite web app and the Enterprise extension
can be built in parallel. Lite holds only generic, edition-neutral code; every Meta/Graph API detail lives in
Enterprise (`anchorsprint/ezychat-enterprise`, extension `wa-cloud`).

## Contracts (already in the tree; change only with the orchestrator)

- `@ezychat/wa` `types.ts`: `WaCapabilities` (`qrLink`, `history`, `groups`, `replyWindowHours`,
  `templates`, `needsPublicUrl`), `LINKED_PHONE_CAPABILITIES`, `WaTemplate`, `WaTemplateSend`, optional
  `WaAdapter.capabilities`, `listTemplates()`, `sendTemplate()`.
- `@ezychat/shared` `inboxes.ts`: `InboxType`, `LINKED_PHONE`, `InboxCapabilitiesSchema`,
  `DEFAULT_INBOX_CAPABILITIES`, `Inbox.type` + `Inbox.capabilities` (zod defaults), `MessageTemplateSchema`,
  `TemplateListResponse`, `SendTemplateBody`. `models.ts`: `Chat.lastInboundAt` (default null),
  `Message.template` (optional). `ai.ts`: hand-off reason `window_closed`.
- `@ezychat/server` `extensions.ts`: `InboxTypeDefinition` (`id`, `createAdapter(ctx,row)`, `detach?`),
  `PublicRoutes` (`verify`, `routes`), `ServerExtension.inboxTypes`, `ServerExtension.publicRoutes`;
  `index.ts` exports `InboxRow`, `getInboxService`, `InboxService`, `InboxActor`.
- `@ezychat/web` `extensions/types.ts`: `WebExtensionInboxType` (`type`, `labelKey`, `descriptionKey`,
  `icon`, `CreateForm`, `CardDetails`, `EditSection`, `SwitchFromPhone`, `SetupForm`),
  `WebExtension.inboxTypes`; exported from `index.ts`.

## Lite server (`packages/server`, `packages/wa/src/fake`)

1. Migration `019_inbox_types.sql`: `inboxes.type TEXT NOT NULL DEFAULT 'linked_phone'`;
   `chats.last_inbound_at INTEGER` backfilled from the newest inbound (`from_me = 0`) message per chat;
   `messages.template_name TEXT`, `messages.template_language TEXT`. Extend `upgrade-from-oldest.test.ts`.
2. `InboxRow.type`; `InboxRepo.insert(name, tone, now, type = 'linked_phone')`, `setType(id, type)`.
3. Adapter factory dispatches on `row.type`: `linked_phone` → today's factory; else the first extension's
   `InboxTypeDefinition` with that id (`createAdapter(ctx, row)`); an unknown type (extension missing, e.g.
   an Enterprise data dir opened by Lite) → a disconnected placeholder adapter whose status is `logged_out`
   with `lastError: 'inbox type <t> is not available in this edition'`, never a crash.
   Inbox 1 too: `main.ts` builds inbox 1 through the same dispatch.
4. `InboxConnections.replace(inboxId)`: disconnects the old adapter (`logout()` when the old type is
   `linked_phone`: that wipes its auth folder, `wa-auth/` for inbox 1, as unlinking does today; otherwise
   `disconnect()` then the old type's `detach`), builds the new one from the row, emits `removed` then
   `added`, connects it when started. `remove()` calls the type's `detach` after the adapter is gone.
5. `InboxService`:
   - `create(body, actor, opts?: { type?: string })`: a non-default `type` must be registered (400
     `unknown_inbox_type`); same limit/audit as today (audit `type`).
   - `changeType(id, type, actor)`: registered type or `linked_phone`; not on a removed inbox; same type →
     no-op; sets the row, `connections.replace`, audit `inbox.type_change` `{ from, to }`, emits the inbox
     list change the web already listens to. Chat keys, chats, notes, tags, assignments stay.
   - `list()`: each inbox carries `type` and `capabilities` (the adapter's, else
     `DEFAULT_INBOX_CAPABILITIES`).
   - `/api/inboxes/:id/wa/*` (QR, pairing, relink): 409 `not_linked_phone` when the adapter's capabilities
     say `qrLink: false`.
6. Reply window (core, generic):
   - Ingest sets `chats.last_inbound_at` on every **live** inbound message (not history, not from me).
   - `rowToChat` → `lastInboundAt`.
   - A helper `replyWindowOpen(ctx, chatKey, now)`: true when the chat's adapter has no
     `replyWindowHours`, else `last_inbound_at + hours > now`.
   - Free-form sends (text, media, voice note, reaction) answer **409 `window_closed`** when closed. A queued
     free-form job whose window closes before it is sent fails with `window_closed` (not retried).
7. Templates (core, generic):
   - `GET /api/inboxes/:id/templates` (any user who may open the inbox; 404 otherwise): adapter
     `listTemplates()` mapped to `MessageTemplateSchema` (`variables` = highest `{{n}}`, `sendable` =
     `header` null or `text` and no buttons), cached 5 minutes per inbox, `?refresh=1` refetches;
     409 `templates_unsupported` without the capability; 503 `wa_unavailable` offline.
   - `POST /api/chats/:jid/template` (`SendTemplateBody`): chat access and the reply refusals of a text send
     (removed inbox read only, etc.); 409 `templates_unsupported`; 400 `template_not_found` /
     `template_not_sendable` / `template_params` (count must equal `variables`); allowed when the window is
     closed. Stores an outbound message whose body is the filled template text, with `template_name` /
     `template_language` (→ `Message.template`), sent through the send queue in order (a `template` job).
     Rate limit like text sends. Audit nothing extra (a message is the record).
8. AI: before an agent answers a chat whose window is closed, hand off with `window_closed` (no model call,
   no message). A reply that fails with `window_closed` also hands off with `window_closed`.
9. MCP: `send_message` returns the `window_closed` refusal text; `send_to_new_number` refuses inboxes whose
   adapter has a `replyWindowHours` (`template_required`: a new chat needs a template).
10. Public routes: for an extension with `publicRoutes`, mount `routes` at `/api/ext/<name>/public` with the
    raw body kept (`request.rawBody`), skip session and the Origin check **for that prefix only**, run
    `verify` in a preHandler (401 `{ error: 'unauthorized' }` when false; never log the body or headers).
    Host allowlist and the access gate apply unchanged. Tests prove: a mutating POST with no Origin works
    only under `/public`, a failed `verify` is 401, `/api/ext/<name>/x` still needs Origin + session.
11. Fake adapter (tests, `--fake-wa`): `FakeWaAdapter` options `capabilities?: WaCapabilities` and
    `templates?: WaTemplate[]`; with templates it implements `listTemplates`/`sendTemplate` (records sends).
12. Dev only (`--mode dev --fake-wa`): a built-in fake inbox type `fake-api` (a `FakeWaAdapter` with
    `replyWindowHours: 24`, `templates: true`, `needsPublicUrl: true`, `qrLink/history/groups: false` and
    three templates incl. one with an `image` header), and `POST /api/dev/fake-api-inbox` `{ name }` that
    creates such an inbox (respects the limit), plus `POST /api/dev/fake-window` `{ chatJid, hoursAgo }`
    that sets `last_inbound_at` (to open/close a window in e2e). Never registered outside dev + fake WA.
13. Tests (Vitest, real server via `makeTestApp`): migration, factory dispatch + unknown type, replace /
    changeType (keys and chats kept, logout vs detach), window refusals on all four sends, queued job
    expiry, template list/send/validation, AI `window_closed`, MCP refusals, public routes. Keep
    `web-client-contract.test.ts` green: the web uses literal paths `/inboxes/${id}/templates` style as it
    does elsewhere and `/chats/${enc(jid)}/template`.
14. AGENTS.md: a short paragraph under **Inboxes** on inbox types, capabilities, the reply window and public
    routes (the orchestrator merges it).

## Lite web (`apps/web`)

Follow `docs/design-system.md`, the confirmed mock and the UI rules (no raw buttons, token colours, `t()`
with **real** en/ms/zh-CN translations, 360 px, ErrorBoundary).

1. Admin → Inboxes: when `useWebExtensions()` has `inboxTypes`, Add inbox starts with the type choice
   (linked phone first and default, then each type's card) as in the mock; the chosen type's `CreateForm`
   replaces Save/QR. Cards: icon + type label from capabilities/type, `CardDetails` slot. Edit: linked phone
   shows "Connection type" with each type's `SwitchFromPhone`; an extension-type inbox shows its
   `EditSection`. Remove text: the phone text for `qrLink`, a generic one otherwise. No QR/relink UI when
   `capabilities.qrLink` is false.
2. Setup wizard WhatsApp step: with ≥ 1 type that has `SetupForm`, the segmented choice "WhatsApp app (QR)"
   (default) / the type label above the step, as in the mock; Lite shows the step unchanged.
3. Conversation: when the chat's inbox has `replyWindowHours`, a quiet "Reply window: 5 h 12 min left" line
   above the composer (warning tone in the last hour, ticks each minute); closed → the info panel with
   **Send a template** replacing the composer. Template dialog: list from `GET /inboxes/:id/templates`
   (name, language, category; not sendable ones disabled with the header reason), variables with the first
   name prefilled for {{1}}, required check, live preview, marketing note, empty state with a WhatsApp
   Manager link (`https://business.facebook.com/wa/manage/message-templates/`) and Sync (`?refresh=1`);
   send → `POST /chats/:jid/template`; a 409 `window_closed` from any send shows the panel.
4. Chat list: closed-window icon (`TimerOff`) with an sr-only label for such chats.
5. Message bubble: "Template <name>" marker in the footer when `message.template`.
6. Hand-off reason label for `window_closed` wherever reasons are named (chat events, audit).
7. Tests: component tests for each state (types present/absent, window open/closing/closed, dialog states)
   and a real-server contract stays green. No e2e from agents.

## Enterprise (`ezychat-enterprise`, after the Lite parts)

Extension `wa-cloud` in `packages/ent-server` + `packages/ent-web` (or a new package pair, following the
Connectors layout): `CloudApiAdapter` over Graph API (pinned version, `graph.facebook.com` only, guarded
fetch, 10 s timeouts), credentials per inbox in encrypted settings, check route, create/switch routes calling
`getInboxService(ctx).create/changeType`, webhook `GET`/`POST /api/ext/wa-cloud/public/webhook` (verify
token, `X-Hub-Signature-256` with the App secret, routed by `phone_number_id`, idempotent by message id,
statuses → acks), registration with `override_callback_uri` on start and on `tunnel:status` URL change,
templates from `/{waba}/message_templates?status=APPROVED`, health (token, quality, limit); web
`WebExtensionInboxType` with CreateForm/CardDetails/EditSection/SwitchFromPhone/SetupForm as in the mock.
Tests with a local fake Graph server; never real Meta.

## Ownership while building

- Server agent: `packages/server/**`, `packages/wa/src/fake/**`, `e2e/start-*.mjs` only if needed for the
  dev type. Not the contracts above.
- Web agent: `apps/web/src/**` (not `extensions/types.ts`), web tests.
- Orchestrator: contracts, AGENTS.md, CHANGELOG, LEARNINGS, workbook, e2e specs, commits.
