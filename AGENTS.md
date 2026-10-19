# AGENTS.md

Instructions for every AI coding agent working in this repository (Codex, Claude Code, Cursor, …).
This file is the single source of truth; `CLAUDE.md` imports it. Edit rules **here**.

EzyChat Lite: an Electron desktop app (macOS/Windows) that links one WhatsApp number through
Baileys and serves a shared team-inbox PWA locally, over LAN, or through a Cloudflare tunnel.
npm-workspaces monorepo: `packages/{shared,wa,server}`, `apps/{web,desktop}`, all named
`@ezychat/*`. Node 22+, TypeScript strict, ESM. Main dev machine is Windows 11.

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
npm test -w @ezychat/server                   # one workspace
npm run lint                                  # ESLint
npm run typecheck                             # tsc --noEmit in each workspace + e2e/
npm run e2e                                   # Playwright: builds web, starts server --fake-wa on :7499 with .e2e-data
node e2e/screens.smoke.mjs <url> <outDir>     # every screen (desktop+mobile): page errors, blank, overflow, screenshots
node e2e/electron-screens.smoke.mjs <url> <outDir>  # same, inside a real Electron window
npm run e2e:electron-links                    # every screen in the REAL desktop window: each external link opens in the OS (Windows)
node e2e/marketing-screenshots.mjs <port> docs/screenshots  # demo-data screenshot library (docs/screenshots/README.md)
npm start -w @ezychat/desktop                 # build web + bundle server + tsc + launch Electron
npm run dist -w @ezychat/desktop              # fetch cloudflared/WinSW, build, electron-builder (host OS only)
npm run build:core                            # dist builds of shared/wa/server + the web library (apps/web/dist-lib)
npm run pack:core                             # @ezychat/* tarballs in .core-packs/ for local Enterprise development
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
Voice notes: the composer records Ogg/Opus in the browser (`lib/voice-recorder.ts`, opus-recorder's
WebAssembly encoder); `POST /chats/:jid/media` with `voiceNote=1` checks it is Ogg/Opus of at most 5 min
(`messages/voice-note.ts`, length counted from Opus packets) and sends it with `ptt: true`, length and a
waveform built from packet sizes (`messages.voice_note`; nothing is decoded on the request thread).
One person can arrive under a phone-number JID and a LID: chats are keyed by the LID once known
(`chats/aliases.ts`, table `jid_aliases`). Existing duplicates are merged only by the startup identity
migration (`chats/identity-migration.ts`, run by `initMessaging` before the message service, AI, HTTP
and `wa.connect()`; pairs read offline by `readStoredLidMappings`; pre-merge backup first). Runtime code
never merges: `AliasStore.route` picks the existing chat of either JID, routes resolve `:jid` through
`chatJidParam`, and replies go to the `wa_remote_jid` of the last inbound message. Never merge on a
name or number match.

