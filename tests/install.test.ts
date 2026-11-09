import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { install } from "../installer/install"

const cleanups: string[] = []

afterEach(() => {
  while (cleanups.length > 0) {
    rmSync(cleanups.pop()!, { recursive: true, force: true })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}

/** Build a fake package root so tests never need a real dist/main.js in the repo. */
function makePackageRoot(version = "9.9.9"): string {
  const root = tempDir("opencode-kit-install-src-")

  mkdirSync(join(root, "agents"), { recursive: true })
  writeFileSync(join(root, "agents", "orchestrator.md"), "# orchestrator\n")

  mkdirSync(join(root, "commands"), { recursive: true })
  writeFileSync(join(root, "commands", "commit.md"), "# commit\n")

  mkdirSync(join(root, "skills", "workflow"), { recursive: true })
  writeFileSync(join(root, "skills", "workflow", "SKILL.md"), "# workflow\n")

  mkdirSync(join(root, "dist"), { recursive: true })
  writeFileSync(join(root, "dist", "main.js"), "export default {}\n")

  writeFileSync(join(root, "package.json"), JSON.stringify({ version }))
  return root
}

describe("install", () => {
  test("follows a symlinked destination and keeps the link intact", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const realSkills = tempDir("opencode-kit-install-real-skills-")

    symlinkSync(realSkills, join(targetDir, "skills"), "dir")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.action, "updated")
    assert.equal(result.version, "9.9.9")
    assert.ok(lstatSync(join(targetDir, "skills")).isSymbolicLink())
    assert.equal(realpathSync(join(targetDir, "skills")), realpathSync(realSkills))
    assert.ok(existsSync(join(realSkills, "workflow", "SKILL.md")))
    assert.ok(existsSync(join(targetDir, "agents", "orchestrator.md")))
    assert.ok(existsSync(join(targetDir, "commands", "commit.md")))
    assert.ok(existsSync(join(targetDir, "plugins", "main.js")))
  })

  test("refuses to overwrite a plain file destination without losing data", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const plainFile = join(targetDir, "agents")

    writeFileSync(plainFile, "keep me")

    assert.throws(
      () => install({ srcRoot, targetDir }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /agents exists and is not a directory/)
        assert.doesNotMatch(error.message, /ERR_FS_CP_DIR_TO_NON_DIR/)
        return true
      },
    )

    assert.equal(readFileSync(plainFile, "utf-8"), "keep me")
  })

  test("installs into an empty target", () => {
    const srcRoot = makePackageRoot()
    const targetDir = join(tempDir("opencode-kit-install-parent-"), ".opencode")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.action, "installed")
    assert.equal(result.version, "9.9.9")
    assert.ok(existsSync(join(targetDir, "agents", "orchestrator.md")))
    assert.ok(existsSync(join(targetDir, "commands", "commit.md")))
    assert.ok(existsSync(join(targetDir, "skills", "workflow", "SKILL.md")))
    assert.ok(existsSync(join(targetDir, "plugins", "main.js")))
    assert.ok(!existsSync(join(targetDir, "plugins", "main.ts")))
  })

  test("replaces a dangling symlink with a real directory", () => {
    const srcRoot = makePackageRoot()
    const targetDir = tempDir("opencode-kit-install-target-")
    const missing = join(tempDir("opencode-kit-install-missing-"), "gone")

    symlinkSync(missing, join(targetDir, "commands"), "dir")

    const result = install({ srcRoot, targetDir })

    assert.equal(result.action, "installed")
    assert.ok(!lstatSync(join(targetDir, "commands")).isSymbolicLink())
    assert.ok(lstatSync(join(targetDir, "commands")).isDirectory())
    assert.ok(existsSync(join(targetDir, "commands", "commit.md")))
  })
})
