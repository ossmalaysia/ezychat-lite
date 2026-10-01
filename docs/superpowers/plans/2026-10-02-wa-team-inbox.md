# WA Team Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project the plan is executed by a multi-agent Workflow: each task is one agent; tasks in the same wave run in parallel and own disjoint files.

**Goal:** Build WA Team Inbox — an open-source Electron (Mac/Win) app that links one WhatsApp number through Baileys and serves a shared team inbox PWA locally, over LAN, or through a Cloudflare tunnel, in standalone or boot-time service mode.

**Architecture:** npm-workspaces monorepo. `packages/server` (Fastify + Socket.IO + better-sqlite3) is a standalone Node program that owns all state and the WhatsApp connection (through the `WaAdapter` interface in `packages/wa`). `apps/web` is a React PWA served by the server. `apps/desktop` is a thin Electron shell that either forks the server (`utilityProcess`) or installs it as an OS service. All REST/socket payload types live in `packages/shared` (zod).

**Tech Stack:** Node 22, TypeScript 5 (strict, ESM), Fastify 5, Socket.IO 4, better-sqlite3, @node-rs/argon2, zod, pino, web-push, baileys (latest stable 6.x/7.x — check context7/npm), React 18/19 + Vite + Tailwind 4 + react-router + TanStack Query, Electron (latest stable) + electron-builder, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-whatsapp-team-inbox-design.md` — read it before your task. The spec is authoritative for behavior; this plan is authoritative for file ownership and interfaces.

## Global Constraints

- Node >= 22; ESM everywhere (`"type": "module"`); TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- npm workspaces; package names `@wa-team-inbox/shared`, `@wa-team-inbox/wa`, `@wa-team-inbox/server`, `@wa-team-inbox/web`, `@wa-team-inbox/desktop`.
- Product name "WA Team Inbox"; never name the product "WhatsApp". appId `org.ossmalaysia.wateaminbox`.
- Default port 7420; bind 127.0.0.1 unless LAN enabled.
- Only `packages/wa/src/baileys/**` may import `baileys`.
- All REST bodies/responses and socket payloads use schemas/types from `@wa-team-inbox/shared`.
- Tests: Vitest; test files `*.test.ts` next to the code in `src/` (or `test/` for integration). Every task's tests must pass with `npm test -w <pkg>`.
- **Agents MUST NOT run `npm install` for new packages** except Task 1 (all dependencies are declared in Task 1). If a dependency is truly missing, add it to the package.json and run `npm install` once, reporting it.
- **Agents MUST NOT `git commit`**; the orchestrator commits after each wave. Agents only edit files they own (listed per task) plus files explicitly marked "append-only shared".
- Conventional Commits; MIT license header not required per file.
- No WhatsApp auth/session data, `.db`, or `data/` dirs committed.
- **Mobile responsive is mandatory for every web screen** (agents mainly use phones via the tunnel): mobile-first Tailwind; works at 360px width with no horizontal page scroll; `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; use `100dvh` (not `100vh`) and `env(safe-area-inset-*)` padding for header/composer; touch targets ≥ 44px; inputs font-size ≥ 16px (prevents iOS zoom); composer stays above the on-screen keyboard; inbox is single-pane < md with back navigation; admin tables collapse to stacked cards < md; admin side nav becomes a top tab/drawer menu < md; modals become full-screen sheets < sm. Playwright `mobile` project (Pixel 7) and an iPhone project (devices['iPhone 14']) must pass all e2e flows.

## Review Focus

1. **Duplicate/replayed Baileys events** (history sync + live upsert of the same message id) must not duplicate rows or double-increment `unread_count` → test in Task 7 (`ingest is idempotent`).
2. **Public setup race**: `POST /api/setup/admin` via tunnel (non-loopback) or after an admin exists must be rejected → test in Task 6.
3. **Spoofed `CF-Connecting-IP` from a non-loopback peer** must not change the rate-limit key → test in Task 6.
4. **Disabled user with an open socket / existing cookie** loses access immediately → test in Task 8 (socket kicked) and Task 6 (cookie rejected).
5. **Sending while WhatsApp is disconnected / message older than 10 min** stays pending then fails, never sends late → test in Task 7 (send queue).

---

## File ownership map (summary)

| Task | Owns |
|---|---|
| 1 | root config, OSS files, `.github/**`, all `package.json`/`tsconfig*.json`, `packages/*/src/index.ts` placeholders |
| 2 | `packages/shared/src/**` |
| 3 | `packages/wa/src/{types.ts,fake/**,index.ts}` |
| 4 | `packages/wa/src/baileys/**` |
| 5 | `packages/server/src/{config.ts,cli.ts,main.ts,app.ts,bus.ts,context.ts,db/**,crypto/**,lock.ts,logger.ts,http/**,routes/index.ts}` + stub route files |
| 6 | `packages/server/src/{auth/**,routes/{setup,auth,users}.ts}` |
| 7 | `packages/server/src/{chats/**,messages/**,wa-bridge/**,routes/{chats,messages,notes,media,quick-replies}.ts}` |
| 8 | `packages/server/src/{realtime/**,push/**,routes/push.ts}` |
| 9 | `packages/server/src/{tunnel/**,routes/tunnel.ts}` |
| 10 | `packages/server/src/{admin/**,backup/**,routes/{settings,audit,wa,dev}.ts}` |
| 11 | `apps/web/src/{main.tsx,App.tsx,api/**,auth/**,setup/**,components/ui/**,lib/**}`, `apps/web/{index.html,vite.config.ts,public/**}` |
| 12 | `apps/web/src/inbox/**` |
| 13 | `apps/web/src/admin/**`, `apps/web/src/pwa/**`, `apps/web/src/sw.ts` |
| 14 | `apps/desktop/src/**` (main, tray, standalone, service), `apps/desktop/electron-builder.yml`, `scripts/fetch-cloudflared.mjs`, `resources/**` |
| 15 | `e2e/**`, `playwright.config.ts` |
| 16 | `CLAUDE.md`, `README.md` final pass, `docs/architecture.md` |

Waves: **W1** = Task 1 → **W2** = Tasks 2, 3 → **W3** = Tasks 4, 5, 11 → **W4** = Tasks 6, 9, 10(part: routes stubs ok), 12 → **W5** = Tasks 7, 13, 14 → **W6** = Task 8 → **W7** = Tasks 15, 16 → final review + fix.
(The orchestrator may reorder within dependency constraints listed per task.)

---

### Task 1: Monorepo scaffold, OSS files, CI

**Depends on:** nothing.

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `.npmrc`, `eslint.config.js`, `.prettierrc`, `vitest.workspace.ts` (or root `vitest.config.ts` with projects)
- Create: `LICENSE`, `README.md` (initial), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`
- Create per package: `packages/{shared,wa,server}/package.json`, `tsconfig.json`, `src/index.ts` (placeholder `export {}`), `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/desktop/package.json`, `apps/desktop/tsconfig.json`
- Replace: `CLAUDE.md` with a short placeholder (Task 16 writes the real one)

**Interfaces — Produces:**
- Root scripts: `build` (`npm run build --workspaces --if-present`), `test` (`vitest run`), `lint` (`eslint .`), `typecheck` (`tsc -b` or per-workspace `typecheck`), `dev` (runs server with `--fake-wa` + web vite dev concurrently via `concurrently`), `format`.
- Per package scripts: `build`, `test` (`vitest run`), `typecheck` (`tsc --noEmit`).
- Package internal imports via workspace names, e.g. `import { ChatSchema } from '@wa-team-inbox/shared'`. Libraries (`shared`, `wa`) export TS source via `"exports": { ".": { "types": "./src/index.ts", "import": "./dist/index.js", "default": "./src/index.ts" } }` and server/dev runs with `tsx`; build with `tsc` (or tsup) to `dist/`.

**Dependencies to declare and install (all in this task):**
- root dev: `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `concurrently`, `@playwright/test`
- shared: `zod`
- wa: `baileys`, `pino`, `qrcode`; dev `@types/qrcode`
- server: `fastify`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/static`, `@fastify/helmet`, `socket.io`, `better-sqlite3`, `@node-rs/argon2`, `zod`, `pino`, `pino-roll`, `web-push`, `file-type`, `mime-types`, `archiver`; dev `@types/better-sqlite3`, `@types/web-push`, `@types/mime-types`, `@types/archiver`, `socket.io-client`
- web: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `socket.io-client`, `qrcode.react`, `clsx`, `date-fns`; dev `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `vite-plugin-pwa`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@types/react`, `@types/react-dom`
- desktop: `electron` (dev), `electron-builder` (dev), `sudo-prompt`

- [ ] **Step 1:** Write all config + OSS files per spec §13 (Contributor Covenant 2.1 text by reference link + enforcement contact `conduct@ossmalaysia.org`-style placeholder is NOT allowed; use "open a private report via GitHub Security Advisories / contact the maintainers via GitHub"). README must include the non-affiliation + ban-risk disclaimer.
- [ ] **Step 2:** `.gitignore` includes: `node_modules/`, `dist/`, `out/`, `release/`, `data/`, `*.db`, `*.db-*`, `wa-auth/`, `.env*`, `coverage/`, `playwright-report/`, `test-results/`, `resources/cloudflared/*/cloudflared*`, `.DS_Store`, `graphify-out/`.
- [ ] **Step 3:** CI `ci.yml`: on push/PR to main; matrix `ubuntu-latest, windows-latest, macos-latest`; Node 22; `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build -w @wa-team-inbox/web`. `release.yml`: on tag `v*`, matrix windows/macos, `npm ci`, `node scripts/fetch-cloudflared.mjs`, `npm run dist -w @wa-team-inbox/desktop`, upload with `softprops/action-gh-release`. Pin actions to major versions.
- [ ] **Step 4:** `npm install` at root; verify `npm run typecheck` and `npm test` succeed (vitest with `--passWithNoTests`).
- [ ] **Step 5:** Verify better-sqlite3 loads: `node -e "new (require('better-sqlite3'))(':memory:')"` from `packages/server` (use `createRequire` if ESM).

---

### Task 2: Shared schemas (`packages/shared`)

**Depends on:** Task 1.

**Files:** Create `packages/shared/src/{index.ts,enums.ts,models.ts,api.ts,socket.ts,errors.ts}`, test `packages/shared/src/schemas.test.ts`.

**Interfaces — Produces (exact names):**

```ts
// enums.ts
export const Role = z.enum(['admin', 'agent']);
export const ChatType = z.enum(['dm', 'group']);
export const ChatStatus = z.enum(['open', 'resolved']);
export const MessageType = z.enum(['text','image','video','audio','document','sticker','system']);
export const MessageStatus = z.enum(['pending','sent','delivered','read','failed']);
export const MediaStatus = z.enum(['none','ok','failed','pending']);
export const WaState = z.enum(['disconnected','connecting','qr','open','logged_out','replaced','blocked']);
export const TunnelMode = z.enum(['off','quick','named']);
export const TunnelState = z.enum(['stopped','starting','running','error']);
export const ChatEventType = z.enum(['assigned','unassigned','resolved','reopened']);

