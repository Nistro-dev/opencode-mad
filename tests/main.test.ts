import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import MultiAgentDevPlugin, { MultiAgentDevPlugin as NamedExport } from "../plugins/main"

type Hooks = Awaited<ReturnType<typeof MultiAgentDevPlugin>>
type Tool = NonNullable<Hooks["tool"]>[string]

/** Loosely-typed view of a tool so tests can call execute without Zod inference. */
interface LooseTool {
  description: string
  execute: (args: any, context?: any) => Promise<any>
}

interface Harness {
  dir: string
  hooks: Hooks
  logs: Array<{ body?: Record<string, unknown> }>
}

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length > 0) {
    rmSync(cleanups.pop()!, { recursive: true, force: true })
  }
})

/** Quote a value the way Bun's `$` shell would, so the mock behaves like the real tag. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Minimal BunShell stand-in that runs the interpolated command through execSync. */
function shellMock(cwd: string) {
  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce(
      (acc, part, i) => acc + part + (i < values.length ? quote(String(values[i])) : ""),
      "",
    )
    return Promise.resolve(
      execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }),
    )
  }
}

async function setupRepo(options: { packageJson?: Record<string, unknown>; gitignore?: string } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "opencode-kit-test-"))
  cleanups.push(dir)

  execSync("git init -q -b master", { cwd: dir })
  execSync("git config user.email test@example.com && git config user.name Test", { cwd: dir })
  writeFileSync(join(dir, "README.md"), "# fixture\n")
  if (options.gitignore) writeFileSync(join(dir, ".gitignore"), options.gitignore)
  if (options.packageJson) {
    writeFileSync(join(dir, "package.json"), JSON.stringify(options.packageJson, null, 2))
  }
  execSync("git add -A && git commit -qm init", { cwd: dir })

  const logs: Harness["logs"] = []
  const client = {
    app: {
      log: async (entry: Harness["logs"][number]) => {
        logs.push(entry)
      },
    },
  }
  const hooks = await MultiAgentDevPlugin({ client, $: shellMock(dir), directory: dir } as never)
  return { dir, hooks, logs }
}

function getTool(hooks: Hooks, name: string): LooseTool {
  const found = hooks.tool?.[name]
  assert.ok(found, `expected tool "${name}" to be registered`)
  return found as unknown as LooseTool
}

async function register(hooks: Hooks, args: Record<string, unknown>): Promise<void> {
  await getTool(hooks, "register_agent").execute(args, {})
}

async function before(hooks: Hooks, tool: string, sessionID: string, args: Record<string, unknown>) {
  const hook = hooks["tool.execute.before"]
  assert.ok(hook, "expected tool.execute.before hook")
  await hook({ tool, sessionID, callID: "call-1" }, { args })
  return args
}

async function createWorktree(hooks: Hooks, branch: string, task = "do the thing"): Promise<void> {
  const result = await getTool(hooks, "worktree_create").execute({ branch, task }, {})
  assert.match(result, /OK Worktree:/)
}

describe("plugin registration", () => {
  test("exports the plugin as both named and default export", () => {
    assert.equal(MultiAgentDevPlugin, NamedExport)
  })

  test("registers every workflow tool", async () => {
    const { hooks } = await setupRepo()
    const expected = [
      "worktree_create",
      "status",
      "test",
      "merge",
      "cleanup",
      "done",
      "blocked",
      "read_task",
      "log",
      "visualize",
      "check_update",
      "push_and_watch",
      "final_check",
      "register_agent",
      "unregister_agent",
      "analyze",
      "create_plan",
      "review",
      "pentest_check_tools",
      "pentest_scan",
      "security_scan",
    ]

    for (const name of expected) {
      const registered = hooks.tool?.[name]
      assert.ok(registered, `missing tool: ${name}`)
      assert.equal(typeof registered.execute, "function")
      assert.ok(registered.description.length > 0)
    }
  })

  test("logs session idle events", async () => {
    const { hooks, logs } = await setupRepo()
    await hooks.event!({ event: { type: "session.idle" } as never })

    assert.equal(logs.length, 1)
    assert.equal(logs[0].body?.service, "opencode-kit")
    assert.equal(logs[0].body?.message, "Session idle")
  })
})

