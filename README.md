# opencode-mad

**Multi-Agent Dev** - Parallel development orchestration plugin for [OpenCode](https://opencode.ai).

Decompose complex tasks into parallelizable subtasks, each running in isolated git worktrees with dedicated AI subagents. Built on OpenCode's native Task tool for true parallel execution.

## Installation

Copy this folder to your project's `.opencode/` directory:

```
your-project/
└── .opencode/
    ├── agents/
    │   ├── orchestrator.md
    │   ├── mad-developer.md
    │   └── mad-fixer.md
    ├── commands/
    │   ├── mad.md
    │   ├── mad-status.md
    │   ├── mad-fix.md
    │   └── mad-merge-all.md
    ├── plugins/
    │   └── mad-plugin.ts
    └── skills/
        └── mad-workflow/
            └── SKILL.md
```

## Usage

### Quick Start

Use the `/mad` command to start orchestration:

```
/mad Add user authentication with login, signup, and password reset
```

Or switch to the **orchestrator** agent (Tab key) and describe your task.

### Commands

| Command | Description |
|---------|-------------|
| `/mad <task>` | Start parallel orchestration for a task |
| `/mad-status` | Show status of all worktrees |
| `/mad-fix <worktree>` | Fix errors in a worktree |
| `/mad-merge-all` | Merge all completed worktrees |

### Agents

| Agent | Mode | Description |
|-------|------|-------------|
| `orchestrator` | primary | Decomposes tasks, coordinates subagents |
| `mad-developer` | subagent | Implements tasks in worktrees |
| `mad-fixer` | subagent | Fixes build/test errors |

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                             │
│  1. Analyze task                                            │
│  2. Plan decomposition                                      │
│  3. Create worktrees                                        │
│  4. Spawn subagents (parallel via Task tool)               │
└─────────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │  DEVELOPER  │  │  DEVELOPER  │  │  DEVELOPER  │
    │ feat/login  │  │ feat/signup │  │ feat/reset  │
    │  worktree   │  │  worktree   │  │  worktree   │
    └─────────────┘  └─────────────┘  └─────────────┘
           │                │                │
           ▼                ▼                ▼
    ┌─────────────────────────────────────────────────────────┐
    │                    TEST & MERGE                          │
    └─────────────────────────────────────────────────────────┘
```

## License

MIT
