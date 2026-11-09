import { createPluginContext } from "../lib/context"
import { createToolBeforeGuard } from "../lib/guard"
import { FALLBACK_MODEL } from "./constants"
import { worktreeTools } from "../tools/worktree"
import { qualityTools } from "../tools/quality"
import { reportTools } from "../tools/report"
import { ciTools } from "../tools/ci"
import { agentsTools } from "../tools/agents"
import { securityTools } from "../tools/security"
import type { ToolDefinition } from "../types/enitities"

export const createPluginHooks = async ({ directory, log }: { directory: string; log?: (message: string) => void }) => {
  const ctx = createPluginContext({ directory, log })

  return {
    // Custom tools for the workflow
    tool: {
      ...worktreeTools(ctx),
      ...qualityTools(ctx),
      ...reportTools(ctx),
      ...ciTools(ctx),
      ...agentsTools(ctx),
      ...securityTools(ctx),
    } as unknown as Record<string, ToolDefinition>,

    // Event hooks
    event: async ({ event }: { event: { type: string } }) => {
      // Log orchestration events for debugging
      if (event.type === "session.idle") {
        ctx.log("Session idle")
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
    "tool.execute.before": createToolBeforeGuard(ctx),
  }
}
