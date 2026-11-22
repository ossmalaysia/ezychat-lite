# Releasing EzyChat Lite

The release flow for **EzyChat Lite** (this repository, public). **EzyChat Enterprise** has its own flow in
its repository: `anchorsprint/ezychat-enterprise` → `docs/releases.md` (self-hosted runners, installers and
`latest.json` on `dl.ezychat.ai`, published automatically by its `v*` tag). Enterprise always follows a Lite
release: it moves its `@ezychat/*` pins to the new version first.

**Cadence:** one release a day of both editions when something changed; merge without releasing unless the
change is important (owner rule). Merge only on the owner's explicit request, including the release PR.

## 1. Release PR

On a branch `chore/release-<version>` from `main`:

1. Bump the root `package.json` version and run `npm run version:sync`. In `package-lock.json` keep `main`'s
   file and change only the workspace versions and the `@ezychat/*` pins from the old to the new version
   (about 22 lines). Do not run `npm install --package-lock-only`: another npm version rewrites `peer` flags
   and can drop optional packages (it removed `@napi-rs/canvas` once).
2. In `CHANGELOG.md`, add `## [<version>] - <date>` under `## [Unreleased]` so the unreleased entries move
   into it. **Write it in plain language for users**: this section becomes the GitHub release notes and the
   "What's new" text of the in-app update dialog (`scripts/release-notes.mjs`). A tag without a section
   stops the release workflow before it builds.
3. Check the notes: `node scripts/release-notes.mjs v<version>`.
4. Open the PR `chore(release): <version>`; wait for CI; merge when the owner asks.

## 2. Tag

On the merge commit, an annotated tag: `git tag -a v<version> <commit> -m "EzyChat Lite <version>"`, then
`git push origin v<version>`. If a fetch or push fails (network), check both sides before you retry:
`git rev-list -n1 v<version>` (local tag) and `git ls-remote --tags origin v<version>` (remote tag) — a failed
`git fetch` earlier in the same command can skip the tag step entirely. The tag starts two workflows:

| Workflow               | What it does                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release.yml`          | Builds Windows x64 (signed through Azure), macOS arm64 and macOS x64 on GitHub-hosted runners; smoke-tests the packaged server; creates a **draft pre-release** with the notes from `CHANGELOG.md` and uploads each installer twice: the versioned file (`EzyChat-Lite-<version>-win-x64.exe`, used by the in-app updater) and a copy without the version (`EzyChat-Lite-win-x64.exe`, for permanent download links). |
| `publish-packages.yml` | Publishes `@ezychat/shared`, `wa`, `server`, `web`, `desktop` to npm (trusted publishing). Enterprise needs these.                                                                                                                                                                                                                                                                                                    |

## 3. Hold, then promote (owner rule, 2026-11-20)

Releases go out daily, but **"latest" stays on the newest version whose installers McAfee has cleared**: every
installer (Windows, Mac Apple silicon, Mac Intel) is **Whitelisted** or the owner's **Passed** in
`anchorsprint/ezychat-enterprise` → `docs/antivirus-allowlist.md`. "Latest" means the in-app updater, GitHub
`releases/latest` and the permanent links in §5. So a new version is built, tagged and published to npm, then
**held as a complete draft**; **Promote release** publishes it once McAfee clears it. Installed apps are usually one
release behind the newest build.

Why a draft and not a pre-release or "not latest": the in-app updater (`apps/desktop/src/update-checker.ts`) reads
the whole release list (`GET /repos/…/releases`), never `releases/latest`, so GitHub's Latest flag does not hold it;
and a 0.x install also takes a published GitHub pre-release (`allowPreview` is on below 1.0.0). A draft is the only
state every shipped updater ignores (`draft !== false` → skipped), and drafts are not listed publicly at all. The
contract is pinned by a test in `update-checker.test.ts` ("holds a 0.x install on the cleared version…").

1. Check the held draft: `gh release view v<version>` — 6 installer files (3 versioned + 3 copies) and the notes.
   `release.yml` checks this itself and says so in its run summary. Check npm: `npm view @ezychat/server version`.
2. Submit the installers to McAfee (`submit-installers` skill; it downloads a draft's files through the API). The
   owner's "release" covers this submit, and the session that released the version does it at once (owner rule,
   2026-11-22). The release is not done while any of its 3 installers is "Not submitted" in the record.
3. When McAfee clears **all** installers of the version, start **Promote release**
   (`.github/workflows/promote-release.yml`) on `main`:
   `gh workflow run promote-release.yml --ref main -f version=<version> -f confirm=<version> -f mcafee_cleared=true -f hold_newer=false`
   (or Actions → Promote release → Run workflow; an agent may start it through the GitHub tools when the owner has
   said the version is cleared). It checks the draft (`scripts/release-publish.mjs promote`: 6 installers, notes,
   newer than every published release), publishes it in one call (`--draft=false --prerelease=false --latest`) and
   fails unless `releases/latest` and the newest published release are the new tag. Installed apps update at their
   next check and jump straight to it (never through older versions: every upgrade step lives in a migration or
   start-up code, see `AGENTS.md`), so promoting a newer cleared version also covers the held ones before it.
4. Then the website PR: calendar ✓ and the download pin (`submit-installers`, "Answers").

`hold_newer=true` is only for going back to an older cleared version: a promoted version that McAfee later flags,
or the switch-over to this rule. It turns every newer **published** release back into a draft first (refused
without it). Installed apps never downgrade, so apps already on the newer version keep it; it only stops it
reaching the others. Promoting the newer version later publishes it again. Never delete a release (§6).

Manual fallback (no Actions): `gh release edit v<version> --draft=false --prerelease=false --latest`, then
`gh api repos/ossmalaysia/ezychat-lite/releases/latest -q .tag_name`. Without `--prerelease=false` GitHub refuses
"Latest".

## 4. One-click release (default)

Steps 2 and 3 run in GitHub Actions from one start, so a cloud session (which cannot push tags or run
`gh release edit`) can release. **An agent starts it only when the owner says "release" in chat** (owner rule).

1. After the release PR is merged, start **Release (approved)** (`.github/workflows/release-approve.yml`) on
   `main`: `gh workflow run release-approve.yml --ref main -f version=<version> -f confirm=<version>` or Actions →
   Release (approved) → Run workflow. The gate is: a `workflow_dispatch` on `main` (only users with write access),
   `confirm` equal to `version` (typo guard) and the `check` job, which stops before any write when the version is
   not `x.y.z`, `package.json` on `main` is another version, `CHANGELOG.md` has no section for it, `main` moved
   since the run started, or the tag already exists.
2. The `release` job (environment `release-approval`) checks again, creates the annotated tag `v<version>`
   ("EzyChat Lite <version>") on that `main` commit through the API and starts `release.yml` (with `publish=true`)
   and `publish-packages.yml` on the tag. A tag created with `GITHUB_TOKEN` starts no `on: push: tags` workflow,
   so both are started with `workflow_dispatch`.
3. `release.yml` builds the three installers as before. Its `publish` job ("Check the held draft") runs only when
   every build succeeded, only for a dispatch with `publish=true` on the tag itself, and checks the draft
   (`scripts/release-publish.mjs`: 6 installer files, not empty, notes from `release-notes.mjs`). It **does not
   publish**: the draft is held until McAfee clears it and Promote release publishes it (§3). A failure means the
   draft is incomplete: fix it or rebuild with
   `gh workflow run release.yml --ref v<version> -f ref=v<version> -f publish=true`.
4. Check npm (`npm view @ezychat/server version`): the npm publish runs beside the build and does not hold
   back the GitHub release.

The environment `release-approval` needs no reviewer. Adding Required reviewers to it later (Settings →
Environments → `release-approval` → Required reviewers) turns this into a tap-to-approve flow with no code change:
the `release` job then waits for the tap and checks everything again before tagging.

§2 stays as the manual fallback (a tag pushed by a person still starts both workflows; that `release.yml` run leaves
the draft unpublished); either way the draft becomes public only through §3.

## 5. Download links (never change)

| Link                                                                                            | Gives                                                                                        |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `https://ezychat.ai/download` (partners add `?ref=<code>`) — **planned**, website repo          | Detects Windows / Mac and starts the newest installer; buttons for the others (website repo) |
| `https://github.com/ossmalaysia/ezychat-lite/releases/latest/download/EzyChat-Lite-win-x64.exe` | Newest Windows installer                                                                     |
| `…/releases/latest/download/EzyChat-Lite-mac-arm64.dmg`                                         | Newest Mac installer (Apple silicon)                                                         |
| `…/releases/latest/download/EzyChat-Lite-mac-x64.dmg`                                           | Newest Mac installer (Intel)                                                                 |
| `https://github.com/ossmalaysia/ezychat-lite/releases/latest`                                   | The newest release page                                                                      |

