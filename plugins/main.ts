import { Plugin } from "@opencode/plugin"
import { z } from "zod"
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from "fs"
import { join, basename } from "path"
import { execSync } from "child_process"

/**
 * Multi-Agent Dev plugin for OpenCode
 * 
 * Enables parallel development through git worktrees and the native Task tool.
 * The orchestrator agent decomposes tasks and delegates to developer subagents
 * running in parallel via OpenCode's Task tool.
 */

/** A tool definition kept in the internal, Zod-based shape used by the plugin. */
interface ToolDefinition<Args extends z.ZodRawShape = z.ZodRawShape> {
  description: string
  args: Args
  execute: (args: z.infer<z.ZodObject<Args>>, context: unknown) => Promise<string>
}

/** Local `tool()` helper so tool definitions stay compact and typed. */
const tool = Object.assign(
  <Args extends z.ZodRawShape>(definition: ToolDefinition<Args>): ToolDefinition<Args> => definition,
  { schema: z },
)

// Types for agent permissions (constraint enforcement)
type AgentType =
  | "orchestrator"
  | "analyst"
  | "architect"
  | "developer"
  | "tester"
  | "reviewer"
  | "fixer"
  | "merger"
  | "security"
  | "pentester"
  | "typescript-engineer"
  | "pr"
  | "pr-reviewer"
  | "pr-resolver"
  | "conflict-resolver"
  | "version-analyzer"
  | "version-updater"

/** Agents that must never modify files. */
const READ_ONLY_AGENTS: readonly AgentType[] = [
  "orchestrator",
  "analyst",
  "architect",
  "tester",
  "reviewer",
  "security",
  "pentester",
  "pr-reviewer",
  "version-analyzer",
]

interface AgentPermissions {
  type: AgentType
  canEdit: boolean
  canWrite: boolean
  canPatch: boolean
  allowedPaths: string[] | null  // null = all, [] = none, [...] = specific list
  deniedPaths: string[]          // Explicitly denied paths
  worktree: string | null // Worktree path if applicable
}

interface CommandResult {
  success: boolean
  output: string
  error?: string
}

interface PackageJson {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
}

interface GitHubRun {
  databaseId: number
  status: string
  conclusion: string | null
  name: string
}

interface ToolExecuteArgs {
  filePath?: unknown
  file_path?: unknown
  path?: unknown
  command?: unknown
}

interface ToolBeforeInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolBeforeOutput {
  args: Record<string, unknown>
}

// Global map to store permissions by sessionID
const agentPermissions = new Map<string, AgentPermissions>()

// Simple glob matching (for patterns like /backend/**)
function matchGlob(path: string, pattern: string): boolean {
  // Normalize paths
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedPattern = pattern.replace(/\\/g, '/')

  // Convert glob to regex
  const regexPattern = normalizedPattern
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\//g, '\\/')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(normalizedPath)
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown error"
}

/** Extract stderr (when available) or the message from an unknown thrown value. */
function errorOutput(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  if (stderr !== undefined && stderr !== null) {
    const output = String(stderr).trim()
    if (output !== "") return output
  }
  return errorMessage(error)
}

