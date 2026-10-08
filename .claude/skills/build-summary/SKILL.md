---
name: build-summary
description: Show the owner a one-screen build summary per feature PR (design, dev, unit tests per OS, SonarCloud, e2e, Dev Build checks, screen review, open review comments, mergeable) and keep each feature's workbook up to date. Use when asked for a "build summary", "build status", "progress", "is it ready to merge" or "status of the PRs", and whenever an agent finishes a stage of a feature (design, dev, unit tests, e2e, Dev Build check, screen review).
---

# Build summary and feature workbooks

## Show the summary

```bash
node scripts/build-summary.mjs        # open PRs + the 3 most recently merged
node scripts/build-summary.mjs 47     # one PR
```

Paste the output **as is** in a fenced code block, then at most three plain sentences: what is
blocking, and the one next step (for example "say merge"). Do not re-type the view by hand.

## Keep the workbook true (every agent, every feature)

Each feature branch has a committed workbook, `docs/workbooks/<branch>.md`: a stage table plus a
log. When you finish a stage, record it and commit the workbook with that work:

```bash
node scripts/build-summary.mjs record design done "mockup approved" --title "Edit with AI"
node scripts/build-summary.mjs record dev doing "server done, web next"
node scripts/build-summary.mjs record unit pass "1,676 passed"
node scripts/build-summary.mjs record e2e pass "50 passed"
node scripts/build-summary.mjs record devbuild pass "3 real-model checks"
node scripts/build-summary.mjs record screen done "8 findings fixed, re-captured"
```

- Stages: `design`, `dev`, `unit`, `e2e`, `devbuild`, `screen`.
- Statuses: `todo`, `doing`, `done`, `pass`, `fail`, `skip`.
- `--title` names the feature the first time; the workbook is created on first `record`.
- Record failures too (`e2e fail "2 failed: inbox.spec"`); fix, then record the pass.
- The summary adds the live parts itself: CI unit tests per OS, SonarCloud, open review comments,
  and whether GitHub can merge. Dev Build falls back to counting the branch's rows in
  `docs/dev-build-checks.md` when the workbook has no Dev Build entry.

## Marks

`✓` done · `✗` problem · `…` in progress · `◐` partly · `·` not yet · `–` not needed.
"Mergeable ✓" still needs the owner's go-ahead to merge.
