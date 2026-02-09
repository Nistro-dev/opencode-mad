# opencode-mad

**Multi-Agent Dev** - Parallel development orchestration plugin for [OpenCode](https://opencode.ai).

Decompose complex tasks into parallelizable subtasks, each running in isolated git worktrees with dedicated AI subagents. Built on OpenCode's native Task tool for true parallel execution.

## Features

- 🎯 **Smart Planning** - Planner agent asks clarifying questions before coding
- 📁 **File Ownership** - Each agent has exclusive files, preventing conflicts
- 🔀 **Parallel Execution** - Multiple developers work simultaneously
- 🔧 **Conflict Resolution** - Dedicated merger agent handles git conflicts
- ✅ **Integration Testing** - Fixer agent ensures everything works together

## Installation

Copy this folder to your project's `.opencode/` directory:

```
your-project/
└── .opencode/
    ├── agents/
    │   ├── orchestrator.md
    │   ├── mad-planner.md
    │   ├── mad-developer.md
    │   ├── mad-merger.md
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
/mad Create a Task Timer app with Express backend and vanilla JS frontend
```

The workflow will:
1. **Planner** asks you questions about architecture, features, etc.
2. You review the plan and say **"GO"**
3. **Developers** work in parallel on their assigned files
4. **Merger** resolves any conflicts
5. **Fixer** ensures integration works
6. Done! 🎉

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
| `orchestrator` | primary | Coordinates the entire workflow |
| `mad-planner` | subagent | Asks questions, creates detailed plan with file ownership |
| `mad-developer` | subagent | Implements tasks in isolated worktrees |
| `mad-merger` | subagent | Resolves git merge conflicts intelligently |
| `mad-fixer` | subagent | Fixes integration issues after merges |

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  /mad "Create a full-stack app..."                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  🎯 PLANNER                                                  │
│  - Asks clarifying questions                                │
│  - Defines architecture & file ownership                    │
│  - Waits for "GO"                                           │
└─────────────────────────────────────────────────────────────┘
                            │ "GO"
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  🔨 DEVELOPERS (parallel)                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Backend  │  │ Frontend │  │  Config  │                  │
│  │ /backend │  │ /frontend│  │ /root    │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│  Each owns exclusive files - no conflicts!                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  🔀 MERGER (if needed)                                       │
│  - Understands both branches' intent                        │
│  - Combines functionality intelligently                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  🔧 FIXER (if needed)                                        │
│  - Fixes integration issues                                 │
│  - Ensures frontend + backend work together                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                        DONE ✅
```

## File Ownership System

The key to avoiding merge conflicts is **explicit file ownership**. Each developer agent is assigned specific files/folders they can modify:

```
Task 1 (backend):
  OWNS: /backend/**
  CANNOT TOUCH: /frontend/**, /package.json

Task 2 (frontend):  
  OWNS: /frontend/**
  CANNOT TOUCH: /backend/**, /package.json

Task 3 (config):
  OWNS: /package.json, /README.md, /.gitignore
  CANNOT TOUCH: /backend/**, /frontend/**
```

The planner defines these boundaries, and developers strictly respect them.

## Example Session

```
You: /mad Create a Task Timer app - track time spent on tasks

Planner: Before I create the plan, I need to clarify:

1. Frontend: Vanilla JS, React, or Vue?
2. Backend: Express, Fastify, or none?
3. Database: SQLite, PostgreSQL, or in-memory?
4. Dark mode or light mode?
...

You: Vanilla JS, Express, SQLite, dark mode

Planner: Here's the development plan:

## Task 1: Backend API
OWNS: /backend/**
- Express server on port 3001
- SQLite database
- CRUD endpoints for tasks

## Task 2: Frontend UI  
OWNS: /frontend/**
- index.html with task list
- Dark mode CSS
- Timer logic in app.js

Ready to proceed? Reply "GO"

You: GO

Orchestrator: Creating worktrees and spawning developers...
✅ feat-backend-api: Developer working...
✅ feat-frontend-ui: Developer working...

[Time passes...]

Orchestrator: All tasks complete! Merging...
✅ Merged feat-backend-api
✅ Merged feat-frontend-ui
✅ Final tests passing

🎉 Task Timer app is ready!
```

## Requirements

- OpenCode 1.0+
- Git (for worktrees)
- A git repository (initialized)

## License

MIT

## Contributing

Issues and PRs welcome at [github.com/Nistro-dev/opencode-mad](https://github.com/Nistro-dev/opencode-mad)
