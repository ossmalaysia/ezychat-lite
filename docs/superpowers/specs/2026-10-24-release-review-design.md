# Release review: risk score for every change (Lite and Enterprise)

Status: draft for owner approval (2026-10-24). Nothing is built before the owner approves this document.
**The current merge rule stays in force until the owner approves the policy change in writing** (section 9).

## 1. Intent

The owner cannot test every change by hand. Most changes are already proven by unit tests, e2e tests and a
Dev Build check; some changes can break the app for every user and need the owner's own test. Today every
merge waits for the owner, so safe changes wait as long as risky ones.

The release review gives every pull request a **safety score** from a fixed rubric. The score comes from two
things: how risky the change is (which components it touches, how large it is) and how much test evidence
proves it. A high score releases without the owner; a low score, or a hard stop, waits for the owner's test.
Every score is logged in the repo, so the owner can audit any decision later.

## 2. Goals, non-goals, anti-goals

Goals

- One deterministic score per PR head commit: the same inputs always give the same score.
- The main question for risk: **"If this part breaks, does the app still work?"** Critical parts weigh most.
- Evidence counts only when it is tied to the scored commit (CI run, Dev Build row, workbook entry).
- A written review log in the feature folder, plus a permanent index.
- The same skill and rules in Lite (`ossmalaysia/ezychat-lite`) and Enterprise (`anchorsprint/ezychat-enterprise`),
  each with its own component map.

Non-goals

- No review of changes that are already released.
- No AI judgement in the score. An agent runs the skill, but the score comes from a script and the rubric;
  the agent may add notes, never points.
- No change to the existing test rules (coverage ≥ 90 %, one mock e2e round, Dev Build check, screen review).
  The score reads their results; it does not replace them.

Anti-goals (a failure even if it works)

- A Critical change (for example Baileys) released without a test on the real part.
- A score that a PR can raise with tests that only run code (AGENTS.md: coverage counts only real assertions).
- Evidence from an older commit counted for a newer one.
- The owner unable to see why a PR was released without them.

## 3. The rubric

The score starts at **50**. Risk items subtract, evidence items add. The result is clamped to 0–100.

| Result                            | Decision                                      | PR label     |
| --------------------------------- | --------------------------------------------- | ------------ |
| Score ≥ 70 and no hard stop       | Safe: release without a human test            | `risk:auto`  |
| Score < 70, or any hard stop      | The owner tests and approves first            | `risk:human` |
| Only docs/tests/screenshots files | Score 100, safe                               | `risk:auto`  |
| Only release-pipeline files       | Goes ahead (owner rule: testable only by a release) | `risk:pipeline` |

A PR that mixes pipeline files with other files is scored on the other files only; the pipeline files add no
risk points.

### 3.1 Tier points (risk)

Each changed file maps to one tier through the component map (section 4). **The highest tier touched sets the
tier points for the whole PR.** Unmapped code files count as Core until the map is updated (a safe default).

| Tier         | If it breaks…                                  | Points |
| ------------ | ---------------------------------------------- | ------ |
| Critical     | the app stops working, or data is lost         | −30    |
| Core         | the app runs, but a main daily task fails      | −15    |
| Non-core     | the app works; only a side feature fails       | −5     |
| Docs / tests | nothing breaks                                 | 0      |
| Pipeline     | shows only after a release                     | 0      |

### 3.2 Size points (risk)

Counted lines = added + deleted lines in code files only (not docs, tests, screenshots, lockfiles, generated
files, mock folders under `docs/features/`).

| Counted lines | ≤ 50 | 51–300 | 301–1,000 | > 1,000 |
| ------------- | ---- | ------ | --------- | ------- |
| Points        | 0    | −10    | −20       | −35     |

### 3.3 Evidence points

Each item counts only when its proof names the scored head commit (or a CI run on it).

| Evidence                                                   | Proof read by the script                                     | Points        |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------- |
| Changed-lines coverage ≥ 90 % / ≥ 95 %                     | `coverage:changed` result of the CI run on the head commit   | +15 / +20     |
| e2e passed, with a spec that covers the change             | workbook E2E stage `done` naming the spec; CI/local e2e on head | +10        |
| Desktop link check passed (only when a screen changed)     | workbook E2E entry naming `e2e:electron-links`              | +5            |
| Dev Build check on the head commit                         | a row in `docs/dev-build-checks.md` with the head short SHA | +10           |
| Screen review done (only when a screen changed)            | workbook Screen review stage `done`                         | +5            |
| Real-part test (Critical only: real WhatsApp, packaged install) | a Dev Build row marked `real:` with the head short SHA | +15           |

Coverage below 90 % fails CI, so such a PR is never scored as safe.

