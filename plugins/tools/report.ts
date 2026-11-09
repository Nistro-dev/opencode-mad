import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"
import { tool } from "../lib/tool"
import { errorMessage } from "../lib/errors"
import type { PackageJson, PluginContext, ToolDefinition } from "../types/enitities"

export const reportTools = (ctx: PluginContext): Record<string, ToolDefinition> => ({

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
        await ctx.logEvent(args.level, args.message, args.context)
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
      const gitRoot = ctx.getGitRoot()

      const structure = ctx.runCommand(
        'find . -type f \\( -name "*.ts" -o -name "*.js" -o -name "*.json" \\) | grep -v node_modules | head -50',
        gitRoot,
      )
      const packageJsonPath = join(gitRoot, 'package.json')
      const pkg = existsSync(packageJsonPath)
        ? (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson)
        : null

      let info = `Files: ${structure.output.split('\n').length}`
      if (pkg) info += ` | Deps: ${Object.keys(pkg.dependencies || {}).length}`

      ctx.logEvent("info", "Codebase analysis completed", { mode, focus })
      return `OK Analyzed: ${info}`
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

      ctx.logEvent("info", "Development plan created", { planName, taskCount: tasks.length })

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
      const gitRoot = ctx.getGitRoot()
      const worktreePath = join(gitRoot, "worktrees", worktree)

      if (!existsSync(worktreePath)) {
        return `ERROR Not found: ${worktree}`
      }

      const issueCount = issues?.length || 0

      // Save report
      writeFileSync(join(worktreePath, '.agent-review'), `${verdict}: ${summary}`)

      ctx.logEvent("info", "Code review submitted", { worktree, verdict, issueCount })

      return `Review: ${verdict} (${issueCount} issues)`
    }
  }),
} as unknown as Record<string, ToolDefinition>)
