# Learnings

Rules learned from building and running EzyChat Lite, so agents (and humans) don't repeat mistakes.
This file is a compact summary; the dated incident history lives in git (`git log -p docs/LEARNINGS.md`).

**Adding a lesson:** add one short rule bullet to the matching section (`rule — why`), or sharpen an
existing bullet instead of adding a near-duplicate. A Stop hook (`.claude/hooks/learnings-gate.mjs`)
blocks a code-changing session until this file changes. Promote anything that changes _how_ agents work
into AGENTS.md.

## Working method

- Console output meant for the owner (and pasted into chat) fits ~80 columns: wider tables wrap and
  become unreadable; put long names on their own lines and keep one short line per item. Lead with
  the decision (ready / needs you) but never hide the evidence: show every checkpoint, even when green.
- A project skill (`.claude/skills/<name>/`) is a slash command only in checkouts that contain it:
  on a feature branch it is not live in the owner's main checkout until merged — say so.
- Progress the owner asks about comes from committed records (the feature workbook, the Dev Build
  log), never from an agent's memory of the session: record each stage when it finishes, mark
  stages that do not apply as `skip` with the reason (MCP-only: no design, screen review or UI e2e),
  and show `build-summary.mjs <PR>` in every "done / ready to merge" report, not prose.
- Run the Dev Build check yourself, unasked, before calling a feature working: green unit/e2e tests
  with a test client missed whether a real client works end to end (MCP access was nearly reported
  done without Claude Code ever connecting). Check scripts confirm the effect (audit row, empty
  list, a 401), never "nothing left to click": a list counted before it loads reads as success.
  Time-based features (peaks, waits, trends) need Dev Build data spread over days with a planted
  pattern; the demo data is seeded within minutes, so it cannot show the feature working.
- A new test must be seen failing for the right reason: timing thresholds pass on a fast machine
  (test the observable fallback instead), and vitest does not type-check, so a not-yet-exported
  constant yields `undefined`/`NaN` and a vacuous pass — assert the inputs are what you meant.
- Before designing a change, grep `AGENTS.md` for the subsystem's terms (e.g. "profile", "prompt"):
  recent features leave placement rules in the architecture paragraphs, not only in Working rules.
- Before production UI work, commit a complete interactive HTML mock in `docs/features/<feature>/mock/`
  and a screen/state checklist plus owner confirmation in `design.md`; include Settings and entry
  points, not only the final screen. Verify 1280/360 px with worst-case demo data and use the confirmed
  mock as the implementation reference. Inspect related existing features and record their source
  screens/components and reused behaviours in `design.md`; copy actual labels from `i18n/locales/en`
  so the mock stays grounded in the app. Images and ignored scratch files alone are not a durable reference.
- Feature mocks evolve cumulatively: clone the latest owner-confirmed interactive app mock from
  `docs/features/mock-index.json`, preserve existing flows, record the source revision, and advance
  the baseline only after the owner confirms the complete enhancement; an unconfirmed demo is not
  a baseline for the next feature.
- Bootstrap replicas from actual frontend source and check frozen hashes; allowlist enhancement
  deltas so redesigned existing screens cannot silently become the next reference. Normalize text
  hashes to LF so Git checkout line endings do not look like UI drift.
- Keep only the five newest feature mock folders in the working tree; prune older clean, committed
  folders in the next feature change and retain exact revision/path references so confirmed
  baselines can be recovered from git history without inventing approval.
- Debug from evidence: read the server log (whole files, merged across rotations and sorted by time) and
  the DB before proposing a cause; if the failure isn't logged, add structured logging first, reproduce,
  then read it. Browser errors reach the log through `/api/client-errors` and route `ErrorBoundary`s.
- When a screen breaks only in the app window, suspect the PWA service-worker cache first (F12,
  Ctrl+Shift+R).
- Before building UI for existing data, check the live data for why the current UI is empty; prefer making
  the data appear over adding UI.
- Re-fetch `main` and re-verify paths and conventions right before planning or executing a plan; plans in
  this repo go stale within hours.
- Reshape existing data once at startup, before any service runs; runtime code only routes and resolves.
- Evals and tests must assert the business outcome (chat handed to the team, order not lost), not only the
  agent's words.
- When fixing await-in-loop findings, preserve dependent scenario order with explicit awaited calls
  and keep polling deadline-bounded; parallel execution can invalidate assignment checks.
- Mocks cannot prove provider-side behaviour (prompt caching, headers): confirm with one live call on a
  Dev Build (never customer data), then pin the stable value in a unit test.
- A feature that reacts to inbound media must ship with a way to simulate that media on `--fake-wa`
  (`/api/dev/fake-incoming` `media`), or the owner cannot test it end to end on a Dev Build.
- Record protocol facts from the package that really implements them, with the source file; never copy
  tokens from local caches.

## Multi-agent process

- AGENTS.md is the single source of truth (CLAUDE.md imports it); edit rules there.
- Small changes are done directly. Large multi-part work runs through the Workflow tool with as many
  parallel agents as the work allows, with disjoint file ownership and a time budget; only the
  orchestrator commits; agents don't `npm install` unless they own that package.json.
- Subagents run only their own unit tests and package typecheck; one consolidated
  typecheck/test/lint/build/e2e run at the end. Prefer few wide waves and one integration pass.
- Agents use temp data dirs (`--data <scratchpad>`), never the real app data folder.
- Tools that fan out per file (e.g. graphify) must be batched, not one agent per file.
- Research on another repo starts with `git fetch` and searches `origin/<default>` (a local checkout can
  be hundreds of commits behind); never report "X does not exist" without naming the ref searched.