/** Read the branch name recorded in a worktree's .agent-task file. */
function readWorktreeBranch(worktreePath: string): string | undefined {
  const taskFile = join(worktreePath, ".agent-task")
  if (!existsSync(taskFile)) return undefined
  const match = readFileSync(taskFile, "utf-8").match(/^# Branch:\s*(.+)$/m)
  return match?.[1]?.trim()
}

/** Return the first non-empty string among the given values. */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

// Package metadata used by the update check
const PACKAGE_NAME = "@fiandev/opencode-kit"
const CURRENT_VERSION = "1.2.0"

// Free-tier fallback used when an opencode-go model is unavailable or rate-limited.
const FALLBACK_MODEL = "opencode-go/deepseek-v4.1-flash-free"

export const createPluginHooks = async ({ directory, log }: { directory: string; log?: (message: string) => void }) => {

  // Use the directory provided by OpenCode, fallback to process.cwd() for backwards compatibility
  const baseDirectory = directory || process.cwd()

  /**
   * Helper to run shell commands with proper error handling (cross-platform)
   */
  const runCommand = (cmd: string, cwd?: string): CommandResult => {
    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        cwd: cwd || baseDirectory,
        stdio: ["pipe", "pipe", "pipe"]
      })
      return { success: true, output: output.trim() }
    } catch (error: unknown) {
      return { success: false, output: "", error: errorOutput(error) }
    }
  }

  /**
   * Helper to get git root with error handling
   * @param basePath - Optional base path to start from (defaults to baseDirectory)
   */
  const getGitRoot = (basePath?: string): string => {
    const result = runCommand("git rev-parse --show-toplevel", basePath || baseDirectory)
    if (!result.success) {
      throw new Error(`Not a git repository or git not found: ${result.error}`)
    }
    return result.output.replace(/\\/g, "/")
  }

  /**
   * Helper to get current branch with fallback
   * @param basePath - Optional base path to run git command from (defaults to baseDirectory)
   */
  const getCurrentBranch = (basePath?: string): string => {
    const result = runCommand("git symbolic-ref --short HEAD", basePath || baseDirectory)
    return result.success ? result.output : "main"
  }

  /**
   * Helper to log orchestration events
   * Uses baseDirectory to find the git root for log file location
   */
  const logEvent = (level: "info" | "warn" | "error" | "debug", message: string, context?: unknown) => {
    try {
      const gitRoot = getGitRoot(baseDirectory)
      const logFile = join(gitRoot, ".agent-logs.jsonl")
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        context
      }) + "\n"

      appendFileSync(logFile, logEntry)
    } catch (error: unknown) {
      // Silent fail for logging - don't break the workflow
      console.error("Failed to write log:", error)
    }
  }

  /**
   * Check for updates from npm registry
   */
  const checkForUpdates = async (): Promise<{ hasUpdate: boolean; current: string; latest: string }> => {
    try {
      const result = runCommand(`npm view ${PACKAGE_NAME} version`)
      if (result.success) {
        const latestVersion = result.output.trim()
        return {
          hasUpdate: latestVersion !== CURRENT_VERSION,
          current: CURRENT_VERSION,
          latest: latestVersion
        }
      }
    } catch {
      // Silent fail - don't break startup if npm check fails
    }
    return { hasUpdate: false, current: CURRENT_VERSION, latest: CURRENT_VERSION }
  }

  return {
    // Custom tools for the workflow
    tool: {

      /**
       * Create a git worktree for parallel development
       */
      worktree_create: tool({
        description: `Create a new git worktree branch for parallel development.
Use this to set up isolated development environments for subtasks.
Each worktree has its own branch and working directory.`,
        args: {
          branch: tool.schema.string().describe("Branch name for the worktree (e.g., 'feat/auth-login')"),
          task: tool.schema.string().describe("Description of the task to be done in this worktree"),
        },
        async execute(args) {
          try {
            const { branch, task } = args

            // Validate inputs
            if (!branch || branch.trim() === "") {
              logEvent("error", "worktree_create failed: empty branch name")
              return "ERROR Branch name required"
            }

            if (!task || task.trim() === "") {
              logEvent("error", "worktree_create failed: empty task description")
              return "ERROR Task description required"
            }

            const gitRoot = getGitRoot()
            const baseBranch = getCurrentBranch()
            const sessionName = branch.replace(/\//g, "-")
            const worktreeDir = join(gitRoot, "worktrees")
            const worktreePath = join(worktreeDir, sessionName)

            // Check if worktree already exists
            if (existsSync(worktreePath)) {
              logEvent("warn", "Worktree already exists", { branch, path: worktreePath })
              return `WARN Worktree exists: ${sessionName}`
            }

            logEvent("info", "Creating worktree", { branch, baseBranch })

            // Ensure .agent-* files are in .gitignore
            const gitignorePath = join(gitRoot, ".gitignore")
            const gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : ""
            if (!gitignoreContent.includes(".agent-")) {
              const additions = `
# Agent files (never commit)
.agent-task
.agent-done
.agent-blocked
.agent-error
.agent-logs.jsonl

# Worktrees directory
worktrees/
`
              appendFileSync(gitignorePath, additions)
              runCommand(`git add "${gitignorePath}" && git commit -m "chore: add agent files to gitignore"`, gitRoot)
            }

            // Create worktree directory using Node.js
            try {
              mkdirSync(worktreeDir, { recursive: true })
            } catch (error: unknown) {
              logEvent("error", "Failed to create worktree directory", { error: errorMessage(error) })
              return `ERROR mkdir failed: ${errorMessage(error)}`
            }

            // Check if branch exists
            const branchCheckResult = runCommand(`git rev-parse --verify ${branch}`)
            const branchExists = branchCheckResult.success

            // Create worktree
            const worktreeCmd = branchExists
              ? `git worktree add "${worktreePath}" ${branch}`
              : `git worktree add -b ${branch} "${worktreePath}" ${baseBranch}`

            const worktreeResult = runCommand(worktreeCmd, gitRoot)
            if (!worktreeResult.success) {
              logEvent("error", "Failed to create git worktree", {
                branch,
                command: worktreeCmd,
                error: worktreeResult.error
              })
              return `ERROR git worktree failed: ${worktreeResult.error}`
            }

            // Write task file using Node.js
            const taskContent = `# Agent Task
# Branch: ${branch}
# Created: ${new Date().toISOString()}
# Base: ${baseBranch}

${task}
`
            try {
              writeFileSync(join(worktreePath, ".agent-task"), taskContent)
            } catch (error: unknown) {
              logEvent("warn", "Failed to write task file", { error: errorMessage(error) })
            }

            logEvent("info", "Worktree created successfully", { branch, path: worktreePath })

            return `OK Worktree: ${sessionName} (${branch})`
          } catch (error: unknown) {
            logEvent("error", "worktree_create exception", {
              error: errorMessage(error),
              stack: error instanceof Error ? error.stack : undefined,
            })
            return `ERROR Error: ${errorMessage(error)}`
          }
        },
      }),

      /**
       * Get status of all active worktrees/agents
       */
      status: tool({
        description: `Get the status of all worktrees and their development progress.
Shows which tasks are done, in progress, blocked, or have errors.`,
        args: {},
        async execute() {
          const gitRoot = getGitRoot()
          const worktreeDir = join(gitRoot, "worktrees")

          if (!existsSync(worktreeDir)) {
            return "No worktrees"
          }

          const entries = readdirSync(worktreeDir)
          if (entries.length === 0) {
            return "No worktrees"
          }

          let total = 0, done = 0, blocked = 0, errors = 0, wip = 0
          let rows: string[] = []

          for (const entry of entries) {
            const wpath = join(worktreeDir, entry)
            if (!statSync(wpath).isDirectory()) continue
            total++

            const doneFile = join(wpath, ".agent-done")
            const blockedFile = join(wpath, ".agent-blocked")
            const errorFile = join(wpath, ".agent-error")

            let icon = "WIP"
            if (existsSync(doneFile)) { icon = "OK"; done++ }
            else if (existsSync(blockedFile)) { icon = "BLOCKED"; blocked++ }
            else if (existsSync(errorFile)) { icon = "ERROR"; errors++ }
            else { wip++ }

            rows.push(`${icon} ${entry}`)
          }

          return `${rows.join("\n")}\n---\nTotal:${total} Done:${done} WIP:${wip} Blocked:${blocked} Err:${errors}`
        },
      }),

      /**
       * Run tests on a worktree
       */
      test: tool({
        description: `Run tests/build/lint on a worktree to verify the code is working.
Automatically detects the project type (Node.js, Python, Go, Rust) and runs appropriate checks.
Returns the results and creates an error file if tests fail.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name (e.g., 'feat-auth-login')"),
        },
        async execute(args) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `ERROR Not found: ${args.worktree}`
          }

          let passed: string[] = []
          let failed: string[] = []
          let errorMessages = ""

          const doCheck = (label: string, cmd: string) => {
            const result = runCommand(cmd, worktreePath)
            if (result.success) {
              passed.push(label)
            } else {
              failed.push(label)
              errorMessages += `${label}: ${result.error?.slice(0, 200)}\n`
            }
          }

          const packageJson = join(worktreePath, "package.json")
          const goMod = join(worktreePath, "go.mod")
          const cargoToml = join(worktreePath, "Cargo.toml")
          const pyProject = join(worktreePath, "pyproject.toml")
          const requirements = join(worktreePath, "requirements.txt")

          if (existsSync(packageJson)) {
            const pkg = JSON.parse(readFileSync(packageJson, "utf-8")) as PackageJson
            if (pkg.scripts?.lint) doCheck("lint", "npm run lint")
            if (pkg.scripts?.build) doCheck("build", "npm run build")
            if (pkg.scripts?.test) doCheck("test", "npm test")
          }
          if (existsSync(goMod)) {
            doCheck("go-build", "go build ./...")
            doCheck("go-test", "go test ./...")
          }
          if (existsSync(cargoToml)) {
            doCheck("cargo-check", "cargo check")
            doCheck("cargo-test", "cargo test")
          }
          if (existsSync(pyProject) || existsSync(requirements)) {
            doCheck("pytest", "pytest")
          }

          if (failed.length > 0) {
            writeFileSync(join(worktreePath, ".agent-error"), errorMessages)
            const doneFile = join(worktreePath, ".agent-done")
            if (existsSync(doneFile)) unlinkSync(doneFile)
            return `ERROR Failed: ${failed.join(", ")}${passed.length ? ` | OK ${passed.join(", ")}` : ""}`
          }
          if (passed.length === 0) return "WARN No checks found"
          return `OK All passed: ${passed.join(", ")}`
        },
      }),

      /**
       * Merge completed worktrees
       */
      merge: tool({
        description: `Merge a completed worktree branch back into the current branch.
Only merges if the worktree is marked as done (.agent-done exists).
Handles merge conflicts by reporting them.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name to merge (e.g., 'feat-auth-login')"),
        },
        async execute(args) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)
          const doneFile = join(worktreePath, ".agent-done")

          if (!existsSync(worktreePath)) {
            return `ERROR Not found: ${args.worktree}`
          }

          if (!existsSync(doneFile)) {
            return `ERROR Not done: ${args.worktree}`
          }

          const branch = readWorktreeBranch(worktreePath) ?? args.worktree
          const result = runCommand(`git merge --no-ff "${branch}" --no-edit`, gitRoot)
          if (result.success) {
            return `OK Merged: ${branch}`
          } else {
            const output = result.error || ""
            if (output.includes("CONFLICT")) {
              return `WARN Conflict in ${branch}`
            }
            return `ERROR Merge failed: ${output.slice(0, 100)}`
          }
        },
      }),

      /**
       * Cleanup finished worktrees
       */
      cleanup: tool({
        description: `Remove completed or abandoned worktrees to clean up disk space.
Removes the worktree directory and prunes git worktree references.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name to cleanup (e.g., 'feat-auth-login')"),
          force: tool.schema.boolean().optional().describe("Force cleanup even if not marked as done"),
        },
        async execute(args) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)
          const doneFile = join(worktreePath, ".agent-done")

          if (!existsSync(worktreePath)) {
            return `ERROR Not found: ${args.worktree}`
          }

          if (!args.force && !existsSync(doneFile)) {
            return `ERROR Not done (use force=true)`
          }

          const removeResult = runCommand(`git worktree remove "${worktreePath}" --force`, gitRoot)
          if (!removeResult.success) {
            return `ERROR ${removeResult.error}`
          }
          runCommand("git worktree prune", gitRoot)
          return `OK Cleaned: ${args.worktree}`
        },
      }),

      /**
       * Mark a task as done
       */
      done: tool({
        description: `Mark a worktree task as completed. Creates the .agent-done file with a summary.
Use this when you've finished implementing the task in a worktree.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name"),
          summary: tool.schema.string().describe("Brief summary of what was accomplished"),
        },
        async execute(args) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `ERROR Not found: ${args.worktree}`
          }

          writeFileSync(join(worktreePath, ".agent-done"), `${args.summary}\n`)
          for (const marker of [".agent-error", ".agent-blocked"]) {
            const markerPath = join(worktreePath, marker)
            if (existsSync(markerPath)) unlinkSync(markerPath)
          }

          return `OK Done: ${args.worktree}`
        },
      }),

      /**
       * Mark a task as blocked
       */
      blocked: tool({
        description: `Mark a worktree task as blocked. Creates the .agent-blocked file with the reason.
Use this when you cannot proceed due to missing information or dependencies.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name"),
          reason: tool.schema.string().describe("Why the task is blocked"),
        },
        async execute(args) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `ERROR Not found: ${args.worktree}`
          }

          writeFileSync(join(worktreePath, ".agent-blocked"), `${args.reason}\n`)

          return `BLOCKED Blocked: ${args.worktree}`
        },
      }),

      /**
       * Read task from a worktree
       */
      read_task: tool({
        description: `Read the task description from a worktree's .agent-task file.
Use this to understand what needs to be done in a specific worktree.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name"),
        },
        async execute(args) {
          const gitRoot = getGitRoot()
          const taskFile = join(gitRoot, "worktrees", args.worktree, ".agent-task")

          if (!existsSync(taskFile)) {
            return `ERROR No task: ${args.worktree}`
          }

          return readFileSync(taskFile, "utf-8")
        },
      }),

      /**
       * Log orchestration events
       */
      log: tool({
        description: `Log orchestration events for debugging and monitoring.
Creates structured logs in .agent-logs.jsonl for tracking the workflow.`,
        args: {
          level: tool.schema.enum(["info", "warn", "error", "debug"]).describe("Log level"),
          message: tool.schema.string().describe("Log message"),
          context: tool.schema.object({}).optional().describe("Additional context data")
        },
        async execute(args) {
          try {
            await logEvent(args.level, args.message, args.context)
            return `OK Logged`
          } catch (error: unknown) {
            return `ERROR ${errorMessage(error)}`
          }
        },
      }),

      /**
       * Visualize the workflow with ASCII art
       */
      visualize: tool({
        description: `Generate a concise visualization of the orchestration status.
Shows progress and worktree statuses.`,
        args: {},
        async execute() {
          try {
            const gitRoot = getGitRoot()
            const worktreeDir = join(gitRoot, "worktrees")

            if (!existsSync(worktreeDir)) {
              return "No worktrees"
            }

            const entries = readdirSync(worktreeDir)
            if (entries.length === 0) {
              return "No worktrees"
            }

            let total = 0, done = 0, blocked = 0, errors = 0, wip = 0
            let rows: string[] = []

            for (const entry of entries) {
              const wpath = join(worktreeDir, entry)
              if (!statSync(wpath).isDirectory()) continue
              total++

              const doneFile = join(wpath, ".agent-done")
              const blockedFile = join(wpath, ".agent-blocked")
              const errorFile = join(wpath, ".agent-error")

              let icon = "WIP"
              let status = "wip"
              if (existsSync(doneFile)) { icon = "OK"; status = "done"; done++ }
              else if (existsSync(blockedFile)) { icon = "BLOCKED"; status = "blocked"; blocked++ }
              else if (existsSync(errorFile)) { icon = "ERROR"; status = "error"; errors++ }
              else { wip++ }

              rows.push(`${icon} ${entry} (${status})`)
            }

            const progress = total > 0 ? Math.round((done / total) * 100) : 0
            return `Progress: ${progress}% (${done}/${total})\n${rows.join("\n")}`
          } catch (error: unknown) {
            return `ERROR ${errorMessage(error)}`
          }
        },
      }),

      /**
       * Check for plugin updates
       */
      check_update: tool({
        description: `Check if a newer version of ${PACKAGE_NAME} is available on npm.
Returns the current version, latest version, and whether an update is available.`,
        args: {},
        async execute() {
          try {
            const updateInfo = await checkForUpdates()
            if (updateInfo.hasUpdate) {
              return `UPDATE Update: ${updateInfo.current} → ${updateInfo.latest}`
            }
            return `OK Up to date: ${updateInfo.current}`
          } catch (error: unknown) {
            return `ERROR ${errorMessage(error)}`
          }
        },
      }),

      /**
       * Push and watch CI
       */
      push_and_watch: tool({
        description: `Push changes to remote and watch CI if it exists.
After all merges and final checks, this pushes to the remote and monitors GitHub Actions.
Uses 'gh run watch' to follow CI progress in real-time.
If CI fails, returns error details for the orchestrator to spawn a fixer.`,
        args: {
          createFixWorktree: tool.schema.boolean().optional().describe("If true and CI fails, automatically suggest creating a fix-ci worktree"),
        },
        async execute() {
          try {
            const gitRoot = getGitRoot()

            const remoteResult = runCommand("git remote get-url origin", gitRoot)
            if (!remoteResult.success) {
              return "WARN No remote configured"
            }

            const branch = getCurrentBranch()
            const upstreamResult = runCommand(`git rev-parse --abbrev-ref ${branch}@{upstream}`, gitRoot)
            const pushCmd = upstreamResult.success ? "git push" : `git push -u origin ${branch}`

            const pushResult = runCommand(pushCmd, gitRoot)
            if (!pushResult.success) {
              return `ERROR Push failed: ${pushResult.error?.slice(0, 100)}`
            }

            const ghCheck = runCommand("gh --version", gitRoot)
            if (!ghCheck.success) {
              return "OK Pushed (no gh CLI for CI)"
            }

            const runsResult = runCommand(
              `gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,name`,
              gitRoot
            )

            let runs: GitHubRun[] = []
            try { runs = JSON.parse(runsResult.output) as GitHubRun[] } catch { return "OK Pushed (no CI)" }
            const run = runs[0]
            if (!run) return "OK Pushed (no CI)"
            if (run.status === "completed") {
              return run.conclusion === "success" ? "OK Pushed, CI passed" : `ERROR CI failed: ${run.name}`
            }

            const watchResult = runCommand(`gh run watch ${run.databaseId} --exit-status`, gitRoot)
            return watchResult.success ? "OK Pushed, CI passed" : `ERROR CI failed: ${run.name}`
          } catch (error: unknown) {
            logEvent("error", "push_and_watch exception", { error: errorMessage(error) })
            return `ERROR ${errorMessage(error)}`
          }
        }
      }),

      /**
       * Final check - run global build/lint and categorize errors
       */
      final_check: tool({
        description: `Run global build/lint checks on the main project after all merges.
Compares errors against files modified during the session.`,
        args: {
          baseCommit: tool.schema.string().optional().describe("The commit SHA from before the session started."),
        },
        async execute(args) {
          try {
            const gitRoot = getGitRoot()

            let baseCommit = args.baseCommit
            if (!baseCommit) {
              const reflogResult = runCommand('git reflog --format="%H %gs" -n 50', gitRoot)
              if (reflogResult.success) {
                const lines = reflogResult.output.split('\n')
                for (const line of lines) {
                  if (!line.includes('merge') || (!line.includes('feat-') && !line.includes('fix-'))) {
                    baseCommit = line.split(' ')[0]
                    break
                  }
                }
              }
              if (!baseCommit) baseCommit = 'HEAD~10'
            }

            const diffResult = runCommand(`git diff ${baseCommit}..HEAD --name-only`, gitRoot)
            const modifiedFiles = diffResult.success
              ? diffResult.output.split('\n').filter(f => f.trim()).map(f => f.trim())
              : []

            const packageJson = join(gitRoot, "package.json")
            const goMod = join(gitRoot, "go.mod")
            const cargoToml = join(gitRoot, "Cargo.toml")
            const pyProject = join(gitRoot, "pyproject.toml")

            let passed: string[] = []
            let failed: string[] = []
            let sessionErrors = 0
            let preExistingErrors = 0

            const runCheck = (name: string, cmd: string) => {
              const result = runCommand(`${cmd} 2>&1`, gitRoot)
              if (result.success) {
                passed.push(name)
              } else {
                failed.push(name)
                // Count errors in modified files vs pre-existing
                const output = result.error || result.output
                const lines = output.split('\n')
                for (const line of lines) {
                  const match = line.match(/^(.+?):(\d+)/)
                  const file = match?.[1]?.replace(/\\/g, "/")
                  if (file) {
                    if (modifiedFiles.some(mf => file.includes(mf) || mf.includes(file))) {
                      sessionErrors++
                    } else {
                      preExistingErrors++
                    }
                  }
                }
              }
            }

            if (existsSync(packageJson)) {
              const pkg = JSON.parse(readFileSync(packageJson, "utf-8")) as PackageJson
              if (pkg.scripts?.lint) runCheck("lint", "npm run lint")
              if (pkg.scripts?.build) runCheck("build", "npm run build")
              if (pkg.scripts?.typecheck) runCheck("typecheck", "npm run typecheck")
            }
            if (existsSync(goMod)) {
              runCheck("go-build", "go build ./...")
              runCheck("go-vet", "go vet ./...")
            }
            if (existsSync(cargoToml)) {
              runCheck("cargo", "cargo check")
            }
            if (existsSync(pyProject)) {
              runCheck("ruff", "ruff check .")
            }

            if (passed.length === 0 && failed.length === 0) {
              return "WARN No checks found"
            }

            if (failed.length === 0) {
              return `OK All passed: ${passed.join(", ")}`
            }

            let result = `ERROR Failed: ${failed.join(", ")}`
            if (passed.length) result += ` | OK ${passed.join(", ")}`
            if (sessionErrors) result += ` | Session errors: ${sessionErrors}`
            if (preExistingErrors) result += ` | Pre-existing: ${preExistingErrors}`
            return result
          } catch (error: unknown) {
            logEvent("error", "final_check exception", { error: errorMessage(error) })
            return `ERROR ${errorMessage(error)}`
          }
        },
      }),

      /**
       * Register agent permissions for constraint enforcement
       */
      register_agent: tool({
        description: `Register an agent's permissions for constraint enforcement.
Call this when spawning a subagent to define what it can and cannot do.
The plugin will then BLOCK any unauthorized actions.`,
        args: {
          sessionID: tool.schema.string().describe("The session ID of the agent"),
          agentType: tool.schema.enum([
            "orchestrator", "analyst", "architect", "developer",
            "tester", "reviewer", "fixer", "merger", "security", "pentester", "typescript-engineer",
            "pr", "pr-reviewer", "pr-resolver", "conflict-resolver",
            "version-analyzer", "version-updater"
          ]).describe("Type of agent"),
          worktree: tool.schema.string().optional().describe("Worktree path if applicable"),
          allowedPaths: tool.schema.array(tool.schema.string()).optional().describe("Paths the agent can edit (glob patterns)"),
          deniedPaths: tool.schema.array(tool.schema.string()).optional().describe("Paths explicitly denied"),
        },
        async execute(args) {
          const { sessionID, agentType, worktree, allowedPaths, deniedPaths } = args

          // Define default permissions based on agent type
          const canEdit = !READ_ONLY_AGENTS.includes(agentType)

          const permissions: AgentPermissions = {
            type: agentType,
            canEdit,
            canWrite: canEdit,
            canPatch: canEdit,
            allowedPaths: allowedPaths || null,
            deniedPaths: deniedPaths || [],
            worktree: worktree || null,
          }

          agentPermissions.set(sessionID, permissions)

          logEvent("info", `Registered agent permissions`, { sessionID, agentType, canEdit, worktree })

          return `OK Registered: ${agentType}`
        }
      }),

      /**
       * Analyze codebase - for Analyst agent
       */
      analyze: tool({
        description: `Trigger a codebase analysis. Returns a structured report.
Use mode 'full' for complete project scan, 'targeted' for task-specific analysis.`,
        args: {
          mode: tool.schema.enum(['full', 'targeted']).describe("Analysis mode"),
          focus: tool.schema.string().optional().describe("For targeted mode: what to focus on"),
          paths: tool.schema.array(tool.schema.string()).optional().describe("Specific paths to analyze"),
        },
        async execute(args) {
          const { mode, focus } = args
          const gitRoot = getGitRoot()

          const structure = runCommand(
            'find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.json" \\) | grep -v node_modules | head -50',
            gitRoot,
          )
          const packageJsonPath = join(gitRoot, 'package.json')
          const pkg = existsSync(packageJsonPath)
            ? (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson)
            : null

          let info = `Files: ${structure.output.split('\n').length}`
          if (pkg) info += ` | Deps: ${Object.keys(pkg.dependencies || {}).length}`

          logEvent("info", "Codebase analysis completed", { mode, focus })
          return `OK Analyzed: ${info}`
        }
      }),

      /**
       * Unregister agent permissions when it completes
       */
      unregister_agent: tool({
        description: `Unregister an agent's permissions when it completes.`,
        args: {
          sessionID: tool.schema.string().describe("The session ID to unregister"),
        },
        async execute(args) {
          const existed = agentPermissions.has(args.sessionID)
          agentPermissions.delete(args.sessionID)
          logEvent("info", `Unregistered agent`, { sessionID: args.sessionID })
          return existed ? `OK Unregistered` : `WARN Not found`
        }
      }),

      /**
       * Create development plan - for Architect agent
       */
      create_plan: tool({
        description: `Store a development plan created by the Architect agent.
The plan will be available for the orchestrator to present to the user.`,
        args: {
          planName: tool.schema.string().describe("Name/identifier for the plan"),
          plan: tool.schema.string().describe("The full development plan in markdown"),
          tasks: tool.schema.array(tool.schema.object({
            name: tool.schema.string(),
            branch: tool.schema.string(),
            ownership: tool.schema.array(tool.schema.string()),
            denied: tool.schema.array(tool.schema.string()).optional(),
            dependencies: tool.schema.array(tool.schema.string()).optional(),
          })).describe("Structured task list"),
        },
        async execute(args) {
          const { planName, tasks } = args

          logEvent("info", "Development plan created", { planName, taskCount: tasks.length })

          return `OK Plan: ${planName} (${tasks.length} tasks)`
        }
      }),

      /**
       * Submit code review - for Reviewer agent
       */
      review: tool({
        description: `Submit a code review report for a worktree.
Called by the Reviewer agent after analyzing the code.`,
        args: {
          worktree: tool.schema.string().describe("Worktree that was reviewed"),
          verdict: tool.schema.enum(['approved', 'changes_requested', 'rejected']).describe("Review verdict"),
          summary: tool.schema.string().describe("Brief summary of the review"),
          issues: tool.schema.array(tool.schema.object({
            severity: tool.schema.enum(['critical', 'major', 'minor']),
            file: tool.schema.string(),
            line: tool.schema.number().optional(),
            message: tool.schema.string(),
            suggestion: tool.schema.string().optional(),
          })).optional().describe("List of issues found"),
          positives: tool.schema.array(tool.schema.string()).optional().describe("Positive aspects of the code"),
        },
        async execute(args) {
          const { worktree, verdict, summary, issues } = args
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", worktree)

          if (!existsSync(worktreePath)) {
            return `ERROR Not found: ${worktree}`
          }

          const issueCount = issues?.length || 0

          // Save report
          writeFileSync(join(worktreePath, '.agent-review'), `${verdict}: ${summary}`)

          logEvent("info", "Code review submitted", { worktree, verdict, issueCount })

          return `Review: ${verdict} (${issueCount} issues)`
        }
      }),

      /**
       * Check pentest tools availability - for Pentester agent
       */
      pentest_check_tools: tool({
        description: `Check if pentest tools are installed on the system.
Verifies availability of: nuclei, httpx, katana, subfinder, sqlmap, nmap, curl, ffuf.
Returns which tools are available and what scan capabilities are possible.`,
        args: {},
        async execute() {
          const tools = ['nuclei', 'httpx', 'katana', 'subfinder', 'sqlmap', 'nmap', 'curl', 'ffuf']
          const available: string[] = []
          const missing: string[] = []

          for (const t of tools) {
            const result = runCommand(`${t} --version`)
            if (result.success) {
              available.push(t)
            } else {
              // Try 'which' or 'where' as fallback
              const whereResult = runCommand(process.platform === 'win32' ? `where ${t}` : `which ${t}`)
              if (whereResult.success) {
                available.push(t)
              } else {
                missing.push(t)
              }
            }
          }

          const canRunBasic = available.includes('curl') || available.includes('nmap')
          const canRunDeep = available.includes('nuclei') || available.includes('httpx')
          const canRunExploit = available.includes('sqlmap')

          logEvent("info", "Pentest tools check", { available, missing })

          return JSON.stringify({
            available,
            missing,
            canRunBasic,
            canRunDeep,
            canRunExploit,
            summary: `${available.length}/${tools.length} tools available`
          }, null, 2)
        }
      }),

      /**
       * Record pentest scan results - for Pentester agent
       */
      pentest_scan: tool({
        description: `Record the results of a penetration test scan.
Called by the Pentester agent after running security scans on a target.`,
        args: {
          target: tool.schema.string().describe("Target URL or IP that was scanned"),
          mode: tool.schema.enum(['basic', 'deep', 'exploit']).describe("Scan mode used"),
          riskLevel: tool.schema.enum(['low', 'medium', 'high', 'critical']).describe("Overall risk level"),
          summary: tool.schema.string().describe("Brief summary of findings"),
          findings: tool.schema.array(tool.schema.object({
            id: tool.schema.string(),
            severity: tool.schema.enum(['info', 'low', 'medium', 'high', 'critical']),
            type: tool.schema.string(),
            title: tool.schema.string(),
            description: tool.schema.string(),
            evidence: tool.schema.string().optional(),
            remediation: tool.schema.string().optional(),
          })).optional().describe("List of vulnerabilities found"),
          outputFormat: tool.schema.enum(['json', 'markdown']).optional().describe("Output format (default: json)"),
        },
        async execute(args) {
          const { target, mode, riskLevel, summary, findings, outputFormat } = args
          const gitRoot = getGitRoot()

          const findingsCount = findings?.length || 0
          const criticalCount = findings?.filter(f => f.severity === 'critical').length || 0
          const highCount = findings?.filter(f => f.severity === 'high').length || 0

          const scanResult = {
            timestamp: new Date().toISOString(),
            target,
            mode,
            riskLevel,
            summary,
            findings: findings || [],
            stats: {
              total: findingsCount,
              critical: criticalCount,
              high: highCount,
              medium: findings?.filter(f => f.severity === 'medium').length || 0,
              low: findings?.filter(f => f.severity === 'low').length || 0,
              info: findings?.filter(f => f.severity === 'info').length || 0,
            }
          }

          // Save scan results
          const scanFile = join(gitRoot, `.pentest-scan-${Date.now()}.json`)
          writeFileSync(scanFile, JSON.stringify(scanResult, null, 2))

          logEvent("info", "Pentest scan recorded", { target, mode, riskLevel, findingsCount })

          if (outputFormat === 'markdown') {
            let md = `# Pentest Scan Report\n\n`
            md += `**Target:** ${target}\n`
            md += `**Mode:** ${mode}\n`
            md += `**Risk Level:** ${riskLevel}\n`
            md += `**Summary:** ${summary}\n\n`
            md += `## Statistics\n`
            md += `- Critical: ${criticalCount}\n`
            md += `- High: ${highCount}\n`
            md += `- Total: ${findingsCount}\n`
            return md
          }

          return `Pentest: ${riskLevel} | ${findingsCount} findings (${criticalCount} critical, ${highCount} high)`
        }
      }),

      /**
       * Security scan - for Security agent
       */
      security_scan: tool({
        description: `Submit a security scan report for a worktree or the main project.
Called by the Security agent after scanning for vulnerabilities.`,
        args: {
          target: tool.schema.string().describe("Worktree name or 'main' for main project"),
          riskLevel: tool.schema.enum(['low', 'medium', 'high', 'critical']).describe("Overall risk level"),
          summary: tool.schema.string().describe("Brief summary of findings"),
          vulnerabilities: tool.schema.array(tool.schema.object({
            id: tool.schema.string(),
            severity: tool.schema.enum(['low', 'medium', 'high', 'critical']),
            type: tool.schema.string(),
            file: tool.schema.string().optional(),
            line: tool.schema.number().optional(),
            description: tool.schema.string(),
            remediation: tool.schema.string(),
          })).optional().describe("List of vulnerabilities found"),
          dependencyIssues: tool.schema.array(tool.schema.object({
            package: tool.schema.string(),
            severity: tool.schema.string(),
            cve: tool.schema.string().optional(),
            fix: tool.schema.string(),
          })).optional().describe("Vulnerable dependencies"),
        },
        async execute(args) {
          const { target, riskLevel, summary, vulnerabilities, dependencyIssues } = args
          const gitRoot = getGitRoot()

          const vulnCount = vulnerabilities?.length || 0
          const depCount = dependencyIssues?.length || 0
          const canMerge = riskLevel === 'low' || (riskLevel === 'medium' && (!vulnerabilities || vulnerabilities.filter(v => v.severity === 'critical' || v.severity === 'high').length === 0))

          // Save if worktree
          if (target !== 'main') {
            const worktreePath = join(gitRoot, "worktrees", target)
            if (existsSync(worktreePath)) {
              writeFileSync(join(worktreePath, '.agent-security'), `${riskLevel}: ${summary}`)
            }
          }

          logEvent("info", "Security scan completed", { target, riskLevel, vulnCount })

          return `Security: ${riskLevel} (${vulnCount} vulns, ${depCount} deps)`
        }
      }),
    } as unknown as Record<string, ToolDefinition>,

    // Event hooks
    event: async ({ event }: { event: { type: string } }) => {
      // Log orchestration events for debugging
      if (event.type === "session.idle") {
        log?.("Session idle")
      }
    },

    // Send the fallback with each request so the router can recover automatically
    "chat.params": async (
      input: { model: { providerID: string } },
      output: { options: Record<string, unknown> },
    ) => {
      if (input.model.providerID !== "opencode-go") return
      output.options.fallback_model = FALLBACK_MODEL
    },

    // Enforce agent constraints before tool execution
    "tool.execute.before": async (input: ToolBeforeInput, output: ToolBeforeOutput) => {
      const perms = agentPermissions.get(input.sessionID)

      // If no permissions registered, let it pass (backwards compatibility)
      if (!perms) return

      const toolName = input.tool
      const args = (output.args ?? {}) as ToolExecuteArgs

      // 1. Block edit/write/patch for read-only agents
      if (['edit', 'write', 'patch', 'multiedit'].includes(toolName)) {
        if (!perms.canEdit) {
          logEvent("warn", `BLOCKED: ${perms.type} tried to use ${toolName}`, { sessionID: input.sessionID })
          throw new Error(`BLOCKED ${perms.type} is read-only`)
        }

        // 2. Check path if allowedPaths is defined
        const targetPath = firstString(args.filePath, args.file_path, args.path)
        if (targetPath) {
          if (perms.deniedPaths.some((denied) => targetPath.includes(denied) || matchGlob(targetPath, denied))) {
            logEvent("warn", `BLOCKED: ${perms.type} tried to edit denied path`, { sessionID: input.sessionID, path: targetPath })
            throw new Error(`BLOCKED Path denied: ${basename(targetPath)}`)
          }

          if (perms.allowedPaths && perms.allowedPaths.length > 0) {
            const isAllowed = perms.allowedPaths.some(
              (allowed) => targetPath.includes(allowed) || matchGlob(targetPath, allowed),
            )
            if (!isAllowed) {
              logEvent("warn", `BLOCKED: ${perms.type} tried to edit outside allowed paths`, { sessionID: input.sessionID, path: targetPath })
              throw new Error(`BLOCKED Outside allowed paths: ${basename(targetPath)}`)
            }
          }
        }
      }

      // 3. For bash, check if trying to modify files
      if (toolName === "bash" && !perms.canEdit) {
        const cmd = typeof args.command === "string" ? args.command : ""
        const dangerousPatterns = [
          /\becho\s+.*>/,
          /\bcat\s+.*>/,
          /\brm\s+/,
          /\bmv\s+/,
          /\bcp\s+/,
          /\bmkdir\s+/,
          /\btouch\s+/,
          /\bnpm\s+install/,
          /\bgit\s+commit/,
          /\bgit\s+push/,
          /\bgit\s+tag\s+(?:-a|-s|-d|-f|-u|-m|--delete|--force|--annotate|--sign)/,
          /\bgit\s+tag\s+[^\s-]/,
        ]

        for (const pattern of dangerousPatterns) {
          if (pattern.test(cmd)) {
            logEvent("warn", `BLOCKED: ${perms.type} tried dangerous bash command`, { sessionID: input.sessionID })
            throw new Error(`BLOCKED ${perms.type} is read-only`)
          }
        }
      }

      // 4. Force CWD in worktree for agents with worktree
      if (toolName === "bash" && perms.worktree) {
        const command = typeof args.command === "string" ? args.command : ""
        if (command !== "") {
          // Prefix command with cd to worktree
          const worktreePath = perms.worktree.replace(/\\/g, "/")
          output.args.command = `cd "${worktreePath}" && ${command}`
        }
      }
    },
  }
}