// models.ts  (all timestamps are epoch milliseconds numbers)
export const UserSchema = z.object({ id: z.number(), username: z.string(), displayName: z.string(), role: Role, mustChangePassword: z.boolean(), disabled: z.boolean(), createdAt: z.number() });
export const ChatSchema = z.object({ jid: z.string(), type: ChatType, name: z.string(), avatarUrl: z.string().nullable(), unreadCount: z.number(), lastMessageAt: z.number().nullable(), lastMessagePreview: z.string().nullable(), status: ChatStatus, assignedTo: z.number().nullable(), updatedAt: z.number() });
export const MessageSchema = z.object({ id: z.string(), chatJid: z.string(), senderJid: z.string().nullable(), senderName: z.string().nullable(), fromMe: z.boolean(), sentByUserId: z.number().nullable(), type: MessageType, body: z.string().nullable(), mediaUrl: z.string().nullable(), mediaMime: z.string().nullable(), mediaName: z.string().nullable(), mediaStatus: MediaStatus, quotedId: z.string().nullable(), status: MessageStatus, error: z.string().nullable(), timestamp: z.number(), clientId: z.string().nullable() });
export const NoteSchema = z.object({ id: z.number(), chatJid: z.string(), userId: z.number(), body: z.string(), createdAt: z.number() });
export const ChatEventSchema = z.object({ id: z.number(), chatJid: z.string(), type: ChatEventType, actorId: z.number().nullable(), payload: z.record(z.unknown()), at: z.number() });
export const QuickReplySchema = z.object({ id: z.number(), shortcut: z.string().regex(/^[a-z0-9_-]{1,32}$/), body: z.string().min(1).max(4096), updatedAt: z.number() });
export const WaStatusSchema = z.object({ state: WaState, me: z.object({ jid: z.string(), name: z.string().nullable() }).nullable(), qr: z.string().nullable(), lastError: z.string().nullable() });
export const TunnelStatusSchema = z.object({ mode: TunnelMode, state: TunnelState, url: z.string().nullable(), hostname: z.string().nullable(), lastError: z.string().nullable(), logTail: z.array(z.string()) });
export const SettingsSchema = z.object({ port: z.number().int().min(1024).max(65535), lanEnabled: z.boolean(), historyDays: z.number().int().min(0).max(365), namedTunnelHostname: z.string().nullable(), hasTunnelToken: z.boolean() });
export const AuditEntrySchema = z.object({ id: z.number(), userId: z.number().nullable(), action: z.string(), ip: z.string().nullable(), meta: z.record(z.unknown()), at: z.number() });
// + inferred types: export type User = z.infer<typeof UserSchema>; etc. for every schema.

// api.ts — request bodies / queries / responses
export const SetupStatusResponse = z.object({ needsSetup: z.boolean() });
export const SetupAdminBody = z.object({ username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/), displayName: z.string().min(1).max(64), password: z.string().min(8).max(256) });
export const LoginBody = z.object({ username: z.string(), password: z.string() });
export const ChangePasswordBody = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(256) });
export const MeResponse = UserSchema;
export const ChatListQuery = z.object({ status: ChatStatus.optional(), assigned: z.enum(['me','none','any']).default('any'), q: z.string().optional(), cursor: z.string().optional(), since: z.coerce.number().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const ChatListResponse = z.object({ chats: z.array(ChatSchema), nextCursor: z.string().nullable() });
export const ChatPatchBody = z.object({ assignedTo: z.number().nullable().optional(), status: ChatStatus.optional() });
export const ChatDetailResponse = z.object({ chat: ChatSchema, events: z.array(ChatEventSchema) });
export const MessageListQuery = z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const MessageListResponse = z.object({ messages: z.array(MessageSchema), nextBefore: z.string().nullable() });
export const SendTextBody = z.object({ text: z.string().min(1).max(65536), quotedId: z.string().optional(), clientId: z.string().min(1).max(64) });
export const NoteBody = z.object({ body: z.string().min(1).max(8192) });
export const QuickReplyBody = z.object({ shortcut: QuickReplySchema.shape.shortcut, body: QuickReplySchema.shape.body });
export const CreateUserBody = z.object({ username: SetupAdminBody.shape.username, displayName: SetupAdminBody.shape.displayName, role: Role, password: z.string().min(8).max(256) });
export const PatchUserBody = z.object({ displayName: z.string().min(1).max(64).optional(), role: Role.optional(), disabled: z.boolean().optional() });
export const ResetPasswordResponse = z.object({ password: z.string() });
export const TunnelStartBody = z.object({ mode: z.enum(['quick','named']), token: z.string().min(10).optional(), hostname: z.string().optional() });
export const SettingsPatchBody = SettingsSchema.omit({ hasTunnelToken: true }).partial();
export const PushSubscribeBody = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });
export const HealthResponse = z.object({ app: z.literal('wa-team-inbox'), version: z.string(), mode: z.enum(['standalone','service','dev']) });
export const FakeIncomingBody = z.object({ chatJid: z.string(), text: z.string(), senderName: z.string().optional(), type: MessageType.optional() });

// errors.ts
export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export const ErrorCode = { UNAUTHORIZED:'unauthorized', FORBIDDEN:'forbidden', NOT_FOUND:'not_found', VALIDATION:'validation', RATE_LIMITED:'rate_limited', CONFLICT:'conflict', WA_UNAVAILABLE:'wa_unavailable', BAD_ORIGIN:'bad_origin' } as const;

// socket.ts
export interface ServerToClientEvents {
  'message:new': (m: Message) => void;
  'message:status': (p: { id: string; clientId: string | null; chatJid: string; status: MessageStatus; error: string | null; newId?: string }) => void;
  'chat:updated': (c: Chat) => void;
  'chat:event': (e: ChatEvent) => void;
  'note:new': (n: Note) => void;
  'typing': (p: { chatJid: string; userId: number; displayName: string }) => void;
  'wa:status': (s: WaStatus) => void;
  'tunnel:status': (s: TunnelStatus) => void;
  'session:revoked': () => void;
}
export interface ClientToServerEvents { 'typing': (p: { chatJid: string }) => void; }
```

- [ ] **Step 1:** Write `schemas.test.ts` covering: SetupAdminBody rejects 7-char password; QuickReply shortcut rejects `"Hello World"`; ChatListQuery coerces `limit:"10"` → 10 and defaults `assigned` to `any`; MessageSchema parses a full sample.
- [ ] **Step 2:** Run `npm test -w @wa-team-inbox/shared` → FAIL.
- [ ] **Step 3:** Implement all files above; `index.ts` re-exports everything.
- [ ] **Step 4:** Tests + `npm run typecheck -w @wa-team-inbox/shared` pass.

---

### Task 3: WaAdapter interface + FakeWaAdapter (`packages/wa`)

**Depends on:** Tasks 1, 2.

**Files:** Create `packages/wa/src/types.ts`, `packages/wa/src/fake/fake-adapter.ts`, `packages/wa/src/fake/fake-adapter.test.ts`, `packages/wa/src/index.ts`.

**Interfaces — Produces:**

```ts
import type { WaStatus, MessageType } from '@wa-team-inbox/shared';
import { EventEmitter } from 'node:events';

