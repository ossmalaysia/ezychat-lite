# Contributing to EzyChat Lite

Thanks for your interest in contributing!

## Development setup

1. Install Node.js 22+ (see `.nvmrc`) and npm 10+.
2. Run `npm install` at the repository root (npm workspaces).
3. `npm run dev` starts the server with a **fake WhatsApp adapter** plus the Vite dev server,
   so you can develop without linking a real number.

## Workspace commands

| Command                                         | What it does                                                   |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `npm test`                                      | Run all Vitest projects                                        |
| `npm test -w @wa-team-inbox/server`             | Run one workspace's tests                                      |
| `npx vitest run path/to/file.test.ts -t "name"` | Run a single test                                              |
| `npm run lint`                                  | ESLint                                                         |
| `npm run typecheck`                             | `tsc --noEmit` in every workspace                              |
| `npm run format`                                | Prettier                                                       |
| `npm run e2e`                                   | Playwright end-to-end tests (fake WhatsApp, fresh `.e2e-data`) |
| `npm run build -w @wa-team-inbox/web`           | Build the web app                                              |
| `npm start -w @wa-team-inbox/desktop`           | Build and launch the Electron app                              |
| `npm run dist -w @wa-team-inbox/desktop`        | Build an installer for the current OS                          |

Read [docs/architecture.md](docs/architecture.md) before larger changes, and
[docs/design-system.md](docs/design-system.md) before UI work. Releases are checked against
[docs/manual-test-checklist.md](docs/manual-test-checklist.md).

## Conventions

- TypeScript strict, ESM everywhere.
- REST and socket payloads are defined once in `@wa-team-inbox/shared` (zod).
- Only `packages/wa/src/baileys/**` may import `baileys`.
- Never commit WhatsApp auth/session data, databases, `data/` dirs, or secrets.
- Web UI must be mobile responsive (usable at 360px wide, no horizontal scroll).
- UI uses shadcn/ui primitives (`apps/web/src/components/ui`) and Calm Desk tokens: no raw
  `<button>`/`<dialog>`/`<select>` or palette colours in feature code.
- Do not weaken the security invariants listed in [CLAUDE.md](CLAUDE.md) (setup from loopback only,
  Host/Origin checks, media allowlist, CLI/tray-only admin reset).
- LF line endings (enforced by `.gitattributes` / `.editorconfig`).

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
  `chore:`, `test:`, `refactor:` ...).
- Branch from `main`, keep PRs focused, and fill in the PR template.
- `main` is protected: pull requests require one approval, resolved review conversations and
  passing CI on Linux, Windows and macOS. New commits dismiss stale approvals. Protections
  also apply to administrators; force pushes and branch deletion are blocked.
- Use squash merge; merged pull-request branches are deleted automatically.
- **Tests are required** for behavior changes. CI (lint, typecheck, tests, web build) must pass.
- Add a line to `CHANGELOG.md` under `[Unreleased]` for user-visible changes.

## Bugs and security issues

Use the GitHub issue templates for bugs and feature requests. For security issues, follow
[SECURITY.md](SECURITY.md) and do not open a public issue.

## Releases and versioning

The root `package.json` `version` is the single source of truth for the app version.

1. Bump `version` in the root `package.json` (semver).
2. Run `npm run version:sync` to copy it into every workspace `package.json`
   (`apps/desktop`, `apps/web`, `packages/*`). `node scripts/sync-version.mjs --check` only
   reports mismatches (exit 1).
3. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version.

The version shows up in the desktop tray, window title and Status window (`app.getVersion()`),
in `GET /api/health` (`scripts/bundle-server.mjs` writes the root version next to the bundled
server), and in the web UI (`useAppVersion()` in `apps/web/src/lib/version.ts`, which falls back
to the build-time `__APP_VERSION__`).
