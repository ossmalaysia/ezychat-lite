# Open-core Phase 1: Server extension API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a private EzyChat Enterprise build add server features (startup hooks, `/api/ext/<name>/…` routes, its own SQL migrations) to the unchanged Lite server, and report its edition in `/api/health`.

**Architecture:** A `ServerExtension` object list travels with the `AppContext`. `createContext` validates the list and applies each extension's migrations on a separate track (table `extension_migrations`, never `PRAGMA user_version`). `runInitializers` runs core initializers, then each extension's `init`. `registerRoutes` mounts each extension's routes under `/api/ext/<name>` after the core routes, so they inherit the global Host/Origin hooks and cannot shadow core paths. A new `runCli` lets another product reuse the CLI with its own edition and extensions. Lite passes no extensions: its behaviour is unchanged.

**Tech Stack:** Node 22, TypeScript strict ESM, Fastify 5, better-sqlite3, zod (`packages/shared`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-open-core-editions-design.md` (phase 1).

## Global Constraints

- Extension name: `/^[a-z][a-z0-9-]{1,31}$/`, unique in the list; `lite` and `core` are reserved.
- Edition id: same pattern; default `lite`.
- `/api/health` keeps `app: 'wa-team-inbox'` (desktop upgrade contract); `edition` is added and optional in the schema.
- Core migrations and `PRAGMA user_version` are untouched; `LATEST` in `db/migrate.test.ts` stays 11.
- Lite never imports Enterprise code: ESLint forbids `@ezychat-enterprise/*` imports.
- No UI change, no user-visible change (no CHANGELOG entry). Server API messages stay English.
- Run only the touched tests (`npx vitest run <paths>`) and `npm run typecheck -w @wa-team-inbox/server -w @wa-team-inbox/shared`; no e2e until the final consolidated verification.

## Review Focus

1. Two migration files with the same number in one extension folder → startup fails with a clear error naming both files, nothing applied (Task 2).
2. A failing extension migration → its own statements roll back, earlier versions stay recorded, startup fails (Task 2).
3. An extension route path equal to a core path (e.g. `/auth/login`) → served only at `/api/ext/<name>/auth/login`; core `/api/auth/login` unchanged (Task 3).
4. An extension route without a guard is public, so the exported `requireUser` must work in extension scopes: an anonymous request to a guarded extension route gets 401 (Task 3).
5. A mutating extension request with a foreign `Origin` → rejected exactly like core routes (Task 3).

**Known limits (later phases, not tested here):** `mergeChat` does not move rows of extension tables keyed by `chat_jid` (needs an `onChatMerged` hook before any Enterprise table stores `chat_jid`); support exports and backups include extension tables as-is.

---

### Task 1: `ServerExtension` type, validation, public exports, import boundary

**Files:**
- Create: `packages/server/src/extensions.ts`
- Create: `packages/server/src/extensions.test.ts`
- Modify: `packages/server/src/index.ts` (currently `export {};`)
- Modify: `eslint.config.*` (add `no-restricted-imports` for `@ezychat-enterprise/*`)

**Interfaces:**
- Produces: `interface ServerExtension { name: string; migrationsDir?: string; init?(ctx: AppContext): void | Promise<void>; routes?(api: FastifyInstance, ctx: AppContext): Promise<void> }`, `validateExtensions(list: readonly ServerExtension[]): void`, `validateEdition(id: string): void`, `EXTENSION_NAME = /^[a-z][a-z0-9-]{1,31}$/`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/extensions.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { validateEdition, validateExtensions } from './extensions.js';

describe('validateExtensions', () => {
  it('accepts an empty list and well-formed unique names', () => {
    expect(() => validateExtensions([])).not.toThrow();
    expect(() => validateExtensions([{ name: 'sso' }, { name: 'multi-number' }])).not.toThrow();
  });
  it.each(['', 'A', '1abc', 'has space', 'x'.repeat(33), 'lite', 'core'])('rejects name %j', (name) => {
    expect(() => validateExtensions([{ name }])).toThrow(/extension name/);
  });
  it('rejects duplicate names', () => {
    expect(() => validateExtensions([{ name: 'sso' }, { name: 'sso' }])).toThrow(/duplicate extension "sso"/);
  });
});

describe('validateEdition', () => {
  it('accepts lite and enterprise, rejects malformed ids', () => {
    expect(() => validateEdition('lite')).not.toThrow();
    expect(() => validateEdition('enterprise')).not.toThrow();
    expect(() => validateEdition('Enterprise!')).toThrow(/edition/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module './extensions.js'`)

Run: `npx vitest run packages/server/src/extensions.test.ts`

- [ ] **Step 3: Implement** — `packages/server/src/extensions.ts`

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';

/** Lowercase id used for the route prefix (/api/ext/<name>) and the migration track. */
export const EXTENSION_NAME = /^[a-z][a-z0-9-]{1,31}$/;
const RESERVED = new Set(['lite', 'core']);

/**
 * A feature added by another product build (e.g. EzyChat Enterprise) without changing core code.
 * Lite itself passes no extensions.
 */
export interface ServerExtension {
  name: string;
  /** Folder of NNN_*.sql files, applied once each and tracked in extension_migrations. */
  migrationsDir?: string;
  /** Runs after every core initializer, in list order. */
  init?(ctx: AppContext): void | Promise<void>;
  /** Mounted at /api/ext/<name> after core routes; add requireUser/requireAdmin yourself. */
  routes?(api: FastifyInstance, ctx: AppContext): Promise<void>;
}

export function validateExtensions(list: readonly ServerExtension[]): void {
  const seen = new Set<string>();
  for (const ext of list) {
    if (!EXTENSION_NAME.test(ext.name) || RESERVED.has(ext.name))
      throw new Error(`invalid extension name ${JSON.stringify(ext.name)}`);
    if (seen.has(ext.name)) throw new Error(`duplicate extension "${ext.name}"`);
    seen.add(ext.name);
  }
}

export function validateEdition(id: string): void {
  if (!EXTENSION_NAME.test(id)) throw new Error(`invalid edition ${JSON.stringify(id)}`);
}
```

- [ ] **Step 4: Public API** — replace `packages/server/src/index.ts`

```ts
// Public API for other product builds. Anything not exported here is internal.
export { buildApp } from './app.js';
export { requireAdmin, requireUser } from './auth/guards.js';
export { parseArgs, type ServerConfig } from './config.js';
export type { AppContext, Services } from './context.js';
export { EXTENSION_NAME, type ServerExtension } from './extensions.js';
export { createContext, runInitializers, shutdownServices, startServer } from './main.js';
```

(`runCli` is added in Task 4.)

- [ ] **Step 5: ESLint boundary** — in the root ESLint config, add to the rules block that applies to all TS files:

```js
'no-restricted-imports': ['error', { patterns: [{ group: ['@ezychat-enterprise/*'], message: 'Lite never imports Enterprise code.' }] }],
```

If a `no-restricted-imports` rule already exists for that block, append the pattern to its `patterns` array instead of adding a second rule.

- [ ] **Step 6: Run tests and typecheck, expect PASS**

Run: `npx vitest run packages/server/src/extensions.test.ts` then `npm run typecheck -w @wa-team-inbox/server` then `npx eslint packages/server/src/index.ts packages/server/src/extensions.ts`

- [ ] **Step 7: Commit** — `feat(server): add server extension type and public API`

---

### Task 2: Extension migration track

**Files:**
- Create: `packages/server/src/db/extension-migrate.ts`
- Create: `packages/server/src/db/extension-migrate.test.ts`

**Interfaces:**
- Produces: `migrateExtension(db: DB, name: string, dir: string): number[]` (returns versions applied now).

- [ ] **Step 1: Write the failing test** — `packages/server/src/db/extension-migrate.test.ts`

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from './index.js';
import { migrateExtension } from './extension-migrate.js';

let root: string;
let db: DB;
const dir = (name: string, files: Record<string, string>) => {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  for (const [f, sql] of Object.entries(files)) writeFileSync(join(d, f), sql);
  return d;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wati-extmig-'));
  db = openDb(join(root, 'app.db'));
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('migrateExtension', () => {
  it('applies files in numeric order once and leaves user_version alone', () => {
    const before = db.pragma('user_version', { simple: true });
    const d = dir('ent', {
      '2_b.sql': 'INSERT INTO ent_t (v) VALUES (2);',
      '10_c.sql': 'INSERT INTO ent_t (v) VALUES (10);',
      '1_a.sql': 'CREATE TABLE ent_t (v INTEGER);',
      'README.md': 'ignored',
    });
    expect(migrateExtension(db, 'ent', d)).toEqual([1, 2, 10]);
    expect(migrateExtension(db, 'ent', d)).toEqual([]);
    expect(db.prepare('SELECT v FROM ent_t ORDER BY v').pluck().all()).toEqual([2, 10]);
    expect(db.pragma('user_version', { simple: true })).toBe(before);
  });

  it('keeps a separate track per extension', () => {
    migrateExtension(db, 'one', dir('one', { '1_a.sql': 'CREATE TABLE ent_one (v INTEGER);' }));
    expect(migrateExtension(db, 'two', dir('two', { '1_a.sql': 'CREATE TABLE ent_two (v INTEGER);' }))).toEqual([1]);
  });

  it('rejects two files with the same number before applying anything', () => {
    const d = dir('dup', { '1_a.sql': 'CREATE TABLE ent_x (v INTEGER);', '01_b.sql': 'SELECT 1;' });
    expect(() => migrateExtension(db, 'dup', d)).toThrow(/1_a\.sql.*01_b\.sql|01_b\.sql.*1_a\.sql/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ent_x'").get()).toBeUndefined();
  });

  it('rolls back a failing file and keeps earlier versions recorded', () => {
    const d = dir('bad', {
      '1_ok.sql': 'CREATE TABLE ent_ok (v INTEGER);',
      '2_bad.sql': 'CREATE TABLE ent_half (v INTEGER); THIS IS NOT SQL;',
    });
    expect(() => migrateExtension(db, 'bad', d)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ent_half'").get()).toBeUndefined();
    expect(
      db.prepare("SELECT version FROM extension_migrations WHERE extension = 'bad'").pluck().all(),
    ).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run packages/server/src/db/extension-migrate.test.ts`

- [ ] **Step 3: Implement** — `packages/server/src/db/extension-migrate.ts`

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './index.js';

/**
 * Applies an extension's NNN_*.sql files once each. Tracked per extension in
 * extension_migrations, never in PRAGMA user_version (that track belongs to core).
 */
export function migrateExtension(db: DB, name: string, dir: string): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS extension_migrations (
    extension TEXT NOT NULL,
    version INTEGER NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (extension, version)
  )`);
  const byVersion = new Map<number, string>();
  for (const f of readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f))) {
    const version = parseInt(f, 10);
    const other = byVersion.get(version);
    if (other) throw new Error(`extension "${name}": migrations ${other} and ${f} share number ${version}`);
    byVersion.set(version, f);
  }
  const applied = new Set(
    db.prepare('SELECT version FROM extension_migrations WHERE extension = ?').pluck().all(name) as number[],
  );
  const record = db.prepare('INSERT INTO extension_migrations (extension, version, applied_at) VALUES (?, ?, ?)');
  const done: number[] = [];
  for (const version of [...byVersion.keys()].sort((a, b) => a - b)) {
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, byVersion.get(version)!), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(name, version, Date.now());
    })();
    done.push(version);
  }
  return done;
}
```

- [ ] **Step 4: Run it, expect PASS** (same command), plus `npx vitest run packages/server/src/db/migrate.test.ts` (core track unchanged).

- [ ] **Step 5: Commit** — `feat(server): add a separate migration track for extensions`

---

### Task 3: Wire extensions into context, initializers, routes and health

**Files:**
- Modify: `packages/server/src/context.ts` (add `edition`, `extensions` to `AppContext`)
- Modify: `packages/server/src/main.ts` (`createContext` deps, `runInitializers`, `startServer` deps)
- Modify: `packages/server/src/routes/index.ts` (`registerRoutes` mounts extension routes)
- Modify: `packages/server/src/routes/health.ts` (adds `edition`)
- Modify: `packages/shared/src/api.ts:209-213` (`HealthResponse.edition` optional)
- Modify: `packages/server/test/helpers.ts` (`makeTestApp` accepts `extensions`, `edition`)
- Create: `packages/server/test/extensions.test.ts`

**Interfaces:**
- Consumes: `ServerExtension`, `validateExtensions`, `validateEdition` (Task 1); `migrateExtension` (Task 2).
- Produces: `AppContext.edition: string`, `AppContext.extensions: readonly ServerExtension[]`; `createContext(cfg, { wa?, log, extensions?, edition? })`; `startServer(cfg, { wa?, extensions?, edition? })`; `makeTestApp({ …, extensions?, edition? })`.

- [ ] **Step 1: Write the failing test** — `packages/server/test/extensions.test.ts`

Use the existing helpers in `test/helpers.ts` / `test/auth-helpers.ts` for the admin session and Origin header (read them first and reuse their names; do not hand-roll cookies).

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requireUser, type ServerExtension } from '../src/index.js';
import { makeTestApp, type TestApp } from './helpers.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function demo(calls: string[]): ServerExtension {
  const migrationsDir = mkdtempSync(join(tmpdir(), 'wati-ext-'));
  writeFileSync(join(migrationsDir, '1_init.sql'), 'CREATE TABLE ent_demo (v TEXT);');
  return {
    name: 'demo',
    migrationsDir,
    init: (ctx) => {
      calls.push(`init:${Object.keys(ctx.services).includes('auth')}`);
    },
    routes: async (api, ctx) => {
      api.get('/ping', async () => ({ pong: true }));
      api.get('/auth/login', async () => ({ shadow: true }));
      api.get('/private', { preHandler: requireUser(ctx) }, async () => ({ ok: true }));
      api.post('/echo', async (req) => ({ body: req.body }));
    },
  };
}