describe("agent permission enforcement", () => {
  test("lets unregistered sessions pass through", async () => {
    const { hooks } = await setupRepo()
    await assert.doesNotReject(before(hooks, "edit", "unknown", { filePath: "a.ts" }))
  })

  test("blocks edit/write for read-only agents", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, { sessionID: "ro", agentType: "orchestrator" })

    for (const tool of ["edit", "write", "patch", "multiedit"]) {
      await assert.rejects(before(hooks, tool, "ro", { filePath: "a.ts" }), /read-only/)
    }
  })

  test("allows edits for writing agents", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, { sessionID: "dev", agentType: "developer" })

    await assert.doesNotReject(before(hooks, "edit", "dev", { filePath: "src/a.ts" }))
  })

  test("enforces allowed paths including glob patterns", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, {
      sessionID: "dev",
      agentType: "developer",
      allowedPaths: ["src/**"],
    })

    await assert.doesNotReject(before(hooks, "write", "dev", { filePath: "src/nested/a.ts" }))
    await assert.rejects(before(hooks, "write", "dev", { filePath: "lib/a.ts" }), /Outside allowed paths/)
  })

  test("enforces denied paths", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, {
      sessionID: "dev",
      agentType: "developer",
      deniedPaths: ["secrets"],
    })

    await assert.rejects(before(hooks, "edit", "dev", { filePath: "src/secrets/key.ts" }), /Path denied/)
    await assert.doesNotReject(before(hooks, "edit", "dev", { filePath: "src/app.ts" }))
  })

  test("blocks destructive bash for read-only agents but allows inspection", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, { sessionID: "ro", agentType: "reviewer" })

    await assert.rejects(before(hooks, "bash", "ro", { command: "rm -rf build" }), /read-only/)
    await assert.rejects(before(hooks, "bash", "ro", { command: "echo hi > file.txt" }), /read-only/)
    await assert.doesNotReject(before(hooks, "bash", "ro", { command: "ls -la" }))
    await assert.doesNotReject(before(hooks, "bash", "ro", { command: "git status" }))
  })

  test("prefixes bash commands with the agent worktree", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, {
      sessionID: "dev",
      agentType: "developer",
      worktree: "/tmp/opencode/worktrees/feat-a",
    })

    const args = await before(hooks, "bash", "dev", { command: "npm test" })
    assert.equal(args.command, 'cd "/tmp/opencode/worktrees/feat-a" && npm test')
  })

  test("unregistering restores pass-through behaviour", async () => {
    const { hooks } = await setupRepo()
    await register(hooks, { sessionID: "ro", agentType: "security" })
    await assert.rejects(before(hooks, "edit", "ro", { filePath: "a.ts" }), /read-only/)

    const result = await getTool(hooks, "unregister_agent").execute({ sessionID: "ro" }, {})
    assert.match(result, /OK Unregistered/)
    await assert.doesNotReject(before(hooks, "edit", "ro", { filePath: "a.ts" }))

    const again = await getTool(hooks, "unregister_agent").execute({ sessionID: "ro" }, {})
    assert.match(again, /WARN Not found/)
  })
})

