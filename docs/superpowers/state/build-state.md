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
   _Status 2026-10-03: job stopped by user (too long) before completion. Not done: server smoke, ABI smoke, tray icon (build/tray/trayTemplate.png mac setTemplateImage / build/tray/tray.png win, with fallback). A partial earlier output exists at apps/desktop/release/win-unpacked (unverified; build/icon.ico and build/tray/* not yet present). .gitignore already covers dist/, out/, release/. Restart this job from scratch._
3. **Docs (plan Task 16)** — real `CLAUDE.md`, README final, `docs/architecture.md`, `docs/manual-test-checklist.md`, CHANGELOG.
4. **UI/UX refactor** — adopt shadcn/ui + Calm Desk tokens per `docs/design-system.md`; replace hand-built primitives; ESLint guard against raw `<button>`/`<dialog>`/palette colours; Codex-generated assets (icon set, tray icons, empty-state illustrations). Draft icon accepted: scratchpad `icons/icon-1024.png` (needs transparent-corner + full-bleed maskable variants).
   - **Status 2026-10-03: UI FOUNDATION job stopped by user before any changes (restart from scratch).** Nothing installed or written yet:
     no radix/cva/tailwind-merge/lucide/sonner/vaul/cmdk/fontsource/tw-animate deps, no `components.json`, no `@/` alias,
     no `src/lib/utils.ts`, no `src/components/app/`; `src/components/ui/` still holds only the legacy hand-built
     Avatar/Banner/Button/Card/Input/Modal/Spinner. Foundation scope on restart: deps + `@/` alias; Calm Desk tokens in
     `index.css` (Tailwind 4 `@theme inline`, light/dark via media + `.dark`, Inter, radius, reduced-motion); shadcn
     primitives (button w/ `touch` size, input, textarea, label, select, checkbox, switch, radio-group, tabs, badge, avatar,
     card, dialog, alert-dialog, sheet, drawer, dropdown-menu, popover, tooltip, command, scroll-area, separator, skeleton,
     sonner, table); app composites (EmptyState, StatusDot, Banner, ResponsiveDialog, ResponsiveTable, PageHeader);
     legacy `ui/index.ts` exports kept as `@deprecated` wrappers; ESLint `warn` on raw `<button>/<dialog>/<select>`
     outside `components/ui|app`; `src/components/README.md`. Screen migration agents run only after this lands.
     Tip: keep the job smaller (split primitives vs composites) — it was judged too long as one job.
   - **Brand-assets sub-job: STOPPED by user before any work (2026-10-03), restart from scratch.** Nothing was generated or edited by it.
     Already present (pre-existing, not from this job): `apps/web/public/{icon.svg,icon-192.png,icon-512.png,icon-maskable-512.png}`, `apps/desktop/build/icon.png`.
     Still TODO: `icon-1024-transparent.png` (rounded-rect alpha mask over draft — its corners are white), `maskable-1024.png` (glyph in central 80%),
     tray icons (`apps/desktop/build/tray/{trayTemplate.png,trayTemplate@2x.png,tray.png,tray@2x.png}`), `apps/web/public/{favicon.ico,apple-touch-icon.png}`,
     `apps/desktop/build/{icon.ico,icon.icns}` (icns: png2icons via npx, else document electron-builder derives it on mac),
     `scripts/generate-icons.mjs` (sharp + png-to-ico installed in a scratchpad temp dir — never in repo package.json),
     illustrations under `apps/web/public/illustrations/` (empty-inbox, no-results, link-whatsapp, tunnel, welcome; teal+slate flat line art, no text/logos/faces, <=200KB, webp ok) via `codex exec --skip-git-repo-check -s workspace-write` (no `--full-auto`; ~1-3 min each, run in parallel),
     and `docs/brand.md` (asset list, sizes, purpose, prompts). Scope tip: split into two shorter jobs (icons+script; illustrations+brand.md).
5. **Publish** — push to `github.com/ossmalaysia/wa-team-inbox`, verify CI green on ubuntu/windows/macos.

## Update 2026-10-03 (later) — remaining jobs completed except E2E re-run

- ✅ UI refactor: shadcn/ui foundation + Calm Desk tokens (`53862c4`); inbox, admin, shell/auth/setup migrated;
  `components/legacy` deleted; ESLint guard (raw `<button>/<dialog>/<select>` + palette colours) is an **error**.
- ✅ Brand assets: Codex icon set (`scripts/generate-icons.mjs`, `docs/brand.md`, PWA/favicon/ico/tray) and
  5 illustrations in `apps/web/public/illustrations/`.
- ✅ Docs: CLAUDE.md, README, CONTRIBUTING, CHANGELOG, `docs/architecture.md`, `docs/manual-test-checklist.md`.
- ✅ Packaging: Windows unpacked build; packaged exe with `ELECTRON_RUN_AS_NODE=1` serves `/api/health` + web
  (fixed: argon2 loader inside asar, `ws` resolution in server bundle, version in bundle).
- ✅ Verified locally: typecheck, 50 files / 346 tests, lint, web build.
- ⚠️ **Playwright E2E not re-run after the UI migration**: the run was killed by Claude Code due to low system
  memory. Selectors for Radix Select (role/assignee) were updated in `e2e/*.spec.ts` by the migration agents.
  **Next step:** close other apps and run `npm run e2e`; fix any selector/visual regressions.
- Not done yet: screenshots of the new UI (needs the dev server + Playwright; same memory constraint).

## Manual checks only the maintainer can do

Real WhatsApp QR link + send/receive + media + groups; quick/named tunnel from a phone on 4G; iOS PWA push;
service install + reboot with nobody logged in (Windows and macOS).

## Lessons (process)

- Too many sequential waves + an integrator per wave made wall-clock = sum of slowest agents. Prefer fewer, wider waves and one integration pass.
- One fixer per area serialised ~15 server findings; split findings across agents.
- Vitest spent ~86% of time re-transforming TS each run; `experimental.fsModuleCache` enabled in `vitest.config.ts`.