describe('server extensions', () => {
  it('reports lite with no extensions', async () => {
    t = await makeTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toMatchObject({ app: 'wa-team-inbox', edition: 'lite' });
  });

  it('applies migrations, runs init after core services and mounts routes under /api/ext/<name>', async () => {
    const calls: string[] = [];
    t = await makeTestApp({ edition: 'enterprise', extensions: [demo(calls)] });
    expect(calls).toEqual(['init:true']);
    expect(t.ctx.db.prepare("SELECT name FROM sqlite_master WHERE name = 'ent_demo'").get()).toBeTruthy();
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ edition: 'enterprise' });
    expect((await t.app.inject({ method: 'GET', url: '/api/ext/demo/ping' })).json()).toEqual({ pong: true });
  });

  it('cannot shadow a core route', async () => {
    t = await makeTestApp({ extensions: [demo([])] });
    expect((await t.app.inject({ method: 'GET', url: '/api/ext/demo/auth/login' })).json()).toEqual({ shadow: true });
    const core = await t.app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(core.body).not.toContain('shadow');
  });

  it('guards work in extension scopes', async () => {
    t = await makeTestApp({ extensions: [demo([])] });
    expect((await t.app.inject({ method: 'GET', url: '/api/ext/demo/private' })).statusCode).toBe(401);
  });

  it('applies the Origin check to extension routes', async () => {
    t = await makeTestApp({ extensions: [demo([])] });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ext/demo/echo',
      headers: { host: '127.0.0.1', origin: 'http://evil.example' },
      payload: { a: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an invalid extension list before opening services', async () => {
    await expect(makeTestApp({ extensions: [{ name: 'Bad Name' }] })).rejects.toThrow(/extension name/);
  });
});
```

If `TestApp` does not expose `ctx`/`close` under those names, use its actual member names (read `helpers.ts` lines 27-90).

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run packages/server/test/extensions.test.ts`

