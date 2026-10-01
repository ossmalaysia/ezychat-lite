# WhatsApp Team Inbox — Design Spec

Date: 2026-10-02 · Status: approved (sections 1–6 approved in chat)

## 1. Goal

A Mac + Windows desktop app that links **one** WhatsApp number (via Baileys) and lets a
team handle customer chats together through a shared inbox. Agents use a web UI (PWA)
served by the app — from the desktop window, the LAN, or a Cloudflare tunnel on their
phones. The app can run **standalone** (lives while the app is open) or as a **boot-time
OS service** (keeps running with the app closed and no user logged in).

### Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| WhatsApp backend | Baileys (unofficial; ban risk accepted). No Cloud API in v1. |
| Team model | Shared inbox: everyone sees all chats; assignment, internal notes, open/resolved |
| Tunnel | Cloudflare: quick tunnel (random URL) + named tunnel (token) |
| Message features | Text, media in/out, groups, quick replies, web push |
| Stack | Electron + React + TypeScript; server in a separate process |
| Auth | Username + password, first-run admin wizard; desktop shows normal login |
| 2FA | **Phase 2** (TOTP + recovery codes) |
| Run modes | Standalone (default) + boot-time service (Windows Service / macOS LaunchDaemon) |
| History import | Last 30 days on first link (configurable) |
| Open source | Public repo `github.com/ossmalaysia/wa-team-inbox`, MIT license |
| Naming | Product name **WA Team Inbox**; npm scope `@wa-team-inbox/*`; appId `org.ossmalaysia.wateaminbox`; machine data dir name `wa-team-inbox`. Never use "WhatsApp" as the product name; describe as "shared team inbox for WhatsApp" with a non-affiliation disclaimer. |

### Out of scope for v1 (phase 2)

TOTP / recovery codes / require-2FA, code signing & notarization, auto-update,
WhatsApp Cloud API adapter, multiple numbers, analytics, broadcast/bulk messaging.

## 2. Architecture

```
Electron app
  MAIN PROCESS: window, tray, standalone server spawn (utilityProcess) + restart,
                service install/uninstall/start/stop (elevated), "Reset admin password"
  SERVER (packages/server, runs as utilityProcess OR as OS service via ELECTRON_RUN_AS_NODE=1)
    WA module (packages/wa)  – Baileys socket, auth state, events; only importer of Baileys
    Store                    – SQLite (better-sqlite3, WAL) + media folder
    API                      – Fastify REST (/api) + Socket.IO
    Auth                     – users, sessions, roles, rate limiting
    Tunnel                   – cloudflared child process (quick/named)
    Push                     – web-push (VAPID)
    Static                   – serves the built React PWA (apps/web)
Clients: desktop window (http://127.0.0.1:PORT), mobile/LAN browsers (tunnel URL)
```

- The server binds `127.0.0.1` by default; optional LAN toggle binds `0.0.0.0` (HTTP, warned).
- Default port `7420`, configurable.
- Server CLI: `server --data <dir> --port <n> [--reset-admin] [--fake-wa]`.
- The `WaAdapter` interface isolates Baileys:
  `connect()`, `logout()`, `sendText()`, `sendMedia()`, `markRead()`, `sendPresence()`,
  events `status`, `qr`, `message`, `messageStatus`, `chats`, `contacts`, `history`.
  `FakeWaAdapter` implements it for tests and `--fake-wa` (scriptable incoming messages
  via a dev-only endpoint `POST /api/dev/fake-incoming`, enabled only with `--fake-wa`).

### Run modes

**Standalone:** Electron main forks `server.js` with `utilityProcess.fork`, data in
Electron `userData`. Restarts on crash with backoff. Quitting the app stops everything.

**Service:** admin enables "Run as background service" in the desktop app.
- Windows: WinSW wrapper registers a Windows Service (LocalSystem, auto-start,
  restart-on-failure) running `electron.exe` with `ELECTRON_RUN_AS_NODE=1 server.js`.
