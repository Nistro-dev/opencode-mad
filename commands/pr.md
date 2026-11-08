---
description: Create or update a pull request (asks where to open it when origin is a fork)
agent: orchestrator
---

# Pull Request

Arguments: `$ARGUMENTS`

The arguments may contain:

- a base branch (default: the destination repository's default branch)
- a title hint
- `--draft` to open the PR as a draft
- `--upstream` or `--contribution` to force a contribution PR to the parent repository
- `--fork` to force the PR to stay in the origin fork

## Phase 1 — Fork preflight (do this yourself)

Run these read-only checks before delegating anything:

```bash
gh --version
gh auth status
git remote -v
git status --short
git branch --show-current
```

Determine the origin repository and whether it is a fork:

```bash
gh repo view --json nameWithOwner,isFork,parent,defaultBranchRef \
  --jq '{origin: .nameWithOwner, isFork: .isFork,
         parent: (if .parent then (.parent.owner.login + "/" + .parent.name) else null end),
         base: .defaultBranchRef.name}'
```

Then choose the destination:

| Situation | Destination |
| --- | --- |
| `isFork` is false | Origin repository (normal PR) |
| Origin is a fork + `--upstream` / `--contribution` | Parent repository (contribution PR) |
| Origin is a fork + `--fork` | Origin repository (PR inside the fork) |
| Origin is a fork + no flag | **ASK the user and stop** |

When the origin is a fork and no destination flag was given, output exactly this kind of
question and **do not spawn the PR subagent, create a PR, or push anything**:

```
Origin `fiandev/opencode-kit` is a fork of `Nistro-dev/opencode-mad`.

Where do you want to open the pull request?

1. Contribution PR → `Nistro-dev/opencode-mad` (upstream)
2. Fork PR → `fiandev/opencode-kit` (your fork)

Reply with `1`/`--upstream` or `2`/`--fork`.
```

Wait for the user's answer. If the fork's parent cannot be resolved (deleted, inaccessible,
or the repo is a mirror), explain that and ask how to proceed instead of guessing.

## Phase 2 — Delegate

Once the destination is unambiguous, spawn the **`pr` subagent** with:

- destination repository (`owner/repo`)
- destination type: `upstream` (contribution) or `fork`/`same-repo` (normal)
- head owner (the fork owner for contribution PRs)
- base branch
- title hint and `--draft` if provided
- the instruction: **"Destination is already chosen; do not ask again."**

The `pr` subagent handles the push, title/body generation, existing-PR check, and
`gh pr create`/`gh pr edit`.

## Report

Relay the subagent's result: PR number, URL, destination repository, branch pair, and
draft/ready state.