- [ ] **Step 3: Implement**

`context.ts` — add to `AppContext` (keep field order: after `services`):

```ts
  /** Product edition reported by /api/health ('lite' unless another build passes one). */
  edition: string;
  /** Extensions added by another product build; empty in Lite. */
  extensions: readonly ServerExtension[];
```
with `import type { ServerExtension } from './extensions.js';`.

`main.ts` — `createContext`:

```ts
export async function createContext(
  cfg: ServerConfig,
  deps: { wa?: WaAdapter; log: Logger; extensions?: readonly ServerExtension[]; edition?: string },
): Promise<AppContext> {
  const { log } = deps;
  const extensions = deps.extensions ?? [];
  const edition = deps.edition ?? 'lite';
  validateExtensions(extensions);
  validateEdition(edition);
  const db = openDb(join(cfg.dataDir, 'app.db'));
  for (const ext of extensions) {
    if (!ext.migrationsDir) continue;
    const applied = migrateExtension(db, ext.name, ext.migrationsDir);
    if (applied.length) log.info({ extension: ext.name, applied }, 'extension migrations applied');
  }
  // … unchanged …
  return { config: cfg, db, bus, log, secret, settings, wa, services: {}, edition, extensions };
}
```

If a migration throws, close `db` before rethrowing (wrap the loop in `try { … } catch (err) { db.close(); throw err; }`).

