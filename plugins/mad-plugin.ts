import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join, basename } from "path"

/**
 * MAD - Multi-Agent Dev Plugin for OpenCode
 * 
 * Enables parallel development through git worktrees and the native Task tool.
 * The orchestrator agent decomposes tasks and delegates to developer subagents
 * running in parallel via OpenCode's Task tool.
 */
export const MADPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  
  // Helper to get git root
  const getGitRoot = async (): Promise<string> => {
    const result = await $`git rev-parse --show-toplevel`.text()
    return result.trim()
  }

  // Helper to get current branch
  const getCurrentBranch = async (): Promise<string> => {
    const result = await $`git symbolic-ref --short HEAD 2>/dev/null || echo main`.text()
    return result.trim()
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
          const { branch, task } = args
          const gitRoot = await getGitRoot()
          const baseBranch = await getCurrentBranch()
          const sessionName = branch.replace(/\//g, "-")
          const worktreeDir = join(gitRoot, "worktrees")
          const worktreePath = join(worktreeDir, sessionName)

          // Check if worktree already exists
          if (existsSync(worktreePath)) {
            return `Worktree already exists at ${worktreePath}. Use a different branch name or clean up with mad_worktree_cleanup.`
          }

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

# Worktrees directory
worktrees/
`
            await $`echo ${additions} >> ${gitignorePath}`
            await $`git add ${gitignorePath} && git commit -m "chore: add MAD agent files to gitignore" 2>/dev/null || true`
          }

          // Create worktree directory
          await $`mkdir -p ${worktreeDir}`

          // Check if branch exists, create worktree accordingly
          const branchExists = await $`git rev-parse --verify ${branch} 2>/dev/null`.exitCode === 0
          
          if (branchExists) {
            await $`git worktree add ${worktreePath} ${branch}`
          } else {
            await $`git worktree add -b ${branch} ${worktreePath} ${baseBranch}`
          }

          // Write task file
          const taskContent = `# Agent Task
# Branch: ${branch}
# Created: ${new Date().toISOString()}
# Base: ${baseBranch}

${task}
`
          await $`echo ${taskContent} > ${join(worktreePath, ".agent-task")}`

          return `Worktree created successfully!
- Path: ${worktreePath}
- Branch: ${branch}
- Base: ${baseBranch}
- Task: ${task}

The developer subagent can now work in this worktree using the Task tool.`
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
          const gitRoot = await getGitRoot()
          const worktreeDir = join(gitRoot, "worktrees")

          if (!existsSync(worktreeDir)) {
            return "No active MAD worktrees. Use mad_worktree_create to create one."
          }

          const entries = readdirSync(worktreeDir)
          if (entries.length === 0) {
            return "No active MAD worktrees. Use mad_worktree_create to create one."
          }

          let status = "# MAD Status Dashboard\n\n"
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
            const branch = entry.replace(/-/g, "/")
            let commits = "0"
            try {
              const baseBranch = await getCurrentBranch()
              const result = await $`git -C ${wpath} log --oneline ${baseBranch}..HEAD 2>/dev/null | wc -l`.text()
              commits = result.trim()
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
          const gitRoot = await getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)

          if (!existsSync(worktreePath)) {
            return `Worktree not found: ${worktreePath}`
          }

          let results = `# Test Results for ${args.worktree}\n\n`
          let hasError = false
          let errors = ""

          // Helper to run a check
          const runCheck = async (label: string, cmd: string) => {
            results += `## ${label}\n`
            try {
              const output = await $`cd ${worktreePath} && ${cmd}`.text()
              results += `✅ Passed\n\`\`\`\n${output.slice(0, 500)}\n\`\`\`\n\n`
            } catch (e: any) {
              hasError = true
              const output = e.stderr || e.message || "Unknown error"
              results += `❌ Failed\n\`\`\`\n${output.slice(0, 1000)}\n\`\`\`\n\n`
              errors += `${label} FAILED:\n${output}\n\n`
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
            if (pkg.scripts?.lint) await runCheck("Lint", "npm run lint")
            if (pkg.scripts?.build) await runCheck("Build", "npm run build")
            if (pkg.scripts?.test) await runCheck("Test", "npm test")
          }

          if (existsSync(goMod)) {
            await runCheck("Go Build", "go build ./...")
            await runCheck("Go Test", "go test ./...")
          }

          if (existsSync(cargoToml)) {
            await runCheck("Cargo Check", "cargo check")
            await runCheck("Cargo Test", "cargo test")
          }

          if (existsSync(pyProject) || existsSync(requirements)) {
            await runCheck("Pytest", "pytest")
          }

          // Write error file if tests failed
          if (hasError) {
            await $`echo ${errors} > ${join(worktreePath, ".agent-error")}`
            // Remove .agent-done since code is broken
            await $`rm -f ${join(worktreePath, ".agent-done")}`
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
          const gitRoot = await getGitRoot()
          const worktreePath = join(gitRoot, "worktrees", args.worktree)
          const doneFile = join(worktreePath, ".agent-done")
          const branch = args.worktree.replace(/-/g, "/")

          if (!existsSync(worktreePath)) {
            return `Worktree not found: ${worktreePath}`
          }

          if (!existsSync(doneFile)) {
            return `Cannot merge: worktree ${args.worktree} is not marked as done. Complete the task first.`
          }

          try {
            // Merge the branch
            const result = await $`git merge ${branch} --no-edit`.text()
            return `✅ Successfully merged ${branch}!\n\n${result}`
          } catch (e: any) {
            const output = e.stderr || e.message || "Unknown error"
            if (output.includes("CONFLICT")) {
              return `⚠️ Merge conflict detected!\n\n${output}\n\nResolve conflicts manually or use the fixer agent.`
            }
            return `❌ Merge failed:\n${output}`
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
            return `Worktree not found: ${worktreePath}`
          }

          if (!args.force && !existsSync(doneFile)) {
            return `Worktree ${args.worktree} is not marked as done. Use force=true to cleanup anyway.`
          }

          try {
            await $`git worktree remove ${worktreePath} --force`
            await $`git worktree prune`
            return `✅ Cleaned up worktree: ${args.worktree}`
          } catch (e: any) {
            return `❌ Cleanup failed: ${e.message}`
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
            return `Worktree not found: ${worktreePath}`
          }

          await $`echo ${args.summary} > ${join(worktreePath, ".agent-done")}`
          // Remove error/blocked files
          await $`rm -f ${join(worktreePath, ".agent-error")} ${join(worktreePath, ".agent-blocked")}`

          return `✅ Marked ${args.worktree} as done: ${args.summary}`
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
            return `Worktree not found: ${worktreePath}`
          }

          await $`echo ${args.reason} > ${join(worktreePath, ".agent-blocked")}`

          return `🚫 Marked ${args.worktree} as blocked: ${args.reason}`
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
            return `Task file not found: ${taskFile}`
          }

          return readFileSync(taskFile, "utf-8")
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
