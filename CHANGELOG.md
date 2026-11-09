# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.1] - 2026-11-09

### Fixed

- Installer no longer fails with `ERR_FS_CP_DIR_TO_NON_DIR` when a destination folder
  (`agents`, `commands`, `skills`, or `plugins`) is a symlink to a directory: it copies
  into the link target and keeps the link. Plain-file destinations are rejected with a
  clear `opencode-kit: <path> exists and is not a directory` error instead of being
  deleted, and dangling symlinks are replaced with real directories.

## [2.0.0] - 2026-11-09

### Added

- `ponytail` skill under `skills/ponytail/SKILL.md`.
- Parity test asserting the plugin exposes exactly 21 tools, each with a description and an object args schema.

### Changed

- **Breaking:** the package now ships the compiled bundle. `bun run build` bundles `plugins/main.ts` to `dist/main.js`, which is the package `main`; `files` lists `dist` instead of `plugins`; and `prepack` builds both the bundle and `install.js`.
- **Breaking:** the installer copies `dist/` into `.opencode/plugins/` and removes the TypeScript plugin files installed by versions <= 1.2.0 so the plugin is not loaded twice. A source checkout or tarball without `dist/` can no longer be installed.
- **Breaking:** manual installation now requires clone + `bun install` + `bun run build` and copying `dist/`; the documented post-install structure shows `plugins/main.js`.
- **Breaking:** all shipped agents now require a trailing space in bash permission globs (`"pwd *"` instead of `"pwd*"`), so argument-less invocations such as `pwd`, `git status`, and `bun test` no longer match an allow rule.
- Split the monolithic `plugins/main.ts` into `plugins/includes/{constants,hooks}.ts`, `plugins/lib/*` (including `plugins/lib/plugin.ts`), `plugins/tools/*`, and `plugins/types/enitities.ts` (internal refactor, no behavior change).
- `plugins/main.ts` is now a barrel re-exporting `createPluginHooks`, `MultiAgentDevPlugin`, and the default export over `plugins/includes/hooks.ts` and `plugins/lib/plugin.ts`.
- Build `install.js` from `install.ts` at `prepack`; `install.ts` is now typechecked and `install.js` is a gitignored build artifact.
- Release workflow builds the bundle before verifying the tag.

### Fixed

- Bash permission allowlists no longer match unintended commands through prefix collision.

## [1.2.0] - 2026-11-08

### Added

- `committer` subagent: `/commit` now delegates staging and committing to it, with `git commit` gated by `ask` and push/amend/rebase/reset/tag denied. `git add -A`, `git add --all`, and `git add .` are blocked, and secrets, `node_modules`, and build output are never staged.
- `AGENTS.md` project guide and `CLAUDE.md` pointer for contributors.

### Changed

- Every shipped subagent now denies unknown bash commands by default and enumerates the read, git, and build commands its role needs, instead of a `"*": allow` wildcard. Installs and state-changing git commands are `ask`; force pushes, `git filter-branch`, remote rewrites, and `curl | sh` are `deny`.
- `/commit` is read-only for the orchestrator; all git writes go through the `committer` subagent.

### Security

- Subagents can no longer bypass file-ownership rules with `rm`, `mv`, or shell redirection via a wildcard bash permission.

## [1.1.0] - 2026-11-08

> **Note:** this release contains breaking changes despite being a minor bump. See the
> **Breaking** entries under Changed. Pinned `^1` consumers will receive these changes.

### Added

- `version-analyzer` and `version-updater` agents with `/version-update` for tag-driven semver analysis and release application.
- `pr`, `pr-reviewer`, `pr-resolver`, and `conflict-resolver` subagents with `/pr`, `/pr-review`, `/pr-resolve`, `/conflict-resolve` commands, including fork-aware PR targeting.
- `typescript-engineer` agent and `/commit` command.
- Read-only agents are now blocked from creating or mutating git tags, including `git tag`.

### Changed

- **Breaking:** plugin migrated to the OpenCode V2 API (`Plugin.define({ id, setup })`, `@opencode/plugin@2.0.23`, `zod@4`); requires OpenCode 2.0.23 or newer.
- **Breaking:** `fallback_model` is sent as a per-request `chat.params` option instead of being written into agent config at load time; the `config` hook was removed.
- **Breaking:** `commands/mad.md` renamed to `commands/orchestration.md`; the slash command is now `/orchestration` (was `/mad`).
- Default agent models moved to `opencode-go/deepseek-v4.1-flash` with `opencode-go/deepseek-v4.1-flash-free` as fallback.
- `/commit` workflow simplified to a short checklist.

### Fixed

- Worktree cleanup/done/blocked tools use direct filesystem and command execution instead of shell interpolation.
- Read-only agents can no longer create or move tags.

[Unreleased]: https://github.com/fiandev/opencode-kit/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/fiandev/opencode-kit/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/fiandev/opencode-kit/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/fiandev/opencode-kit/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/fiandev/opencode-kit/compare/v1.0.0...v1.1.0
