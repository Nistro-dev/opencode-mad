---
description: Stage and commit changes in a worktree (Conventional Commits)
agent: orchestrator
---

# Commit

Optional arguments: $ARGUMENTS may be a message hint and/or paths to stage. If empty, derive both from the diff.

## Steps

1. **Inspect** (run in parallel):
   - `git status --short`
   - `git diff` and `git diff --cached`
   - `git log --oneline -10` — match the repo's existing type/scope style
2. **Split**: if the changes cover unrelated concerns, make one commit per concern. Don't mix a refactor with a feature.
3. **Stage explicitly**: `git add <path> [<path>...]`. Use `git add -A` only when every change belongs in the same commit. Never stage secrets (`.env`, keys, tokens), `node_modules`, or build output.
4. **Commit** with a message that follows the format below. Use a heredoc for multi-line messages:
   ```bash
   git commit -m "$(cat <<'EOF'
   feat(parser): add array parsing support

   Parses bracketed values produced by the new config loader.

   Refs: #123
   EOF
   )"
   ```
5. **Verify**: `git log -1 --stat` and `git status --short` (clean, or only intentionally unstaged files).

## Message format

```
<type>[(scope)][!]: <description>

[optional body]

[optional footer(s)]
```

- Description: imperative mood, lowercase, no trailing period, ≤ 72 chars.
- Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- Breaking change: append an exclamation mark before the colon (`feat!:` or `feat(api)!:`) **and** add a `BREAKING CHANGE: <what broke + how to migrate>` footer.
- Body: one blank line after the description, wrapped at 72, explain **why** not **what**.
- Footers: `Token: value` or `Token #value` (e.g. `Refs: #123`, `Reviewed-by: Z`).

Examples:

```
fix: prevent racing of requests
docs(readme): correct install command
feat(api)!: drop Node 6 support

BREAKING CHANGE: minimum runtime is now Node 18.
```

## Rules

- Never amend, rebase, or push unless asked.
- If a pre-commit hook fails, fix the cause and create a new commit. Don't use `--no-verify` unless asked.
- If there is nothing to commit, say so and stop.
- Report one line: `<sha> <subject>`.
