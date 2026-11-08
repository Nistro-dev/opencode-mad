# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/fiandev/opencode-kit/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/fiandev/opencode-kit/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/fiandev/opencode-kit/compare/v1.0.0...v1.1.0