/**
 * OpenCode V2 plugin definition.
 *
 * V2 loads plugins through `Plugin.define({ id, setup })`. Setup registers the
 * workflow tools, the tool guard hook, the fallback request hook, and the event
 * subscription. The implementation lives in `createPluginHooks` so it can be
 * exercised without a running server.
 */
export const MultiAgentDevPlugin = Plugin.define({
  id: "fiandev.opencode-kit",
  async setup(ctx) {
    const hooks = await createPluginHooks({
      directory: ctx.location.directory,
      log: (message) => console.debug(`[opencode-kit] ${message}`),
    })

    const tools = Object.entries(hooks.tool).map(([name, definition]) => ({
      name,
      definition,
      input: z.toJSONSchema(z.object(definition.args), { io: "input" }),
    }))

    await ctx.tool.transform((editor) => {
      for (const { name, definition, input } of tools) {
        editor.add({
          name,
          description: definition.description,
          input,
          async execute(args) {
            return { content: await definition.execute(args as never, {} as never) }
          },
        })
      }
    })

    const before = hooks["tool.execute.before"]
    if (before) {
      await ctx.tool.hook("execute.before", async (event) => {
        const args = (event.input && typeof event.input === "object" ? event.input : {}) as Record<string, unknown>
        await before(
          { tool: event.tool, sessionID: event.sessionID, callID: event.id },
          { args },
        )
        if (event.input !== args) event.input = args
      })
    }

    const chatParams = hooks["chat.params"]
    if (chatParams) {
      await ctx.session.hook(
        "context",
        (event) => chatParams({ model: event.model }, event),
        { providerID: "opencode-go" },
      )
    }

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          await hooks.event?.({ event })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("opencode-kit: event subscription failed", error)
        }
      }
    })()

    return () => controller.abort()
  },
})

// Default export for the OpenCode V2 plugin system
export default MultiAgentDevPlugin
