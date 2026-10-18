# Plan: publish the desktop shell as `@ezychat/desktop` (2026-10-19)

Owner: "start the Lite part". Goal: EzyChat Enterprise builds its installer on Lite's desktop shell (window,
tray, status window, OS service, updater) from npm, the same way it uses the other core packages. Lite users
see no change: same data folders, profile, service ID, app ID, updater and file layout.

## Facts that shape the design

- `apps/desktop` is the Electron app; `main.ts` runs on import. Identity already comes from
  `activeProduct()` (`defineProduct`/`setActiveProduct`); another edition sets it, then imports main.
- Files the shell ships itself are found next to the compiled code (`here`): the preloads. The server host and
  the status page are found through `app.getAppPath()`; for Lite both paths are the same folder
  (`apps/desktop/dist`, `apps/desktop/src/renderer`), inside Enterprise they are not.
- The app layout the edition provides (server bundle `dist/server/server.cjs`, `dist/package.json` read by the
  updater, `resources/web`, `resources/tray`, `resources/app-icon.png`, `resources/cloudflared`,
  `resources/winsw`) stays an app-level contract: Enterprise builds the same layout.
- The pack contract forbids `src/**` in a tarball, so the status page moves to `dist/renderer` at build time.

## Changes

1. **Package-relative shell files.** `serverHost()` and a new `statusPage()` take the package folder
   (`<here>/..`), not the app path. The build copies `src/renderer` to `dist/renderer`; `electron-builder.yml`
   unpacks `**/server-host.cjs` (Lite path unchanged: `dist/server-host.cjs`).
2. **Public entry `src/index.ts`:** `defineProduct`, `setActiveProduct`, `activeProduct`, `LITE_PRODUCT`, the
   `Product`/`StatusSection…`/`UpdateFeed` types, and `startDesktop(product?)` (sets the product, then imports
   `./main.js`). Lite's Electron entry stays `dist/main.js` (`main` field); npm consumers use `exports`.
3. **Fetch scripts in the package:** `fetch-cloudflared.mjs` and `fetch-winsw.mjs` move to
   `apps/desktop/scripts/`, take `--out <dir>` (default: the repo's `resources/`), and are `bin` entries
   (`ezychat-fetch-cloudflared`, `ezychat-fetch-winsw`) with the same pinned versions and SHA-256.
4. **Publishable manifest:** not private, `exports` with `ezychat-source`, `types`, `files` (dist JS/d.ts,
   renderer, locales, scripts; never `dist/server`), `publishConfig`, `repository`, `peerDependencies.electron`.
5. **Release plumbing:** `build:core` builds it, `pack:core` packs it, the pack contract checks it, the publish
   workflow publishes it last and skips (with a warning) while the package does not exist on npm yet — the
   first publish is manual by the owner (security key), then trusted publishing is added for it.
6. **Docs:** AGENTS.md (Editions/Packages), `docs/editions-engineer-guide.md` (how an edition starts the shell
   and the app layout it must provide), CHANGELOG.

## Checks

Unit tests for paths and the entry; desktop typecheck; pack contract; `npm start -w @ezychat/desktop` smoke
(status window and server start from the new paths); a `--dir` packaged build smoke (server host unpacked,
status page, service paths). Lite release 0.1.40 after the owner's merge.