describe("worktree lifecycle", () => {
  test("creates a worktree with a task file and gitignore entries", async () => {
    const { dir, hooks } = await setupRepo()
    const result = await getTool(hooks, "worktree_create").execute(
      { branch: "feat/login", task: "Add login" },
      {},
    )

    assert.match(result, /OK Worktree: feat-login/)
    const worktreePath = join(dir, "worktrees", "feat-login")
    assert.ok(existsSync(worktreePath))

    const taskFile = readFileSync(join(worktreePath, ".agent-task"), "utf-8")
    assert.match(taskFile, /^# Branch: feat\/login$/m)
    assert.match(taskFile, /Add login/)

    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: worktreePath, encoding: "utf-8" }).trim()
    assert.equal(branch, "feat/login")

    const gitignore = readFileSync(join(dir, ".gitignore"), "utf-8")
    assert.match(gitignore, /\.agent-task/)
    assert.match(gitignore, /worktrees\//)
  })

  test("validates required inputs", async () => {
    const { hooks } = await setupRepo()
    const create = getTool(hooks, "worktree_create")

    assert.match(await create.execute({ branch: "", task: "x" }, {}), /Branch name required/)
    assert.match(await create.execute({ branch: "feat/a", task: "" }, {}), /Task description required/)
  })

  test("reports an existing worktree instead of recreating it", async () => {
    const { hooks } = await setupRepo()
    await createWorktree(hooks, "feat/dup")

    const result = await getTool(hooks, "worktree_create").execute({ branch: "feat/dup", task: "again" }, {})
    assert.match(result, /WARN Worktree exists: feat-dup/)
  })

  test("reports status for in-progress, done, blocked and errored worktrees", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/wip")
    await createWorktree(hooks, "feat/done")
    await createWorktree(hooks, "feat/blocked")
    await createWorktree(hooks, "feat/error")

    await getTool(hooks, "done").execute({ worktree: "feat-done", summary: "finished" }, {})
    await getTool(hooks, "blocked").execute({ worktree: "feat-blocked", reason: "waiting" }, {})
    writeFileSync(join(dir, "worktrees", "feat-error", ".agent-error"), "boom")

    const status = await getTool(hooks, "status").execute({}, {})
    assert.match(status, /WIP feat-wip/)
    assert.match(status, /OK feat-done/)
    assert.match(status, /BLOCKED feat-blocked/)
    assert.match(status, /ERROR feat-error/)
    assert.match(status, /Total:4 Done:1 WIP:1 Blocked:1 Err:1/)
  })

  test("status reports no worktrees before any are created", async () => {
    const { hooks } = await setupRepo()
    assert.equal(await getTool(hooks, "status").execute({}, {}), "No worktrees")
  })

  test("done writes a summary and clears error/blocked markers", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/finish")
    const worktreePath = join(dir, "worktrees", "feat-finish")
    writeFileSync(join(worktreePath, ".agent-error"), "old error")
    writeFileSync(join(worktreePath, ".agent-blocked"), "old block")

    const result = await getTool(hooks, "done").execute({ worktree: "feat-finish", summary: "all good" }, {})
    assert.match(result, /OK Done: feat-finish/)
    assert.equal(readFileSync(join(worktreePath, ".agent-done"), "utf-8").trim(), "all good")
    assert.equal(existsSync(join(worktreePath, ".agent-error")), false)
    assert.equal(existsSync(join(worktreePath, ".agent-blocked")), false)
  })

  test("blocked records the reason", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/stuck")

    const result = await getTool(hooks, "blocked").execute({ worktree: "feat-stuck", reason: "missing API key" }, {})
    assert.match(result, /BLOCKED Blocked: feat-stuck/)
    assert.equal(
      readFileSync(join(dir, "worktrees", "feat-stuck", ".agent-blocked"), "utf-8").trim(),
      "missing API key",
    )
  })

  test("read_task returns the task description", async () => {
    const { hooks } = await setupRepo()
    await createWorktree(hooks, "feat/read", "Implement the widget")

    const result = await getTool(hooks, "read_task").execute({ worktree: "feat-read" }, {})
    assert.match(result, /Implement the widget/)

    assert.match(await getTool(hooks, "read_task").execute({ worktree: "nope" }, {}), /ERROR No task: nope/)
  })

  test("visualize reports progress", async () => {
    const { hooks } = await setupRepo()
    await createWorktree(hooks, "feat/one")
    await createWorktree(hooks, "feat/two")
    await getTool(hooks, "done").execute({ worktree: "feat-one", summary: "ok" }, {})

    const result = await getTool(hooks, "visualize").execute({}, {})
    assert.match(result, /Progress: 50% \(1\/2\)/)
    assert.match(result, /OK feat-one \(done\)/)
    assert.match(result, /WIP feat-two \(wip\)/)
  })

  test("missing worktrees are reported consistently", async () => {
    const { hooks } = await setupRepo()
    for (const name of ["test", "merge", "cleanup", "done", "blocked"]) {
      const result = await getTool(hooks, name).execute({ worktree: "ghost" }, {})
      assert.match(result, /ERROR Not found: ghost/)
    }
  })

  test("test tool runs detected scripts and records failures", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/checks")
    const worktreePath = join(dir, "worktrees", "feat-checks")
    writeFileSync(
      join(worktreePath, "package.json"),
      JSON.stringify({
        scripts: {
          lint: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(1)"',
        },
      }),
    )

    const result = await getTool(hooks, "test").execute({ worktree: "feat-checks" }, {})
    assert.match(result, /ERROR Failed: test/)
    assert.match(result, /OK lint/)
    assert.ok(existsSync(join(worktreePath, ".agent-error")))
  })

  test("test tool reports passing checks and missing checks", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/pass")
    await createWorktree(hooks, "feat/empty")
    const worktreePath = join(dir, "worktrees", "feat-pass")
    writeFileSync(
      join(worktreePath, "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    )

    assert.match(
      await getTool(hooks, "test").execute({ worktree: "feat-pass" }, {}),
      /OK All passed: test/,
    )
    assert.equal(
      await getTool(hooks, "test").execute({ worktree: "feat-empty" }, {}),
      "WARN No checks found",
    )
  })

  test("merge requires a done marker and merges the recorded branch", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/merge")
    const worktreePath = join(dir, "worktrees", "feat-merge")
    writeFileSync(join(worktreePath, "feature.txt"), "hello\n")
    execSync("git add -A && git commit -qm feature", { cwd: worktreePath })

    assert.match(
      await getTool(hooks, "merge").execute({ worktree: "feat-merge" }, {}),
      /ERROR Not done: feat-merge/,
    )

    await getTool(hooks, "done").execute({ worktree: "feat-merge", summary: "ready" }, {})
    const result = await getTool(hooks, "merge").execute({ worktree: "feat-merge" }, {})
    assert.match(result, /OK Merged: feat\/merge/)
    assert.ok(existsSync(join(dir, "feature.txt")))
  })

  test("cleanup refuses unfinished worktrees unless forced", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/clean")
    const worktreePath = join(dir, "worktrees", "feat-clean")

    assert.match(
      await getTool(hooks, "cleanup").execute({ worktree: "feat-clean" }, {}),
      /ERROR Not done \(use force=true\)/,
    )
    assert.ok(existsSync(worktreePath))

    assert.match(
      await getTool(hooks, "cleanup").execute({ worktree: "feat-clean", force: true }, {}),
      /OK Cleaned: feat-clean/,
    )
    assert.equal(existsSync(worktreePath), false)
  })
})

