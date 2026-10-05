# Learnings

Lessons from building and running WA Team Inbox, so agents (and humans) don't repeat mistakes.
Append new entries at the top of the matching section: `- YYYY-MM-DD — what happened → root cause → rule`.
A Stop hook (`.claude/hooks/learnings-gate.mjs`) blocks a code-changing session from finishing until this
file is updated. Promote anything that changes _how_ to work into CLAUDE.md.

## Internationalization

- 2026-10-05 — The desktop status window reset its update card every 5 s → static `[data-i18n]` text
  was re-applied on every status poll, overwriting runtime text → apply static strings once per
  locale, then re-render the dynamic parts.
- 2026-10-05 — The language picker could show a language whose catalogs failed to load → the store
  committed before loading → switch the snapshot and persist only after `activateLocale` resolves.
- 2026-10-05 — Date tests failed the day after they were written → `formatListTime(ts, now)` used
  `isYesterday()`, which reads the real clock → helpers that take `now` must compare against it
  (`isSameDay(d, subDays(now, 1))`).
- 2026-10-04 — SonarCloud failed the PR on duplication and "hard-coded password" → Prettier expanded
  a data table into identical multi-line blocks, per-locale TS catalogs are structurally duplicate,
  and keys named `password` with non-English values look like credentials → keep data tables as
  one-line tuples, keep catalogs in JSON, and avoid `password`/`pwd` in translation key names.
- 2026-10-04 — Translated screens can overflow at phone width while English e2e stays green →
  specs pin `en-US` → also run `SMOKE_LOCALE=ms node e2e/screens.smoke.mjs` (Malay is the longest)
  after UI text changes and look at the screenshots.
- 2026-10-04 — A `<Trans>` link lost its text → `<link>` is a void HTML element and the parser drops
  its children → name `<Trans>` component tags after non-void elements (`<a>`, `<b>`).
- 2026-10-04 — Desktop i18n could not import `@wa-team-inbox/shared` at runtime → desktop main is
  tsc output run by Electron, while shared ships TS source plus zod → desktop imports only types from
  shared and mirrors tiny runtime helpers, guarded by parity tests (or bundle main first).
- 2026-10-04 — Running Prettier on whole folders reformatted untouched files → the repo is not
  Prettier-clean (102 files differ) → run `prettier --write` only on files you changed.
- 2026-10-04 — Typed i18next keys rejected `t('common:x')` from `useTranslation()` → a prefixed key
  only type-checks for namespaces passed to the hook → use `useTranslation(['inbox', 'common'])`
  for cross-namespace keys; plain `t('x')` for the default `common` namespace.
- 2026-10-04 — New web tests leaked open menus between cases and `toHaveTextContent` was undefined →
  Vitest runs without globals (no RTL auto-cleanup) and jest-dom is not installed → call `cleanup()`
  in `afterEach` and assert on `textContent`.

## Cloudflare and sharing

- 2026-10-04 — Token-configured named tunnels with unknown hostnames enabled a global Host wildcard → direct requests could bypass DNS-rebinding defenses → scope unknown hosts to validated loopback proxy traffic and use the same policy for HTTP and Socket.IO.

- 2026-10-03 — Startup restoration replaced an instance's shutdown method and ran outside the admin
  operation gate → origin reconciliation could race a new setup request → own restoration in the
  service, use the same tracked operation gate and wait for it before shutdown completes.
- 2026-10-03 — Interactive cloudflared login ignores `--origincert` and writes to the process home →
  an ordinary child would reuse or overwrite the user's Cloudflare certificate → isolate child HOME,
  USERPROFILE, PATH and working directory, keep credentials encrypted and clean only verified app-owned paths.
- 2026-10-03 — Cloudflare login can grant DNS access only to the chosen zone without zone-list permission →
  fetching every domain is not guaranteed → fall back to the approved zone and offer fresh domain approval.
- 2026-10-03 — A failed DNS step can leave a newly created tunnel in Cloudflare → blindly retrying creates
  duplicates → persist app-owned IDs first, retry only those IDs and never replace foreign DNS or tunnel configuration.
- 2026-10-03 — A controlled domain Select initially mounted empty could submit no domain → its form
  initialization changed the value → derive a valid authorised selection and test default and alternate submissions.
- 2026-10-03 — Sharing an inbox URL would advertise a private installation rather than the free app →
  the active origin contains team access details → share only the public project URL and user-selected marketing text.
- 2026-10-03 — Native sharing cancellation can return a DOMException from another realm → checking
  `instanceof Error` misses AbortError → check its name and cancel quietly without copying or claiming a post.

