# opencode-mad

**Multi-Agent Dev (MAD)** - Parallel development orchestration plugin for [OpenCode](https://opencode.ai).

Decompose complex tasks into parallelizable subtasks, each running in isolated git worktrees with dedicated AI subagents. Now with **10 specialized agents** and **hard constraints** enforced at the code level.

## 🎉 What's New in v1.0.0

### 🤖 5 New Specialized Agents
- **mad-analyste** - Analyzes the codebase (full or targeted analysis), READ-ONLY
- **mad-architecte** - Creates detailed development plans with file ownership, READ-ONLY
- **mad-reviewer** - Reviews code quality before merge, READ-ONLY
- **mad-security** - Scans for security vulnerabilities, READ-ONLY
- **mad-pentester** - Web penetration testing via URL, READ-ONLY

### 🔒 Hard Constraints (Code-Level Enforcement)
The plugin now **blocks unauthorized actions** at the code level:
- READ-ONLY agents cannot use `edit`, `write`, or `patch` tools
- Developers are constrained to their assigned file ownership
- Dangerous bash commands are blocked for read-only agents

### 🔄 Refactored Orchestrator
The orchestrator now **delegates** analysis and planning to specialized agents:
- Uses `mad-analyste` for codebase understanding
- Uses `mad-architecte` for development planning
- Focuses on coordination and monitoring

### 🛠️ New Tools
- `mad_register_agent` - Register agent with role and permissions
- `mad_unregister_agent` - Unregister agent when done
- `mad_analyze` - Trigger codebase analysis
- `mad_create_plan` - Create development plan
- `mad_review` - Request code review
- `mad_security_scan` - Run security scan

## Features

- **Smart Planning** - Orchestrator delegates to Analyste and Architecte for thorough planning
- **File Ownership** - Each agent has exclusive files, preventing merge conflicts
- **Hard Constraints** - Plugin enforces permissions at the code level
- **Parallel Execution** - Multiple developers work simultaneously in git worktrees
- **Quality Gates** - Tester, Reviewer, and Security agents validate before merge
- **Conflict Resolution** - Dedicated merger agent handles git conflicts
- **Integration Fixes** - Fixer agent ensures everything works together

## Installation

### Option 1: npx (Recommended)

```bash
# Install to current project
npx opencode-mad install

# Or install globally (all projects)
npx opencode-mad install -g

# Update existing installation
npx opencode-mad update -g

# Check version
npx opencode-mad version
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
│   │   ├── mad-analyste.md      # Codebase analysis (READ-ONLY)
│   │   ├── mad-architecte.md    # Development planning (READ-ONLY)
│   │   ├── mad-developer.md     # Implements features
│   │   ├── mad-tester.md        # Tests before merge
│   │   ├── mad-reviewer.md      # Code review (READ-ONLY)
│   │   ├── mad-security.md      # Security scanning (READ-ONLY)
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

Orchestrator: I'll analyze the codebase first...
[Spawns mad-analyste for codebase analysis]

Analyste: Analysis complete. Here's the structure...

Orchestrator: Now creating the development plan...
[Spawns mad-architecte for planning]

Architecte: Here's the development plan with file ownership:
- Developer 1: /backend/** (Express API)
- Developer 2: /frontend/** (React UI)
- Developer 3: /shared/** (Types & utils)

Orchestrator: Ready to proceed? Reply "GO"

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
│  - Coordinates the entire workflow                          │
│  - Delegates analysis and planning                          │
│  - Monitors progress and handles issues                     │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌───────────────────────┐     ┌───────────────────────┐
│  ANALYSTE (READ-ONLY) │     │  ARCHITECTE (READ-ONLY)│
│  - Analyzes codebase  │────▶│  - Creates dev plan    │
│  - Maps dependencies  │     │  - Assigns ownership   │
│  - Identifies patterns│     │  - Defines interfaces  │
└───────────────────────┘     └───────────────────────┘
                                          │
                                          ▼ "GO"
┌─────────────────────────────────────────────────────────────┐
│  DEVELOPERS (parallel in git worktrees)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Backend  │  │ Frontend │  │  Config  │                  │
│  │ /backend │  │ /frontend│  │ /root    │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│  Each owns exclusive files - ENFORCED BY PLUGIN!            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  QUALITY GATES (parallel)                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ TESTER   │  │ REVIEWER │  │ SECURITY │                  │
│  │ Run tests│  │ Code     │  │ Vuln     │                  │
│  │ & verify │  │ quality  │  │ scanning │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│  All READ-ONLY - cannot modify code!                        │
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
                        DONE! 🎉
```

## 🔒 Hard Constraints

MAD v1.0.0 introduces **hard constraints** enforced at the plugin level. This means agents **cannot bypass** their permissions, even if they try.

### How It Works

When an agent registers with the plugin, it declares its role:

```typescript
// Agent registers with the plugin
mad_register_agent({
  agentId: "analyste-abc123",
  role: "analyste",
  permissions: {
    canWrite: false,      // READ-ONLY
    canExecute: false,    // No bash commands
    filePatterns: ["**/*"] // Can read everything
  }
})
```

The plugin then **intercepts all tool calls** and blocks unauthorized actions:

```
❌ BLOCKED: Agent 'analyste-abc123' attempted to use 'edit' tool
   Reason: Agent role 'analyste' does not have write permissions
```

### Permission Matrix

| Agent | Read | Write | Execute | File Scope |
|-------|------|-------|---------|------------|
| orchestrator | ✅ | ✅ | ✅ | `**/*` |
| mad-analyste | ✅ | ❌ | ❌ | `**/*` |
| mad-architecte | ✅ | ❌ | ❌ | `**/*` |
| mad-developer | ✅ | ✅ | ✅ | Assigned files only |
| mad-tester | ✅ | ✅ | ✅ | Test files + worktree |
| mad-reviewer | ✅ | ❌ | ❌ | `**/*` |
| mad-security | ✅ | ❌ | ❌ | `**/*` |
| mad-pentester | ✅ | ❌ | ✅ | `**/*` (bash for pentest tools only) |
| mad-merger | ✅ | ✅ | ✅ | Conflict files |
| mad-fixer | ✅ | ✅ | ✅ | Integration files |

### Developer File Ownership

Developers are constrained to their assigned files:

```
Task: "Implement backend API"
YOU OWN: /backend/**

✅ ALLOWED: edit /backend/server.js
✅ ALLOWED: write /backend/routes/api.js
❌ BLOCKED: edit /frontend/App.tsx (not in ownership)
❌ BLOCKED: write /package.json (not in ownership)
```

This prevents merge conflicts and ensures clean parallel development.

## Agents

| Agent | Mode | Permissions | Description |
|-------|------|-------------|-------------|
| `orchestrator` | primary | Full | Coordinates workflow, delegates to specialists. **Never codes directly.** |
| `mad-analyste` | subagent | READ-ONLY | Analyzes codebase structure, dependencies, and patterns |
| `mad-architecte` | subagent | READ-ONLY | Creates development plans with file ownership |
| `mad-developer` | subagent | Scoped Write | Implements tasks in isolated worktrees (constrained to owned files) |
| `mad-tester` | subagent | Test Write | Tests code before merge, can fix simple issues |
| `mad-reviewer` | subagent | READ-ONLY | Reviews code quality, suggests improvements |
| `mad-security` | subagent | READ-ONLY | Scans for security vulnerabilities |
| `mad-merger` | subagent | Conflict Write | Resolves git merge conflicts |
| `mad-fixer` | subagent | Integration Write | Fixes cross-component integration issues |
| `mad-pentester` | subagent | READ-ONLY | Web penetration testing via URL (3 scan modes) |

## Custom Tools

The plugin provides these tools:

### Core Tools

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
| `mad_check_update` | Check for plugin updates |
| `mad_push_and_watch` | Push and monitor CI |
| `mad_final_check` | Run final build/lint checks |

### New in v1.0.0

| Tool | Description |
|------|-------------|
| `mad_register_agent` | Register agent with role and permissions |
| `mad_unregister_agent` | Unregister agent when done |
| `mad_analyze` | Trigger codebase analysis (full or targeted) |
| `mad_create_plan` | Create development plan with file ownership |
| `mad_review` | Request code review for a worktree |
| `mad_security_scan` | Run security vulnerability scan |
| `mad_pentest_check_tools` | Check if pentest tools are installed (nmap, nikto, etc.) |
| `mad_pentest_scan` | Register pentest scan results for a target URL |

## Updates

opencode-mad checks for updates automatically and notifies you when a new version is available.

To update manually:
```bash
npx opencode-mad update -g
```

To check for updates:
```bash
npx opencode-mad version
```

## Web Penetration Testing

MAD includes a **pentester agent** for dynamic security testing of web applications.

### Prerequisites

Install the required tools:

```bash
# Debian/Ubuntu
sudo apt install nmap nikto sqlmap

# macOS
brew install nmap nikto sqlmap

# Verify installation
npx opencode-mad pentest-check
```

### Scan Modes

| Mode | Description | Tools Used |
|------|-------------|------------|
| `basic` | Headers, SSL/TLS, known vulnerabilities | nmap, nikto |
| `deep` | Crawling, fuzzing, endpoint discovery | nikto, dirb, gobuster |
| `exploit` | Active SQLi, XSS, CSRF testing | sqlmap, nikto |

### Usage Examples

```
You: Run a basic security scan on https://example.com

Orchestrator: I'll spawn the pentester agent...
[Spawns mad-pentester]

Pentester: Starting basic scan on https://example.com
- Checking SSL/TLS configuration...
- Scanning for open ports...
- Testing security headers...

Results:
⚠️  Missing X-Frame-Options header
⚠️  TLS 1.0 still enabled
✅ No known CVEs detected
```

For deeper analysis:

```
You: Run a deep scan on https://staging.myapp.com

Pentester: Starting deep scan...
- Crawling site structure...
- Fuzzing endpoints...
- Testing authentication flows...
```

### ⚠️ Legal Disclaimer

**IMPORTANT**: Only run penetration tests on systems you own or have explicit written permission to test. Unauthorized security testing is illegal in most jurisdictions.

The pentester agent will:
- Ask for confirmation before running scans
- Log all scan activities
- Never run exploit mode without explicit user consent

## Requirements

- [OpenCode](https://opencode.ai) 1.0+
- Git (for worktrees)
- Node.js 18+
- **For pentesting**: nmap, nikto, sqlmap (optional)

## Configuration

The orchestrator uses these defaults:
- Model: `anthropic/claude-opus-4-5`
- Never pushes automatically (only commits)
- Always delegates analysis and planning to specialists

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
