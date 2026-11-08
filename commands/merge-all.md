---
description: Merge all completed worktrees
agent: orchestrator
---

Merge all completed worktrees:

1. Check status with status to find all DONE worktrees
2. For each DONE worktree:
   - Run test to verify code works
   - Use merge to merge the branch
   - Use cleanup to remove the worktree
3. Run final tests on the merged codebase
4. Report the results