## Maintainability and performance

- 2026-10-05 — Merging language support into the AI feature introduced two migration files
  numbered 002 and untranslated AI controls → independent branches changed the same database
  version and UI conventions → preserve main's published migration number, renumber the new
  feature migration, test an upgrade from main, and integrate feature strings with every locale.

- 2026-10-05 — Switching from an explicit API model to ChatGPT saved an incompatible model
  and caused every answer to hand off → provider-specific validation happened only during
  generation → reset the model when switching providers and validate the shared connection
  contract before saving or cancelling active work; share the supported model list with runtime.

- 2026-10-05 — AI member edits and OAuth polling can overwrite inbox-wide connection settings
  or unsaved drafts → provider and member fields share a combined status but require separate
  write schemas; keep drafts local while polling connection status.
- 2026-10-05 — A human takeover can happen after AI generation or while a reply waits for
  presence/queue spacing → cancellation alone is insufficient → abort work, invalidate queued
  replies and recheck ownership and the latest customer message immediately before sending.
- 2026-10-05 — Codex shell/apply-patch flags alone leave metadata-selected tools and a local
  image handler → customer prompts could reach app files → pin and verify the helper protocol,
  enforce an authoritative text-only tool-free catalog, deny tool/approval requests, isolate
  its home and use the operating system credential store.
- 2026-10-05 — Document parsers can consume CPU or expand archives far beyond upload size →
  upload limits alone do not protect the inbox → cap expansion/text and parse in a worker with
  a deadline and memory limits.
- 2026-10-05 — Review reproduced stale AI answers during media downloads and AI pausing on its
  own early WhatsApp echo → asynchronous completion differs from message arrival and committed
  sender provenance → notify automation on live receipt before downloading and correlate echoes
  through completed send reconciliation; keep regression tests for both orderings.

- 2026-10-05 — A daily inbox reset affects all teammates and more chats than a paginated list
  contains → bulk resolution must be admin-only, transactional, confirmed, and publish events
  only after commit; preserve messages and the existing reopen-on-incoming behavior.
- 2026-10-05 — Independent review reproduced a committed reset with a failed audit and hundreds
  of canceled count requests → audit writes belong in the reset transaction; coalesce realtime
  refreshes after bulk updates while replacing any stale in-flight response.
- 2026-10-05 — PR review found message and chat events scheduling separate list refreshes for
  the same incoming message → route both through the same refresh scheduler and test the pair.

- 2026-10-03 — One live update rendered every loaded chat row and repeated pagination restarted
  requests → stable chat references had no memo boundary and fetchNextPage cancelled overlapping
  fetches by default → measure row/request counts, keep context updates working and coalesce next-page fetches.
- 2026-10-03 — Normal server close retained process error and signal listeners → cleanup covered
  failed startup only → remove each instance's handlers on normal close and test repeated close.
- 2026-10-03 — Desktop buttons disabled only after renderer status updates → tray actions and
  simultaneous requests could overlap service/data changes → acquire one main-process gate before
  confirmation and retain it through recovery.
- 2026-10-03 — Missing system Node emitted a spawn error without an exit event → the supervisor
  retained its child and kept polling → handle PID-less spawn failure through the same guarded
  termination path and reject stale exit/health results from earlier children.
- 2026-10-03 — Settings hydrated local form fields on every query-data change → background refresh
  overwrote unsaved edits → derive untouched defaults from the query and retain explicit field drafts.
- 2026-10-03 — Immutable caching existed but public text assets were served uncompressed → requests
  still transferred the entire bundle → generate gzip/Brotli at build time, negotiate with the
  existing static plugin, and verify Vary, validators and uncompressed fallback without compressing
  private APIs or caching HTML/service workers indefinitely.

## WhatsApp / Baileys

- 2026-10-03 — Business contacts had saved names while the inbox showed numeric IDs → contact names arrived under phone JIDs, conversations used LIDs, and contacts could arrive before chats → preserve explicit identity aliases, recover only existing local signal mappings on reconnect, apply stored names during chat creation, and backfill existing names without relinking or probing the contact list over the network.
- 2026-10-03 — No QR ever appeared: WhatsApp closed the socket (428 "Connection Terminated") ~200 ms after
  "attempting registration", 42× in a row → the socket identified as `Browsers.appropriate('Desktop')`;
  WhatsApp rejects "Desktop" identities → use `Browsers.ubuntu('Chrome')` (`WA_BROWSER` in
  `packages/wa/src/baileys/adapter.ts`). Verified isolated on baileys rc13 and rc14. **Rule: never change the
  browser identity without a live QR check; it is pinned by a unit test.**
