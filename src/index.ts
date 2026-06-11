// ═══════════════════════════════════════════════════════
//  Workflow Plugin — linear stage enforcement.
//  Pattern: TUI injection + idle-driven re-fire.
//  Prison-grade: agent cannot exit until workflow complete.
// ═══════════════════════════════════════════════════════

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { parse as parseYaml } from "yaml"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const z = tool.schema

// ── types ──

type Stage = {
  id: string
  instruction?: string
  checklist?: string[]
  next?: string
}

type Workflow = {
  name: string
  description?: string
  stages: Stage[]
}

type WorkflowState = {
  workflow: Workflow
  currentStageId: string
  startedAt: number
  paused: boolean
}

// ── constants ──

const DWELL_MS = 10_000
const HEARTBEAT_MS = 10_000
const FIRE_DEFER_MS = 100
const HANDLED = "__WF_HANDLED__"
const AGENTS_DIR = ".agents"

// ── helpers: yaml loading ──

function resolveWorkflowFile(file: string): string | null {
  const dir = join(process.cwd(), AGENTS_DIR)
  // Try exact path, then with .yaml, then with .yml
  const candidates = [file]
  if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
    candidates.push(`${file}.yaml`, `${file}.yml`)
  }
  for (const name of candidates) {
    // Security: prevent path traversal
    if (name.includes("..") || name.includes("/") || name.includes("\\")) continue
    const fullPath = join(dir, name)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

function loadWorkflowFromFile(file: string): { workflow: Workflow; path: string } | string {
  const resolved = resolveWorkflowFile(file)
  if (!resolved) return `No workflow file found: ${AGENTS_DIR}/${file}`

  let doc: any
  try {
    const content = readFileSync(resolved, "utf8")
    doc = parseYaml(content)
  } catch (e: any) {
    return `Failed to parse ${resolved}: ${e.message}`
  }

  if (!doc || doc.kind !== "workflow") {
    return `File ${resolved} is not a workflow (missing or wrong "kind" field).`
  }

  const result = validateWorkflowSchema(doc)
  if (typeof result === "string") return result
  return { workflow: result, path: resolved }
}

function listWorkflowFiles(): string[] {
  const dir = join(process.cwd(), AGENTS_DIR)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes(".."))
  } catch { return [] }
}

// ── helpers: schema validation ──

function validateWorkflowSchema(doc: any): Workflow | string {
  if (!doc || typeof doc !== "object") return "Schema error: expected an object."
  if (doc.kind !== "workflow") return `Schema error: kind must be "workflow".`
  if (typeof doc.name !== "string" || !doc.name.trim()) return "Schema error: name is required."
  if (!Array.isArray(doc.stages) || doc.stages.length === 0) return "Schema error: stages must be a non-empty array."

  const stageIds = new Set<string>()
  for (let i = 0; i < doc.stages.length; i++) {
    const s = doc.stages[i]
    if (!s || typeof s !== "object") return `Schema error: stages[${i}] must be an object.`
    if (typeof s.id !== "string" || !s.id.trim()) return `Schema error: stages[${i}].id is required.`
    if (stageIds.has(s.id)) return `Schema error: duplicate stage id "${s.id}".`
    stageIds.add(s.id)
    if (s.instruction !== undefined && typeof s.instruction !== "string") return `Schema error: stages[${i}].instruction must be a string.`
    if (s.checklist !== undefined) {
      if (!Array.isArray(s.checklist)) return `Schema error: stages[${i}].checklist must be an array.`
      for (let j = 0; j < s.checklist.length; j++) {
        if (typeof s.checklist[j] !== "string") return `Schema error: stages[${i}].checklist[${j}] must be a string.`
      }
    }
    if (s.next !== undefined && typeof s.next !== "string") return `Schema error: stages[${i}].next must be a string.`
    if (s.next !== undefined && !stageIds.has(s.next) && i < doc.stages.length - 1) {
      // next points to a future stage that hasn't been seen yet — validate at end
    }
  }

  // Validate all next references point to existing stages
  for (const s of doc.stages) {
    if (s.next && !stageIds.has(s.next)) {
      return `Schema error: stage "${s.id}" next="${s.next}" but stage "${s.next}" does not exist.`
    }
  }

  return {
    name: doc.name.trim(),
    description: typeof doc.description === "string" ? doc.description.trim() : undefined,
    stages: doc.stages.map((s: any) => ({
      id: s.id.trim(),
      instruction: s.instruction?.trim(),
      checklist: s.checklist?.map((c: string) => c.trim()),
      next: s.next?.trim(),
    })),
  }
}

