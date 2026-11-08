---
description: Resolve git merge, rebase, or cherry-pick conflicts
agent: conflict-resolver
subtask: true
---

# Resolve Conflicts

Arguments: `$ARGUMENTS`

The argument may be:

- empty — resolve the conflict currently in progress in this repository
- a branch or remote branch to merge into the current branch
- a commit or PR number to integrate
- a path filter, when the user wants to focus on specific files

## Instructions

Follow the Conflict Resolver workflow in your agent instructions.

1. Detect the current operation (merge, rebase, cherry-pick, revert) and list unmerged files.
2. If no operation is active and arguments name a branch/commit/PR, start it:
   - clean working tree required
   - `git fetch origin` when integrating a remote branch
   - `git merge --no-ff <branch>`
3. For every conflicted file, inspect stages 1/2/3 and the history of both sides before
   choosing a resolution. Understand intent first.
4. Combine both sides when possible; never discard a side wholesale without stating why.
5. Remove all conflict markers and verify with `git diff --check` plus a marker grep.
6. Run the relevant build/typecheck/lint/tests and fix breakage caused by the resolution.
7. Stage resolved files and complete the operation (`git merge --continue` for a merge,
   `git rebase --continue`, `git cherry-pick --continue`, or `git revert --continue`).
8. Report files, per-file strategy, checks, resulting commit, and whether anything was pushed.

Do not abort the operation, rewrite pushed history, or push unless the command explicitly
asks. If the sides are fundamentally incompatible, stop and present the options.
