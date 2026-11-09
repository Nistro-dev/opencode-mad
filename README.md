# opencode-kit

Parallel development orchestration plugin for [OpenCode](https://opencode.ai).

Decompose complex tasks into parallelizable subtasks, each running in isolated git worktrees with dedicated AI subagents. Now with **19 specialized agents** and **hard constraints** enforced at the code level.

## What's New in v1.0.0

### 5 New Specialized Agents

- **analyst** - Analyzes the codebase (full or targeted analysis), READ-ONLY
- **architect** - Creates detailed development plans with file ownership, READ-ONLY
- **reviewer** - Reviews code quality before merge, READ-ONLY
- **security** - Scans for security vulnerabilities, READ-ONLY
- **pentester** - Web penetration testing via URL, READ-ONLY

### Hard Constraints (Code-Level Enforcement)

The plugin now **blocks unauthorized actions** at the code level:

- READ-ONLY agents cannot use `edit`, `write`, `patch`, or `multiedit` tools
- Developers are constrained to their assigned file ownership
- Dangerous bash commands are blocked for read-only agents

### Refactored Orchestrator

The orchestrator now **delegates** analysis and planning to specialized agents:

- Uses `analyst` for codebase understanding
- Uses `architect` for development planning
- Focuses on coordination and monitoring

### New Tools

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
- **Release Automation** - `/version-update` analyzes local and remote tags, recommends the
  next semver version, and applies the bump and changelog (with optional commit, tag, and push)

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
# Clone and build the plugin bundle
git clone https://github.com/fiandev/opencode-kit.git
cd opencode-kit
bun install
bun run build

# Copy to your project
cp -r agents commands skills your-project/.opencode/
mkdir -p your-project/.opencode/plugins
cp -r dist/. your-project/.opencode/plugins/

# Or copy globally
cp -r agents commands skills ~/.config/opencode/
mkdir -p ~/.config/opencode/plugins
cp -r dist/. ~/.config/opencode/plugins/
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
│   │   ├── pr.md             # Creates/updates pull requests
│   │   ├── pr-reviewer.md    # Reviews pull requests (READ-ONLY)
│   │   ├── pr-resolver.md    # Fixes PR review feedback
│   │   ├── conflict-resolver.md # Resolves git conflicts
│   │   ├── version-analyzer.md # Analyzes diffs since a tag (READ-ONLY)
│   │   ├── version-updater.md # Applies version + changelog (optional commit/tag)
│   │   ├── committer.md      # Stages and commits changes (asks before commit)
│   │   ├── merger.md         # Resolves workflow conflicts
│   │   └── fixer.md          # Fixes integration
│   ├── commands/
│   ├── plugins/
│   │   └── main.js          # bundled plugin (built from plugins/main.ts)
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
| `/orchestration <task>` | Start parallel orchestration |
| `/status`         | Show worktree status          |
| `/visualize`      | ASCII dashboard               |
| `/fix <worktree>` | Fix errors in a worktree      |
| `/merge-all`      | Merge all completed worktrees |
| `/pr [base]`      | Create or update a pull request (fork-aware) |
| `/pr-review [pr]` | Review a pull request         |
| `/pr-resolve [pr]`| Fix PR review comments        |
| `/conflict-resolve [branch\|pr]` | Resolve git conflicts |
| `/commit [hint\|paths]` | Stage and commit through the `committer` subagent |
| `/version-update [flags]` | Analyze the diff since a local/remote tag, then bump version + changelog |

### Pull Requests & Conflicts

These commands delegate to dedicated subagents, so they also work outside the parallel
worktree workflow:

```bash
/pr                       # open a PR for the current branch (or update the existing one)
/pr develop               # target a specific base branch
/pr --upstream            # force a contribution PR to the fork's parent repository
/pr --fork                # force the PR to stay in the origin fork
/pr-review 42             # review PR #42 and submit a verdict
/pr-review                # review the PR for the current branch
/pr-resolve 42            # fix unresolved review threads, push, and resolve them
/conflict-resolve         # resolve the conflict currently in progress
/conflict-resolve feat/x  # merge feat/x and resolve the resulting conflicts
```

`/pr` checks whether `origin` is a fork:

| Origin | Behavior |
| --- | --- |
| Not a fork | Opens the PR against `origin` directly |
| Fork, `--upstream` / `--contribution` | Opens a contribution PR against the parent repository, with `fork-owner:branch` as the head |
| Fork, `--fork` | Opens the PR inside the fork |
| Fork, no flag | **Asks first** whether to open a contribution PR or a fork PR, and waits for the answer |

It never guesses the destination, never pushes a contribution branch to the upstream
repository, and never opens duplicate PRs in both places.

They use the [GitHub CLI](https://cli.github.com); run `gh auth login` once before using
them. The commands never force-push, never merge the PR, and never resolve a review thread
whose code was not actually fixed.

### Commits

`/commit` stages and commits changes with Conventional Commits messages. The orchestrator
stays read-only; a dedicated `committer` subagent performs the git writes, so the permission
gate lives in one place.

```bash
/commit                     # derive message and paths from the diff
/commit fix parser crash    # message hint
/commit src/parser.ts       # stage only these paths
```

Every `git commit` is set to `ask`, so the user approves the exact command and message before
anything is written. Push, amend, rebase, reset, checkout, and tag are denied for the
committer. `git add -A`, `git add --all`, and `git add .` are blocked, and secrets,
`node_modules`, and build output are never staged. A failing pre-commit hook is reported back
instead of bypassed with `--no-verify`.

### Version Updates

`/version-update` analyzes the diff between an existing tag and `HEAD`, then applies the
resulting semver bump. Tags are discovered from local refs **and** from all configured
remotes (or one remote when `--remote` is given), so a release tag that exists only on
`origin` or `upstream` can still be the baseline.

```bash
/version-update                          # latest tag (local + origin), ask before applying
/version-update --from=v1.4.0            # explicit baseline tag/ref
/version-update --from=v1.4.0 --dry-run  # analyze only, change nothing
/version-update --remote=upstream        # inspect only tags on another remote (and push there)
/version-update minor                    # force the bump type
/version-update --bump=major --yes       # force a major bump, skip the confirmation
/version-update --package=packages/api   # version one package in a monorepo
/version-update --first-release          # no baseline tag: analyze the full history
/version-update --no-fetch               # local tags only, do not contact the remote
/version-update --changelog              # create CHANGELOG.md when missing
/version-update --commit --tag           # commit the bump and create the annotated tag
/version-update --commit --tag --push    # also push the branch and tag
```

The work is split across two subagents on purpose:

| Agent | Access | Responsibility |
| --- | --- | --- |
| `version-analyzer` | READ-ONLY | Resolves the baseline from local/remote tags, diffs it against `HEAD`, classifies breaking/feature/fix changes, recommends the next semver version, and drafts the changelog entry |
| `version-updater` | Release files only | Applies the approved version across manifests, lockfiles, and `CHANGELOG.md`, verifies the diff, then optionally commits, tags, and pushes |

Safety defaults:

- Dirty working tree → unrelated files are never committed, and a target manifest with
  pre-existing edits stops the update.
- Existing tag → never moved, overwritten, or force-pushed.
- No commit or tag unless `--commit` or `--tag` is passed. No push unless `--push` is passed,
  and `--push` requires `--commit` or `--tag`.
- `npm publish` and GitHub releases are always separate, explicit steps.
- No commits since the baseline or no user-facing change → recommends `none` and stops.

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
                        DONE!
```

## Hard Constraints

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
BLOCKED analyst is read-only
BLOCKED Outside allowed paths: App.tsx
BLOCKED Path denied: package.json
```

### Permission Matrix

| Agent        | Read | Write | Execute                | File Scope                           |
| ------------ | ---- | ----- | ---------------------- | ------------------------------------ |
| orchestrator | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| analyst      | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| architect    | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| planner      | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| developer    | Yes  | Yes  | Yes                    | Assigned files only                  |
| tester       | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| reviewer     | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| security     | Yes  | No   | Yes (safe commands)    | `**/*`                               |
| pentester    | Yes  | No   | Yes (pentest tools)    | `**/*`                               |
| merger       | Yes  | Yes  | Yes                    | Conflict files                       |
| fixer        | Yes  | Yes  | Yes                    | Integration files                    |
| pr           | Yes  | No   | Yes (git/gh)           | `**/*`                               |
| pr-reviewer  | Yes  | No   | Yes (git/gh)           | `**/*`                               |
| pr-resolver  | Yes  | Yes  | Yes                    | PR review scope                      |
| conflict-resolver | Yes | Yes | Yes                   | Conflicted files                     |
| version-analyzer | Yes | No | Yes (git read-only)   | `**/*`                               |
| version-updater | Yes | Yes | Yes (version files)   | Manifests + changelog                |
| committer    | Yes  | No   | Yes (git add/commit ask) | `**/*`                             |

> "Safe commands" means bash is available, but write-like commands (`rm`, `mv`, `cp`, `mkdir`, `touch`, redirection, `npm install`, `git commit`, `git push`, tag creation) are blocked for read-only agents.

### Developer File Ownership

Developers are constrained to their assigned files:

```
Task: "Implement backend API"
YOU OWN: /backend/**

ALLOWED: edit /backend/server.js
ALLOWED: write /backend/routes/api.js
BLOCKED: edit /frontend/App.tsx (not in ownership)
BLOCKED: write /package.json (not in ownership)
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
| `pr`           | subagent | Git/GitHub Write  | Creates and updates pull requests from the current branch                 |
| `pr-reviewer`  | subagent | READ-ONLY         | Reviews pull requests and submits a verdict                               |
| `pr-resolver`  | subagent | Scoped Write      | Fixes PR review comments, pushes, and resolves threads                    |
| `conflict-resolver` | subagent | Conflict Write | Resolves merge, rebase, cherry-pick, and revert conflicts              |
| `version-analyzer` | subagent | READ-ONLY    | Diffs HEAD against a local/remote tag, classifies changes, recommends the next semver version and changelog |
| `version-updater` | subagent | Release Write | Applies the approved version across manifests, lockfiles, and CHANGELOG; optional commit/tag/push |
| `committer`    | subagent | Commit (asks) | Stages explicit paths and creates Conventional Commits; asks before every commit |

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
- Missing X-Frame-Options header
- TLS 1.0 still enabled
- No known CVEs detected
```

For deeper analysis:

```
You: Run a deep scan on https://staging.myapp.com

Pentester: Starting deep scan...
- Crawling site structure...
- Fuzzing endpoints...
- Testing authentication flows...
```

### Legal Disclaimer

**IMPORTANT**: Only run penetration tests on systems you own or have explicit written permission to test. Unauthorized security testing is illegal in most jurisdictions.

The pentester agent will:

- Ask for confirmation before running scans
- Log all scan activities
- Never run exploit mode without explicit user consent

## Requirements

- [OpenCode](https://opencode.ai) 2.0.23+ (matches the `@opencode/plugin` dependency)
- Git (for worktrees)
- Node.js 18+
- [GitHub CLI](https://cli.github.com) (`gh`), authenticated, for `/pr`, `/pr-review`, and `/pr-resolve`
- **For pentesting**: nmap, nikto, sqlmap, curl, plus optional nuclei, httpx, ffuf, and gobuster

## Configuration

Models are tuned for **cost efficiency first**. Every agent uses a low-cost model that still supports tool calling and reasoning:

| Tier | Model | Cost (in → out / 1M) | Agents |
| --- | --- | --- | --- |
| Core (code + reasoning) | `opencode-go/deepseek-v4.1-flash` | $0.30 → $1.20 | orchestrator, architect, developer, fixer, merger, pr, pr-resolver, conflict-resolver |
| Fast (read-only, scanning) | `opencode-go/qwen3.8-flash` | $0.15 → $0.47 | analyst, planner, tester, reviewer, security, pentester, pr-reviewer |

Model IDs come from the `opencode-go` provider catalog (`models.json`). Compared with `anthropic/claude-opus-4-5` ($5 → $25), the core tier is ~17× cheaper and the fast tier ~50× cheaper.

- Commits are made by developer, fixer, and merger agents; the orchestrator pushes only through `push_and_watch`, after merges and final checks
- Always delegates analysis and planning to specialists

To change a model, edit the `model:` line in the agent's frontmatter (`.opencode/agents/<agent>.md`):

```yaml
---
model: opencode-go/gpt-6-luna   # $0.10 → $0.50 — even cheaper alternative
---
```

Zero-cost options are available in the same catalog (for example `opencode-go/glm-5.3-flash-free` or `opencode-go/deepseek-v4.1-flash-free`), but they have tighter rate limits, so they are not used as defaults.

## License

MIT

## Contributing

Issues and PRs welcome at [github.com/fiandev/opencode-kit](https://github.com/fiandev/opencode-kit)
