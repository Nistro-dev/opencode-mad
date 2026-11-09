import { z } from "zod"

/** A tool definition kept in the internal, Zod-based shape used by the plugin. */
export interface ToolDefinition<Args extends z.ZodRawShape = z.ZodRawShape> {
  description: string
  args: Args
  execute: (args: z.infer<z.ZodObject<Args>>, context: unknown) => Promise<string>
}

// Types for agent permissions (constraint enforcement)
export type AgentType =
  | "orchestrator"
  | "analyst"
  | "architect"
  | "developer"
  | "tester"
  | "reviewer"
  | "fixer"
  | "merger"
  | "security"
  | "pentester"
  | "typescript-engineer"
  | "pr"
  | "pr-reviewer"
  | "pr-resolver"
  | "conflict-resolver"
  | "version-analyzer"
  | "version-updater"

export interface AgentPermissions {
  type: AgentType
  canEdit: boolean
  canWrite: boolean
  canPatch: boolean
  allowedPaths: string[] | null  // null = all, [] = none, [...] = specific list
  deniedPaths: string[]          // Explicitly denied paths
  worktree: string | null // Worktree path if applicable
}

export interface CommandResult {
  success: boolean
  output: string
  error?: string
}

export interface PackageJson {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
}

export interface GitHubRun {
  databaseId: number
  status: string
  conclusion: string | null
  name: string
}

export interface ToolExecuteArgs {
  filePath?: unknown
  file_path?: unknown
  path?: unknown
  command?: unknown
}

export interface ToolBeforeInput {
  tool: string
  sessionID: string
  callID: string
}

export interface ToolBeforeOutput {
  args: Record<string, unknown>
}

export interface PluginContext {
  baseDirectory: string
  log: (message: string) => void
  runCommand: (cmd: string, cwd?: string) => CommandResult
  getGitRoot: (basePath?: string) => string
  getCurrentBranch: (basePath?: string) => string
  logEvent: (level: "info" | "warn" | "error" | "debug", message: string, context?: unknown) => void
  checkForUpdates: () => Promise<{ hasUpdate: boolean; current: string; latest: string }>
}

export type ToolFactory = (ctx: PluginContext) => Record<string, ToolDefinition>
