# opencode-quests 🔒🪤✨

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Labeled multi-next state machine for OpenCode.** No drifting. No forgetting. No escape.

Your agent follows a quest defined in a simple YAML file (or inline). Each stage injects fresh context — instruction, checklist, next steps — right into the chat. The agent cannot skip stages. It cannot "be done" until the quest completes. When it goes idle mid-quest, the plugin fires a reminder. The quest is the only reality.

> ⚠️ **This is not a suggestion system.** The plugin enforces quest compliance structurally — not through prompting, not through "please remember to," but through a state machine that physically prevents the agent from proceeding without calling the gate.

---

## Why Quests? 🎯

Agents drift. They freelance. They "remember" the plan from 3000 tokens ago and quietly stop following it. They declare themselves done when they're not.

**Quests solve this with elegant brutality:** you (or the agent) cannot proceed without calling `quest_advance()`. Each stage is a gate. Each gate requires explicit passage. The agent never sees the exit until the quest says so.

| Problem | How Quests Fix It |
|---------|-------------------|
| Agent forgets the plan | Every stage injects fresh context — instruction, checklist, context, next steps |
| Agent skips steps | State machine validates every transition — wrong stage → rejected |
| Agent declares "done" prematurely | `session.idle` → 10s dwell → stage reminder injected. Can't escape |
| Agent scope-creeps | Stage instructions are explicit. The checklist anchors focus |
| Context compaction erases history | Reminder re-injects context after every idle period |

---

## How It Works 🧠

```
┌─────────────────────────────────────────────────────────┐
│                     Quest Prison                         │
│                                                          │
│  quest(file: "deploy") → stage 1 injected                │
│  agent works → finishes → session.idle                   │
│       │                                                  │
│       ├─ quest complete? → release to user               │
│       └─ not complete? → 10s dwell → reminder injected   │
│                                                          │
│  agent calls quest_advance("implement")                  │
│       │                                                  │
│       ├─ valid transition? → stage 2 injected            │
│       └─ wrong stage? → "Expected: implement. Got: fix"  │
│                                                          │
│  final stage → quest_advance("done") → complete ✅       │
└─────────────────────────────────────────────────────────┘
```

The plugin operates at the **TUI layer** — it puppeteers the prompt box, injecting stage context as user messages. The agent experiences these as normal turns. It has no idea it's in a prison.

---

## YAML Format 📝

Drop a `.yaml` file in `.agents/`:

```yaml
# .agents/deploy-feature.yaml
kind: quest
name: Deploy Feature
description: "Ship a feature safely: plan → implement → verify"
context: >
  Repo: opencode-plugins. Branch: feature branch.
  CI: ~5min via GitHub Actions.

stages:
  - id: plan
    description: "Understand the problem space"
    context: "Planning phase — analysis only, no coding."
    instruction: >
      Read the ticket/issue. Understand what needs to change.
      List every file you expect to touch. NO coding yet.
    checklist:
      - "Ticket requirements understood"
      - "Affected files listed"
      - "Approach clear"
    next:
      proceed: implement
      rethink: plan          # ← self-loop, can stay and rethink

  - id: implement
    description: "Write the actual code"
    instruction: "Write the code. Only what was planned. No scope creep."
    checklist:
      - "All planned files modified"
      - "No unplanned files touched"
      - "Code compiles"
    next:
      done: verify
      fix: plan              # ← back-edge, plan was wrong

  - id: verify
    description: "Validate everything works"
    instruction: "Run tests. Review every change. Would you approve this PR?"
    checklist:
      - "All tests pass"
      - "No debug code left"
      - "Self-review passed"
    # no `next` = final stage → quest_advance("done") completes
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"quest"` | Yes | Must be `"quest"` |
| `name` | string | Yes | Display name |
| `description` | string | No | One-line tagline shown in header |
| `context` | string | No | Operational facts repeated every message |
| `stages` | Stage[] | Yes | Non-empty array of stages |

### Stage fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Stage identifier (used in `quest_advance`) |
| `description` | string | No | One-liner shown in stage header |
| `instruction` | string | No | What the agent should do |
| `checklist` | string[] | No | Items injected as `todowrite` directive |
| `context` | string | No | Stage-specific operational data |
| `next` | string \| Record | No | Exits. Omit on final stage. |

### The `next` field

**String form** — single exit:
```yaml
next: ship
```
Renders as `→ Next: ship`.

**Record form** — labeled exits:
```yaml
next:
  pass: ship
  fail: fix
  retry: verify
```
Renders as:
```
→ Options:
   [pass]   → ship
   [fail]   → fix
   [retry]  → verify
```

**No `next`** — final stage. Renders as `→ Final stage. Call quest_advance("done") to complete.`

---

## Tools 🛠️

### `quest`

Loads an existing quest or creates one inline. Three modes:

