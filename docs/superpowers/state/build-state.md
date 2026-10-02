# Build State — WA Team Inbox

Last updated: 2026-10-03 (build workflow `wf_8487dcaa-41c` stopped by user request during the Fix stage).

Plan: `docs/superpowers/plans/2026-10-02-wa-team-inbox.md` · Spec: `docs/superpowers/specs/2026-10-02-whatsapp-team-inbox-design.md`
Design system: `docs/design-system.md` (approved: shadcn/ui + "Calm Desk", teal `#0F766E`)

## Completed

| Plan task | Status | Commit |
|---|---|---|
| 1 Scaffold, OSS files, CI | ✅ | 7265109 |
| 2 Shared schemas | ✅ | bedaf8e |
| 3 WaAdapter + Fake, 11 Web shell | ✅ | ef6b910 |
| 4 Baileys adapter, 5 Server core, 12 Inbox UI, 13 Admin UI | ✅ | 7fc5e67 |
| 6 Auth, 9 Tunnel, 14 Desktop + service mode | ✅ | 5fa183c |
| 7 Chats/messages/media/queue, 10 Admin/backups | ✅ | 2a2720e |
| 8 Realtime + push | ✅ | c5d1489 |
| 15 Playwright E2E (+ integration fixes) | ✅ | ad6f96c |
| Review (security / correctness / mobile-UX) | ✅ 27 findings → `review-findings.json` | — |
| Fix stage (all 27 findings had changes applied) | ✅ verified on stop: typecheck ✅, 50 files / 343 tests ✅, lint ✅ | committed with this file |

Extra fix outside the workflow: SVG/HTML media stored-XSS (allowlisted inline types + sandbox CSP) in
`packages/server/src/routes/media.ts` + `media.test.ts`.

## Remaining jobs (restart from here)

1. **Final verification** — `npm run build -w @wa-team-inbox/web` + `npm run e2e` (all Playwright projects incl. 360px no-scroll), fix failures.
2. **Smoke + packaging** — real server smoke (`/api/health`, SPA served); Windows desktop package (`electron-builder --win`), run packaged `electron.exe` with `ELECTRON_RUN_AS_NODE=1` against a temp data dir to validate native module ABI.
3. **Docs (plan Task 16)** — real `CLAUDE.md`, README final, `docs/architecture.md`, `docs/manual-test-checklist.md`, CHANGELOG.
4. **UI/UX refactor** — adopt shadcn/ui + Calm Desk tokens per `docs/design-system.md`; replace hand-built primitives; ESLint guard against raw `<button>`/`<dialog>`/palette colours; Codex-generated assets (icon set, tray icons, empty-state illustrations). Draft icon accepted: scratchpad `icons/icon-1024.png` (needs transparent-corner + full-bleed maskable variants).
5. **Publish** — push to `github.com/ossmalaysia/wa-team-inbox`, verify CI green on ubuntu/windows/macos.

## Manual checks only the maintainer can do

Real WhatsApp QR link + send/receive + media + groups; quick/named tunnel from a phone on 4G; iOS PWA push;
service install + reboot with nobody logged in (Windows and macOS).

## Lessons (process)

- Too many sequential waves + an integrator per wave made wall-clock = sum of slowest agents. Prefer fewer, wider waves and one integration pass.
- One fixer per area serialised ~15 server findings; split findings across agents.
- Vitest spent ~86% of time re-transforming TS each run; `experimental.fsModuleCache` enabled in `vitest.config.ts`.
