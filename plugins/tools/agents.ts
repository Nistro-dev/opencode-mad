import { tool } from "../lib/tool"
import { READ_ONLY_AGENTS } from "../includes/constants"
import { setAgentPermissions, deleteAgentPermissions, hasAgentPermissions } from "../lib/registry"
import type { AgentPermissions, PluginContext, ToolDefinition } from "../types/enitities"

export const agentsTools = (ctx: PluginContext): Record<string, ToolDefinition> => ({

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

      setAgentPermissions(sessionID, permissions)

      ctx.logEvent("info", `Registered agent permissions`, { sessionID, agentType, canEdit, worktree })

      return `OK Registered: ${agentType}`
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
      const existed = hasAgentPermissions(args.sessionID)
      deleteAgentPermissions(args.sessionID)
      ctx.logEvent("info", `Unregistered agent`, { sessionID: args.sessionID })
      return existed ? `OK Unregistered` : `WARN Not found`
    }
  }),
} as unknown as Record<string, ToolDefinition>)
