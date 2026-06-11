import { describe, expect, test } from "vitest"
import {
  validateWorkflowSchema,
  getValidNext,
  isValidTransition,
  stageIndex,
  totalStages,
  formatStageMessage,
  formatCompleteMessage,
  fmtElapsed,
  resolveWorkflowFile,
  listWorkflowFiles,
  type Workflow,
  type WorkflowState,
} from "../src/test-helpers"

// ═══════════════════════════════════════════════════════
//  fmtElapsed
// ═══════════════════════════════════════════════════════

describe("fmtElapsed", () => {
  test("seconds", () => {
    expect(fmtElapsed(0)).toBe("0s")
    expect(fmtElapsed(30_000)).toBe("30s")
    expect(fmtElapsed(59_000)).toBe("59s")
  })
  test("minutes", () => {
    expect(fmtElapsed(60_000)).toBe("1m")
    expect(fmtElapsed(120_000)).toBe("2m")
  })
  test("hours", () => {
    expect(fmtElapsed(3_600_000)).toBe("1h")
    expect(fmtElapsed(7_200_000)).toBe("2h")
    expect(fmtElapsed(5_400_000)).toBe("1h 30m")
  })
})

// ═══════════════════════════════════════════════════════
//  validateWorkflowSchema
// ═══════════════════════════════════════════════════════

const validSchema = {
  kind: "workflow",
  name: "Test WF",
  description: "A test workflow",
  stages: [
    { id: "plan", instruction: "Plan it", checklist: ["item 1", "item 2"], next: "build" },
    { id: "build", instruction: "Build it", next: "ship" },
    { id: "ship", instruction: "Ship it" },
  ],
}