**AI Sales Agent.** Code in `packages/server/src/ai/`: `service.ts` decides when the one AI member
claims, answers, hands off or resolves a chat; `prompt.ts` builds the single prompt used by live replies
and `POST /api/ai/try` (admin-only, no chat side effects); `POST /api/ai/edit` (admin-only, Edit with AI:
`ai/edit-prompt.ts` + `ai/agent/rewrite.ts`) only suggests a rewrite of one box — the page applies it to its
draft and its Save persists it; its log line holds field, ok, ms and model only — never the request,
the current text or the suggestion; closing the popup aborts the request and the model call; `resolution.ts` is the resolution guard;
`knowledge.ts` selects knowledge. Provider modes: API key (public OpenAI Responses API) or ChatGPT
(EXPERIMENTAL: direct PKCE sign-in, `chatgpt-oauth.ts` + `chatgpt-backend.ts` + `chatgpt-direct.ts`, tokens
only in the encrypted `ai_chatgpt_direct_tokens` setting; no Codex binary is bundled; protocol and sources in
`docs/ai-chatgpt-protocol.md`). A data dir with no saved connection defaults to ChatGPT mode
(`ai/settings-keys.ts`; an older save without a mode or a stored key stays API key); the default never signs
in, and the AI member stays off until an admin turns it on. `POST /api/ai/connection/test` (admin-only,
rate-limited, `ai/key-test.ts`) checks a key with `GET /v1/models` and never stores or logs it; only
`invalid_key` (401) blocks saving. Both modes run one agent turn on the Vercel AI SDK
(`ai/agent/turn.ts`: tools, structured decision with actions answer / ask_resolution / resolve / handoff / `no_reply` (empty reply, nothing sent, the AI keeps the chat), ≤ 4 steps, no transport retries but a malformed decision is asked once more; failures are `AgentTurnFailure` with `kind`, `causeName`, `status` for the `AI answer unavailable` log line; models in `ai/agent/models.ts`,
which keep `store:false` + encrypted reasoning and pass only our fixed error messages). Read tools are
built per chat in `ai/agent/tools.ts`, take no chat/person arguments, and are offered only when useful
(`search_business_context` above the 40,000-character budget, `get_older_messages` when the chat is
longer than the prompt). Rule for new data: push what is small and needed in most replies (customer
details, current situation); add a tool only for data that is large or rarely needed (each call costs
a model round trip). A rejected refresh sets `expired` and a blocked backend sets `error`; in both
the AI stops claiming and releases its chats without messaging customers. Knowledge = Business context items
(table `ai_context_items`: uploaded files and text, up to 20); everything is sent while it fits
`AI_FULL_CONTEXT_CHARACTERS` (40,000), above that a CJK-aware selection picks chunks (no vector search).
Prompt layout for caching: static instructions, then input JSON in fixed order `businessKnowledge` →
`conversation` → `currentSituation` last (date/time in `ai_timezone`, default Asia/Kuala_Lumpur; resolution
awaited; `customer` = the team's saved name, company, email, other phone and address via `aiCustomer`,
never tags, none in Try it); never put per-call or team-editable values earlier. A reply generated with
customer details that changed meanwhile is dropped and regenerated. `prompt_cache_key` is derived from the random `ai_install_id`
and the model, never from customer data. Resolution guard: only a free-text confirmation closes a chat;
questions, objections and new requests keep it open; the AI then asks "Does that answer your question?".
Order and delivery questions keep the chat with the AI. Web: `admin/AiConnectionSection.tsx` (Settings → AI),
`admin/AiMemberPage.tsx` + `AiContextPanel.tsx` (`/admin/members/ai`), `admin/AiQuickConnect.tsx` (connect
card shared by the Sales Agent page and the setup wizard's AI assistant step: Account → WhatsApp → AI
assistant → Ready, `setup/SetupWizard.tsx` + `AiAssistantStep.tsx`). **Tests and e2e never call OpenAI or
ChatGPT**: use mock providers; `e2e/ai-member.spec.ts` saves a placeholder key and only exercises states
that need no model call (Try it with empty context hands off locally).

**Events.** `wa-bridge` maps adapter events into services (ingest, status acks, chat/contact upserts).
Services emit on the typed in-process `Bus` (`bus.ts`); `realtime/socket.ts` fans out to Socket.IO
rooms (`all`, `admins`, `user:<id>`; QR codes and tunnel status go to `admins` only) and
`push/service.ts` sends notifications for `inbound:notify` and committed `ai:handoff` events to the
human assignee (or every active human user if unassigned). Connected recipients receive
`notification:new`; offline recipients receive web push. Handover is distinct from the earlier inbound
message, which may have arrived while the AI owned the chat.

**Customer profiles.** `packages/server/src/customers/`: one profile per direct chat
(`customer_profiles`, `customer_tags`), edited by any teammate, audited by changed field names only.
Profiles have a stable `id` (kept across merges) and no foreign key to `chats` (user data never
cascades). `rowToChat` prefers the profile name and adds `tags`/`whatsappName`; its rows come only
from `ChatRepo.get`/`list` (profile join + one batched tag query; SQL in `customers/sql.ts`). Every
outbound Message goes through the message service's `present()` (group `senderProfile` via
`AliasStore.route()`). `mergeChat` must move every table keyed by `chat_jid` (profiles via
`customers/merge.ts`). When the AI reads profiles, put them in `currentSituation`/`conversation`,
never earlier in the prompt.

