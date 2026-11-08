---
name: workflow
description: workflow for parallel development with git worktrees and specialized agents
license: MIT
compatibility: opencode
metadata:
  category: orchestration
  author: Nistro-dev
---

# Workflow

enables parallel software development by decomposing tasks into independent subtasks, each running in isolated git worktrees with dedicated specialized agents.

## Architecture

```
USER REQUEST → ORCHESTRATOR → ANALYSTE → ARCHITECTE → Plan
                    ↓
    ┌───────────────┼───────────────┐
    ↓               ↓               ↓
DEVELOPER 1    DEVELOPER 2    DEVELOPER 3
(worktree)     (worktree)     (worktree)
    ↓               ↓               ↓
    └───────────────┼───────────────┘
                    ↓
         TESTER / REVIEWER / SECURITY
                    ↓
              MERGER / FIXER (if needed)
                    ↓
              FINAL CHECK → PUSH
```

## Specialized Agents

| Agent          | Role                                   |
| -------------- | -------------------------------------- |
| **analyst**    | Understands codebase, finds patterns   |
| **architecte** | Creates task breakdown, file ownership |
| **developer**  | Writes code in isolated worktrees      |
| **tester**     | Runs tests, verifies functionality     |
| **reviewer**   | Checks quality, best practices         |
| **security**   | Audits for vulnerabilities             |
| **fixer**      | Fixes errors, test failures            |
| **merger**     | Resolves git merge conflicts           |

## Signal Files

- `.agent-task`: Task description
- `.agent-done`: Completion marker
- `.agent-blocked`: Block marker
- `.agent-error`: Error details

## Workflow Phases

1. **Analysis**: Analyste understands codebase
2. **Planning**: Architecte creates plan with file ownership
3. **Approval**: User validates plan ("GO")
4. **Development**: Parallel developer spawning
5. **QA**: Testers, Reviewers, Security in parallel
6. **Resolution**: Fixer/Merger if issues
7. **Finalization**: Merge, final check, push, cleanup

## CRITICAL: Parallel Execution

**The entire purpose of MAD is to run tasks IN PARALLEL.**

All independent operations MUST be in a single message:

- Create all worktrees together
- Spawn all developers together
- Run all QA agents together

If you're not parallelizing, you're not using MAD correctly!

## File Ownership Rules

Each task MUST have exclusive ownership. Two agents must NEVER modify the same file.

```
Task 1: OWNS /backend/**
Task 2: OWNS /frontend/**
Task 3: OWNS /package.json, /README.md
```

## Silence Protocol

**CRITICAL: Subagents MUST NOT output verbose commentary.**

### Rules for Subagents:

1. **No status updates** - Don't say "I'm now going to..."
2. **No explanations** - Don't explain what you're doing
3. **No summaries** - Don't summarize at the end
4. **Actions only** - Just execute tools and complete the task
5. **Signal via tools** - Use `done` or `blocked` to communicate

### Why?

- Reduces token usage dramatically
- Speeds up execution
- Orchestrator monitors via `status`, not agent output

### Orchestrator Exception:

The orchestrator MAY output status to keep the user informed, but should remain concise.

## Available Tools

| Tool              | Purpose                               |
| ----------------- | ------------------------------------- |
| `worktree_create` | Create isolated branch                |
| `status`          | Dashboard of all worktrees            |
| `visualize`       | ASCII art visualization               |
| `test`            | Run tests on worktree                 |
| `merge`           | Merge completed branch (uses --no-ff) |
| `cleanup`         | Remove worktree                       |
| `done`            | Mark task complete                    |
| `blocked`         | Mark task blocked                     |
| `read_task`       | Read task description                 |
| `register_agent`  | Register agent permissions            |
| `final_check`     | Run global build/lint                 |
| `push_and_watch`  | Push and watch CI                     |

## Best Practices

1. **Delegate everything** - Orchestrator never codes
2. **Keep subtasks focused** - Completable in one session
3. **Name branches clearly** - `feat/`, `fix/`, `refactor/`
4. **Test before merge** - Always run QA first
5. **Merge sequentially** - Avoid conflict cascades
6. **Register permissions** - Before spawning developers
