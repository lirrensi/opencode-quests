#!/usr/bin/env node
/**
 * deploy.mjs — Strips test-only exports from src/index.ts and deploys
 * a single-file plugin to ~/.config/opencode/plugins/.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const src = resolve(root, "src", "index.ts")
const pluginsDir = resolve(homedir(), ".config", "opencode", "plugins")
const dest = resolve(pluginsDir, "opencode-workflows.ts")

if (!existsSync(pluginsDir)) mkdirSync(pluginsDir, { recursive: true })

let content = readFileSync(src, "utf8")
const lines = content.split("\n")
const stripped = lines.filter(line => {
  const t = line.trim()
  if (!t.startsWith("export ")) return true
  if (t.startsWith("export const WorkflowPlugin")) return true
  return false
})

writeFileSync(dest, stripped.join("\n"), "utf8")
console.log(`Deployed to ${dest}`)
console.log("Restart OpenCode to pick up changes.")
