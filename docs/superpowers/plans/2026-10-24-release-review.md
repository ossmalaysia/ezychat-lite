# Release Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic safety score for every PR (Lite and Enterprise), written to a review log, a permanent
index, a PR comment and a label — scoring only; the merge rule does not change.

**Architecture:** Pure modules under `scripts/release-review/` (component map, evidence parsers, rubric, log
rendering) behind one CLI `scripts/release-review.mjs` that gathers facts with `git` and `gh`. A skill tells the
agent when to run it and how to post the result. Enterprise gets a copy plus a core-bump module.

**Tech Stack:** Node 24 ESM `.mjs`, Vitest (`scripts` project), `gh` + `git` through the same resolver as
`scripts/build-summary.mjs` (usual install paths or `GH_PATH`/`GIT_PATH`, never a PATH lookup).

**Spec:** `docs/superpowers/specs/2026-10-24-release-review-design.md` (approved 2026-10-24; **section 9 not
approved**).

## Global Constraints

- Score starts at 50, clamp 0–100; `risk:auto` at ≥ 70 with no hard stop; else `risk:human`.
- Docs/tests/screenshots only → 100 `risk:auto`; pipeline only (pipeline + docs/tests) → `risk:pipeline`.
- Tier points (highest tier wins): critical −30, core −15, noncore −5, docs 0, pipeline 0. Unmapped code → core.
- Size points on counted code lines: ≤ 50: 0; 51–300: −10; 301–1,000: −20; > 1,000: −35.
- Evidence: coverage ≥ 90 % +15 / ≥ 95 % +20; e2e +10; link check +5; Dev Build +10; screen review +5;
  real-part test +15. Not applicable = full points.
- Hard stops: (1) critical without a real-part row; (2) new migration file not confirmed `adds-only`;
  (3) a `security: true` file or the AGENTS.md "Security invariants" section changed; (4) a required check not green.
- The agent never edits points. No secrets, customer data or phone numbers in logs.
- The script never merges, never tags. The skill only comments and labels (section 9 not approved).
- Release PRs (title starts `chore(release)`) are not scored.
- Stage named files only; never stage `CLAUDE.md`. Enterprise doc-only commits use `[skip ci]`.

## Review Focus

1. Evidence from an older code commit: a workbook or Dev Build row naming a SHA, followed by a code commit →
   that evidence must not count (Task 3 test `stale evidence after a code commit scores 0`).
2. Evidence followed only by neutral commits (workbook, logs, dev-build-checks, screenshots, LEARNINGS) →
   it still counts (Task 3 test `evidence survives a workbook-only commit`).
3. A file that matches no rule in the map → treated as core and listed under `unmapped` in the output
   (Task 2 test `unmapped code file is core and reported`).
4. A `package.json` change that only bumps the root `version` (no dependency change) → noncore, not critical
   (Task 2 test `version-only package.json is noncore`).
5. CI still running on the head commit → hard stop 4 with reason `checks pending`, never auto
   (Task 4 test `pending checks are a hard stop`).

---

## File Structure (Lite)

| File | Responsibility |
| --- | --- |
| `docs/release-review/components.json` | Tier map, screen globs, neutral globs, critical dependencies |
| `docs/release-review/index.md` | Permanent index table (header only at first) |
| `docs/release-review/log.md` | Shared review log (header only at first) |
| `scripts/release-review/components.mjs` | Load map; classify a file; classify dependency changes |
| `scripts/release-review/evidence.mjs` | Parse workbook (with Commit column), Dev Build rows, coverage line; SHA validity |
| `scripts/release-review/rubric.mjs` | `scoreChange()`: pure score + hard stops + decision |
| `scripts/release-review/log.mjs` | Render log entry, PR comment, index row; append |
| `scripts/release-review.mjs` | CLI: gather with git/gh, call the modules, print, `--write` |
| `scripts/build-summary.mjs` | `record --sha`, new Commit column (backward compatible) |
| `scripts/release-review/*.test.mjs`, `scripts/build-summary.test.mjs` | Tests |
| `.claude/skills/release-review/SKILL.md` | When and how the agent runs it |
| `AGENTS.md` | One Working-rules bullet; Security invariants unchanged |

---

### Task 1: Workbook entries record their commit

**Files:** Modify `scripts/build-summary.mjs` (`parseWorkbook`, `setStage`, `tableRow`, CLI `record`); Test
`scripts/build-summary.test.mjs`.

**Interfaces:**
- Produces: workbook table `| Stage | Status | Detail | Commit | Updated |`; `parseWorkbook(md)` returns
  `{ stages: { [name]: { status, detail, commit, updated } } }` (`commit` = `''` for old 4-column rows);
  `setStage(md, meta, stage, status, detail, date, commit)`; CLI `record <stage> <status> "<detail>" [--sha <short>]`,
  default `git rev-parse --short=7 HEAD`.