- Run Prettier on the files you changed, never on a whole folder: parts of the tree are not
  Prettier-clean on `main`, so a folder run rewrites files another agent or nobody owns.
- Workflow/subagents start in the session's primary checkout: when work lives in another worktree, give
  its absolute path and require `cd <worktree> && …` for every command, plus disjoint file ownership.
- A parallel agent can test against a sibling component another agent has not written yet with
  `vi.mock('<path>', () => ({ … }))` (a factory), so its tests run before the real file lands.

## Git, GitHub and CI

- Exclude frozen feature-mock source copies from application static analysis; otherwise cumulative
  references inflate duplication and re-report old application findings as new code. Keep production,
  tests and tooling in scope and fix their findings before releasing.

- Merge only on the owner's explicit request for that PR; never enable auto-merge. A green quality
  gate can still have open Sonar findings: inspect review comments and findings on the final commit
  before reporting readiness, and leave the PR open until the owner requests merging.
- CI runs `npm run build:core` before `npm test`: otherwise the pack contract test builds every core
  package mid-suite and starves slow Windows runners into timeouts. A test that is ~0.4 s on `main` and
  times out on a branch is a branch regression (load, not flakiness): compare per-test times first.
- Push a Lite API change before the Enterprise commit that uses it: Enterprise CI builds the Lite branch
  as pushed at that moment (`LITE_REF`), so the reverse order fails its typecheck.
- Private repositories (e.g. `anchorsprint/ezychat-enterprise`) run CI only on the org's self-hosted
  runners (`[self-hosted, Linux, ARM64]`), never GitHub-hosted machines.
- Hotfixes for the released version go in a separate worktree from `origin/main` with its own
  `npm install` (`git worktree add ../wm-hotfix -b fix/<bug> origin/main`): `main` uses `@wa-team-inbox/*`
  workspace names until the `@ezychat/*` rename merges, so one `node_modules` cannot serve both branches.
- Branch from a freshly fetched `origin/main`. Stage files explicitly (never `git add -A`); leave the
  plugin-injected CLAUDE.md block out of commits.
- A red check on a release (version-only) PR: read `gh run view --log-failed`, compare with `main`'s run
  on the same code, then `gh run rerun <id> --failed`; fix the flaky test in its own PR. A mac DMG job
  failing with `hdiutil: couldn't eject … Resource busy` is a runner glitch: re-run that job, it adds
  the missing installer to the draft release before you publish.
- `/code-review` with no target reviews the session's checkout, not a feature worktree: pass the
  branch or path (e.g. `/code-review feat/x`) when the work lives in another worktree.
- Never hard-reset a working tree with changes you didn't make; stash or use a worktree.
- Before removing a worktree, delete its `node_modules` junctions with `[IO.Directory]::Delete(path, $false)`
  (Git follows junctions); prefer `npm ci` in new worktrees.
- Append-only files (`LEARNINGS.md`, `CHANGELOG.md`, fixtures) conflict on every parallel branch: keep both
  sides, never `--ours`/`--theirs`, then check CHANGELOG headings for duplicates. Bring a long PR branch
  up to date by merging `main` into it (one resolution, squash-merged later) rather than rebasing every
  commit. After a base PR is squash-merged, replay only your own commits
  (`git rebase --onto origin/main <old base>`); a clean rebase still needs a typecheck (semantic
  conflicts), and never chain `git add`/`rebase --continue` after edits that may have failed — grep for
  conflict markers first.
- After merging `main` into the rename branch, `git grep -l "@wa-team-inbox/" -- apps packages e2e scripts`
  (not `grep -r | head`, which shows ignored release folders first): new files from `main` keep old imports.
- Publish `@ezychat/*` with npm trusted publishing (GitHub OIDC, `id-token: write`), not an `NPM_TOKEN`:
  2FA-bypass tokens lost account/package management in July 2026 and lose direct publishing around
  January 2027.
- Core packages pin sibling `@ezychat/*` deps to the exact version: after merging a version bump from
  `main`, run `npm run version:sync` before `npm install --package-lock-only`, or npm looks the old
  version up on the registry (404).
- After merging `main` (and before a release), check `CHANGELOG.md` `[Unreleased]` for duplicate
  `###` headings: two branches adding the same section merge cleanly into two copies.
- Migration numbers collide across parallel branches: keep `main`'s published numbers, renumber the
  unmerged branch, and test upgrades from both orders.
- Org Actions must be pinned to full SHAs and allowlisted (`gh api orgs/ossmalaysia/actions/permissions`).
  PR CI never runs `release.yml`: for actions used only there, read the breaking changes and update the
  allowlist SHA in the same change.
- CI does not run e2e: a change to routes or landing URLs must run e2e locally and update
  `e2e/responsive.spec.ts` in the same PR.
- A BLOCKED PR with green checks usually has an unresolved review thread: fix, reply, resolve. The
  Codex review lands minutes after each push: check threads before calling a PR ready.
  A clean Codex pass arrives as an issue comment ("Didn't find any major issues"), not a review or
  reaction: watch PR comments too. Its summary comment is edited in place and says "Running" until
  done: wait for its status, not for the comment to exist.
- Right after a push, `gh pr checks --watch` can see no checks yet and exit 1 ("no checks reported"):
  wait on the run instead (`gh run list --branch <b> --limit 1`, then `gh run watch <id>`).