export interface WaIncomingMessage {
  id: string; chatJid: string; senderJid: string | null; senderName: string | null;
  fromMe: boolean; type: MessageType; body: string | null; quotedId: string | null;
  timestamp: number;                       // ms
  media: null | { mime: string; fileName: string | null; download: () => Promise<Buffer> };
}
export interface WaChatInfo { jid: string; type: 'dm' | 'group'; name: string | null; }
export interface WaContactInfo { jid: string; pushName: string | null; savedName: string | null; }
export interface WaMessageStatusUpdate { id: string; chatJid: string; status: 'sent' | 'delivered' | 'read' | 'failed'; }

export interface WaAdapterEvents {
  status: [WaStatus];
  message: [WaIncomingMessage, { source: 'live' | 'history' }];
  messageStatus: [WaMessageStatusUpdate];
  chats: [WaChatInfo[]];
  contacts: [WaContactInfo[]];
}

export interface SendResult { id: string; timestamp: number; }

export interface WaAdapter {
  readonly status: WaStatus;
  on<K extends keyof WaAdapterEvents>(ev: K, fn: (...a: WaAdapterEvents[K]) => void): this;
  off<K extends keyof WaAdapterEvents>(ev: K, fn: (...a: WaAdapterEvents[K]) => void): this;
  connect(): Promise<void>;                 // idempotent
  disconnect(): Promise<void>;              // close socket, keep auth
  logout(): Promise<void>;                  // unlink device + wipe auth
  takeover(): Promise<void>;                // reconnect after 'replaced'
  sendText(chatJid: string, text: string, opts?: { quotedId?: string }): Promise<SendResult>;
  sendMedia(chatJid: string, file: { buffer: Buffer; mime: string; fileName: string; caption?: string }, opts?: { quotedId?: string }): Promise<SendResult>;
  markRead(chatJid: string, messageIds: string[]): Promise<void>;
  sendPresence(chatJid: string, presence: 'composing' | 'paused'): Promise<void>;
  downloadMedia(messageId: string): Promise<Buffer | null>; // re-download by id if still cached
  getProfilePicture(jid: string): Promise<string | null>;   // URL
}

export interface WaAdapterOptions { authDir: string; historyDays: number; logger?: import('pino').Logger; }
```

`FakeWaAdapter implements WaAdapter` (extends EventEmitter): constructor `(opts?: { autoOpen?: boolean })` (default true → `connect()` emits `connecting` then `open` with `me: { jid: '60000000000@s.whatsapp.net', name: 'Fake' }`). Extra test helpers: `simulateIncoming(p: Partial<WaIncomingMessage> & { chatJid: string; body: string }): WaIncomingMessage` (generates id `FAKE-<n>`, emits `message` with source live), `simulateStatus(s: Partial<WaStatus>)`, `failNextSend(err?: Error)`, `sent: Array<{ chatJid; text?; file?; id }>`, `setConnected(boolean)`. `sendText` throws `new WaUnavailableError()` when state !== 'open'. Sent ids `FAKE-OUT-<n>`; after send emits `messageStatus` `sent` then (setImmediate) `delivered`.

Export from `index.ts`: all types, `FakeWaAdapter`, `WaUnavailableError` (class extends Error, `code='wa_unavailable'`), and `createBaileysAdapter` (re-exported from `./baileys/index.js` — Task 4 creates it; until then Task 3 must NOT export it, Task 4 adds the export line — `index.ts` is append-only shared between Tasks 3 and 4).

- [ ] **Step 1:** Test: connect emits connecting→open; simulateIncoming emits message with source live; sendText records + emits sent/delivered; sendText while disconnected rejects WaUnavailableError; failNextSend rejects once.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement. **Step 4:** pass + typecheck.

---

### Task 4: BaileysAdapter (`packages/wa/src/baileys`)

**Depends on:** Task 3.

**Files:** Create `packages/wa/src/baileys/{index.ts,adapter.ts,mapping.ts,disconnect.ts,auth-store.ts}`, tests `mapping.test.ts`, `disconnect.test.ts`. Modify (append line): `packages/wa/src/index.ts` → `export { createBaileysAdapter } from './baileys/index.js';`

**Interfaces — Produces:** `createBaileysAdapter(opts: WaAdapterOptions): WaAdapter`.
- `disconnect.ts`: `export type DisconnectAction = 'reconnect' | 'logged_out' | 'replaced' | 'bad_session' | 'blocked'; export function classifyDisconnect(statusCode: number | undefined): DisconnectAction` — maps per spec §8 using Baileys `DisconnectReason` numeric values (loggedOut 401, connectionReplaced 440, badSession 500, forbidden 403, multideviceMismatch 411, restartRequired 515, timedOut/connectionLost 408, connectionClosed 428, unavailableService 503 → reconnect). `export function backoffMs(attempt: number, rand = Math.random): number` = `min(60000, 2000 * 2^attempt) * (0.8 + 0.4*rand())`.
- `mapping.ts`: `export function mapWAMessage(msg: proto.IWebMessageInfo): WaIncomingMessage | null` — handles conversation, extendedTextMessage (with contextInfo.stanzaId → quotedId), imageMessage, videoMessage, audioMessage (ptt), documentMessage (fileName), stickerMessage, ignores protocolMessage/reactionMessage/senderKeyDistribution → null; group sender from `key.participant`; timestamp seconds→ms (handle Long). `export function jidType(jid: string): 'dm'|'group'|'other'` (`@g.us` group, `@s.whatsapp.net`/`@lid` dm, `status@broadcast`/`@newsletter`/`@broadcast` other → skipped).
- `auth-store.ts`: wraps `useMultiFileAuthState(authDir)`; `wipe()` removes dir; `backup()` copies to `${authDir}.bak-<ts>`.
- `adapter.ts`: uses `makeWASocket` with `fetchLatestBaileysVersion`, `browser: Browsers.appropriate('Desktop')` (or equivalent in installed version), `syncFullHistory: true`, `markOnlineOnConnect: false`, `shouldSyncHistoryMessage` honoring `historyDays`; handles `connection.update` (qr → status qr with QR string; open → status open; close → classifyDisconnect → action), `creds.update` → saveCreds, `messages.upsert` (type notify → live, append → history), `messaging-history.set` (filter by historyDays → history; chats; contacts), `messages.update` (status ack mapping: 2→sent, 3→delivered, 4/5→read, error→failed), `contacts.upsert/update`, `chats.upsert`, `groups.update` names. Media download via `downloadMediaMessage`. Keep an in-memory LRU (max 2000) of raw messages by id for `downloadMedia`/quoting.

**Note:** Before coding, check the installed `baileys` version's exports (`node -e "import('baileys').then(m=>console.log(Object.keys(m)))"` from packages/wa) and use context7 docs; API names differ between 6.x and 7.x.

- [ ] **Step 1:** Tests for `classifyDisconnect` (each code), `backoffMs` bounds (attempt 0 → 1600..2400; attempt 10 → ≤ 72000 and ≥ 48000), `mapWAMessage` for text, extended text with quote, image with caption, group participant, reaction → null, `jidType`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** pass + typecheck. (No live WhatsApp test; adapter.ts covered by manual checklist.)

---

### Task 5: Server core (`packages/server`)

**Depends on:** Tasks 2, 3.

**Files:** Create `packages/server/src/config.ts`, `cli.ts`, `main.ts`, `app.ts`, `bus.ts`, `context.ts`, `logger.ts`, `lock.ts`, `crypto/secret.ts`, `db/index.ts`, `db/migrations/001_init.sql`, `db/migrate.ts`, `db/settings.ts`, `db/audit.ts`, `http/errors.ts`, `http/origin.ts`, `http/client-ip.ts`, `http/security-headers.ts`, `routes/index.ts`, and **stub** route files each exporting `export default async function (app: FastifyInstance, ctx: AppContext) {}`: `routes/{health,setup,auth,users,chats,messages,notes,media,quick-replies,push,tunnel,settings,audit,wa,dev}.ts` (health implemented here; others stubs that later tasks replace wholesale). Tests: `db/migrate.test.ts`, `crypto/secret.test.ts`, `lock.test.ts`, `http/client-ip.test.ts`, `http/origin.test.ts`, `test/helpers.ts`, `app.test.ts`.

**Interfaces — Produces:**

```ts
// config.ts
export interface ServerConfig { dataDir: string; port: number; host: string; mode: 'standalone'|'service'|'dev'; fakeWa: boolean; webDistDir: string | null; version: string; }
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ServerConfig & { resetAdmin: boolean };
// flags: --data <dir> (required unless WATI_DATA env), --port <n> (default from settings or 7420), --host, --mode, --fake-wa, --web-dist <dir>, --reset-admin

