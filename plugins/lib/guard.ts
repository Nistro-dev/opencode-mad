import { basename } from "path"
import { getAgentPermissions } from "./registry"
import { matchGlob } from "./glob"
import { firstString } from "./util"
import type { PluginContext, ToolBeforeInput, ToolBeforeOutput, ToolExecuteArgs } from "../types/enitities"

export const DANGEROUS_BASH_PATTERNS = [
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

export const createToolBeforeGuard = (ctx: PluginContext): ((input: ToolBeforeInput, output: ToolBeforeOutput) => Promise<void>) => {
  return async (input: ToolBeforeInput, output: ToolBeforeOutput) => {
    const perms = getAgentPermissions(input.sessionID)

    // If no permissions registered, let it pass (backwards compatibility)
    if (!perms) return

    const toolName = input.tool
    const args = (output.args ?? {}) as ToolExecuteArgs

    // 1. Block edit/write/patch for read-only agents
    if (['edit', 'write', 'patch', 'multiedit'].includes(toolName)) {
      if (!perms.canEdit) {
        ctx.logEvent("warn", `BLOCKED: ${perms.type} tried to use ${toolName}`, { sessionID: input.sessionID })
        throw new Error(`BLOCKED ${perms.type} is read-only`)
      }

      // 2. Check path if allowedPaths is defined
      const targetPath = firstString(args.filePath, args.file_path, args.path)
      if (targetPath) {
        if (perms.deniedPaths.some((denied) => targetPath.includes(denied) || matchGlob(targetPath, denied))) {
          ctx.logEvent("warn", `BLOCKED: ${perms.type} tried to edit denied path`, { sessionID: input.sessionID, path: targetPath })
          throw new Error(`BLOCKED Path denied: ${basename(targetPath)}`)
        }

        if (perms.allowedPaths && perms.allowedPaths.length > 0) {
          const isAllowed = perms.allowedPaths.some(
            (allowed) => targetPath.includes(allowed) || matchGlob(targetPath, allowed),
          )
          if (!isAllowed) {
            ctx.logEvent("warn", `BLOCKED: ${perms.type} tried to edit outside allowed paths`, { sessionID: input.sessionID, path: targetPath })
            throw new Error(`BLOCKED Outside allowed paths: ${basename(targetPath)}`)
          }
        }
      }
    }

    // 3. For bash, check if trying to modify files
    if (toolName === "bash" && !perms.canEdit) {
      const cmd = typeof args.command === "string" ? args.command : ""

      for (const pattern of DANGEROUS_BASH_PATTERNS) {
        if (pattern.test(cmd)) {
          ctx.logEvent("warn", `BLOCKED: ${perms.type} tried dangerous bash command`, { sessionID: input.sessionID })
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
  }
}
