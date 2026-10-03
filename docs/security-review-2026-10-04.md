# Security review — 4 October 2026

Reviewed EzyChat Lite 0.1.13 at `8cce20744e6ee877c420dd91798e81e27ccb377d`.
The proposed patch is 0.1.14. Source fixes are separate from the currently running local build.

## Scope and evidence

- Authentication and account recovery; HTTP Host/Origin/proxy boundaries; first-admin setup;
  Socket.IO authorization; media delivery, push endpoints and public browser-error reporting.
- Electron navigation, frame permissions, privileged IPC and Windows service scripts.
- Live log structure (field names only, no secrets copied), support ZIP exports, temporary
  password generation, lockfile dependency audit and existing SonarCloud results.
- Tests use isolated temporary data and fake WhatsApp. No messages were sent from the business
  number and no company data or installed service permissions were modified.

The repository uses [SonarCloud](https://sonarcloud.io/dashboard?id=ossmalaysia_wa-team-inbox&branch=main),
with its historical project key. Its public API reported 11 unresolved vulnerabilities,
416 code smells, two bugs, zero open security hotspots and security rating C. The quality gate
failed on the new-code security rating. This is a baseline, not the result of scanning this patch.

## Practical issues fixed

| Priority | Finding and effect                                                                                                               | Fix and evidence                                                                                                                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Password changes already hashing could overwrite an admin reset or succeed after session revocation.                             | Revalidate the live session and conditionally update against the original password hash, without yielding between check and commit. Regression tests pause real hashing during recovery/revocation.                                                                 |
| High     | An admin demoted or revoked during hashing could still reset another account's password.                                         | Recheck the current authorizing session, role and forced-password-change status immediately before writing credentials. Tests exercise demotion and revocation mid-request.                                                                                         |
| Medium   | Login using an old password could create a new session after that password was reset.                                            | Recheck the current password hash and disabled status, then synchronously create a session using the current user role. Tests pause verification during account changes.                                                                                            |
| Medium   | Token-configured tunnels without known hostnames enabled unrestricted public Host headers for direct HTTP and Socket.IO clients. | Limit unknown hosts to loopback proxy peers with a single valid CF client IP. Malformed/duplicate IP values cannot become rate-limit identities; any CF header prevents direct first-admin setup. HTTP and socket regression tests initially reproduced the bypass. |
| Medium   | Privileged desktop controls trusted every `file://` document rather than the application's status window.                        | Bind IPC to the current registered window, exact main frame and bundled file URL; reject extra renderer arguments and scope status broadcasts to that window. Tests reject unrelated files, windows and child frames.                                               |
| Medium   | Desktop permissions trusted a parent page and allowed camera/microphone access unused by the app.                                | Validate both document and requesting main frame, deny unused permissions, external frame navigation/redirects and webviews. Notification, clipboard and fullscreen allowances remain scoped to the configured inbox.                                               |
| High     | A SYSTEM service's protected wrapper could execute a user-writable unpacked/custom app runtime.                                  | Elevated installation now requires a protected Program Files runtime, trusted ownership, no untrusted write ACLs and no filesystem links. Starting an existing service validates its stored executable. Unpacked standalone use remains supported.                  |
| Medium   | Temporary member passwords fell back to `Math.random` if browser cryptography was absent.                                        | Require `crypto.getRandomValues`, which also works on supported LAN HTTP browsers; disable automatic generation when unavailable and allow manual password entry. Tests cover secure generation without `randomUUID` and both missing-crypto cases.                 |
| Medium   | WhatsApp history notifications included `mediaKey` in local logs; support exports exposed these keys.                            | Redact known credential fields from live logging and recursively sanitize existing JSON log records in streamed ZIP exports. Omit incomplete/non-JSON records. An actual ZIP regression verifies deep secrets are removed and original files stay untouched.        |

An additional **high-priority macOS service issue** was fixed during the final review: `ditto`
preserved source write ACLs even after root ownership and restrictive POSIX modes. Runtime copies
now use `--noacl` and explicitly clear runtime ACLs while retaining extended attributes and
quarantine metadata. Privileged install/reset rejects development builds without a packaged
bundle. Packaged recovery continues to use the protected runtime copy. Focused tests cover the
copy policy, rejected development operations and remapped recovery paths.

The credential and hostname regressions produced seven failures before their fixes. No changes
were needed to the existing media inline-type allowlist, push host allowlist, hashed sessions,
Origin checks, CLI-only admin recovery or size/rate limits for browser errors.

## SonarCloud dispositions

All 11 baseline security findings are covered below. Accepted findings still need a maintainer
to apply their reviewed disposition in SonarCloud; this document does not close issues there.

| Rule / baseline location                                      | Disposition                          | Reason                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jssecurity:S8705`, `scripts/smoke-packaged.mjs:30`           | Accept local tooling risk            | The trusted developer explicitly chooses the packaged executable directory. The script resolves an absolute executable path and passes an argument array without a shell. It accepts no remote input and gains no additional privilege. It intentionally runs that developer-selected build.     |
| `jssecurity:S8701`, same location                             | Accept local tooling risk            | Same boundary as above; no command string or shell interpolation. Treating a developer-selected executable as forbidden would prevent the packaged runtime smoke test.                                                                                                                           |
| `jssecurity:S8707`, `e2e/electron-screens.smoke.mjs:11`       | Accept intended local output path    | The invoking developer chooses the screenshot output directory with their own filesystem authority. No HTTP, WhatsApp or renderer input controls it.                                                                                                                                             |
| `jssecurity:S8707`, `e2e/screens.smoke.mjs:11`                | Accept intended local output path    | Same local CLI output-directory contract. Restricting it to the repo would unnecessarily prevent useful temporary-directory test runs.                                                                                                                                                           |
| `typescript:S4036`, `apps/desktop/src/server-process.ts:161`  | Accept explicit development fallback | `spawn('node')` is an opt-in development runtime. Packaged production uses Electron's owned utility process, and the SYSTEM service runs the protected packaged executable. Do not opt into a development fallback with an untrusted PATH.                                                       |
| `Web:S7039`, `apps/desktop/src/renderer/status.html:6`        | Fixed in source                      | Move styles into bundled `status.css` and remove `unsafe-inline` from `style-src`.                                                                                                                                                                                                               |
| `typescript:S2245`, `packages/server/test/auth-helpers.ts:28` | Fixed in source                      | Use `crypto.randomUUID` for unique test usernames. These names were never credentials.                                                                                                                                                                                                           |
| `typescript:S2245`, `apps/web/src/admin/adminUi.tsx:185`      | Fixed in source                      | Remove the insecure temporary-password fallback and provide manual entry when crypto is unavailable.                                                                                                                                                                                             |
| `typescript:S2245`, `apps/web/src/api/queries.ts:210`         | Accept non-secret identifier         | The fallback creates message correlation/idempotency IDs, not passwords, sessions or authorization tokens. Every request is separately authenticated. Collisions are a reliability concern; no secret or access boundary relies on unpredictability.                                             |
| `githubactions:S6505`, `.github/workflows/ci.yml:30`          | Accept reviewed build requirement    | Dependency lifecycle scripts install required Electron, esbuild and native-module components. Blanket `--ignore-scripts` breaks the verified build. Dependencies are lockfile-pinned, actions SHA-pinned and CI permissions read-only. Lifecycle scripts remain a supply-chain trust assumption. |
| `githubactions:S6505`, `.github/workflows/release.yml:44`     | Accept reviewed build requirement    | Same required installation hooks. Release automation runs trusted repository code; no fork PR release job is enabled. A future explicit lifecycle-script allowlist can reduce this risk, but needs native packaging validation on every platform.                                                |

Related code smell `typescript:S1313` in `http/client-ip.ts`: retain literal loopback addresses.
They define the trusted proxy/setup boundary; making them configurable would weaken the defense.
The remaining general code smells and bugs were not treated as security vulnerabilities.

## Dependency results and accepted risks

`npm audit --omit=dev --json` reported **zero production dependency vulnerabilities**.
The full audit reported **eight high package entries from one build-tool dependency chain**:
`electron-builder → app-builder-lib → @electron/get → got → cacheable-request → http-cache-semantics`,
including the related builder packages affected transitively.

The underlying [GHSA-ch52-4w7c-c8xp advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
concerns shared HTTP-cache handling of private responses and `Set-Cookie`; it lists no patched
`http-cache-semantics` release as of this review. This package is not in the production audit.
Inspection of the builder's `GotDownloader` shows public binary downloads without enabling Got's
shared HTTP-cache option. We infer that the reported vulnerable behavior is not reached by this
app's current download path. The audit warning remains; monitor for an upstream fix. Do not run
`npm audit fix --force`: its suggested electron-builder downgrade changes the packaging toolchain
without providing a verified fix for the underlying package.

Other remaining limits:

- Existing local logs retain their original contents; new logs and exported downloads are
  protected. Do not share raw old log files. Structured redaction cannot remove arbitrary secrets
  typed into free-form text, and support logs can still contain customer metadata.
- Already-installed service runtimes are not automatically migrated. For an unsafe Windows
  service, stop it and reinstall the app in protected Program Files before enabling it again.
  For macOS, reinstall the service to recreate its runtime without source ACLs. Standard unpacked
  development builds can continue in standalone mode.
- Installers are still unsigned, and macOS signing/notarization requires maintainer certificates.
  This review cannot eliminate OS reputation warnings without a release-signing process.
- LAN HTTP does not provide transport encryption. Use the HTTPS tunnel for access beyond a
  trusted network. Browser dangerous-site/reputation warnings are a separate provider review.

## Verification and delivery

Focused validation passed: 79 authentication/HTTP/socket tests, 85 desktop tests and 14
password-generation/logging/admin tests; server and desktop typechecks passed. After the
additional macOS fix, its 23 focused service tests and desktop typecheck also passed.
The native Windows negative test rejected a temporary unpacked runtime before machine-data
creation, without elevation. A successful elevated service installation and real macOS service
operation have not been exercised in this review.

Consolidated typecheck, 741 unit tests, lint and web build passed; the later macOS change received
the focused validation above and a lint check. The browser run passed 42 of 43 cases; the remaining
iPhone update-toast click timed out, then passed in a focused rerun (setup plus that case) without
source changes. This intermittent timing failure remains a test-suite limitation.

An isolated Electron harness with a temporary profile loaded the compiled patch modules and
sandboxed status preload. It verified the trusted status/recovery calls, external stylesheet
loading and rejection of recovery calls from another window loading the very same local file.
The protected main branch requires another maintainer's approval. A new SonarCloud analysis is
required before claiming its gate passes. The running local app remains 0.1.13 until deployment.