- 2026-10-03 — Fake-adapter tests were all green while real linking was broken → no test exercised real
  WhatsApp. **Rule: any change to `packages/wa/src/baileys/**` needs a live smoke (`scratchpad` repro script or
  test server + pairing code) before claiming it works; say "untested against real WhatsApp" otherwise.**
- 2026-10-03 — Phone-number pairing code works (`requestPairingCode`) once the socket has offered a QR; after
  entering the code WhatsApp sends 515 "restart required" — that is normal, reconnect immediately.
- 2026-10-03 — Server crashed during first history import: eager download of every history media file from the
  CDN; a network blip (`ENOTFOUND a.whatsapp.net`, `ECONNRESET`) escaped as an uncaught exception from undici
  and `onUncaught` exited the process → don't download history media eagerly; rate-limit live downloads;
  treat transient network errors as non-fatal. Default history import is 3 days.
- Reconnect backoff must reset when the server responds (QR received), otherwise retries drift to ~60 s and the
  UI looks frozen.

- 2026-10-03 — History audio sent from the user's phone showed "Uploading…" forever → on-demand media logic
  excluded `fromMe` messages, which fell through to the app-upload spinner → **decide by id (`local-` = app
  upload in progress), never by sender; test media states for both inbound and phone-sent (`fromMe`) messages.**

## Desktop / web UI

- 2026-10-03 — A desktop window may connect to an independently managed inbox server → desktop presence does not imply update ownership → gate release checks, prompts and download actions on standalone ownership or the app's installed local service, with exact main-frame IPC trust and no renderer-supplied URLs.
- 2026-10-03 — GitHub's latest-release endpoint excludes previews and publication order can differ from version order → early 0.x releases would be missed or misordered → list published releases, compare strict semantic versions, label previews and select exact platform/architecture assets.
- 2026-10-03 — Member cards repeated every desktop column label and put actions on a separate row → a generic table-to-card conversion wasted vertical space → allow feature-specific mobile rows, group related metadata, and retain 44px action targets while checking long names at 360px.
- 2026-10-03 — Mobile pages had no horizontal overflow but landscape forms lost their actions and tablet tables hid columns → dialogs had no viewport height limit and table overflow was hidden → check dialog bounds and inner clipping as well as page overflow; cap dialog height with dynamic viewport units, permit scrolling, and retain cards until tables have room.
- 2026-10-03 — A 44px wrapper around the LAN switch still left only the small switch clickable → decorative padding is not a hit target → use an associated padded label and test padding clicks and keyboard operation without saving automatically.
- 2026-10-03 — Long member names were clipped inside mobile drawer titles although page overflow remained zero → unbroken strings escaped the title box → allow arbitrary word wrapping in shared dialog titles and verify title scroll width.
- 2026-10-03 — Contact photos disappeared after restarting the desktop app → the inbox requested avatars before WhatsApp connected, then permanently retained image errors → gate photo requests on WhatsApp readiness and reset failed attempts with a shared connection generation; test initial startup and later reconnects.
- 2026-10-03 — Feature suggestions had no dedicated in-app action → general issue/custom-service links hid the contribution path → expose the repository feature-request template to every role with explicit external navigation and no user data in URLs.
- 2026-10-03 — Desktop notification registration failed with `AbortError: Registration failed - push service not available` in an isolated Electron reproduction → exposed PushManager APIs did not imply an available push service → use native notifications through a narrow origin-checked preload bridge and authenticated recipient-targeted live events; retain browser push for PWA clients.
- 2026-10-03 — An empty composer showed native scrollbar arrows → autosizing omitted border height from a border-box textarea → include borders, hide overflow until the maximum height, and verify empty, multiline and long drafts.
- 2026-10-03 — Rebuilding web assets while the isolated test server was serving that directory produced a blank page → `wildcard:false` static routes enumerate files at startup, so new bundle filenames received the SPA HTML fallback → activate complete builds with a server restart; do not rebuild an actively served distribution directory.

