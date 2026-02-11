import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from "fs"
import { join, basename } from "path"
import { execSync } from "child_process"

/**
 * MAD - Multi-Agent Dev Plugin for OpenCode
 * 
 * Enables parallel development through git worktrees and the native Task tool.
 * The orchestrator agent decomposes tasks and delegates to developer subagents
 * running in parallel via OpenCode's Task tool.
 */

// Types for agent permissions (constraint enforcement)
interface AgentPermissions {
  type: 'orchestrator' | 'analyste' | 'architecte' | 'developer' | 'tester' | 'reviewer' | 'fixer' | 'merger' | 'security'
  canEdit: boolean
  canWrite: boolean
  canPatch: boolean
  allowedPaths: string[] | null  // null = all, [] = none, [...] = specific list
  deniedPaths: string[]          // Explicitly denied paths
  worktree: string | null        // Worktree path if applicable
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

// Current version of opencode-mad
const CURRENT_VERSION = "1.0.0"

export const MADPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  
  // Use the directory provided by OpenCode, fallback to process.cwd() for backwards compatibility
  const baseDirectory = directory || process.cwd()
  
  /**
   * Helper to run shell commands with proper error handling (cross-platform)
   */
  const runCommand = (cmd: string, cwd?: string): { success: boolean; output: string; error?: string } => {
    try {
      const output = execSync(cmd, { 
        encoding: "utf-8", 
        cwd: cwd || baseDirectory,
        stdio: ["pipe", "pipe", "pipe"]
      })
      return { success: true, output: output.trim() }
    } catch (e: any) {
      return {
        success: false,
        output: "",
        error: e.stderr?.toString() || e.message || "Unknown error"
      }
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
   * Helper to log MAD events
   * Uses baseDirectory to find the git root for log file location
   */
  const logEvent = (level: "info" | "warn" | "error" | "debug", message: string, context?: any) => {
    try {
      const gitRoot = getGitRoot(baseDirectory)
      const logFile = join(gitRoot, ".mad-logs.jsonl")
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        context
      }) + "\n"
      
      appendFileSync(logFile, logEntry)
    } catch (e) {
      // Silent fail for logging - don't break the workflow
      console.error("Failed to write log:", e)
    }
  }

  /**
   * Check for updates from npm registry
   */
  const checkForUpdates = async (): Promise<{ hasUpdate: boolean; current: string; latest: string }> => {
    try {
      const result = runCommand("npm view opencode-mad version")
      if (result.success) {
        const latestVersion = result.output.trim()
        return {
          hasUpdate: latestVersion !== CURRENT_VERSION,
          current: CURRENT_VERSION,
          latest: latestVersion
        }
      }
    } catch (e) {
      // Silent fail - don't break startup if npm check fails
    }
    return { hasUpdate: false, current: CURRENT_VERSION, latest: CURRENT_VERSION }
  }

