---
name: mad-workflow
description: Multi-Agent Dev workflow for parallel development with git worktrees and subagents
license: MIT
compatibility: opencode
metadata:
  category: orchestration
  author: Nistro-dev
---

# MAD Workflow

MAD (Multi-Agent Dev) enables parallel software development by decomposing tasks into independent subtasks, each running in isolated git worktrees with dedicated subagents.

## Core Concepts

### Worktrees
Git worktrees provide isolated working directories, each on its own branch. This allows multiple tasks to be developed simultaneously without conflicts.

### Subagents
- **mad-developer**: Implements a single focused task in a worktree
- **mad-fixer**: Resolves build errors, test failures, and conflicts

### Signal Files
- `.agent-task`: Task description (created by orchestrator)
- `.agent-done`: Completion marker with summary
- `.agent-blocked`: Block marker with reason
- `.agent-error`: Error details from failed tests

## Workflow Steps

## CRITICAL: Parallel Execution is MANDATORY

The entire purpose of MAD is to run tasks IN PARALLEL. 

### ❌ WRONG - Sequential (defeats the purpose)
```
Message 1: mad_worktree_create(branch: "feat-a", ...)
Message 2: mad_worktree_create(branch: "feat-b", ...)
Message 3: Task(subagent_type: "mad-developer", ...) for feat-a
Message 4: Task(subagent_type: "mad-developer", ...) for feat-b
```

### ✅ CORRECT - Parallel (the whole point!)
```
Single Message containing:
  mad_worktree_create(branch: "feat-a", ...)
  mad_worktree_create(branch: "feat-b", ...)
  mad_worktree_create(branch: "feat-c", ...)

Single Message containing:
  Task(subagent_type: "mad-developer", ...) for feat-a
  Task(subagent_type: "mad-developer", ...) for feat-b  
  Task(subagent_type: "mad-developer", ...) for feat-c
```

If you're not parallelizing, you're not using MAD correctly!

### 1. Decomposition
Analyze the request and identify parallelizable components:
- Different modules/features
- Independent files
- Separable concerns

### 2. Worktree Creation
For each subtask:
```
mad_worktree_create(
  branch: "feat/feature-name",
  task: "Detailed task description"
)
```

### 3. Parallel Execution
Spawn subagents simultaneously:
```
Task(subagent_type: "mad-developer", ...)
Task(subagent_type: "mad-developer", ...)
Task(subagent_type: "mad-developer", ...)
```

### 4. Monitoring
Check progress:
```
mad_status()
```

### 5. Testing
Verify each worktree:
```
mad_test(worktree: "feat-feature-name")
```

### 6. Merging
Merge completed work:
```
mad_merge(worktree: "feat-feature-name")
```

### 7. Cleanup
Remove finished worktrees:
```
mad_cleanup(worktree: "feat-feature-name")
```

### 8. Final Check
Verify global project health:
```
mad_final_check()
```
This distinguishes session errors from pre-existing issues.

## Best Practices

1. **Keep subtasks focused** - Each should be completable in one session
2. **Name branches clearly** - `feat/`, `fix/`, `refactor/` prefixes
3. **Test before merge** - Always run mad_test first
4. **Handle blocks promptly** - Don't let blocked tasks linger
5. **Merge sequentially** - Avoid merge conflict cascades

## Available Tools

| Tool | Purpose |
|------|---------|
| `mad_worktree_create` | Create isolated branch |
| `mad_status` | Dashboard of all worktrees |
| `mad_test` | Run tests on worktree |
| `mad_merge` | Merge completed branch |
| `mad_cleanup` | Remove worktree |
| `mad_done` | Mark task complete |
| `mad_blocked` | Mark task blocked |
| `mad_read_task` | Read task description |
| `mad_final_check` | Run global build/lint and categorize errors |

## Example

Request: "Add user authentication with login, signup, and password reset"

1. Create 3 worktrees: `feat/auth-login`, `feat/auth-signup`, `feat/auth-reset`
2. Spawn 3 developer subagents in parallel
3. Monitor until all complete
4. Test each, merge sequentially
5. Cleanup worktrees
6. Final integration test