// db/index.ts
export type DB = import('better-sqlite3').Database;
export function openDb(file: string): DB;   // WAL, busy_timeout=5000, foreign_keys=ON, runs migrations
// db/migrate.ts: export function migrate(db: DB): void  — reads db/migrations/*.sql in order, PRAGMA user_version
// 001_init.sql creates ALL tables from spec §3 (users, sessions, chats, contacts, messages (+ client_id TEXT column, index on (chat_jid,timestamp,id) and unique client_id), notes, chat_events, quick_replies, push_subscriptions, settings, audit_log). Columns snake_case; timestamps INTEGER ms; booleans INTEGER 0/1.

// db/settings.ts
export class SettingsStore { constructor(db: DB, secret: SecretBox); get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void; getSecret(key: string): string | null; setSecret(key: string, value: string | null): void; }
// db/audit.ts
export function audit(db: DB, e: { userId: number | null; action: string; ip: string | null; meta?: Record<string, unknown> }): void;

// crypto/secret.ts
export class SecretBox { static loadOrCreate(keyFile: string): SecretBox; encrypt(plain: string): string /* base64 iv.tag.ct */; decrypt(blob: string): string; }
export function randomToken(bytes?: number): string;  // base64url
export function sha256(s: string): string;            // hex

// lock.ts
export function acquireLock(dataDir: string): { release(): void };  // throws LockedError if a live pid holds it; stale lock (dead pid) is taken over

// bus.ts — in-process domain event bus (typed EventEmitter)
export interface BusEvents {
  'message:new': [Message]; 'message:status': [Parameters<ServerToClientEvents['message:status']>[0]];
  'chat:updated': [Chat]; 'chat:event': [ChatEvent]; 'note:new': [Note];
  'wa:status': [WaStatus]; 'tunnel:status': [TunnelStatus];
  'user:disabled': [number]; 'user:sessions-revoked': [number];
  'inbound:notify': [{ chat: Chat; message: Message }];   // for push routing
}
export class Bus { on/off/emit typed }

// context.ts
export interface AppContext { config: ServerConfig; db: DB; bus: Bus; log: Logger; secret: SecretBox; settings: SettingsStore; wa: WaAdapter; services: Services; }
export interface Services { [k: string]: unknown }  // later tasks attach: auth, chats, messages, tunnel, push, admin (each task declares its own interface via module augmentation:
// declare module '../context.js' { interface Services { auth: AuthService } })

// http/errors.ts
export class HttpError extends Error { constructor(public status: number, public code: string, message: string) }
export const errors = { unauthorized(), forbidden(), notFound(what?), validation(msg), conflict(msg), rateLimited(retryAfterSec), waUnavailable() };
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T>; // throws validation HttpError
// error handler registered in app.ts maps HttpError → { error: { code, message } } with status; ZodError → 400 validation; unknown → 500 'internal' (logged).

// http/client-ip.ts
export function clientIp(req: FastifyRequest): string; // socket remoteAddress; if loopback (127.0.0.1, ::1, ::ffff:127.0.0.1) and header cf-connecting-ip present → that header
export function isLoopback(addr: string | undefined): boolean;
export function isHttps(req: FastifyRequest): boolean; // req.protocol==='https' || (loopback && x-forwarded-proto==='https') || (loopback && cf-connecting-ip present)
// http/origin.ts — onRequest hook: for non-GET/HEAD/OPTIONS under /api, require Origin header host === Host header host, else 403 bad_origin. Requests with no Origin AND no Cookie are allowed (CLI/tests); with cookie but no Origin → 403.

// app.ts
export async function buildApp(ctx: AppContext): Promise<FastifyInstance>;  // registers cookie, multipart (64MB), helmet-like headers (http/security-headers.ts: CSP "default-src 'self'; img-src 'self' data: blob: https://*.whatsapp.net; media-src 'self' blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"), origin hook, error handler, routes/index.ts (registers all route modules with prefix /api, passing ctx), static web dist (if config.webDistDir) with SPA fallback to index.html for non-/api, non-/socket.io paths.
// main.ts
export async function startServer(cfg: ServerConfig, deps?: { wa?: WaAdapter }): Promise<{ app: FastifyInstance; ctx: AppContext; close(): Promise<void> }>;
//   acquires lock, opens db at <data>/app.db, SecretBox at <data>/secret.key, creates wa adapter (Fake if cfg.fakeWa else createBaileysAdapter({authDir: <data>/wa-auth, historyDays})), calls registered "service initializers" (see below), buildApp, listen, wa.connect(). Handles SIGINT/SIGTERM → close. Installs uncaughtException → log fatal + exit(1).
// Service initialization: main.ts imports `./services.ts` (owned by Task 5, append-only shared) which exports `export const initializers: Array<(ctx: AppContext) => void | Promise<void>> = [];` Later tasks append their initializer import + push (one line each).
// cli.ts: bin entry (`#!/usr/bin/env node`): parseArgs; if resetAdmin → open db, set first admin's password to randomToken(9), must_change_password=1, delete their sessions, print `New admin password for <username>: <pw>`, exit 0. Else startServer.

// test/helpers.ts
export async function makeTestApp(opts?: { wa?: FakeWaAdapter }): Promise<{ app: FastifyInstance; ctx: AppContext; wa: FakeWaAdapter; close(): Promise<void> }>; // temp dataDir (os.tmpdir), mode 'dev', fakeWa, no listen (use app.inject); runs initializers
export async function createUserAndLogin(t, opts: { username?: string; role?: 'admin'|'agent' }): Promise<{ user: User; cookie: string }>; // NOTE: implemented by Task 6 in test/auth-helpers.ts, not here.
```

`routes/health.ts`: `GET /api/health` → HealthResponse.

- [ ] **Step 1:** Tests: migrate creates all tables and sets user_version=1, idempotent second run; SecretBox roundtrip + tamper detection + same key file reused; lock: second acquire throws, stale pid taken over; clientIp: spoofed cf header from 10.0.0.5 ignored, honored from 127.0.0.1; origin hook: POST with cookie + mismatched Origin → 403, matching → passes; app.test: `GET /api/health` 200 with app 'wa-team-inbox'; unknown `/api/x` → 404 JSON error.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npm test -w @wa-team-inbox/server` + typecheck pass. Also `npx tsx packages/server/src/cli.ts --data ./tmp-data --fake-wa --port 7421` starts and `/api/health` responds (then stop, delete tmp-data).

---

### Task 6: Auth, setup, users (`packages/server`)

**Depends on:** Task 5.

**Files:** Create `src/auth/{service.ts,passwords.ts,rate-limit.ts,guards.ts,index.ts}`, replace `src/routes/{setup,auth,users}.ts`, tests `src/auth/rate-limit.test.ts`, `test/auth.test.ts`, `test/users.test.ts`, `test/auth-helpers.ts`. Append to `src/services.ts`.

**Interfaces — Produces:**

```ts
export interface AuthService {
  hasAnyUser(): boolean;
  createUser(i: { username: string; displayName: string; role: Role; password: string; mustChangePassword: boolean }): User; // conflict on dup username (case-insensitive)
  verifyLogin(username: string, password: string, ip: string): Promise<User>;  // rate-limit + lockout; throws unauthorized / rateLimited; disabled → unauthorized
  createSession(userId: number, meta: { ip: string; userAgent: string }): string;      // returns raw token
  resolveSession(rawToken: string): User | null;  // updates last_seen_at (at most once/min); expires after 30 days idle; disabled user → null
  destroySession(rawToken: string): void;
  revokeAll(userId: number): void;                 // emits bus 'user:sessions-revoked'
  changePassword(userId: number, current: string, next: string): Promise<void>;
  resetPassword(userId: number): Promise<string>;  // random 12-char, must_change_password=1, revokeAll
  listUsers(): User[]; updateUser(id: number, patch: PatchUserBody, actorId: number): User; // cannot demote/disable last active admin → conflict; disabling emits 'user:disabled' + revokeAll
  getUser(id: number): User | null;
}
// guards.ts
export function requireUser(ctx: AppContext): preHandlerHookHandler;   // reads cookie 'sid' → req.user; 401 otherwise; if user.mustChangePassword, only allow /api/me, /api/auth/change-password, /api/auth/logout
export function requireAdmin(ctx: AppContext): preHandlerHookHandler;
declare module 'fastify' { interface FastifyRequest { user?: User; sessionToken?: string } }
export const SESSION_COOKIE = 'sid';
export function setSessionCookie(reply, token, secure: boolean): void; // HttpOnly, SameSite=Lax, Path=/, Max-Age 30d
// rate-limit.ts
export class LoginRateLimiter { constructor(now?: () => number); check(username: string, ip: string): { ok: true } | { ok: false; retryAfterSec: number }; recordFailure(username: string, ip: string): void; recordSuccess(username: string): void; } // 5 fails/username/15min → lock 15min; 20 attempts/ip/60s
// test/auth-helpers.ts
export async function createUserAndLogin(t: { app; ctx }, opts?: { username?: string; role?: Role; password?: string }): Promise<{ user: User; cookie: string; password: string }>;
export function authHeaders(cookie: string): Record<string,string>; // { cookie, origin: 'http://localhost', host: 'localhost' }
```

