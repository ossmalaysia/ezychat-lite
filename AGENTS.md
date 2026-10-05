# AGENTS.md

Instructions for every AI coding agent working in this repository (Codex, Claude Code, Cursor, …).
This file is the single source of truth; `CLAUDE.md` imports it. Edit rules **here**.

EzyChat Lite: an Electron desktop app (macOS/Windows) that links one WhatsApp number through
Baileys and serves a shared team-inbox PWA locally, over LAN, or through a Cloudflare tunnel.
npm-workspaces monorepo: `packages/{shared,wa,server}`, `apps/{web,desktop}`, all named
`@wa-team-inbox/*`. Node 22+, TypeScript strict, ESM. Main dev machine is Windows 11.

## Before you start (required)

1. Read `docs/LEARNINGS.md` — past mistakes and the rules that came out of them.
2. Read `docs/design-system.md` before touching `apps/web`.
3. Check `git status`; never overwrite uncommitted work you didn't make.

## Commands

```bash
npm install                                   # all workspaces
npm run dev                                   # server (tsx watch, --fake-wa, data in ./data/dev, port 7420) + Vite web
npm test                                      # every Vitest project (packages/*, apps/*)
npx vitest run packages/server/test/auth.test.ts                       # one file
npx vitest run packages/server/test/auth.test.ts -t "lock the account"  # one test by name
npm test -w @wa-team-inbox/server             # one workspace
npm run lint                                  # ESLint
npm run typecheck                             # tsc --noEmit in each workspace + e2e/
npm run e2e                                   # Playwright: builds web, starts server --fake-wa on :7499 with .e2e-data
node e2e/screens.smoke.mjs <url> <outDir>     # every screen (desktop+mobile): page errors, blank, overflow, screenshots
node e2e/electron-screens.smoke.mjs <url> <outDir>  # same, inside a real Electron window
npm start -w @wa-team-inbox/desktop           # build web + bundle server + tsc + launch Electron
npm run dist -w @wa-team-inbox/desktop        # fetch cloudflared/WinSW, build, electron-builder (host OS only)
npx tsx packages/server/src/cli.ts --data ./data/x --reset-admin       # print a new password for the first admin
npm run version:sync                          # copy root package.json version into every workspace
```

Installers land in `apps/desktop/release/` (`win-unpacked/` for `--dir` builds). Smoke a packaged build with
`ELECTRON_RUN_AS_NODE=1 "<release>/win-unpacked/EzyChat Lite.exe" <resources>/app.asar.unpacked/dist/server/server.cjs --data <tmp> --port 7432 --fake-wa`.

## Architecture

**Process model.** `packages/server` is a standalone Node program that owns all state (SQLite, the
WhatsApp socket, cloudflared). The desktop app never embeds it:

- _Standalone_: Electron main (`apps/desktop/src/main.ts`) forks `dist/server-host.cjs` →
  `dist/server/server.cjs` (esbuild bundle) with `utilityProcess.fork`; data in the user's app-data dir.
  `server-host` writes the effective port to `WATI_PORT_FILE` and turns a `shutdown` IPC message into a graceful close.
- _Service_: WinSW (Windows, LocalSystem) or a launchd daemon (macOS) runs the Electron binary with
  `ELECTRON_RUN_AS_NODE=1`; data moves to `C:\ProgramData\…` / `/Library/Application Support/…`.
  On launch the desktop probes `/api/health`; if a server answers it becomes a plain client window
  and never starts a second server while the service is installed (`startup.ts#decideStartup`).
- The desktop clears the PWA service-worker cache when the web build changes (`clearWebCacheOnVersionChange`);
  F12 / Ctrl+Shift+I = DevTools, Ctrl+Shift+R = hard reload in the app window.

**Server CLI** (`packages/server/src/cli.ts`, `config.ts`): `--data <dir>` (required, or `WATI_DATA`),
`--port` (default 7420, else the persisted `port` setting), `--host` (default from the `lan_enabled`
setting: `127.0.0.1` or `0.0.0.0`), `--mode standalone|service|dev`, `--fake-wa`, `--web-dist <dir>`,
`--reset-admin`. Exit 3 = data dir locked by another server. `--fake-wa` is flag-only (never env) and
rejected in service mode.

