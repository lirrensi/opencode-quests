// ═══════════════════════════════════════════════════════
//  Workflow Plugin — test helpers.
//  Exported pure functions for unit tests.
//  Stripped by deploy.mjs on install.
// ═══════════════════════════════════════════════════════

import { execSync } from "child_process"
import { parse as parseYaml } from "yaml"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

// ── types ──

export type Stage = {
  id: string
  instruction?: string
  checklist?: string[]
  next?: string
}

export type Workflow = {
  name: string
  description?: string
  stages: Stage[]
}

export type WorkflowState = {
  workflow: Workflow
  currentStageId: string
  startedAt: number
  paused: boolean
}

// ── constants ──

export const AGENTS_DIR = ".agents"
export const MAX_BACKTICK_OUTPUT_LENGTH = 2_000
export const DWELL_MS = 10_000

// ── yaml loading ──

export function resolveWorkflowFile(file: string, cwd?: string): string | null {
  const dir = join(cwd ?? process.cwd(), AGENTS_DIR)
  const candidates = [file]
  if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
    candidates.push(`${file}.yaml`, `${file}.yml`)
  }
  for (const name of candidates) {
    if (name.includes("..") || name.includes("/") || name.includes("\\")) continue
    const fullPath = join(dir, name)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

export function loadWorkflowFromFile(file: string, cwd?: string): { workflow: Workflow; path: string } | string {
  const resolved = resolveWorkflowFile(file, cwd)
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

export function listWorkflowFiles(cwd?: string): string[] {
  const dir = join(cwd ?? process.cwd(), AGENTS_DIR)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes(".."))
  } catch { return [] }
}

// ── schema validation ──

export function validateWorkflowSchema(doc: any): Workflow | string {
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
  }

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

// ── state machine ──

export function getCurrentStage(state: WorkflowState): Stage | undefined {
  return state.workflow.stages.find(s => s.id === state.currentStageId)
}

export function getValidNext(state: WorkflowState): string[] {
  const stage = getCurrentStage(state)
  if (!stage?.next) return ["done"]
  return [stage.next]
}

export function isValidTransition(state: WorkflowState, targetId: string): boolean {
  return getValidNext(state).includes(targetId)
}

export function stageIndex(state: WorkflowState): number {
  return state.workflow.stages.findIndex(s => s.id === state.currentStageId)
}

export function totalStages(state: WorkflowState): number {
  return state.workflow.stages.length
}

// ── formatting ──

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60), h = Math.floor(m / 60)
  if (s < 60) return `${s}s`
  if (m < 60) return `${m}m`
  if (m % 60 === 0) return `${h}h`
  return `${h}h ${m % 60}m`
}

export function formatStageMessage(state: WorkflowState): string {
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

export function formatCompleteMessage(state: WorkflowState): string {
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

// ── backtick eval ──

export function evaluateBackticks(message: string): string {
  return message.replace(/`([^`]+)`/g, (_match, rawCommand: string) => {
    const cmd = rawCommand.trim()
    if (!cmd) return ""
    try {
      const stdout = execSync(cmd, {
        encoding: "utf-8", timeout: 30_000, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as string
      const output = stdout.trim()
      if (!output) return "(no output)"
      if (output.length > MAX_BACKTICK_OUTPUT_LENGTH) {
        return output.slice(0, MAX_BACKTICK_OUTPUT_LENGTH) +
          `\n… [truncated, ${output.length} total chars]`
      }
      return output
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return `(error: ${msg.split("\n")[0]!.trim()})`
    }
  })
}