**Customer enrichment.** `customers/enrichment.ts` uses the shared AI connection independently of
Sales Agent ownership. It is off by default and processes only live direct-chat text, with bounded
bursts and concurrency. `ai/agent/extract-customer.ts` is one structured call without tools/retries.
Accepted values require explicit self-ownership, an exact quote in a new message, profile syntax,
current evidence and per-field thresholds (add 90, replace 95). Cancel on staff edits, newer live
arrivals, setting/connection changes and shutdown; compare the profile again immediately before the
atomic profile/audit commit, and ensure the JID still routes to that same chat after an alias change.
Audit stores scores, field names and message references, never values
or raw evidence. Tests and the mock-AI Dev Build runner never call outside providers.

**Group info.** `packages/server/src/groups/service.ts` + `routes/groups.ts`: `GET /chats/:jid/members`
reads `WaAdapter.getGroupInfo` (Baileys `groupMetadata`) with a 5-minute cache invalidated by the
`groupChanged` event, names members from contacts and existing chats only (never inferred), and links
existing direct chats via `AliasStore.route`. About (`getAbout`) and member photos are fetched per person
on request; `POST …/members/:member/chat` creates an empty direct chat (audited) and never sends. Dev:
`POST /api/dev/fake-group` (fake WA only) builds a group with generated members.

**Contract.** zod schemas in `packages/shared` define every REST body/response and socket payload.
Change the schema first; server and web both import it.