- [ ] **Step 1: Failing tests** — `parses old 4-column workbooks with commit ''`; `setStage writes the Commit
  column`; `record defaults --sha to HEAD` (inject the git runner the file already uses for tests, or test
  the argument parser function that returns `{ sha }`). Assert the log line becomes
  `- <date> <Stage>: <status> — <detail> (<sha>)`.
- [ ] **Step 2:** `npx vitest run scripts/build-summary.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. `renderFeature` and the other readers keep working (they ignore `commit`).
- [ ] **Step 4:** Run the same test → PASS; also the full existing `build-summary.test.mjs` passes.
- [ ] **Step 5:** Commit `feat(scripts): workbook stages record their commit`.

### Task 2: Component map and file classification

**Files:** Create `docs/release-review/components.json`, `scripts/release-review/components.mjs`,
`scripts/release-review/components.test.mjs`.

**Interfaces:**
- Produces:
  - JSON shape: `{ version: 1, screenGlobs: string[], neutralGlobs: string[], criticalDependencies: string[],
    components: [{ glob, tier: 'critical'|'core'|'noncore'|'docs'|'pipeline', name, security?: true,
    realTest?: string }] }` — first match wins.
  - `loadMap(path) -> Map` (validates tiers, throws on an unknown tier).
  - `classifyFile(map, path) -> { tier, name, security, realTest, unmapped }` (no match: code-like extension →
    `{ tier: 'core', unmapped: true }`; else `docs`).
  - `dependencyTier(map, oldPkg, newPkg) -> 'critical'|'core'|null` (null = no dependency change; compares
    `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`).
  - `isScreenFile(map, path) -> boolean`, `isNeutral(map, path) -> boolean`.
- Glob matching: use `picomatch` if already in the lockfile, else `node:path` `matchesGlob` (Node 24).

- [ ] **Step 1: Failing tests** with the real JSON: `packages/wa/src/baileys/socket.ts` → critical, realTest
  `real WhatsApp`; `packages/server/src/http/origin.ts` → critical, security true;
  `apps/web/src/admin/MembersPage.tsx` → noncore; `apps/web/src/inbox/Composer.tsx` → core;
  `docs/release-review/components.json` → core; `docs/x.md` → docs; `.github/workflows/ci.yml` → pipeline;
  `unmapped code file is core and reported` (`packages/server/src/new-thing.ts` if no rule covers it — add
  the test with a temp map); `version-only package.json is noncore` (dependencyTier → null);
  `baileys bump is critical`; `lodash bump is core`; `isScreenFile('apps/web/src/x.test.tsx')` false.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Write the JSON from the spec tables (4.1, dependencies list in 4.2 note, screen globs
  `apps/web/src/**`, `apps/desktop/src/**` minus tests; neutral globs: `docs/workbooks/**`,
  `docs/dev-build-checks.md`, `docs/LEARNINGS.md`, `docs/screenshots/**`, `docs/release-review/{index,log}.md`,
  `docs/features/*/review.md`). Walk `git ls-files` once: every code file must match a rule; add rules until
  the helper test `every tracked code file is mapped` (reads `git ls-files`) passes.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(scripts): release review component map`.

### Task 3: Evidence parsers and commit validity

**Files:** Create `scripts/release-review/evidence.mjs`, `scripts/release-review/evidence.test.mjs`.

**Interfaces:**
- Consumes: `parseWorkbook` (Task 1), `isNeutral` (Task 2).
- Produces:
  - `evidenceShaValid(sha, changedFilesSince: (sha) => string[], map) -> boolean` — true when every file
    changed between `sha` and head is neutral (head itself → true).
  - `workbookEvidence(workbook, isValid) -> { e2e, linkCheck, screenReview }`, each
    `{ ok: boolean, sha, detail }`: e2e ok = E2E status `done|pass` and valid sha; linkCheck ok = e2e ok and
    detail contains `electron-links`; screenReview ok = Screen review `done|pass` and valid sha.
  - `devBuildRows(markdown) -> [{ cells: string[], shas: string[], real: boolean }]` (shas = 7–40 hex in
    backticks in the Build cell; real = row text contains `real:` case-insensitive).
  - `coverageFromLog(text) -> number|null` from `changed-lines coverage: <n> %`; the
    `no changed executable lines` line → `100`.

