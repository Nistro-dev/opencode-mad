---
description: Resolve PR review comments by fixing code, pushing, and resolving threads
agent: pr-resolver
subtask: true
---

# Resolve PR Review Comments

Arguments: `$ARGUMENTS`

The argument is a PR number, a PR URL, or empty (use the PR for the current branch).

## Instructions

Follow the PR Resolver workflow in your agent instructions.

1. Resolve the PR. Stop if it is merged, closed, or its head fork is not your `origin`.
2. Ensure the working tree is clean and check out the PR head branch if needed.
3. Fetch unresolved review threads (including path and line) and the top-level conversation.
4. Triage each thread: actionable, question, outdated, ambiguous, bot noise, or out of scope.
   Do not guess when feedback is contradictory or unclear — leave those threads open.
5. For each actionable thread, make the smallest scoped fix and run the relevant checks.
6. Commit with Conventional Commits, one concern per commit. Never amend pushed commits.
7. Push normally. Never force-push unless explicitly requested.
8. Reply in each addressed thread with the commit SHA, then resolve it. Leave unresolved
   threads open with a reply explaining why.
9. Report fixed/replied/left-open counts, commits, check status, and any decisions the user
   must make.

Do not refactor unrelated code, mark the PR ready, merge it, close it, or delete the branch.
