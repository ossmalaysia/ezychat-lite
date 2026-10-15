# EzyChat editions: engineer guide (Lite + Enterprise)

How the free and paid editions share one core, and how to build features for each.
Design record: `docs/superpowers/specs/2026-10-15-open-core-editions-design.md`.

## 1. The model in one picture

```
            ossmalaysia/ezychat-lite (public, MIT)                 anchorsprint/ezychat-enterprise (private)
 ┌──────────────────────────────────────────────────┐        ┌──────────────────────────────────────────┐
 │ packages/shared  → @ezychat/shared               │        │ packages/ent-server  ServerExtension[]    │
 │ packages/wa      → @ezychat/wa                   │  npm   │ packages/ent-web     WebExtension[]       │
 │ packages/server  → @ezychat/server  (runCli,     │ ─────► │ apps/desktop         runCli(edition:      │
 │                    ServerExtension, guards)      │ pinned │                      'enterprise'),       │
 │ apps/web         → @ezychat/web (createInboxApp, │ exact  │                      createInboxApp(ext), │
 │                    WebExtension, UI components)  │ version│                      own Product identity │
 │ apps/desktop     EzyChat Lite installer          │        │ EzyChat Enterprise installer (phase 5)    │
 └──────────────────────────────────────────────────┘        └──────────────────────────────────────────┘
```

- **Lite is the core.** Every free feature, and every extension point, lives in Lite.
- **Enterprise only adds.** It never patches core code; it plugs features in through three extension
  points (server, web, desktop identity) and depends on the published `@ezychat/*` packages,
  pinned to one exact version. No git submodule, no `file:` dependency.
- **Lite never knows Enterprise exists.** ESLint blocks `@ezychat-enterprise/*` imports in Lite.

## 2. Where does my feature go?

| The feature… | Goes in | How |
|---|---|---|
| is free for everyone | Lite | Normal Lite PR |
| is free, but with a bigger limit in Enterprise | Lite | Core feature; the limit comes from the edition (extension `init` can set it) |
| is paid, and its code must stay private | Enterprise | `ServerExtension` + `WebExtension` |
| needs a hook Lite does not have yet | Lite first, then Enterprise | Lite PR adding the extension point (with tests) → Lite release → Enterprise uses it |
| was paid and becomes free | Lite | Move the code into Lite, release, then delete it from Enterprise |

## 3. Server extensions (`@ezychat/server`)

```ts
import { requireAdmin, type ServerExtension } from '@ezychat/server';

export const reports: ServerExtension = {
  name: 'reports',                        // /^[a-z][a-z0-9-]{1,31}$/, not 'lite' or 'core'
  migrationsDir: reportsMigrationsDir(),  // NNN_*.sql, tables named ent_*
  init(ctx) {                             // runs after every core service is ready
    ctx.bus.on('message:new', (m) => { /* … */ });
  },
  async routes(api, ctx) {                // mounted at /api/ext/reports/…
    api.addHook('preHandler', requireAdmin(ctx));   // routes are PUBLIC unless you add a guard
    api.get('/summary', async () => ({ /* … */ }));
  },
};
```

What the core guarantees:
- Routes live only under `/api/ext/<name>/…`, so they can never replace a core route. The global
  Host allowlist and Origin check still apply.
- Extension migrations run on their own track (table `extension_migrations`), one transaction per
  file, before services start. The core's `PRAGMA user_version` is never touched. Two files with
  the same number stop startup before anything is applied.
- `/api/health` returns `edition` (`lite` or `enterprise`); `app` stays `wa-team-inbox`.
- The product starts with `runCli(process.argv.slice(2), process.env, { edition: 'enterprise', extensions })`.

Known gap: when two chats of one person are merged, rows in `ent_*` tables keyed by `chat_jid` are
**not** moved. Do not store `chat_jid` in an Enterprise table until Lite adds an `onChatMerged` hook.

## 4. Web extensions (`@ezychat/web`)

```tsx
import { Card, CardContent, type WebExtension, useExtensionTranslation } from '@ezychat/web';

export const reportsWeb: WebExtension = {
  name: 'reports',
  routes: [{ path: 'summary', admin: true, element: <SummaryPage /> }], // → /admin/ext/reports/summary
  adminNav: [{ path: 'summary', labelKey: 'ext.reports.nav' }],
  settingsSections: [{ id: 'reports', titleKey: 'ext.reports.settings', element: <ReportsSettings /> }],
  catalogs: {
    en: { 'ext.reports.nav': 'Reports', 'ext.reports.settings': 'Reports' },
    ms: { 'ext.reports.nav': 'Laporan', 'ext.reports.settings': 'Laporan' },
    'zh-CN': { 'ext.reports.nav': '报告', 'ext.reports.settings': '报告' },
  },
};
// Enterprise web entry: createInboxApp({ extensions: [reportsWeb], productName: 'EzyChat Enterprise' })
```

