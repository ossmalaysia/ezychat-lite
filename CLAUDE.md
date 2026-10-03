# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WA Team Inbox: an Electron desktop app (macOS/Windows) that links one WhatsApp number through
Baileys and serves a shared team-inbox PWA locally, over LAN, or through a Cloudflare tunnel.
npm-workspaces monorepo: `packages/{shared,wa,server}`, `apps/{web,desktop}`, all named
`@wa-team-inbox/*`. Node 22+, TypeScript strict, ESM.

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
npm start -w @wa-team-inbox/desktop           # build web + bundle server + tsc + launch Electron
npm run dist -w @wa-team-inbox/desktop        # fetch cloudflared/WinSW, build, electron-builder (run on Windows for NSIS, on macOS for dmg)
npx tsx packages/server/src/cli.ts --data ./data/x --reset-admin       # print a new password for the first admin
```

Installers land in `apps/desktop/release/`. `dist` targets the host OS only (no cross-building).

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

**Server CLI** (`packages/server/src/cli.ts`, `config.ts`): `--data <dir>` (required, or `WATI_DATA`),
`--port` (default 7420, else the persisted `port` setting), `--host` (default from the `lan_enabled`
setting: `127.0.0.1` or `0.0.0.0`), `--mode standalone|service|dev`, `--fake-wa`, `--web-dist <dir>`,
`--reset-admin`. Exit 3 = data dir locked by another server. `--fake-wa` is flag-only (never env) and
rejected in service mode.

**WhatsApp boundary.** `packages/wa` defines the `WaAdapter` interface. Only
`packages/wa/src/baileys/**` may import `baileys`; the server loads it lazily. `FakeWaAdapter` is used
by tests and `--fake-wa`; with it, `POST /api/dev/fake-incoming` simulates inbound messages (waits until
ingested, so e2e can assert immediately). The route is not registered otherwise.

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
plus a lock file.

**Native modules.** `better-sqlite3` and `@node-rs/argon2` are Node-API prebuilds: tests run them on
the system Node ABI, the packaged app loads the same binaries under Electron (`npmRebuild: false`).
Do not run `electron-rebuild` on the workspace; it breaks `npm test`. If `desktop start` fails to load
a native module in dev, set `WATI_DESKTOP_RUNTIME=node` to run the server with system Node.

## Security invariants (do not break; each has tests)

- First-admin setup (`routes/setup.ts`) only while no user exists, only from a direct loopback peer
  with a loopback `Host`, and never through the tunnel.
- `CF-Connecting-IP` is trusted only when the socket peer is loopback (`http/client-ip.ts`); it keys
  rate limits and decides `Secure` cookies.
- Every request passes the Host allowlist (`http/host.ts`, DNS-rebinding defence: loopback, IP
  literals, single-label/`.local`, current tunnel hostnames). Mutating `/api` requests need
  `Origin` host == `Host` (`http/origin.ts`); Socket.IO checks Origin too.
- Media (`routes/media.ts`) renders inline only for an allowlist of raster/audio/video types;
  everything else is an attachment, served with a `sandbox` CSP and `nosniff`.
- Session tokens are stored as SHA-256 hashes; passwords use argon2; login lockout after 5 failures.
- Admin password reset only via the CLI `--reset-admin` or the tray menu, never over HTTP.
- Push endpoints are restricted to known push-service hosts (SSRF guard).

## UI rules (apps/web)

See `docs/design-system.md` ("Calm Desk"). Primitives are shadcn/ui in
`apps/web/src/components/ui`; app composites in `components/app`; `components/legacy` is being
removed, so do not add to it or import from it in new code. Feature code must not use raw
`<button>`/`<dialog>`/`<select>` or Tailwind palette/hex colours; use token classes
(`bg-primary`, `text-muted-foreground`). Every screen must work at 360px without horizontal scroll.

## Learnings loop (required)

- Read `docs/LEARNINGS.md` before starting work; it records past mistakes (e.g. Baileys browser identity, Windows
  tooling, CI SHA pinning, multi-agent pacing).
- Before finishing any run that changed code, append dated lessons there (problem → root cause → rule). A Stop
  hook (`.claude/hooks/learnings-gate.mjs`) blocks the turn until you do. Promote rules that change how to work
  into this file.
- Changes under `packages/wa/src/baileys/**` must be smoke-tested against real WhatsApp before claiming they work.
- Agents never use the real app data folder; always `--data <temp dir>`.
- **Debug from evidence, not guesses:** read the server log (`<data>/logs/*.log`, structured pino JSON; web
  errors are `mod:"web"`, "client error") before proposing a cause. If the failure isn't in any log, add
  structured logging (pino child logger with `mod`, fields not string concatenation) first, reproduce, then read it.

## Multi-agent rules (required)

- **Small changes are done directly, not in a subagent.** A subagent costs 20–40 min of startup (re-reading
  spec/plan/code) and its tests compete for CPU on this machine. Use subagents only for large, independent work
  (≈ a day of work for a person), at most 2 in parallel on Windows.
- **Subagents run only the unit tests for the files they changed** (`npx vitest run <paths>`) plus the typecheck of
  the package they touched. **No e2e and no full-repo test suite inside subagents.**
- **One consolidated verification step at the end** (one integration/e2e agent, or the orchestrator) runs
  `npm run typecheck`, `npm test`, `npm run lint`, web build and `npm run e2e` once — and nothing else runs e2e.
- Parallel subagents need disjoint file-ownership lists; only the orchestrator commits.

## Conventions

Conventional Commits; LF line endings; Prettier formatting; add user-visible changes to
`CHANGELOG.md` under `[Unreleased]`. Never commit `data/`, `.e2e-data/`, `wa-auth`, databases or secrets.
