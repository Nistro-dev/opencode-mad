---
description: Fix errors in a worktree
agent: orchestrator
---

There are errors in worktree **$ARGUMENTS**.

1. Check the status with status
2. Read any .agent-error files
3. Spawn a fixer subagent to resolve the issues
4. Verify the fix with test
5. Mark as done if successful