- SonarCloud's reliability gate fails on `.map(namedFn)` (write `.map((x) => fn(x))`) and on regexes
  over user input with overlapping quantified classes (e.g. `[^@]+\.[^@]+`): keep classes disjoint.
  After merging one PR, the next needs `gh pr update-branch` and fresh checks (main requires up-to-date).
- Solo maintainer: PRs + green CI + resolved conversations, zero required approvals; restore approval when
  another reviewer exists.
- Dependency PRs: check peer and engine ranges and SHA pins; merge only with fresh checks against `main`.
- A `v*` tag makes `release.yml` build a **draft pre-release**; nothing reaches users until it gets
  plain-language notes and `gh release edit <tag> --draft=false --prerelease=false --latest`.
- Non-app downloads (e.g. voice models) are published under a non-semver tag (`models-…`) as a
  pre-release with `--latest=false`, so the in-app updater (strict semver tags) never offers them.
- When a component gains a router or data hooks, run every test that renders it (`grep -rl "<Name"`).
- Moving UI into a collapsed section (`<details>`, Advanced, "More …"): grep `e2e/` and unit tests for its
  labels and open the section first in each; agents that own the page miss specs owned by other features.
- SonarCloud's security gate fails on running a tool by bare name (S4036, PATH lookup): scripts run
  `gh`/`git` from absolute install paths or an absolute `<TOOL>_PATH` override (`scripts/build-summary.mjs`).
- SonarCloud counts repeated test bodies as duplicated new code (gate ≤ 3 %): write case lists as
  `it.each` tables.
- SonarCloud: keep data tables as one-line tuples, catalogs in JSON, avoid `password`/`pwd` in i18n keys;
  write `UPDATE` statements with an explicit `WHERE`.

## Build, tooling and Windows

- Never start a Dev Build on port 7420 on the dev machine: the installed EzyChat Lite service listens
  there, so test traffic could reach real data. Use 749x ports and check `/api/health` reports `mode: dev`.
  Playwright MCP screenshots save only under `.playwright-mcp/` (gitignored).
- Never use the `development` export condition for monorepo-only `src/` entries of published packages:
  Vite/Vitest enable it by default and would resolve consumers to unshipped source. Use `ezychat-source`.
- tsx ignores tsconfig `customConditions`; pass Node `--conditions=ezychat-source` (`.npmrc`
  node-options does it for npm scripts and npx). Each core package keeps its own `vitest.config.ts`
  reusing the root `sourceResolve`, or `npm test -w` resolves `@ezychat/*` to a missing or stale `dist/`.
- Vite library mode inlines CSS assets as base64 and our CSP has no `font-src data:`: extract fonts
  back to files. tsc keeps `@/` aliases and side-effect CSS imports in `.d.ts`: rewrite or strip them.
- Test unpublished `@ezychat/*` versions with `npm install --no-save <tgz>` of a tarball carrying the
  pinned version; never commit a `file:` dependency.
- Extension tables must not store `chat_jid` until a merge hook exists: `mergeChat` moves core tables only.
- A scratch tsx script with top-level `await` outside the repo must be `.mts` (`.ts` there builds as CJS).
- Write code containing backslashes with the Write tool, not Bash heredocs (they mangle `\\`); build
  regexes from template literals with `String.raw`.
- Run `node -v` before verifying: nvm4w switches Node machine-wide and Node 20 breaks this repo. Put
  `D:\nvm\v24.13.0` first on PATH for our commands instead of changing the global version. A
  missing `better-sqlite3/build/` is not a failure: the module loads from its `prebuilds/`.
- A browser-side worker (e.g. the WebAssembly voice encoder) is packaged-smoke-tested by serving the
  packaged `resources/web` from the packaged server (`--web-dist`, `ELECTRON_RUN_AS_NODE=1`, `--fake-wa`)
  and driving Chrome; build with `--dir --config.directories.output=<scratch>`.
- Teammate-written data keyed by `chat_jid` never `ON DELETE CASCADE` from `chats` (like `notes`): an app
  rollback runs an older `mergeChat` that deletes chat rows without moving new tables.
- Several tables carry SQLite `CHECK` lists (e.g. `chat_events.type`): adding a value needs a table rebuild
  migration, so check `001_init.sql` before designing a new enum value.
- Write files containing regex escapes, `\n`, `\b` or Windows paths with the Write/Edit tools (or
  `String.raw`), never via Bash/Python heredocs (the Bash tool collapses `\\`); a scripted edit that
  must match a literal `\n` goes in a script file built with `chr(92)`. Then grep for U+0008 and broken literals. On Windows,
  Python writes need `PYTHONUTF8=1` and `newline='\n'` (text mode writes CRLF, like PowerShell
  `Set-Content`; `file <path>` shows it). Unicode escapes can still land as the raw invisible character
  (lint `no-irregular-whitespace`): match invisible characters with `\p{Cf}`/`\p{Cc}` classes and
  check suspicious lines with `od -c`.
- Multi-line scripts go in a file (PowerShell breaks `node -e`); prefer PowerShell/Grep/Read over slow Git
  Bash; prefix `git show ref:path` with `MSYS_NO_PATHCONV=1` in Git Bash. The user profile path has a
  space ("Jazz Tong"): always quote command substitutions, e.g. `"$(cat graphify-out/.graphify_python)"`.
- Run `prettier --write` only on files you changed (the repo is not Prettier-clean).
- Never rebuild a web dist that any running server serves (blank page, 404 assets): stop, rebuild, start.
  A browser that hit the broken build keeps a service worker serving `index.html` for the new assets
  ("MIME type text/html"), even after the restart: unregister it and clear caches before re-checking.
  Finish browser checks before packaging.
