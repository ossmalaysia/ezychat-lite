# Learnings

Lessons from building and running WA Team Inbox, so agents (and humans) don't repeat mistakes.
Append new entries at the top of the matching section: `- YYYY-MM-DD — what happened → root cause → rule`.
A Stop hook (`.claude/hooks/learnings-gate.mjs`) blocks a code-changing session from finishing until this
file is updated. Promote anything that changes *how* to work into CLAUDE.md.

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

## Build / tooling (Windows)

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
