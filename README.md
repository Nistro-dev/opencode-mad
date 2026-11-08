# opencode-kit

Parallel development orchestration plugin for [OpenCode](https://opencode.ai).

Decompose complex tasks into parallelizable subtasks, each running in isolated git worktrees with dedicated AI subagents. Now with **11 specialized agents** and **hard constraints** enforced at the code level.

## 🎉 What's New in v1.0.0

### 🤖 5 New Specialized Agents

- **analyst** - Analyzes the codebase (full or targeted analysis), READ-ONLY
- **architect** - Creates detailed development plans with file ownership, READ-ONLY
- **reviewer** - Reviews code quality before merge, READ-ONLY
- **security** - Scans for security vulnerabilities, READ-ONLY
- **pentester** - Web penetration testing via URL, READ-ONLY

### 🔒 Hard Constraints (Code-Level Enforcement)

The plugin now **blocks unauthorized actions** at the code level:

- READ-ONLY agents cannot use `edit`, `write`, `patch`, or `multiedit` tools
- Developers are constrained to their assigned file ownership
- Dangerous bash commands are blocked for read-only agents

### 🔄 Refactored Orchestrator

The orchestrator now **delegates** analysis and planning to specialized agents:

- Uses `analyst` for codebase understanding
- Uses `architect` for development planning
- Focuses on coordination and monitoring

### 🛠️ New Tools

- `register_agent` - Register an agent with its type and permissions
- `unregister_agent` - Unregister an agent when it finishes
- `analyze` - Trigger codebase analysis
- `create_plan` - Store a development plan
- `review` - Submit a code review
- `security_scan` - Submit a security scan report
- `pentest_check_tools` - Check which pentest tools are installed
- `pentest_scan` - Record penetration test results

## Features

- **Smart Planning** - Orchestrator delegates to Analyst and Architect for thorough planning
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
npx @fiandev/opencode-kit install

# Or install globally (all projects)
npx @fiandev/opencode-kit install -g

# Update existing installation
npx @fiandev/opencode-kit update -g

# Check version
npx @fiandev/opencode-kit version
```

### Option 2: Manual copy

```bash
# Clone the repo
git clone https://github.com/fiandev/opencode-kit.git

# Copy to your project
cp -r opencode-kit/agents your-project/.opencode/
cp -r opencode-kit/commands your-project/.opencode/
cp -r opencode-kit/plugins your-project/.opencode/
cp -r opencode-kit/skills your-project/.opencode/

# Or copy globally
cp -r opencode-kit/agents ~/.config/opencode/agents/
cp -r opencode-kit/commands ~/.config/opencode/commands/
cp -r opencode-kit/plugins ~/.config/opencode/plugins/
cp -r opencode-kit/skills ~/.config/opencode/skills/
```

### Project structure after installation

```
your-project/
├── .opencode/
│   ├── agents/
│   │   ├── orchestrator.md   # Main coordinator
│   │   ├── analyst.md        # Codebase analysis (READ-ONLY)
│   │   ├── architect.md      # Development planning (READ-ONLY)
│   │   ├── planner.md        # Requirements and file ownership (READ-ONLY)
│   │   ├── developer.md      # Implements features
│   │   ├── tester.md         # Tests before merge (READ-ONLY)
│   │   ├── reviewer.md       # Code review (READ-ONLY)
│   │   ├── security.md       # Security scanning (READ-ONLY)
│   │   ├── pentester.md      # Web penetration testing (READ-ONLY)
│   │   ├── merger.md         # Resolves conflicts
│   │   └── fixer.md          # Fixes integration
│   ├── commands/
│   ├── plugins/
│   │   └── main.ts
│   └── skills/
└── ... your code
```

## Usage

Once installed, just talk to the orchestrator naturally:

```
You: Create a Task Timer app with Express backend and React frontend

Orchestrator: I'll analyze the codebase first...
[Spawns analyst for codebase analysis]

Analyst: Analysis complete. Here's the structure...

Orchestrator: Now creating the development plan...
[Spawns architect for planning]

Architect: Here's the development plan with file ownership:
- Developer 1: /backend/** (Express API)
- Developer 2: /frontend/** (React UI)
- Developer 3: /shared/** (Types & utils)

Orchestrator: Ready to proceed? Reply "GO"

You: GO

Orchestrator: [Creates worktrees, spawns developers in parallel...]
```

### Commands (Optional)

| Command           | Description                   |
| ----------------- | ----------------------------- |
| `/mad <task>`     | Start parallel orchestration  |
| `/status`         | Show worktree status          |
| `/visualize`      | ASCII dashboard               |
| `/fix <worktree>` | Fix errors in a worktree      |
| `/merge-all`      | Merge all completed worktrees |

### Reporting Bugs

Just tell the orchestrator about the bug - it will delegate to a fixer:

```
You: There's a CORS error, the frontend can't reach the backend

Orchestrator: I'll spawn a fixer to resolve this.
[Delegates to fixer]
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
│  ANALYST (READ-ONLY)  │     │  ARCHITECT (READ-ONLY)│
│  - Analyzes codebase  │────▶│  - Creates dev plan   │
│  - Maps dependencies  │     │  - Assigns ownership  │
│  - Identifies patterns│     │  - Defines interfaces │
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

When an agent registers with the plugin, it declares its type and permissions:

```typescript
// Read-only agent
register_agent({
  sessionID: "ses_abc123",
  agentType: "analyst",
  allowedPaths: ["**/*"], // read everything
});

