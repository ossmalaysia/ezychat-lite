# Learnings

Rules learned from building and running EzyChat Lite, so agents (and humans) don't repeat mistakes.
This file is a compact summary; the dated incident history lives in git (`git log -p docs/LEARNINGS.md`).

**Adding a lesson:** add one short rule bullet to the matching section (`rule — why`), or sharpen an
existing bullet instead of adding a near-duplicate. A Stop hook (`.claude/hooks/learnings-gate.mjs`)
blocks a code-changing session until this file changes. Promote anything that changes _how_ agents work
into AGENTS.md.

## Working method

- Progress the owner asks about comes from committed records (the feature workbook, the Dev Build
  log), never from an agent's memory of the session: record each stage when it finishes.
- Before designing a change, grep `AGENTS.md` for the subsystem's terms (e.g. "profile", "prompt"):
  recent features leave placement rules in the architecture paragraphs, not only in Working rules.
- Propose UI changes with a realistic mockup before building: open the Dev Build in Playwright, edit
  the DOM to show the idea, screenshot desktop + mobile, and label it MOCKUP. Fill it with worst-case
  data (long names, assignee + tags + unread together, Chinese text) — layout bugs found after coding
  cost a fix-and-recapture round each. Add new check tooling only when a problem keeps recurring.
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
- Mocks cannot prove provider-side behaviour (prompt caching, headers): confirm with one live call on a
  Dev Build (never customer data), then pin the stable value in a unit test.
- A feature that reacts to inbound media must ship with a way to simulate that media on `--fake-wa`
  (`/api/dev/fake-incoming` `media`), or the owner cannot test it end to end on a Dev Build.
- Record protocol facts from the package that really implements them, with the source file; never copy
  tokens from local caches.

## Multi-agent process

- AGENTS.md is the single source of truth (CLAUDE.md imports it); edit rules there.
- Small changes are done directly. Subagents only for large independent work, at most 2 in parallel on
  Windows, with disjoint file ownership and a time budget; only the orchestrator commits; agents don't
  `npm install` unless they own that package.json.
- Subagents run only their own unit tests and package typecheck; one consolidated
  typecheck/test/lint/build/e2e run at the end. Prefer few wide waves and one integration pass.
- Agents use temp data dirs (`--data <scratchpad>`), never the real app data folder.
- Tools that fan out per file (e.g. graphify) must be batched to respect the 2-agent limit.
- Research on another repo starts with `git fetch` and searches `origin/<default>` (a local checkout can
  be hundreds of commits behind); never report "X does not exist" without naming the ref searched.
- Run Prettier on the files you changed, never on a whole folder: parts of the tree are not
  Prettier-clean on `main`, so a folder run rewrites files another agent or nobody owns.
- Workflow/subagents start in the session's primary checkout: when work lives in another worktree, give
  its absolute path and require `cd <worktree> && …` for every command, plus disjoint file ownership.

## Git, GitHub and CI

- Branch from a freshly fetched `origin/main`. Stage files explicitly (never `git add -A`); leave the
  plugin-injected CLAUDE.md block out of commits.
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
- SonarCloud's security gate fails on running a tool by bare name (S4036, PATH lookup): scripts run
  `gh`/`git` from absolute install paths or an absolute `<TOOL>_PATH` override (`scripts/build-summary.mjs`).
- SonarCloud: keep data tables as one-line tuples, catalogs in JSON, avoid `password`/`pwd` in i18n keys;
  write `UPDATE` statements with an explicit `WHERE`.

## Build, tooling and Windows

- Teammate-written data keyed by `chat_jid` never `ON DELETE CASCADE` from `chats` (like `notes`): an app
  rollback runs an older `mergeChat` that deletes chat rows without moving new tables.
- Several tables carry SQLite `CHECK` lists (e.g. `chat_events.type`): adding a value needs a table rebuild
  migration, so check `001_init.sql` before designing a new enum value.
- Write files containing regex escapes, `\n`, `\b` or Windows paths with the Write/Edit tools (or
  `String.raw`), never via Bash/Python heredocs (the Bash tool collapses `\\`); a scripted edit that
  must match a literal `\n` goes in a script file built with `chr(92)`. Then grep for U+0008 and broken literals. On Windows,
  Python writes need `PYTHONUTF8=1`. Unicode escapes can still land as the raw invisible character
  (lint `no-irregular-whitespace`): match invisible characters with `\p{Cf}`/`\p{Cc}` classes and
  check suspicious lines with `od -c`.
- Multi-line scripts go in a file (PowerShell breaks `node -e`); prefer PowerShell/Grep/Read over slow Git
  Bash; prefix `git show ref:path` with `MSYS_NO_PATHCONV=1` in Git Bash. The user profile path has a
  space ("Jazz Tong"): always quote command substitutions, e.g. `"$(cat graphify-out/.graphify_python)"`.
- Run `prettier --write` only on files you changed (the repo is not Prettier-clean).
- Never rebuild a web dist that any running server serves (blank page, 404 assets): stop, rebuild, start.
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
- Packaging: asar-unpack native loaders with their `.node`; pin esbuild's `ws` build; mac builds need an
  explicit `--mac dmg:<arch>` and a native-runner smoke; smoke packaged servers with
  `ELECTRON_RUN_AS_NODE=1` on a temp data dir. A feature that adds a native module or worker is smoked
  end to end in a `--dir` packaged build (e.g. voice: copy the model in, simulate a voice note on
  `--fake-wa`, check the transcript), not just server start-up.
