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

// Current version of opencode-mad
const CURRENT_VERSION = "0.4.1"

// Update notification state (shown only once per session)
let updateNotificationShown = false
let pendingUpdateMessage: string | null = null

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

  // Check for updates at plugin initialization and store message for first tool response
  try {
    const updateInfo = await checkForUpdates()
    if (updateInfo.hasUpdate) {
      pendingUpdateMessage = `🔄 **Update available!** opencode-mad ${updateInfo.current} → ${updateInfo.latest}\n   Run: \`npx opencode-mad install -g\`\n\n`
      logEvent("info", "Update available", { current: updateInfo.current, latest: updateInfo.latest })
    }
  } catch (e) {
    // Silent fail - don't break plugin initialization
  }

  /**
   * Helper to get update notification (returns message only once)
   */
  const getUpdateNotification = (): string => {
    if (pendingUpdateMessage && !updateNotificationShown) {
      updateNotificationShown = true
      return pendingUpdateMessage
    }
    return ""
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
              return getUpdateNotification() + "❌ Error: Branch name cannot be empty"
            }
            
            if (!task || task.trim() === "") {
              logEvent("error", "mad_worktree_create failed: empty task description")
              return getUpdateNotification() + "❌ Error: Task description cannot be empty"
            }
            
            const gitRoot = getGitRoot()
            const baseBranch = getCurrentBranch()
            const sessionName = branch.replace(/\//g, "-")
            const worktreeDir = join(gitRoot, "worktrees")
            const worktreePath = join(worktreeDir, sessionName)

            // Check if worktree already exists
            if (existsSync(worktreePath)) {
              logEvent("warn", "Worktree already exists", { branch, path: worktreePath })
              return getUpdateNotification() + `⚠️  Worktree already exists at ${worktreePath}\nUse a different branch name or clean up with mad_cleanup.`
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
              return getUpdateNotification() + `❌ Error creating worktree directory: ${e.message}`
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
              return getUpdateNotification() + `❌ Error creating git worktree: ${worktreeResult.error}`
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

            return getUpdateNotification() + `✅ Worktree created successfully!
- Path: ${worktreePath}
- Branch: ${branch}
- Base: ${baseBranch}
- Task: ${task.substring(0, 100)}${task.length > 100 ? "..." : ""}

The developer subagent can now work in this worktree using the Task tool.`
          } catch (e: any) {
            logEvent("error", "mad_worktree_create exception", { error: e.message, stack: e.stack })
            return getUpdateNotification() + `❌ Unexpected error creating worktree: ${e.message}`
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
            return getUpdateNotification() + "No active MAD worktrees. Use mad_worktree_create to create one."
          }

          const entries = readdirSync(worktreeDir)
          if (entries.length === 0) {
            return getUpdateNotification() + "No active MAD worktrees. Use mad_worktree_create to create one."
          }

          let status = getUpdateNotification() + "# MAD Status Dashboard\n\n"
          let total = 0, done = 0, blocked = 0, errors = 0, wip = 0

          for (const entry of entries) {
            const wpath = join(worktreeDir, entry)
            if (!statSync(wpath).isDirectory()) continue
            total++

            const taskFile = join(wpath, ".agent-task")
            const doneFile = join(wpath, ".agent-done")
            const blockedFile = join(wpath, ".agent-blocked")
            const errorFile = join(wpath, ".agent-error")

            let statusIcon = "⏳"
            let statusText = "IN PROGRESS"
            let detail = ""

            if (existsSync(doneFile)) {
              statusIcon = "✅"
              statusText = "DONE"
              detail = readFileSync(doneFile, "utf-8").split("\n")[0]
              done++
            } else if (existsSync(blockedFile)) {
              statusIcon = "🚫"
              statusText = "BLOCKED"
              detail = readFileSync(blockedFile, "utf-8").split("\n")[0]
              blocked++
            } else if (existsSync(errorFile)) {
              statusIcon = "❌"
              statusText = "ERROR"
              detail = readFileSync(errorFile, "utf-8").split("\n")[0]
              errors++
            } else {
              wip++
            }

            // Get task description
            const task = existsSync(taskFile) 
              ? readFileSync(taskFile, "utf-8").split("\n").filter(l => !l.startsWith("#") && l.trim()).join(" ").slice(0, 60)
              : "No task file"

            // Get commit count
            let commits = "0"
            try {
              const baseBranch = getCurrentBranch()
              const result = runCommand(`git log --oneline ${baseBranch}..HEAD`, wpath)
              if (result.success) {
                commits = result.output.split("\n").filter(l => l.trim()).length.toString()
              }
            } catch {}

            status += `## ${statusIcon} ${entry}\n`
            status += `- **Status:** ${statusText}\n`
            status += `- **Task:** ${task}\n`
            status += `- **Commits:** ${commits}\n`
            if (detail) status += `- **Detail:** ${detail}\n`
            status += `\n`
          }

          status += `---\n`
          status += `**Total:** ${total} | **Done:** ${done} | **WIP:** ${wip} | **Blocked:** ${blocked} | **Errors:** ${errors}\n`

          return status
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
            return getUpdateNotification() + `Worktree not found: ${worktreePath}`
          }

          let results = getUpdateNotification() + `# Test Results for ${args.worktree}\n\n`
          let hasError = false
          let errorMessages = ""

          // Helper to run a check
          const doCheck = (label: string, cmd: string) => {
            results += `## ${label}\n`
            const result = runCommand(cmd, worktreePath)
            if (result.success) {
              results += `✅ Passed\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\`\n\n`
            } else {
              hasError = true
              const output = result.error || "Unknown error"
              results += `❌ Failed\n\`\`\`\n${output.slice(0, 1000)}\n\`\`\`\n\n`
              errorMessages += `${label} FAILED:\n${output}\n\n`
            }
          }

          // Detect project type and run checks
          const packageJson = join(worktreePath, "package.json")
          const goMod = join(worktreePath, "go.mod")
          const cargoToml = join(worktreePath, "Cargo.toml")
          const pyProject = join(worktreePath, "pyproject.toml")
          const requirements = join(worktreePath, "requirements.txt")

          if (existsSync(packageJson)) {
            const pkg = JSON.parse(readFileSync(packageJson, "utf-8"))
            if (pkg.scripts?.lint) doCheck("Lint", "npm run lint")
            if (pkg.scripts?.build) doCheck("Build", "npm run build")
            if (pkg.scripts?.test) doCheck("Test", "npm test")
          }

          if (existsSync(goMod)) {
            doCheck("Go Build", "go build ./...")
            doCheck("Go Test", "go test ./...")
          }

          if (existsSync(cargoToml)) {
            doCheck("Cargo Check", "cargo check")
            doCheck("Cargo Test", "cargo test")
          }

          if (existsSync(pyProject) || existsSync(requirements)) {
            doCheck("Pytest", "pytest")
          }

          // Write error file if tests failed
          if (hasError) {
            writeFileSync(join(worktreePath, ".agent-error"), errorMessages)
            // Remove .agent-done since code is broken
            const doneFile = join(worktreePath, ".agent-done")
            if (existsSync(doneFile)) {
              unlinkSync(doneFile)
            }
            results += `\n---\n⚠️ Tests failed. Error details written to .agent-error. Use the fixer agent to resolve.`
          } else {
            results += `\n---\n✅ All checks passed!`
          }

          return results
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
            return getUpdateNotification() + `Worktree not found: ${worktreePath}`
          }

          if (!existsSync(doneFile)) {
            return getUpdateNotification() + `Cannot merge: worktree ${args.worktree} is not marked as done. Complete the task first.`
          }

          const result = runCommand(`git merge --no-ff ${branch} --no-edit`, gitRoot)
          if (result.success) {
            return getUpdateNotification() + `✅ Successfully merged ${branch}!\n\n${result.output}`
          } else {
            const output = result.error || "Unknown error"
            if (output.includes("CONFLICT")) {
              return getUpdateNotification() + `⚠️ Merge conflict detected!\n\n${output}\n\nResolve conflicts manually or use the fixer agent.`
            }
            return getUpdateNotification() + `❌ Merge failed:\n${output}`
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
            return getUpdateNotification() + `Worktree not found: ${worktreePath}`
          }

          if (!args.force && !existsSync(doneFile)) {
            return getUpdateNotification() + `Worktree ${args.worktree} is not marked as done. Use force=true to cleanup anyway.`
          }

          try {
            await $`git worktree remove ${worktreePath} --force`
            await $`git worktree prune`
            return getUpdateNotification() + `✅ Cleaned up worktree: ${args.worktree}`
          } catch (e: any) {
            return getUpdateNotification() + `❌ Cleanup failed: ${e.message}`
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
            return getUpdateNotification() + `Worktree not found: ${worktreePath}`
          }

          await $`echo ${args.summary} > ${join(worktreePath, ".agent-done")}`
          // Remove error/blocked files
          await $`rm -f ${join(worktreePath, ".agent-error")} ${join(worktreePath, ".agent-blocked")}`

          return getUpdateNotification() + `✅ Marked ${args.worktree} as done: ${args.summary}`
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
            return getUpdateNotification() + `Worktree not found: ${worktreePath}`
          }

          await $`echo ${args.reason} > ${join(worktreePath, ".agent-blocked")}`

          return getUpdateNotification() + `🚫 Marked ${args.worktree} as blocked: ${args.reason}`
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
            return getUpdateNotification() + `Task file not found: ${taskFile}`
          }

          return getUpdateNotification() + readFileSync(taskFile, "utf-8")
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
            return getUpdateNotification() + `📝 Logged [${args.level.toUpperCase()}]: ${args.message}`
          } catch (e: any) {
            return getUpdateNotification() + `⚠️  Failed to write log: ${e.message}`
          }
        },
      }),

      /**
       * Visualize MAD workflow with ASCII art
       */
      mad_visualize: tool({
        description: `Generate an ASCII art visualization of the MAD orchestration status.
Shows progress, worktree statuses, timeline, and statistics in a beautiful dashboard.`,
        args: {},
        async execute(args, context) {
          try {
            const gitRoot = await getGitRoot()
            const worktreeDir = join(gitRoot, "worktrees")

            if (!existsSync(worktreeDir)) {
              return getUpdateNotification() + "No active MAD worktrees. Use mad_worktree_create to create one."
            }

            const entries = readdirSync(worktreeDir)
            if (entries.length === 0) {
              return getUpdateNotification() + "No active MAD worktrees. Use mad_worktree_create to create one."
            }

            let total = 0, done = 0, blocked = 0, errors = 0, wip = 0
            const worktrees: any[] = []

            for (const entry of entries) {
              const wpath = join(worktreeDir, entry)
              if (!statSync(wpath).isDirectory()) continue
              total++

              const taskFile = join(wpath, ".agent-task")
              const doneFile = join(wpath, ".agent-done")
              const blockedFile = join(wpath, ".agent-blocked")
              const errorFile = join(wpath, ".agent-error")

              let status = "IN PROGRESS"
              let icon = "⏳"
              let detail = ""

              if (existsSync(doneFile)) {
                icon = "✅"
                status = "DONE"
                detail = readFileSync(doneFile, "utf-8").split("\n")[0]
                done++
              } else if (existsSync(blockedFile)) {
                icon = "🚫"
                status = "BLOCKED"
                detail = readFileSync(blockedFile, "utf-8").split("\n")[0]
                blocked++
              } else if (existsSync(errorFile)) {
                icon = "❌"
                status = "ERROR"
                detail = readFileSync(errorFile, "utf-8").split("\n")[0]
                errors++
              } else {
                wip++
              }

              const task = existsSync(taskFile) 
                ? readFileSync(taskFile, "utf-8").split("\n").filter(l => !l.startsWith("#") && l.trim()).join(" ").slice(0, 50)
                : "No task file"

              // Get commit count
              const branch = entry.replace(/-/g, "/")
              let commits = "0"
              try {
                const baseBranch = await getCurrentBranch()
                const result = await runCommand(`git -C "${wpath}" log --oneline ${baseBranch}..HEAD 2>/dev/null | wc -l`)
                commits = result.output.trim() || "0"
              } catch {}

              worktrees.push({ name: entry, status, icon, detail, task, commits })
            }

            // Calculate progress
            const progress = total > 0 ? Math.round((done / total) * 100) : 0
            const progressBar = "█".repeat(Math.floor(progress / 5)) + "░".repeat(20 - Math.floor(progress / 5))

            // Build visualization
            let output = getUpdateNotification() + `
┌────────────────────────────────────────────────────────────────┐
│              MAD ORCHESTRATION DASHBOARD                       │
└────────────────────────────────────────────────────────────────┘

📊 Progress: [${progressBar}] ${progress}% (${done}/${total} tasks complete)

┌─ Worktree Status ─────────────────────────────────────────────┐
│                                                                │
`

            for (const wt of worktrees) {
              const statusPadded = wt.status.padEnd(15)
              output += `│  ${wt.icon} ${wt.name.padEnd(35)} [${statusPadded}] │\n`
              output += `│     └─ ${wt.commits} commits │ ${wt.task.padEnd(38)} │\n`
              if (wt.detail) {
                output += `│     └─ ${wt.detail.slice(0, 50).padEnd(50)} │\n`
              }
              output += `│                                                                │\n`
            }

            output += `└────────────────────────────────────────────────────────────────┘

┌─ Statistics ──────────────────────────────────────────────────┐
│                                                                │
│  Total Worktrees:     ${total.toString().padEnd(40)} │
│  ✅ Completed:        ${done} (${Math.round(done/total*100)}%)${' '.repeat(40 - done.toString().length - 7)} │
│  ⏳ In Progress:      ${wip} (${Math.round(wip/total*100)}%)${' '.repeat(40 - wip.toString().length - 7)} │
│  🚫 Blocked:          ${blocked} (${Math.round(blocked/total*100)}%)${' '.repeat(40 - blocked.toString().length - 7)} │
│  ❌ Errors:           ${errors} (${Math.round(errors/total*100)}%)${' '.repeat(40 - errors.toString().length - 7)} │
│                                                                │
└────────────────────────────────────────────────────────────────┘
`

            if (blocked > 0 || errors > 0) {
              output += `\n💡 Next Actions:\n`
              if (errors > 0) output += `  • Fix ${errors} errored worktree(s) (check .agent-error files)\n`
              if (blocked > 0) output += `  • Unblock ${blocked} blocked worktree(s)\n`
              if (done > 0) output += `  • Ready to merge: ${worktrees.filter(w => w.status === "DONE").map(w => w.name).join(", ")}\n`
            }

            return output
          } catch (e: any) {
            return getUpdateNotification() + `❌ Error generating visualization: ${e.message}`
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
              return getUpdateNotification() + `🔄 Update available!

Current version: ${updateInfo.current}
Latest version:  ${updateInfo.latest}

To update, run:
  npx opencode-mad install -g`
            } else {
              return getUpdateNotification() + `✅ You're up to date!

Current version: ${updateInfo.current}
Latest version:  ${updateInfo.latest}`
            }
          } catch (e: any) {
            return getUpdateNotification() + `❌ Failed to check for updates: ${e.message}`
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
            let report = getUpdateNotification() + "# Push & CI Watch\n\n"
            
            // 1. Check if we have a remote
            const remoteResult = runCommand("git remote get-url origin", gitRoot)
            if (!remoteResult.success) {
              return report + "⚠️ No remote 'origin' configured. Skipping push."
            }
            
            // 2. Get current branch
            const branch = getCurrentBranch()
            report += `📍 Branch: \`${branch}\`\n\n`
            
            // 3. Check if upstream exists, if not set it
            const upstreamResult = runCommand(`git rev-parse --abbrev-ref ${branch}@{upstream}`, gitRoot)
            
            // 4. Push
            report += "## 🚀 Pushing to remote...\n"
            const pushCmd = upstreamResult.success 
              ? "git push"
              : `git push -u origin ${branch}`
            
            const pushResult = runCommand(pushCmd, gitRoot)
            if (!pushResult.success) {
              return report + `❌ Push failed:\n\`\`\`\n${pushResult.error}\n\`\`\`\n\nFix the issue and try again.`
            }
            report += "✅ Push successful!\n\n"
            
            // 5. Check if gh CLI is available
            const ghCheck = runCommand("gh --version", gitRoot)
            if (!ghCheck.success) {
              return report + "⚠️ GitHub CLI (gh) not installed. Cannot watch CI.\n\nInstall with: https://cli.github.com/"
            }
            
            // 6. Check for running/pending workflow runs
            report += "## 🔍 Checking for CI workflows...\n"
            const runsResult = runCommand(
              `gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,name,event`,
              gitRoot
            )
            
            if (!runsResult.success) {
              return report + "⚠️ Could not check CI status. You may not be authenticated with `gh auth login`."
            }
            
            let runs: any[] = []
            try {
              runs = JSON.parse(runsResult.output)
            } catch {
              return report + "⚠️ No CI workflows found for this repository.\n\n✅ Push complete (no CI to watch)."
            }
            
            if (runs.length === 0) {
              return report + "ℹ️ No CI workflows found for this branch.\n\n✅ Push complete!"
            }
            
            const latestRun = runs[0]
            report += `Found workflow: **${latestRun.name}** (${latestRun.event})\n\n`
            
            // 7. If already completed, just report status
            if (latestRun.status === "completed") {
              if (latestRun.conclusion === "success") {
                return report + `✅ CI already passed! (${latestRun.name})\n\n🎉 All done!`
              } else {
                report += `❌ CI failed with conclusion: ${latestRun.conclusion}\n\n`
                report += "Use `gh run view --log-failed` to see error details.\n"
                if (args.createFixWorktree) {
                  report += "\n💡 **Suggestion:** Create a `fix-ci` worktree to fix the CI errors."
                }
                return report
              }
            }
            
            // 8. Watch the CI run in real-time
            report += "## ⏳ Watching CI...\n"
            report += `Running: \`gh run watch ${latestRun.databaseId}\`\n\n`
            
            // Use gh run watch (this blocks until complete)
            const watchResult = runCommand(
              `gh run watch ${latestRun.databaseId} --exit-status`,
              gitRoot
            )
            
            if (watchResult.success) {
              return report + `✅ CI passed!\n\n\`\`\`\n${watchResult.output.slice(-500)}\n\`\`\`\n\n🎉 All done!`
            } else {
              report += `❌ CI failed!\n\n\`\`\`\n${(watchResult.error || watchResult.output).slice(-1000)}\n\`\`\`\n\n`
              
              // Get failed logs
              const logsResult = runCommand(`gh run view ${latestRun.databaseId} --log-failed`, gitRoot)
              if (logsResult.success && logsResult.output) {
                report += `### Failed logs:\n\`\`\`\n${logsResult.output.slice(-2000)}\n\`\`\`\n\n`
              }
              
              if (args.createFixWorktree) {
                report += "💡 **Recommendation:** Create a `fix-ci` worktree to fix these errors."
              }
              
              return report
            }
          } catch (e: any) {
            logEvent("error", "mad_push_and_watch exception", { error: e.message })
            return getUpdateNotification() + `❌ Error: ${e.message}`
          }
        }
      }),

      /**
       * Final check - run global build/lint and categorize errors
       */
      mad_final_check: tool({
        description: `Run global build/lint checks on the main project after all merges.
Compares errors against files modified during the MAD session to distinguish:
- Session errors: caused by changes made during this session
- Pre-existing errors: already present before the session started

Use this at the end of the MAD workflow to ensure code quality.`,
        args: {
          baseCommit: tool.schema.string().optional().describe("The commit SHA from before the MAD session started. If not provided, will try to detect from reflog."),
        },
        async execute(args, context) {
          try {
            const gitRoot = getGitRoot()
            
            // 1. Determine base commit for comparison
            let baseCommit = args.baseCommit
            if (!baseCommit) {
              // Try to find the commit before MAD session started (look for last commit before worktrees were created)
              const reflogResult = runCommand('git reflog --format="%H %gs" -n 50', gitRoot)
              if (reflogResult.success) {
                // Find first commit that's not a merge from a MAD branch
                const lines = reflogResult.output.split('\n')
                for (const line of lines) {
                  if (!line.includes('merge') || (!line.includes('feat-') && !line.includes('fix-'))) {
                    baseCommit = line.split(' ')[0]
                    break
                  }
                }
              }
              if (!baseCommit) {
                baseCommit = 'HEAD~10' // Fallback
              }
            }
            
            // 2. Get list of files modified during session
            const diffResult = runCommand(`git diff ${baseCommit}..HEAD --name-only`, gitRoot)
            const modifiedFiles = diffResult.success 
              ? diffResult.output.split('\n').filter(f => f.trim()).map(f => f.trim())
              : []
            
            let report = getUpdateNotification() + `# Final Project Check\n\n`
            report += `📊 **Session Summary:**\n`
            report += `- Base commit: \`${baseCommit.substring(0, 8)}\`\n`
            report += `- Files modified: ${modifiedFiles.length}\n\n`
            
            // 3. Detect project type and run checks
            const packageJson = join(gitRoot, "package.json")
            const goMod = join(gitRoot, "go.mod")
            const cargoToml = join(gitRoot, "Cargo.toml")
            const pyProject = join(gitRoot, "pyproject.toml")
            
            interface CheckError {
              file: string
              line?: number
              message: string
              isSessionError: boolean
            }
            
            const allErrors: CheckError[] = []
            let checksRun = 0
            
            // Helper to parse errors and categorize them
            const parseAndCategorize = (output: string, checkName: string) => {
              // Common patterns for file:line:message
              const patterns = [
                /^(.+?):(\d+):\d*:?\s*(.+)$/gm,  // file:line:col: message
                /^(.+?)\((\d+),\d+\):\s*(.+)$/gm, // file(line,col): message (TypeScript)
                /^\s*(.+?):(\d+)\s+(.+)$/gm,      // file:line message
              ]
              
              for (const pattern of patterns) {
                let match
                while ((match = pattern.exec(output)) !== null) {
                  const file = match[1].trim().replace(/\\/g, '/')
                  const line = parseInt(match[2])
                  const message = match[3].trim()
                  
                  // Check if this file was modified during session
                  const isSessionError = modifiedFiles.some(mf => 
                    file.endsWith(mf) || mf.endsWith(file) || file.includes(mf) || mf.includes(file)
                  )
                  
                  allErrors.push({ file, line, message, isSessionError })
                }
              }
            }
            
            // Run checks based on project type
            if (existsSync(packageJson)) {
              const pkg = JSON.parse(readFileSync(packageJson, "utf-8"))
              
              if (pkg.scripts?.lint) {
                checksRun++
                report += `## 🔍 Lint Check\n`
                const lintResult = runCommand("npm run lint 2>&1", gitRoot)
                if (lintResult.success) {
                  report += `✅ Lint passed\n\n`
                } else {
                  report += `❌ Lint failed\n`
                  parseAndCategorize(lintResult.error || lintResult.output, "lint")
                }
              }
              
              if (pkg.scripts?.build) {
                checksRun++
                report += `## 🔨 Build Check\n`
                const buildResult = runCommand("npm run build 2>&1", gitRoot)
                if (buildResult.success) {
                  report += `✅ Build passed\n\n`
                } else {
                  report += `❌ Build failed\n`
                  parseAndCategorize(buildResult.error || buildResult.output, "build")
                }
              }
              
              if (pkg.scripts?.typecheck || pkg.scripts?.["type-check"]) {
                checksRun++
                const cmd = pkg.scripts?.typecheck ? "npm run typecheck" : "npm run type-check"
                report += `## 📝 TypeCheck\n`
                const tcResult = runCommand(`${cmd} 2>&1`, gitRoot)
                if (tcResult.success) {
                  report += `✅ TypeCheck passed\n\n`
                } else {
                  report += `❌ TypeCheck failed\n`
                  parseAndCategorize(tcResult.error || tcResult.output, "typecheck")
                }
              }
            }
            
            if (existsSync(goMod)) {
              checksRun++
              report += `## 🔨 Go Build\n`
              const goBuild = runCommand("go build ./... 2>&1", gitRoot)
              if (goBuild.success) {
                report += `✅ Go build passed\n\n`
              } else {
                parseAndCategorize(goBuild.error || goBuild.output, "go build")
              }
              
              checksRun++
              report += `## 🔍 Go Vet\n`
              const goVet = runCommand("go vet ./... 2>&1", gitRoot)
              if (goVet.success) {
                report += `✅ Go vet passed\n\n`
              } else {
                parseAndCategorize(goVet.error || goVet.output, "go vet")
              }
            }
            
            if (existsSync(cargoToml)) {
              checksRun++
              report += `## 🔨 Cargo Check\n`
              const cargoCheck = runCommand("cargo check 2>&1", gitRoot)
              if (cargoCheck.success) {
                report += `✅ Cargo check passed\n\n`
              } else {
                parseAndCategorize(cargoCheck.error || cargoCheck.output, "cargo")
              }
              
              checksRun++
              report += `## 🔍 Cargo Clippy\n`
              const clippy = runCommand("cargo clippy 2>&1", gitRoot)
              if (clippy.success) {
                report += `✅ Clippy passed\n\n`
              } else {
                parseAndCategorize(clippy.error || clippy.output, "clippy")
              }
            }
            
            if (existsSync(pyProject)) {
              checksRun++
              report += `## 🔍 Python Lint (ruff/flake8)\n`
              let pyLint = runCommand("ruff check . 2>&1", gitRoot)
              if (!pyLint.success && pyLint.error?.includes("not found")) {
                pyLint = runCommand("flake8 . 2>&1", gitRoot)
              }
              if (pyLint.success) {
                report += `✅ Python lint passed\n\n`
              } else {
                parseAndCategorize(pyLint.error || pyLint.output, "python lint")
              }
              
              checksRun++
              report += `## 📝 Python Type Check (mypy)\n`
              const mypy = runCommand("mypy . 2>&1", gitRoot)
              if (mypy.success) {
                report += `✅ Mypy passed\n\n`
              } else {
                parseAndCategorize(mypy.error || mypy.output, "mypy")
              }
            }
            
            if (checksRun === 0) {
              report += `⚠️ No build/lint scripts detected in this project.\n`
              report += `Supported: package.json (npm), go.mod, Cargo.toml, pyproject.toml\n`
              logEvent("warn", "mad_final_check: no checks detected", { gitRoot })
              return report
            }
            
            // 4. Categorize and report errors
            const sessionErrors = allErrors.filter(e => e.isSessionError)
            const preExistingErrors = allErrors.filter(e => !e.isSessionError)
            
            report += `---\n\n## 📋 Error Summary\n\n`
            
            if (allErrors.length === 0) {
              report += `🎉 **All checks passed!** No errors detected.\n`
              logEvent("info", "mad_final_check: all checks passed", { checksRun })
              return report
            }
            
            if (sessionErrors.length > 0) {
              report += `### ❌ Session Errors (${sessionErrors.length})\n`
              report += `*These errors are in files modified during this session:*\n\n`
              for (const err of sessionErrors.slice(0, 10)) {
                report += `- \`${err.file}${err.line ? `:${err.line}` : ''}\`: ${err.message.substring(0, 100)}\n`
              }
              if (sessionErrors.length > 10) {
                report += `- ... and ${sessionErrors.length - 10} more\n`
              }
              report += `\n`
            }
            
            if (preExistingErrors.length > 0) {
              report += `### ⚠️ Pre-existing Errors (${preExistingErrors.length})\n`
              report += `*These errors are NOT caused by this session - they existed before:*\n\n`
              for (const err of preExistingErrors.slice(0, 10)) {
                report += `- \`${err.file}${err.line ? `:${err.line}` : ''}\`: ${err.message.substring(0, 100)}\n`
              }
              if (preExistingErrors.length > 10) {
                report += `- ... and ${preExistingErrors.length - 10} more\n`
              }
              report += `\n`
              report += `💡 **These pre-existing errors are not your fault!**\n`
              report += `Would you like me to create a worktree to fix them? Just say "fix pre-existing errors".\n`
            }
            
            // 5. Final verdict
            report += `\n---\n\n`
            if (sessionErrors.length > 0) {
              report += `⚠️ **Action required:** Fix the ${sessionErrors.length} session error(s) before considering this session complete.\n`
            } else if (preExistingErrors.length > 0) {
              report += `✅ **Session successful!** Your changes introduced no new errors.\n`
              report += `The ${preExistingErrors.length} pre-existing error(s) can be fixed separately if desired.\n`
            }
            
            logEvent("info", "mad_final_check completed", { 
              checksRun, 
              sessionErrors: sessionErrors.length, 
              preExistingErrors: preExistingErrors.length 
            })
            
            return report
          } catch (e: any) {
            logEvent("error", "mad_final_check exception", { error: e.message, stack: e.stack })
            return getUpdateNotification() + `❌ Error running final check: ${e.message}`
          }
        },
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
          const { mode, focus, paths } = args
          const gitRoot = getGitRoot()
          
          let report = `# Codebase Analysis Report\n\n`
          report += `**Mode:** ${mode}\n`
          report += `**Date:** ${new Date().toISOString()}\n\n`
          
          // Collecter les informations de base
          const structure = runCommand('find . -type f -name "*.ts" -o -name "*.js" -o -name "*.json" | grep -v node_modules | head -50', gitRoot)
          const packageJsonPath = join(gitRoot, 'package.json')
          const packageJson = existsSync(packageJsonPath) 
            ? JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
            : null
          
          report += `## Project Structure\n\`\`\`\n${structure.output}\n\`\`\`\n\n`
          
          if (packageJson) {
            report += `## Dependencies\n`
            report += `- **Name:** ${packageJson.name}\n`
            report += `- **Version:** ${packageJson.version}\n`
            report += `- **Dependencies:** ${Object.keys(packageJson.dependencies || {}).length}\n`
            report += `- **DevDependencies:** ${Object.keys(packageJson.devDependencies || {}).length}\n\n`
          }
          
          if (mode === 'targeted' && focus) {
            report += `## Targeted Analysis: ${focus}\n`
            // Chercher les fichiers pertinents
            const relevantFiles = runCommand(`grep -rl "${focus}" --include="*.ts" --include="*.js" . | grep -v node_modules | head -20`, gitRoot)
            report += `### Relevant Files\n\`\`\`\n${relevantFiles.output || 'No files found'}\n\`\`\`\n`
          }
          
          logEvent("info", "Codebase analysis completed", { mode, focus })
          return getUpdateNotification() + report
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
          
          return getUpdateNotification() + `✅ Plan '${planName}' created with ${tasks.length} tasks.\n\n${plan}`
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
            return getUpdateNotification() + `❌ Worktree not found: ${worktreePath}`
          }
          
          // Créer le rapport de review
          let report = `# Code Review: ${worktree}\n\n`
          report += `**Verdict:** ${verdict === 'approved' ? '✅ APPROVED' : verdict === 'changes_requested' ? '⚠️ CHANGES REQUESTED' : '❌ REJECTED'}\n\n`
          report += `## Summary\n${summary}\n\n`
          
          if (positives && positives.length > 0) {
            report += `## Positives 👍\n`
            positives.forEach(p => report += `- ${p}\n`)
            report += '\n'
          }
          
          if (issues && issues.length > 0) {
            report += `## Issues Found\n`
            const critical = issues.filter(i => i.severity === 'critical')
            const major = issues.filter(i => i.severity === 'major')
            const minor = issues.filter(i => i.severity === 'minor')
            
            if (critical.length > 0) {
              report += `### 🚨 Critical (${critical.length})\n`
              critical.forEach(i => {
                report += `- **${i.file}${i.line ? `:${i.line}` : ''}** - ${i.message}\n`
                if (i.suggestion) report += `  → Suggestion: ${i.suggestion}\n`
              })
            }
            if (major.length > 0) {
              report += `### ⚠️ Major (${major.length})\n`
              major.forEach(i => {
                report += `- **${i.file}${i.line ? `:${i.line}` : ''}** - ${i.message}\n`
                if (i.suggestion) report += `  → Suggestion: ${i.suggestion}\n`
              })
            }
            if (minor.length > 0) {
              report += `### 💡 Minor (${minor.length})\n`
              minor.forEach(i => {
                report += `- **${i.file}${i.line ? `:${i.line}` : ''}** - ${i.message}\n`
              })
            }
          }
          
          // Sauvegarder le rapport dans le worktree
          writeFileSync(join(worktreePath, '.agent-review'), report)
          
          logEvent("info", "Code review submitted", { worktree, verdict, issueCount: issues?.length || 0 })
          
          return getUpdateNotification() + report
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
          
          let report = `# Security Scan Report: ${target}\n\n`
          report += `**Risk Level:** ${riskLevel === 'critical' ? '🚨 CRITICAL' : riskLevel === 'high' ? '🔴 HIGH' : riskLevel === 'medium' ? '🟡 MEDIUM' : '🟢 LOW'}\n`
          report += `**Date:** ${new Date().toISOString()}\n\n`
          report += `## Summary\n${summary}\n\n`
          
          if (vulnerabilities && vulnerabilities.length > 0) {
            report += `## Vulnerabilities (${vulnerabilities.length})\n\n`
            vulnerabilities.forEach(v => {
              const icon = v.severity === 'critical' ? '🚨' : v.severity === 'high' ? '🔴' : v.severity === 'medium' ? '🟡' : '🟢'
              report += `### ${icon} [${v.id}] ${v.type}\n`
              report += `**Severity:** ${v.severity.toUpperCase()}\n`
              if (v.file) report += `**Location:** ${v.file}${v.line ? `:${v.line}` : ''}\n`
              report += `**Description:** ${v.description}\n`
              report += `**Remediation:** ${v.remediation}\n\n`
            })
          }
          
          if (dependencyIssues && dependencyIssues.length > 0) {
            report += `## Vulnerable Dependencies (${dependencyIssues.length})\n\n`
            report += `| Package | Severity | CVE | Fix |\n`
            report += `|---------|----------|-----|-----|\n`
            dependencyIssues.forEach(d => {
              report += `| ${d.package} | ${d.severity} | ${d.cve || 'N/A'} | ${d.fix} |\n`
            })
            report += '\n'
          }
          
          // Verdict
          const canMerge = riskLevel === 'low' || (riskLevel === 'medium' && (!vulnerabilities || vulnerabilities.filter(v => v.severity === 'critical' || v.severity === 'high').length === 0))
          report += `## Verdict\n`
          report += canMerge 
            ? `✅ **PASS** - No critical security issues blocking merge.\n`
            : `❌ **FAIL** - Critical security issues must be resolved before merge.\n`
          
          // Sauvegarder si c'est un worktree
          if (target !== 'main') {
            const worktreePath = join(gitRoot, "worktrees", target)
            if (existsSync(worktreePath)) {
              writeFileSync(join(worktreePath, '.agent-security'), report)
            }
          }
          
          logEvent("info", "Security scan completed", { target, riskLevel, vulnCount: vulnerabilities?.length || 0 })
          
          return getUpdateNotification() + report
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
  }
}

// Default export for OpenCode plugin system
export default MADPlugin
