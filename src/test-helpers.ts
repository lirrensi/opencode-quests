// ═══════════════════════════════════════════════════════
//  Quest Plugin — test helpers.
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
  description?: string
  instruction?: string
  checklist?: string[]
  context?: string
  /** Next stage(s). String = shorthand for {default: target}. Record = labeled exits. */
  next?: string | Record<string, string>
}

export type Quest = {
  name: string
  description?: string
  context?: string
  stages: Stage[]
}

export type QuestState = {
  quest: Quest
  currentStageId: string
  startedAt: number
  paused: boolean
}

// ── constants ──

export const AGENTS_DIR = ".agents"
export const MAX_BACKTICK_OUTPUT_LENGTH = 2_000
export const DWELL_MS = 10_000

// ── yaml loading ──

export function resolveQuestFile(file: string, cwd?: string): string | null {
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

export function loadQuestFromFile(file: string, cwd?: string): { quest: Quest; path: string } | string {
  const resolved = resolveQuestFile(file, cwd)
  if (!resolved) return `No quest file found: ${AGENTS_DIR}/${file}`

  let doc: any
  try {
    const content = readFileSync(resolved, "utf8")
    doc = parseYaml(content)
  } catch (e: any) {
    return `Failed to parse ${resolved}: ${e.message}`
  }

  if (!doc || doc.kind !== "quest") {
    return `File ${resolved} is not a quest (missing or wrong "kind" field).`
  }

  const result = validateQuestSchema(doc)
  if (typeof result === "string") return result
  return { quest: result, path: resolved }
}

export function listQuestFiles(cwd?: string): string[] {
  const dir = join(cwd ?? process.cwd(), AGENTS_DIR)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes(".."))
  } catch { return [] }
}

// ── schema validation ──

export function validateQuestSchema(doc: any): Quest | string {
  if (!doc || typeof doc !== "object") return "Schema error: expected an object."
  if (doc.kind !== "quest") return `Schema error: kind must be "quest".`
  if (typeof doc.name !== "string" || !doc.name.trim()) return "Schema error: name is required."
  if (doc.description !== undefined && typeof doc.description !== "string") return "Schema error: description must be a string."
  if (doc.context !== undefined && typeof doc.context !== "string") return "Schema error: context must be a string."
  if (!Array.isArray(doc.stages) || doc.stages.length === 0) return "Schema error: stages must be a non-empty array."

  // First pass — collect stage IDs and validate per-stage fields
  const stageIds = new Set<string>()
  const stageNexts: { id: string; rawNext: string | Record<string, string> | undefined }[] = []

  for (let i = 0; i < doc.stages.length; i++) {
    const s = doc.stages[i]
    if (!s || typeof s !== "object") return `Schema error: stages[${i}] must be an object.`
    if (typeof s.id !== "string" || !s.id.trim()) return `Schema error: stages[${i}].id is required.`
    if (stageIds.has(s.id)) return `Schema error: duplicate stage id "${s.id}".`
    stageIds.add(s.id)
    if (s.description !== undefined && typeof s.description !== "string") return `Schema error: stages[${i}].description must be a string.`
    if (s.instruction !== undefined && typeof s.instruction !== "string") return `Schema error: stages[${i}].instruction must be a string.`
    if (s.checklist !== undefined) {
      if (!Array.isArray(s.checklist)) return `Schema error: stages[${i}].checklist must be an array.`
      for (let j = 0; j < s.checklist.length; j++) {
        if (typeof s.checklist[j] !== "string") return `Schema error: stages[${i}].checklist[${j}] must be a string.`
      }
    }
    if (s.context !== undefined && typeof s.context !== "string") return `Schema error: stages[${i}].context must be a string.`

    // Validate next: string | Record<string, string> | undefined
    if (s.next !== undefined) {
      if (typeof s.next === "string") {
        if (!s.next.trim()) return `Schema error: stages[${i}].next cannot be empty.`
      } else if (typeof s.next === "object" && !Array.isArray(s.next)) {
        const entries = Object.entries(s.next)
        if (entries.length === 0)
          return `Schema error: stages[${i}].next cannot be empty (no labels).`
        for (const [label, target] of entries) {
          if (typeof target !== "string" || !target.trim())
            return `Schema error: stages[${i}].next["${label}"] must be a non-empty string.`
        }
      } else {
        return `Schema error: stages[${i}].next must be a string or an object with labeled exits.`
      }
    }

    stageNexts.push({ id: s.id, rawNext: s.next })
  }

  // Second pass — validate all next targets exist
  for (const { id, rawNext } of stageNexts) {
    if (rawNext === undefined) continue
    const targets: string[] = typeof rawNext === "string"
      ? [rawNext.trim()]
      : Object.values(rawNext).map((v: any) => v.trim())
    for (const target of targets) {
      if (!stageIds.has(target))
        return `Schema error: stage "${id}" next target "${target}" does not exist.`
    }
  }

  return {
    name: doc.name.trim(),
    description: typeof doc.description === "string" ? doc.description.trim() : undefined,
    context: typeof doc.context === "string" ? doc.context.trim() : undefined,
    stages: doc.stages.map((s: any) => ({
      id: s.id.trim(),
      description: typeof s.description === "string" ? s.description.trim() : undefined,
      instruction: s.instruction?.trim(),
      checklist: s.checklist?.map((c: string) => c.trim()),
      context: typeof s.context === "string" ? s.context.trim() : undefined,
      next: typeof s.next === "string"
        ? { default: s.next.trim() }
        : s.next
          ? Object.fromEntries(
              Object.entries(s.next).map(([k, v]) => [k, (v as string).trim()])
            )
          : undefined,
    })),
  }
}

