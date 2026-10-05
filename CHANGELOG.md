# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
