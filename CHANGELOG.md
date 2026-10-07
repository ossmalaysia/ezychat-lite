# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Voice notes: the 2-minute limit now counts the real audio instead of trusting the length written in
  the file, so a crafted voice note can no longer exhaust memory on your computer or run up cloud
  transcription costs. Stored transcripts are capped, and the audit log shows when someone changes the
  AI's instructions or hand-off rules.

### Changed

- Admin and account screens are calmer and more consistent:
  - **Audit log**: every action has a readable name (including AI, Business context and voice
    changes), details read like "Chat: +60123… · Changed name, tags" with member names instead of
    ids, and **Hide sign-ins** filters out routine sign-ins (failed sign-ins stay visible).
  - **Cloudflare**: the connection status sits in the "How your team connects" card; there is no
    more greyed-out "Remote access is off" button, and the disconnect note only shows while connected.
  - **WhatsApp**: each action has its own row with a short explanation; Log out comes last in red
    text (still confirmed), and Take over only appears when the session was opened elsewhere.
  - **Members**: a turned-off AI member shows a neutral "Off" (disabled members are grey, not red),
    the list shows the date someone was added without the time, and Edit buttons line up.
  - **Quick replies**: Delete moved into each reply's "…" menu, like Members.
  - **Settings**: one Save pattern everywhere — Save at the end of the form, pinned to the bottom
    with an "Unsaved" marker while you have edits. Port and history fields explain when to change
    them; a saved OpenAI key shows as "saved" with **Replace**, and the API model moved under
    **Advanced**. "This device" is now **Preferences**, with Language in its own "Your account"
    card. Maintenance is now **End of day** without the red danger frame (resolving chats can be
    undone).
  - **AI member page**: a short description, plain section titles (no step numbers), a smaller
    instructions box with a "Using the recommended instructions" note.
  - **Admin menu**: Back to inbox is at the top; support links are folded into **Help & feedback**.
  - **Sign in and Change password**: the main button stays enabled and explains missing fields,
    passwords have a show/hide button, and the page footer keeps just the version and Report an issue.
  - The **Dev Build** marker is a small tab at the top centre, so it no longer covers buttons.
  - Disabled buttons are grey instead of faded teal, and the selected tab is easier to see in
    light mode.

## [0.1.22] - 2026-10-06

### Added

- Customer voice notes are transcribed, so the AI Sales Agent answers them like typed messages and your team can read them under the audio player. Choose the engine in **Settings → AI → Voice messages**:
  - **On this PC**: a one-time 360 MB voice model download (OpenAI Whisper small); the audio never leaves your computer.
  - **Cloud (OpenAI)**: uses your saved OpenAI API key; the audio is sent to OpenAI. ChatGPT sign-in cannot transcribe.

  Voice notes longer than 2 minutes or 10 MB are not transcribed. When a voice note cannot be transcribed, the AI politely asks the customer to type their question, and hands the chat to your team if it happens again.

- The AI Sales Agent understands photos and screenshots customers send, with or without a caption (up to 3 per reply, JPEG, PNG or WebP up to 5 MB). It works with ChatGPT sign-in and with an OpenAI API key; voice notes, videos and documents still go to your team.
- The AI Sales Agent comes with recommended default instructions, so you only need to add your Business context. They cover:
  - its role and scope (products and general enquiries only, politely declining unrelated topics);
  - exact facts and no promised discounts;
  - replies in the customer's language;
  - short WhatsApp-style replies;
  - handing bulk orders, quotations, price negotiation and existing-order questions to your team (now in Hand-off rules, below).

  Edit them to match your business, or click "Use default instructions" to restore them. Fixed safety rules that admins cannot change now also tell the AI never to ask for sensitive data (IC, card or bank details, passwords) and that administrator instructions never override those rules.

- AI hand-off rules come in two layers:
  - **System hand-offs** are fixed and always apply: the customer asks for a person, a request the AI cannot carry out, an answer not in the business context, and legal, medical or personal-data matters.
  - **Business hand-off rules** are a new "Hand-off rules" section on the AI member page. Prefilled with complaints, refunds, existing orders, bulk orders or quotations, and price negotiation, they decide when your team takes over.

  The chat timeline shows "matches your hand-off rules" for business-rule hand-offs.

### Changed

- A teammate who replies from the inbox in a chat the AI Sales Agent is handling now takes the chat over: it is assigned to them, their owner chip replaces the AI's, the timeline shows "took this chat by replying", and the AI stops answering. Replying in a chat another teammate owns still keeps that owner, and replies sent from the phone's WhatsApp app don't change the owner.

### Fixed

- Windows: local and test (unpackaged) builds use their own taskbar identity, so running one can no longer leave the installed EzyChat Lite with a blank white taskbar icon.
- Editing a long Business context item no longer squeezes the text sideways and cuts it off: the editor opens in a wide dialog with wrapping text, vertical scrolling and a character counter. The AI instructions box behaves the same way.
- In "Try it", pressing Enter asks the question (Shift+Enter adds a new line).