`runInitializers`:

```ts
export async function runInitializers(ctx: AppContext): Promise<void> {
  for (const init of initializers) await init(ctx);
  for (const ext of ctx.extensions) await ext.init?.(ctx);
}
```

`startServer(cfg, deps?: { wa?: WaAdapter; extensions?: readonly ServerExtension[]; edition?: string })` passes `extensions` and `edition` to `createContext`, and adds `edition: ctx.edition, extensions: ctx.extensions.map((e) => e.name)` to the `'server listening'` log line.

`routes/index.ts` — after the core loop:

```ts
  for (const ext of ctx.extensions) {
    if (!ext.routes) continue;
    const routes = ext.routes;
    await app.register(async (scope) => routes(scope, ctx), { prefix: `/api/ext/${ext.name}` });
  }
```

`routes/health.ts` — return `{ app: 'wa-team-inbox', edition: ctx.edition, version: …, mode: … }`.

`packages/shared/src/api.ts` — add `edition: z.string().optional(),` to `HealthResponse` (optional: an older server omits it; readers treat a missing value as `'lite'`).

`test/helpers.ts` — add `extensions?: readonly ServerExtension[]; edition?: string;` to the `makeTestApp` options and pass both into `createContext(config, { wa, log: silentLogger(), extensions: opts?.extensions, edition: opts?.edition })`.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run packages/server/test/extensions.test.ts packages/server/src/app.test.ts packages/shared/src/schemas.test.ts`
then `npm run typecheck -w @wa-team-inbox/server -w @wa-team-inbox/shared`

- [ ] **Step 5: Commit** — `feat(server): run extension migrations, init hooks and routes`

---

### Task 4: Reusable CLI entry (`runCli`)

**Files:**
- Create: `packages/server/src/run-cli.ts` (body of today's `cli.ts#run`, parameterised)
- Modify: `packages/server/src/cli.ts` (becomes a 3-line Lite entry)
- Modify: `packages/server/src/index.ts` (export `runCli`)
- Test: `packages/server/src/run-cli.test.ts`

