#!/usr/bin/env node

/**
 * opencode-kit installer
 *
 * Usage:
 *   npx @fiandev/opencode-kit install        # Install to current project (.opencode/)
 *   npx @fiandev/opencode-kit install -g     # Install globally (~/.config/opencode/)
 *   npx @fiandev/opencode-kit update         # Update in current project (alias for install)
 *   npx @fiandev/opencode-kit update -g      # Update globally (alias for install -g)
 *   npx @fiandev/opencode-kit version        # Show version
 */

import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { install } from "./installer/install"

const __dirname = dirname(fileURLToPath(import.meta.url))

type PackageJson = { version: string }

const args = process.argv.slice(2)
const command = args[0]
const isGlobal = args.includes("-g") || args.includes("--global")

// Handle version command
if (command === "version" || command === "-v" || command === "--version") {
  const pkg: PackageJson = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"))
  console.log(`opencode-kit v${pkg.version}`)
  process.exit(0)
}

// 'update' is an alias for 'install'
if (command !== "install" && command !== "update") {
  console.log(`
opencode-kit - Multi-Agent Dev plugin for OpenCode

Usage:
  npx @fiandev/opencode-kit install        Install to current project (.opencode/)
  npx @fiandev/opencode-kit install -g     Install globally (~/.config/opencode/)
  npx @fiandev/opencode-kit update         Update in current project (alias for install)
  npx @fiandev/opencode-kit update -g      Update globally (alias for install -g)
  npx @fiandev/opencode-kit version        Show version

More info: https://github.com/fiandev/opencode-kit
`);
  process.exit(0)
}

const targetDir = isGlobal
  ? join(homedir(), ".config", "opencode")
  : join(process.cwd(), ".opencode")

try {
  const { action, version } = install({ srcRoot: __dirname, targetDir })
  const location = isGlobal ? "~/.config/opencode" : ".opencode"
  console.log(`opencode-kit v${version} ${action} to ${location}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
