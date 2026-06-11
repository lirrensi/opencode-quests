# Workflow Plugin — Design Spec

> Built on the shared `.plugin-template` pattern.
> Stage enforcement via TUI injection + idle-driven re-fire.

## Core Mechanic

Workflow is a **linear state machine** the agent cannot escape.
Load → stage context injected immediately → work → advance → next stage → repeat.
Agent finishes but isn't done? Plugin fires a reminder.

```
load_workflow("Deploy Feature") → stage 1 context injected into chat
agent works → finishes → session.idle → 10s dwell → reminder injected
agent calls workflow_advance("implement") → validated → stage 2 context injected
...final stage → workflow_advance("done") → workflow complete → release
```

## Why the injected message matters

When you switch stages, the message carries **everything the agent needs right now**:
- Workflow name + description (what is this?)
- Stage instruction (what do I do?)
- Checklist (what are the concrete steps?)
- Next stage (where do I go?)

The agent doesn't have to remember from 10 messages ago. Every injection is a fresh focus dump.

---

## Decisions

| Decision | Value |
|----------|-------|
| Re-fire dwell | **10 seconds** (filters OpenCode harness 1s idle noise between compactions) |
| Advance validation | Reject wrong stage + **list valid option** (state machine holds the truth) |
| Workflow exit | `workflow_advance("done")` on final stage |
| Workflow loading | `workflow_load(name)` scans `.agents/*.yaml` for `kind: workflow` |
| Branching | **None** — linear only. Want branches? Make separate workflows. |
| Checklist | **Focus guidance** — shown in injected message. Agent tracks with native `todowrite`. |

---

## YAML Workflow Format

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

  - id: implement
    instruction: "Write the code. Only what was planned. No scope creep."
    checklist:
      - "All planned files modified"
      - "No unplanned files touched"
      - "Code compiles"

  - id: verify
    instruction: "Run tests. Review every change. Would you approve this PR?"
    checklist:
      - "Tests pass"
      - "No debug code left"
      - "Self-review passed"
    # no `next` = final stage → workflow_advance("done") completes
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `kind` | ✅ | Must be `"workflow"` |
| `name` | ✅ | Identifier for `workflow_load` |
| `description` | ❌ | One-liner shown in every injected message |
| `stages` | ✅ | Ordered array |
| `stages[].id` | ✅ | Used in `workflow_advance` |
| `stages[].instruction` | ❌ | Shown in injected stage context |
| `stages[].checklist` | ❌ | Array of strings — focus guidance |
| `stages[].next` | ❌ | Next stage id. Omit on final stage. |

---

## Two Tools

### `workflow_load`

```
workflow_load(name: string)

Scans .agents/*.yaml for files with `kind: workflow`.
Matches by `name`. Loads and injects stage 1 context immediately.

→ Found:       "Workflow 'Deploy Feature' loaded. Starting stage: plan"
→ Not found:   "No workflow named 'X'. Available: Deploy Feature, Bug Fix"
→ No files:    "No workflow files found in .agents/"
```

### `workflow_advance`

```
workflow_advance(stage: string)

Advances to the given stage. Plain string — cache-safe.
Plugin validates against the state machine.

→ Valid:      Injects next stage context immediately
→ Invalid:    "Not a valid next stage. Expected: implement. Got: verify."
→ Final:      workflow_advance("done") → completes workflow, releases agent
```

---

## `create_workflow` (inline creation)

```
create_workflow(schema: object)

Creates a workflow from a schema object. Same format as YAML.
Single call — the tool description documents the format.

→ Valid:   Creates workflow, starts at stage 1, injects context
→ Invalid: "Schema error: stages[0].id is required"
```

Tool description includes a compact schema reference so the agent knows the shape:

```
Create a workflow from an object. Schema:
{ kind: "workflow", name: string, description?: string,
  stages: [{ id: string, instruction?: string, checklist?: string[], next?: string }] }
Stages are linear — each stage's `next` points to the following stage id.
Omit `next` on the final stage.
```

---

## Plugin State

```typescript
type Workflow = {
  name: string
  description?: string
  stages: Stage[]
}

type Stage = {
  id: string
  instruction?: string
  checklist?: string[]
  next?: string
}

type WorkflowState = {
  workflow: Workflow
  currentStageId: string
  startedAt: number
}
```

## State Machine

```
getValidNext(state):
  stage = find by currentStageId
  if !stage.next → return ["done"]          // final stage
  return [stage.next]                        // linear — single valid target

isValidTransition(state, targetId):
  return getValidNext(state).includes(targetId)
```

---

## Injected Messages

### Stage load / advance

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Workflow: Deploy Feature
Ship a feature safely: plan → implement → verify
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stage: implement

Write the code. Only what was planned. No scope creep.

Checklist:
  ☐ All planned files modified
  ☐ No unplanned files touched
  ☐ Code compiles
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ Next: verify
  Call workflow_advance("verify") when ready.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Reminder (on idle re-fire)

Same format as above — the agent sees its current stage fresh every time.

### Workflow complete

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Workflow Complete: Deploy Feature
   3/3 stages finished.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Plugin Hooks (from `.plugin-template`)

| Hook | Behavior |
|------|----------|
| `config` | Registers 3 tools |
| `event: message.updated` | Assistant activity → cancel dwell |
| `event: session.idle` | Active workflow? → **10s dwell** → inject stage reminder |
| `event: session.created` | Clear workflow (cross-session safety) |

### Template overrides

| Aspect | Template default | Workflow plugin |
|--------|-----------------|-----------------|
| `DWELL_MS` | 30_000 | **10_000** (filters harness noise) |
| `FIRE_DEFER_MS` | 0 | **100** (immediate-fire on load + advance) |
| Tools | 0–1 | **3** (`load`, `create`, `advance`) |
| Exit | Time or stop | **Workflow complete only** |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Agent calls advance with wrong stage | Reject: `"Expected: implement. Got: verify."` |
| Agent tries to skip a stage | Reject — only the valid next stage is accepted |
| New session starts mid-workflow | Auto-clear + toast |
| Workflow YAML parse error | Error returned with line info |
| File missing `kind: workflow` | Skipped during scan |
| No workflows in `.agents/` | `"No workflow files found"` |
| Agent stalls on a stage | 10s dwell → reminder injected |
| User interrupts (Escape) | Workflow stays active — reminder on next idle |
| `create_workflow` called with active workflow | Replaces it (start fresh) |
| `workflow_load` called with active workflow | Replaces it (start fresh) |