// ── helpers: state machine ──

function getCurrentStage(state: WorkflowState): Stage | undefined {
  return state.workflow.stages.find(s => s.id === state.currentStageId)
}

function getValidNext(state: WorkflowState): string[] {
  const stage = getCurrentStage(state)
  if (!stage?.next) return ["done"]
  return [stage.next]
}

function isValidTransition(state: WorkflowState, targetId: string): boolean {
  return getValidNext(state).includes(targetId)
}

function stageIndex(state: WorkflowState): number {
  return state.workflow.stages.findIndex(s => s.id === state.currentStageId)
}

function totalStages(state: WorkflowState): number {
  return state.workflow.stages.length
}

// ── helpers: formatting ──

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60), h = Math.floor(m / 60)
  if (s < 60) return `${s}s`
  if (m < 60) return `${m}m`
  if (m % 60 === 0) return `${h}h`
  return `${h}h ${m % 60}m`
}

function formatStageMessage(state: WorkflowState): string {
  const stage = getCurrentStage(state)
  const idx = stageIndex(state) + 1
  const total = totalStages(state)
  const lines: string[] = []

  lines.push("━".repeat(40))
  lines.push(`Workflow: ${state.workflow.name}`)
  if (state.workflow.description) lines.push(state.workflow.description)
  lines.push("━".repeat(40))
  lines.push(`Stage: ${stage?.id ?? "?"} (${idx}/${total})`)
  lines.push("")

  if (stage?.instruction) {
    lines.push(stage.instruction)
    lines.push("")
  }

  if (stage?.checklist && stage.checklist.length > 0) {
    lines.push("Checklist (use todowrite to track):")
    for (const item of stage.checklist) {
      lines.push(`  ☐ ${item}`)
    }
    lines.push("")
  }

  const validNext = getValidNext(state)
  if (validNext[0] === "done") {
    lines.push("━".repeat(40))
    lines.push('→ Final stage. Call workflow_advance("done") to complete.')
  } else {
    lines.push("━".repeat(40))
    lines.push(`→ Next: ${validNext[0]}`)
    lines.push(`  Call workflow_advance("${validNext[0]}") when ready.`)
  }
  lines.push("━".repeat(40))

  return lines.join("\n")
}

function formatCompleteMessage(state: WorkflowState): string {
  const total = totalStages(state)
  const elapsed = fmtElapsed(Date.now() - state.startedAt)
  const lines: string[] = []
  lines.push("━".repeat(40))
  lines.push(`✅ Workflow Complete: ${state.workflow.name}`)
  lines.push(`   ${total}/${total} stages finished.`)
  lines.push(`   Started: ${elapsed} ago.`)
  lines.push("━".repeat(40))
  return lines.join("\n")
}

// ── helpers: backtick eval ──

const MAX_BACKTICK_OUTPUT_LENGTH = 2_000