- 2026-10-03 — UI stress testing exposed hidden admin access, an ambiguous status toggle and unsearchable lists → controls assumed familiarity and small datasets → make common destinations and both states visible, search growing lists, and test empty-result recovery at 360px with long names and text.
- 2026-10-03 — OS-only dark CSS ignored manual appearance choices → token and Tailwind dark selectors used different theme sources → resolve one device preference into `data-theme` and apply it to both tokens and dark variants; test persistence and OS changes.
- 2026-10-03 — Avatar rendering existed but no image source was supplied → profile lookup was never connected to the chat contract → expose an authenticated on-demand image route with bounded deduplicated caching and initials fallback. Native lazy images avoid Radix's eager preloader fetching every chat at once.
- 2026-10-03 — The Quick Tunnel showed Running but its public URL returned 404 → cloudflared auto-loaded an unrelated user ingress config whose catch-all returned 404 → pass explicit `--config=` for app-managed tunnels, wait for edge registration, and log the local origin and readiness milestones without secrets.

- 2026-10-03 — Admin menu clicks rendered blank pages and appended `/members` repeatedly → relative menu
  links and fallback redirects under `/admin/*` resolved against the current splat path → anchor shell
  navigation and fallbacks to `/admin/...`; test every section-to-section transition and malformed URL recovery.
  Unmatched admin routes now report structured browser errors to the server log.

- 2026-10-03 — Spent several rounds guessing why Quick replies / Tunnel render blank in the live app (cache?
  Electron? push API?) — every guess was disproved by tests on a fake server → the browser had no error
  reporting, so the evidence never reached any log. Added `POST /api/client-errors` + global handlers + a
  per-route React `ErrorBoundary` (structured `mod:"web"` pino entries with stack + componentStack).
  **Rule (from the user): don't guess — check the logs; if the failure isn't logged, add structured logging
  first, reproduce, then read the log.**
- 2026-10-03 — "Claude in Chrome" showed an error page for `127.0.0.1:7420` → the only connected extension was
  a macOS browser, not the Windows machine running the app (Windows Chrome was signed into another account).
  **Run `list_connected_browsers` before browser testing; localhost only works on the same machine.**

- 2026-10-03 — Tunnel page blank in the live app but fine in a fresh browser, and the server log showed no
  `/api/tunnel` request → the Electron window kept serving an older build's JS from the PWA service worker
  cache → the desktop app now clears service workers + Cache Storage when the web build changes
  (`clearWebCacheOnVersionChange`). **When a screen breaks only in the app window, suspect the SW cache first;
  F12 opens DevTools, Ctrl+Shift+R hard-reloads.**
- 2026-10-03 — Screen regressions are caught fastest by `node e2e/screens.smoke.mjs <url> <outDir>` (every
  screen, desktop + mobile, page errors / console errors / blank / overflow + screenshots) against a `--fake-wa`
  server on a temp data dir. Use it instead of the full e2e for "does every screen render?".

## Build / tooling (Windows)

- 2026-10-03 — A GUI smoke harness supplied as an argument to a packaged executable launched its normal entry, and a top-level wait for Electron readiness stalled a separate harness → packaged apps ignore replacement entry arguments and readiness depends on main-module evaluation → use plain Electron with an explicit temporary profile, schedule setup with whenReady().then, and import the packaged modules/preloads being verified.
- 2026-10-03 — A valid iPhone browser sign-in failed only in the combined suite → parallel browser projects shared the loopback login quota and hit a genuine HTTP 429 → let the test sign-in helper honor the server's Retry-After and extend only its cooldown budget; never weaken production authentication limits to make browser tests pass.
- 2026-10-03 — A deployed routing fix still displayed v0.1.0 → the build was replaced without a version
  bump → bump the root version for deployed fixes, sync workspace and lockfile versions, and verify both
  `/api/health` and the visible app version before handing over a patched build.

- 2026-10-03 — `node -e "..."` scripts break under PowerShell quoting (`*` treated as a command) → write the
  script to a file in the scratchpad and run it.
- 2026-10-03 — Playwright's bundled Chromium can be missing and `npx playwright install` may fail → smoke
  scripts fall back to `chromium.launch({ channel: 'chrome' })`.
- 2026-10-03 — Grepping only the log tail missed the evidence (history sync writes huge lines) → search the
  whole log file(s) before concluding "no request was made".

- 2026-10-03 — Vitest spent ~86% of run time re-transforming TS → `experimental.fsModuleCache` in
  `vitest.config.ts`. Run only the affected package's tests while iterating.
- 2026-10-03 — Git Bash commands on this Windows machine can take >120 s under load (agents running) → prefer
  PowerShell / Grep / Read tools; run long jobs in the background.
- 2026-10-03 — The full Playwright e2e run was killed for low system memory when run next to other agents →
  run e2e alone, or in CI.
- 2026-10-03 — Case-insensitive filesystem: shadcn's `button.tsx` collides with a legacy `Button.tsx` → move the
  old file first (`components/legacy/`).
