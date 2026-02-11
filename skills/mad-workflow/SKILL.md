---
name: mad-workflow
description: Multi-Agent Dev workflow for parallel development with git worktrees and specialized agents
license: MIT
compatibility: opencode
metadata:
  category: orchestration
  author: Nistro-dev
---

# MAD Workflow

MAD (Multi-Agent Dev) enables parallel software development by decomposing tasks into independent subtasks, each running in isolated git worktrees with dedicated specialized agents.

## Architecture Overview

```
                         USER REQUEST
                              |
                              v
                    +-------------------+
                    |   ORCHESTRATOR    |  <- Coordinator (never codes)
                    +-------------------+
                              |
          +-------------------+-------------------+
          |                                       |
          v                                       v
   +-------------+                         +-------------+
   |  ANALYSTE   |  -- analysis report --> | ARCHITECTE  |
   +-------------+                         +-------------+
                                                  |
                                                  v
                                           Development Plan
                                                  |
                              +-------------------+-------------------+
                              |                   |                   |
                              v                   v                   v
                       +-----------+       +-----------+       +-----------+
                       | DEVELOPER |       | DEVELOPER |       | DEVELOPER |
                       | worktree1 |       | worktree2 |       | worktree3 |
                       +-----------+       +-----------+       +-----------+
                              |                   |                   |
                              +-------------------+-------------------+
                                                  |
                    +-----------------------------+-----------------------------+
                    |                             |                             |
                    v                             v                             v
             +----------+                  +----------+                  +----------+
             |  TESTER  |                  | REVIEWER |                  | SECURITY |
             +----------+                  +----------+                  +----------+
                    |                             |                             |
                    +-----------------------------+-----------------------------+
                                                  |
                                                  v
                                           +----------+
                                           |  MERGER  |  (if conflicts)
                                           +----------+
                                                  |
                                                  v
                                           +----------+
                                           |  FIXER   |  (if issues)
                                           +----------+
```

## Core Concepts

### Worktrees
Git worktrees provide isolated working directories, each on its own branch. This allows multiple tasks to be developed simultaneously without conflicts.

### Specialized Agents

| Agent | Role | Responsibility |
|-------|------|----------------|
| **mad-analyste** | Analysis | Understands codebase, finds relevant code, identifies patterns |
| **mad-architecte** | Planning | Creates task breakdown, file ownership, API contracts |
| **mad-developer** | Implementation | Writes code in isolated worktrees |
| **mad-tester** | Testing | Runs tests, verifies functionality |
| **mad-reviewer** | Code Review | Checks quality, patterns, best practices |
| **mad-security** | Security | Audits for vulnerabilities, injection risks |
| **mad-fixer** | Bug Fixing | Fixes errors, test failures, review issues |
| **mad-merger** | Conflicts | Resolves git merge conflicts |

### Signal Files
- `.agent-task`: Task description (created by orchestrator)
- `.agent-done`: Completion marker with summary
- `.agent-blocked`: Block marker with reason
- `.agent-error`: Error details from failed tests

## Workflow Phases

### Phase 1: Analysis
The Orchestrator spawns an Analyste to understand the codebase:
- Project structure and technologies
- Relevant existing code
- Dependencies and patterns
- Potential impact areas

### Phase 2: Planning
The Orchestrator spawns an Architecte to create the plan:
- Task breakdown with clear boundaries
- File ownership (CRITICAL: no overlaps!)
- API contracts between components
- Merge order recommendation

### Phase 3: User Approval
The Orchestrator presents the plan and waits for "GO".

### Phase 4: Development
The Orchestrator:
1. Creates worktrees with `mad_worktree_create`
2. Registers permissions with `mad_register_agent`
3. Spawns Developers in parallel

### Phase 5: Quality Assurance
The Orchestrator spawns in parallel:
- Testers (run tests)
- Reviewers (check code quality)
- Security (audit vulnerabilities)

### Phase 6: Resolution
If issues found:
- Spawn Fixer for bugs/review issues
- Spawn Merger for conflicts