// Developer scoped to its own files
register_agent({
  sessionID: "ses_def456",
  agentType: "developer",
  worktree: "/path/to/worktrees/feat-backend",
  allowedPaths: ["/backend/**"],
  deniedPaths: ["/frontend/**"],
});
```

The plugin then **intercepts all tool calls** and blocks unauthorized actions:

```
🚫 analyst is read-only
🚫 Outside allowed paths: App.tsx
🚫 Path denied: package.json
```

### Permission Matrix

| Agent        | Read | Write | Execute                | File Scope                           |
| ------------ | ---- | ----- | ---------------------- | ------------------------------------ |
| orchestrator | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| analyst      | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| architect    | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| planner      | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| developer    | ✅   | ✅    | ✅                     | Assigned files only                  |
| tester       | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| reviewer     | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| security     | ✅   | ❌    | ✅ (safe commands)     | `**/*`                               |
| pentester    | ✅   | ❌    | ✅ (pentest tools)     | `**/*`                               |
| merger       | ✅   | ✅    | ✅                     | Conflict files                       |
| fixer        | ✅   | ✅    | ✅                     | Integration files                    |

> "Safe commands" means bash is available, but write-like commands (`rm`, `mv`, `cp`, `mkdir`, `touch`, redirection, `npm install`, `git commit`, `git push`) are blocked for read-only agents.

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

| Agent          | Mode     | Permissions       | Description                                                               |
| -------------- | -------- | ----------------- | ------------------------------------------------------------------------- |
| `orchestrator` | primary  | Coordinator       | Coordinates workflow, delegates to specialists. **Never codes directly.** |
| `analyst`      | subagent | READ-ONLY         | Analyzes codebase structure, dependencies, and patterns                   |
| `architect`    | subagent | READ-ONLY         | Creates development plans with file ownership                             |
| `planner`      | subagent | READ-ONLY         | Clarifies requirements and plans file ownership                           |
| `developer`    | subagent | Scoped Write      | Implements tasks in isolated worktrees (constrained to owned files)       |
| `tester`       | subagent | READ-ONLY         | Tests and validates code before merge                                     |
| `reviewer`     | subagent | READ-ONLY         | Reviews code quality, suggests improvements                               |
| `security`     | subagent | READ-ONLY         | Scans for security vulnerabilities                                        |
| `merger`       | subagent | Conflict Write    | Resolves git merge conflicts                                              |
| `fixer`        | subagent | Integration Write | Fixes cross-component integration issues                                  |
| `pentester`    | subagent | READ-ONLY         | Web penetration testing via URL (3 scan modes)                            |

## Custom Tools

The plugin provides these tools:

### Core Tools

| Tool              | Description                  |
| ----------------- | ---------------------------- |
| `worktree_create` | Create isolated git worktree |
| `status`          | Get status of all worktrees  |
| `visualize`       | ASCII art dashboard          |
| `test`            | Run tests on a worktree      |
| `merge`           | Merge completed worktree     |
| `cleanup`         | Remove finished worktree     |
| `done`            | Mark task as completed       |
| `blocked`         | Mark task as blocked         |
| `read_task`       | Read task description        |
| `log`             | Log orchestration events     |
| `check_update`    | Check for plugin updates     |
| `push_and_watch`  | Push and monitor CI          |
| `final_check`     | Run final build/lint checks  |

### New in v1.0.0

| Tool                  | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `register_agent`      | Register an agent with its type and permissions                      |
| `unregister_agent`    | Unregister an agent when it finishes                                 |
| `analyze`             | Trigger codebase analysis (full or targeted)                         |
| `create_plan`         | Store a development plan with file ownership                         |
| `review`              | Submit a code review for a worktree                                  |
| `security_scan`       | Submit a security vulnerability scan report                          |
| `pentest_check_tools` | Check for installed pentest tools (nuclei, httpx, nmap, sqlmap, etc.) |
| `pentest_scan`        | Record pentest scan results for a target URL                         |

## Updates

opencode-kit checks for updates automatically and notifies you when a new version is available.

To update manually:

```bash
npx @fiandev/opencode-kit update -g
```

To check for updates:

```bash
npx @fiandev/opencode-kit version
```

## Web Penetration Testing

MAD includes a **pentester agent** for dynamic security testing of web applications.

### Prerequisites

Install the tools for the scan modes you need:

```bash
# Debian/Ubuntu
sudo apt install nmap nikto sqlmap curl

# macOS
brew install nmap nikto sqlmap curl
```

Optional scanners used by the deep and exploit modes (`nuclei`, `httpx`, `ffuf`, `gobuster`) must be installed separately.

### Checking available tools

Ask the orchestrator or pentester to run `pentest_check_tools`. It reports which of these are installed:

`nuclei`, `httpx`, `katana`, `subfinder`, `sqlmap`, `nmap`, `curl`, `ffuf`

### Scan Modes

| Mode      | Description                             | Tools Used                 |
| --------- | --------------------------------------- | -------------------------- |
| `basic`   | Headers, SSL/TLS, known vulnerabilities | httpx, nuclei, curl        |
| `deep`    | Crawling, fuzzing, endpoint discovery   | nuclei, ffuf, gobuster, nikto |
| `exploit` | Active SQLi, XSS, CSRF testing          | sqlmap, nuclei             |

### Usage Examples

```
You: Run a basic security scan on https://example.com

Orchestrator: I'll spawn the pentester agent...
[Spawns pentester]

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

- [OpenCode](https://opencode.ai) 1.19.5+ (matches the `@opencode-ai/plugin` dependency)
- Git (for worktrees)
- Node.js 18+
- **For pentesting**: nmap, nikto, sqlmap, curl, plus optional nuclei, httpx, ffuf, and gobuster

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

Issues and PRs welcome at [github.com/fiandev/opencode-kit](https://github.com/fiandev/opencode-kit)
