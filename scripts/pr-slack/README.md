# PR → Slack

Announces three moments of Viorant's review flow to `#engineering`:

| When | Message |
| --- | --- |
| A non-draft PR is opened / reopened / marked ready, targeting `main` | 🔵 **New PR** |
| That PR's `CI` workflow goes green **for the first time** | ✅ **CI green — ready for review** |
| CI goes green again after a reviewer requested changes | 🔄 **Changes addressed — ready for re-review** |

Between them these are the two moments a PR needs a reviewer's attention: it is
new, or its review comments have been answered.

CI failures are silent — the author already sees them on the PR. So is the
`changes_requested` review itself: the reviewer wrote it.

## Wiring a repo up

Add `.github/workflows/pr-slack.yml` to the repo:

```yaml
name: PR → Slack

on:
  pull_request:
    types: [opened, reopened, ready_for_review]
    branches: [main]
  pull_request_review:
    types: [submitted]
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
- `SLACK_ENG_WEBHOOK` must be visible to the repo. If it is not, the run logs a
  warning and posts nothing — it never fails. This is **not**
  `SLACK_RELEASE_WEBHOOK`, which targets `#release`; there is no fallback
  between them, because a silent fallback would announce PRs in the wrong
  channel.
- No fork PRs. `workflow_run.pull_requests` is only populated for same-repo
  branches, which is how every Viorant PR is raised.
- `pull_request_review` has no `branches:` filter, so the gate checks the base
  branch itself. It also runs the workflow file from the base branch, so the
  caller must be on `main` before reviews reach the notifier.

Nothing in the repo's `ci.yml` changes. This workflow is not a required status
check and cannot gate a merge in either direction.

## Re-run noise

A PR's CI re-runs on every push, so "post when green" would post several times
per PR. The gate is a **`ci:green` label on the PR** — green posts only when the
label is absent:

```
push 1  → ❌ red                 silent, label absent
push 2  → ✅ green            →  POST ✅, label added
push 3  → ✅ green               silent, label present
push 4  → ❌ red                 silent, label removed
push 5  → ✅ green            →  POST ✅, label re-added
review  → 🔴 changes requested   silent, label removed
push 6  → ✅ green            →  POST 🔄, label re-added
```

Two things clear the label: a non-success CI run, and a review requesting
changes. Nothing else does — in particular a plain push does not, which is why
push 3 is silent while push 6 is not. Work-in-progress pushes stay quiet; the
push that answers a review does not.

The state is visible on the PR and self-healing — remove the label by hand to
force a re-announce. The label is added *after* a successful post, so a dropped
label re-announces (harmless) rather than swallowing the announcement.

The ✅ / 🔄 wording is chosen at post time from the PR's `reviewDecision`, which
GitHub holds at `CHANGES_REQUESTED` across pushes until a later review
supersedes it. No extra state is stored for it.

**Known limitation:** only a formal **Request changes** review clears the label.
Asking for changes in a plain PR comment leaves it in place, and the fix's green
stays silent.

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