describe("validateWorkflowSchema", () => {
  test("valid schema passes", () => {
    const result = validateWorkflowSchema(validSchema)
    expect(typeof result).not.toBe("string")
    if (typeof result !== "string") {
      expect(result.name).toBe("Test WF")
      expect(result.description).toBe("A test workflow")
      expect(result.stages).toHaveLength(3)
      expect(result.stages[0]!.checklist).toEqual(["item 1", "item 2"])
    }
  })

  test("rejects missing kind", () => {
    const result = validateWorkflowSchema({ name: "X", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("kind")
  })

  test("rejects wrong kind", () => {
    const result = validateWorkflowSchema({ kind: "task", name: "X", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("kind")
  })

  test("rejects missing name", () => {
    const result = validateWorkflowSchema({ kind: "workflow", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("name")
  })

  test("rejects empty name", () => {
    const result = validateWorkflowSchema({ kind: "workflow", name: "  ", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("name")
  })

  test("rejects missing stages", () => {
    const result = validateWorkflowSchema({ kind: "workflow", name: "X" })
    expect(typeof result).toBe("string")
    expect(result).toContain("stages")
  })

  test("rejects empty stages array", () => {
    const result = validateWorkflowSchema({ kind: "workflow", name: "X", stages: [] })
    expect(typeof result).toBe("string")
    expect(result).toContain("stages")
  })

  test("rejects stage without id", () => {
    const result = validateWorkflowSchema({ kind: "workflow", name: "X", stages: [{ instruction: "hi" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("id")
  })

  test("rejects duplicate stage ids", () => {
    const result = validateWorkflowSchema({
      kind: "workflow", name: "X",
      stages: [{ id: "a" }, { id: "a" }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("duplicate")
  })

  test("rejects invalid next reference", () => {
    const result = validateWorkflowSchema({
      kind: "workflow", name: "X",
      stages: [{ id: "a", next: "nonexistent" }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("does not exist")
  })

  test("accepts optional fields omitted", () => {
    const result = validateWorkflowSchema({
      kind: "workflow", name: "Minimal",
      stages: [{ id: "only" }],
    })
    expect(typeof result).not.toBe("string")
  })

  test("rejects non-string checklist item", () => {
    const result = validateWorkflowSchema({
      kind: "workflow", name: "X",
      stages: [{ id: "a", checklist: [123] }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("checklist")
  })
})

// ═══════════════════════════════════════════════════════
//  State Machine
// ═══════════════════════════════════════════════════════

function makeState(workflow?: Workflow, currentStageId?: string): WorkflowState {
  const wf = workflow ?? (validateWorkflowSchema(validSchema) as Workflow)
  return {
    workflow: wf,
    currentStageId: currentStageId ?? wf.stages[0]!.id,
    startedAt: Date.now(),
    paused: false,
  }
}

describe("state machine", () => {
  test("stageIndex returns 0-based index", () => {
    const s = makeState()
    expect(stageIndex(s)).toBe(0)
    s.currentStageId = "build"
    expect(stageIndex(s)).toBe(1)
    s.currentStageId = "ship"
    expect(stageIndex(s)).toBe(2)
  })

  test("totalStages returns stage count", () => {
    expect(totalStages(makeState())).toBe(3)
  })

  test("getValidNext returns next stage for non-final", () => {
    const s = makeState(undefined, "plan")
    expect(getValidNext(s)).toEqual(["build"])
  })

  test("getValidNext returns ['done'] for final stage", () => {
    const s = makeState(undefined, "ship")
    expect(getValidNext(s)).toEqual(["done"])
  })

  test("isValidTransition accepts valid next", () => {
    const s = makeState(undefined, "plan")
    expect(isValidTransition(s, "build")).toBe(true)
    expect(isValidTransition(s, "ship")).toBe(false)
    expect(isValidTransition(s, "done")).toBe(false)
  })

  test("isValidTransition accepts 'done' on final stage", () => {
    const s = makeState(undefined, "ship")
    expect(isValidTransition(s, "done")).toBe(true)
    expect(isValidTransition(s, "build")).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════
//  Message Formatting
// ═══════════════════════════════════════════════════════

describe("formatStageMessage", () => {
  test("includes workflow name and stage", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Test WF")
    expect(msg).toContain("plan")
    expect(msg).toContain("(1/3)")
    expect(msg).toContain("Plan it")
  })

  test("includes checklist items", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("☐ item 1")
    expect(msg).toContain("☐ item 2")
  })

  test("shows next stage hint", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Next: build")
    expect(msg).toContain('workflow_advance("build")')
  })

  test("shows final stage hint", () => {
    const s = makeState(undefined, "ship")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Final stage")
    expect(msg).toContain('workflow_advance("done")')
  })

  test("includes description if present", () => {
    const s = makeState()
    const msg = formatStageMessage(s)
    expect(msg).toContain("A test workflow")
  })

  test("omits checklist section if empty", () => {
    const s = makeState(undefined, "build")
    const msg = formatStageMessage(s)
    expect(msg).not.toContain("☐")
  })
})

describe("formatCompleteMessage", () => {
  test("shows completion with stats", () => {
    const s = makeState(undefined, "ship")
    const msg = formatCompleteMessage(s)
    expect(msg).toContain("✅ Workflow Complete")
    expect(msg).toContain("3/3")
  })
})

// ═══════════════════════════════════════════════════════
//  Plugin Integration
// ═══════════════════════════════════════════════════════

describe("WorkflowPlugin", () => {
  test("package entrypoint exports plugin", async () => {
    const mod = await import("../src/index")
    expect(mod).toHaveProperty("WorkflowPlugin")
    expect(mod).toHaveProperty("default")
  })

  test("plugin exposes all hooks and tools", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)
    expect(hooks).toHaveProperty("config")
    expect(hooks).toHaveProperty("tool")
    expect(hooks.tool).toHaveProperty("workflow_load")
    expect(hooks.tool).toHaveProperty("workflow_advance")
    expect(hooks.tool).toHaveProperty("create_workflow")
    expect(hooks).toHaveProperty("event")
    expect(hooks).toHaveProperty("command.execute.before")
  })

  test("create_workflow creates a valid workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []

    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }

    const hooks = await WorkflowPlugin({ client } as any)
    const result = await hooks.tool.create_workflow.execute({
      schema: {
        kind: "workflow",
        name: "Inline WF",
        stages: [
          { id: "step1", instruction: "Do step 1", next: "step2" },
          { id: "step2", instruction: "Do step 2" },
        ],
      },
    })

    expect(result).toContain("Inline WF")
    expect(result).toContain("step1")
    expect(result).toContain("Do step 1")
    expect(toasts.some(t => t.message.includes("Workflow started"))).toBe(true)
  })

  test("create_workflow rejects invalid schema", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: { showToast: async () => undefined, clearPrompt: async () => undefined, appendPrompt: async () => undefined, submitPrompt: async () => undefined },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    const result = await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow" }, // missing name and stages
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("Schema error")
  })

  test("workflow_advance rejects with no active workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: { showToast: async () => undefined, clearPrompt: async () => undefined, appendPrompt: async () => undefined, submitPrompt: async () => undefined },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    const result = await hooks.tool.workflow_advance.execute({ stage: "anything" })
    expect(result).toContain("No active workflow")
  })

  test("workflow_advance validates transitions", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: { showToast: async () => undefined, clearPrompt: async () => undefined, appendPrompt: async () => undefined, submitPrompt: async () => undefined },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    // Create a workflow with 2 stages
    await hooks.tool.create_workflow.execute({
      schema: {
        kind: "workflow", name: "Test",
        stages: [
          { id: "a", next: "b" },
          { id: "b" },
        ],
      },
    })

    // Valid advance
    const result1 = await hooks.tool.workflow_advance.execute({ stage: "b" })
    expect(result1).toContain("b")
    expect(result1).toContain("(2/2)")

    // Invalid advance (already on final stage, can't go to non-existent)
    const result2 = await hooks.tool.workflow_advance.execute({ stage: "a" })
    expect(result2).toContain("Cannot advance")
    expect(result2).toContain("done")
  })

  test("workflow_advance 'done' completes workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Done Test", stages: [{ id: "only" }] },
    })

    const result = await hooks.tool.workflow_advance.execute({ stage: "done" })
    expect(result).toContain("✅ Workflow Complete")
    expect(result).toContain("Done Test")
    expect(toasts.some(t => t.message.includes("Workflow complete"))).toBe(true)

    // Verify state cleared
    const after = await hooks.tool.workflow_advance.execute({ stage: "anything" })
    expect(after).toContain("No active workflow")
  })

  test("/workflow status shows active workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    // Start a workflow
    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Status Test", stages: [{ id: "s1" }] },
    })

    // Check status via command
    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("Status Test"))).toBe(true)
    expect(toasts.some(t => t.message.includes("s1"))).toBe(true)
  })

  test("/workflow status shows error when idle", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("No active workflow"))).toBe(true)
  })

  test("/workflow stop clears active workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Stop Test", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "stop" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("stopped"))).toBe(true)

    // Verify cleared
    const result = await hooks.tool.workflow_advance.execute({ stage: "done" })
    expect(result).toContain("No active workflow")
  })

  test("event: session.created auto-stops workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Session Test", stages: [{ id: "s1" }] },
    })

    await hooks.event?.({ event: { type: "session.created", data: { sessionID: "new" } } } as any)

    expect(toasts.some(t => t.message.includes("auto-stopped"))).toBe(true)
    expect(toasts.some(t => t.message.includes("Session Test"))).toBe(true)

    const result = await hooks.tool.workflow_advance.execute({ stage: "done" })
    expect(result).toContain("No active workflow")
  })

  test("event: session.created with no workflow is no-op", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.event?.({ event: { type: "session.created", data: { sessionID: "s2" } } } as any)
    expect(toasts.some(t => t.message.includes("auto-stopped"))).toBe(false)
  })

  test("event: message.updated cancels dwell (no throw)", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Event Test", stages: [{ id: "s1" }] },
    })

    await hooks.event?.({ event: { type: "message.updated", properties: { info: { role: "assistant" } } } } as any)
    // Should not throw
  })

  test("event: session.idle starts dwell (no throw)", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Idle Test", stages: [{ id: "s1" }] },
    })

    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } } as any)
    // Should not throw — dwell starts in background
  })

  // ═══════════════════════════════════════════════════════
  //  Pause / Resume
  // ═══════════════════════════════════════════════════════

  test("/workflow pause suspends active workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Pause Test", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "pause" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("paused"))).toBe(true)
  })

  test("/workflow pause errors when already paused", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Double Pause", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "pause" }),
    ).rejects.toThrow()
    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "pause" }),
    ).rejects.toThrow()

    expect(toasts.some(t => t.message.includes("already paused"))).toBe(true)
  })

  test("/workflow resume continues paused workflow", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Resume Test", stages: [{ id: "s1" }] },
    })

    // Pause
    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "pause" }),
    ).rejects.toThrow()

    // Resume
    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "resume" }),
    ).rejects.toThrow()

    expect(toasts.some(t => t.message.includes("resumed"))).toBe(true)

    // Can still advance after resume
    const result = await hooks.tool.workflow_advance.execute({ stage: "done" })
    expect(result).toContain("✅")
  })

  test("/workflow resume errors when not paused", async () => {
    const { WorkflowPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Not Paused", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "resume" }),
    ).rejects.toThrow()

    expect(toasts.some(t => t.message.includes("not paused"))).toBe(true)
  })

  test("workflow_advance works while paused (implicitly unpauses)", async () => {
    // Advancing should work even when paused — the agent can always move forward
    const { WorkflowPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await WorkflowPlugin({ client } as any)

    await hooks.tool.create_workflow.execute({
      schema: { kind: "workflow", name: "Advance Unpause", stages: [
        { id: "a", next: "b" },
        { id: "b" },
      ]},
    })

    // Pause
    await expect(
      hooks["command.execute.before"]?.({ command: "workflow", arguments: "pause" }),
    ).rejects.toThrow()

    // Advance should still work
    const result = await hooks.tool.workflow_advance.execute({ stage: "b" })
    expect(result).toContain("b")
  })

  // ═══════════════════════════════════════════════════════
  //  File-based loading
  // ═══════════════════════════════════════════════════════

  test("resolveWorkflowFile finds .yaml files", () => {
    const resolved = resolveWorkflowFile("deploy-feature")
    expect(resolved).toBeTruthy()
    expect(resolved).toContain("deploy-feature")
  })

  test("resolveWorkflowFile adds .yaml extension", () => {
    const resolved = resolveWorkflowFile("deploy-feature")
    expect(resolved).toBeTruthy()
    expect(resolved).toContain(".yaml")
  })

  test("resolveWorkflowFile returns null for nonexistent file", () => {
    expect(resolveWorkflowFile("nonexistent")).toBeNull()
  })

  test("resolveWorkflowFile blocks path traversal", () => {
    expect(resolveWorkflowFile("../etc/passwd")).toBeNull()
    expect(resolveWorkflowFile("sub/dir/file")).toBeNull()
  })

  test("listWorkflowFiles returns filenames", () => {
    const files = listWorkflowFiles()
    expect(files).toContain("deploy-feature.yaml")
  })
})
