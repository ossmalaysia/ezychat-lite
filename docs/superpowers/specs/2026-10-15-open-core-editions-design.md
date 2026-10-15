# Open-core editions: EzyChat Lite (public) + EzyChat Enterprise (private)

Status: proposed, awaiting owner review. Decision taken: **Pattern A** (public core, separate private repo).

## Goal

One shared core, two products:

| | EzyChat Lite | EzyChat Enterprise |
|---|---|---|
| Repo | `ossmalaysia/ezychat-lite` (public, MIT) | `anchorsprint/ezychat-enterprise` (private) |
| Local path | `D:\dev\whatsapp-manager` | `D:\dev\ezychat-enterprise` |
| Contains | Core + every free feature | Paid features only, built as extensions |
| Installer | `EzyChat Lite` (unchanged IDs) | `EzyChat Enterprise` (own appId, data dir, service ID) |
| Pipeline | Lite CI + release | Enterprise CI + release (own signing, own update feed) |

## Rules

1. Lite never imports, mentions or ships Enterprise code. Free features always land in Lite.
2. Enterprise uses only Lite's **public extension API** (exports of each package's `index.ts`);
   an ESLint rule in Enterprise forbids deep imports into `core/**/src/**`.
3. Any new extension point is a Lite PR with tests, merged and released before Enterprise uses it.
4. Lite's upgrade contracts (data folders, desktop profile, service ID, app ID, `/api/health.app`)
   never change. Enterprise gets its own values so both editions can be installed on one PC.
5. Enterprise data uses its own tables (`ent_*`) and its own migration track; core migrations
   (`PRAGMA user_version`) stay owned by Lite.
6. Promoting a paid feature to free = move its code into Lite (Lite PR), then delete it from Enterprise.

## How Enterprise consumes the core

**Published npm packages (owner decision: no git submodule).** Each Lite release publishes the core
to the public npm registry under the `@ezychat` scope, same version as the Lite app:

| Package | From | Contents |
|---|---|---|
| `@ezychat/shared` | `packages/shared` | zod schemas, i18n catalogs (built JS + `.d.ts`) |
| `@ezychat/wa` | `packages/wa` | `WaAdapter`, Baileys + fake adapters |
| `@ezychat/server` | `packages/server` | `runCli`, `startServer`, `ServerExtension`, guards, SQL migrations |
| `@ezychat/web` | `apps/web` | `createInboxApp({ extensions })`, compiled CSS, service worker source |
| `@ezychat/desktop` | `apps/desktop` | Electron main/preload built JS, `defineProduct()` |

Enterprise pins exact versions (`"@ezychat/server": "0.1.36"`), installs with `npm ci`, and Dependabot
(`npm` ecosystem) opens one grouped "bump core" PR per Lite release.

What this needs in Lite (the price of npm over a submodule):
- Every package builds to `dist/` (JS + `.d.ts`) and its `exports` point there; today they point to
  `src/*.ts`, which only works inside this monorepo. Inside the Lite workspace an `ezychat-source`
  export condition keeps pointing to `src` so `npm run dev` and Vitest are unchanged (not `development`:
  Vite and Vitest enable that one by default, which would break Enterprise because tarballs ship no `src`).
- `@ezychat/web` becomes a Vite **library** build with its CSS precompiled (Enterprise must not depend on
  Tailwind scanning `node_modules`); Lite's own `index.html` entry imports that library.
- Workspace scope rename `@wa-team-inbox/*` → `@ezychat/*` (one mechanical PR; folders, data paths and
  installer IDs do not change).
- `npm pack` contract test per package: the tarball contains `dist`, migrations and no `src`, tests or secrets.
- CI publishes on the Lite release tag with `npm publish --provenance --access public`
  (npm org `ezychat`, automation token as a GitHub secret).

Local development across both repos: in Enterprise, `npm install ../whatsapp-manager/packages/server`
(or `npm link`) temporarily; never commit a `file:` dependency.

## Phases (each a separate plan and PR)

| # | Repo | Deliverable | UI? |
|---|---|---|---|
| 1 | Lite | **Server extension API**: `ServerExtension` (init, routes, migrations), `edition` in `/api/health`, public `index.ts` exports | No |
| 2 | Lite | **Web extension API**: `createInboxApp({ extensions })` with routes, admin nav items, Settings sections, i18n catalogs; `main.tsx` becomes a thin Lite entry | Mock needed only if visible change |
| 3 | Lite | **Product config for desktop**: appId, productName, data dir, service ID, health `app`, update feed, icons in one `product` object; Lite values unchanged and pinned by tests | No (identity tests) |
| 3b | Lite | **Publishable packages**: `@ezychat/*` rename, `dist` builds + `ezychat-source` condition, web library build, `npm pack` contract tests, publish job on release tag (dry-run until the npm org exists) | No |
| 4 | Enterprise | **Scaffold**: `@ezychat/*` dependencies pinned, `ent-server` + `ent-web` "hello" extension, Enterprise CLI entry + server bundle, desktop app using Phase 3 config, CI on self-hosted runners only (private repo), Dependabot (npm, grouped `@ezychat/*`) | Smoke only |
| 5 | Enterprise | **Release channel**: signed installers; private repo releases are not downloadable without a token, so publish installers + update manifest to a public bucket (Cloudflare R2) or a public `ezychat-enterprise-releases` repo | No |
| 6 | Enterprise | **Licensing** (separate brainstorm): offline-verifiable signed licence key, grace period, what happens when it expires | Yes (mock first) |
| 7 | Enterprise | First real paid feature, built on phases 1–6 | Per feature |

Phases 1–3 are useful to Lite alone (cleaner boundaries) and change no Lite behaviour.

## Out of scope for now

- A private registry (the core is MIT and public, so the public npm registry is enough).
- Changing Lite's licence.

## Owner actions needed

- Create the npm organisation `ezychat` (free for public packages) and an automation token, saved as
  the `NPM_TOKEN` secret in `ossmalaysia/ezychat-lite`. Until then the publish job runs `--dry-run`.
- Any Enterprise feature work before phase 4 exists.