Routes: `GET /api/setup/status`, `POST /api/setup/admin` (only if !hasAnyUser AND isLoopback(peer) AND no cf-connecting-ip header → creates admin, logs in (sets cookie), audits `setup.admin`; else 404 when users exist, 403 when non-loopback); `POST /api/auth/login` (audit `auth.login` / `auth.login_failed`), `POST /api/auth/logout`, `POST /api/auth/change-password`, `GET /api/me`; admin: `GET/POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `DELETE /api/users/:id/sessions` (all audited `user.*`). Passwords: `@node-rs/argon2` `hash`/`verify` (argon2id). Also export `resetFirstAdmin(db): { username: string; password: string }` used by cli.ts (Task 5's cli imports `../auth/reset.js` — Task 6 creates `src/auth/reset.ts`; Task 5 writes the cli import against this exact path and signature and may stub the file which Task 6 replaces).

- [ ] **Step 1:** Tests: setup status true then false; setup from non-loopback (inject with `remoteAddress: '10.1.1.1'`) → 403; setup with `cf-connecting-ip` header → 403; second setup → 404; login ok sets HttpOnly cookie; wrong password ×5 → 6th returns 429 even with correct password; spoofed cf-connecting-ip from non-loopback does not bypass IP limit; must_change_password blocks `/api/chats`-like guarded route (use `/api/users` as admin) until changed; disabled user cookie → 401; agent → `/api/users` 403; cannot disable last admin → 409; reset-password returns new password and old sessions invalid.
- [ ] **Step 2–4:** FAIL → implement → pass + typecheck.

---

### Task 7: Chats, messages, notes, quick replies, media, WA bridge (`packages/server`)

**Depends on:** Tasks 5, 6 (guards), 3.

**Files:** Create `src/chats/{repo.ts,service.ts}`, `src/messages/{repo.ts,service.ts,send-queue.ts,media-store.ts}`, `src/wa-bridge/{bridge.ts,index.ts}`, replace `src/routes/{chats,messages,notes,media,quick-replies}.ts`; tests `src/messages/send-queue.test.ts`, `src/wa-bridge/bridge.test.ts`, `test/chats.test.ts`, `test/messages.test.ts`, `test/quick-replies.test.ts`. Append to `src/services.ts`.

**Interfaces — Produces:**

```ts
export interface ChatService {
  list(q: ChatListQuery, userId: number): { chats: Chat[]; nextCursor: string | null }; // order last_message_at DESC, jid; cursor = base64url(`${last_message_at}_${jid}`); q searches name + contacts + jid
  get(jid: string): Chat | null; events(jid: string): ChatEvent[];
  upsertFromWa(info: WaChatInfo): Chat;
  patch(jid: string, body: ChatPatchBody, actorId: number): Chat;   // writes chat_events + emits chat:updated/chat:event; assignee must be active user
  markRead(jid: string, userId: number): Promise<void>;              // unread_count=0, wa.markRead(last inbound ids, best effort)
  addNote(jid: string, userId: number, body: string): Note; listNotes(jid: string): Note[];
}
export interface MessageService {
  list(jid: string, q: MessageListQuery): { messages: Message[]; nextBefore: string | null };  // DESC by (timestamp,id) then returned ASC; before = `${ts}_${id}`
  ingest(m: WaIncomingMessage, source: 'live'|'history'): Promise<Message | null>; // idempotent upsert by id; creates chat if missing; increments unread & reopens resolved chat only for NEW inbound live messages; downloads media to MediaStore (failure → media_status failed); emits message:new + chat:updated (+ 'inbound:notify' for new live inbound)
  sendText(jid: string, body: SendTextBody, userId: number): Message;            // inserts pending row (id = `local-${clientId}`), enqueues, returns immediately
  sendMedia(jid: string, file: { buffer: Buffer; fileName: string; caption?: string }, userId: number, clientId: string): Promise<Message>; // MIME via file-type (fallback mime-types by name), stores file first
  retry(id: string, userId: number): Message;                                    // failed → pending, re-enqueue
  applyStatus(u: WaMessageStatusUpdate): void;                                   // monotonic (never downgrade read→delivered)
  mediaPath(id: string): { path: string; mime: string; name: string | null } | null;
  redownload(id: string): Promise<Message>;
}
// send-queue.ts
export class SendQueue {
  constructor(deps: { send: (job: SendJob) => Promise<SendResult>; onSent(job, r: SendResult): void; onFailed(job, err: Error): void; isConnected(): boolean; presence?: (jid: string) => Promise<void>; now?: () => number; sleep?: (ms: number) => Promise<void>; maxAgeMs?: number /*600000*/; spacingMs?: number /*1000*/; });
  enqueue(job: SendJob): void;        // job: { localId: string; chatJid: string; createdAt: number; kind: 'text'|'media'; ... }
  onConnected(): void;                // flush
  restore(jobs: SendJob[]): void;     // from pending rows on startup
  stop(): void;
}
// FIFO per chat, chats processed concurrently; before sending: if now - createdAt > maxAgeMs → onFailed(new Error('expired')); if !isConnected → wait for onConnected; ≥ spacingMs between sends in same chat; presence('composing') before each send.
// media-store.ts
export class MediaStore { constructor(root: string); save(chatJid: string, msgId: string, buf: Buffer, ext: string): string /* relative path */; abs(rel: string): string; } // sanitize jid → [a-zA-Z0-9_-]
// wa-bridge/bridge.ts
export function attachWaBridge(ctx: AppContext): () => void; // wa 'message' → messages.ingest; 'messageStatus' → applyStatus; 'chats' → upsertFromWa; 'contacts' → contacts upsert; 'status' → persist last status in memory + bus 'wa:status'; when status becomes open → sendQueue.onConnected()
```

On `sendText` success: update row id from `local-<clientId>` to WA id (`UPDATE messages SET id=?`), status `sent`, emit `message:status` with `{ id: waId, clientId, newId: waId, status: 'sent' }`. Message rows expose `mediaUrl` = `/api/media/<id>` when media_path set. Chat `lastMessagePreview` = body truncated to 120 chars or `[Image]`/`[Video]`/`[Audio]`/`[Document] name`/`[Sticker]`.

Routes (all `requireUser`; quick replies write = `requireAdmin`):
`GET /api/chats`, `GET /api/chats/:jid` (ChatDetailResponse), `PATCH /api/chats/:jid`, `POST /api/chats/:jid/read`, `GET /api/chats/:jid/messages`, `POST /api/chats/:jid/messages` (201 Message), `POST /api/chats/:jid/media` (multipart fields `file`, `caption`, `clientId`), `POST /api/messages/:id/retry`, `GET/POST /api/chats/:jid/notes`, `GET /api/media/:msgId` (Range support, `Content-Disposition: inline` for image/video/audio else `attachment; filename=…`, `X-Content-Type-Options: nosniff`), `POST /api/media/:msgId/redownload`, quick replies CRUD. jid route params are URL-encoded.

- [ ] **Step 1:** Tests: send-queue (order per chat; waits while disconnected then flushes on onConnected; job older than 10 min fails with 'expired' and is never sent; failure → onFailed; spacing respected with fake clock); bridge/ingest (same message id twice incl. history+live → one row, unread 1; inbound on resolved chat reopens keeping assignee; fromMe from phone has sentByUserId null; history messages don't increment unread/reopen); routes (list filters mine/none/any + status + search + cursor paging; patch assign writes event; send text via FakeWaAdapter ends with status sent and WA id; send while fake disconnected stays pending; media upload of a PNG stores and serves with correct content-type & Range 206; quick replies agent write 403).
- [ ] **Step 2–4:** FAIL → implement → pass + typecheck.

---

### Task 8: Realtime (Socket.IO) + Web Push (`packages/server`)

**Depends on:** Tasks 5, 6, 7.

**Files:** Create `src/realtime/{socket.ts,index.ts}`, `src/push/{service.ts,vapid.ts,index.ts}`, replace `src/routes/push.ts`; tests `test/realtime.test.ts`, `src/push/service.test.ts`. Append to `src/services.ts`. Modify `src/main.ts` only to call `attachRealtime(httpServer, ctx)` (append-only: one import + one call after listen; `makeTestApp` gets an option `listen: true` returning `url` — Task 8 adds this option to `test/helpers.ts`).

**Interfaces — Produces:**
```ts
export function attachRealtime(server: import('node:http').Server, ctx: AppContext): { io: Server; close(): void; isOnline(userId: number): boolean };
// handshake: parse 'sid' cookie → auth.resolveSession; reject if null or mustChangePassword; join rooms `user:<id>`, 'all', admins → 'admins'; Origin check same as HTTP
// bus → io: message:new, message:status, chat:updated, chat:event, note:new → 'all'; wa:status → 'all' (strip qr for non-admins: emit full to 'admins', qr:null to agents); tunnel:status → 'admins'
// 'user:disabled' / 'user:sessions-revoked' → emit 'session:revoked' to user:<id> then disconnectSockets(true)
// client 'typing' {chatJid} → broadcast to others in 'all' as { chatJid, userId, displayName }, throttled 1/2s per user+chat
export interface PushService { publicKey(): string; subscribe(userId: number, sub: PushSubscribeBody): void; unsubscribe(userId: number, endpoint: string): void; notifyInbound(chat: Chat, message: Message): Promise<void>; notifyAdmins(title: string, body: string): Promise<void>; }
// VAPID keys generated once (web-push.generateVAPIDKeys), private key stored via settings.setSecret('vapid_private'); subject 'mailto:noreply@localhost' unless settings 'push_subject'.
// notifyInbound: targets = assignee ? [assignee] : all active users; skip users where realtime.isOnline(id); payload JSON { title: chat.name, body: preview, url: `/chats/${encodeURIComponent(jid)}`, tag: jid }; 404/410 response → delete subscription.
// bus 'inbound:notify' → notifyInbound; bus 'wa:status' with state logged_out|replaced|blocked → notifyAdmins.
// isOnline is provided to push via ctx.services.realtime (set when attachRealtime runs; push treats missing as "nobody online").
```
Routes: `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe` (body `{endpoint}`).

- [ ] **Step 1:** Tests: socket connects with valid cookie, rejected without; receives `message:new` after FakeWaAdapter simulateIncoming; agent socket does not receive qr; disabling user disconnects their socket with `session:revoked`; typing relayed to other user but not sender; push routing: assignee online → no push, assignee offline → push to assignee only, unassigned → all offline active users (mock web-push `sendNotification` via injected sender function), 410 removes subscription.
- [ ] **Step 2–4:** FAIL → implement → pass + typecheck.

---

### Task 9: Tunnel manager (`packages/server`)

**Depends on:** Task 5 (and Task 6 guards for routes).

**Files:** Create `src/tunnel/{manager.ts,parse.ts,binary.ts,index.ts}`, replace `src/routes/tunnel.ts`, tests `src/tunnel/parse.test.ts`, `src/tunnel/manager.test.ts`. Append to `src/services.ts`.

**Interfaces — Produces:**
```ts
export function parseQuickTunnelUrl(line: string): string | null; // matches https://<sub>.trycloudflare.com
export function resolveCloudflaredPath(env: NodeJS.ProcessEnv, resourcesDir?: string): string | null; // WATI_CLOUDFLARED env → resourcesDir/cloudflared/<platform>-<arch>/cloudflared(.exe) → 'cloudflared' on PATH (which) → null
export interface TunnelService { status(): TunnelStatus; start(body: TunnelStartBody, actorId: number): Promise<TunnelStatus>; stop(actorId: number): Promise<TunnelStatus>; restore(): Promise<void>; shutdown(): Promise<void>; }
export class TunnelManager implements TunnelService {
  constructor(deps: { spawn: typeof import('node:child_process').spawn; binPath: () => string | null; port: () => number; settings: SettingsStore; bus: Bus; log: Logger; now?: () => number; setTimeout?: typeof setTimeout });
}
// args quick: ['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${port}`]; named: ['tunnel','--no-autoupdate','run','--token', token]
// stdout+stderr lines → ring buffer (50); quick: url parsed → state running; named: line containing 'Registered tunnel connection' → running
// unexpected exit → restart with backoff 1s,2s,4s..60s; 5 consecutive failures (exit within 30s of start) → state error, lastError
// persists settings 'tunnel_mode' and token via setSecret('tunnel_token'); restore() starts previous mode; missing binary → state error 'cloudflared not found'
// emits bus 'tunnel:status' on every change; audits tunnel.start / tunnel.stop
```
Routes (admin): `GET /api/tunnel`, `POST /api/tunnel/start`, `POST /api/tunnel/stop`.

- [ ] **Step 1:** Tests with fake spawn (EventEmitter child with stdout/stderr PassThrough): quick URL parsed from stderr line `|  https://abc-def.trycloudflare.com  |`; named running on registration line; crash → restart scheduled; 5 fast crashes → error; stop kills child and sets stopped/off; token stored encrypted (settings value ≠ token).
- [ ] **Step 2–4:** FAIL → implement → pass + typecheck.

