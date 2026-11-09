import { appendFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { PACKAGE_NAME, CURRENT_VERSION } from "../includes/constants"
import { errorOutput } from "./errors"
import type { CommandResult, PluginContext } from "../types/enitities"

export const createPluginContext = ({ directory, log }: { directory: string; log?: (message: string) => void }): PluginContext => {
  const normalizedLog = log ?? (() => {})

  // Use the directory provided by OpenCode, fallback to process.cwd() for backwards compatibility
  const baseDirectory = directory || process.cwd()

  /**
   * Helper to run shell commands with proper error handling (cross-platform)
   */
  const runCommand = (cmd: string, cwd?: string): CommandResult => {
    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        cwd: cwd || baseDirectory,
        stdio: ["pipe", "pipe", "pipe"]
      })
      return { success: true, output: output.trim() }
    } catch (error: unknown) {
      return { success: false, output: "", error: errorOutput(error) }
    }
  }

  /**
   * Helper to get git root with error handling
   * @param basePath - Optional base path to start from (defaults to baseDirectory)
   */
  const getGitRoot = (basePath?: string): string => {
    const result = runCommand("git rev-parse --show-toplevel", basePath || baseDirectory)
    if (!result.success) {
      throw new Error(`Not a git repository or git not found: ${result.error}`)
    }
    return result.output.replace(/\\/g, "/")
  }

  /**
   * Helper to get current branch with fallback
   * @param basePath - Optional base path to run git command from (defaults to baseDirectory)
   */
  const getCurrentBranch = (basePath?: string): string => {
    const result = runCommand("git symbolic-ref --short HEAD", basePath || baseDirectory)
    return result.success ? result.output : "main"
  }

  /**
   * Helper to log orchestration events
   * Uses baseDirectory to find the git root for log file location
   */
  const logEvent = (level: "info" | "warn" | "error" | "debug", message: string, context?: unknown) => {
    try {
      const gitRoot = getGitRoot(baseDirectory)
      const logFile = join(gitRoot, ".agent-logs.jsonl")
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        context
      }) + "\n"

      appendFileSync(logFile, logEntry)
    } catch (error: unknown) {
      // Silent fail for logging - don't break the workflow
      console.error("Failed to write log:", error)
    }
  }

  /**
   * Check for updates from npm registry
   */
  const checkForUpdates = async (): Promise<{ hasUpdate: boolean; current: string; latest: string }> => {
    try {
      const result = runCommand(`npm view ${PACKAGE_NAME} version`)
      if (result.success) {
        const latestVersion = result.output.trim()
        return {
          hasUpdate: latestVersion !== CURRENT_VERSION,
          current: CURRENT_VERSION,
          latest: latestVersion
        }
      }
    } catch {
      // Silent fail - don't break startup if npm check fails
    }
    return { hasUpdate: false, current: CURRENT_VERSION, latest: CURRENT_VERSION }
  }

  return {
    baseDirectory,
    log: normalizedLog,
    runCommand,
    getGitRoot,
    getCurrentBranch,
    logEvent,
    checkForUpdates,
  }
}
