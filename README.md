# WA Team Inbox

A desktop app (macOS and Windows) that links **one** WhatsApp number and turns it into a
**shared team inbox**. Your team works from a mobile-friendly web app (PWA) served by the
desktop app: on the same computer, over your LAN, or from anywhere through a Cloudflare
tunnel. Run it **standalone** (while the app is open) or as a **boot-time OS service**.

> **Status:** early development (v0.x). Not ready for production use.

## Disclaimer

- **WA Team Inbox is not affiliated with, endorsed by, or sponsored by WhatsApp or Meta.**
  "WhatsApp" is a trademark of its respective owner.
- It connects through [Baileys](https://github.com/WhiskeySockets/Baileys), an **unofficial**
  WhatsApp Web client library. Using unofficial clients is against WhatsApp's Terms of Service
  and **may get your number temporarily or permanently banned**. Use at your own risk.
- It is meant for answering real customer conversations as a team. **Do not use it for bulk
  messaging, spam, or automated marketing.**

## Features (planned for v1)

- Link one WhatsApp number by scanning a QR code
- Shared inbox: everyone sees all chats; assignment, internal notes, open / resolved
- Text, media in/out, groups, quick replies (`/` picker), typing indicators
- Web push notifications; installable PWA, fully mobile responsive
- Access locally, over LAN, or via a Cloudflare quick tunnel / named tunnel
- Admin: members and roles, WhatsApp status, tunnel, settings, audit log, log download
- Standalone mode or boot-time OS service (Windows service / macOS launchd daemon)
- Nightly local backups

## Install

Unsigned installers will be published on the GitHub Releases page once v1 is ready.

## Development

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev        # server with a fake WhatsApp adapter + web UI (Vite)
npm test           # all unit/integration tests (Vitest)
npm run lint
npm run typecheck
```

| Path              | Package                  | What                                                 |
| ----------------- | ------------------------ | ---------------------------------------------------- |
| `packages/shared` | `@wa-team-inbox/shared`  | zod schemas + types for REST and socket payloads     |
| `packages/wa`     | `@wa-team-inbox/wa`      | `WaAdapter` interface, Baileys adapter, fake adapter |
| `packages/server` | `@wa-team-inbox/server`  | Fastify + Socket.IO + SQLite server (owns all state) |
| `apps/web`        | `@wa-team-inbox/web`     | React PWA (Vite + Tailwind)                          |
| `apps/desktop`    | `@wa-team-inbox/desktop` | Electron shell, tray, service manager, packaging     |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Architecture overview

The server is a standalone Node program that owns the database and the WhatsApp connection.
The desktop app either runs it as a child process (standalone mode) or installs it as an OS
service. The web app talks to it over REST and Socket.IO. Design details live in
`docs/superpowers/specs/`.

## License

[MIT](LICENSE) (c) 2026 OSS Malaysia and contributors
