# opencode-mad

**Multi-Agent Dev (MAD)** - Parallel development orchestration plugin for [OpenCode](https://opencode.ai).

Decompose complex tasks into parallelizable subtasks, each running in isolated git worktrees with dedicated AI subagents.

## Features

- **Smart Planning** - Orchestrator asks clarifying questions before coding
- **File Ownership** - Each agent has exclusive files, preventing merge conflicts
- **Parallel Execution** - Multiple developers work simultaneously in git worktrees
- **Automated Testing** - Tester agent validates code before merge
- **Conflict Resolution** - Dedicated merger agent handles git conflicts
- **Integration Fixes** - Fixer agent ensures everything works together

## Installation

### Option 1: npx (Recommended)

```bash
# Install to current project
npx opencode-mad install

# Or install globally (all projects)
npx opencode-mad install -g
```

### Option 2: Manual copy

```bash
# Clone the repo
git clone https://github.com/Nistro-dev/opencode-mad.git

# Copy to your project
cp -r opencode-mad/agents your-project/.opencode/
cp -r opencode-mad/commands your-project/.opencode/
cp -r opencode-mad/plugins your-project/.opencode/
cp -r opencode-mad/skills your-project/.opencode/

# Or copy globally
cp -r opencode-mad/agents ~/.config/opencode/agents/
cp -r opencode-mad/commands ~/.config/opencode/commands/
cp -r opencode-mad/plugins ~/.config/opencode/plugins/
cp -r opencode-mad/skills ~/.config/opencode/skills/
```

### Project structure after installation

```
your-project/
├── .opencode/
│   ├── agents/
│   │   ├── orchestrator.md      # Main coordinator
│   │   ├── mad-developer.md     # Implements features
│   │   ├── mad-tester.md        # Tests before merge
│   │   ├── mad-merger.md        # Resolves conflicts
│   │   └── mad-fixer.md         # Fixes integration
│   ├── commands/
│   ├── plugins/
│   │   └── mad-plugin.ts
│   └── skills/
└── ... your code
```

## Usage

Once installed, just talk to the orchestrator naturally:

```
You: Create a Task Timer app with Express backend and React frontend

Orchestrator: Before I create the development plan, I need to clarify:
1. Database: SQLite, PostgreSQL, or in-memory?
2. Authentication needed?
3. Dark mode or light mode?
...

You: SQLite, no auth, dark mode

Orchestrator: Here's the development plan:
[Shows plan with file ownership]

Ready to proceed? Reply "GO"

You: GO

Orchestrator: [Creates worktrees, spawns developers in parallel...]
```

### Commands (Optional)

| Command | Description |
|---------|-------------|
| `/mad <task>` | Start parallel orchestration |
| `/mad-status` | Show worktree status |
| `/mad-visualize` | ASCII dashboard |
| `/mad-fix <worktree>` | Fix errors in a worktree |
| `/mad-merge-all` | Merge all completed worktrees |

### Reporting Bugs

Just tell the orchestrator about the bug - it will delegate to a fixer:

```
You: There's a CORS error, the frontend can't reach the backend

Orchestrator: I'll spawn a fixer to resolve this.
[Delegates to mad-fixer]
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  You: "Create a full-stack app..."                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (primary agent)                               │
│  - Asks clarifying questions                                │
│  - Creates plan with file ownership                         │
│  - Waits for "GO"                                           │
└─────────────────────────────────────────────────────────────┘
                            │ "GO"
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  DEVELOPERS (parallel in git worktrees)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Backend  │  │ Frontend │  │  Config  │                  │
│  │ /backend │  │ /frontend│  │ /root    │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│  Each owns exclusive files - no conflicts!                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  TESTERS (parallel)                                         │
│  - Test APIs with curl                                      │
│  - Check frontend for errors                                │
│  - Verify integration                                       │
│  - Fix simple bugs or block if major issues                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MERGER (if conflicts)                                      │
│  - Understands both branches' intent                        │
│  - Combines functionality intelligently                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  FIXER (if integration issues)                              │
│  - Fixes cross-component bugs                               │
│  - Ensures frontend + backend work together                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                        DONE! 
```

## Agents

| Agent | Mode | Description |
|-------|------|-------------|
| `orchestrator` | primary | Coordinates workflow, asks questions, creates plans. **Never codes directly.** |
| `mad-developer` | subagent | Implements tasks in isolated worktrees |
| `mad-tester` | subagent | Tests code before merge |
| `mad-merger` | subagent | Resolves git merge conflicts |
| `mad-fixer` | subagent | Fixes integration issues |

## Custom Tools

The plugin provides these tools:

| Tool | Description |
|------|-------------|
| `mad_worktree_create` | Create isolated git worktree |
| `mad_status` | Get status of all worktrees |
| `mad_visualize` | ASCII art dashboard |
| `mad_test` | Run tests on a worktree |
| `mad_merge` | Merge completed worktree |
| `mad_cleanup` | Remove finished worktree |
| `mad_done` | Mark task as completed |
| `mad_blocked` | Mark task as blocked |
| `mad_read_task` | Read task description |
| `mad_log` | Log orchestration events |

## File Ownership System

The key to avoiding merge conflicts is **explicit file ownership**:

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

## Requirements

- [OpenCode](https://opencode.ai) 1.0+
- Git (for worktrees)
- Node.js 18+

## Configuration

The orchestrator uses these defaults:
- Model: `anthropic/claude-opus-4-5`
- Never pushes automatically (only commits)
- Always asks questions before planning

To change the model, edit `.opencode/agents/orchestrator.md`:

```yaml
---
model: anthropic/claude-sonnet-4-20250514
---
```

## License

MIT

## Contributing

Issues and PRs welcome at [github.com/Nistro-dev/opencode-mad](https://github.com/Nistro-dev/opencode-mad)
