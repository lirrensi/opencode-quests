# opencode-workflows 🔒🪤✨

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Linear stage enforcement for OpenCode.** No drifting. No forgetting. No escape.

Your agent follows a workflow defined in a simple YAML file. Each stage injects fresh context — instructions, checklist, next steps — right into the chat. The agent cannot skip stages. It cannot "be done" until every stage is complete. When it goes idle mid-workflow, the plugin fires a reminder. The workflow is the only reality.

> ⚠️ **This is not a suggestion system.** The plugin enforces workflow compliance structurally — not through prompting, not through "please remember to," but through a state machine that physically prevents the agent from proceeding without calling the gate.

---

## Why Workflows? 🎯

Agents drift. They freelance. They "remember" the plan from 3000 tokens ago and quietly stop following it. They declare themselves done when they're not.

**Workflows solve this with elegant brutality:** you cannot proceed without calling `workflow_advance()`. Each stage is a gate. Each gate requires explicit passage. The agent never sees the exit until the workflow says so.

| Problem | How Workflows Fix It |
|---------|---------------------|
| Agent forgets the plan | Every stage injects fresh context — instructions, checklist, next step |
| Agent skips steps | State machine validates every transition — wrong stage → rejected |
| Agent declares "done" prematurely | `session.idle` → 10s dwell → stage reminder injected. Can't escape |
| Agent scope-creeps | Stage instructions are explicit. The checklist anchors focus |
| Context compaction erases history | Reminder re-injects context after every idle period |

---

## How It Works 🧠

```
┌─────────────────────────────────────────────────────────┐
│                    Workflow Prison                       │
│                                                          │
│  workflow_load("deploy") → stage 1 injected              │
│  agent works → finishes → session.idle                   │
│       │                                                  │
│       ├─ workflow complete? → release to user            │
│       └─ not complete? → 10s dwell → reminder injected   │
│                                                          │
│  agent calls workflow_advance("stage2")                  │
│       │                                                  │
│       ├─ valid transition? → stage 2 injected            │
│       └─ wrong stage? → "Expected: stage2. Got: stage5"  │
│                                                          │
│  final stage → workflow_advance("done") → complete ✅    │
└─────────────────────────────────────────────────────────┘
```

The plugin operates at the **TUI layer** — it puppeteers the prompt box, injecting stage context as user messages. The agent experiences these as normal turns. It has no idea it's in a prison.

---

## YAML Format 📝

Drop a `.yaml` file in `.agents/`:

```yaml
kind: workflow
name: Deploy Feature
description: "Ship a feature safely: plan → implement → verify"

stages:
  - id: plan
    instruction: "Read the ticket. List files you'll touch. NO coding yet."
    checklist:
      - "Ticket requirements understood"
      - "Affected files listed"
      - "Approach clear"
    next: implement

  - id: implement
    instruction: "Write the code. Only what was planned. No scope creep."
    checklist:
      - "All planned files modified"
      - "No unplanned files touched"
      - "Code compiles"
    next: verify

  - id: verify
    instruction: "Run tests. Review every change. Would you approve this PR?"
    checklist:
      - "All tests pass"
      - "No debug code left"
      - "Self-review passed"
    # no `next` = final stage → workflow_advance("done") completes
```

### Stage fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Stage identifier (used in `workflow_advance`) |
| `instruction` | ❌ | What the agent should do — injected as context |
| `checklist` | ❌ | Array of focus items — shown as `☐` in the reminder |
| `next` | ❌ | Next stage id. Omit on final stage. |

Linear only — no branching. Want parallel tracks? Make separate workflows.

---

## Tools 🛠️

### `workflow_load`

```
workflow_load(file: string)

Loads a workflow from .agents/<file>.yaml.
Pass the filename with or without .yaml extension.
Injects stage 1 context immediately.

→ Found:    "Workflow 'Deploy Feature' loaded. Starting stage: plan"
→ Missing:  "No workflow file found: .agents/bad-name"
             (lists available files)
```