- Delete custom build output folders (`release-*`, `dist-*`) after use; ESLint ignores them, but they
  still waste time and can confuse other tools.
- Before any desktop build, check where running instances execute from (`/api/health`,
  `sc qc wa-team-inbox`); build updates to `--config.directories.output=<new folder>`; services run only
  from a Program Files install.
- Version bumps: `npm pkg set` the root, `npm run version:sync`, edit only workspace entries in the
  lockfile, and verify `/api/health` and the UI show the new version.
- Bundled workers can break where source runs pass: a package whose `exports` lists `require`
  first with a CommonJS file inside `"type": "module"` (simple-yenc) bundles with no exports.
  Resolve such packages to their ESM build in `bundle-server.mjs` and smoke each bundled
  worker with plain node and one real job.
- macOS without a Developer ID: sign ad-hoc (`identity: '-'`), never `identity: null`; an unsealed bundle
  opens as "damaged" on Apple Silicon. Release CI runs `codesign --verify --deep --strict` on every `.app`.
  A correctly ad-hoc-signed app still shows "Not Opened … could not verify … free of malware" (expected,
  not a bug): users click Done, then System Settings → Privacy & Security → Open Anyway. Only a Developer
  ID + notarization removes that prompt. Gatekeeper checks only downloaded (quarantined) apps: a local
  build never shows the prompt, so test macOS releases from the downloaded DMG. Homebrew is no way around
  it: 5.0 removed `--no-quarantine` and disables casks that fail Gatekeeper (from September 2026).
- Packaging: asar-unpack native loaders with their `.node`; pin esbuild's `ws` build; mac builds need an
  explicit `--mac dmg:<arch>` and a native-runner smoke; smoke packaged servers with
  `ELECTRON_RUN_AS_NODE=1` on a temp data dir. A feature that adds a native module or worker is smoked
  end to end in a `--dir` packaged build (e.g. voice: copy the model in, simulate a voice note on
  `--fake-wa`, check the transcript), not just server start-up.
- GUI smoke tests use plain Electron with a temporary profile (packaged apps ignore entry arguments).
- Playwright may lack Chromium: fall back to `channel: 'chrome'` (scripts too). A fake microphone:
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. Run e2e alone (memory); browser test
  sign-in honours `Retry-After` instead of weakening limits. Click a `SegmentedControl` option by its
  `<label>` (it covers the small radio). Capture drawers and dialogs with viewport screenshots: full-page
  shots stretch fixed elements and hide the drawer's scrolling body.
- Vitest: no globals (call `cleanup()` in `afterEach`, assert on `textContent`); native subprocess tests get
  their own timeout and are re-run with one worker before changing assertions; lazy-locale tests use a
  10 s `waitFor` and 20 s test timeout; fixtures mirror Tailwind preflight (`border-style: solid`).
  Heavy end-to-end unit tests (hundreds of chats) set an explicit timeout: the Windows CI runner is
  several times slower than local runs. So does any test that builds `makeTestApp()` inside itself, and
  `vi.waitFor` around real async work gets `{ timeout }` (its default gives up after 1 s).
- Radix RadioGroup arrow-key tests: `{ArrowRight>}`, `waitFor`, `{/ArrowRight}`.
- Case-insensitive filesystem: move legacy files before adding same-name shadcn files.
- Windows background scripts: launch via a short-lived `powershell -Command Start-Process …`, wait for its
  exit code, and test the real launcher end to end. Stopping a background shell task does not stop the
  `node`/`tsx` server it started on Windows: stop the server by the PID listening on its port (after
  checking its command line), and confirm a port is free before a re-run, or the re-run tests old code.

- Playwright `getByRole({ name })` matches substrings: when a new control's label contains an existing
  one's ("Open customer details for …" vs "Customer details"), make the old locators `exact: true`.
- Run Prettier on the files you changed only (`npx prettier --write <files>`): pointing it at a folder
  reformats untouched files (shadcn primitives, tests).
- Run the final verification in stages (typecheck, lint, tests per workspace, web build, e2e), not
  one chained command: on this dev machine the chain can be stopped for low memory, losing every result.
  Web tests time out under load: rerun failures alone and the web suite with `--maxWorkers=2`
  before treating them as real.
- After rebuilding `apps/web/dist`, restart the server (it lists the static files at start) and
  unregister the browser's service worker; otherwise the page goes blank with `text/html` MIME errors.
- nvm4w switches Node machine-wide: check `node -v` (22+) before tests or a server start when
  `better-sqlite3` suddenly fails to load; never switch it back from inside one agent's run.

## Security

- Treat an AI handover as its own committed notification event: the last inbound message may have
  belonged to the AI. Route to the new human assignee or active human team, and cover connected,
  offline, disabled and AI recipients separately.

- Code that walks an uploaded file (Ogg pages, packets) keeps fixed memory: aggregate into a bounded
  result as you go, never collect one entry per item, and cap the upload size for that file kind.
- Recheck credentials, sessions, disabled state and roles after any async hash/verify, immediately before
  a synchronous commit.
- Privileged desktop IPC is bound to the registered window, exact main frame and bundled URL.
- Services execute only protected runtimes (Program Files ACLs/links on Windows; root-owned copy without
  ACLs on macOS).
- Updates require trusted SHA-256 and size, private staging, restricted redirects and a rehash before
  handoff; an unelevated broker records results and relaunches.
- Password generation requires Web Crypto. Redact credential fields from live logs (deep scrub of objects,
  arrays and Errors) and sanitise historical exports.