---

### Task 10: Admin: settings, audit, logs, WA control, backups, dev endpoint (`packages/server`)

**Depends on:** Tasks 5, 6.

**Files:** Create `src/admin/{settings-service.ts,logs.ts,index.ts}`, `src/backup/{backup.ts,scheduler.ts}`, replace `src/routes/{settings,audit,wa,dev}.ts`; tests `test/admin.test.ts`, `src/backup/backup.test.ts`. Append to `src/services.ts`.

**Interfaces / behavior:**
- `GET /api/settings` (admin) → SettingsSchema (port, lanEnabled, historyDays, namedTunnelHostname, hasTunnelToken); `PATCH /api/settings` → saves; port/lan changes return `{ settings, restartRequired: true }`. Audits `settings.update`.
- `GET /api/audit?limit=&before=` (admin) → `{ entries: AuditEntry[] }`.
- `GET /api/logs/download` (admin) → zip (archiver) of `<data>/logs/*`.
- `GET /api/wa/status` (any user; `qr` null for agents), `POST /api/wa/logout` (admin; wa.logout; audit), `POST /api/wa/relink` (admin; wa.logout then wa.connect), `POST /api/wa/takeover` (admin; wa.takeover).
- `POST /api/dev/fake-incoming` registered **only** when `config.fakeWa` → calls `(ctx.wa as FakeWaAdapter).simulateIncoming(...)`; requires login.
- `backup.ts`: `export async function runBackup(dataDir: string, db: DB, now = new Date()): Promise<string>` → `VACUUM INTO backups/app-YYYYMMDD.db` (overwrite same-day), copy `wa-auth` → `backups/wa-auth-YYYYMMDD/`, keep newest 7 of each. `scheduler.ts`: `startBackupScheduler(ctx)` runs at startup if today's missing, then every 24h (`unref`).
- Logger file output: Task 5's logger writes to `<data>/logs/server.log` via pino-roll (daily, 14 files); Task 10 only reads that dir.

- [ ] **Step 1:** Tests: agent gets 403 on settings; patch historyDays persists; wa status for agent has qr null while admin sees qr (use FakeWaAdapter.simulateStatus({state:'qr', qr:'abc'})); fake-incoming creates a chat visible in `/api/chats` (only after Task 7 — if Task 7 not merged yet, assert 200 and adapter emitted); dev route absent when fakeWa false → 404; backup creates file and prunes to 7.
- [ ] **Step 2–4:** FAIL → implement → pass + typecheck.

---

### Task 11: Web app shell, API client, auth & setup screens (`apps/web`)

**Depends on:** Tasks 1, 2.

**Files:** Create `apps/web/index.html`, `vite.config.ts` (react, tailwind, dev proxy `/api` & `/socket.io` → `http://127.0.0.1:7420` with ws), `src/main.tsx`, `src/App.tsx` (routes), `src/index.css`, `src/api/{client.ts,queries.ts,socket.ts}`, `src/auth/{AuthProvider.tsx,LoginPage.tsx,ChangePasswordPage.tsx,RequireAuth.tsx}`, `src/setup/{SetupWizard.tsx,WaLinkStep.tsx}`, `src/components/ui/{Button.tsx,Input.tsx,Card.tsx,Spinner.tsx,Banner.tsx,Avatar.tsx,Modal.tsx}`, `src/lib/{format.ts,jid.ts}`, `public/{icon.svg,icon-192.png,icon-512.png}` (generate simple PNG icons programmatically or use SVG-only + note), tests `src/api/client.test.ts`, `src/auth/LoginPage.test.tsx`, `vitest.config.ts` (jsdom).

