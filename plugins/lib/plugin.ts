import { Plugin } from "@opencode/plugin"
import { z } from "zod"
import { createPluginHooks } from "../includes/hooks"

/**
 * OpenCode V2 plugin definition.
 *
 * V2 loads plugins through `Plugin.define({ id, setup })`. Setup registers the
 * workflow tools, the tool guard hook, the fallback request hook, and the event
 * subscription. The implementation lives in `createPluginHooks` so it can be
 * exercised without a running server.
 */
export const MultiAgentDevPlugin = Plugin.define({
  id: "fiandev.opencode-kit",
  async setup(ctx) {
    const hooks = await createPluginHooks({
      directory: ctx.location.directory,
      log: (message) => console.debug(`[opencode-kit] ${message}`),
    })

    const tools = Object.entries(hooks.tool).map(([name, definition]) => ({
      name,
      definition,
      input: z.toJSONSchema(z.object(definition.args), { io: "input" }),
    }))

    await ctx.tool.transform((editor) => {
      for (const { name, definition, input } of tools) {
        editor.add({
          name,
          description: definition.description,
          input,
          async execute(args) {
            return { content: await definition.execute(args as never, {} as never) }
          },
        })
      }
    })

    const before = hooks["tool.execute.before"]
    if (before) {
      await ctx.tool.hook("execute.before", async (event) => {
        const args = (event.input && typeof event.input === "object" ? event.input : {}) as Record<string, unknown>
        await before(
          { tool: event.tool, sessionID: event.sessionID, callID: event.id },
          { args },
        )
        if (event.input !== args) event.input = args
      })
    }

    const chatParams = hooks["chat.params"]
    if (chatParams) {
      await ctx.session.hook(
        "context",
        (event) => chatParams({ model: event.model }, event),
        { providerID: "opencode-go" },
      )
    }

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          await hooks.event?.({ event })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("opencode-kit: event subscription failed", error)
        }
      }
    })()

    return () => controller.abort()
  },
})