**Editions and extensions** (design: `docs/superpowers/specs/2026-10-15-open-core-editions-design.md`;
engineer guide with examples: `docs/editions-engineer-guide.md`).
Lite is the open core; other editions add features through extension points and never patch core code.
_Server_: `runCli(argv, env, { edition, extensions })` (`run-cli.ts`; Lite's `cli.ts` passes no product, i.e.
edition `lite` with no extensions) takes `ServerExtension`s (`extensions.ts`): a name (`/api/ext/<name>` prefix,
`lite`/`core` reserved), an optional `migrationsDir` tracked per extension in `extension_migrations`
(never touches the core `user_version`), `init(ctx)` after every core initializer, and `routes` mounted
after core routes (add `requireUser`/`requireAdmin` yourself; Host/Origin checks still apply).
`agentTools(ctx, { agent: 'sales', chatJid | null, signal })` (`ai/agent/extension-tools.ts`) adds AI SDK
tools to one Sales Agent turn (live and Try it). They share `AGENT_MAX_STEPS` and the turn's abort/timeout,
and `dispose` runs in `finally`. `hasAgentLookups(ctx, { agent })` (sync, no network) tells the core that look-ups are available: the empty-Business-context hand-over (live, Try it) and the "add business context before turning on" check then let the agent run, and the prompt counts look-up results as facts. Core tool names are reserved and the first extension wins a duplicate name.
A tool that throws (`ToolHandoverError` or any other error) aborts the turn and hands over with
`lookup_failed`. Every call emits `ai:tool_call` {agent, chatJid, tool, source, title, ok, ms} and logs
tool/source/ok/ms only. Each successful live look-up stores an `ai_tool_used` chat event
{title, sourceLabel} (the "AI looked up …" line). `tryAgentReply` and `tunnelPublicUrls` are public. `ctx.access` (`access/gate.ts`, `http/access.ts`) lets an edition close an access gate with a code: every `/api` and `/mcp` call then answers 403 `{ error: code }` except `GET /api/health`, `GET /api/access` and host-only routes; sessions are deleted, Socket.IO refuses, the AI member, enrichment, send queue (no expiry while closed), tunnel and push pause, and WhatsApp keeps storing messages. Lite never closes it. Routes under `/api/ext/<name>/host/` are host-only (direct loopback peer + loopback Host + no `CF-Connecting-IP`, no session, open while closed).
`/api/health` reports `edition`; its `app` value stays `wa-team-inbox`. _Web_:
`createInboxApp({ extensions, productName })` (`apps/web/src/create-app.tsx`; Lite's `main.tsx` passes `[]`;
catalog strings name the app only through `{{product}}`, default "EzyChat Lite", except the share-the-app texts) takes
`WebExtension`s (`src/extensions/types.ts`, `validateWebExtensions`): routes only at `/ext/<name>/…`
(signed-in) or `/admin/ext/<name>/…` (admin shell and guard), admin nav links (absolute paths),
Settings → Integrations sections, and catalogs whose keys start with `ext.<name>.` (read with
`useExtensionTranslation`), `agentSections` (rows under Business context on the agent page), route
`section` (an agent sub-page marks a core admin item active and names it in the phone header) and
adminNav `useBadge` (a count, or an attention dot in the warning tone); `banners` (one slim bar slot, first non-null wins), `lockScreen` (full page while the gate is closed; core `PausedScreen` otherwise), `createInboxApp({ links })` + `useAppLinks()` (About/issue/source/release/feedback/support links; `null` hides one) and brand files exported as `@ezychat/web/public/*`; every extension element is
wrapped in an `ErrorBoundary`. _Desktop_:
identity lives in `apps/desktop/src/product.ts`; `LITE_PRODUCT` holds the upgrade-contract values
(app ID, data/profile folders, service ID, launchd label, health `app`, update feed, installer and exe
names), pinned by `product.test.ts` against `electron-builder.yml`/`package.json`. `defineProduct` also takes `statusSections` (declarative cards in the desktop status window, actions handled in main, only `https:`/`mailto:` opened) and `updateFeed: { kind: 'url' }` (JSON manifest, for private editions) and `defaultPort` (a new install's
port; an edition installed next to Lite needs its own, Lite keeps 7420). Desktop catalogs name the app only
through `{{product}}` (`t()` fills in the active productName). Code reads
`activeProduct()`, never literals; another edition calls `startDesktop(defineProduct({…}))` from
`@ezychat/desktop` (`src/index.ts`; sets the product, then dynamic-imports main; Lite's Electron entry stays
`dist/main.js`). Files the shell ships (server host, preloads, status page in `dist/renderer`) are found from
the package folder (`dirname(<compiled main>)`), never `app.getAppPath()`; the edition's app provides the
layout (`dist/server/server.cjs`, `dist/package.json`, `resources/{web,tray,cloudflared,winsw}`,
`resources/app-icon.png`). `apps/desktop/scripts/build.mjs` builds it (tsc + renderer copy; keeps the server
bundle); the cloudflared/WinSW fetch scripts live in `apps/desktop/scripts/` (`--out <resources>`, also bins). The desktop adopts a running server only when health `app` and `edition ?? 'lite'`
match. _Packages_: shared/wa/server export `dist/` (`scripts/build-package.mjs`), `@ezychat/web` exports
`dist-lib/` (`vite.lib.config.ts` + `scripts/build-web-lib.mjs`: ESM, dependencies external, one
precompiled CSS with font files); inside the monorepo imports resolve to `src/` through the
`ezychat-source` export condition (tsconfig `customConditions`, Vite/Vitest `resolve.conditions`, esbuild,
`.npmrc` node-options, each package's `vitest.config.ts`); a plain `node`/`tsx` run outside npm needs
`--conditions=ezychat-source`. `scripts/pack-contract.test.mjs` pins the tarball contents and
`.github/workflows/publish-packages.yml` publishes on `v*` tags (npm trusted publishing via GitHub OIDC; dry run until the repo variable `NPM_TRUSTED_PUBLISHING` is `true`; a package not yet on npm is skipped with a warning: its first version is published by hand). Enterprise
(`anchorsprint/ezychat-enterprise`) consumes pinned published `@ezychat/*` versions, never a
git submodule or a committed `file:` dependency; to try an unreleased core it installs `npm run pack:core`
tarballs (`scripts/use-local-core.mjs` there), so never break `pack:core`. Lite never imports Enterprise
code. Only each package's `index` exports are public API; anything else is internal and may change.

**Send queue** (`messages/send-queue.ts`): FIFO per chat, chats in parallel, ≥1s between sends in a
chat, `composing` presence before each send. Jobs wait while disconnected and fail as `expired` after
10 min; `wa_unavailable` errors keep the job pending. Pending jobs are persisted and restored on start.

**Data dir:** `app.db` (SQLite, migrations in `db/migrations`), `wa-auth/` (Baileys creds),
`media/`, `secret.key` (AES key for settings secrets such as the tunnel token), `logs/` (pino-roll,
daily, 14 kept), `backups/` (`VACUUM INTO app-YYYYMMDD.db` + `wa-auth-YYYYMMDD/`, nightly, 7 kept),
`models/whisper-small/` (optional voice model, downloaded on demand; see `docs/ai-sales-agent.md`),
plus a lock file. Tests never download the real model or call OpenAI. Live app data on Windows: `%APPDATA%\WA Team Inbox\data`.
The Windows program is `EzyChat Lite.exe` in `Program Files\EzyChat Lite` since 0.1.17 (the updater
still accepts the legacy `WA Team Inbox.exe`). The data folders, desktop profile, service ID and app ID
are intentional upgrade contracts; do not rename them when changing visible branding. Workspaces are published to npm as `@ezychat/*`
(shared, wa, server, web, desktop); the desktop package ships the shell, never the server bundle.

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
- CSP `script-src` is `'self' 'wasm-unsafe-eval'` only (WebAssembly for the voice note encoder; never
  `'unsafe-eval'` or inline scripts). The desktop window grants `media` only for audio from the inbox
  main frame (`inboxPermissionAllowed`), never the camera.
- AI assistant access (MCP: `/mcp`, `mcp/route.ts`) is off by default, answers only direct loopback or the
  tunnel, and accepts only a personal access token (`ezc_pat_…`, SHA-256 hashed, owner rechecked as
  an active admin on every call). `/api` never accepts a token, so a token cannot manage tokens.
  Inbox tools get only `InboxReadPort` (reads) and return media metadata, never links. AI setup
  tools (scope `ai:setup`, every admin token) go only through `AiSetupPort` (`mcp/ai-setup.ts`): they
  may change the AI instructions, hand-off rules and Business context **text** items, never files,
  the connection, key, model or on/off. Every change keeps a version (`ai_setup_versions`, app saves
  too) and an audit row with token id and reason, and is rate-limited per token. Tools log tool name,
  counts and token id, never arguments or message text.
- Host-only extension routes (`/api/ext/<name>/host/…`) answer only a direct loopback peer with a
  loopback `Host` and no `CF-Connecting-IP`; the access gate allowlist matches the decoded path and the
  matched route, never a raw prefix alone.
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
- A change that adds a native module or worker (e.g. voice transcription) must be smoke-tested end to
  end in a `--dir` packaged build before release: `ELECTRON_RUN_AS_NODE=1`, a temp data dir and
  `--fake-wa`, exercising the feature itself, not only server start-up.
- After a base PR is squash-merged, replay only your own commits with
  `git rebase --onto origin/main <old-base>` and typecheck even when the rebase is clean. Never chain
  `git add` or `rebase --continue` after edits that may have failed: search for conflict markers first.
- Run only the unit tests for files you changed (`npx vitest run <paths>`) plus the typecheck of the
  package you touched. **Don't run e2e or the full suite** unless you are the single, final
  verification step.
- **Contracts are tested against the real server, never only against a fake `fetch`** (owner rule):
  `packages/server/test/web-client-contract.test.ts` checks every `api()`/`fetch('/api…')` call in
  `apps/web/src` (method + path, read with the TypeScript checker) against the real route table; keep
  paths literal, constant or a string-literal union so it can read them. A new kind of client (desktop
  section, edition package) gets the same test or an end-to-end test against `makeTestApp`.
- **Every change that touches a screen gets one round of the mock e2e before it is reported done**
  (owner rule): `apps/web`, the desktop shell (`apps/desktop`: windows, tray, dialogs, status page) or a
  web/desktop contract. One round = `npm run e2e` (browser, fake WhatsApp, mock AI) and, on Windows,
  `npm run e2e:electron-links` (every screen in the real desktop window). The main agent (or the single
  agent working alone) runs it once at the end, after all edits; subagents still never run e2e.
- On Windows prefer PowerShell; write multi-line scripts to a file instead of `node -e "…"`.
- **Dev Build check log.** Read `docs/dev-build-checks.md` before testing a feature in a Dev Build and
  add one row per check (scenario, exact steps, result, what stays untested). AI behaviour checks use
  `e2e/devbuild-ai-check.mjs` and real model calls only with the owner's sign-in and agreement. Code
  changes after a check (e.g. review fixes) mean re-running the affected checks on the final commit.
- **Run the Dev Build check yourself before saying a feature works.** Unit tests, e2e and a screen
  review are not enough: run the feature end to end in a Dev Build (and with the real outside client
  where one exists, e.g. an MCP client), log it, and only then report it as working. Until then say
  "built and tested, not yet checked in a Dev Build".
- **Complete feature HTML mock before production UI code.** Every feature that requires UI keeps a
  reviewable, interactive HTML mock at `docs/features/<feature>/mock/index.html`, with local assets
  and run instructions, inside the current project repository. Commit this feature folder as the
  durable reference for the next agent; do not leave the canonical mock in an external prototype
  folder or only in an ignored scratch directory. Keep its scope, screen/state checklist and confirmation record in
  `docs/features/<feature>/design.md`; link these from the feature workbook. Do this proactively,
  before implementation, rather than adding screens only when the owner asks where they are.
  Mocks are cumulative interactive app references, not disconnected feature demos. For every
  enhancement, clone the latest owner-confirmed mock from `docs/features/mock-index.json` into
  the new feature folder, preserve its existing app flows, and add the enhancement there. Record
  the source feature/path and exact git revision in `design.md`; never replace the last confirmed
  baseline with an unconfirmed proposal. If no confirmed baseline exists, bootstrap it from the
  current app's actual frontend source, not a hand-recreated shell, and record coverage gaps
  before asking for confirmation. Freeze source hashes; in enhancements list the intentional
  changed/added files and verify that the rest of the reference has not drifted.
  After the owner confirms a complete mock, record the confirmation and update the index so the
  next agent clones that revision. The interactive scope includes the app context, navigation,
  feature entry points and end-to-end simulated feature behaviour; a screenshot or isolated
  popup is not a complete reference. Keep mock data and effects separate from the real app.
  **Retention: keep only the five most recently created feature folders** under `docs/features/`.
  Record creation order/date in the mock index; when adding a sixth, remove the oldest committed
  feature folder and update the index in the same reviewable change. Verify the target belongs to
  `docs/features/` and has no unrelated uncommitted work before cleanup. Older references remain
  available in git history; record each baseline's exact revision/path before removing its folder.
  If the latest confirmed baseline was pruned, recover that revision from git into the new feature
  mock rather than starting over or treating an unconfirmed proposal as approved. The root index
  and workflow README are not feature folders. Cleanup never authorizes automatic merging.
  Inspect related existing features first and record the source screens/components and behaviours
  being reused in `design.md`. Ground the mock in the current app, its real routes, navigation,
  configuration, save/error patterns, permissions and translations; extend existing flows rather
  than inventing a disconnected screen or redesigning unrelated features.
  Cover the whole feature journey: entry points, Settings/configuration, primary screens, dialogs,
  audit/history where relevant, and the important enabled/disabled, unavailable, empty, error and
  long-content states. Use demo data, the existing design system and actual navigation labels;
  verify desktop 1280 px and mobile 360 px. Show the runnable mock and screenshots to the owner
  and record their confirmation before production UI implementation. The confirmed HTML mock is
  the implementation and screen-review reference; material scope/UI changes update that mock
  and need confirmation again. Generated images may supplement it, but never replace the HTML
  reference. Keep the mock and confirmation record with the feature in git, not only in ignored
  scratch folders or chat attachments.
- **Screen review for every UI change.** Before a feature that changes screens is done:
  1. Capture each affected screen at desktop 1280 px and mobile 360 px, in light and dark where relevant,
     and in every state: empty, filled, editing, error and long text.
  2. Run a UI/UX product-designer review against `docs/design-system.md`, the shadcn components and
     usability/accessibility practice. Check hierarchy, spacing, labels, touch targets, focus and
     consistency with neighbouring screens.
  3. Fix the findings with tests: e2e plus `screens.smoke.mjs`. Then re-capture the screens and compare
     before/after pairs: design fixes can introduce new problems.
  4. Refresh `docs/screenshots/`.
  5. Show the desktop and mobile screenshots to the owner.

## Multi-agent rules (orchestrators)

- **Small changes are done directly, not in a subagent** (startup costs 20–40 min; tests compete for CPU).
  Use subagents only for large, independent work. Use the Workflow tool for large multi-part work
  with as many parallel agents as the work allows; agents never run e2e, the full suite, a UI/UX screen
  review or a full screenshot run (`screens.smoke`, mock walkthroughs); the main agent runs the
  consolidated verification and the screen review once, after all dev agents are done.
- Subagents get disjoint file-ownership lists; only the orchestrator commits.
- **Feature workbook.** Every feature branch keeps `docs/workbooks/<branch>.md` (stages Design, Dev,
  Unit tests, E2E, Dev Build, Screen review + a log). Each agent records its stage as it finishes with
  `node scripts/build-summary.mjs record <stage> <status> "<detail>"` and commits the workbook with the
  work; the owner's feature summary (`/feature-summary` or plain English; `node scripts/build-summary.mjs`, skill `feature-summary`) reads it
  together with the live PR checks.
- **One consolidated verification at the end** runs `npm run typecheck`, `npm test`, `npm run lint`,
  web build and `npm run e2e` once — nothing else runs e2e.

## Learnings loop (required)

`docs/LEARNINGS.md` is a compact, topic-grouped list of rules. Before finishing a run that changed code,
add any real, re-usable lesson as one short rule bullet in the matching section, or sharpen an existing
bullet; no dated stories or filler (history stays in git). Lessons specific to EzyChat Enterprise go to that
repo's own `docs/LEARNINGS.md`. If a lesson changes how agents must work,
update the rule in this file. (Claude Code prompts for this with a Stop hook; other agents must do it
themselves.)

## Conventions

Conventional Commits; LF line endings; Prettier formatting; add user-visible changes to
`CHANGELOG.md` under `[Unreleased]`. When a UI change ships, refresh that module's shots in
`docs/screenshots/` (demo data only). Never commit `data/`, `.e2e-data/`, `wa-auth`, databases or secrets.
After repository setup, `main` is protected: use feature branches and reviewable pull requests.
**Merge only when the owner explicitly requests merging that PR.** Never merge automatically or
enable auto-merge. Requests to fix, implement, commit, push or open a PR do not authorize merging;
passing checks and resolved reviews do not authorize it either. Finish the work and report readiness,
then leave the PR open until the owner requests the merge.
This is currently a solo-maintainer repository, so a second maintainer's approval is not required;
the owner's explicit merge request is still required.
Never bypass its CI or conversation-resolution requirements for routine changes. Restore a required
approval when another maintainer can review changes.
Before deploying a changed build, bump the root package version, run `npm run version:sync`, sync the
lockfile, and verify that `/api/health` and the UI identify the deployed version. Activate the complete
build with a server restart; never rebuild the distribution directory while the server is serving it.
Before `npm run dist`, confirm no installed app or service runs from `apps/desktop/release`
(`sc qc wa-team-inbox`, `/api/health`); otherwise build with `-- --config.directories.output=<new folder>`.
GitHub Actions in this org must be pinned to full commit SHAs. Private repositories (e.g. the Enterprise repo)
run CI only on the org's self-hosted runners (`runs-on: [self-hosted, Linux, ARM64]`), never GitHub-hosted ones.