### Phase 7: Finalization
- Merge all branches
- Run `mad_final_check`
- Push with `mad_push_and_watch`
- Cleanup worktrees

## CRITICAL: Parallel Execution is MANDATORY

The entire purpose of MAD is to run tasks IN PARALLEL.

### WRONG - Sequential (defeats the purpose)
```
Message 1: mad_worktree_create(branch: "feat-a", ...)
Message 2: mad_worktree_create(branch: "feat-b", ...)
Message 3: Task(subagent_type: "mad-developer", ...) for feat-a
Message 4: Task(subagent_type: "mad-developer", ...) for feat-b
```

### CORRECT - Parallel (the whole point!)
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

## File Ownership Rules

Each task MUST have exclusive ownership. Two agents must NEVER modify the same file.

**Good:**
```
Task 1: OWNS /backend/**
Task 2: OWNS /frontend/**
Task 3: OWNS /package.json, /README.md
```

**Bad:**
```
Task 1: "Create login page"
Task 2: "Create signup page"
# BAD! Both might create /frontend/index.html
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `mad_worktree_create` | Create isolated branch |
| `mad_status` | Dashboard of all worktrees |
| `mad_visualize` | ASCII art visualization |
| `mad_test` | Run tests on worktree |
| `mad_merge` | Merge completed branch |
| `mad_cleanup` | Remove worktree |
| `mad_done` | Mark task complete |
| `mad_blocked` | Mark task blocked |
| `mad_read_task` | Read task description |
| `mad_register_agent` | Register agent permissions |
| `mad_final_check` | Run global build/lint and categorize errors |
| `mad_push_and_watch` | Push to remote and watch CI |

> **Note:** `mad_merge` automatically uses `--no-ff` to preserve history. If you ever need to merge manually, always use `git merge --no-ff`.

## Example Session

Request: "Add user authentication with login, signup, and password reset"

### 1. Analysis Phase
```
Task(subagent_type: "mad-analyste", ...)
-> Returns: "Project uses Express + React, auth should go in /backend/auth/** and /frontend/auth/**"
```

### 2. Planning Phase
```
Task(subagent_type: "mad-architecte", ...)
-> Returns plan with 3 tasks:
   - feat-auth-backend: OWNS /backend/auth/**
   - feat-auth-frontend: OWNS /frontend/auth/**
   - feat-auth-config: OWNS /config/auth.js
```

### 3. Development Phase
```
mad_worktree_create(branch: "feat-auth-backend", ...)
mad_worktree_create(branch: "feat-auth-frontend", ...)
mad_worktree_create(branch: "feat-auth-config", ...)

mad_register_agent(sessionID: "...", agentType: "developer", allowedPaths: ["/backend/auth/**"], ...)
Task(subagent_type: "mad-developer", ...) for backend
Task(subagent_type: "mad-developer", ...) for frontend
Task(subagent_type: "mad-developer", ...) for config
```

### 4. Quality Phase
```
Task(subagent_type: "mad-tester", ...) for each worktree
Task(subagent_type: "mad-reviewer", ...) for each worktree
Task(subagent_type: "mad-security", ...) for each worktree
```

### 5. Finalization
```
mad_merge(worktree: "feat-auth-config")
mad_merge(worktree: "feat-auth-backend")
mad_merge(worktree: "feat-auth-frontend")
mad_final_check()
mad_push_and_watch()
mad_cleanup(worktree: "feat-auth-backend")
mad_cleanup(worktree: "feat-auth-frontend")
mad_cleanup(worktree: "feat-auth-config")
```

## Best Practices

1. **Delegate everything** - Orchestrator coordinates, never codes
2. **Keep subtasks focused** - Each should be completable in one session
3. **Name branches clearly** - `feat/`, `fix/`, `refactor/` prefixes
4. **Test before merge** - Always run quality checks first
5. **Handle blocks promptly** - Don't let blocked tasks linger
6. **Merge sequentially** - Avoid merge conflict cascades
7. **Always use `--no-ff` for merges** - Preserves feature history and enables easy reverts
8. **Register permissions** - Use `mad_register_agent` before spawning developers