**Interfaces — Produces:**
```ts
// api/client.ts
export class ApiError extends Error { status: number; code: string; }
export async function api<T>(path: string, init?: { method?: string; body?: unknown; form?: FormData; schema?: z.ZodType<T> }): Promise<T>; // fetch(`/api${path}`, credentials 'same-origin', JSON); non-2xx → ApiError from ApiErrorSchema; 401 → dispatch window event 'wati:unauthorized'
// api/queries.ts — TanStack Query hooks (exact names; later tasks use them):
useMe(), useSetupStatus(), useLogin(), useLogout(), useChangePassword(),
useChats(filters: { status?: ChatStatus; assigned: 'me'|'none'|'any'; q?: string }) /* useInfiniteQuery */, useChat(jid), useMessages(jid) /* useInfiniteQuery, older pages via before */, useSendText(jid), useSendMedia(jid), useRetryMessage(), usePatchChat(jid), useMarkRead(jid), useNotes(jid), useAddNote(jid),
useQuickReplies(), useSaveQuickReply(), useDeleteQuickReply(),
useUsers(), useCreateUser(), usePatchUser(), useResetPassword(), useRevokeSessions(),
useWaStatus(), useWaAction() /* (action: 'logout'|'relink'|'takeover') */, useTunnel(), useStartTunnel(), useStopTunnel(), useSettings(), usePatchSettings(), useAudit()
export const qk = { me: ['me'], chats: (f) => ['chats', f], chat: (jid) => ['chat', jid], messages: (jid) => ['messages', jid], notes: (jid) => ['notes', jid], quickReplies: ['quick-replies'], users: ['users'], wa: ['wa'], tunnel: ['tunnel'], settings: ['settings'], audit: ['audit'] };
// api/socket.ts
export function useRealtime(): { connected: boolean; typing: Record<string /*jid*/, { userId: number; displayName: string; at: number }[]>; emitTyping(jid: string): void }; // provider <RealtimeProvider> wraps app; on events updates query cache: message:new → append to messages(jid) + invalidate chats; message:status → patch message by clientId/id; chat:updated → setQueryData chat + invalidate chats lists; note:new → notes; wa:status → wa; tunnel:status → tunnel; session:revoked → logout redirect. On reconnect → invalidate all.
export const RealtimeProvider: React.FC<{ children: React.ReactNode }>;
```
Routes in `App.tsx`: `/setup` (wizard: admin form → WaLinkStep showing QR from useWaStatus via `qrcode.react`, "Skip for now" → `/`), `/login`, `/change-password`, `/` + `/chats/:jid` → `InboxPage` (imported from `./inbox/InboxPage` — Task 12; Task 11 creates a placeholder `src/inbox/InboxPage.tsx` that Task 12 replaces), `/admin/*` → `AdminLayout` (from `./admin/AdminLayout`, placeholder created by Task 11, replaced by Task 13). Boot logic: setup status needsSetup → `/setup`; no user → `/login`; mustChangePassword → `/change-password`.

UI style: Tailwind, clean neutral palette with an emerald accent (not WhatsApp branding/logo), dark mode via `prefers-color-scheme`, mobile-first.

- [ ] **Step 1:** Tests: api() throws ApiError with code from JSON error body; LoginPage submits username/password and shows server error message.
- [ ] **Step 2–4:** FAIL → implement → pass; `npm run build -w @wa-team-inbox/web` succeeds; typecheck.

---

### Task 12: Inbox & conversation UI (`apps/web/src/inbox`)

**Depends on:** Task 11 (hooks), Task 2.

**Files:** Create `src/inbox/{InboxPage.tsx,ChatList.tsx,ChatListItem.tsx,ChatFilters.tsx,Conversation.tsx,ConversationHeader.tsx,MessageList.tsx,MessageBubble.tsx,MediaView.tsx,Composer.tsx,QuickReplyPicker.tsx,NotesPanel.tsx,EventItem.tsx,TypingIndicator.tsx,WaBanner.tsx,timeline.ts}`, tests `src/inbox/timeline.test.ts`, `src/inbox/Composer.test.tsx`, `src/inbox/QuickReplyPicker.test.tsx`.

**Behavior:** two-pane on ≥ md (list 360px + conversation), single pane on mobile with back button. Filters: Mine / Unassigned / All tabs + Open/Resolved toggle + search (debounced 300ms). List items: avatar initials, name, preview, time (`date-fns` relative), unread badge, assignee chip, group icon. Conversation header: name, jid/phone, assign dropdown (users list + "Unassigned"), Resolve/Reopen button, Notes toggle. Message list: infinite scroll upwards (load older on top sentinel), day separators, bubbles left (inbound, group sender name) / right (outbound, label "<agent name>" or "via phone"), status ticks (pending clock, sent ✓, delivered ✓✓, read ✓✓ accent, failed ! + Retry), quoted preview, media (image thumbnail → lightbox, video/audio `<audio controls>`/`<video controls>`, document card with download), auto-scroll to bottom on new message if near bottom. `timeline.ts`: `export function buildTimeline(messages: Message[], events: ChatEvent[], notes: Note[]): TimelineItem[]` merges sorted by time with day separators (`{kind:'day', date}`), events and notes rendered inline as center chips/yellow cards. Composer: autosize textarea, Enter sends (Shift+Enter newline; on mobile Enter = newline, send button), `/` at start opens QuickReplyPicker filtered by shortcut prefix, ↑/↓/Enter/Tab to choose, inserts body; attach button (file input, caption = current text); emits typing (throttled 2s); if chat assigned to someone else → first send asks confirm modal "Assigned to X — reply anyway?" (remember per chat for session); disabled with banner when WA state not open (messages still queue — show "will send when reconnected"). Optimistic send with clientId (`crypto.randomUUID()`). Mark read on open + when new inbound arrives while viewing. WaBanner at top of InboxPage for states other than open (admin sees link to /admin/whatsapp).

- [ ] **Step 1:** Tests: buildTimeline ordering & day separators across two days; Composer Enter sends and clears, Shift+Enter newline; QuickReplyPicker filters `/pr` to `/price` and inserts body on Enter.
- [ ] **Step 2–4:** FAIL → implement → pass; web build + typecheck.

---

### Task 13: Admin UI + PWA/push (`apps/web/src/admin`, `src/pwa`, `src/sw.ts`)

**Depends on:** Task 11.