- 2026-10-03 — TypeScript 6 deprecates `baseUrl`; `paths` works without it.
- 2026-10-03 — Packaged app: `@node-rs/argon2`'s JS loader must be asar-unpacked with its `.node`; esbuild picked
  the wrong `ws` build (`wsEngine is not a constructor`) → plugin in `scripts/bundle-server.mjs`. Always smoke the
  packaged exe with `ELECTRON_RUN_AS_NODE=1` against a temp data dir.

## GitHub / CI

- 2026-10-03 — Every CI run was `startup_failure` (0 s): the ossmalaysia org requires actions pinned to full
  commit SHAs and allows only selected actions → pin `uses:` to SHAs (`# vN` comment). Check
  `gh api orgs/ossmalaysia/actions/permissions` before adding a new action.

## Multi-agent process

- 2026-10-03 — Rules lived only in CLAUDE.md, so Codex (which reads AGENTS.md) couldn't follow them →
  AGENTS.md is now the single source of truth and CLAUDE.md imports it (`@AGENTS.md`). **Edit rules in AGENTS.md.**
- 2026-10-03 — Duplicate-chat investigation agent was still exploring after ~1 h with no change; user stopped it.
  Its partial diff is not in the repo. Next attempt: do it directly, evidence first (DB rows + log), small steps.

- 2026-10-03 — Subagents took 1.8–4.9 h each for tasks estimated at 30–60 min, while the orchestrator fixed the
  QR bug end-to-end in ~40 min → each subagent re-read spec/plan/code, re-ran full suites/e2e, and 3+ agents
  fought for CPU on one Windows box. **Rules (from the user): small changes are done directly, not in subagents;
  subagents run only their own unit tests + package typecheck; exactly one consolidated e2e/full-suite run at the
  end.** See CLAUDE.md "Multi-agent rules".

- 2026-10-03 — The first build took ~22 h: 9 sequential waves (each waits for its slowest agent) plus a full
  integrator pass after every wave, and one fixer serially handling ~15 findings → use fewer, wider waves; split
  findings across agents; one integration pass at the end; give agents a time budget and a narrow file
  ownership list.
- 2026-10-03 — Parallel agents in one working tree work if file ownership is disjoint and only the orchestrator
  commits; tell agents not to `npm install` unless they own the package.json being changed.
- 2026-10-03 — Stale data from an agent's test run (admin account, `server.lock`) blocked the user's first-run
  setup → agents must use temp data dirs (`--data <scratchpad>`), never the real app data folder.
- 2026-10-03 — Successful Cloudflare provisioning still showed the creation wizard and duplicate reconnect actions → saved configuration and live tunnel state were presented independently → collapse saved setup into an address summary, compare the running hostname, and require explicit edits or reconnects only when needed.
- 2026-10-03 — Admin footer labels wrapped awkwardly and credits mixed navigation with support → the shared inline credits layout did not fit a narrow sidebar → use a stacked sidebar variant, preserve accessible device-specific notification names, and scroll the whole menu on short screens.
- 2026-10-03 — A generated icon contained unwanted transparent holes and the legacy exporter assumed a white glyph → image alpha and artwork-specific transforms could corrupt the new mark → inspect opaque PNG/ICO frames at small sizes, preserve generated artwork during exports, and publish the same checked-in assets to desktop and PWA.
- 2026-10-03 — Inbox account sign-out was available only from the inbox account menu, leaving admin screens without a visible logout action → shell navigation omitted session controls → expose account logout in the shared desktop/mobile admin footer using the existing session-revocation and cache-cleanup flow, and verify it does not disconnect shared WhatsApp.
- 2026-10-03 — A message reached the server while a newly opened inbox kept an older list → the initial HTTP query could finish before the first socket joined its rooms, and only reconnects refreshed queries → resynchronize active queries on every socket connection and test changes arriving before the first connection as well as during later outages.
- 2026-10-03 — A Mac runner packaged both architectures despite `--arm64` → electron-builder merges architecture flags with configured target architectures, while npm installs native dependencies for the runner architecture → select an explicit target such as `--mac dmg:arm64`, upload only that architecture, and smoke SQLite, password hashing, login and logout on a matching native runner before publishing.
- 2026-10-04 — Renaming Electron productName changes default profiles and executable paths → existing accounts can appear missing and installed services can lose their binary → pin installed userData/sessionData before the instance lock and retain Windows executable, service and app IDs while renaming visible branding and installers.
- 2026-10-04 — Official brand artwork encoded its white mark as transparent cutouts → direct exports lose the mark on dark or opaque green surfaces → inspect exported icons on light and dark backgrounds, preserve the original and render intended cutouts consistently for app formats.
- 2026-10-04 — Renaming a GitHub repository redirects old URLs and keeps historical installer names → strict update checks can fail or miss older assets → switch the API to the canonical repo and validate both historical and current asset names against an explicit repo allowlist.
- 2026-10-04 — Packaging rebuilt web assets while the fake-WA browser run was still serving them → removed asset hashes produced 404 pages and misleading UI timeouts → finish browser verification before packaging, and never rebuild a served web distribution, including isolated test servers.