function evaluateBackticks(msg: string): string {
  return msg.replace(/`([^`]+)`/g, (_m: string, cmd: string) => {
    const c = cmd.trim()
    if (!c) return ""
    try {
      const o = (execSync(c, {
        encoding: "utf-8", timeout: 30_000, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as string).trim()
      if (!o) return "(no output)"
      if (o.length > MAX_BACKTICK_OUTPUT_LENGTH) {
        return o.slice(0, MAX_BACKTICK_OUTPUT_LENGTH) +
          `\n… [truncated, ${o.length} total chars]`
      }
      return o
    } catch (e: any) {
      return `(error: ${e.message.split("\n")[0]})`
    }
  })
}

// ═══════════════════════════════════════════════════════
//  Plugin
// ═══════════════════════════════════════════════════════

export const WorkflowPlugin: Plugin = async ({ client }: any) => {
  let state: WorkflowState | null = null
  let dwellTimer: ReturnType<typeof setTimeout> | null = null
  let dwellStartedAt = 0
  let isIdle = false
  let inFlight = false
  let hb: ReturnType<typeof setInterval> | null = null

  // ── shared infra ──

  const toast = (m: string, v = "info", d = 5000) =>
    client.tui.showToast({ body: { message: m, variant: v, duration: d } }).catch(() => {})

  const cancelDwell = () => {
    if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; dwellStartedAt = 0 }
  }

  const startDwell = () => {
    if (!state || state.paused) return
    cancelDwell()
    dwellStartedAt = Date.now()
    dwellTimer = setTimeout(() => {
      dwellTimer = null
      dwellStartedAt = 0
      if (!state || state.paused) return
      fireReminder()
    }, DWELL_MS)
  }

  const fire = async (message: string) => {
    if (inFlight) return
    inFlight = true
    try {
      const msg = evaluateBackticks(message)
      await client.tui.clearPrompt()
      await client.tui.appendPrompt({ body: { text: msg } })
      await client.tui.submitPrompt()
    } catch (e: any) {
      toast(`Workflow fail: ${e.message}`, "error")
    } finally {
      inFlight = false
    }
  }

  const fireReminder = () => {
    if (!state) return
    return fire(formatStageMessage(state))
  }

  const clear = () => {
    cancelDwell()
    state = null
    inFlight = false
    isIdle = false
    if (hb) { clearInterval(hb); hb = null }
  }

  const refreshHb = () => {
    if (state && !state.paused && !hb) {
      hb = setInterval(() => {
        if (!state || state.paused) return
        const elapsed = fmtElapsed(Date.now() - state.startedAt)
        const dwellLeft = dwellStartedAt > 0
          ? Math.round((DWELL_MS - (Date.now() - dwellStartedAt)) / 1000)
          : 0
        const status = dwellStartedAt > 0
          ? `⏳ dwell ${dwellLeft}s → remind`
          : isIdle ? "🟢 idle" : "🔴 active"
        const stage = getCurrentStage(state)
        const idx = stageIndex(state) + 1
        const total = totalStages(state)
        toast(`Workflow: ${state.workflow.name} | Stage: ${stage?.id ?? "?"} (${idx}/${total}) | ${elapsed} | ${status}`, "info", 4000)
      }, HEARTBEAT_MS)
    } else if (!state && hb) {
      clearInterval(hb)
      hb = null
    }
  }

  const startWorkflow = (workflow: Workflow) => {
    clear()
    state = {
      workflow,
      currentStageId: workflow.stages[0]!.id,
      startedAt: Date.now(),
      paused: false,
    }
    refreshHb()
    toast(`Workflow started: "${workflow.name}"`, "info", 4000)
  }

  // ── hooks ──

  return {
    config: async (cfg: any) => {
      cfg.command ??= {}
      cfg.command.workflow = {
        template: "[status|pause|resume|stop]",
        description: "Show active workflow status",
      }
    },

    tool: {
      workflow_load: tool({
        description: `Load a workflow from ${AGENTS_DIR}/<file>.yaml. Pass the filename (with or without .yaml extension).`,
        args: {
          file: z.string().describe(`Workflow filename in ${AGENTS_DIR}/ (e.g. "deploy-feature" or "deploy-feature.yaml")`),
        },
        execute: async (args: { file: string }) => {
          const result = loadWorkflowFromFile(args.file.trim())
          if (typeof result === "string") {
            const files = listWorkflowFiles()
            const hint = files.length > 0 ? ` Available files: ${files.join(", ")}` : ` No .yaml files in ${AGENTS_DIR}/.`
            return result + hint
          }

          startWorkflow(result.workflow)
          return `Workflow "${result.workflow.name}" loaded from ${result.path}.\n\n${formatStageMessage(state!)}`
        },
      }),

      workflow_advance: tool({
        description: `Advance to the next stage. Pass "done" on the final stage to complete the workflow.`,
        args: {
          stage: z.string().describe("Stage id to advance to. Use 'done' on final stage."),
        },
        execute: async (args: { stage: string }) => {
          if (!state) return "No active workflow. Load one first with workflow_load."

          const target = args.stage.trim()
          if (!isValidTransition(state, target)) {
            const valid = getValidNext(state)
            return `Cannot advance to "${target}". Expected: ${valid.map(v => `"${v}"`).join(" or ")}.`
          }

          if (target === "done") {
            const msg = formatCompleteMessage(state)
            const workflowName = state.workflow.name
            clear()
            toast(`Workflow complete: "${workflowName}"`, "info", 6000)
            return msg
          }

          state.currentStageId = target
          cancelDwell()
          return formatStageMessage(state)
        },
      }),

      create_workflow: tool({
        description: `Create a workflow inline from a schema object. Format: { kind: "workflow", name: string, description?: string, stages: [{ id: string, instruction?: string, checklist?: string[], next?: string }] }. Stages are linear — each stage's next points to the following stage id. Omit next on the final stage.`,
        args: {
          schema: z.record(z.string(), z.any()).describe("Workflow schema object"),
        },
        execute: async (args: { schema: Record<string, any> }) => {
          const result = validateWorkflowSchema(args.schema)
          if (typeof result === "string") return result

          startWorkflow(result)
          return `Workflow "${result.name}" created.\n\n${formatStageMessage(state!)}`
        },
      }),
    },

    event: async ({ event }: any) => {
      const t = event.type
      const p = event.properties || event.data || {}

      if (t === "message.updated") {
        if (p?.info?.role === "assistant") {
          isIdle = false
          cancelDwell()
        }
        return
      }

      if (t === "session.idle") {
        isIdle = true
        inFlight = false
        if (state) startDwell()
      }

      if (t === "session.created") {
        if (state) {
          const name = state.workflow.name
          clear()
          toast(`Workflow auto-stopped (new session) — "${name}"`)
        }
      }
    },

    "command.execute.before": async (input: any) => {
      if (input.command !== "workflow") return

      const args = (input.arguments ?? "").trim()

      if (!args || args === "status") {
        if (!state) {
          toast("No active workflow.\nUse workflow_load to start one.", "error")
          throw new Error(HANDLED)
        }
        const msg = formatStageMessage(state)
        toast(msg.replace(/\n/g, "\n"), "info", 8000)
        throw new Error(HANDLED)
      }

      if (args === "stop") {
        if (!state) {
          toast("No active workflow to stop.", "error")
          throw new Error(HANDLED)
        }
        const name = state.workflow.name
        clear()
        toast(`Workflow stopped — "${name}"`)
        throw new Error(HANDLED)
      }

      if (args === "pause") {
        if (!state) {
          toast("No active workflow to pause.", "error")
          throw new Error(HANDLED)
        }
        if (state.paused) {
          toast("Workflow is already paused.", "error")
          throw new Error(HANDLED)
        }
        state.paused = true
        cancelDwell()
        if (hb) { clearInterval(hb); hb = null }
        toast(`Workflow paused — "${state.workflow.name}" at stage ${state.currentStageId}`)
        throw new Error(HANDLED)
      }

      if (args === "resume") {
        if (!state) {
          toast("No workflow to resume.", "error")
          throw new Error(HANDLED)
        }
        if (!state.paused) {
          toast("Workflow is not paused.", "error")
          throw new Error(HANDLED)
        }
        state.paused = false
        refreshHb()
        toast(`Workflow resumed — "${state.workflow.name}" at stage ${state.currentStageId}`)
        throw new Error(HANDLED)
      }

      // Unknown subcommand
      toast("Usage: /workflow [status|pause|resume|stop]", "error")
      throw new Error(HANDLED)
    },
  }
}

export default WorkflowPlugin
