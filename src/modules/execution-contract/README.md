# `execution-contract`

The hard contract between the Action Planner and the Coding Agent.

```
ActionPlanStep
      ↓
Execution Resolver          deterministic. Vibe's authority, not the Planner's.
      ↓
ExecutionSpec               immutable, versioned, secret-free
      ↓
Policy Compiler             default deny, outside any prompt
      ↓
  mode · allowed tools · forbidden actions · repository + base SHA
  write scope · required validation · Credit ceiling · interrupt rules
  stop conditions · live-premise checks
      ↓
CODING AGENT                modules/coding-agent — ADR 0027, 0029
      ↓
ProposedChange → PreparedChange → Validation → Review → Approval → Safe Merge
```

## The principle

> **AI decides how. Vibe decides whether, where, what, how much, when to stop,
> and what must pass.**

Everything in this module is the second half of that sentence, expressed as
structure rather than as prose. A rule in a prompt is a request; a rule in a
compiled policy with a default-deny predicate is a fact.

## What is here

| File | What it answers |
| --- | --- |
| `schema.ts` | modes, risk classes, stop reasons, interrupt types, activity events, versions |
| `resolver.ts` | *what kind of route does this step need, and may it start now?* |
| `risk.ts` | *how much could go wrong?* — from structured facts, never prose |
| `dependencies.ts` | *does this prerequisite block, or does the run absorb it?* |
| `policy.ts` | *what may an execution do?* — default deny, globally forbidden set |
| `budget.ts` | *how much may it cost?* — no approved policy exists yet |
| `validation-requirements.ts` | *what must independently pass?* — derived from the real profile |
| `live-premise.ts` | *is the defect this step exists to fix still there?* — re-checked against live state before a Credit is spent (rule 55) |
| `spec.ts` | the immutable instruction package |
| `identity.ts` | what makes two specs the same spec |
| `secrets.ts` | why the schema, not a scanner, is the defence |
| `interrupts.ts` | when a run must stop and ask |
| `proposed-change.ts` | the bridge into the existing pipeline |
| `store.ts` / `service.ts` | the one persisted concept, server-only |
| `view.ts` | customer-safe copy for every internal enum |
| `report.ts` / `dogfood.probe.ts` | the §38 dogfood |

## Four things this module refuses to do

**It does not treat every Planner prerequisite as a runtime wall.** A plan
describes what work is needed; it does not define one execution boundary per
step. `dependencies.ts` separates prerequisites that must already *exist* — a
founder decision, real-world work, an external party, a product change — from
Vibe's own technical preparation, which an agentic run performs itself and
records as absorbed. One hard prerequisite still blocks everything, and nothing
is ever marked complete on the founder's behalf.


**It does not read the Planner's `executionSupport`.** Not as a hint, not as a
cross-check. Those fields were correct when written; they are a routing signal
now, and the resolver re-derives everything from the current registry, the
current snapshot and the current validation profile. A plan claiming
`vibe_executes_now` and a plan claiming `not_yet_supported` resolve identically
— `real-plan-dogfood.test.ts` asserts it byte for byte.

**It does not classify from model wording.** Risk reads `changeKind` and the
evidence ids the step cites, both of which are minted by Vibe's own detectors. A
risk model keyed on prose would let a reworded step downgrade itself, which is
the most valuable thing an injected README could achieve.

**It does not persist anything it has no writer for.** One table,
`execution_specs`, because a spec is the only concept here needing an immutable
historical identity. Interrupts and activity events are code-level contracts
until Core-4 supplies the code that fills them.

## What is deliberately absent

No agent SDK, no model call, no tool runtime, no file editing, no repair loop,
no execute button, no approved Credit price for agentic work. `budget.ts` ships
an empty policy array for the same reason `credits/rating.ts` does: Vibe has
never run an agent, so any number chosen today would be a guess wearing a
decision's clothes.

## The honest state of the product

Run `pnpm execution:dogfood` against a real project. On the dogfooded plan, no
step is executable — and the most interesting reason has nothing to do with the
plan's quality: the project is FastAPI + React with no detected package manager,
so no validation profile matches, so Vibe could never independently prove a
change to it builds. `§31` forbids accepting an agent's own claim instead.