// ── state machine ──

export function getCurrentStage(state: QuestState): Stage | undefined {
  return state.quest.stages.find(s => s.id === state.currentStageId)
}

export function getValidNext(state: QuestState): string[] {
  const stage = getCurrentStage(state)
  if (!stage?.next) return ["done"]
  return Object.values(stage.next)
}

export function getNextLabels(state: QuestState): Record<string, string> | undefined {
  return getCurrentStage(state)?.next
}

export function isValidTransition(state: QuestState, targetId: string): boolean {
  return getValidNext(state).includes(targetId)
}

export function stageIndex(state: QuestState): number {
  return state.quest.stages.findIndex(s => s.id === state.currentStageId)
}

export function totalStages(state: QuestState): number {
  return state.quest.stages.length
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

export function formatStageMessage(state: QuestState): string {
  const stage = getCurrentStage(state)
  const idx = stageIndex(state) + 1
  const total = totalStages(state)
  const lines: string[] = []

  // Header
  lines.push("━".repeat(40))
  lines.push(`Quest: ${state.quest.name}`)
  if (state.quest.description) lines.push(state.quest.description)
  lines.push("━".repeat(40))

  // Stage header
  if (stage?.description) {
    lines.push(`📋 Stage: ${stage.id} (${idx}/${total})`)
    lines.push(`     ${stage.description}`)
  } else {
    lines.push(`📋 Stage: ${stage?.id ?? "?"} (${idx}/${total})`)
  }
  lines.push("━".repeat(40))

  // Context block — shown every message
  if (state.quest.context || stage?.context) {
    lines.push("📋 Context:")
    if (state.quest.context) lines.push(`  ${state.quest.context}`)
    if (stage?.context) lines.push(`  ${stage.context}`)
    lines.push("━".repeat(40))
  }

  lines.push("")

  // Instruction
  if (stage?.instruction) {
    lines.push(stage.instruction)
    lines.push("")
  }

  // Checklist — loud, with todowrite directive
  if (stage?.checklist && stage.checklist.length > 0) {
    lines.push("━".repeat(40))
    lines.push("⚠️  CHECKLIST — you MUST call todowrite with these:")
    lines.push("━".repeat(40))
    for (const item of stage.checklist) {
      lines.push(`  ☐ ${item}`)
    }
    lines.push("")
  }

  // Next steps
  const validNext = getValidNext(state)
  const nextLabels = getNextLabels(state)

  lines.push("━".repeat(40))
  if (validNext[0] === "done") {
    lines.push('→ Final stage. Call quest_advance("done") to complete.')
  } else if (validNext.length === 1) {
    lines.push(`→ Next: ${validNext[0]}`)
    lines.push(`  Call quest_advance("${validNext[0]}") when ready.`)
  } else {
    lines.push("→ Options:")
    if (nextLabels) {
      const maxLabelLen = Math.max(...Object.keys(nextLabels).map(k => k.length))
      for (const [label, stageId] of Object.entries(nextLabels)) {
        lines.push(`   [${label}]${" ".repeat(maxLabelLen - label.length)} → ${stageId}`)
      }
    }
    const targets = validNext.map(v => `"${v}"`).join(" or ")
    lines.push(`  Call quest_advance(${targets}) when ready.`)
  }
  lines.push("━".repeat(40))

  return lines.join("\n")
}

export function formatCompleteMessage(state: QuestState): string {
  const total = totalStages(state)
  const elapsed = fmtElapsed(Date.now() - state.startedAt)
  const lines: string[] = []
  lines.push("━".repeat(40))
  lines.push(`✅ Quest Complete: ${state.quest.name}`)
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
