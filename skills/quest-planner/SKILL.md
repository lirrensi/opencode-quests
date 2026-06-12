---
name: quest-planner
description: >
  Plan, design, and create quests for the opencode-quests plugin. Use this skill
  when the user wants to create a quest YAML file, design a multi-stage workflow
  with branching, run a quest inline, or browse reusable templates for common
  development tasks.
---

# quest-planner

Plan, design, and create quests for the opencode-quests plugin. Use this skill when the user wants to create a quest YAML file, design a multi-stage workflow with branching, or run a quest inline.

## What is a Quest?

A quest is a **labeled multi-next state machine** that guides the agent through stages. Each stage declares its own exits with semantic labels. No condition language, no expression evaluation — the agent reads labels and picks.

The plugin injects the current stage message into the chat. The agent calls `quest_advance(stage)` to move forward. When idle too long, the plugin re-injects the reminder. Once started, the agent cannot exit until the quest completes or the user runs `/quest stop`.

## Quick Start

### Inline (for quick one-shots)

Call `quest()` with a schema object:

```
quest(schema: { kind: "quest", name: "Review PR", stages: [{ id: "review", instruction: "Read the PR diff and leave comments.", next: "approve" }, { id: "approve", instruction: "Approve and merge if ready." }] })
```

No file needed. The quest runs immediately and disappears when done.

### File-based (for reusable quests)

Save a `.yaml` file in `.agents/` and load by filename:

```yaml
# .agents/review-pr.yaml
kind: quest
name: Review PR
description: "Review and approve a pull request."

stages:
  - id: review
    instruction: >
      Read the PR diff. Check for bugs, style, and missing tests.
      Leave inline comments on anything concerning.
    checklist:
      - "All files reviewed"
      - "Comments left where needed"
    next:
      approve: approve
      reject: reject

  - id: approve
    instruction: "Approve the PR and merge if CI is green."
    checklist:
      - "CI passing"
      - "PR approved"
      - "Branch merged"

  - id: reject
    instruction: "Close the PR with a clear explanation of why."
```

Load it: `quest(file: "review-pr")`  (extension `.yaml` is optional)

## Schema Reference

### Quest (top-level)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"quest"` | Yes | Must be `"quest"` |
| `name` | string | Yes | Display name |
| `description` | string | No | One-line tagline shown in header |
| `context` | string | No | Operational facts repeated every message (repo, branch, CI, etc.) |
| `stages` | Stage[] | Yes | Non-empty array of stages |

### Stage

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique stage identifier (used in `quest_advance`) |
| `description` | string | No | One-liner shown in stage header |
| `instruction` | string | No | What the agent should do (multi-line OK) |
| `checklist` | string[] | No | Items the agent MUST complete (injected as `todowrite` directive) |
| `context` | string | No | Stage-specific facts shown in context block |
| `next` | string or Record | No | Exits from this stage. Omit on final stage. |

### The `next` Field

**String form (single exit):**
```yaml
next: ship
```
Normalizes to `{ default: "ship" }`. Renders as `→ Next: ship`.

**Record form (labeled exits):**
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

**No `next` field = final stage.** Renders as `→ Final stage. Call quest_advance("done") to complete.`.

### Context Field

Two levels:

```yaml
# Quest-level — shown on EVERY stage
context: >
  Repo: opencode-plugins.
  Branch: feature/xxx.

stages:
  - id: plan
    # Stage-level — only when on this stage
    context: "Planning phase — analysis only, no coding."
```

Both are shown together under `📋 Context:` between the stage header and instruction. Both are optional.

## Design Patterns

### Branching (choose your path)

```yaml
- id: decide
  next:
    simple: quick-fix
    complex: full-plan
```

Agent picks based on what it discovers.

### Loop (retry until done)

```yaml
- id: test
  next:
    pass: ship
    fail: fix

- id: fix
  next: test
```

Agent cycles between test and fix until it passes.

### Self-loop (stay and rethink)

```yaml
- id: plan
  next:
    proceed: implement
    rethink: plan
```

Agent can stay on the same stage if it needs more information.

### Convergence (multiple paths to same target)

```yaml
- id: quick-fix
  next: deploy

- id: full-plan
  next: deploy

- id: deploy
```

Both paths lead to deploy. No special syntax needed.

## Running a Quest

### Start
- **By filename:** `quest(file: "my-quest")` — loads `.agents/my-quest.yaml` (extension optional)
- **By quest name:** `quest(name: "Deploy Feature")` — scans all `.yaml` files for matching `name:` field
- **Inline:** `quest(schema: { kind: "quest", ... })` — create and run without a file
- **Help:** `quest()` — shows available files and usage

