---
description: Fix errors in a MAD worktree
agent: orchestrator
---

There are errors in worktree **$ARGUMENTS**.

1. Check the status with mad_status
2. Read any .agent-error files
3. Spawn a mad-fixer subagent to resolve the issues
4. Verify the fix with mad_test
5. Mark as done if successful