  return {
    // Custom tools for MAD workflow
    tool: {
      
      /**
       * Create a git worktree for parallel development
       */
      mad_worktree_create: tool({
        description: `Create a new git worktree branch for parallel development.
Use this to set up isolated development environments for subtasks.
Each worktree has its own branch and working directory.`,
        args: {
          branch: tool.schema.string().describe("Branch name for the worktree (e.g., 'feat/auth-login')"),
          task: tool.schema.string().describe("Description of the task to be done in this worktree"),
        },
        async execute(args, context) {
          try {
            const { branch, task } = args
            
            // Validate inputs
            if (!branch || branch.trim() === "") {
              logEvent("error", "mad_worktree_create failed: empty branch name")
              return "❌ Branch name required"
            }
            
            if (!task || task.trim() === "") {
              logEvent("error", "mad_worktree_create failed: empty task description")
              return "❌ Task description required"
            }
            
            const gitRoot = getGitRoot()
            const baseBranch = getCurrentBranch()
            const sessionName = branch.replace(/\//g, "-")
            const worktreeDir = join(gitRoot, "worktrees")
            const worktreePath = join(worktreeDir, sessionName)

            // Check if worktree already exists
            if (existsSync(worktreePath)) {
              logEvent("warn", "Worktree already exists", { branch, path: worktreePath })
              return `⚠️ Worktree exists: ${sessionName}`
            }

            logEvent("info", "Creating worktree", { branch, baseBranch })

            // Ensure .agent-* files are in .gitignore
            const gitignorePath = join(gitRoot, ".gitignore")
            let gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : ""
            if (!gitignoreContent.includes(".agent-")) {
              const additions = `
# MAD agent files (never commit)
.agent-task
.agent-done
.agent-blocked
.agent-error
.mad-logs.jsonl

# Worktrees directory
worktrees/
`
              appendFileSync(gitignorePath, additions)
              runCommand(`git add "${gitignorePath}" && git commit -m "chore: add MAD agent files to gitignore"`, gitRoot)
            }

            // Create worktree directory using Node.js
            try {
              mkdirSync(worktreeDir, { recursive: true })
            } catch (e: any) {
              logEvent("error", "Failed to create worktree directory", { error: e.message })
              return `❌ mkdir failed: ${e.message}`
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
              return `❌ git worktree failed: ${worktreeResult.error}`
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
            } catch (e: any) {
              logEvent("warn", "Failed to write task file", { error: e.message })
            }

            logEvent("info", "Worktree created successfully", { branch, path: worktreePath })

            return `✅ Worktree: ${sessionName} (${branch})`
          } catch (e: any) {
            logEvent("error", "mad_worktree_create exception", { error: e.message, stack: e.stack })
            return `❌ Error: ${e.message}`
          }
        },
      }),

      /**
       * Get status of all active worktrees/agents
       */
      mad_status: tool({
        description: `Get the status of all MAD worktrees and their development progress.
Shows which tasks are done, in progress, blocked, or have errors.`,
        args: {},
        async execute(args, context) {
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

            let icon = "⏳"
            if (existsSync(doneFile)) { icon = "✅"; done++ }
            else if (existsSync(blockedFile)) { icon = "🚫"; blocked++ }
            else if (existsSync(errorFile)) { icon = "❌"; errors++ }
            else { wip++ }

            rows.push(`${icon} ${entry}`)
          }

          return `${rows.join("\n")}\n---\nTotal:${total} Done:${done} WIP:${wip} Blocked:${blocked} Err:${errors}`
        },
      }),

      /**
       * Run tests on a worktree
       */
      mad_test: tool({
        description: `Run tests/build/lint on a MAD worktree to verify the code is working.
Automatically detects the project type (Node.js, Python, Go, Rust) and runs appropriate checks.
Returns the results and creates an error file if tests fail.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name (e.g., 'feat-auth-login')"),
        },
        async execute(args, context) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `❌ Not found: ${args.worktree}`
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
            const pkg = JSON.parse(readFileSync(packageJson, "utf-8"))
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
            return `❌ Failed: ${failed.join(", ")}${passed.length ? ` | ✅ ${passed.join(", ")}` : ""}`
          }
          return `✅ All passed: ${passed.join(", ")}`
        },
      }),

      /**
       * Merge completed worktrees
       */
      mad_merge: tool({
        description: `Merge a completed worktree branch back into the current branch.
Only merges if the worktree is marked as done (.agent-done exists).
Handles merge conflicts by reporting them.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name to merge (e.g., 'feat-auth-login')"),
        },
        async execute(args, context) {
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)
          const doneFile = join(worktreePath, ".agent-done")
          const branch = args.worktree

          if (!existsSync(worktreePath)) {
            return `❌ Not found: ${args.worktree}`
          }

          if (!existsSync(doneFile)) {
            return `❌ Not done: ${args.worktree}`
          }

          const result = runCommand(`git merge --no-ff ${branch} --no-edit`, gitRoot)
          if (result.success) {
            return `✅ Merged: ${branch}`
          } else {
            const output = result.error || ""
            if (output.includes("CONFLICT")) {
              return `⚠️ Conflict in ${branch}`
            }
            return `❌ Merge failed: ${output.slice(0, 100)}`
          }
        },
      }),

