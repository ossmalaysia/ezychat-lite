# Contributing to WA Team Inbox

Thanks for your interest in contributing!

## Development setup

1. Install Node.js 22+ (see `.nvmrc`) and npm 10+.
2. Run `npm install` at the repository root (npm workspaces).
3. `npm run dev` starts the server with a **fake WhatsApp adapter** plus the Vite dev server,
   so you can develop without linking a real number.

## Workspace commands

| Command | What it does |
|---|---|
| `npm test` | Run all Vitest projects |
| `npm test -w @wa-team-inbox/server` | Run one workspace's tests |
| `npx vitest run path/to/file.test.ts -t "name"` | Run a single test |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run format` | Prettier |
| `npm run build -w @wa-team-inbox/web` | Build the web app |

## Conventions

- TypeScript strict, ESM everywhere.
- REST and socket payloads are defined once in `@wa-team-inbox/shared` (zod).
- Only `packages/wa/src/baileys/**` may import `baileys`.
- Never commit WhatsApp auth/session data, databases, `data/` dirs, or secrets.
- Web UI must be mobile responsive (usable at 360px wide, no horizontal scroll).

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
  `chore:`, `test:`, `refactor:` ...).
- Branch from `main`, keep PRs focused, and fill in the PR template.
- **Tests are required** for behavior changes. CI (lint, typecheck, tests, web build) must pass.
- Add a line to `CHANGELOG.md` under `[Unreleased]` for user-visible changes.

## Bugs and security issues

Use the GitHub issue templates for bugs and feature requests. For security issues, follow
[SECURITY.md](SECURITY.md) and do not open a public issue.
