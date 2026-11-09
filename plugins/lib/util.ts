import { readFileSync, existsSync } from "fs"
import { join } from "path"

/** Read the branch name recorded in a worktree's .agent-task file. */
export function readWorktreeBranch(worktreePath: string): string | undefined {
  const taskFile = join(worktreePath, ".agent-task")
  if (!existsSync(taskFile)) return undefined
  const match = readFileSync(taskFile, "utf-8").match(/^# Branch:\s*(.+)$/m)
  return match?.[1]?.trim()
}

/** Return the first non-empty string among the given values. */
export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}
