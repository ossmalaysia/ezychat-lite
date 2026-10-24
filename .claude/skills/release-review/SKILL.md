---
name: release-review
description: Score a pull request for release risk (safety score 0–100 from the component tiers, size and test evidence) and log it. Use for /release-review, "release review", "risk score", "is this PR safe to release", after the last verification step of a feature PR, and again after any new commit on a scored PR.
---

# Release review

Design: `docs/superpowers/specs/2026-10-24-release-review-design.md`. Tier map:
`docs/release-review/components.json`. The score comes from `scripts/release-review.mjs`; **never change
points or decide the score yourself.**

**Policy now:** the review only scores, logs, comments and labels. Merge only on the owner's explicit
request, also for `risk:auto`, until the owner approves section 9 of the design in writing.

## Steps

1. Run `node scripts/release-review.mjs <pr>` (Node 24). It reads GitHub at the PR head commit.
2. If it lists a new migration, read the migration. Run again with `--migration adds-only` (only new
   tables, columns or indexes) or `--migration moves-data` (it changes or moves existing rows).
3. If it lists unmapped code files, add rules for them to `components.json` in the same PR.
4. Check out the PR branch, run again with `--write`, then commit **only** the log file it names and
   `docs/release-review/index.md` (Enterprise: add `[skip ci]`). Push.
5. Post the entry: `gh pr comment <pr> --body-file <file with the printed Markdown>`.
6. Set the label: remove `risk:auto`, `risk:human`, `risk:pipeline`, then add the decision. If the labels do
   not exist yet, ask the owner before you create them.
7. **For `risk:human`, test before you hand over** (owner rule): for each hard stop and each `✗ missing`
   item, run the check that proves it (e2e + `e2e:electron-links`, Dev Build, the packaged `--dir` smoke for a
   critical runtime part; see `docs/LEARNINGS.md`), record it, and score again.
8. Tell the owner the score and decision in STE. If it is still `risk:human`, list only what you could not
   test (real WhatsApp, the real installer, an action that needs approval) and why.
9. When the owner reports their test result and approves, run
   `node scripts/release-review.mjs <pr> --approve "<the owner's exact words>"`, commit the two files, push.

## Evidence the script reads (record it, or the points are lost)

- e2e, desktop link check and screen review: workbook stages with the checked commit
  (`node scripts/build-summary.mjs record e2e pass "… e2e:electron-links 15/15"` records `HEAD`; put
  `e2e:electron-links` in the E2E detail when it ran).
- Dev Build check: a row in `docs/dev-build-checks.md` with the short commit in backticks in the Build cell;
  a real-part test (real WhatsApp, packaged install) has `real:` in the row.
- Coverage: the `changed-lines coverage` line of the CI job `Test (ubuntu-latest)` on the head commit.
- Evidence stays valid when later commits change only neutral files (workbook, logs, Dev Build log,
  screenshots, LEARNINGS). Any other change needs the checks again.