**Interfaces:**
- Consumes: `startServer(cfg, { extensions, edition })` (Task 3).
- Produces: `runCli(argv: string[], env: NodeJS.ProcessEnv, product?: { edition?: string; extensions?: readonly ServerExtension[]; exit?: (code: number) => never }): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `packages/server/src/run-cli.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { runCli } from './run-cli.js';

describe('runCli', () => {
  it('exits 2 with usage when --data is missing', async () => {
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as unknown as (code: number) => never;
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runCli([], {}, { exit })).rejects.toThrow('exit 2');
    expect(err.mock.calls.join('')).toContain('Usage: server --data <dir>');
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run packages/server/src/run-cli.test.ts`

- [ ] **Step 3: Implement** — move the whole body of `run()` from `cli.ts` into `run-cli.ts` as `runCli`, replacing every `process.exit(n)` with `exit(n)` (`const exit = product?.exit ?? process.exit;`) and `await startServer(serverCfg)` with `await startServer(serverCfg, { extensions: product?.extensions, edition: product?.edition })`. Then `cli.ts` becomes:

```ts
#!/usr/bin/env node
import { runCli } from './run-cli.js';

void runCli(process.argv.slice(2), process.env);
```

Add `export { runCli } from './run-cli.js';` to `index.ts`.

- [ ] **Step 4: Run, expect PASS** — the new test, `npx vitest run packages/server/src/main.test.ts packages/server/src/config.test.ts`, then server typecheck. Then confirm the bundle still builds: `npm run bundle:server -w @wa-team-inbox/desktop`.

- [ ] **Step 5: Commit** — `refactor(server): expose runCli for other product builds`

---

### Task 5: Docs, workbook and Dev Build check

**Files:**
- Modify: `AGENTS.md` (Architecture: new **Editions and extensions** paragraph)
- Modify: `docs/dev-build-checks.md` (one row)
- Create: `docs/workbooks/feat__open-core-extension-points.md` (via `node scripts/build-summary.mjs record …`)
- Modify: `docs/LEARNINGS.md` only if a real lesson came up

- [ ] **Step 1: AGENTS.md paragraph** (after **Contract.**):

```md
**Editions and extensions.** Lite is the public core; EzyChat Enterprise is a private repo that depends on
the published `@ezychat/*` npm packages (pinned versions) and adds features only through `ServerExtension` (`packages/server/src/extensions.ts`,
exported from `packages/server/src/index.ts`): `init` runs after core initializers, `routes` mount at
`/api/ext/<name>` (add `requireUser`/`requireAdmin` yourself), SQL in `migrationsDir` runs on its own
track (`extension_migrations`, never `user_version`; tables `ent_*`). `runCli(argv, env, { edition, extensions })`
starts another product; `/api/health` reports `edition`. Lite never imports Enterprise code (ESLint).
Everything not exported from a package `index.ts` is internal and may change without notice.
Plan: `docs/superpowers/specs/2026-10-15-open-core-editions-design.md`.
```

- [ ] **Step 2: Dev Build check** — read `docs/dev-build-checks.md` first. Write a scratch script (outside the repo, in the session scratchpad) that calls `runCli(['--data', <temp dir>, '--port', '7433', '--fake-wa', '--mode', 'dev'], process.env, { edition: 'enterprise', extensions: [demo] })` via `npx tsx`, where `demo` has one migration and `GET /ping`. Check with `ctx_execute` fetches: `/api/health` shows `edition: "enterprise"`, `/api/ext/demo/ping` answers, `extension_migrations` has the row, the server log has `extension migrations applied` and `server listening` with `extensions: ["demo"]`. Then start Lite (`npm run dev`) and confirm `/api/health` shows `edition: "lite"`. Log one row (scenario, steps, result, untested: packaged build, Enterprise repo).

- [ ] **Step 3: Workbook** — `node scripts/build-summary.mjs record Design done "spec + phase-1 plan"`, then `Dev`, `Unit tests`, `Dev Build` as they finish; mark `Screen review` and `E2E` as not needed (no UI).

- [ ] **Step 4: Consolidated verification (final step only)** — `npm run typecheck`, `npm test`, `npm run lint`, web build, `npm run e2e`.

- [ ] **Step 5: Commit** — `docs: document editions and server extensions`. Push the branch and open a PR. Do not merge.
