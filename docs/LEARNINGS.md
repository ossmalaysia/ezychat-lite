# Learnings

Lessons from building and running WA Team Inbox, so agents (and humans) don't repeat mistakes.
Append new entries at the top of the matching section: `- YYYY-MM-DD — what happened → root cause → rule`.
A Stop hook (`.claude/hooks/learnings-gate.mjs`) blocks a code-changing session from finishing until this
file is updated. Promote anything that changes _how_ to work into CLAUDE.md.

## Cloudflare and sharing

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

## WhatsApp / Baileys

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
