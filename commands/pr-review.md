---
description: Review a pull request and submit an approve/request-changes/comment verdict
agent: pr-reviewer
subtask: true
---

# Pull Request Review

Arguments: `$ARGUMENTS`

The argument is a PR number, a PR URL, or empty (use the PR for the current branch).

## Instructions

Follow the PR Reviewer workflow in your agent instructions.

1. Resolve the PR and read its metadata, diff, commits, comments, and CI checks.
2. Review correctness, security, breaking changes, tests, conventions, performance, and
   scope. Cite exact `file:line` locations for every finding.
3. Do not repeat issues already raised in existing threads.
4. Pick the verdict:
   - `APPROVE` — no blocking issues
   - `REQUEST_CHANGES` — bug, security issue, broken test, or missing critical coverage
   - `COMMENT` — questions only, draft PR, own PR, or checks still running
5. Submit the review with `gh pr review`.
6. Report the verdict, PR URL, and a one-line summary.

You are READ-ONLY: never edit files, check out the branch, commit, push, merge, or close the
PR. Never approve the authenticated user's own PR.
