# AGENTS.md

Guidance for agents working in this repository.

## What this project is

`@fiandev/opencode-kit` is an OpenCode plugin that adds **parallel development
orchestration**: a primary `orchestrator` agent decomposes a task, then subagents
work in isolated git worktrees under `worktrees/`. The plugin enforces agent
permissions (read-only agents, file ownership, worktree scoping) at the tool-call
level.

- Package: `@fiandev/opencode-kit`
- Plugin id: `fiandev.opencode-kit`
- Runtime: OpenCode V2 API — `@opencode/plugin@2.0.23`, `zod@4`
- No build step: TypeScript is shipped as source (`main: plugins/main.ts`)
- Package manager / test runner: **Bun** (Node 22 in CI)

## Commands

```bash
bun install              # install deps (CI uses --frozen-lockfile)
bun run typecheck        # tsc --noEmit (plugins/**/*.ts + tests/**/*.ts)
bun test                 # node:test suite executed by Bun
bun run test             # alias for bun test
node install.js          # CLI: install | install -g | update | version
```

Before finishing a change, run **both** `bun run typecheck` and `bun test`.

## Repository layout

```
agents/            # 19 agent definitions (Markdown + YAML frontmatter)
commands/          # slash-command definitions (/orchestration, /pr, /commit, ...)
plugins/main.ts    # the entire plugin: tools, hooks, constraint enforcement
skills/workflow/   # SKILL.md describing the orchestration workflow
tests/main.test.ts # node:test suite
install.js         # npx installer that copies agents/commands/plugins/skills
CHANGELOG.md       # Keep a Changelog format
```

`agents/`, `commands/`, `plugins/`, and `skills/` at the repo root are the **source
of truth**. The `.opencode/` directory is a local install artifact (gitignored,
produced by `install.js`) — never edit it, and never commit it.

## Plugin architecture (`plugins/main.ts`)

Everything lives in one file. Keep it that way unless a split is clearly justified.

- `createPluginHooks({ directory, log })` — builds the testable hook object
  (`tool`, `tool.execute.before`, `chat.params`, `event`). Tests call this directly;
  no running OpenCode server is needed.
- `MultiAgentDevPlugin` / default export — `Plugin.define({ id, setup })` wires the
  hooks into the V2 runtime (`ctx.tool.transform`, `ctx.tool.hook`,
  `ctx.session.hook`, `ctx.event.subscribe`).
- `tool()` helper — local typed wrapper over a Zod schema (`description`, `args`,
  `execute`) so tool definitions stay compact.
- `agentPermissions: Map<sessionID, AgentPermissions>` — in-memory registry written
  by `register_agent`, read by the `tool.execute.before` guard.

### Constraint enforcemen

## Code style

- TypeScript: 2-space indent, double quotes, **no semicolons**, `strict` mode.
- Prefer Node `fs` APIs over shell interpolation for file operations; use the
  `runCommand` / `getGitRoot` helpers for git and npm. Errors are `unknown`; narrow
  with `errorMessage` / `errorOutput`.
- Keep new dependencies out unless unavoidable — the plugin ships into user projects.
- Markdown: keep tables and headings consistent with existing docs; prose is English.

## Testing

`tests/main.test.ts` uses `node:test` + `node:assert/strict` under Bun. Each test
creates a temporary git repo fixture (`setupRepo`), builds hooks with
`createPluginHooks`, and exercises tools through `getTool(...).execute(...)`.
Cleanup happens in `afterEach`. Extend these fixtures instead of adding new harnesses.

## Release checklist

1. Bump `version` in `package.json` **and** `CURRENT_VERSION` in `plugins/main.ts`
   (they must match).
2. Update `CHANGELOG.md` (Keep a Changelog + SemVer; add compare links).
3. Ensure `package.json` `files` still lists every shipped directory.
4. Run typecheck and tests, commit, tag `vX.Y.Z`, push the tag.
5. CI (`.github/workflows/release.yaml`) only publishes when the tag is on `master`
   and matches the package version.

The `/version-update` command automates steps 1–2; prefer it over manual edits.