- [ ] **Step 1: Failing tests** — `stale evidence after a code commit scores 0`;
  `evidence survives a workbook-only commit`; `link check needs electron-links in the E2E detail`;
  `skip counts as not ok`; `devBuildRows finds the SHA and the real: marker` (use two rows copied from the
  current `docs/dev-build-checks.md` header format); `coverageFromLog reads 93.4`; `no changed lines is 100`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(scripts): release review evidence`.

### Task 4: Rubric

**Files:** Create `scripts/release-review/rubric.mjs`, `scripts/release-review/rubric.test.mjs`.

**Interfaces:**
- Produces `scoreChange(input) -> Result`.
  - `input = { files: [{ path, tier, security, realTest, added, deleted, lockfile }], dependencyTier,
    screenChanged, migrations: string[], migrationConfirmed: 'adds-only'|'moves-data'|null,
    agentsSecurityChanged, checks: 'green'|'pending'|'failed', coverage: number|null,
    evidence: { e2e, linkCheck, screenReview, devBuild, realTest } (booleans) }`
  - `Result = { score, decision: 'risk:auto'|'risk:human'|'risk:pipeline', tier, tierFiles: string[],
    countedLines, items: [{ label, points, applies, ok }], hardStops: [{ id: 1|2|3|4, reason }] }`
- Counted lines: files with tier critical/core/noncore and not lockfile.

- [ ] **Step 1: Failing tests** — the three spec examples as fixtures: `#158 → 95 risk:auto`,
  `#162 → 75 risk:auto`, `#159 → 35 risk:human with hard stop 1`; `docs only → 100 risk:auto`;
  `pipeline + docs → risk:pipeline`; `server-only change gets full screen points` (screenChanged false);
  `coverage 89 → no coverage points`; `pending checks are a hard stop` (reason `checks pending`);
  `unconfirmed migration is hard stop 2`; `adds-only migration is not a hard stop`;
  `security file is hard stop 3`; `score clamps at 0 and 100`; `critical dependency sets tier critical`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(scripts): release review rubric`.

### Task 5: Logs, index, PR comment

**Files:** Create `scripts/release-review/log.mjs`, `scripts/release-review/log.test.mjs`,
`docs/release-review/index.md`, `docs/release-review/log.md`.

**Interfaces:**
- Consumes: `Result` (Task 4).
- Produces:
  - `renderEntry({ date, pr, sha, result, migrationNote }) -> string` (Markdown: heading
    `## <date> · PR #<pr> · <sha> · <decision> (<score>)`, tier line with files, score table
    `| Item | Points | Proof |`, hard stops, decision).
  - `renderApproval({ date, pr, sha, quote }) -> string` (heading `… · approved by owner`, quoted text).
  - `indexRow({ date, pr, sha, tier, score, decision, logPath }) -> string` — columns
    `| Date | PR | Commit | Tier | Score | Decision | Log |`; approval rows use decision `human-approved`.
  - `parseIndex(markdown) -> [{ date, pr, sha, tier, score, decision, logPath }]`.
  - `logPathFor({ workbook, branch, featureFolders }) -> string` — `Feature: <name>` line in the workbook, else
    a folder equal to the branch without `feat/|fix/|docs/|chore/`, else `docs/release-review/log.md`.
  - `appendEntry(path, entry)` — creates the file with a `# Review log` header when missing; append only.

- [ ] **Step 1: Failing tests** — `entry has every item and the proof`; `approval quotes the owner`;
  `index row round-trips through parseIndex`; `logPathFor prefers the Feature line`; `falls back to branch
  name`; `falls back to the shared log`; `appendEntry never rewrites old entries`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(scripts): release review logs`.

### Task 6: CLI

**Files:** Create `scripts/release-review.mjs`, `scripts/release-review.test.mjs`.

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `node scripts/release-review.mjs <pr> [--write] [--migration adds-only|moves-data] [--json]` prints the
    Markdown comment (or JSON) and, with `--write`, appends the entry and the index row.
  - `node scripts/release-review.mjs <pr> --approve "<owner's words>" ` appends `renderApproval` + an index row.
  - `gatherFacts(pr, { gh, git }) -> input` — runners injected for tests.
- Facts: head SHA and title (`gh pr view --json headRefOid,title,baseRefName,headRefName`), files and line
  counts (`git diff --numstat origin/<base>...<head>`), package.json before/after (`git show`), checks
  (`gh pr checks --json name,bucket`: any `fail|cancel` → failed, any `pending` → pending), coverage
  (`gh run view <id of the newest "Test (ubuntu-latest)" job on head> --log` → `coverageFromLog`), workbook
  `docs/workbooks/<branch with / → __>.md` at head, `docs/dev-build-checks.md` at head, AGENTS.md security
  hunk (`git diff -U0` line ranges vs the `## Security invariants` section range).
- Release PR (`chore(release)` title) → print `release PR: not scored`, exit 0.