- One-time secrets (new access tokens) never become a react-query query or mutation result: the
  mutation hands them to the showing component's state via a callback and returns metadata only;
  clear that state when the dialog closes. Tests assert the secret is absent from both caches.
- Per-key limiters or caches reachable without a session must expire entries and cap their size.
- Audit writes reachable without a session (failed token sign-ins) go through a per-IP-and-reason
  limiter, or anyone can flood `audit_log`.
- Access checks for an endpoint that must stay hidden or limited (off → 404, peer, token, rate limit)
  run in Fastify `onRequest`, before body parsing; in the handler, a bad body answers 400/413 first.
- Every raw `node:http` handler parses the request target inside try/catch and answers 4xx; an uncaught
  throw ends the server process.
- Document parsers run in a worker with time, memory and expansion limits.
- Never trust a media file's self-declared length or size (Ogg granule, headers): count the real
  packets before decoding or uploading, and cap decoded output, because customers send crafted files.
  Test such limits with genuinely oversized input, not by editing the header (that is the attack).

## WhatsApp / Baileys

- Keep mention JIDs separate from the original body and resolve names at every presentation path, including inbox/notification previews before truncation; sender names alone do not name tags. Legacy numeric tags must be unambiguous across phone/LID identities, and recycled phone contacts must never supply another person's name.

- A voice note is Ogg/Opus sent with `ptt: true`; pass `seconds` and `waveform` (64 bytes, 0–100)
  yourself or Baileys needs optional music-metadata/audio-decode (`waveform` is missing from its types
  but is sent). Browsers record WebM or MP4, never Ogg: encode Ogg/Opus with a WebAssembly encoder.
- Identity is pinned to `Browsers.ubuntu('Chrome')`; "Desktop" identities get 428 before any QR. Never
  change it without a live QR check.
- Message timestamps are whole seconds, so a quick reply can tie with the message it answers: logic
  that needs cause-before-effect orders ties by `rowid` (stored order), never by the WhatsApp id.
- Anything that needs the original `WAMessage` (a quote, media re-download) must not rely only on the
  adapter's in-memory cache (2,000 entries, cleared on reconnect): pass a saved copy from the database
  (`WaQuotedRef` → `quotedFromRef`; `key.remoteJid` = the chat the reply goes to), or the feature
  silently degrades after a restart. Re-point cached ones too (`quotedForChat`): a message cached under
  the phone-number address while the reply goes to the LID becomes a "foreign chat" quote.
- Any change under `packages/wa/src/baileys/**` needs a live smoke on a test number; otherwise say
  "untested against real WhatsApp". Fake-adapter tests prove nothing about linking.
- Pairing codes work after the first QR offer; the following 515 "restart required" is normal.
- Don't download history media eagerly; treat transient network errors as non-fatal; reset reconnect
  backoff when the server responds.
- Decide media state by id (`local-` = app upload), never by sender; test inbound and phone-sent messages.
- One person can arrive as a phone-number JID and a LID: chats are keyed by the LID once known
  (`jid_aliases`); duplicates merge only in the startup identity migration, reading
  `wa-auth/lid-mapping-*.json` offline. Never merge on a name or number match.
  Learn live phone/LID pairs (e.g. from group metadata) before looking up a person's chat, so a
  recycled number never resolves to its old owner; key any new chat by the LID, and trust anything found via a number (shown number, chat, About, photo) only while it still routes to the
  same LID, through one shared check rather than one fix per path. A re-pointed number's
  names, About and photo belong to the old owner: never copy them (guard centrally in `syncNames` via `movedAway`: never a source, never a destination), and key per-person caches by the LID (server caches and web query keys alike).
- Anything that re-keys or deletes a chat moves every `chat_jid`-keyed table (check `ON DELETE CASCADE`)
  and in-memory per-chat state in the same transaction. Never run `VACUUM`/backups inside
  `db.transaction`.
- `FakeWaAdapter` ids carry a per-process prefix; when a dev test "does nothing", check de-duplication first.
- Test copies of real data: `db.backup()` snapshot, minimal `wa-auth`, no `secret.key`, `--fake-wa` on
  loopback.

- Group members (`groupMetadata`) carry no names and may hide phone numbers (LID groups): names come
  from contacts and existing chats, never inferred. Read the list on demand with a server cache (an in-flight read that gets invalidated is discarded) that
  `groups.update` / `group-participants.update` invalidate; fetch About and photos one person at a
  time, only when asked for. A LID-only member may already have a chat whose fallback name is its
  number: never show a number as a name. Most About reads come back empty (privacy), which is normal; WhatsApp lookups (About, photo) throw on failure and failures are never cached; only a real "none" (photo 404/401) is. Baileys (rc14) resolves a timed-out query to `undefined` instead of throwing: treat a missing result as a failure.

## AI sales agent

- Profile extraction retains a bounded new-message batch during bursts, but drops cancelled batches
  after off/connection changes. Bind each field to a source and recheck staff edits and identity routing
  at the atomic save/audit; latest-only work loses split details and revived work ignores human decisions.

- Anything an outside assistant can change that reaches customers (AI instructions, rules, context)
  is versioned on every save, app saves included, with a baseline of the replaced text, plus an
  audit row naming the token and its reason and a per-token rate limit: the assistant also reads
  customer text, so a crafted message could steer a change. When a feature makes a "read-only"
  promise untrue, fix every place that states it (app copy in all locales, public guides) with it.
  A write tool validates with the app's own limits (service methods trust callers), and any tool
  whose output an assistant must send back whole (replace-all text, restore) returns it in full via
  pages (`offset` / `nextOffset` / `lastPage`, by code point), never silently truncated.
