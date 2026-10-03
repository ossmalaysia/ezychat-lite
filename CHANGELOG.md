# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
