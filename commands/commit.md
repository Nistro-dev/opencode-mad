---
description: Stage and commit changes through the committer subagent (Conventional Commits)
agent: orchestrator
---

# Commit

Optional arguments: `$ARGUMENTS` may be a message hint and/or paths to stage. If empty, the
committer derives both from the diff.

You are **read-only** in this command: never run `git add`, `git commit`, `git push`, or edit
files yourself. Every git write is delegated to the **`committer` subagent**, whose permissions
ask before each commit and deny push, amend, rebase, reset, checkout, and tag.

## Phase 1 — Preflight (read-only)

Run in parallel:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
git log --oneline -10
```

Stop and report when:

- this is not a git repository
- the branch is detached — ask the user to check out a branch first
- there is nothing to commit (clean tree and nothing staged) — say so and stop
- a path named in `$ARGUMENTS` does not exist

## Phase 2 — Delegate

Spawn the **`committer`** subagent with `$ARGUMENTS` verbatim (or "no arguments" when empty)
and this instruction:

> Follow your Committer workflow. Inspect the diff, split unrelated concerns into separate
> commits, stage explicit paths only, and ask before committing. Stop and report on ambiguity,
> secrets, a detached HEAD, or a failing pre-commit hook. Do not push, tag, amend, or rebase.

Do not pre-compute the commit message or the staging plan yourself. The subagent owns that
decision.

## Phase 3 — Handle the result

Relay the committer's report.

- **Hook failure** → do not bypass with `--no-verify`; spawn the **`fixer`** subagent when the
  fix is code, then spawn the committer again for the remaining changes.
- **`Nothing to commit`** → say so and stop.
- **Blocked** (secret, ambiguity, detached HEAD) → relay it and ask the user how to proceed.

## Phase 4 — Verify (read-only)

```bash
git log -1 --stat
git status --short
```

Report one line per commit: `<sha> <subject>`, then the remaining working-tree state.

## Rules

- The orchestrator never commits; only the `committer` subagent may run `git add`/`git commit`.
- Never amend, rebase, or push unless the user asks.
- Never use `--no-verify`.
- Never commit secrets (`.env`, keys, tokens), `node_modules`, or build output.