- User routes mount at `/ext/<name>/…`, admin routes at `/admin/ext/<name>/…` inside the admin shell
  and guard. Every element is wrapped in an `ErrorBoundary`.
- Settings sections appear under Settings → Integrations, below the core sections.
- Translation keys must start with `ext.<name>.`; read them with `useExtensionTranslation()`.
- `productName` replaces "EzyChat Lite" everywhere the UI names the app: core catalog strings use
  `{{product}}`, never the literal name (a test enforces it). Only the share-the-app texts keep
  "EzyChat Lite", because they promote the free app.
- Build UI only from the exported shadcn/app components, with token colour classes. The core CSS
  (`@ezychat/web/style.css`) contains only the Tailwind classes Lite uses, so extensions that need
  other utilities run their own Tailwind build.

## 5. Desktop identity (`apps/desktop/src/product.ts`)

Every installer identity value (app ID, data and profile folders, service ID, launchd label, update
feed, installer names) comes from a `Product`. Lite's values are upgrade contracts, frozen in
`LITE_PRODUCT` and pinned by tests. Enterprise defines its own (`EzyChat Enterprise`,
`com.anchorsprint.ezychat.enterprise`, data folder `ezychat-enterprise`, service `ezychat-enterprise`),
so both editions can be installed on one PC. The desktop app only adopts a running server whose
health `app` **and** `edition` match its own.

Not done yet: the Electron main process is not published as a library (it finds its assets through
the app layout), so the Enterprise repo builds the server and web app but not yet a desktop installer.

## 6. Packages and the core update flow

| Package | Built output | Inside the Lite repo |
|---|---|---|
| `@ezychat/shared`, `@ezychat/wa`, `@ezychat/server` | `dist/` (JS + `.d.ts`; server ships its SQL migrations) | resolved to `src/` |
| `@ezychat/web` | `dist-lib/` (ESM + types + one precompiled CSS) | resolved to `src/` |
| `@ezychat/desktop` | private, not published | — |

Inside Lite, imports resolve to source through the **`ezychat-source`** export condition (not
`development`: Vite and Vitest enable that by default, which would break Enterprise because the
tarballs ship no `src/`). A plain `node`/`tsx` run outside npm needs `--conditions=ezychat-source`.

Release flow:
1. Lite release tag `v0.1.36` → `.github/workflows/publish-packages.yml` publishes `@ezychat/*@0.1.36`
   (dry run until the `NPM_TOKEN` secret exists). `scripts/pack-contract.test.mjs` pins what each
   tarball contains.
2. Dependabot opens one grouped `ezychat-core` PR in Enterprise bumping every pin together.
3. Enterprise CI (Anchor Sprint self-hosted Linux ARM64 runners only; private code never runs on GitHub-hosted machines) runs lint, typecheck, tests and builds → merge → Enterprise release.

## 7. Daily development

| Task | Command |
|---|---|
| Build the publishable core | `npm run build:core` (Lite) |
| Make local tarballs | `npm run pack:core` (Lite → `.core-packs/`) |
| Use an unreleased core change in Enterprise | `node scripts/use-local-core.mjs` (Enterprise; packs Lite and installs with `--no-save`) |
| Run the Enterprise server | `npm run dev:server` (port 7434, fake WhatsApp, `./data/dev`) |
| Run the Enterprise web app | `npm run dev:web` (Vite 5174, proxies `/api` to 7434) |

Never commit tarballs, `file:` dependencies, or a lockfile that points to local paths.

## 8. Rules (both repos)

1. Free features go to Lite. Enterprise only adds paid features through extension points.
2. Enterprise imports only each package's public `index` exports; ESLint rejects deep imports.
   Anything not exported is internal and may change in any Lite release.
3. A missing hook is a Lite PR with tests, released before Enterprise uses it.
4. Never change Lite's upgrade contracts (data folders, profile, service ID, app ID, health `app`).
5. Enterprise tables are `ent_*` and use the extension migration track.
6. Keep `npm run pack:core` working: Enterprise depends on it until the packages are on npm.
7. Both repos: feature branches and PRs; merge only when the owner asks.

## 9. Status and next phases

| Phase | Status |
|---|---|
| 1 Server extension API | Done |
| 2 Web extension API | Done |
| 3 Desktop product config | Done |
| 3b Publishable `@ezychat/*` packages + publish job | Done (publishing waits for the npm org `ezychat` and `NPM_TOKEN`) |
| 4 Enterprise scaffold (`enterprise-hello` server + web extension, CI, Dependabot) | Done, except the desktop installer (needs a publishable desktop main) |
| 4b Publish the desktop main process (`start(options)` with asset folders) | Next |
| 5 Enterprise release channel (signing, public installer bucket, update feed) | Needs owner decisions |
| 6 Licensing | Needs design + mock confirmation |
| 7 First paid feature | Owner picks |