**WhatsApp boundary.** `packages/wa` defines the `WaAdapter` interface. Only
`packages/wa/src/baileys/**` may import `baileys`; the server loads it lazily. The socket identifies as
`Browsers.ubuntu('Chrome')` (`WA_BROWSER`) — "Desktop" identities are rejected by WhatsApp (428 before any QR).
Linking: QR or phone-number pairing code (`requestPairingCode`). `FakeWaAdapter` is used by tests and
`--fake-wa`; with it, `POST /api/dev/fake-incoming` simulates inbound messages. History import defaults to
3 days; history media is stored `pending` and downloaded on demand (`GET /api/media/:id`, `POST …/redownload`).
One person can arrive under a phone-number JID and a LID: chats are keyed by the LID once known
(`chats/aliases.ts`, table `jid_aliases`). Existing duplicates are merged only by the startup identity
migration (`chats/identity-migration.ts`, run by `initMessaging` before the message service, AI, HTTP
and `wa.connect()`; pairs read offline by `readStoredLidMappings`; pre-merge backup first). Runtime code
never merges: `AliasStore.route` picks the existing chat of either JID, routes resolve `:jid` through
`chatJidParam`, and replies go to the `wa_remote_jid` of the last inbound message. Never merge on a
name or number match.

**Events.** `wa-bridge` maps adapter events into services (ingest, status acks, chat/contact upserts).
Services emit on the typed in-process `Bus` (`bus.ts`); `realtime/socket.ts` fans out to Socket.IO
rooms (`all`, `admins`, `user:<id>`; QR codes and tunnel status go to `admins` only) and
`push/service.ts` sends web push for `inbound:notify` to the assignee (or every active user if
unassigned), skipping users who are online.

**Contract.** zod schemas in `packages/shared` define every REST body/response and socket payload.
Change the schema first; server and web both import it.

**Send queue** (`messages/send-queue.ts`): FIFO per chat, chats in parallel, ≥1s between sends in a
chat, `composing` presence before each send. Jobs wait while disconnected and fail as `expired` after
10 min; `wa_unavailable` errors keep the job pending. Pending jobs are persisted and restored on start.

**Data dir:** `app.db` (SQLite, migrations in `db/migrations`), `wa-auth/` (Baileys creds),
`media/`, `secret.key` (AES key for settings secrets such as the tunnel token), `logs/` (pino-roll,
daily, 14 kept), `backups/` (`VACUUM INTO app-YYYYMMDD.db` + `wa-auth-YYYYMMDD/`, nightly, 7 kept),
plus a lock file. Live app data on Windows: `%APPDATA%\WA Team Inbox\data`.
The Windows program is `EzyChat Lite.exe` in `Program Files\EzyChat Lite` since 0.1.17 (the updater
still accepts the legacy `WA Team Inbox.exe`). The data folders, desktop profile, service ID and app ID
are intentional upgrade contracts; do not rename them when changing visible branding. Internal workspaces remain `@wa-team-inbox/*`.

**Logging.** Structured pino JSON in `<data>/logs/*.log`; child loggers carry `mod` (`wa`, `messages`,
`web`, …). Browser errors (window errors, unhandled rejections, React error boundaries) are POSTed to
`/api/client-errors` and logged as `mod:"web"`, msg `"client error"` with stack + componentStack.

**Native modules.** `better-sqlite3` and `@node-rs/argon2` are Node-API prebuilds: tests run them on
the system Node ABI, the packaged app loads the same binaries under Electron (`npmRebuild: false`).
Do not run `electron-rebuild` on the workspace; it breaks `npm test`. If `desktop start` fails to load
a native module in dev, set `WATI_DESKTOP_RUNTIME=node` to run the server with system Node.

## Security invariants (do not break; each has tests)

- First-admin setup (`routes/setup.ts`) only while no user exists, only from a direct loopback peer
  with a loopback `Host`, and never through the tunnel.
- `CF-Connecting-IP` is trusted only when the socket peer is loopback and its single value is a valid
  IP (`http/client-ip.ts`); it keys rate limits and decides `Secure` cookies. Unknown named-tunnel
  hosts are allowed only on this proxy boundary, consistently for HTTP and Socket.IO.
- Every request passes the Host allowlist (`http/host.ts`, DNS-rebinding defence: loopback, IP
  literals, single-label/`.local`, current tunnel hostnames). Mutating `/api` requests need
  `Origin` host == `Host` (`http/origin.ts`); Socket.IO checks Origin too.
- Media (`routes/media.ts`) renders inline only for an allowlist of raster/audio/video types;
  everything else is an attachment, served with a `sandbox` CSP and `nosniff`.
- Session tokens are stored as SHA-256 hashes; passwords use argon2; login lockout after 5 failures.
- After asynchronous credential hashing/verification, recheck the current password, disabled state,
  authorizing session and role as appropriate; do not yield between the final check and commit.
- Admin password reset only via the CLI `--reset-admin` or the tray menu, never over HTTP.
- Privileged desktop IPC requires the current registered window, its exact main frame and bundled
  status URL. A `file://` URL by itself is never sufficient authority.