- To compare hand-off rules (`try_ai_reply` with a draft), test with facts the business context
  contains: an unknown item hands off as `missing_facts` before any rule is weighed, so both rule
  sets look the same and the test proves nothing.
- Features that connect outside AI tools are vendor-neutral in name and copy ("AI assistants", MCP),
  never one provider's name; state which clients a given auth method actually supports.
- A new MCP tool must be added to every exact tool-name list in the tests (`mcp.test.ts` and
  `mcp-ai-setup.test.ts`): grep `server/test` for an existing tool name before pushing.
- MCP analytics are aggregated on the server (`get_stats`, `get_activity`), never left to the model
  paging through `get_messages`; define every derived metric in the tool description (e.g. "new
  conversation = customer message after 12 h of silence") so the client cannot guess its meaning.
- Any paid model call started from the UI is cancellable end to end: the page aborts its request when
  the user closes or replaces it, and the route aborts the provider call when the client disconnects.
- AI SDK on the Responses API (`ai/agent/models.ts`): with `store:false` also `include`
  `reasoning.encrypted_content` (else `item_reference` to unkept reasoning ids → HTTP 404); lift the
  SDK's `system` message into `instructions` (cache layout; the ChatGPT route rejects `system`); set
  `maxRetries: 0` (it retries twice by default); pass only our fixed error messages (HTTP ≥ 400).
- Agent turns: bound the whole turn (all steps), not each model call; and give Try it the same tools
  as live replies (minus chat-bound ones), or it stops testing what customers get.
- Tests that ingest many messages under frozen fake timers must tick the clock between them: equal
  timestamps reorder by id and can push the message being answered out of the last 20.
- Prompt/AI-behaviour changes are proven by mock-provider tests only: report them as "untested against
  a real model" and offer the owner a Dev Build check (fake WhatsApp, demo data, the owner's own key).
  Use `e2e/devbuild-ai-check.mjs` (demo chats belong to people and a hand-off ends the AI's turn, so
  each scenario gets a fresh number) and log every run in `docs/dev-build-checks.md`.
- Ownership follows who handles the chat: a teammate's inbox reply claims an unassigned chat and takes
  over an AI-owned one (the AI then stops); it never takes a chat from another teammate, and phone-app
  replies assign nobody. Pausing the AI without moving the owner left a stale AI chip.
- The model proposes, code decides: guard every action (resolve only after a customer confirmation;
  objections keep the chat open).
- When the AI promises a human follow-up, the code hands the chat to the team. Questions about X stay with
  the AI; requests to do X (order, book, pay, cancel) are handed off and never resolved.
- Prompt caching: instructions stay static; per-call facts (date, time, state) go in the last input block;
  cache keys come from a stable install id + model, never customer data.
- A human takeover can land mid-generation: abort, invalidate queued replies, and recheck ownership and
  the latest customer message right before sending. Notify automation on live receipt, before media
  downloads.
- Provider and member settings have separate write schemas; reset the model when switching providers and
  validate before saving; keep drafts local while polling.
- ChatGPT OAuth: refresh tokens rotate (reuse stored tokens newer than the failed ones; single-flight is
  not enough); offer a paste-the-callback fallback for tunnel/LAN admins; classify blocked responses
  (403/404/HTML) as a connection state, then stop claiming and release chats silently.
- The ChatGPT sign-in takes text and images but no audio: Codex `input_audio` returns 400 "Audio input
  is not available", `input_file` rejects audio MIME types, and the web dictation endpoints
  (`/backend-api/transcribe`) answer 403 `cf-mitigated: challenge` even with the Codex CLI fingerprint
  (the Codex desktop app's dictation passes only with native device attestation; Hermes abandoned this
  route, OpenClaw's broke) — never fake attestation or work around bot challenges — and the Codex CLI's
  speech engine (`thread/realtime/*`, incl. its transcription mode) refuses ChatGPT login: "requires API
  key auth". Speech-to-text needs an OpenAI API key. Spike a provider capability with one live call first.
- The AI is notified before live media downloads (300 ms debounce once it owns a chat): wait for a
  `pending` customer image (`message:new`, bounded) before calling it unreadable; trust the file's
  bytes, not the declared MIME. Async `fs/promises` reads stall under `vi.advanceTimersByTimeAsync`.
- Routes capture `ctx.services.ai` at registration: test HTTP behaviour against the real service.
- A route that calls an outside service takes its client from an optional `ctx.services.<name>` slot
  (e.g. `aiKeyTest`), set in `makeTestApp`'s `beforeBuild`, so tests never reach the network.
- An API key test treats only a 401 as a bad key: a 403 (restricted key, region block), 429 or
  network failure must still let the admin save. e2e that save a key answer
  `POST /api/ai/connection/test` with `page.route`.
- Voice notes are transcribed before the AI decides (bounded wait on `pending`); an untranscribed
  one gets one "please type it" reply, and the code, not the model, hands off a repeat. The
  model's structured output has no `unsupported_message` reason, so the server maps it.
- Prompt layers: safety rules live in the fixed system prompt and state that administrator instructions
  never override them; editable instructions hold role, scope and style only, company facts go in the
  Business context, and hand-offs are structured actions, never text markers (they would reach the
  customer).

## Desktop and web UI

- Format only the files you changed inside a feature mock: `prettier --write` over `mock/src/**`
  rewrites frozen baseline files and breaks `snapshot.mjs --check`.

- Audit detail controls sit with the action or in their own layout slot, never inline with the
  summary sentence; compact links preserve list density while retaining 44px touch targets.

- The microphone needs a secure page (https, localhost, the desktop app): a LAN `http://` link has
  none, so say why instead of failing. Create the `AudioContext` before any `await` in the tap
  handler (Safari records silence otherwise); WebAssembly needs CSP `'wasm-unsafe-eval'`.
- Async start and stop (microphone, encoder) must be cancellable: number each attempt and drop what
  resolves after Delete or unmount; give stop a failure path and a timeout that always closes the
  microphone. Keep a recording until its upload succeeds, and give it one clientId for every attempt
  (the server dedups by clientId, so a retry never sends twice).
- Confirmations use the `AlertDialog` primitive (focus trap, Escape, portal), never an inline
  `role="alertdialog"` div; e2e locates it on `page`, not inside the panel.
- A settings row's control slot (`shrink-0`) holds only the control; any text a reused component brings
  along (hints, warnings) goes under the row (`PreferenceRow` `below`, `PushToggle` render prop), or it
  squeezes the description. A bare switch handed to a row keeps a 44 px target (padded `<Label
htmlFor>`, `min-h-11 min-w-11`). Desktop-only text (`window.watiNotifications`) needs a check with
  that bridge injected: the browser Dev Build never shows it.
- In a direct chat, every place that names the customer (quotes, reply bar) uses the header name
  (`chatTitle`: profile → saved → WhatsApp name), never the message's `senderName`; groups name senders.
  Demo data (assigned chats, profile names) catches this; bare e2e fixtures do not.
- A touch gesture (swipe, long-press) never replaces a control: keep a real button for screen readers,
  switch access and keyboards (`pointer-coarse:not-focus-visible:sr-only`, shown when focused).
- Addresses the UI tells people to use (setup commands, URLs) come from the server's running config
  (`ctx.config.port`, tunnel status), never from saved settings, which may apply only after a restart.
- Admin links and fallback redirects use absolute `/admin/...` paths; test every section transition and
  malformed URLs.
- Every screen works at 360px: check dialog bounds and inner clipping (not just page overflow), cap dialog
  height with dynamic viewport units, wrap long titles, and use real 44px hit targets (padded labels).
  After text changes also run `SMOKE_LOCALE=ms node e2e/screens.smoke.mjs` (Malay is longest).
- Shrink dense desktop controls only with `md:pointer-fine:` (mouse), never by breakpoint alone:
  tablets are touch at `md`, and 44px targets must survive there.
- Playwright `getByLabel('Password')` is a case-insensitive substring match that also hits
  aria-labels like "Show password": use `{ exact: true }` for form fields in e2e helpers.
- A child that writes into a parent-owned ref (guards, Esc handlers) registers it in an effect with a
  cleanup; render-time writes outlive the unmount and leave the parent calling a dead closure.
- Prefilled forms keep two baselines: "unsaved changes" compares with what the form opened with,
  the save merges against the stored record (so a prefill is saved but never prompts a discard).
  A WhatsApp chat name can be the phone number: never prefill or show it as a person's name.
- In jsdom `useMediaQuery` is false, so panels render as modal Sheets that hide the page from
  `getByRole`; query background controls with `{ hidden: true }`.
- Bars and rows that share width with columns or side panels (chat header, inbox list rows) size by
  their own width (`@container`), not viewport breakpoints: the desktop inbox list is narrower than a
  phone. Truncation assertions target the element carrying `truncate`, and must
  fail without the fix (a check on its parent passed while the name showed one letter).
- Modal backdrops use the `bg-overlay` token (`rgb(0 0 0 / 0.5)`), never `bg-black/50`: its
  `oklab(0 0 0 / 0.5)` paints fully transparent in current Chrome, so dialogs stop dimming the page
  (bottom drawers hid it because vaul adds its own backdrop). Guarded by `ui/overlay.test.ts`.
- A before/after review of long text shows the changes with one line of context and folds the rest
  ("⋯ 19 unchanged lines"); a full-text diff buries the change below the fold.
- A multi-step task on a page (describe → review → apply) opens in a dialog (a full-height bottom sheet
  at 360 px), not an inline panel that stretches the card; the page keeps its own Save.
- In a crowded row decide which item gives up width: short, meaningless-when-cut chips (tags, counts) are
  `shrink-0` with a `max-w` cap; names and previews (`min-w-0 shrink` + `truncate`) give way first. Re-check
  rows with every badge present (assignee + tags + unread), not just the demo row that looked fine.
- shadcn primitives defeat naive truncation and hit areas: `TabsTrigger` centres its content (truncate
  an inner `min-w-0 truncate` span), `SelectValue` is `display:flex` (add
  `*:data-[slot=select-value]:block … truncate` on the trigger), and `Badge` is `overflow-hidden`
  (a `before:-inset-*` hit area inside it needs `overflow-visible`).
- Every new audit action gets a label in `admin/audit-actions.ts` (en/ms/zh-CN) and a readable
  meta summary in the same change; otherwise the Audit page shows raw keys and JSON.
- Review screenshots taken after animations settle (wait ~500 ms after opening a popover/sheet):
  mid-fade captures make opaque popovers look transparent and send reviews after false bugs.
- Cached lookup lists (tag suggestions) must be invalidated by the live event that can add entries
  (`chat:updated` with tags), or another tab or teammate sees stale options until the cache expires.
- E2E data that other tests or projects could share (tags, names) gets a per-project suffix
  (`projectTag(info)`); `npm run e2e` rebuilds `apps/web/dist`, so stop any Dev Build serving it first.
- Review a UI change on the whole page at 1280 and 360 px, top to bottom, not only the changed
  section: background bands, orphaned blocks and spacing between sections only show in context.
- Marketing screenshots come from `e2e/marketing-screenshots.mjs` on a fresh `--mode standalone` server
  (`dev` mode stamps a "Dev Build" badge); save a placeholder AI key so the AI page isn't red "Needs connection".
- Playwright `page.clock.pauseAt(new Date())` is flaky under load (page clock runs ahead: "Cannot
  fast-forward to the past"); pause at the page's own `Date.now()` plus a few ms.
- Never pipe a step into `tail`/`head` inside an `&&` chain: the pipe hides its exit code and the chain
  carries on (`build-summary.mjs record` stage keys are `design|dev|unit|e2e|devbuild|screen`).
- `node e2e/screens.smoke.mjs <url> <outDir>` is the fastest "does every screen render?" check. It
  creates the first admin itself, so run it on a fresh server, not one seeded by `marketing-screenshots.mjs`.
- The shadcn `Textarea` uses `field-sizing-content`, which also grows its width with long lines and
  widens grid dialogs: long-form editors use `field-sizing-fixed` with a fixed height, wide dialogs use
  `ResponsiveDialog size="wide"`; test with a document of long lines, not short fixtures.
- Forms derive untouched defaults from queries and keep explicit drafts; background refresh must not
  overwrite edits.
- Resynchronise active queries on every socket connection; route related live events through one refresh
  scheduler; memoise list rows and coalesce pagination.
- On PWA resume, reconnect only a visible, online, active session with no live or opening transport; Socket.IO's `connect()` alone does not bypass pending backoff. Use public lifecycle methods, remove listeners on session cleanup, and retain the stale-inbox warning until connected.
- Browser resume tests install fake timers before Socket.IO captures them and count attempts before restoring the network; native `online` events can reconnect before synthetic foreground events.
- Gate avatar/photo requests on WhatsApp readiness and reset failures per connection generation.
- One theme source (`data-theme`) drives both tokens and dark variants.
- Durable notices (updates) render declaratively; transient toasts can hide the only action.
- Desktop: one main-process gate for service/data operations; probe and self-recover when a background
  service starts late; a desktop window is not the update owner unless it owns the server or service;
  after an exe/path rename, users must re-pin the tray icon (`NotifyIconSettings`).
- A blank white taskbar icon means Windows bound the window's AppUserModelID to a shortcut whose target
  is gone: scan Start Menu `.lnk` files for `System.AppUserModel.ID`. Unpackaged runs use
  `appUserModelId(false)` (`….dev`) so dev runs never claim the installed app's identity.
- Renames keep data folders, profile, service ID and app ID; plan install-path renames as a one-time
  scripted step; regenerate service XML from code, never hand-patch it.
- Update discovery lists releases and compares strict semver (the latest-release endpoint skips previews).
- Before moving upgrade-contract strings (service/updater scripts, paths) behind config, capture the
  generated output with fixed inputs and require it byte-identical after; check a test product's
  output contains no leftover Lite literals.
- Brand assets: check exported icons on light and dark backgrounds at small sizes.

- Avatar initials use letters only (`initials()`): a name without letters (number, WhatsApp ID, emoji)
  shows a person icon, never `+`, `(` or `~`.
- A chat's details open by tapping its header identity (avatar + name + subtitle are one `Button`; the
  name stays the `<h2>`, screen-reader only): Group info for groups, Customer for direct chats.
- Badges inside a `SegmentedControl` option label get `pointer-events-none`, so a click anywhere on
  the option selects it.

## Internationalization

- Every string goes through `t()` with keys in `en`, `ms` and `zh-CN`, including prefilled editable
  content such as default AI instructions (catalog `ai.defaults.*`, English pinned to the server's
  canonical constant by a test); cross-namespace keys need `useTranslation(['ns', 'common'])`.
- Switch language only after `activateLocale` resolves; apply static desktop strings once per locale.
- `<Trans>` component tags must be non-void elements (`<a>`, `<b>`).
- Never write the product name into a catalog string: use `{{product}}` (i18next default variable set by
  `createInboxApp({ productName })`). Only the share-the-app texts keep "EzyChat Lite"; a test enforces it.
- Extension keys (`ext.<name>.*`) are not in the typed core catalogs: read them with
  `useExtensionTranslation()`; never cast `t`. Core catalogs keep the `ext` key reserved.
- Date helpers that take `now` must compare against it, not the real clock.
- Desktop main imports only types from `shared` and mirrors tiny runtime helpers with parity tests.
- Links to ezychat.ai use the page for the app language (`/ms/…`, `/zh/…`) and merge only after
  that page is live on the website; installed apps cannot be re-pointed.

## Cloudflare and sharing

- App-managed cloudflared ignores user config (`--config=`) and logs in with a private child home;
  credentials stay encrypted.
- A Quick Tunnel is Running only after URL assignment and edge registration.
- Persist app-owned tunnel/DNS IDs first, retry only those, never overwrite foreign DNS or tunnels; fall
  back to the approved zone when zone listing is denied.
- Unknown named-tunnel hosts are allowed only on the validated loopback proxy path, identically for HTTP
  and Socket.IO.
- Restoration and setup share one tracked operation gate; shutdown waits for it.
- Share only the public project URL; treat a cross-realm `AbortError` from native share as a quiet cancel.
- "Phone access is set up" = tunnel running OR a named tunnel saved (`hasTunnelToken` /
  `namedTunnelHostname`); the tunnel status mode returns to `off` when stopped, so it cannot say
  whether a tunnel is configured.