### During
- Advance: `quest_advance("stage-id")` — move to the next stage
- Complete: `quest_advance("done")` — finish the quest
- Status: `/quest status` — see current stage
- Pause: `/quest pause` — stop reminders temporarily
- Resume: `/quest resume` — restart reminders
- Stop: `/quest stop` — abort the quest

## File Naming

Save quests as `.yaml` or `.yml` files in `.agents/` (workspace root). The filename (minus extension) is what you pass to `quest(file:)`.

```
.agents/
  deploy-feature.yaml    → quest(file: "deploy-feature")
  review-pr.yaml         → quest(file: "review-pr")
  onboard-new-dev.yml    → quest(file: "onboard-new-dev")
```

## Templates

Reusable quest templates live in `templates/` alongside this skill. Each template illustrates a common pattern — copy, adapt, and save to `.agents/`.

| File | Pattern | Stages | Graph Shape |
|------|---------|--------|-------------|
| `review-pr.yaml` | PR review & approve | 3 | approve/reject fork |
| `deploy-feature.yaml` | Feature release pipeline | 6 | proceed/abort/skip + failover |
| `bug-fix.yaml` | Bug triage & fix | 5 | reproduce/skip + escalate |
| `code-audit.yaml` | Quality & security audit | 4 | pass/warn/fail → converge |
| `planning.yaml` | Investigation & proposal | 3 | proceed/rethink self-loop |
| `research.yaml` | Multi-source research | 4 | expand/ship back-edge |
| `onboard-dev.yaml` | New developer setup | 5 | linear (single path) |
| `pair-program.yaml` | Paired coding session | 3 | follow/drive |
| `incident-response.yaml` | Production incident | 8 | **mitigate→verify loop + escalate** |
| `refactor-pipeline.yaml` | Code refactor | 7 | **test→fix→retest cycle + cleanup** |
| `release-train.yaml` | Multi-track release | 8 | **3→1 diamond merge + rollback** |
| `qa-cycle.yaml` | QA with bug triage | 6 | **triage→fix→retest loop + backlog** |
| `learning-path.yaml` | Adaptive learning | 6 | **study→practice→study loop + capstone** |
| `feature-flag.yaml` | Gradual rollout | 9 | **canary→evaluate→{promote,rollback}** |

Use `quest(file: "template-name")` to run a template directly, or copy it into `.agents/` and customize.

## Invitations

When the user mentions any of these tasks, proactively suggest scanning `templates/` for a matching quest:

- **"review" / "PR" / "code review"** → `templates/review-pr.yaml`
- **"deploy" / "release" / "ship"** → `templates/deploy-feature.yaml` or `templates/release-train.yaml`
- **"bug" / "fix" / "issue"** → `templates/bug-fix.yaml`
- **"audit" / "security"** → `templates/code-audit.yaml`
- **"plan" / "design" / "approach"** → `templates/planning.yaml`
- **"research" / "investigate"** → `templates/research.yaml`
- **"onboard" / "setup" / "new dev"** → `templates/onboard-dev.yaml`
- **"pair" / "pair program"** → `templates/pair-program.yaml`
- **"incident" / "outage" / "on-call"** → `templates/incident-response.yaml`
- **"refactor" / "rework"** → `templates/refactor-pipeline.yaml`
- **"QA" / "test cycle" / "regression"** → `templates/qa-cycle.yaml`
- **"learn" / "study" / "tutorial"** → `templates/learning-path.yaml`
- **"feature flag" / "canary" / "slow rollout"** → `templates/feature-flag.yaml`
- **General "I need a quest" / "help me plan"** → Browse the full `templates/` directory

When you find a match, say something like:

> "There's a `review-pr` template in the quest-planner templates — want me to load it or customize a copy?"

This keeps the friction at zero: the user doesn't need to know the template exists, you surface it.

## Tips

1. **Labels are hints, not rules.** Write labels that help the agent decide: `pass`/`fail`, `proceed`/`rethink`, `ship`/`fix`. Avoid generic labels like `go`, `next`, `option1`.

2. **Context keeps the agent grounded.** Put repo, branch, CI info at quest level. Put stage-specific constraints at stage level. Context is re-injected on every message — the agent can't forget it.

3. **Checklist drives completion.** The checklist is injected with a `todowrite` directive — the agent MUST call `todowrite` with the items. This creates visible progress markers.

4. **Instruction is the "what", context is the "how".** Keep them separate. Instruction = "Read the ticket and plan the changes." Context = "Repo: X, Branch: Y, only touch src/".

5. **Start simple.** A 2-stage quest (do + verify) with a single `next` string is often enough. Add branching only when the agent needs to choose.

6. **Don't over-branch.** Every exit is a decision the agent must make. Too many exits = choice paralysis. 2-3 well-labeled exits per stage is the sweet spot.

7. **The graph emerges from local declarations.** Each stage only knows its own exits. The overall shape (DAG, cycle, tree) emerges from how exits connect. No global routing needed.