- macOS: `/Library/LaunchDaemons/<appId>.server.plist` with `RunAtLoad` + `KeepAlive`.
- Elevation: one UAC / admin prompt (`sudo-prompt`) for install/uninstall/start/stop.
- Data moves (single copy) to machine-wide folder:
  `C:\ProgramData\wa-team-inbox\` or `/Library/Application Support/wa-team-inbox/`.
  Disabling moves it back to `userData`.
- Desktop app becomes a client: detects running service at `localhost:PORT`
  (`GET /api/health` returning `{app:"wa-manager", mode}`), shows status + controls.
- Installer must be per-machine (`nsis.perMachine: true`) so the service can reach files.
- A lock file (`server.lock` with pid) in the data dir guarantees one server per data dir.

### Secrets

A 32-byte key file `secret.key` in the data dir (mode 0600 / ACL to SYSTEM+Admins in
service mode) encrypts at-rest secrets (named-tunnel token, VAPID private key) with
AES-256-GCM. `safeStorage` is not used (unavailable to services).

## 3. Data model (SQLite, migrations via `PRAGMA user_version`)

- `users(id, username UNIQUE, display_name, password_hash, role admin|agent,
  must_change_password, disabled_at, created_at)`
- `sessions(token_hash PK, user_id, created_at, last_seen_at, user_agent, ip)` —
  30-day idle expiry.
- `chats(jid PK, type dm|group, name, avatar_path, unread_count, last_message_at,
  last_message_preview, status open|resolved, assigned_to → users, updated_at)`
- `contacts(jid PK, push_name, saved_name, phone)`
- `messages(id PK (WA msg id), chat_jid, sender_jid, from_me, sent_by_user_id,
  type text|image|video|audio|document|sticker|system, body, media_path, media_mime,
  media_name, media_status none|ok|failed|pending, quoted_id, status
  pending|sent|delivered|read|failed, error, timestamp, created_at)`; index
  `(chat_jid, timestamp, id)`. Upserts on id (idempotent).
- `notes(id, chat_jid, user_id, body, created_at)`
- `chat_events(id, chat_jid, type assigned|unassigned|resolved|reopened, actor_id,
  payload JSON, at)`
- `quick_replies(id, shortcut UNIQUE, body, created_by, updated_at)`
- `push_subscriptions(id, user_id, endpoint UNIQUE, p256dh, auth, created_at)`
- `settings(key PK, value)` — port, lan_enabled, tunnel_mode, tunnel_token (enc),
  history_days, vapid keys (private enc).
- `audit_log(id, user_id, action, ip, meta JSON, at)`

Rules: new inbound message on a `resolved` chat → reopen (keep assignee).
`from_me && !sent_by_user_id` → shown as "via phone". Media stored at
`media/<sanitized chat>/<msgid>.<ext>`, served only via `/api/media/:msgId`.

## 4. Auth

- First run: `GET /api/setup/status` → `{needsSetup}`. `POST /api/setup/admin` allowed only
  when no user exists AND the request is from loopback; afterwards `/api/setup/*` → 404.
- Passwords: argon2id (`@node-rs/argon2`), min length 8.
- Sessions: random 32-byte token in `sid` cookie (`HttpOnly; SameSite=Lax; Secure` when
  request is HTTPS/`X-Forwarded-Proto: https` from loopback); DB stores SHA-256 hash.
- Roles: admin (members, quick replies, WA link/logout, tunnel, settings, audit) vs agent.
- Admin creates agents with temp password → `must_change_password`. Admin can reset
  password, disable, revoke sessions. Disabling kicks the user's sockets.
- Admin recovery: `server --reset-admin` (CLI only, run from tray menu) sets a new random
  password for the first admin and prints it; never exposed over HTTP.
- Rate limit: 5 failures / username / 15 min → 15-min lockout; 20 login attempts / IP / min.

## 5. API (all under `/api`, JSON, cookie auth unless noted)

| Area | Endpoints |
|---|---|
| Health | `GET /health` (public) |
| Setup | `GET /setup/status`, `POST /setup/admin` (public, guarded) |
| Auth | `POST /auth/login` (public), `POST /auth/logout`, `POST /auth/change-password`, `GET /me` |
| Chats | `GET /chats?status=&assigned=me\|none\|any&q=&cursor=&since=`, `GET /chats/:jid`, `PATCH /chats/:jid {assignedTo?, status?}`, `POST /chats/:jid/read` |
| Messages | `GET /chats/:jid/messages?before=<ts>_<id>&limit=`, `POST /chats/:jid/messages {text, quotedId?, clientId}`, `POST /chats/:jid/media` (multipart: file, caption) , `POST /messages/:id/retry` |
| Notes | `GET /chats/:jid/notes`, `POST /chats/:jid/notes` |
| Media | `GET /media/:msgId` (Range support, `Content-Disposition`, `nosniff`), `POST /media/:msgId/redownload` |
| Quick replies | `GET/POST /quick-replies`, `PATCH/DELETE /quick-replies/:id` (write = admin) |
| Users (admin) | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `DELETE /users/:id/sessions` |
| WhatsApp | `GET /wa/status` (all), `POST /wa/logout`, `POST /wa/relink`, `POST /wa/takeover` (admin) |
| Tunnel (admin) | `GET /tunnel`, `POST /tunnel/start {mode, token?}`, `POST /tunnel/stop` |
| Settings (admin) | `GET/PATCH /settings`, `GET /audit`, `GET /logs/download` |
| Push | `GET /push/vapid-key`, `POST /push/subscribe`, `DELETE /push/subscribe` |

Socket.IO (cookie-authenticated handshake; rooms `user:<id>`, `all`, `admins`):
server→client `message:new`, `message:status`, `chat:updated`, `note:new`, `typing`,
`wa:status`, `wa:qr` (admins), `tunnel:status` (admins), `session:revoked`;
client→server `typing {chatJid}`.

Mutating requests require `Origin` matching `Host` (or absent for same-origin GET).
Payloads validated with zod schemas from `packages/shared`.

Send flow: client posts with `clientId` → server inserts `pending` row → queue sends via
adapter → on ack, row id replaced by WA id, `message:status` emitted with `clientId`.
Collision UX: `typing` indicator; replying to a chat assigned to someone else asks for
confirmation (warn, not block).

Push routing: inbound message → assignee if any else all active agents; only users with
no connected socket get push.

## 6. Tunnel

cloudflared binaries bundled as `extraResources` (`resources/cloudflared/<platform-arch>/`).
- Quick: `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:PORT`; URL parsed
  from output (`https://*.trycloudflare.com`); shown with QR in admin UI.
- Named: `cloudflared tunnel --no-autoupdate run --token <token>`; hostname entered by
  admin for display.
- Supervision: restart with backoff 1s→60s; after 5 consecutive failures → `error`
  with last 50 log lines. State persisted and restored on server start.
- `CF-Connecting-IP` trusted only when the socket peer is loopback.

## 7. Security

Strict CSP (no inline script), `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`,
`X-Content-Type-Options: nosniff`. Upload cap 64 MB, MIME sniffed with `file-type`.
Media responses forced download for non-image/video/audio. LAN mode warns about HTTP.
Audit log: login success/fail, user changes, tunnel on/off, WA relink/logout/takeover,
settings changes.

## 8. WhatsApp connection handling

| DisconnectReason | Action |
|---|---|
| connectionClosed/Lost, timedOut, restartRequired | reconnect, backoff 2s→60s + jitter |
| loggedOut (401) | wipe auth, status `logged_out`, alert admins (banner + push) |
| connectionReplaced (440) | no auto-reconnect, status `replaced`, admin "Take over" |
| badSession | back up auth dir, wipe, request relink |
| forbidden (403) / multideviceMismatch | status `blocked`, stop, alert admins |

Outbound queue persisted (pending rows); FIFO per chat; ≥1s spacing per chat with
`composing` presence; pending > 10 min → `failed` (retry button). History sync imports
last `history_days` days. Media download failures → `media_status=failed` + redownload.

## 9. Robustness

pino logs in `<data>/logs`, daily rotation, 14 days. Uncaught exception → log + exit
(supervisor restarts). SQLite WAL + busy_timeout 5000. Nightly backup:
`VACUUM INTO backups/app-YYYYMMDD.db` + `wa-auth` copy, keep 7. Socket clients
resync with `GET /chats?since=` on reconnect.

## 10. Project structure

```
apps/desktop    Electron main (electron-vite or tsc), tray, service manager, packaging config
apps/web        React + Vite + Tailwind PWA (service worker for push), react-router
packages/shared zod schemas + TS types for REST and socket payloads
packages/wa     WaAdapter interface, BaileysAdapter, FakeWaAdapter
packages/server Fastify app factory, db/migrations, services, routes, socket, tunnel, push, cli
resources/cloudflared/
```

npm workspaces, TypeScript strict, ESLint, Vitest, Playwright.

## 11. Web UI

- Setup wizard (create admin → link WhatsApp QR → optional tunnel).
- Login, forced password change.
- Inbox: chat list with filters (Mine / Unassigned / All, Open / Resolved, search),
  unread badges, assignee avatar; responsive (list ↔ conversation on mobile).
- Conversation: message bubbles (text, image, video, audio, document, sticker, quoted),
  status ticks, "sent by <agent>" / "via phone" label, composer with `/` quick-reply
  picker, attachment upload, typing indicator for other agents, notes panel, event
  timeline items, assign / resolve / reopen actions, disconnected banner.
- Admin: Members, Quick replies, WhatsApp (status, QR, logout, takeover), Tunnel
  (mode, URL + QR, token), Settings (port, LAN, history days), Audit log, Logs download.
- PWA manifest + service worker; push opt-in; iOS "Add to Home Screen" hint.
- **Mobile responsive is mandatory** for every screen (setup, login, inbox, conversation,
  admin): mobile-first, usable at 360px wide without horizontal scroll, safe-area aware,
  `100dvh` layouts, ≥44px touch targets, ≥16px input text, composer above the keyboard,
  admin tables → cards and side nav → top menu on small screens.

## 12. Testing

- Unit (Vitest): auth/lockout/setup guard, chat rules, send queue (order, 10-min cutoff),
  disconnect handling with FakeWaAdapter, cloudflared URL parsing, crypto helper.
- API integration: `fastify.inject` + temp SQLite; role checks; Origin check;
  CF-Connecting-IP trust.
- Socket: socket.io-client against test server; rooms; push-vs-socket routing.
- E2E (Playwright): server `--fake-wa` + built web: setup → login → fake incoming →
  assign → reply → resolve; desktop + mobile viewports.
- Manual checklist: real QR link, media, groups, quick/named tunnel from 4G, iOS PWA push,
  service install + reboot with no login (both OSes).
- CI: GitHub Actions matrix windows-latest / macos-latest: lint, typecheck, test, package.

## 13. Open-source practices

- `LICENSE` (MIT, "Copyright (c) 2026 OSS Malaysia and contributors").
- `README.md`: what it is, screenshots placeholder section omitted until real ones exist,
  features, **disclaimer** (not affiliated with WhatsApp/Meta; Baileys is unofficial and
  may get numbers banned; not for bulk messaging), install, quick start, dev setup,
  architecture overview, license.
- `CONTRIBUTING.md` (dev setup, workspace commands, Conventional Commits, PR flow,
  tests required), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md` (private reporting via GitHub Security Advisories), `CHANGELOG.md`
  (Keep a Changelog), `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml` (npm + actions, weekly),
  `.editorconfig`, `.gitattributes` (LF), `.nvmrc` (Node 22).
- CI on push/PR: lint, typecheck, unit/integration tests, web build; packaging job on tags
  `v*` uploads unsigned installers to a GitHub Release.
- Conventional Commits; semver; releases via tags.
- No secrets, personal data, or WhatsApp auth/session files in the repo
  (`.gitignore` covers `data/`, `*.db`, `wa-auth/`, `.env*`).
