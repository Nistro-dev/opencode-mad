---
description: Merge all completed MAD worktrees
agent: orchestrator
---

Merge all completed MAD worktrees:

1. Check status with mad_status to find all DONE worktrees
2. For each DONE worktree:
   - Run mad_test to verify code works
   - Use mad_merge to merge the branch
   - Use mad_cleanup to remove the worktree
3. Run final tests on the merged codebase
4. Report the results
