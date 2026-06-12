import { describe, expect, test } from "vitest"
import {
  validateQuestSchema,
  getValidNext,
  getNextLabels,
  isValidTransition,
  stageIndex,
  totalStages,
  formatStageMessage,
  formatCompleteMessage,
  fmtElapsed,
  resolveQuestFile,
  listQuestFiles,
  type Quest,
  type QuestState,
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
//  validateQuestSchema
// ═══════════════════════════════════════════════════════

const validSchema = {
  kind: "quest",
  name: "Test Quest",
  description: "A test quest",
  context: "Repo: test. Branch: main.",
  stages: [
    { id: "plan", description: "Plan phase", instruction: "Plan it", checklist: ["item 1", "item 2"], context: "Planning only.", next: "build" },
    { id: "build", instruction: "Build it", next: "ship" },
    { id: "ship", instruction: "Ship it" },
  ],
}

describe("validateQuestSchema", () => {
  test("valid schema passes", () => {
    const result = validateQuestSchema(validSchema)
    expect(typeof result).not.toBe("string")
    if (typeof result !== "string") {
      expect(result.name).toBe("Test Quest")
      expect(result.description).toBe("A test quest")
      expect(result.context).toBe("Repo: test. Branch: main.")
      expect(result.stages).toHaveLength(3)
      expect(result.stages[0]!.checklist).toEqual(["item 1", "item 2"])
      expect(result.stages[0]!.next).toEqual({ default: "build" })
    }
  })

  test("rejects missing kind", () => {
    const result = validateQuestSchema({ name: "X", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("kind")
  })

  test("rejects wrong kind", () => {
    const result = validateQuestSchema({ kind: "task", name: "X", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("kind")
  })

  test("rejects missing name", () => {
    const result = validateQuestSchema({ kind: "quest", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("name")
  })

  test("rejects empty name", () => {
    const result = validateQuestSchema({ kind: "quest", name: "  ", stages: [{ id: "a" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("name")
  })

  test("rejects missing stages", () => {
    const result = validateQuestSchema({ kind: "quest", name: "X" })
    expect(typeof result).toBe("string")
    expect(result).toContain("stages")
  })

  test("rejects empty stages array", () => {
    const result = validateQuestSchema({ kind: "quest", name: "X", stages: [] })
    expect(typeof result).toBe("string")
    expect(result).toContain("stages")
  })

  test("rejects stage without id", () => {
    const result = validateQuestSchema({ kind: "quest", name: "X", stages: [{ instruction: "hi" }] })
    expect(typeof result).toBe("string")
    expect(result).toContain("id")
  })

  test("rejects duplicate stage ids", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [{ id: "a" }, { id: "a" }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("duplicate")
  })

  test("rejects invalid next reference", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [{ id: "a", next: "nonexistent" }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("does not exist")
  })

  test("accepts optional fields omitted", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "Minimal",
      stages: [{ id: "only" }],
    })
    expect(typeof result).not.toBe("string")
  })

  test("rejects non-string checklist item", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [{ id: "a", checklist: [123] }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("checklist")
  })

  // ═══ context validation ═══

  test("rejects non-string workflow context", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      context: 123,
      stages: [{ id: "a" }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("context")
  })

  test("rejects non-string stage context", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [{ id: "a", context: 456 }],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("context")
  })

  // ═══ multi-next validation ═══

  test("accepts labeled next as Record", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "Branching",
      stages: [
        { id: "a", next: { pass: "b", fail: "c" } },
        { id: "b" },
        { id: "c" },
      ],
    })
    expect(typeof result).not.toBe("string")
    if (typeof result !== "string") {
      expect(result.stages[0]!.next).toEqual({ pass: "b", fail: "c" })
    }
  })

  test("rejects labeled next with non-string target", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [
        { id: "a", next: { bad: 123 } },
        { id: "b" },
        { id: "c" },
      ],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("next")
    expect(result).toContain("bad")
  })

  test("rejects labeled next with empty object", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [
        { id: "a", next: {} },
        { id: "b" },
      ],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("empty")
  })

  test("rejects labeled next targeting nonexistent stage", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [
        { id: "a", next: { go: "NOEXIST" } },
      ],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("does not exist")
  })

  test("rejects next with invalid type (array)", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [
        { id: "a", next: ["b", "c"] },
        { id: "b" },
        { id: "c" },
      ],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("must be a string or an object")
  })

  test("rejects empty string next", () => {
    const result = validateQuestSchema({
      kind: "quest", name: "X",
      stages: [
        { id: "a", next: "   " },
        { id: "b" },
      ],
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("empty")
  })
})

// ═══════════════════════════════════════════════════════
//  State Machine
// ═══════════════════════════════════════════════════════

function makeState(quest?: Quest, currentStageId?: string): QuestState {
  const q = quest ?? (validateQuestSchema(validSchema) as Quest)
  return {
    quest: q,
    currentStageId: currentStageId ?? q.stages[0]!.id,
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

  // ═══ multi-next state machine ═══

  test("getValidNext returns all targets for multi-exit stage", () => {
    const schema: Quest = {
      name: "Multi",
      stages: [
        { id: "a", next: { pass: "b", fail: "c", retry: "a" } },
        { id: "b" },
        { id: "c" },
      ],
    }
    const s = makeState(schema, "a")
    const valid = getValidNext(s)
    expect(valid).toContain("b")
    expect(valid).toContain("c")
    expect(valid).toContain("a")
    // All transitions are valid
    expect(isValidTransition(s, "b")).toBe(true)
    expect(isValidTransition(s, "c")).toBe(true)
    expect(isValidTransition(s, "a")).toBe(true)
    expect(isValidTransition(s, "done")).toBe(false)
  })

  test("getNextLabels returns next map for stage with single next", () => {
    const s = makeState(undefined, "build")
    expect(getNextLabels(s)).toEqual({ default: "ship" })
  })

  test("getNextLabels returns next map for stage with labeled next", () => {
    const schema: Quest = {
      name: "Labeled",
      stages: [
        { id: "a", next: { pass: "b", fail: "c" } },
        { id: "b" },
        { id: "c" },
      ],
    }
    const s = makeState(schema, "a")
    expect(getNextLabels(s)).toEqual({ pass: "b", fail: "c" })
  })

  test("getNextLabels returns undefined for final stage", () => {
    const s = makeState(undefined, "ship")
    expect(getNextLabels(s)).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════
//  Message Formatting
// ═══════════════════════════════════════════════════════

describe("formatStageMessage", () => {
  test("includes quest name and stage", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Test Quest")
    expect(msg).toContain("plan")
    expect(msg).toContain("(1/3)")
    expect(msg).toContain("Plan it")
  })

  test("includes description if present", () => {
    const s = makeState()
    const msg = formatStageMessage(s)
    expect(msg).toContain("A test quest")
    expect(msg).toContain("Plan phase")
  })

  test("includes checklist items with loud formatting", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("☐ item 1")
    expect(msg).toContain("☐ item 2")
    expect(msg).toContain("⚠️  CHECKLIST")
    expect(msg).toContain("todowrite")
  })

  test("shows next stage hint for single exit", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Next: build")
    expect(msg).toContain('quest_advance("build")')
  })

  test("shows final stage hint", () => {
    const s = makeState(undefined, "ship")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Final stage")
    expect(msg).toContain('quest_advance("done")')
  })

  test("omits checklist section if empty", () => {
    const s = makeState(undefined, "ship")
    const msg = formatStageMessage(s)
    expect(msg).not.toContain("☐")
  })

  // ═══ context formatting ═══

  test("includes context if present", () => {
    const s = makeState(undefined, "plan")
    const msg = formatStageMessage(s)
    expect(msg).toContain("📋 Context:")
    expect(msg).toContain("Repo: test. Branch: main.")
    expect(msg).toContain("Planning only.")
  })

  test("omits context section when no context", () => {
    const schema: Quest = {
      name: "No Context",
      stages: [{ id: "a", instruction: "Do it" }],
    }
    const s = makeState(schema, "a")
    const msg = formatStageMessage(s)
    expect(msg).not.toContain("📋 Context:")
  })

  // ═══ multi-next formatting ═══

  test("shows labeled exits for multiple targets", () => {
    const schema: Quest = {
      name: "Multi Exit",
      stages: [
        { id: "a", next: { pass: "b", fail: "c", retry: "a" } },
        { id: "b" },
        { id: "c" },
      ],
    }
    const s = makeState(schema, "a")
    const msg = formatStageMessage(s)
    expect(msg).toContain("Options:")
    expect(msg).toContain("[pass]")
    expect(msg).toContain("[fail]")
    expect(msg).toContain("[retry]")
    expect(msg).toContain('quest_advance("b" or "c" or "a")')
  })
})

describe("formatCompleteMessage", () => {
  test("shows completion with stats", () => {
    const s = makeState(undefined, "ship")
    const msg = formatCompleteMessage(s)
    expect(msg).toContain("✅ Quest Complete")
    expect(msg).toContain("3/3")
  })
})

// ═══════════════════════════════════════════════════════
//  Plugin Integration
// ═══════════════════════════════════════════════════════

describe("QuestPlugin", () => {
  test("package entrypoint exports plugin", async () => {
    const mod = await import("../src/index")
    expect(mod).toHaveProperty("QuestPlugin")
    expect(mod).toHaveProperty("default")
  })

  test("plugin exposes all hooks and tools", async () => {
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)
    expect(hooks).toHaveProperty("config")
    expect(hooks).toHaveProperty("tool")
    expect(hooks.tool).toHaveProperty("quest")
    expect(hooks.tool).toHaveProperty("quest_advance")
    expect(hooks).toHaveProperty("event")
    expect(hooks).toHaveProperty("command.execute.before")
  })

  test("quest creates a valid quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []

    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }

    const hooks = await QuestPlugin({ client } as any)
    const result = await hooks.tool.quest.execute({
      schema: {
        kind: "quest",
        name: "Inline Quest",
        stages: [
          { id: "step1", instruction: "Do step 1", next: "step2" },
          { id: "step2", instruction: "Do step 2" },
        ],
      },
    })

    expect(result).toContain("Inline Quest")
    expect(result).toContain("step1")
    expect(result).toContain("Do step 1")
    expect(toasts.some(t => t.message.includes("Quest started"))).toBe(true)
  })

  test("create_quest rejects invalid schema", async () => {
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: { showToast: async () => undefined, clearPrompt: async () => undefined, appendPrompt: async () => undefined, submitPrompt: async () => undefined },
    }
    const hooks = await QuestPlugin({ client } as any)

    const result = await hooks.tool.quest.execute({
      schema: { kind: "quest" }, // missing name and stages
    })
    expect(typeof result).toBe("string")
    expect(result).toContain("Schema error")
  })

  test("quest_advance rejects with no active quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: { showToast: async () => undefined, clearPrompt: async () => undefined, appendPrompt: async () => undefined, submitPrompt: async () => undefined },
    }
    const hooks = await QuestPlugin({ client } as any)

    const result = await hooks.tool.quest_advance.execute({ stage: "anything" })
    expect(result).toContain("No active quest")
    expect(result).toContain("quest()")
  })

  test("quest_advance validates transitions", async () => {
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: { showToast: async () => undefined, clearPrompt: async () => undefined, appendPrompt: async () => undefined, submitPrompt: async () => undefined },
    }
    const hooks = await QuestPlugin({ client } as any)

    // Create a quest with 2 stages
    await hooks.tool.quest.execute({
      schema: {
        kind: "quest", name: "Test",
        stages: [
          { id: "a", next: "b" },
          { id: "b" },
        ],
      },
    })

    // Valid advance
    const result1 = await hooks.tool.quest_advance.execute({ stage: "b" })
    expect(result1).toContain("b")
    expect(result1).toContain("(2/2)")

    // Invalid advance (already on final stage, can't go to non-existent)
    const result2 = await hooks.tool.quest_advance.execute({ stage: "a" })
    expect(result2).toContain("Cannot advance")
    expect(result2).toContain("done")
  })

  test("quest_advance 'done' completes quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Done Test", stages: [{ id: "only" }] },
    })

    const result = await hooks.tool.quest_advance.execute({ stage: "done" })
    expect(result).toContain("✅ Quest Complete")
    expect(result).toContain("Done Test")
    expect(toasts.some(t => t.message.includes("Quest complete"))).toBe(true)

    // Verify state cleared
    const after = await hooks.tool.quest_advance.execute({ stage: "anything" })
    expect(after).toContain("No active quest")
  })

  test("/quest status shows active quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    // Start a quest
    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Status Test", stages: [{ id: "s1" }] },
    })

    // Check status via command
    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("Status Test"))).toBe(true)
    expect(toasts.some(t => t.message.includes("s1"))).toBe(true)
  })

  test("/quest status shows error when idle", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("No active quest"))).toBe(true)
  })

  test("/quest stop clears active quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Stop Test", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "stop" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("stopped"))).toBe(true)

    // Verify cleared
    const result = await hooks.tool.quest_advance.execute({ stage: "done" })
    expect(result).toContain("No active quest")
  })

  test("event: session.created auto-stops quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Session Test", stages: [{ id: "s1" }] },
    })

    await hooks.event?.({ event: { type: "session.created", data: { sessionID: "new" } } } as any)

    expect(toasts.some(t => t.message.includes("auto-stopped"))).toBe(true)
    expect(toasts.some(t => t.message.includes("Session Test"))).toBe(true)

    const result = await hooks.tool.quest_advance.execute({ stage: "done" })
    expect(result).toContain("No active quest")
  })

  test("event: session.created with no quest is no-op", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.event?.({ event: { type: "session.created", data: { sessionID: "s2" } } } as any)
    expect(toasts.some(t => t.message.includes("auto-stopped"))).toBe(false)
  })

  test("event: message.updated cancels dwell (no throw)", async () => {
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Event Test", stages: [{ id: "s1" }] },
    })

    await hooks.event?.({ event: { type: "message.updated", properties: { info: { role: "assistant" } } } } as any)
    // Should not throw
  })

  test("event: session.idle starts dwell (no throw)", async () => {
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Idle Test", stages: [{ id: "s1" }] },
    })

    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "s1" } } } as any)
    // Should not throw — dwell starts in background
  })

  // ═══════════════════════════════════════════════════════
  //  Pause / Resume
  // ═══════════════════════════════════════════════════════

  test("/quest pause suspends active quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Pause Test", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "pause" }),
    ).rejects.toThrow("__WF_HANDLED__")

    expect(toasts.some(t => t.message.includes("paused"))).toBe(true)
  })

  test("/quest pause errors when already paused", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Double Pause", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "pause" }),
    ).rejects.toThrow()
    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "pause" }),
    ).rejects.toThrow()

    expect(toasts.some(t => t.message.includes("already paused"))).toBe(true)
  })

  test("/quest resume continues paused quest", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Resume Test", stages: [{ id: "s1" }] },
    })

    // Pause
    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "pause" }),
    ).rejects.toThrow()

    // Resume
    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "resume" }),
    ).rejects.toThrow()

    expect(toasts.some(t => t.message.includes("resumed"))).toBe(true)

    // Can still advance after resume
    const result = await hooks.tool.quest_advance.execute({ stage: "done" })
    expect(result).toContain("✅")
  })

  test("/quest resume errors when not paused", async () => {
    const { QuestPlugin } = await import("../src/index")
    const toasts: any[] = []
    const client = {
      tui: {
        showToast: async (input: any) => void toasts.push(input.body),
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Not Paused", stages: [{ id: "s1" }] },
    })

    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "resume" }),
    ).rejects.toThrow()

    expect(toasts.some(t => t.message.includes("not paused"))).toBe(true)
  })

  test("quest_advance works while paused (implicitly unpauses)", async () => {
    // Advancing should work even when paused — the agent can always move forward
    const { QuestPlugin } = await import("../src/index")
    const client = {
      tui: {
        showToast: async () => undefined,
        clearPrompt: async () => undefined,
        appendPrompt: async () => undefined,
        submitPrompt: async () => undefined,
      },
    }
    const hooks = await QuestPlugin({ client } as any)

    await hooks.tool.quest.execute({
      schema: { kind: "quest", name: "Advance Unpause", stages: [
        { id: "a", next: "b" },
        { id: "b" },
      ]},
    })

    // Pause
    await expect(
      hooks["command.execute.before"]?.({ command: "quest", arguments: "pause" }),
    ).rejects.toThrow()

    // Advance should still work
    const result = await hooks.tool.quest_advance.execute({ stage: "b" })
    expect(result).toContain("b")
  })

  // ═══════════════════════════════════════════════════════
  //  File-based loading
  // ═══════════════════════════════════════════════════════

  test("resolveQuestFile finds .yaml files", () => {
    const resolved = resolveQuestFile("deploy-feature")
    expect(resolved).toBeTruthy()
    expect(resolved).toContain("deploy-feature")
  })

  test("resolveQuestFile adds .yaml extension", () => {
    const resolved = resolveQuestFile("deploy-feature")
    expect(resolved).toBeTruthy()
    expect(resolved).toContain(".yaml")
  })

  test("resolveQuestFile returns null for nonexistent file", () => {
    expect(resolveQuestFile("nonexistent")).toBeNull()
  })

  test("resolveQuestFile blocks path traversal", () => {
    expect(resolveQuestFile("../etc/passwd")).toBeNull()
    expect(resolveQuestFile("sub/dir/file")).toBeNull()
  })

  test("listQuestFiles returns filenames", () => {
    const files = listQuestFiles()
    expect(files).toContain("deploy-feature.yaml")
  })
})
