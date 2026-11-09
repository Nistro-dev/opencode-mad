/**
 * Public entry point for `@fiandev/opencode-kit`.
 *
 * Re-exports the testable hook factory and the OpenCode V2 plugin definition.
 * Implementation lives in `hooks.ts` and `plugin.ts`; this file is a barrel only.
 */
export { createPluginHooks } from "./includes/hooks"
export { MultiAgentDevPlugin } from "./lib/plugin"
export { MultiAgentDevPlugin as default } from "./lib/plugin"