- [ ] **Step 1: Failing tests** with fake runners: `release PR is not scored`; `gathers a docs-only PR as 100`;
  `--write appends one entry and one index row`; `--approve writes human-approved`;
  `checks pending → hard stop 4`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Run for real (read-only) on merged PRs: `node scripts/release-review.mjs 158`, `162`, `159`.
  Expected decisions auto / auto / human. Differences come from the real evidence (e.g. workbooks without
  a Commit column → evidence not ok): record them in the PR description; do not tune points.
- [ ] **Step 6:** Commit `feat(scripts): release review CLI`.

### Task 7: Skill and AGENTS.md

**Files:** Create `.claude/skills/release-review/SKILL.md`; Modify `AGENTS.md` (Working rules: one bullet).

- [ ] **Step 1:** SKILL.md frontmatter `name: release-review`, description triggers: "release review",
  "risk score", "is this safe to release", after the last verification of a PR, after any new commit on a
  scored PR. Body: (1) run `node scripts/release-review.mjs <pr>`; (2) if it lists a migration, read it and
  rerun with `--migration adds-only|moves-data`; (3) `--write`, commit only the review files
  (`git add` the named log, `docs/release-review/index.md`); push; (4) `gh pr comment <pr> --body-file`;
  (5) `gh pr edit <pr> --add-label <decision>` (remove the other two labels first); (6) tell the owner the
  score and decision in STE; for `risk:human` list what the owner must test (hard stops and the not-ok items);
  (7) on the owner's approval, `--approve "<their exact words>"`. State: never change points; never merge on
  `risk:auto` until the owner approves section 9 of the spec in writing.
- [ ] **Step 2:** AGENTS.md bullet under Working rules: "**Release review** (`.claude/skills/release-review`,
  design `docs/superpowers/specs/2026-10-24-release-review-design.md`): score every feature PR after its last
  verification; it logs, comments and labels only. The merge rule above is unchanged."
- [ ] **Step 3:** Commit `docs(agents): release review skill`.

### Task 8: Lite PR

- [ ] **Step 1:** `npx vitest run scripts/` and `npm run lint` → pass.
- [ ] **Step 2:** Ask the owner before creating the three labels on GitHub (a repo setting); create them only on a yes:
  `gh label create risk:auto|risk:human|risk:pipeline`.
- [ ] **Step 3:** Push, open the PR, run the skill on its own PR (expected: noncore/docs tiers, `risk:auto`),
  report. Do not merge.

### Task 9: Enterprise copy and core bump

**Files (in `D:\dev\ezychat-enterprise`, branch from its integration branch per its own rules):** copy
`scripts/release-review/{components,evidence,rubric,log}.mjs` + tests, `scripts/release-review.mjs`,
`scripts/build-summary.mjs` (+ test; `docs/workbooks/`), `.claude/skills/release-review/SKILL.md`; create
`docs/release-review/{components.json,index.md,log.md}` from spec 4.2; create
`scripts/release-review/core-bump.mjs` + test.

**Interfaces:**
- Produces `coreBumpScore({ oldVersion, newVersion, litePrs: [{ number, mergedAt }], liteIndex }) ->
  { score: number|null, human: boolean, reasons: string[] }`:
  start date = earliest date in `liteIndex`; PRs merged before it → approved, no score; others → their newest
  index row: `human-approved` → its score, `risk:human` → `human: true`, missing → `human: true`
  (`not reviewed`). `score` = lowest scored PR, `null` when none.
- The CLI detects a changed `@ezychat/*` pin, lists Lite PRs from
  `gh api repos/ossmalaysia/ezychat-lite/compare/v<old>...v<new>` (`(#NNN)` in commit messages, committer
  date), reads the Lite index with `gh api …/contents/docs/release-review/index.md`, and caps the
  Enterprise score at `score` (lower of the two counts; `human` forces `risk:human`).

- [ ] **Step 1: Failing tests** — `pre-system PRs count as approved`; `unreviewed new PR forces human`;
  `human-approved uses its score`; `bump takes the lowest Lite score`; component map tests for
  `packages/ent-licence/src/**` → critical, `packages/ent-web/**` → noncore, `every tracked code file is mapped`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npx vitest run scripts/`).
- [ ] **Step 5:** Commit (code changes run CI on the self-hosted runners as usual), open the PR, run the skill
  on it, report. Do not merge. Ask the owner before creating the labels there too.

---

## Self-review notes

- Spec 6 says a log-only commit is ignored; this plan generalises it to "neutral files" (workbook, logs,
  dev-build-checks, screenshots, LEARNINGS), because recording a stage also creates a commit. Same intent.
- Coverage is read from the CI log, so a PR whose CI has not run gets no coverage points and hard stop 4.
- Labels need the owner's yes (repo setting), so Task 8/9 ask first.
