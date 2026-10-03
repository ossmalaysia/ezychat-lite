# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Improved

- Open the project's feature-request form from the Account menu or sign-in screen.
- Add a searchable emoji picker and a growing message box with a subtle scrollbar.
- Clear Admin access, separate Open/Resolved chat filters, filter-reset actions, and a visible inbox build version.
- Search members and quick replies; improve mobile type, light-theme contrast, and audit-log action labels.
- Label Notes and provide a Quick replies button that preserves drafts.
- Add per-device Light, Dark and System appearance settings in Settings and the Account menu.
- Load available WhatsApp profile images on demand with initials for private or unavailable photos.

### Fixed

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