- OS services must execute protected runtimes: check Program Files ownership/ACLs and links on
  Windows; use a root-owned copy without ordinary-user write permissions or ACLs on macOS.
- Managed updates accept no renderer paths or URLs. Require trusted release digest/size, reverify
  protected staging, prepare rollback before stopping the host, and relaunch through an unelevated
  broker. Do not use service removal/data migration as an update operation.
- Password generation requires cryptographic randomness. Redact credential fields from live logs
  and historical support exports; never export unexamined non-JSON records.
- Push endpoints are restricted to known push-service hosts (SSRF guard).
- `/api/client-errors` is public but rate-limited per IP and size-capped.

## UI rules (apps/web)

See `docs/design-system.md` ("Calm Desk"). Primitives are shadcn/ui in
`apps/web/src/components/ui`; app composites in `components/app`. Feature code must not use raw
`<button>`/`<dialog>`/`<select>` or Tailwind palette/hex colours (ESLint enforces); use token classes
(`bg-primary`, `text-muted-foreground`). Every screen must work at 360px without horizontal scroll.
Every route is wrapped in an `ErrorBoundary` — never let a render error become a blank page.
No literal user-facing strings: use `t()` and add every key to `en`, `ms` and `zh-CN` in the same
change (`docs/i18n.md`; ESLint and the catalog tests enforce this). Server API messages stay English.
App-managed cloudflared launches must ignore unrelated default user configuration (`--config=`).
Cloudflare sign-in must run with a private child home; `login` ignores `--origincert`. Store account
credentials only as encrypted settings, redact authorization URLs and API tokens from logs, and never
overwrite DNS or configure a tunnel that the app did not create.
A Quick Tunnel is Running only after URL assignment and edge registration.

Admin shell links and fallback redirects must use absolute `/admin/...` paths. Routing changes must
cover navigation from every admin section and recovery from malformed URLs.

## Working rules (required)

- **Debug from evidence, not guesses.** Read the server log (`<data>/logs/*.log`) before proposing a cause.
  If the failure isn't in any log, add structured logging (pino child logger with `mod`, fields — not
  string concatenation) first, reproduce, then read it.
- Changes under `packages/wa/src/baileys/**` must be smoke-tested against real WhatsApp before claiming
  they work; otherwise say "untested against real WhatsApp".
- Never use the real app data folder for tests or experiments; always `--data <temp dir>`. Never send
  WhatsApp messages from a real linked number while testing.
- GUI smoke tests use a plain Electron harness with an explicit temporary profile; a packaged
  executable always launches its normal entry even when passed a script. Verify packaged modules
  and preloads from the harness; use `ELECTRON_RUN_AS_NODE=1` for packaged server checks.
- Run only the unit tests for files you changed (`npx vitest run <paths>`) plus the typecheck of the
  package you touched. **Don't run e2e or the full suite** unless you are the single, final
  verification step.
- On Windows prefer PowerShell; write multi-line scripts to a file instead of `node -e "…"`.

## Multi-agent rules (orchestrators)

- **Small changes are done directly, not in a subagent** (startup costs 20–40 min; tests compete for CPU).
  Use subagents only for large, independent work, at most 2 in parallel on Windows.
- Subagents get disjoint file-ownership lists; only the orchestrator commits.
- **One consolidated verification at the end** runs `npm run typecheck`, `npm test`, `npm run lint`,
  web build and `npm run e2e` once — nothing else runs e2e.

## Learnings loop (required)

Before finishing any run that changed code, append dated entries to `docs/LEARNINGS.md`
(`- YYYY-MM-DD — what happened → root cause → rule`). If a lesson changes how agents must work, update
the rule in this file. (Claude Code enforces this with a Stop hook; other agents must do it themselves.)

## Conventions

Conventional Commits; LF line endings; Prettier formatting; add user-visible changes to
`CHANGELOG.md` under `[Unreleased]`. Never commit `data/`, `.e2e-data/`, `wa-auth`, databases or secrets.
After repository setup, `main` is protected: use feature branches and reviewable pull requests.
This is currently a solo-maintainer repository, so second-person approval is not required.
Never bypass its CI or conversation-resolution requirements for routine changes. Restore a required
approval when another maintainer can review changes.
Before deploying a changed build, bump the root package version, run `npm run version:sync`, sync the
lockfile, and verify that `/api/health` and the UI identify the deployed version. Activate the complete
build with a server restart; never rebuild the distribution directory while the server is serving it.
Before `npm run dist`, confirm no installed app or service runs from `apps/desktop/release`
(`sc qc wa-team-inbox`, `/api/health`); otherwise build with `-- --config.directories.output=<new folder>`.
GitHub Actions in this org must be pinned to full commit SHAs.
