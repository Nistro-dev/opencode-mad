import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"

const FOLDERS = ["agents", "commands", "skills"] as const
const MAX_SYMLINK_HOPS = 40

export interface InstallOptions {
  srcRoot: string
  targetDir: string
}

export interface InstallResult {
  action: "installed" | "updated"
  version: string
}

type PackageJson = { version: string }

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
}

/**
 * Prepare a destination directory and return its real path.
 *
 * - symlink to a directory: follow it (keeping the link) and return the real path
 * - dangling symlink: remove the stale link and create a directory
 * - plain file: throw, never delete user data
 */
function prepareDestination(dest: string): string {
  const shown = dest
  let current = dest

  for (let hop = 0; hop <= MAX_SYMLINK_HOPS; hop++) {
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      if (!isMissing(error)) throw error
      mkdirSync(current, { recursive: true })
      return current
    }

    if (stat.isSymbolicLink()) {
      try {
        current = realpathSync(current)
      } catch (error) {
        if (!isMissing(error)) throw error
        rmSync(current, { force: true })
        mkdirSync(current, { recursive: true })
        return current
      }
      continue
    }

    if (stat.isDirectory()) return current

    throw new Error(`opencode-kit: ${shown} exists and is not a directory`)
  }

  throw new Error(`opencode-kit: ${shown} has too many levels of symbolic links`)
}

export function install({ srcRoot, targetDir }: InstallOptions): InstallResult {
  const pluginSource = join(srcRoot, "dist")

  if (!existsSync(pluginSource)) {
    throw new Error('opencode-kit: dist/main.js not found. Run "bun run build" first.')
  }

  const isUpdate = [...FOLDERS, "plugins"].some((folder) => existsSync(join(targetDir, folder)))
  const pkg: PackageJson = JSON.parse(readFileSync(join(srcRoot, "package.json"), "utf-8"))

  for (const folder of FOLDERS) {
    const src = join(srcRoot, folder)
    if (!existsSync(src)) continue

    const dest = prepareDestination(join(targetDir, folder))
    cpSync(src, dest, { recursive: true })
  }

  const pluginTarget = prepareDestination(join(targetDir, "plugins"))

  // Remove TypeScript sources installed by versions <= 1.2.0 so the plugin is not loaded twice
  if (existsSync(join(pluginTarget, "main.ts"))) {
    for (const file of ["main.ts", "plugin.ts", "hooks.ts", "types.ts", "constants.ts"]) {
      rmSync(join(pluginTarget, file), { force: true })
    }
    for (const dir of ["lib", "tools"]) {
      rmSync(join(pluginTarget, dir), { recursive: true, force: true })
    }
  }

  cpSync(pluginSource, pluginTarget, { recursive: true })

  return { action: isUpdate ? "updated" : "installed", version: pkg.version }
}