- GUI smoke tests use plain Electron with a temporary profile (packaged apps ignore entry arguments).
- Playwright may lack Chromium: fall back to `channel: 'chrome'`. Run e2e alone (memory); browser test
  sign-in honours `Retry-After` instead of weakening limits.
- Vitest: no globals (call `cleanup()` in `afterEach`, assert on `textContent`); native subprocess tests get
  their own timeout and are re-run with one worker before changing assertions; lazy-locale tests use a
  10 s `waitFor` and 20 s test timeout; fixtures mirror Tailwind preflight (`border-style: solid`).
  Heavy end-to-end unit tests (hundreds of chats) set an explicit timeout: the Windows CI runner is
  several times slower than local runs.
- Radix RadioGroup arrow-key tests: `{ArrowRight>}`, `waitFor`, `{/ArrowRight}`.
- Case-insensitive filesystem: move legacy files before adding same-name shadcn files.
- Windows background scripts: launch via a short-lived `powershell -Command Start-Process …`, wait for its
  exit code, and test the real launcher end to end.

## Security

- Recheck credentials, sessions, disabled state and roles after any async hash/verify, immediately before
  a synchronous commit.
- Privileged desktop IPC is bound to the registered window, exact main frame and bundled URL.
- Services execute only protected runtimes (Program Files ACLs/links on Windows; root-owned copy without
  ACLs on macOS).
- Updates require trusted SHA-256 and size, private staging, restricted redirects and a rehash before
  handoff; an unelevated broker records results and relaunches.
- Password generation requires Web Crypto. Redact credential fields from live logs (deep scrub of objects,
  arrays and Errors) and sanitise historical exports.
- Per-key limiters or caches reachable without a session must expire entries and cap their size.
- Every raw `node:http` handler parses the request target inside try/catch and answers 4xx; an uncaught
  throw ends the server process.
- Document parsers run in a worker with time, memory and expansion limits.
- Never trust a media file's self-declared length or size (Ogg granule, headers): count the real
  packets before decoding or uploading, and cap decoded output, because customers send crafted files.
  Test such limits with genuinely oversized input, not by editing the header (that is the attack).

## WhatsApp / Baileys

- Identity is pinned to `Browsers.ubuntu('Chrome')`; "Desktop" identities get 428 before any QR. Never
  change it without a live QR check.
- Any change under `packages/wa/src/baileys/**` needs a live smoke on a test number; otherwise say
  "untested against real WhatsApp". Fake-adapter tests prove nothing about linking.
- Pairing codes work after the first QR offer; the following 515 "restart required" is normal.
- Don't download history media eagerly; treat transient network errors as non-fatal; reset reconnect
  backoff when the server responds.
- Decide media state by id (`local-` = app upload), never by sender; test inbound and phone-sent messages.
- One person can arrive as a phone-number JID and a LID: chats are keyed by the LID once known
  (`jid_aliases`); duplicates merge only in the startup identity migration, reading
  `wa-auth/lid-mapping-*.json` offline. Never merge on a name or number match.
- Anything that re-keys or deletes a chat moves every `chat_jid`-keyed table (check `ON DELETE CASCADE`)
  and in-memory per-chat state in the same transaction. Never run `VACUUM`/backups inside
  `db.transaction`.
- `FakeWaAdapter` ids carry a per-process prefix; when a dev test "does nothing", check de-duplication first.
- Test copies of real data: `db.backup()` snapshot, minimal `wa-auth`, no `secret.key`, `--fake-wa` on
  loopback.

## AI sales agent

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
- Voice notes are transcribed before the AI decides (bounded wait on `pending`); an untranscribed
  one gets one "please type it" reply, and the code, not the model, hands off a repeat. The
  model's structured output has no `unsupported_message` reason, so the server maps it.
- Prompt layers: safety rules live in the fixed system prompt and state that administrator instructions
  never override them; editable instructions hold role, scope and style only, company facts go in the
  Business context, and hand-offs are structured actions, never text markers (they would reach the
  customer).

## Desktop and web UI

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
- `node e2e/screens.smoke.mjs <url> <outDir>` is the fastest "does every screen render?" check.
- The shadcn `Textarea` uses `field-sizing-content`, which also grows its width with long lines and
  widens grid dialogs: long-form editors use `field-sizing-fixed` with a fixed height, wide dialogs use
  `ResponsiveDialog size="wide"`; test with a document of long lines, not short fixtures.
- Forms derive untouched defaults from queries and keep explicit drafts; background refresh must not
  overwrite edits.
- Resynchronise active queries on every socket connection; route related live events through one refresh
  scheduler; memoise list rows and coalesce pagination.
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
- Brand assets: check exported icons on light and dark backgrounds at small sizes.

## Internationalization

- Every string goes through `t()` with keys in `en`, `ms` and `zh-CN`, including prefilled editable
  content such as default AI instructions (catalog `ai.defaults.*`, English pinned to the server's
  canonical constant by a test); cross-namespace keys need `useTranslation(['ns', 'common'])`.
- Switch language only after `activateLocale` resolves; apply static desktop strings once per locale.
- `<Trans>` component tags must be non-void elements (`<a>`, `<b>`).
- Date helpers that take `now` must compare against it, not the real clock.
- Desktop main imports only types from `shared` and mirrors tiny runtime helpers with parity tests.

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
