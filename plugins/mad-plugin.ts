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
const CURRENT_VERSION = "0.3.1"

// Update notification state (shown only once per session)
let updateNotificationShown = false
let pendingUpdateMessage: string | null = null

export const MADPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  
  /**
   * Helper to run shell commands with proper error handling (cross-platform)
   */
  const runCommand = (cmd: string, cwd?: string): { success: boolean; output: string; error?: string } => {
    try {
      const output = execSync(cmd, { 
        encoding: "utf-8", 
        cwd: cwd || process.cwd(),
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
   */
  const getGitRoot = (): string => {
    const result = runCommand("git rev-parse --show-toplevel")
    if (!result.success) {
      throw new Error(`Not a git repository or git not found: ${result.error}`)
    }
    return result.output.replace(/\\/g, "/")
  }

  /**
   * Helper to get current branch with fallback
   */
  const getCurrentBranch = (): string => {
    const result = runCommand("git symbolic-ref --short HEAD")
    return result.success ? result.output : "main"
  }

  /**
   * Helper to log MAD events
   */
  const logEvent = (level: "info" | "warn" | "error" | "debug", message: string, context?: any) => {
    try {
      const gitRoot = getGitRoot()
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
          const branch = args.worktree.replace(/-/g, "/")

          if (!existsSync(worktreePath)) {
            return getUpdateNotification() + `Worktree not found: ${worktreePath}`
          }

          if (!existsSync(doneFile)) {
            return getUpdateNotification() + `Cannot merge: worktree ${args.worktree} is not marked as done. Complete the task first.`
          }

          const result = runCommand(`git merge ${branch} --no-edit`, gitRoot)
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
