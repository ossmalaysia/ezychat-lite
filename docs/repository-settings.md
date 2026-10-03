# Repository settings

The public repository is [ossmalaysia/ezychat-lite](https://github.com/ossmalaysia/ezychat-lite).
It was renamed from `ossmalaysia/wa-team-inbox`; existing releases and history were retained.

## Main branch

- Pull requests require one approving review, with stale approvals dismissed after new commits.
- Require all three GitHub Actions CI jobs: `Test (ubuntu-latest)`, `Test (windows-latest)` and
  `Test (macos-latest)`. Checks must come from GitHub Actions and the branch must be up to date.
- Resolve review conversations before merging.
- Apply protections to administrators too; block force pushes and deletion.
- Require linear history. Only squash merging is enabled, using the PR title and body.
- Delete merged pull-request branches automatically.

## Security and collaboration

- Issues stay enabled; the unused wiki is disabled.
- Secret scanning, secret push protection and Dependabot vulnerability alerts are enabled.
- GitHub Actions has read-only token permissions by default and cannot approve PRs.
- Workflow action dependencies remain pinned to full commit SHAs.

These settings are configured in GitHub, rather than enforced by this Markdown file. Maintainers
can inspect them in **Settings → Branches**, **General**, and **Code security**. Changing CI job
names also requires updating the required checks so pull requests do not become blocked.