Rules for reading evidence (builder check; agent's call, owner may change):

- **Not applicable = full points.** The link check and the screen review apply only when a screen changed
  (a file under `apps/web/src/**` or `apps/desktop/src/**` that is not a test); the real-part test applies only to
  Critical. When an item does not apply, it scores its full points, so a server-only PR can still reach 100.
- **Workbook entries name the commit.** `scripts/build-summary.mjs record` gets a `--sha` option (default: the
  current `HEAD` short SHA) and stores it in a new workbook column. Stage status `done` and `pass` count; `skip`
  counts only when the detail says "not needed" and the item does not apply.
- **Enterprise gets the same workbook script** (`scripts/build-summary.mjs`, `docs/workbooks/`) as part of this
  work, so its evidence is read the same way.

### 3.4 Hard stops (always `risk:human`, whatever the score)

1. A Critical file changed and no real-part test row exists for the head commit.
2. A database migration that moves or rewrites existing data (the script flags any new file under a
   migrations folder; the reviewing agent confirms "adds only" or "moves data" in the log).
3. A change to a security invariant: any file the component map marks `security: true`, or an edit to the
   "Security invariants" section of AGENTS.md.
4. Any required CI check not green on the head commit.

### 3.5 Worked examples (from merged Lite PRs)

| PR                       | Tier     | Size | Evidence | Score | Decision                 |
| ------------------------ | -------- | ---- | -------- | ----- | ------------------------ |
| #158 customer name fix   | Non-core | 0    | +50      | 95    | auto                     |
| #162 Upgrade links       | Non-core | −20  | +50      | 75    | auto                     |
| #159 send reactions      | Critical | −35  | +50      | 35    | human (also hard stop 1) |

(+50 = coverage 20, e2e 10, link check 5, Dev Build 10, screen review 5.)

## 4. Component map

`docs/release-review/components.json` in each repo: an ordered list of glob patterns with a tier, a name and
optional flags. The first match wins. The owner may move any part to another tier; the file is reviewed like
code.

```json
{
  "version": 1,
  "components": [
    { "glob": "packages/wa/src/baileys/**", "tier": "critical", "name": "WhatsApp (Baileys)", "realTest": "real WhatsApp" }
  ]
}
```

### 4.1 Lite tiers (initial map)

| Tier     | Parts                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Critical | `packages/wa/**` (adapter, Baileys), `wa-bridge`, send queue, message ingest/storage, `db/**` and migrations, server start-up/CLI/config, auth/sessions, `http/**` security checks (`security: true`), access gate, desktop main process, server host, service install, updater (`realTest: packaged install`), backups, `packages/shared` schemas used by REST/socket |
| Core     | inbox and conversation screens, composer, Socket.IO realtime, push, AI agent reply service and prompt, inbox access (`security: true`), customer profiles, tunnel |
| Non-core | admin pages, Settings, About and links, MCP tools (token checks are `security: true`), quick replies, customer enrichment, audit view, i18n catalogs |
| Docs/tests | `docs/**` (except `docs/release-review/components.json`, which is Core), `**/*.test.*`, `e2e/**`, `docs/screenshots/**` |
| Pipeline | `.github/workflows/**`, `scripts/*release*`, signing and publish scripts, `apps/desktop/electron-builder.yml` signing keys |

### 4.2 Enterprise tiers (initial map)

| Tier     | Parts                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Critical | `packages/ent-licence/**` (licence check, access gate, portal client, host-PC registration), the desktop product definition (app ID, data folders, service ID, port), the update feed (`latest.json`), extension migrations |
| Core     | `packages/ent-server/**` and `packages/ent-connectors/**` used by the inbox or the AI (look-ups, agent tools), Enterprise web routes in the daily flow |
| Non-core | `packages/ent-licence-web/**` texts, `packages/ent-web/**` admin sections, status window cards, branding, links |
| Docs/tests | `docs/**`, test files, `packages/connector-testkit/**` |
| Pipeline | `.github/workflows/**`, installer build, signing, publish to dl.ezychat.ai |

**Dependencies** (agent's call): a version change in any `package.json` for a dependency the map lists as
critical (Lite: `baileys`, `electron`, `better-sqlite3`, `@node-rs/argon2`, `electron-builder`, `fastify`; Enterprise:
the same plus the `@ezychat/*` pins, handled by section 4.3) is Critical; any other dependency change is Core.
Lockfiles count 0 lines but follow their `package.json`. Config files (`vitest.config.ts`, `tsconfig*.json`, ESLint,
Prettier) are Non-core; `AGENTS.md`, `CLAUDE.md` and `.claude/**` are Docs, except the AGENTS.md security
section (hard stop 3).

The builder refines both maps from the real file tree; every code file must match a rule (the script lists
unmatched files so the map stays complete).

### 4.3 Enterprise core bump

A PR that changes the pinned `@ezychat/*` version brings in every Lite PR between the old and the new core
version. The script reads the Lite index (section 5.2, through `gh api` on the public Lite repo) for those PRs:

- The bump's base score is the **lowest Lite score** among them.
- If any of them was `risk:human`, the bump is `risk:human` unless the Lite log shows the owner's approval for
  that PR (then the owner does not test the same change twice).
- **Lite PRs merged before the release review starts** (the merge date of the PR that adds this system) count
  as approved (owner decision 2026-10-24: the owner merged each one under the old rule). They add no score; if
  every PR in the range is older, the bump is scored on its Enterprise files and evidence only. The PR list for a
  range comes from the Lite tags `v<old>..v<new>` (squash-merge commits name their PR number).
- Enterprise evidence (typecheck, lint, tests on the new core, Dev Build on the head commit) is listed in the
  log but cannot raise the bump above the lowest Lite score.
- Enterprise files changed in the same PR are scored as usual; the lower of the two scores counts.

## 5. Logs

### 5.1 Review log

Each run appends one entry; old entries are never edited. A new commit after a review means a new run and a
new entry; only the newest entry for the head commit counts.

- With a feature folder: `docs/features/<feature>/review.md`. The script finds the folder from a `Feature:`
  line in the branch workbook, then from a folder named like the branch (without `feat/`, `fix/`); otherwise
  it uses the shared log (agent's call).
- Without one (small fixes, docs, pipeline): `docs/release-review/log.md`.

Entry content: date, PR number, scored head SHA, tier and the files that set it, the score table (each item,
points, proof link or path), hard stops checked, decision, and — for `risk:human` — the owner's test result and
approval with date (added by the agent from the owner's chat message, quoting it).

### 5.2 Index

`docs/release-review/index.md`: one table row per run (date, PR, SHA, tier, score, decision, log path). It is
never pruned, so scores stay visible after the five-folder retention rule removes an old feature folder.

## 6. The skill and the script

- `scripts/release-review.mjs <pr> [--write]`: deterministic. Reads the PR diff and head SHA (`gh pr view`,
  `gh pr diff --name-only` and numstat), the component map, the CI checks on the head SHA (`gh pr checks`,
  and the coverage result from the CI job), the workbook `docs/workbooks/<branch>.md` and
  `docs/dev-build-checks.md`. Prints the score table as JSON and Markdown. With `--write` it appends the log
  entry and the index row.
- `.claude/skills/release-review/SKILL.md`: tells the agent when and how to run the script, to confirm the
  migration question (hard stop 2), to commit the log on the PR branch, to post the Markdown table as a PR
  comment and to set the label. The agent never edits points.
- The same script and skill go into both repos (Enterprise keeps its own copy; no shared package is needed).
  Each repo has a unit test for the script with fixture PRs, including the three worked examples.
- When: after the last verification step of a PR (CI green, workbook stages recorded), and again after any
  new commit.

Committing the log changes the head commit. Rule: the log commit touches only review files
(`review.md`, `log.md`, `index.md`); the script ignores such a commit when it finds the scored SHA, so the
evidence stays valid. Any other change after the review means a new run.

## 7. What "release without a human test" does

After the owner approves section 9:

- `risk:auto` and `risk:pipeline`: the agent may merge the PR (squash) without an explicit merge request.
  The change then goes out in the next daily release, which follows `docs/release.md` (Lite) or
  `docs/releases.md` (Enterprise) as today.
- `risk:human`: nothing changes from today. The owner tests, the agent records the result in the log, and the
  PR merges only on the owner's explicit merge request.
- A release PR itself keeps today's rule ("release" authorizes the release PR merge, the tag and the publish).

## 8. Constraints

- Private Enterprise CI runs only on the org's self-hosted runners; the script runs on the agent's machine and
  needs no new CI job.
- Enterprise doc-only commits use `[skip ci]`; the log commit in Enterprise uses it too. Lite has required
  checks, so a Lite log commit runs CI (the script then still finds the scored SHA, per section 6).
- GitHub Actions stay pinned to full SHAs (no change expected).
- No secrets, customer data or phone numbers in logs.

## 9. Policy change (needs the owner's written approval)

When the owner approves this document, AGENTS.md "Merge only when the owner explicitly requests merging that
PR" is changed to: "Merge only on the owner's explicit request, **or** when the newest release review of the
PR's head commit is `risk:auto` or `risk:pipeline` (docs/release-review)." The same change goes into the
Enterprise AGENTS.md and into the agent's memory. Until then, the skill only scores, logs, comments and labels.

## 10. Left to the builder

- Exact globs for both component maps (from the real tree), within the tiers above.
- How to read the coverage percentage from the CI job (log line or artifact).
- The Markdown layout of the log entry and the PR comment.
- Label colours.
