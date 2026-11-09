import { describe, test } from "node:test"
import assert from "node:assert/strict"
import MultiAgentDevPluginDefault, { createPluginHooks, MultiAgentDevPlugin } from "../plugins/main"

const EXPECTED_TOOLS = [
  "analyze",
  "blocked",
  "check_update",
  "cleanup",
  "create_plan",
  "done",
  "final_check",
  "log",
  "merge",
  "pentest_check_tools",
  "pentest_scan",
  "push_and_watch",
  "read_task",
  "register_agent",
  "review",
  "security_scan",
  "status",
  "test",
  "unregister_agent",
  "visualize",
  "worktree_create",
]

describe("barrel entry point", () => {
  test("re-exports the plugin definition as both named and default export", () => {
    assert.equal(MultiAgentDevPluginDefault, MultiAgentDevPlugin)
    assert.equal(MultiAgentDevPlugin.id, "fiandev.opencode-kit")
  })

  test("exposes exactly the expected tool set", async () => {
    const hooks = await createPluginHooks({ directory: process.cwd() })
    const names = Object.keys(hooks.tool).sort()

    assert.equal(Object.keys(hooks.tool).length, 21)
    assert.deepEqual(names, EXPECTED_TOOLS)
  })

  test("every tool has a description and an object args schema", async () => {
    const hooks = await createPluginHooks({ directory: process.cwd() })

    for (const [name, definition] of Object.entries(hooks.tool)) {
      assert.equal(typeof definition.description, "string", `${name} description`)
      assert.ok(definition.description.trim().length > 0, `${name} description is empty`)
      assert.equal(typeof definition.args, "object", `${name} args is not an object`)
      assert.notEqual(definition.args, null, `${name} args is null`)
    }
  })
})
