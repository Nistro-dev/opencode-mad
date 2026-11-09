import { tool } from "../lib/tool"
import { errorMessage } from "../lib/errors"
import { PACKAGE_NAME } from "../includes/constants"
import type { GitHubRun, PluginContext, ToolDefinition } from "../types/enitities"

export const ciTools = (ctx: PluginContext): Record<string, ToolDefinition> => ({

  /**
   * Check for plugin updates
   */
  check_update: tool({
    description: `Check if a newer version of ${PACKAGE_NAME} is available on npm.
Returns the current version, latest version, and whether an update is available.`,
    args: {},
    async execute() {
      try {
        const updateInfo = await ctx.checkForUpdates()
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
        const gitRoot = ctx.getGitRoot()

        const remoteResult = ctx.runCommand("git remote get-url origin", gitRoot)
        if (!remoteResult.success) {
          return "WARN No remote configured"
        }

        const branch = ctx.getCurrentBranch()
        const upstreamResult = ctx.runCommand(`git rev-parse --abbrev-ref ${branch}@{upstream}`, gitRoot)
        const pushCmd = upstreamResult.success ? "git push" : `git push -u origin ${branch}`

        const pushResult = ctx.runCommand(pushCmd, gitRoot)
        if (!pushResult.success) {
          return `ERROR Push failed: ${pushResult.error?.slice(0, 100)}`
        }

        const ghCheck = ctx.runCommand("gh --version", gitRoot)
        if (!ghCheck.success) {
          return "OK Pushed (no gh CLI for CI)"
        }

        const runsResult = ctx.runCommand(
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

        const watchResult = ctx.runCommand(`gh run watch ${run.databaseId} --exit-status`, gitRoot)
        return watchResult.success ? "OK Pushed, CI passed" : `ERROR CI failed: ${run.name}`
      } catch (error: unknown) {
        ctx.logEvent("error", "push_and_watch exception", { error: errorMessage(error) })
        return `ERROR ${errorMessage(error)}`
      }
    }
  }),
} as unknown as Record<string, ToolDefinition>)