### `workflow_advance`

```
workflow_advance(stage: string)

Advances to the given stage. State-machine validated.
Plain string (not an enum) — cache-safe.

→ Valid:     Injects next stage context
→ Invalid:   "Cannot advance to 'verify'. Expected: 'implement'."
→ Final:     workflow_advance("done") → completes, releases agent
```

### `create_workflow`

```
create_workflow(schema: object)

Creates a workflow inline. Same format as YAML but passed as JSON.
Starts immediately at stage 1.
```

---

## Commands ⌨️

| Command | What it does |
|---------|-------------|
| `/workflow status` | Show current stage, instruction, checklist, next step |
| `/workflow pause` | Suspend reminders — keep state, stop re-fire |
| `/workflow resume` | Resume reminders — pick up where you left off |
| `/workflow stop` | Clear the workflow entirely |

---

## What the Agent Sees 👁️

When a stage is loaded or a reminder fires, the agent receives:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Workflow: Deploy Feature
Ship a feature safely: plan → implement → verify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stage: implement (2/3)

Write the code. Only what was planned. No scope creep.

Checklist (use todowrite to track):
  ☐ All planned files modified
  ☐ No unplanned files touched
  ☐ Code compiles

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ Next: verify
  Call workflow_advance("verify") when ready.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Every injection is a **full context dump** — the agent never has to remember what stage it's on or what the checklist was from 10 messages ago.

On completion:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Workflow Complete: Deploy Feature
   3/3 stages finished.
   Started: 2m ago.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Design Principles 🔮

### 1. Structural enforcement, not instructional

The agent cannot skip stages because the state machine rejects invalid transitions. It's not asked to follow the workflow — the workflow is the only path available.

### 2. Fresh context, every time

Each stage injection carries the full context: what workflow, what stage, what instruction, what checklist, what's next. The agent never operates from memory.

### 3. Idle-driven persistence

When the agent finishes a turn but the workflow isn't done, a 10-second dwell timer fires. If no activity occurs, the stage reminder is injected as a new user message. The agent cannot "be done" — the plugin won't allow it.

### 4. Cache-stable tool schemas

All tool parameters are plain strings. No dynamic enums. No schema changes per workflow. The tool definitions are static forever — OpenCode's cache stays warm.

### 5. Zero prompt manipulation

The plugin never touches system prompts, agent instructions, or context injection hooks. It operates purely through TUI puppeteering — the same mechanism as typing a message and pressing Enter.

---

## Install 📦

```bash
git clone https://github.com/lirrensi/opencode-workflows.git
cd opencode-workflows
pnpm install
pnpm run deploy
```

This installs a single-file plugin to `~/.config/opencode/plugins/opencode-workflows.ts`.
OpenCode loads it automatically from there — restart to pick up changes.

Create a `.agents/` directory in your project, drop in a `.yaml` file with `kind: workflow`, and you're running.

---

## Development 🛠️

```sh
git clone https://github.com/lirrensi/opencode-workflows
cd opencode-workflows
pnpm install
pnpm typecheck   # TypeScript check
pnpm test        # 52 tests
```

---

## Architecture 🏗️

Built on the shared `opencode-plugin-template` pattern (same DNA as [ChronoLoop](https://github.com/lirrensi/opencode-chronoloop) and [PowerGoal](https://github.com/lirrensi/opencode-powergoal)):

- **TUI puppeteering** — `clearPrompt → appendPrompt → submitPrompt`
- **Dwell timer** — `session.idle → 10s → fire reminder`
- **Activity cancellation** — `message.updated → cancel dwell`
- **Cross-session safety** — `session.created → auto-stop`
- **Heartbeat toasts** — stage name + elapsed time every 10s

Single-file plugin. One export. Zero disk I/O for state (all in-memory).

---

## License 📜

MIT