| Mode | Call | What it does |
|------|------|-------------|
| **By file** | `quest(file: "deploy-feature")` | Loads `.agents/deploy-feature.yaml` (`.yaml` extension optional) |
| **By name** | `quest(name: "Deploy Feature")` | Scans all `.yaml` files in `.agents/` for matching `name:` field |
| **Inline** | `quest(schema: { kind: "quest", ... })` | Creates inline from schema object |
| **Help** | `quest()` | Shows available files and usage |

When loaded, immediately injects the first stage context.

→ Found: `Quest "Deploy Feature" loaded from .agents/deploy-feature.yaml.`
→ Missing: lists available files or matching files

### `quest_advance`

```
quest_advance(stage: string)
```

Advances to the given stage. State-machine validated.
Plain string (not an enum) — cache-safe.

→ Valid: Injects next stage context
→ Invalid: `"Cannot advance to 'fix'. Expected one of: ['verify', 'plan']."`
→ Final: `quest_advance("done")` → completes, releases agent

---

## Commands ⌨️

| Command | What it does |
|---------|-------------|
| `/quest status` | Show current stage, instruction, checklist, next options |
| `/quest pause` | Suspend reminders — keep state, stop re-fire |
| `/quest resume` | Resume reminders — pick up where you left off |
| `/quest stop` | Clear the quest entirely |

---

## What the Agent Sees 👁️

When a stage is loaded or a reminder fires, the agent receives:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quest: Deploy Feature (implement — 2/3)
Ship a feature safely: plan → implement → verify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Context:
   Repo: opencode-plugins. Branch: feature branch.
   CI: ~5min via GitHub Actions.
   Planning phase — analysis only, no coding.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Write the code. Only what was planned. No scope creep.

Checklist (use todowrite to track):
  ☐ All planned files modified
  ☐ No unplanned files touched
  ☐ Code compiles

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ Options:
   [done] → verify
   [fix]  → plan
  Call quest_advance("verify") or quest_advance("plan") when ready.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Every injection is a **full context dump** — the agent never has to remember what stage it's on or what the checklist was from 10 messages ago.

On completion:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Quest Complete: Deploy Feature
   3/3 stages finished.
   Started: 2m ago.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Design Patterns 🔮

### Branching (choose your path)
```yaml
- id: decide
  next:
    simple: quick-fix
    complex: full-plan
```

### Loop (retry until done)
```yaml
- id: test
  next:
    pass: ship
    fail: fix

- id: fix
  next: test
```

### Self-loop (stay and rethink)
```yaml
- id: plan
  next:
    proceed: implement
    rethink: plan
```

### Convergence (multiple paths to same target)
```yaml
- id: quick-fix
  next: deploy

- id: full-plan
  next: deploy

- id: deploy
```

---

## Templates 📁

14 reusable quest templates ship with the **quest-planner skill** in `.agents/skills/quest-planner/templates/`. Browse them with `quest()` or let the agent suggest one when you mention a matching task:

| Template | Stages | Graph |
|----------|--------|-------|
| `review-pr.yaml` | 3 | approve/reject fork |
| `deploy-feature.yaml` | 6 | proceed/abort/skip + failover |
| `bug-fix.yaml` | 5 | reproduce/skip + escalate |
| `code-audit.yaml` | 4 | pass/warn/fail → converge |
| `planning.yaml` | 3 | proceed/rethink self-loop |
| `research.yaml` | 4 | expand/ship back-edge |
| `onboard-dev.yaml` | 5 | linear single path |
| `pair-program.yaml` | 3 | follow/drive |
| `incident-response.yaml` | 8 | **mitigate→verify loop + escalate** |
| `refactor-pipeline.yaml` | 7 | **test→fix→retest cycle + cleanup** |
| `release-train.yaml` | 8 | **3→1 diamond merge + rollback** |
| `qa-cycle.yaml` | 6 | **triage→fix→retest loop + backlog** |
| `learning-path.yaml` | 6 | **study→practice→study loop + capstone** |
| `feature-flag.yaml` | 9 | **canary→evaluate→{promote,rollback}** |

---

## Install 📦

```bash
git clone https://github.com/lirrensi/opencode-quests.git
cd opencode-quests
pnpm install
pnpm run deploy
```

This installs a single-file plugin to `~/.config/opencode/plugins/opencode-quests.ts`.
OpenCode loads it automatically — restart to pick up changes.

Create a `.agents/` directory in your project, drop in a `.yaml` file with `kind: quest`, and you're running.

---

## Development 🛠️

```sh
git clone https://github.com/lirrensi/opencode-quests
cd opencode-quests
pnpm install
pnpm typecheck   # TypeScript check
pnpm test        # 67 tests
```

---

## Architecture 🏗️

Built on the shared `opencode-plugin-template` pattern:

- **TUI puppeteering** — `clearPrompt → appendPrompt → submitPrompt`
- **Dwell timer** — `session.idle → 10s → fire reminder`
- **Activity cancellation** — `message.updated → cancel dwell`
- **Cross-session safety** — `session.created → auto-stop`
- **Heartbeat toasts** — stage name + elapsed time every 10s

Single-file plugin. One export. Zero disk I/O for state (all in-memory).

---

## License 📜

MIT