GitHub's `latest` counts only published, non-pre-release releases, so these links give the newest version McAfee
has cleared: a new version reaches them only through Promote release (§3). Never rename the copies: shared links
depend on them.

## 6. After the release

- Enterprise: pins to the new core version, its own release (`docs/releases.md` there).
- A bad release is fixed by a **new** version (hotfix), never by deleting a published release: installed
  apps may already run it.
- Update `docs/backlog.md` for items the release closed.
- **Antivirus:** a release has new files with new hashes. When the owner asks, report them to McAfee with the
  `submit-installers` skill (`node scripts/mcafee-submit.mjs --edition all`: Lite and Enterprise, Windows and both Macs).
  When McAfee clears every file of a version: Promote release (§3; Enterprise: its `promote-release`), then the
  website PR (calendar ✓ and the download pin).
- **Website release page** (owner rule): on release day, after Enterprise is out too, open one
  ossmalaysia/ezychat-website PR that adds the day to `/releases`: rows in `src/lib/release-calendar.json`
  written in plain words from this CHANGELOG section (and Enterprise's), shipped `upcoming` items moved into
  them, every new line in BM, 中文 and ID in `release-calendar-i18n.json` (feature names from the app's own `ms` /
  `zh-CN` locales). Merge the guide PRs held for this release in the same round. The website's `/download`
  stays on the newest whitelisted version (below). The release is done only when that PR is merged (the website's
  release skill).
- **Security mark on the calendar** (owner rule, 2026-11-20): every new Lite and Enterprise version goes into
  `release-calendar.json` with `security: "pending"`, shown as "!" (Security scan pending). It becomes
  `"whitelisted"` (✓ Scanned by McAfee) only when every installer of that version (Windows, Mac Apple silicon, Mac
  Intel) is **Whitelisted** or the owner's **Passed** in the allowlist record. Releases keep going out daily
  regardless.
- **Website download stays one release behind**: the website's download links are pinned to the newest version
  marked `whitelisted`, never to a `pending` one. The pin moves only when McAfee answers (the `submit-installers`
  skill). The GitHub `releases/latest` links in §5 still serve the newest release.