      /**
       * Cleanup finished worktrees
       */
      mad_cleanup: tool({
        description: `Remove completed or abandoned worktrees to clean up disk space.
Removes the worktree directory and prunes git worktree references.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name to cleanup (e.g., 'feat-auth-login')"),
          force: tool.schema.boolean().optional().describe("Force cleanup even if not marked as done"),
        },
        async execute(args, context) {
          const gitRoot = await getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)
          const doneFile = join(worktreePath, ".agent-done")

          if (!existsSync(worktreePath)) {
            return `❌ Not found: ${args.worktree}`
          }

          if (!args.force && !existsSync(doneFile)) {
            return `❌ Not done (use force=true)`
          }

          try {
            await $`git worktree remove ${worktreePath} --force`
            await $`git worktree prune`
            return `✅ Cleaned: ${args.worktree}`
          } catch (e: any) {
            return `❌ ${e.message}`
          }
        },
      }),

      /**
       * Mark a task as done
       */
      mad_done: tool({
        description: `Mark a worktree task as completed. Creates the .agent-done file with a summary.
Use this when you've finished implementing the task in a worktree.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name"),
          summary: tool.schema.string().describe("Brief summary of what was accomplished"),
        },
        async execute(args, context) {
          const gitRoot = await getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `❌ Not found: ${args.worktree}`
          }

          await $`echo ${args.summary} > ${join(worktreePath, ".agent-done")}`
          await $`rm -f ${join(worktreePath, ".agent-error")} ${join(worktreePath, ".agent-blocked")}`

          return `✅ Done: ${args.worktree}`
        },
      }),

      /**
       * Mark a task as blocked
       */
      mad_blocked: tool({
        description: `Mark a worktree task as blocked. Creates the .agent-blocked file with the reason.
Use this when you cannot proceed due to missing information or dependencies.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name"),
          reason: tool.schema.string().describe("Why the task is blocked"),
        },
        async execute(args, context) {
          const gitRoot = await getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `❌ Not found: ${args.worktree}`
          }

          await $`echo ${args.reason} > ${join(worktreePath, ".agent-blocked")}`

          return `🚫 Blocked: ${args.worktree}`
        },
      }),

      /**
       * Read task from a worktree
       */
      mad_read_task: tool({
        description: `Read the task description from a worktree's .agent-task file.
Use this to understand what needs to be done in a specific worktree.`,
        args: {
          worktree: tool.schema.string().describe("Worktree session name"),
        },
        async execute(args, context) {
          const gitRoot = await getGitRoot()
          const taskFile = join(gitRoot, "worktrees", args.worktree, ".agent-task")

          if (!existsSync(taskFile)) {
            return `❌ No task: ${args.worktree}`
          }

          return readFileSync(taskFile, "utf-8")
        },
      }),

      /**
       * Log MAD orchestration events
       */
      mad_log: tool({
        description: `Log MAD orchestration events for debugging and monitoring.
Creates structured logs in .mad-logs.jsonl for tracking the workflow.`,
        args: {
          level: tool.schema.enum(["info", "warn", "error", "debug"]).describe("Log level"),
          message: tool.schema.string().describe("Log message"),
          context: tool.schema.object({}).optional().describe("Additional context data")
        },
        async execute(args, context) {
          try {
            await logEvent(args.level as "info" | "warn" | "error" | "debug", args.message, args.context)
            return `✅ Logged`
          } catch (e: any) {
            return `❌ ${e.message}`
          }
        },
      }),

      /**
       * Visualize MAD workflow with ASCII art
       */
      mad_visualize: tool({
        description: `Generate a concise visualization of the MAD orchestration status.
Shows progress and worktree statuses.`,
        args: {},
        async execute(args, context) {
          try {
            const gitRoot = await getGitRoot()
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

              let icon = "⏳"
              let status = "wip"
              if (existsSync(doneFile)) { icon = "✅"; status = "done"; done++ }
              else if (existsSync(blockedFile)) { icon = "🚫"; status = "blocked"; blocked++ }
              else if (existsSync(errorFile)) { icon = "❌"; status = "error"; errors++ }
              else { wip++ }

              rows.push(`${icon} ${entry} (${status})`)
            }

            const progress = total > 0 ? Math.round((done / total) * 100) : 0
            return `Progress: ${progress}% (${done}/${total})\n${rows.join("\n")}`
          } catch (e: any) {
            return `❌ ${e.message}`
          }
        },
      }),

      /**
       * Check for opencode-mad updates
       */
      mad_check_update: tool({
        description: `Check if a newer version of opencode-mad is available on npm.
Returns the current version, latest version, and whether an update is available.`,
        args: {},
        async execute(args, context) {
          try {
            const updateInfo = await checkForUpdates()
            if (updateInfo.hasUpdate) {
              return `🔄 Update: ${updateInfo.current} → ${updateInfo.latest}`
            }
            return `✅ Up to date: ${updateInfo.current}`
          } catch (e: any) {
            return `❌ ${e.message}`
          }
        },
      }),

      /**
       * Push and watch CI
       */
      mad_push_and_watch: tool({
        description: `Push changes to remote and watch CI if it exists.
After all merges and final checks, this pushes to the remote and monitors GitHub Actions.
Uses 'gh run watch' to follow CI progress in real-time.
If CI fails, returns error details for the orchestrator to spawn a fixer.`,
        args: {
          createFixWorktree: tool.schema.boolean().optional().describe("If true and CI fails, automatically suggest creating a fix-ci worktree"),
        },
        async execute(args, context) {
          try {
            const gitRoot = getGitRoot()
            
            const remoteResult = runCommand("git remote get-url origin", gitRoot)
            if (!remoteResult.success) {
              return "⚠️ No remote configured"
            }
            
            const branch = getCurrentBranch()
            const upstreamResult = runCommand(`git rev-parse --abbrev-ref ${branch}@{upstream}`, gitRoot)
            const pushCmd = upstreamResult.success ? "git push" : `git push -u origin ${branch}`
            
            const pushResult = runCommand(pushCmd, gitRoot)
            if (!pushResult.success) {
              return `❌ Push failed: ${pushResult.error?.slice(0, 100)}`
            }
            
            const ghCheck = runCommand("gh --version", gitRoot)
            if (!ghCheck.success) {
              return "✅ Pushed (no gh CLI for CI)"
            }
            
            const runsResult = runCommand(
              `gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,name`,
              gitRoot
            )
            
            let runs: any[] = []
            try { runs = JSON.parse(runsResult.output) } catch { return "✅ Pushed (no CI)" }
            if (runs.length === 0) return "✅ Pushed (no CI)"
            
            const run = runs[0]
            if (run.status === "completed") {
              return run.conclusion === "success" ? "✅ Pushed, CI passed" : `❌ CI failed: ${run.name}`
            }
            
            const watchResult = runCommand(`gh run watch ${run.databaseId} --exit-status`, gitRoot)
            return watchResult.success ? "✅ Pushed, CI passed" : `❌ CI failed: ${run.name}`
          } catch (e: any) {
            logEvent("error", "mad_push_and_watch exception", { error: e.message })
            return `❌ ${e.message}`
          }
        }
      }),

      /**
       * Final check - run global build/lint and categorize errors
       */
      mad_final_check: tool({
        description: `Run global build/lint checks on the main project after all merges.
Compares errors against files modified during the MAD session.`,
        args: {
          baseCommit: tool.schema.string().optional().describe("The commit SHA from before the MAD session started."),
        },
        async execute(args, context) {
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
                  if (match) {
                    const file = match[1].replace(/\\/g, '/')
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
              const pkg = JSON.parse(readFileSync(packageJson, "utf-8"))
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
              return "⚠️ No checks found"
            }
            
            if (failed.length === 0) {
              return `✅ All passed: ${passed.join(", ")}`
            }
            
            let result = `❌ Failed: ${failed.join(", ")}`
            if (passed.length) result += ` | ✅ ${passed.join(", ")}`
            if (sessionErrors) result += ` | Session errors: ${sessionErrors}`
            if (preExistingErrors) result += ` | Pre-existing: ${preExistingErrors}`
            return result
          } catch (e: any) {
            logEvent("error", "mad_final_check exception", { error: e.message })
            return `❌ ${e.message}`
          }
        },
      }),

      /**
       * Register agent permissions for constraint enforcement
       */
      mad_register_agent: tool({
        description: `Register an agent's permissions for constraint enforcement.
Call this when spawning a subagent to define what it can and cannot do.
The plugin will then BLOCK any unauthorized actions.`,
        args: {
          sessionID: tool.schema.string().describe("The session ID of the agent"),
          agentType: tool.schema.enum([
            'orchestrator', 'analyste', 'architecte', 'developer', 
            'tester', 'reviewer', 'fixer', 'merger', 'security'
          ]).describe("Type of agent"),
          worktree: tool.schema.string().optional().describe("Worktree path if applicable"),
          allowedPaths: tool.schema.array(tool.schema.string()).optional().describe("Paths the agent can edit (glob patterns)"),
          deniedPaths: tool.schema.array(tool.schema.string()).optional().describe("Paths explicitly denied"),
        },
        async execute(args, context) {
          const { sessionID, agentType, worktree, allowedPaths, deniedPaths } = args
          
          // Define default permissions based on agent type
          const readOnlyAgents = ['orchestrator', 'analyste', 'architecte', 'tester', 'reviewer', 'security']
          const canEdit = !readOnlyAgents.includes(agentType)
          
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
          
          return `✅ Registered: ${agentType}`
        }
      }),

      /**
       * Analyze codebase - for Analyst agent
       */
      mad_analyze: tool({
        description: `Trigger a codebase analysis. Returns a structured report.
Use mode 'full' for complete project scan, 'targeted' for task-specific analysis.`,
        args: {
          mode: tool.schema.enum(['full', 'targeted']).describe("Analysis mode"),
          focus: tool.schema.string().optional().describe("For targeted mode: what to focus on"),
          paths: tool.schema.array(tool.schema.string()).optional().describe("Specific paths to analyze"),
        },
        async execute(args, context) {
          const { mode, focus } = args
          const gitRoot = getGitRoot()
          
          const structure = runCommand('find . -type f -name "*.ts" -o -name "*.js" -o -name "*.json" | grep -v node_modules | head -50', gitRoot)
          const packageJsonPath = join(gitRoot, 'package.json')
          const pkg = existsSync(packageJsonPath) ? JSON.parse(readFileSync(packageJsonPath, 'utf-8')) : null
          
          let info = `Files: ${structure.output.split('\n').length}`
          if (pkg) info += ` | Deps: ${Object.keys(pkg.dependencies || {}).length}`
          
          logEvent("info", "Codebase analysis completed", { mode, focus })
          return `✅ Analyzed: ${info}`
        }
      }),

      /**
       * Unregister agent permissions when it completes
       */
      mad_unregister_agent: tool({
        description: `Unregister an agent's permissions when it completes.`,
        args: {
          sessionID: tool.schema.string().describe("The session ID to unregister"),
        },
        async execute(args) {
          const existed = agentPermissions.has(args.sessionID)
          agentPermissions.delete(args.sessionID)
          logEvent("info", `Unregistered agent`, { sessionID: args.sessionID })
          return existed ? `✅ Unregistered` : `⚠️ Not found`
        }
      }),

      /**
       * Create development plan - for Architect agent
       */
      mad_create_plan: tool({
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
        async execute(args, context) {
          const { planName, plan, tasks } = args
          
          // Stocker le plan en mémoire (pourrait être persisté plus tard)
          const planData = {
            name: planName,
            createdAt: new Date().toISOString(),
            plan,
            tasks,
          }
          
          // Log pour debugging
          logEvent("info", "Development plan created", { planName, taskCount: tasks.length })
          
          return `✅ Plan: ${planName} (${tasks.length} tasks)`
        }
      }),

      /**
       * Submit code review - for Reviewer agent
       */
      mad_review: tool({
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
        async execute(args, context) {
          const { worktree, verdict, summary, issues, positives } = args
          const gitRoot = getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", worktree)
          
          if (!existsSync(worktreePath)) {
            return `❌ Not found: ${worktree}`
          }
          
          const icon = verdict === 'approved' ? '✅' : verdict === 'changes_requested' ? '⚠️' : '❌'
          const issueCount = issues?.length || 0
          
          // Save report
          writeFileSync(join(worktreePath, '.agent-review'), `${verdict}: ${summary}`)
          
          logEvent("info", "Code review submitted", { worktree, verdict, issueCount })
          
          return `${icon} Review: ${verdict} (${issueCount} issues)`
        }
      }),

      /**
       * Security scan - for Security agent
       */
      mad_security_scan: tool({
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
        async execute(args, context) {
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
          
          const icon = canMerge ? '✅' : '❌'
          return `${icon} Security: ${riskLevel} (${vulnCount} vulns, ${depCount} deps)`
        }
      }),
    },

    // Event hooks
    event: async ({ event }) => {
      // Log MAD events for debugging
      if (event.type === "session.idle") {
        await client.app.log({
          body: {
            service: "opencode-mad",
            level: "debug",
            message: "Session idle",
          },
        })
      }
    },

    // Hook to enforce agent constraints before tool execution
    hook: {
      "tool.execute.before": async (input: any, output: any) => {
        const perms = agentPermissions.get(input.sessionID)
        
        // If no permissions registered, let it pass (backwards compatibility)
        if (!perms) return
        
        const toolName = input.tool
        const args = output.args || {}
        
        // 1. Block edit/write/patch for read-only agents
        if (['edit', 'write', 'patch', 'multiedit'].includes(toolName)) {
          if (!perms.canEdit) {
            logEvent("warn", `BLOCKED: ${perms.type} tried to use ${toolName}`, { sessionID: input.sessionID })
            throw new Error(`🚫 ${perms.type} is read-only`)
          }
          
          // 2. Check path if allowedPaths is defined
          const targetPath = args.filePath || args.file_path || args.path
          if (targetPath) {
            if (perms.deniedPaths.some((p: string) => targetPath.includes(p) || matchGlob(targetPath, p))) {
              logEvent("warn", `BLOCKED: ${perms.type} tried to edit denied path`, { sessionID: input.sessionID, path: targetPath })
              throw new Error(`🚫 Path denied: ${basename(targetPath)}`)
            }
            
            if (perms.allowedPaths && perms.allowedPaths.length > 0) {
              const isAllowed = perms.allowedPaths.some((p: string) => targetPath.includes(p) || matchGlob(targetPath, p))
              if (!isAllowed) {
                logEvent("warn", `BLOCKED: ${perms.type} tried to edit outside allowed paths`, { sessionID: input.sessionID, path: targetPath })
                throw new Error(`🚫 Outside allowed paths: ${basename(targetPath)}`)
              }
            }
          }
        }
        
        // 3. For bash, check if trying to modify files
        if (toolName === 'bash' && perms && !perms.canEdit) {
          const cmd = args.command || ''
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
          ]
          
          for (const pattern of dangerousPatterns) {
            if (pattern.test(cmd)) {
              logEvent("warn", `BLOCKED: ${perms.type} tried dangerous bash command`, { sessionID: input.sessionID })
              throw new Error(`🚫 ${perms.type} is read-only`)
            }
          }
        }
        
        // 4. Force CWD in worktree for agents with worktree
        if (toolName === 'bash' && perms?.worktree && args.command) {
          // Prefix command with cd to worktree
          const worktreePath = perms.worktree.replace(/\\/g, '/')
          output.args.command = `cd "${worktreePath}" && ${args.command}`
        }
      }
    },
  }
}

// Default export for OpenCode plugin system
export default MADPlugin
