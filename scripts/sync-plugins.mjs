#!/usr/bin/env node
/**
 * sync-plugins.mjs — Writes the plugin re-export file into
 * .opencode/plugins/ so OpenCode picks it up locally.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const PLUGIN_DIR = resolve(root, ".opencode", "plugins")
const PLUGIN_FILE = resolve(PLUGIN_DIR, "opencode-workflows.ts")

const RE_EXPORT_CONTENT = `/**
 * opencode-workflows — linear stage enforcement plugin
 *
 * OpenCode auto-loads .ts files from its plugins directory.
 * This file re-exports the plugin from the project source.
 */
export { WorkflowPlugin, default } from "../../src/index"
`

if (!existsSync(PLUGIN_DIR)) {
  mkdirSync(PLUGIN_DIR, { recursive: true })
}

writeFileSync(PLUGIN_FILE, RE_EXPORT_CONTENT, "utf8")
console.log(`Synced plugin to ${PLUGIN_FILE}`)