describe("reporting tools", () => {
  test("log appends structured jsonl entries", async () => {
    const { dir, hooks } = await setupRepo()
    const result = await getTool(hooks, "log").execute(
      { level: "info", message: "hello", context: { step: 1 } },
      {},
    )

    assert.match(result, /OK Logged/)
    const lines = readFileSync(join(dir, ".agent-logs.jsonl"), "utf-8").trim().split("\n")
    const entry = JSON.parse(lines[0])
    assert.equal(entry.level, "info")
    assert.equal(entry.message, "hello")
    assert.deepEqual(entry.context, { step: 1 })
    assert.ok(Date.parse(entry.timestamp))
  })

  test("analyze summarizes the codebase", async () => {
    const { hooks } = await setupRepo({ packageJson: { dependencies: { a: "1", b: "2" } } })
    const result = await getTool(hooks, "analyze").execute({ mode: "full" }, {})

    assert.match(result, /OK Analyzed: Files: \d+ \| Deps: 2/)
  })

  test("create_plan reports the task count", async () => {
    const { hooks } = await setupRepo()
    const result = await getTool(hooks, "create_plan").execute(
      {
        planName: "release",
        plan: "# plan",
        tasks: [
          { name: "a", branch: "feat/a", ownership: ["src/a/**"] },
          { name: "b", branch: "feat/b", ownership: ["src/b/**"] },
        ],
      },
      {},
    )

    assert.match(result, /OK Plan: release \(2 tasks\)/)
  })

  test("review writes the verdict to the worktree", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/review")

    const result = await getTool(hooks, "review").execute(
      {
        worktree: "feat-review",
        verdict: "approved",
        summary: "Looks good",
        issues: [{ severity: "minor", file: "src/a.ts", message: "nit" }],
      },
      {},
    )

    assert.match(result, /Review: approved \(1 issues\)/)
    assert.equal(
      readFileSync(join(dir, "worktrees", "feat-review", ".agent-review"), "utf-8"),
      "approved: Looks good",
    )
  })

  test("pentest_scan records findings as json and markdown", async () => {
    const { dir, hooks } = await setupRepo()
    const findings = [
      { id: "1", severity: "critical", type: "xss", title: "XSS", description: "bad" },
      { id: "2", severity: "low", type: "info", title: "Leak", description: "meh" },
    ]

    const jsonResult = await getTool(hooks, "pentest_scan").execute(
      { target: "https://example.com", mode: "deep", riskLevel: "high", summary: "found stuff", findings },
      {},
    )
    assert.match(jsonResult, /Pentest: high \| 2 findings \(1 critical, 0 high\)/)

    const scanFiles = readdirSync(dir).filter((name) => name.startsWith(".pentest-scan-"))
    assert.equal(scanFiles.length, 1)
    const saved = JSON.parse(readFileSync(join(dir, scanFiles[0]), "utf-8"))
    assert.equal(saved.target, "https://example.com")
    assert.equal(saved.stats.total, 2)
    assert.equal(saved.stats.critical, 1)

    const md = await getTool(hooks, "pentest_scan").execute(
      {
        target: "https://example.com",
        mode: "basic",
        riskLevel: "low",
        summary: "clean",
        outputFormat: "markdown",
      },
      {},
    )
    assert.match(md, /# Pentest Scan Report/)
    assert.match(md, /Critical: 0/)
  })

  test("security_scan gates merges on severity and annotates worktrees", async () => {
    const { dir, hooks } = await setupRepo()
    await createWorktree(hooks, "feat/sec")

    const blocked = await getTool(hooks, "security_scan").execute(
      {
        target: "feat-sec",
        riskLevel: "critical",
        summary: "rce",
        vulnerabilities: [
          { id: "1", severity: "critical", type: "rce", description: "bad", remediation: "fix" },
        ],
      },
      {},
    )
    assert.match(blocked, /Security: critical/)
    assert.equal(
      readFileSync(join(dir, "worktrees", "feat-sec", ".agent-security"), "utf-8"),
      "critical: rce",
    )

    const clean = await getTool(hooks, "security_scan").execute(
      { target: "main", riskLevel: "low", summary: "clean" },
      {},
    )
    assert.match(clean, /Security: low/)
  })

  test("pentest_check_tools reports availability as json", async () => {
    const { hooks } = await setupRepo()
    const result = await getTool(hooks, "pentest_check_tools").execute({}, {})
    const parsed = JSON.parse(result)

    assert.ok(Array.isArray(parsed.available))
    assert.ok(Array.isArray(parsed.missing))
    assert.match(parsed.summary, /^\d+\/8 tools available$/)
    assert.equal(typeof parsed.canRunBasic, "boolean")
  })

  test("final_check runs configured checks", async () => {
    const { hooks } = await setupRepo({
      packageJson: {
        scripts: {
          lint: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
        },
      },
    })

    const result = await getTool(hooks, "final_check").execute({ baseCommit: "HEAD" }, {})
    assert.match(result, /OK All passed: lint, typecheck/)
  })

  test("final_check reports when no checks are configured", async () => {
    const { hooks } = await setupRepo()
    assert.equal(
      await getTool(hooks, "final_check").execute({ baseCommit: "HEAD" }, {}),
      "WARN No checks found",
    )
  })

  test("push_and_watch warns when no remote is configured", async () => {
    const { hooks } = await setupRepo()
    assert.equal(
      await getTool(hooks, "push_and_watch").execute({}, {}),
      "WARN No remote configured",
    )
  })

  test("config hook adds the free-tier DeepSeek fallback to opencode-go agents", async () => {
    const { hooks } = await setupRepo()
    const config: { agent: Record<string, Record<string, unknown>> } = {
      agent: {
        developer: { model: "opencode-go/deepseek-v4.1-flash" },
        foreign: { model: "other/provider" },
        pinned: { model: "opencode-go/glm-5.3-flash", fallback_model: "opencode-go/pinned" },
      },
    }

    await hooks.config?.(config as never)

    assert.equal(config.agent.developer.fallback_model, "opencode-go/deepseek-v4.1-flash-free")
    assert.equal("fallback_model" in config.agent.foreign, false)
    assert.equal(config.agent.pinned.fallback_model, "opencode-go/pinned")
  })

  test("chat.params hook sends fallback_model only for opencode-go", async () => {
    const { hooks } = await setupRepo()
    const opencodeGo = {
      temperature: 0,
      topP: 0,
      topK: 0,
      maxOutputTokens: undefined,
      options: {} as Record<string, unknown>,
    }
    const other = { ...opencodeGo, options: {} as Record<string, unknown> }

    await hooks["chat.params"]?.({ model: { providerID: "opencode-go" } } as never, opencodeGo as never)
    await hooks["chat.params"]?.({ model: { providerID: "other" } } as never, other as never)

    assert.equal(opencodeGo.options.fallback_model, "opencode-go/deepseek-v4.1-flash-free")
    assert.equal(other.options.fallback_model, undefined)
  })
})
