import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { tool } from "../lib/tool"
import { errorMessage } from "../lib/errors"
import type { PackageJson, PluginContext, ToolDefinition } from "../types/enitities"

export const qualityTools = (ctx: PluginContext): Record<string, ToolDefinition> => ({

  /**
   * Run tests on a worktree
   */
  test: tool({
    description: `Run tests/build/lint on a worktree to verify the code is working.
Automatically detects the project type (Node.js, Python, Go, Rust) and runs appropriate checks.
Returns the results and creates an error file if tests fail.`,
    args: {
      worktree: tool.schema.string().describe("Worktree session name (e.g., 'feat-auth-login')"),
    },
    async execute(args) {
      const gitRoot = ctx.getGitRoot()
      const worktreePath = join(gitRoot, "worktrees", args.worktree)

      if (!existsSync(worktreePath)) {
        return `ERROR Not found: ${args.worktree}`
      }

      let passed: string[] = []
      let failed: string[] = []
      let errorMessages = ""

      const doCheck = (label: string, cmd: string) => {
        const result = ctx.runCommand(cmd, worktreePath)
        if (result.success) {
          passed.push(label)
        } else {
          failed.push(label)
          errorMessages += `${label}: ${result.error?.slice(0, 200)}\n`
        }
      }

      const packageJson = join(worktreePath, "package.json")
      const goMod = join(worktreePath, "go.mod")
      const cargoToml = join(worktreePath, "Cargo.toml")
      const pyProject = join(worktreePath, "pyproject.toml")
      const requirements = join(worktreePath, "requirements.txt")

      if (existsSync(packageJson)) {
        const pkg = JSON.parse(readFileSync(packageJson, "utf-8")) as PackageJson
        if (pkg.scripts?.lint) doCheck("lint", "npm run lint")
        if (pkg.scripts?.build) doCheck("build", "npm run build")
        if (pkg.scripts?.test) doCheck("test", "npm test")
      }
      if (existsSync(goMod)) {
        doCheck("go-build", "go build ./...")
        doCheck("go-test", "go test ./...")
      }
      if (existsSync(cargoToml)) {
        doCheck("cargo-check", "cargo check")
        doCheck("cargo-test", "cargo test")
      }
      if (existsSync(pyProject) || existsSync(requirements)) {
        doCheck("pytest", "pytest")
      }

      if (failed.length > 0) {
        writeFileSync(join(worktreePath, ".agent-error"), errorMessages)
        const doneFile = join(worktreePath, ".agent-done")
        if (existsSync(doneFile)) unlinkSync(doneFile)
        return `ERROR Failed: ${failed.join(", ")}${passed.length ? ` | OK ${passed.join(", ")}` : ""}`
      }
      if (passed.length === 0) return "WARN No checks found"
      return `OK All passed: ${passed.join(", ")}`
    },
  }),

  /**
   * Final check - run global build/lint and categorize errors
   */
  final_check: tool({
    description: `Run global build/lint checks on the main project after all merges.
Compares errors against files modified during the session.`,
    args: {
      baseCommit: tool.schema.string().optional().describe("The commit SHA from before the session started."),
    },
    async execute(args) {
      try {
        const gitRoot = ctx.getGitRoot()

        let baseCommit = args.baseCommit
        if (!baseCommit) {
          const reflogResult = ctx.runCommand('git reflog --format="%H %gs" -n 50', gitRoot)
          if (reflogResult.success) {
            const lines = reflogResult.output.split('\n')
            for (const line of lines) {
              if (!line.includes('merge') || (!line.includes('feat-') && !line.includes('fix-'))) {
                baseCommit = line.split(' ')[0]
                break
              }
            }
          }
          if (!baseCommit) baseCommit = 'HEAD~10'
        }

        const diffResult = ctx.runCommand(`git diff ${baseCommit}..HEAD --name-only`, gitRoot)
        const modifiedFiles = diffResult.success
          ? diffResult.output.split('\n').filter(f => f.trim()).map(f => f.trim())
          : []

        const packageJson = join(gitRoot, "package.json")
        const goMod = join(gitRoot, "go.mod")
        const cargoToml = join(gitRoot, "Cargo.toml")
        const pyProject = join(gitRoot, "pyproject.toml")

        let passed: string[] = []
        let failed: string[] = []
        let sessionErrors = 0
        let preExistingErrors = 0

        const runCheck = (name: string, cmd: string) => {
          const result = ctx.runCommand(`${cmd} 2>&1`, gitRoot)
          if (result.success) {
            passed.push(name)
          } else {
            failed.push(name)
            // Count errors in modified files vs pre-existing
            const output = result.error || result.output
            const lines = output.split('\n')
            for (const line of lines) {
              const match = line.match(/^(.+?):(\d+)/)
              const file = match?.[1]?.replace(/\\/g, "/")
              if (file) {
                if (modifiedFiles.some(mf => file.includes(mf) || mf.includes(file))) {
                  sessionErrors++
                } else {
                  preExistingErrors++
                }
              }
            }
          }
        }

        if (existsSync(packageJson)) {
          const pkg = JSON.parse(readFileSync(packageJson, "utf-8")) as PackageJson
          if (pkg.scripts?.lint) runCheck("lint", "npm run lint")
          if (pkg.scripts?.build) runCheck("build", "npm run build")
          if (pkg.scripts?.typecheck) runCheck("typecheck", "npm run typecheck")
        }
        if (existsSync(goMod)) {
          runCheck("go-build", "go build ./...")
          runCheck("go-vet", "go vet ./...")
        }
        if (existsSync(cargoToml)) {
          runCheck("cargo", "cargo check")
        }
        if (existsSync(pyProject)) {
          runCheck("ruff", "ruff check .")
        }

        if (passed.length === 0 && failed.length === 0) {
          return "WARN No checks found"
        }

        if (failed.length === 0) {
          return `OK All passed: ${passed.join(", ")}`
        }

        let result = `ERROR Failed: ${failed.join(", ")}`
        if (passed.length) result += ` | OK ${passed.join(", ")}`
        if (sessionErrors) result += ` | Session errors: ${sessionErrors}`
        if (preExistingErrors) result += ` | Pre-existing: ${preExistingErrors}`
        return result
      } catch (error: unknown) {
        ctx.logEvent("error", "final_check exception", { error: errorMessage(error) })
        return `ERROR ${errorMessage(error)}`
      }
    },
  }),
} as unknown as Record<string, ToolDefinition>)
