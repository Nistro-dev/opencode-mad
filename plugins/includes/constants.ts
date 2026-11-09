import type { AgentType } from "../types/enitities"

// Package metadata used by the update check
export const PACKAGE_NAME = "@fiandev/opencode-kit"
export const CURRENT_VERSION = "2.0.1"

// Free-tier fallback used when an opencode-go model is unavailable or rate-limited.
export const FALLBACK_MODEL = "opencode-go/deepseek-v4.1-flash-free"

/** Agents that must never modify files. */
export const READ_ONLY_AGENTS: readonly AgentType[] = [
  "orchestrator",
  "analyst",
  "architect",
  "tester",
  "reviewer",
  "security",
  "pentester",
  "pr-reviewer",
  "version-analyzer",
]
