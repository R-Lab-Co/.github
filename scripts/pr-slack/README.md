# PR → Slack

Announces two moments of Viorant's review flow to `#engineering`:

| When | Message |
| --- | --- |
| A non-draft PR is opened / reopened / marked ready, targeting `main` | 🔵 **New PR** |
| That PR's `CI` workflow goes green **for the first time** | ✅ **CI green — ready for review** |

CI failures are silent — the author already sees them on the PR.

## Wiring a repo up

Add `.github/workflows/pr-slack.yml` to the repo:

```yaml
name: PR → Slack

on:
  pull_request:
    types: [opened, reopened, ready_for_review]
    branches: [main]
  workflow_run:
    workflows: [CI]
    types: [completed]

jobs:
  notify:
    uses: viorant/.github/.github/workflows/pr-slack.yml@main
    permissions:
      contents: read
      pull-requests: write
    secrets: inherit
```

Requirements:

- The repo's CI workflow must be named `CI` (matched by `workflow_run.workflows`).
- `SLACK_RELEASE_WEBHOOK` must be visible to the repo. If it is not, the run
  logs a warning and posts nothing — it never fails.
- No fork PRs. `workflow_run.pull_requests` is only populated for same-repo
  branches, which is how every Viorant PR is raised.

Nothing in the repo's `ci.yml` changes. This workflow is not a required status
check and cannot gate a merge in either direction.

## Re-run noise

A PR's CI re-runs on every push, so "post when green" would post several times
per PR. The gate is a **`ci:green` label on the PR**:

```
push 1 → ❌ red        silent, label absent
push 2 → ✅ green   →  POST, label added
push 3 → ✅ green      silent, label present
push 4 → ❌ red        silent, label removed
push 5 → ✅ green   →  POST, label re-added
```

The state is visible on the PR and self-healing — remove the label by hand to
force a re-announce. The label is added *after* a successful post, so a dropped
label re-announces (harmless) rather than swallowing the announcement.

## Jira link

The `VIOR-<n>` key is read from the PR title, falling back to the head branch
(`feat/vior-231-…`, guaranteed by the branch convention). No key found → the
link is omitted.

## Tests

```sh
node --test 'scripts/pr-slack/*.test.mjs'
```

`notify.mjs` exports `buildMessage` / `extractJiraKey` / `escapeMrkdwn` as pure
functions; only `main()` touches the network. The reusable workflow's gate script
is shellcheck'd in CI.
