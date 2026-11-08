import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from "fs"
import { join } from "path"
import { tool } from "../lib/tool"
import { readWorktreeBranch } from "../lib/util"
import { errorMessage } from "../lib/errors"
import type { PluginContext, ToolDefinition } from "../types"

export const worktreeTools = (ctx: PluginContext): Record<string, ToolDefinition> => ({

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
          ctx.logEvent("error", "worktree_create failed: empty branch name")
          return "ERROR Branch name required"
        }

        if (!task || task.trim() === "") {
          ctx.logEvent("error", "worktree_create failed: empty task description")
          return "ERROR Task description required"
        }

        const gitRoot = ctx.getGitRoot()
        const baseBranch = ctx.getCurrentBranch()
        const sessionName = branch.replace(/\//g, "-")
        const worktreeDir = join(gitRoot, "worktrees")
        const worktreePath = join(worktreeDir, sessionName)

        // Check if worktree already exists
        if (existsSync(worktreePath)) {
          ctx.logEvent("warn", "Worktree already exists", { branch, path: worktreePath })
          return `WARN Worktree exists: ${sessionName}`
        }

        ctx.logEvent("info", "Creating worktree", { branch, baseBranch })

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
          ctx.runCommand(`git add "${gitignorePath}" && git commit -m "chore: add agent files to gitignore"`, gitRoot)
        }

        // Create worktree directory using Node.js
        try {
          mkdirSync(worktreeDir, { recursive: true })
        } catch (error: unknown) {
          ctx.logEvent("error", "Failed to create worktree directory", { error: errorMessage(error) })
          return `ERROR mkdir failed: ${errorMessage(error)}`
        }

        // Check if branch exists
        const branchCheckResult = ctx.runCommand(`git rev-parse --verify ${branch}`)
        const branchExists = branchCheckResult.success

        // Create worktree
        const worktreeCmd = branchExists
          ? `git worktree add "${worktreePath}" ${branch}`
          : `git worktree add -b ${branch} "${worktreePath}" ${baseBranch}`

        const worktreeResult = ctx.runCommand(worktreeCmd, gitRoot)
        if (!worktreeResult.success) {
          ctx.logEvent("error", "Failed to create git worktree", {
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
          ctx.logEvent("warn", "Failed to write task file", { error: errorMessage(error) })
        }

        ctx.logEvent("info", "Worktree created successfully", { branch, path: worktreePath })

        return `OK Worktree: ${sessionName} (${branch})`
      } catch (error: unknown) {
        ctx.logEvent("error", "worktree_create exception", {
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
      const gitRoot = ctx.getGitRoot()
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
      const gitRoot = ctx.getGitRoot()
      const worktreePath = join(gitRoot, "worktrees", args.worktree)
      const doneFile = join(worktreePath, ".agent-done")

      if (!existsSync(worktreePath)) {
        return `ERROR Not found: ${args.worktree}`
      }

      if (!existsSync(doneFile)) {
        return `ERROR Not done: ${args.worktree}`
      }

      const branch = readWorktreeBranch(worktreePath) ?? args.worktree
      const result = ctx.runCommand(`git merge --no-ff "${branch}" --no-edit`, gitRoot)
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
      const gitRoot = ctx.getGitRoot()
      const worktreePath = join(gitRoot, "worktrees", args.worktree)
      const doneFile = join(worktreePath, ".agent-done")

      if (!existsSync(worktreePath)) {
        return `ERROR Not found: ${args.worktree}`
      }

      if (!args.force && !existsSync(doneFile)) {
        return `ERROR Not done (use force=true)`
      }

      const removeResult = ctx.runCommand(`git worktree remove "${worktreePath}" --force`, gitRoot)
      if (!removeResult.success) {
        return `ERROR ${removeResult.error}`
      }
      ctx.runCommand("git worktree prune", gitRoot)
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
      const gitRoot = ctx.getGitRoot()
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
      const gitRoot = ctx.getGitRoot()
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
      const gitRoot = ctx.getGitRoot()
      const taskFile = join(gitRoot, "worktrees", args.worktree, ".agent-task")

      if (!existsSync(taskFile)) {
        return `ERROR No task: ${args.worktree}`
      }

      return readFileSync(taskFile, "utf-8")
    },
  }),
} as unknown as Record<string, ToolDefinition>)
