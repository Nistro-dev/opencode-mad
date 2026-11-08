---
description: Bump the project version from the diff since the latest release tag (local or remote)
agent: orchestrator
---

# Version Update

Arguments: `$ARGUMENTS`

Derive the next semantic version from the actual diff since the last release tag, then apply
it across the project's version-bearing files and changelog.

## Arguments

| Argument | Meaning |
| --- | --- |
| `--dry-run` | Analyze and report only; change nothing |
| `--yes` | Apply the recommended bump without asking |
| `--from=<ref>` / `--baseline=<ref>` | Use an explicit baseline tag or commit |
| `--remote=<name>` | Restrict tag discovery and push to one remote (default: all remotes for discovery, `origin` for push) |
| `--bump=<major\|minor\|patch>` | Force the bump type |
| `--major` / `--minor` / `--patch` | Alias for `--bump=<value>` |
| `--package=<path>` | Manifest or package directory to version (default root) |
| `--first-release` | No baseline tag; analyze the full history |
| `--no-fetch` | Do not fetch tags; use local refs only |
| `--changelog` | Create `CHANGELOG.md` when it does not exist |
| `--no-changelog` | Do not touch the changelog |
| `--commit` | Commit only the version bump files |
| `--tag` | Create the annotated tag `v<next>` (implies committing uncommitted version files) |
| `--push` | Push the branch and tag (requires `--commit` or `--tag`) |

A bare semantic-version tag such as `v1.4.0` is the same as `--from=v1.4.0`. A bare
`major`, `minor`, or `patch` is the same as `--bump=<value>`. Reject unknown flags instead of
ignoring them.

You are **READ-ONLY** in this command: never edit files, commit, tag, or push yourself. Both
phases are delegated to subagents.

## Phase 1 — Preflight

Run in parallel:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
git remote -v
git tag --list --sort=-version:refname | head -20
```

- Stop if this is not a git repository.
- Stop if `--remote=<name>` names a remote that does not exist.
- If `--commit`, `--tag`, or `--push` was requested on a detached HEAD, stop and ask the user
  to check out a branch first.
- If the working tree is dirty, continue but warn that:
  - unrelated files will not be committed, and
  - a target manifest with pre-existing edits may block the update.
- `--push` without `--commit` or `--tag` is invalid; ask the user to add one.
- `--tag` without `--commit` means the updater commits the version files before tagging.

## Phase 2 — Analyze the tag diff

Spawn the **`version-analyzer`** subagent. Pass every relevant flag and this instruction:

> Resolve the baseline from local tags and all configured remotes (or only the chosen
> remote). Fetch tags when permitted. Analyze the full range, recommend the next semver, and
> report the handoff fields. Do not edit anything.

Wait for its report. Do not run your own full diff analysis.

Relay a compact summary to the user:

- baseline tag and whether it was local, remote, or both
- number of commits/changed files
- current → recommended version and the bump type
- top breaking changes or risks

## Phase 3 — Decision gate

Stop after the analysis when:

- `--dry-run` was passed
- the analyzer recommends no bump (empty range or already versioned)
- the analyzer is blocked by a diverged tag, missing manifest, monorepo ambiguity, or a
  non-ancestor baseline

When stopping for ambiguity, state the options plainly and wait. Never guess a baseline.

Otherwise decide whether to apply:

- Explicit `--bump` wins, even if it conflicts with the recommendation; still surface the
  warning.
- Otherwise, use the recommended bump.
- Ask for confirmation before applying when `--yes` was not passed and any of these is true:
  - no explicit `--bump` (or `--major` / `--minor` / `--patch`) was given
  - the recommended bump is `major` and a lower bump was forced
  - the analyzer says the manifest is already ahead of the tag
- If the analyzer says the manifest is already ahead of the tag, do not double-bump; ask
  whether to keep the current version or force a specific bump.
- If the user asked for a patch/minor but the analysis found breaking changes, warn clearly
  and require `--yes` or an explicit `--bump` before proceeding.

The confirmation prompt should be one line:

```
Bump 1.2.3 -> 1.3.0 (minor) from v1.2.3? Reply yes, or specify major/minor/patch.
```

## Phase 4 — Apply

Spawn the **`version-updater`** subagent with:

- the analyzer report, verbatim
- `--next=<x.y.z>` — the resolved next version
- the bump type (`--bump=<major|minor|patch>`)
- `--from=<ref>` — the baseline
- `--package`, `--changelog` / `--no-changelog`, `--commit`, `--tag`, `--push`, and
  `--remote` exactly as the user supplied
- the instruction: **"The bump decision is final; do not re-analyze the whole diff. Stop and
  report on any inconsistency."**

If the updater reports a stale manifest, unrelated edits in a target file, or an existing tag,
relay it and stop. Do not bypass the check.

## Phase 5 — Verify and report

Run these read-only checks:

```bash
git status --short
git diff --stat
git log -1 --oneline
```

Report:

- old → new version and bump type
- baseline tag and source (local/remote)
- files changed
- changelog outcome
- verification the updater ran
- commit SHA, tag, and push state (or "not created" / "not pushed")
- one concrete next step, for example:
  - `git push origin HEAD --follow-tags` when nothing was pushed
  - review the diff before committing when neither `--commit` nor `--tag` was passed

Never push, tag, commit, or amend on your own, even if the updater forgot a flag.
