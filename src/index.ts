// ═══════════════════════════════════════════════════════
//  Quest Plugin — labeled multi-next branching + context.
//  Pattern: TUI injection + idle-driven re-fire.
//  Prison-grade: agent cannot exit until quest complete.
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
  description?: string
  instruction?: string
  checklist?: string[]
  context?: string
  /** Next stage(s). String = shorthand for {default: target}. Record = labeled exits. */
  next?: string | Record<string, string>
}

type Quest = {
  name: string
  description?: string
  context?: string
  stages: Stage[]
}

type QuestState = {
  quest: Quest
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

function resolveQuestFile(file: string): string | null {
  const dir = join(process.cwd(), AGENTS_DIR)
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

function resolveQuestByName(name: string): { quest: Quest; path: string } | string {
  const dir = join(process.cwd(), AGENTS_DIR)
  if (!existsSync(dir)) return `No quest found with name "${name}". (${AGENTS_DIR}/ doesn't exist)`

  const files: string[] = []
  try { files.push(...readdirSync(dir)) } catch { return `Cannot read ${AGENTS_DIR}/.` }

  const yamlFiles = files.filter(f => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes(".."))
  const target = name.trim().toLowerCase()

  for (const file of yamlFiles) {
    const fullPath = join(dir, file)
    try {
      const content = readFileSync(fullPath, "utf8")
      const doc = parseYaml(content)
      if (doc && doc.kind === "quest" && typeof doc.name === "string" && doc.name.trim().toLowerCase() === target) {
        const result = validateQuestSchema(doc)
        if (typeof result === "string") continue
        return { quest: result, path: fullPath }
      }
    } catch { continue }
  }

  return `No quest found with name "${name}". Available files: ${yamlFiles.map(f => `"${f}"`).join(", ") || "(none)"}`
}

function loadQuestFromFile(file: string): { quest: Quest; path: string } | string {
  const resolved = resolveQuestFile(file)
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

function listQuestFiles(): string[] {
  const dir = join(process.cwd(), AGENTS_DIR)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes(".."))
  } catch { return [] }
}

// ── helpers: schema validation ──

function validateQuestSchema(doc: any): Quest | string {
  if (!doc || typeof doc !== "object") return "Schema error: expected an object."
  if (doc.kind !== "quest") return `Schema error: kind must be "quest".`
  if (typeof doc.name !== "string" || !doc.name.trim()) return "Schema error: name is required."
  if (doc.description !== undefined && typeof doc.description !== "string") return "Schema error: description must be a string."
  if (doc.context !== undefined && typeof doc.context !== "string") return "Schema error: context must be a string."
  if (!Array.isArray(doc.stages) || doc.stages.length === 0) return "Schema error: stages must be a non-empty array."

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

// ── helpers: state machine ──

function getCurrentStage(state: QuestState): Stage | undefined {
  return state.quest.stages.find(s => s.id === state.currentStageId)
}

function getValidNext(state: QuestState): string[] {
  const stage = getCurrentStage(state)
  if (!stage?.next) return ["done"]
  return Object.values(stage.next)
}

function getNextLabels(state: QuestState): Record<string, string> | undefined {
  return getCurrentStage(state)?.next
}

function isValidTransition(state: QuestState, targetId: string): boolean {
  return getValidNext(state).includes(targetId)
}

function stageIndex(state: QuestState): number {
  return state.quest.stages.findIndex(s => s.id === state.currentStageId)
}

function totalStages(state: QuestState): number {
  return state.quest.stages.length
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

function formatStageMessage(state: QuestState): string {
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

function formatCompleteMessage(state: QuestState): string {
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

export const QuestPlugin: Plugin = async ({ client }: any) => {
  let state: QuestState | null = null
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
      toast(`Quest fail: ${e.message}`, "error")
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
        toast(`Quest: ${state.quest.name} | Stage: ${stage?.id ?? "?"} (${idx}/${total}) | ${elapsed} | ${status}`, "info", 4000)
      }, HEARTBEAT_MS)
    } else if (!state && hb) {
      clearInterval(hb)
      hb = null
    }
  }

  const startQuest = (quest: Quest) => {
    clear()
    state = {
      quest,
      currentStageId: quest.stages[0]!.id,
      startedAt: Date.now(),
      paused: false,
    }
    refreshHb()
    toast(`Quest started: "${quest.name}"`, "info", 4000)
  }

  // ── hooks ──

  return {
    config: async (cfg: any) => {
      cfg.command ??= {}
      cfg.command.quest = {
        template: "[status|pause|resume|stop]",
        description: "Show active quest status",
      }
    },

    tool: {
      quest: tool({
        description: `Start a quest. No args = help. Use file: to load by filename, name: to find by quest name, or schema: to create inline.`,
        args: {
          file: z.string().optional().describe(`Load from ${AGENTS_DIR}/name.yaml (matches filename).`),
          name: z.string().optional().describe("Find and load a quest by its name field (case-insensitive, scans all .yaml files)."),
          schema: z.record(z.string(), z.any()).optional().describe("Create inline from schema object."),
        },
        execute: async (args: { file?: string; name?: string; schema?: Record<string, any> }) => {
          // ── file mode ──
          if (args.file !== undefined && args.file !== "") {
            const result = loadQuestFromFile(args.file.trim())
            if (typeof result === "string") {
              const files = listQuestFiles()
              const hint = files.length > 0 ? ` Available files: ${files.join(", ")}` : ` No .yaml files in ${AGENTS_DIR}/.`
              return result + hint
            }
            startQuest(result.quest)
            return `Quest "${result.quest.name}" loaded from ${result.path}.\n\n${formatStageMessage(state!)}`
          }

          // ── name mode ──
          if (args.name !== undefined && args.name !== "") {
            const result = resolveQuestByName(args.name.trim())
            if (typeof result === "string") return result
            startQuest(result.quest)
            return `Quest "${result.quest.name}" loaded from ${result.path}.\n\n${formatStageMessage(state!)}`
          }

          // ── schema mode ──
          if (args.schema !== undefined) {
            const result = validateQuestSchema(args.schema)
            if (typeof result === "string") return result
            startQuest(result)
            return `Quest "${result.name}" created.\n\n${formatStageMessage(state!)}`
          }

          // ── help mode ──
          const files = listQuestFiles()
          const fileList = files.length > 0
            ? files.map(f => `  - ${f}`).join("\n")
            : `  (no .yaml files in ${AGENTS_DIR}/)`
          return `quest — start or manage a quest.

Usage:
  quest()                  → this help
  quest(file: "filename")  → load from ${AGENTS_DIR}/filename.yaml
  quest(name: "Quest Name")→ find by quest name (scans all files)
  quest(schema: {...})     → create inline from schema object

Available quest files:
${fileList}

Active quest commands: /quest [status|pause|resume|stop]`
        },
      }),

      quest_advance: tool({
        description: `Advance to the next stage. Pass "done" on the final stage to complete the quest.`,
        args: {
          stage: z.string().describe("Stage id to advance to. Use 'done' on final stage."),
        },
        execute: async (args: { stage: string }) => {
          if (!state) return "No active quest. Use quest() to start one."

          const target = args.stage.trim()
          if (!isValidTransition(state, target)) {
            const valid = getValidNext(state)
            return `Cannot advance to "${target}". Expected: ${valid.map(v => `"${v}"`).join(" or ")}.`
          }

          if (target === "done") {
            const msg = formatCompleteMessage(state)
            const questName = state.quest.name
            clear()
            toast(`Quest complete: "${questName}"`, "info", 6000)
            return msg
          }

          state.currentStageId = target
          cancelDwell()
          return formatStageMessage(state)
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
          const name = state.quest.name
          clear()
          toast(`Quest auto-stopped (new session) — "${name}"`)
        }
      }
    },

    "command.execute.before": async (input: any) => {
      if (input.command !== "quest") return

      const args = (input.arguments ?? "").trim()

      if (!args || args === "status") {
        if (!state) {
          toast("No active quest.\nUse quest() to start one.", "error")
          throw new Error(HANDLED)
        }
        const msg = formatStageMessage(state)
        toast(msg.replace(/\n/g, "\n"), "info", 8000)
        throw new Error(HANDLED)
      }

      if (args === "stop") {
        if (!state) {
          toast("No active quest to stop.", "error")
          throw new Error(HANDLED)
        }
        const name = state.quest.name
        clear()
        toast(`Quest stopped — "${name}"`)
        throw new Error(HANDLED)
      }

      if (args === "pause") {
        if (!state) {
          toast("No active quest to pause.", "error")
          throw new Error(HANDLED)
        }
        if (state.paused) {
          toast("Quest is already paused.", "error")
          throw new Error(HANDLED)
        }
        state.paused = true
        cancelDwell()
        if (hb) { clearInterval(hb); hb = null }
        toast(`Quest paused — "${state.quest.name}" at stage ${state.currentStageId}`)
        throw new Error(HANDLED)
      }

      if (args === "resume") {
        if (!state) {
          toast("No quest to resume.", "error")
          throw new Error(HANDLED)
        }
        if (!state.paused) {
          toast("Quest is not paused.", "error")
          throw new Error(HANDLED)
        }
        state.paused = false
        refreshHb()
        toast(`Quest resumed — "${state.quest.name}" at stage ${state.currentStageId}`)
        throw new Error(HANDLED)
      }

      // Unknown subcommand
      toast("Usage: /quest [status|pause|resume|stop]", "error")
      throw new Error(HANDLED)
    },
  }
}

export default QuestPlugin