**Files:** Create `src/admin/{AdminLayout.tsx,MembersPage.tsx,QuickRepliesPage.tsx,WhatsAppPage.tsx,TunnelPage.tsx,SettingsPage.tsx,AuditPage.tsx}`, `src/pwa/{registerSW.ts,PushToggle.tsx,InstallHint.tsx}`, `src/sw.ts`, modify `vite.config.ts` (append VitePWA plugin with `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, manifest name "WA Team Inbox", short_name "Team Inbox", theme `#059669`, icons). Tests `src/admin/MembersPage.test.tsx`.

**Behavior:** AdminLayout: side nav (Members, Quick replies, WhatsApp, Tunnel, Settings, Audit) — non-admins redirected to `/`. Members: table, create modal (username, display name, role, temp password generator), edit role/disable, reset password (shows new password once with copy), revoke sessions. Quick replies: list + create/edit/delete. WhatsApp: state badge, linked number, QR (qrcode.react) when state qr, Logout / Re-link / Take over buttons with confirm. Tunnel: mode selector (Off / Quick / Named), token input (named) + hostname, Start/Stop, current URL as link + QR code for phones + copy button, state + error + log tail `<pre>`; notice that quick URLs change on restart. Settings: port, LAN toggle with HTTP warning, history days; "restart required" notice. Audit: paged table. Service worker `sw.ts`: precache (workbox `precacheAndRoute(self.__WB_MANIFEST)`), `push` → `showNotification(title, { body, tag, data: { url } })`, `notificationclick` → focus existing client & navigate or `openWindow(url)`. PushToggle (in user menu): checks `Notification` + `PushManager` support, requests permission, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid })` → POST `/api/push/subscribe`; shows InstallHint on iOS Safari when not standalone ("Add to Home Screen to receive notifications").

- [ ] **Step 1:** Test: MembersPage renders users from mocked query and opens create modal; submit calls create mutation with typed values.
- [ ] **Step 2–4:** FAIL → implement → pass; web build (with PWA) + typecheck.

---

### Task 14: Desktop app: standalone, tray, service mode, packaging (`apps/desktop`)

**Depends on:** Task 5 (server CLI/flags), Task 11 (web build output path).

**Files:** Create `apps/desktop/src/{main.ts,paths.ts,server-process.ts,detect.ts,tray.ts,window.ts,ipc.ts,preload.ts,service/{index.ts,windows.ts,macos.ts,data-move.ts}}`, `apps/desktop/src/renderer/status.html` (small local status/control page: mode, server state, service controls; uses preload IPC), `apps/desktop/electron-builder.yml`, `apps/desktop/build/` (icons, `winsw/` config template), `scripts/fetch-cloudflared.mjs`, `scripts/fetch-winsw.mjs`, `scripts/bundle-server.mjs` (esbuild bundle of `packages/server/src/cli.ts` → `apps/desktop/dist/server/server.cjs` or `.mjs`, externalizing `better-sqlite3` & `@node-rs/argon2` native modules which are shipped in node_modules), tests `src/paths.test.ts`, `src/service/windows.test.ts`, `src/service/macos.test.ts`, `src/detect.test.ts`.

**Interfaces / behavior:**
```ts
// paths.ts
export function userDataDir(app): string;                                         // app.getPath('userData')/data
export function machineDataDir(platform = process.platform, env = process.env): string; // win: `${env.ProgramData ?? 'C:\\ProgramData'}\\wa-team-inbox`; mac: '/Library/Application Support/wa-team-inbox'
export function serverEntry(isPackaged: boolean, resourcesPath: string, appPath: string): string;
export function webDistDir(...): string; export function cloudflaredDir(...): string;
// detect.ts
export async function probeServer(port: number, fetchImpl = fetch): Promise<null | { mode: 'standalone'|'service'|'dev'; version: string }>; // GET http://127.0.0.1:<port>/api/health, 1.5s timeout, validates app === 'wa-team-inbox'
// server-process.ts
export class StandaloneServer { constructor(opts: { entry: string; dataDir: string; port: number; webDist: string; cloudflaredDir: string; log: (s: string) => void }); start(): void; stop(): Promise<void>; on('state', (s: 'starting'|'running'|'crashed'|'stopped') => void) } // utilityProcess.fork(entry, ['--data', dataDir, '--port', String(port), '--mode', 'standalone', '--web-dist', webDist], { env: { ...process.env, WATI_CLOUDFLARED_DIR } }); restart with backoff on unexpected exit (1s→30s)
// service/windows.ts — pure builders (unit tested) + executor
export function winswXml(o: { id: string; name: string; exe: string; args: string[]; env: Record<string,string>; logDir: string }): string; // <service><id>…<executable>…<arguments>…<env name value/>…<startmode>Automatic</startmode><onfailure action="restart" delay="5 sec"/>…<log mode="roll-by-size">
export function windowsInstallScript(o): string; // copies winsw exe as `${id}.exe` + xml into machine dir `service/`, runs `install` + `start`; data-move step; icacls grants SYSTEM+Administrators only on data dir
// service/macos.ts
export function launchdPlist(o: { label: string; program: string; args: string[]; env: Record<string,string>; logDir: string }): string; // RunAtLoad true, KeepAlive true, StandardOut/ErrorPath
export function macInstallScript(o): string; // writes plist to /Library/LaunchDaemons/<label>.plist, chown root:wheel, chmod 644, data-move, chmod 700 data dir, launchctl bootstrap system <plist>
// service/index.ts
export interface ServiceManager { status(): Promise<'not-installed'|'stopped'|'running'>; install(): Promise<void>; uninstall(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; resetAdmin(): Promise<string /*output*/>; }
export function createServiceManager(platform: NodeJS.Platform, deps): ServiceManager; // runs generated scripts elevated via sudo-prompt (mac) / powershell Start-Process -Verb RunAs (win). The executable is process.execPath with env ELECTRON_RUN_AS_NODE=1 and args [serverEntry, '--data', machineDataDir, '--port', port, '--mode', 'service', '--web-dist', ..., ]
// service/data-move.ts
export function dataMoveCommands(platform, from: string, to: string): string[]; // shell lines; skip if from missing; refuse if `to` already has app.db (merge not supported) → error
```
- `main.ts` flow: single-instance lock → probe port (settings port stored in `userData/desktop.json`, default 7420). If a server responds with mode `service` → open window to `http://127.0.0.1:<port>` (client mode). Else start StandaloneServer then open window when health ok. Window close → hide to tray (app keeps running in standalone; in service mode close = quit allowed). Tray menu: Open, Status & Service… (status.html window), Copy tunnel URL (via IPC? no — just "Open admin → Tunnel"), Reset admin password… (standalone: stop server, run `ELECTRON_RUN_AS_NODE=1 execPath entry --data <dir> --reset-admin` and show output in a dialog, restart; service: run elevated), Quit (stops standalone server).
- Enabling service: status.html button → confirm dialog → stop standalone → `install()` (data-move user→machine) → wait for probe → reload window. Disabling: `uninstall()` moves data back.
- `electron-builder.yml`: appId `org.ossmalaysia.wateaminbox`, productName `WA Team Inbox`, `asar: true` with `asarUnpack` for `**/*.node`, `**/server/**`, extraResources: `../../apps/web/dist` → `web`, `../../resources/cloudflared/${platform}-${arch}` → `cloudflared`, winsw → `winsw`; win target nsis `perMachine: true`, `oneClick: false`; mac target dmg (x64 + arm64), `hardenedRuntime: false` (unsigned v1). Script `dist` in desktop package: `npm run build -w @wa-team-inbox/web && node ../../scripts/bundle-server.mjs && tsc -p . && electron-builder --config electron-builder.yml`.
- `npm run start -w @wa-team-inbox/desktop` → builds & launches electron in dev (uses `tsx`-compiled server entry from source via bundle step).
- `scripts/fetch-cloudflared.mjs`: downloads pinned cloudflared release (version constant) for win-x64, darwin-x64, darwin-arm64 from GitHub releases into `resources/cloudflared/<platform>-<arch>/` (mac `.tgz` extract). `scripts/fetch-winsw.mjs`: WinSW v2.12 x64 exe → `resources/winsw/WinSW-x64.exe`.

Native modules: `better-sqlite3` must be rebuilt for Electron: add `postinstall`-free approach — desktop `dist` runs `electron-builder install-app-deps` (or `@electron/rebuild`). Document in CLAUDE.md that `npm test` in server uses Node ABI while the packaged app uses Electron ABI (`ELECTRON_RUN_AS_NODE` uses Electron's ABI, so packaged native modules must be Electron-built).

- [ ] **Step 1:** Unit tests (vitest, no Electron runtime — keep pure builders in files that don't import `electron`): machineDataDir per platform; winswXml contains executable, escaped args, env ELECTRON_RUN_AS_NODE, startmode Automatic, onfailure restart; launchdPlist valid XML with RunAtLoad/KeepAlive and args array; probeServer returns null on wrong app / timeout; dataMoveCommands refuses when target has app.db marker (function takes `exists` injected).
- [ ] **Step 2–4:** FAIL → implement → pass; `tsc --noEmit` for desktop passes; `node scripts/bundle-server.mjs` produces bundle; (packaging run is verified in CI / manual checklist, not required locally on Windows dev machine for mac target).

---

### Task 15: End-to-end tests (Playwright)

**Depends on:** Tasks 7, 8, 11, 12, 13.

**Files:** Create `playwright.config.ts` (webServer: `npm run build -w @wa-team-inbox/web && npx tsx packages/server/src/cli.ts --data .e2e-data --port 7499 --fake-wa --mode dev --web-dist apps/web/dist`, reuse false; projects: `desktop-chromium`, `mobile` (devices['Pixel 7']), `iphone` (devices['iPhone 14'], run with chromium engine via `browserName: 'chromium'` override if WebKit not installed)), plus a test asserting `document.documentElement.scrollWidth <= window.innerWidth` on inbox, conversation, and every admin page at 360px, `e2e/global-setup.ts` (rm -rf .e2e-data), `e2e/inbox.spec.ts`, `e2e/admin.spec.ts`. Add `.e2e-data` to `.gitignore` (append-only shared). Root script `e2e`.

Flows: setup wizard creates admin (skip WA step since fake is open) → land on inbox → `request.post('/api/dev/fake-incoming', { chatJid: '60123456789@s.whatsapp.net', text: 'Hi, need help', senderName: 'Customer' })` with page cookies + Origin → chat appears in list with unread badge (realtime) → open → assign to me → send reply "Hello!" → bubble shows sent tick → Resolve → appears under Resolved filter → new fake incoming reopens it. Admin: create agent with temp password → logout → login as agent → forced change password → sees inbox; agent cannot open /admin. Quick reply `/hi` created by admin used in composer.

- [ ] **Step 1:** Write specs. **Step 2:** `npx playwright install chromium` then `npm run e2e` → fix failures in owning code (coordinate: e2e agent may fix bugs anywhere, reporting each). **Step 3:** green on both projects.

---

### Task 16: Docs: CLAUDE.md, README, architecture

**Depends on:** all.

**Files:** Replace `CLAUDE.md` (prefix exactly:
```
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
```
then: commands (install, dev, test all / single test e.g. `npx vitest run packages/server/test/auth.test.ts -t "lockout"`, lint, typecheck, e2e, desktop start, dist), architecture big picture (process model standalone vs service, WaAdapter boundary, bus → realtime/push, shared schemas, file ownership conventions, data dir layout, native module ABI caveat, fake WA dev mode, security invariants: setup guard, CF-Connecting-IP trust, Origin check). Update `README.md` with final quick start, feature list, disclaimer, manual test checklist link `docs/manual-test-checklist.md` (create it from spec §12). Create `docs/architecture.md` (diagram + data flow). Update `CHANGELOG.md` `[Unreleased]` with features.

- [ ] **Step 1:** Write docs, verify every command in CLAUDE.md actually runs (`npm test`, `npm run lint`, `npm run typecheck`, single-test command).

---

## Final verification (orchestrator)

- `npm ci && npm run lint && npm run typecheck && npm test && npm run build -w @wa-team-inbox/web && npm run e2e` all green.
- Whole-branch code review (security focus: auth, setup guard, origin, media serving, service install scripts) and fix confirmed findings.
- Push to `github.com/ossmalaysia/wa-team-inbox` (public), verify CI.