- 2026-10-04 — Argon2 verification and hashing yield while credentials and permissions can change → in-flight requests could bypass recovery or finish after revocation → recheck current credentials, authorizing sessions and roles immediately before a synchronous security-sensitive commit.
- 2026-10-04 — Desktop controls accepted any file URL → unrelated local documents or child frames could obtain host privileges → bind IPC to the current registered window, exact main frame and bundled file URL.
- 2026-10-04 — A protected Windows service wrapper could launch an app from an ordinary user's writable directory → replacing runtime files could execute code as SYSTEM → validate Program Files runtime ownership, write permissions, links and ancestors before elevated install, start or recovery.
- 2026-10-04 — WhatsApp history download keys appeared in structured logs → upstream diagnostics included credential fields and raw support ZIPs retained old copies → redact known credential fields in live logging and recursively sanitize historical exports without rewriting the user's logs.
- 2026-10-04 — Temporary-password generation fell back to Math.random when browser crypto was unavailable → convenience produced guessable credentials → require Web Crypto for generation and keep manual strong-password entry available.
- 2026-10-04 — macOS copied a service runtime with ditto then restricted owner and POSIX mode → explicit source ACLs could still grant ordinary-user writes → omit copied ACLs, clear runtime ACLs and reject privileged operations without a packaged root-owned runtime.
- 2026-10-04 — Service update instructions treated Windows and Mac the same and persisted WATI_VERSION at installation → Mac kept its old protected runtime while Windows could report stale build metadata → document Mac service recreation and derive the reported version from the runtime being launched.
- 2026-10-04 — Browser release links do not establish installer integrity and cached files can change after download → an update could execute substituted bytes → require trusted GitHub SHA-256 and size metadata, stream into private staging, restrict every redirect, and rehash immediately before handoff.
- 2026-10-04 — Electron and an installed service can hold the old runtime open, while Mac services use a separate protected copy → replacing only the desktop can leave an old service running → prepare outside Electron, require explicit handoff, stop the host, replace every runtime, and verify the restarted service reports the selected version.
- 2026-10-04 — Elevation may use a different administrator account and writable profiles are unsafe privileged output paths → an update helper could reopen under the wrong user or write through user-controlled links → let an unelevated broker record results and reopen the desktop; keep elevated staging outside both app and inbox data directories.
- 2026-10-04 — Browser stress tests captured the persistent update toast outside the viewport and later detached → an imperative transient notice could hide the only review action → render durable update suggestions declaratively, respect dismissal per version, and verify review/restart controls at desktop and phone widths.
- 2026-10-04 — Native PowerShell security checks exceeded Vitest's default five-second limit under consolidated load → OS process startup was mistaken for a security failure → bound the child process separately and give native integration tests enough startup time without extending pure unit-test timeouts.
- 2026-10-04 — Required external approval blocked the repository's only maintainer from merging → GitHub authors cannot approve their own pull requests → require PRs, passing CI and resolved conversations with zero mandatory approvals for a solo maintainer; restore required approval when another reviewer is available.
- 2026-10-04 — A grouped dependency PR upgraded TypeScript beyond the ESLint peer range and Node types beyond the supported runtime → automated version updates do not establish compatibility → inspect peer and engine constraints, verify SHA-pinned workflow releases, and merge only with fresh checks against main.
- 2026-10-04 — A local full-suite run timed out two native PowerShell subprocesses while the same tests passed on GitHub runners → concurrent test startup saturated this development machine → verify native timeout failures separately with one worker before changing security assertions or increasing timeouts.
- 2026-10-04 — A graphify build wanted one subagent per image (24 here, mostly resized copies of one icon) → its default chunking ignores this repo's two-parallel-subagent limit → run graphify's AST pass locally and batch docs and images into at most two extraction agents; keep `graphify-out/` gitignored.
- 2026-10-04 — A graph-guided security pass found the public `/api/client-errors` limiter keeping one entry per client IP forever → per-IP maps on unauthenticated routes were never pruned, and one IPv6 prefix supplies endless addresses → every per-key limiter or cache reachable without a session must expire stale entries and enforce a hard size cap, with a test that rotates through many keys.
- 2026-10-04 — CLAUDE.md showed 63 uncommitted lines nobody on the task wrote → the context-mode plugin appends its routing block to project CLAUDE.md at session start → stage files explicitly, never `git add -A`, and leave plugin-injected CLAUDE.md changes out of commits.
- 2026-10-04 — Syncing a Dependabot branch with `git reset --hard` discarded an uncommitted CLAUDE.md change → hard reset is not scoped to the branch being fixed → `git stash` (or a worktree) before switching to update another branch; never hard-reset a working tree with changes you did not make.
- 2026-10-04 — A green PR for an `action-gh-release` major bump proved nothing about releases → PR CI never runs `release.yml` → for actions used only in release workflows, read the major-version breaking changes against our inputs before merging.
- 2026-10-04 — `git show origin/<branch>:<path>` failed in Git Bash → MSYS rewrote the `ref:path` argument as a Windows path → prefix such git commands with `MSYS_NO_PATHCONV=1` (or use PowerShell).
- 2026-10-04 — jsdom 30 failed a Composer autosize test (44px vs 46px) → the fixture set border widths without a border style, and per CSS `none` computes to 0 (jsdom 29 ignored this) → style fixtures must mirror Tailwind preflight (`border-style: solid`) before asserting computed border sizes.
- 2026-10-04 — A config PR was immediately BEHIND main → it was branched from a local main that had not pulled the latest merges → always branch from a freshly fetched `origin/main`.
- 2026-10-04 — The "who is handling this customer" chip already existed but never showed → nobody assigned chats by hand, so every row was unassigned → before building a new indicator for existing data, check the live data for why the current one is empty; prefer making the data appear (assign on reply) over adding UI.
- 2026-10-04 — Push diagnosis on a service install stalled: `C:\ProgramData\wa-team-inbox` is SYSTEM-only, and a first log extract read rotated files newest-first so it showed stale lines → service data needs an elevated, read-only extract (no message text) and entries must be merged across files and sorted by time; the DB (`push_subscriptions`, `sessions`, `chats`) answers routing questions that logs cannot.
- 2026-10-04 — `npm run dist` for a local update deleted most of `apps/desktop/release/win-unpacked` while the installed service was running from it (only the locked `app.asar` survived), so the live service could no longer restart → the 0.1.13 service had been installed from the unpacked dev build, and the build cleans its default output folder → before any desktop build, check where running instances execute from (`/api/health`, `sc qc wa-team-inbox`, locked files); build updates with `-- --config.directories.output=<new folder>`; services must run only from a Program Files install.
- 2026-10-04 — Re-pointing the 0.1.13 service at Program Files by editing its WinSW XML crash-looped with `Cannot find module 'C:\Program'` → the old XML's arguments were unquoted (its paths had no spaces) → never hand-patch service XML; regenerate it with the installed version's `serviceCommand` + `winswXml` (which quote arguments), start through `windowsControlScript` so the protected-runtime check runs, and read `service\logs\*.err.log` before retrying.
- 2026-10-04 — The 0.1.17 bump with `sed 's/"version": "0.1.16"/…/'` also rewrote two `@radix-ui/*` packages that are at 0.1.16 → a blanket text replace cannot tell workspace entries from dependencies → bump only the root and workspace entries (`npm pkg set` + `version:sync`, then edit `packages[""]` and the workspace paths), and check the lockfile diff touches exactly those entries.
- 2026-10-04 — Generated scripts lost path backslashes (`C:ProgramData…`) and a heredoc edit failed to match `'\n'` → the shell layer collapses `\` inside Bash heredocs → write files containing Windows paths or escapes with the Write/Edit tools (or `String.raw`), and grep generated output for the expected paths before running it elevated.
- 2026-10-04 — PR #14 was BLOCKED with every check green → an automated reviewer's unresolved thread counts toward required conversation resolution → when a PR is BLOCKED, list unresolved review threads, fix valid findings with tests, reply and resolve.
- 2026-10-05 — The v0.1.17 tag build ended in `startup_failure` with no jobs → the org Actions allowlist pins `softprops/action-gh-release` to one SHA, and the Dependabot bump (#1) changed it; PR CI never runs `release.yml`, so nothing caught it → when merging an action bump used only by release workflows, check `gh api orgs/ossmalaysia/actions/permissions/selected-actions` and update the allowlist to the verified SHA in the same change.
- 2026-10-05 — Moving the service host from `WA Team Inbox` to `EzyChat Lite` could not use the in-app updater → an update is executed by the already-installed version, whose checks only knew the old name → plan renames of install paths or executables as a one-time manual step, and script it as one elevated run: verify the release SHA-256, stop the service, close the app, `installer /S /allusers /D=<new dir>` (one string argument, `/D` last), regenerate the service XML with the new version's code, start through `windowsControlScript`, check `/api/health`.
- 2026-10-05 — Publishing 0.1.18 for the in-app update test: no new lessons beyond the allowlist and cross-rename migration entries above.
- 2026-10-05 — After the rename to `EzyChat Lite.exe` the tray icon "disappeared" → Windows 11 keys tray visibility (`HKCU\Control Panel\NotifyIconSettings`, `IsPromoted`) to the exe path, so a new path starts hidden in the overflow → after any exe/path rename, tell users to re-pin the tray icon and check that key before debugging tray code.
- 2026-10-05 — In-app updates to 0.1.18 and 0.1.19 installed but left no `install-result.json`, never relaunched and kept the downloaded installer → `powershell.exe` spawned with Node `detached: true` exits 0 before running a line (Win11 26200; event log had no engine start for the broker), and a non-detached child dies with the app; the unit test ran the broker with `execFileSync`, so the real launch path was never exercised → launch Windows background scripts through a short-lived `powershell -Command Start-Process …`, wait for its exit code, and test the real launcher end to end (assert the script's side effect), not the script alone.
- 2026-10-05 — Answering "what have you changed": no new lessons; the updater and tray entries above cover this run.
- 2026-10-05 — After a Windows restart the desktop window stayed on "service not running" until the owner restarted the service → the window logged in 25 s before the delayed auto-start service ran, waited only when the service was already `running`, and never re-probed → a desktop error page that depends on a background service must keep probing and recover by itself; treat a stopped auto-start service shortly after boot as "starting".
- 2026-10-05 — Radix RadioGroup selects on arrow keys inside a requestAnimationFrame only while the key is still held, so a plain userEvent `{ArrowRight}` never fires onValueChange → test with `{ArrowRight>}`, waitFor, then `{/ArrowRight}`; and writing a file from Python on Windows needs `PYTHONUTF8=1` or the open('w') truncates it before the encode error.
- 2026-10-05 — The LID/PN merge spec was drafted before #19 (i18n) landed on `main` → a design written against an older checkout can miss new cross-cutting systems (UI strings now need EN/MS/zh-CN) → before planning from a spec, `git fetch` and re-verify its paths and conventions against current `main`.
- 2026-10-05 — Planning the chat merge found `runBackup` (`VACUUM INTO`) would be called from alias learning that runs inside `db.transaction` → SQLite refuses `VACUUM` in a transaction → never trigger backups or other non-transactional SQLite statements from code reachable inside `db.transaction`; learn/merge outside it and guard with `db.inTransaction`.
- 2026-10-05 — `main` gained two large features (#18 AI agent, #19 i18n) while the merge plan was written, taking migration 003 and adding per-chat AI state → plans in a busy repo go stale within hours → re-fetch `main` right before executing a plan; any change that moves or deletes a `chats` row must also cover every table keyed by `chat_jid` (e.g. `ai_chat_state`) and in-memory per-chat state (timers, in-flight replies).
- 2026-10-05 — The first chat-merge plan merged chats live (socket events, queue rekey, AI timer moves) and grew to 12 tasks; the owner asked for "merge during migration, future follows new rules" → live data reshaping multiplies concurrency cases → reshape existing data once at startup before any service runs, and make runtime code route/resolve only.
- 2026-10-05 — Baileys rc14 stores PN↔LID pairs as `wa-auth/lid-mapping-<pnUser>.json` (→ `"<lidUser>"`) and `lid-mapping-<lidUser>_reverse.json` (→ `"<pnUser>"`) → they can be read offline with `node:fs` before the socket connects → use that for startup migrations instead of waiting for runtime events.
- 2026-10-05 — `git worktree remove --force` on a worktree whose `node_modules` were junctions into the main checkout deleted packages there (`@vitejs/plugin-react` vanished; `npm install` did not notice, `npm ci` fixed it) → Git follows Windows junctions when deleting → before removing a worktree, delete its junctions with `[IO.Directory]::Delete(path, $false)`, verify `LinkType`, then remove; prefer `npm ci` in a new worktree over junctions.