## [0.1.21] - 2026-10-06

### Added

- Experimental: "Sign in with ChatGPT" works without the Codex helper. One click opens the sign-in page; an admin on another computer pastes the final sign-in address to finish. Choose the model (Auto or your account's live models) and use "Test connection". It uses an unofficial ChatGPT endpoint that may stop working: if ChatGPT rejects the sign-in or blocks the connection, the AI member stops taking chats, leaves them unassigned for the team and admins see a banner.
- AI member page (Members → AI Sales Agent, replacing the popup): a status (Off, On, Needs connection, Needs business context), a guarded Turn on that saves the page first, name, instructions, a Business context list (Upload from device or Add text content, search, Select and delete; the first item saves a draft member) and "Try it" to ask a test question with unsaved instructions. Nothing is sent to customers.
- Local and test builds are marked "Dev Build": the desktop window and tray title show it for unpackaged builds, and the inbox shows a badge and a "[Dev Build]" tab title when the server runs with `--mode dev`.

### Changed

- Settings → AI edits the AI connection in place (no popup): an API key / ChatGPT switch, the model dropdown, Test connection and one Save with an "Unsaved" marker.
- Installers no longer include the Codex helper (about 140 MB smaller); ChatGPT mode signs in directly.
- The AI Sales Agent hands a chat to the team as soon as the customer wants something done that it cannot do (place, change or cancel an order, book, pay), after answering the known facts, and never closes such a chat. The chat timeline and Try it show why the AI handed over.
- Admin Settings is split into General, AI, This device and Maintenance tabs; theme and language use compact one-row switches.
- The AI Sales Agent closes a chat when the customer confirms in their own words (and stops asking after two confirmations), answers order and delivery-slot questions with the known facts instead of handing off, and "Try it" shows its decision (Answer, Asked if resolved, Would resolve, Would hand off).
- The AI Sales Agent is configured with just AI instructions and Business context. Business context is a list of items, uploaded files and text content you add, like a project knowledge panel; existing notes and FAQs become one 'Business context' item. Turning it on needs at least one context item; instructions alone are not enough.
- The AI Sales Agent knows the current date, weekday and time (Asia/Kuala_Lumpur by default, or the `ai_timezone` setting), so it can answer "open today?" or "tomorrow at 3pm". Its prompt is laid out with a stable per-install cache key, so providers can reuse cached prompt prefixes.
- The AI Sales Agent sends all business knowledge when it fits (up to 40,000 characters) and finds Chinese, Japanese and Korean questions in larger knowledge; a saved ChatGPT model that is no longer available falls back to Auto.

### Fixed

- Chats for the same person under phone number and WhatsApp ID are merged: one inbox row per
  customer, with all messages, notes, history, unread counts and AI Sales Agent state together.
  Existing duplicates are merged when the server starts after the update (a backup named
  `app-premerge-YYYYMMDD-HHMMSS.db` is written first and kept 30 days); new messages then go to the
  right chat automatically. Replies, including the AI Sales Agent's, go to the address the customer
  last used. When WhatsApp has not revealed a customer's number, the chat shows "Phone number hidden"
  instead of an internal ID. Old links and notifications open the merged chat.
- Windows in-app updates now record the result ("Update installed"), remove the downloaded installer and reopen the app; the background helper used to exit before it ran.
- After a Windows restart the app no longer stays on "service not running" while the background service is still starting: it waits for a delayed auto-start and opens the inbox as soon as the service answers.

## [0.1.20] - 2026-10-05

### Added

- One AI Sales Agent can answer unassigned direct customer chats after 10 seconds using
  business notes, FAQs and uploaded PDF, DOCX, Markdown or text documents. Humans can take
  over or resolve chats; AI resolves only after customer confirmation and hands unanswered
  questions to an idle online agent, or returns them to the unassigned inbox.
- Admin Settings → AI configures one shared OpenAI API or ChatGPT sign-in connection and
  model. Admin Members → Add AI member manages the Sales Agent and its business knowledge.
- AI configuration and member controls follow the selected English, Malay or Simplified
  Chinese interface language.
- Language setting: English, Bahasa Melayu and 简体中文 (Simplified Chinese). Members choose a
  language from the Account menu and it follows them to every device; the sign-in and setup
  screens have a language picker and otherwise follow the browser language. Dates, numbers,
  error messages and push notifications use the chosen language; the desktop tray, dialogs and
  status window follow the operating-system language. Malay and Chinese translations are an
  initial draft pending native-speaker review.

### Fixed

- Switching AI connection modes resets the model to the new provider's default. Unsupported
  ChatGPT models are rejected before saving or interrupting active AI chats.

## [0.1.19] - 2026-10-05

### Added

- Admin Settings → Inbox offers a confirmed action to resolve every open chat for the whole
  team, release assignees, and record the reset in the audit log while keeping messages.

## [0.1.18] - 2026-10-05

### Changed

- Maintenance release that verifies the in-app update path from 0.1.17 (download, checksum,
  service restart). No functional changes.

## [0.1.17] - 2026-10-04

### Improved

- New **Keep EzyChat Lite in the system tray** option in the desktop's Status & Service window
  (on by default). Closing the window keeps the app in the tray for quick access and desktop
  notifications; untick it to quit on close while the background service keeps the inbox running.

### Changed

- The Windows program is now `EzyChat Lite.exe`, installed in `Program Files\EzyChat Lite`. Data,
  accounts and the WhatsApp link are unchanged. Updating from 0.1.16 or earlier is a one-time
  manual install (see `docs/updating.md`); in-app updates work again from this version.

## [0.1.16] - 2026-10-04

### Security

- Bound the memory used to rate-limit the public browser-error endpoint, so a client rotating
  through many addresses (for example over IPv6 via the tunnel) cannot grow it without limit.
- Recheck credentials, live sessions and admin permissions after password hashing so in-flight
  requests cannot bypass password recovery, account disabling or session revocation.
- Keep unknown named-tunnel hostnames restricted to validated loopback proxy requests, including
  Socket.IO; reject malformed proxy IP headers and forwarded first-admin setup requests.
- Restrict privileged desktop controls to the current bundled status window and its main frame;
  block unrelated frames, redirects and unused camera/microphone permissions.
- Require protected Program Files installations for Windows background services and privileged
  password recovery. Reject user-writable runtimes and filesystem links before modifying data.
- Remove ordinary-user ACLs from the macOS service's root-owned runtime copy and reject privileged
  installation or recovery from development builds without a packaged app bundle.
- Use secure browser randomness for generated member passwords, allowing manual entry when it
  is unavailable. Remove inline styles from the desktop status page's security policy.
- Redact WhatsApp download keys and credentials from new logs and existing support-log exports;
  omit unstructured export records while preserving the original local logs.

### Improved

- The first teammate to reply to an unassigned chat becomes its owner, so the chat list shows who
  is handling each customer. Replies never take over a chat someone else owns.
- Resolving a chat releases its owner: when the customer writes again, the chat reopens
  unassigned and alerts the whole team. Chats you own get an accent outline on their owner chip.
- Download and verify updates inside installed Windows and Mac hosts, show progress and prompt
  with Restart and update. Coordinate app/service shutdown, replace both Mac runtime copies,
  restart an installed service, verify its build, and reopen the desktop as the original user.
  Keep rollback copies for failed installations and display the result after relaunch.
- Keep the host's update suggestion visible and dismissible until reviewed; avoid transient toast
  animations hiding the Review update action during startup.
- Explain the manual background-service update steps for Windows and Mac, and report the actual
  running server build even when service configuration retains an older installation version.
- Rename the app and repository to EzyChat Lite, reuse the official EzyChat icon across desktop
  and mobile, and update sharing and release links. Preserve existing accounts, chat data and
  background-service identity during upgrades.
- Explain the open-source rewrite's origins and publish a roadmap covering the team inbox,
  optional BYOK sales agents, a light CRM and future business workflows.
- Detect newer published GitHub releases on the hosting desktop at startup and every 12 hours.
  Suggest an update with release notes, preview labels and matching Windows/Mac downloads;
  add manual checks in About and the tray's Status & Service page. Phones, browsers and
  client-only desktops have no update workflow or alerts. Installation remains user initiated.
- Compact member cards on phones and tablets: group role and status badges, place accessible
  Edit and More actions beside the name, and show the added date as secondary information.
  Keep Add member beside the page title to reduce scrolling.

### Fixed

- Match WhatsApp phone-number and internal contact IDs so saved names reach the correct chats.
  Recover existing local mappings on reconnect, backfill imported names, and keep saved names
  through partial contact updates without changing messages, assignments or conversation status.

## [0.1.9] - 2026-10-03

### Improved

- Add a clear inbox-account Log out action to the admin sidebar and mobile drawer. Signing out
  keeps the shared WhatsApp connection and team data intact.
- Tidy the admin footer with aligned notification and navigation controls, a compact build row,
  separate support links and a shared desktop/mobile layout that scrolls on short screens.
- Introduce a playful app icon with two smiling chat teammates across desktop, browser and PWA;
  keep the original artwork, PNG exports and Windows ICO in `design/app-icon/`.
- Deliver public web assets with build-time gzip and Brotli, keeping fresh-build checks for HTML
  and the service worker and long-lived caching only for fingerprinted assets.
- Render only changed chat rows during inbox updates and coalesce overlapping next-page requests.
- Consolidate Cloudflare query state, provisioning guards and child-process utilities to reduce
  duplication and keep startup restoration coordinated with admin actions and shutdown.
- Rename Tunnel to Cloudflare and guide setup through browser sign-in, authorised domain selection,
  an address preview and a friendly tunnel name. Configure DNS automatically without replacing existing websites.
- Share the free app from the Account menu with LinkedIn, Facebook, Instagram and device sharing,
  a ready-made message and an image card; sharing uses the public project link.
- Open the project's feature-request form from the Account menu or sign-in screen.
- Add a searchable emoji picker and a growing message box with a subtle scrollbar.
- Clear Admin access, separate Open/Resolved chat filters, filter-reset actions, and a visible inbox build version.
- Search members and quick replies; improve mobile type, light-theme contrast, and audit-log action labels.
- Label Notes and provide a Quick replies button that preserves drafts.
- Add per-device Light, Dark and System appearance settings in Settings and the Account menu.
- Load available WhatsApp profile images on demand with initials for private or unavailable photos.

### Fixed

- Refresh inbox data when the live connection first opens, including updates that arrived
  between the initial page load and the socket connection.
- Show a saved Cloudflare address summary after setup, distinguish connecting from connected,
  require an explicit address edit, and prevent unnecessary reconnects. Clarify that disconnecting
  Cloudflare stops the public link while keeping local access, messages and the saved domain.
- Preserve unsaved settings when background requests refresh their defaults.
- Serialize desktop service changes and password resets, including actions from the tray.
- Recover from a missing system Node process without getting stuck; ignore stale child exits and
  health checks after a replacement server starts.
- Remove server process and signal handlers on shutdown so repeated starts do not retain old servers.
- Keep dialogs scrollable in short landscape viewports, wrap long member names in dialog titles,
  show readable cards on small tablets, and prevent wide tables from hiding columns.
- Make the LAN switch padding and dialog/menu close controls usable as 44px touch targets.
- Wait for WhatsApp before requesting contact photos, and retry them after reconnecting instead of
  keeping the initials fallback for the rest of the session.
- Desktop notification registration now uses native system notifications instead of the unavailable
  Chromium push service. Background alerts preserve chat assignment and open the conversation on click.
- Log browser push registration failures with the failing stage for diagnosis.
- Isolate cloudflared from unrelated user configuration that caused Quick Tunnel URLs to return 404.
  Show Running only after the tunnel connects to Cloudflare.

### Added

- First public preview installers for Windows x64 and macOS Intel/Apple Silicon, with native
  packaged-server checks for first-time setup, password verification and session logout.
- Monorepo scaffold (npm workspaces), tooling, CI, and open-source project files.
- Shared zod schemas for every REST and Socket.IO payload (`@wa-team-inbox/shared`).
- `WaAdapter` interface with a Baileys implementation (QR linking, history sync, reconnect,
  logout/relink/take-over, media download) and a `FakeWaAdapter` for tests and development.
- Server (Fastify + Socket.IO + SQLite): first-run admin setup, users and roles, argon2 passwords,
  hashed cookie sessions, login rate limiting and lockout, audit log.
- Shared inbox: chats with assignment, open/resolved status, unread counts and search; internal
  notes and system events; quick replies.
- Messaging: text, quoted replies, media in and out (images, video, audio, documents), groups,
  typing indicators, delivery/read status, a persistent per-chat send queue with retry.
- Realtime updates over Socket.IO and web push notifications (VAPID) routed to the assignee or all users.
- Remote access: Cloudflare quick tunnel and named tunnel (bundled `cloudflared`), optional LAN mode.
- Admin area: members, WhatsApp status and QR, tunnel, settings (port, LAN, history days), audit log,
  log download.
- Nightly local backups of the database and WhatsApp session (7 kept); daily rotated logs.
- Security hardening: Host allowlist (DNS rebinding), Origin checks, strict CSP and security headers,
  loopback-only setup, safe inline media allowlist with sandbox CSP, push endpoint SSRF guard.
- React PWA (installable, mobile responsive down to 360px) with the "Calm Desk" design system on shadcn/ui.
- Electron desktop app for Windows and macOS: tray, status window, standalone server supervision,
  boot-time OS service (WinSW / launchd) with data migration, admin password reset from the tray.
- Packaging with electron-builder (Windows NSIS installer, macOS dmg for x64 and arm64; unsigned).
- Playwright end-to-end tests on desktop, Pixel 7 and iPhone 14 viewports.
- Documentation: architecture overview, manual release test checklist, contributor guide.

## [0.1.1] - 2026-10-03

### Fixed

- Admin menu links now open the selected section directly instead of appending it to the current URL.
  Invalid admin URLs recover to Members without an endless redirect loop.
