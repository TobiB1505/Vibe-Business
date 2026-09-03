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

| File                             | What it answers                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`                      | modes, risk classes, stop reasons, interrupt types, activity events, versions                                           |
| `resolver.ts`                    | _what kind of route does this step need, and may it start now?_                                                         |
| `chain.ts`                       | _which of the following steps could this same run also deliver?_ — forwards, structural, no prose                       |
| `risk.ts`                        | _how much could go wrong?_ — from structured facts, never prose                                                         |
| `dependencies.ts`                | _does this prerequisite block, or does the run absorb it?_                                                              |
| `policy.ts`                      | _what may an execution do?_ — default deny, globally forbidden set                                                      |
| `budget.ts`                      | _how much may it cost?_ — no approved policy exists yet                                                                 |
| `validation-requirements.ts`     | _what must independently pass?_ — derived from the real profile                                                         |
| `live-premise.ts`                | _is the defect this step exists to fix still there?_ — re-checked against live state before a Credit is spent (rule 55) |
| `spec.ts`                        | the immutable instruction package                                                                                       |
| `identity.ts`                    | what makes two specs the same spec                                                                                      |
| `secrets.ts`                     | why the schema, not a scanner, is the defence                                                                           |
| `interrupts.ts`                  | when a run must stop and ask                                                                                            |
| `proposed-change.ts`             | the bridge into the existing pipeline                                                                                   |
| `store.ts` / `service.ts`        | the one persisted concept, server-only                                                                                  |
| `view.ts`                        | customer-safe copy for every internal enum                                                                              |
| `report.ts` / `dogfood.probe.ts` | the §38 dogfood                                                                                                         |

## Four things this module refuses to do

**It does not treat every Planner prerequisite as a runtime wall.** A plan
describes what work is needed; it does not define one execution boundary per
step. `dependencies.ts` separates prerequisites that must already _exist_ — a
founder decision, real-world work, an external party — from Vibe's own
technical preparation, which an agentic run performs itself and records as
absorbed. One hard prerequisite still blocks everything, and nothing is ever
marked complete on the founder's behalf.

An earlier build step used to be in that first list. It still blocks a run that
does not deliver it — a product change is never absorbable preparation — but
since [ADR 0077](../../../docs/decisions/0077-build-chains.md) a run may carry
its contiguous successors as further _deliveries_. `chain.ts` answers that,
forwards, and it is deliberately a separate walk: absorption is all-or-nothing
and never completes the Planner's step, while a chain may be shortened and must
complete every member.

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

## What this module is still deliberately without

No agent SDK, no model call, no tool runtime, no file editing and no repair
loop — those live behind `CodingAgentProvider` (ADR 0027) and run in the
execution's own sandbox (ADR 0029), never here. This module resolves and
records; it does not execute.

*(The sentence that stood here also said there was no execute button and no
approved Credit price for agentic work, and that Vibe had never run an agent.
All three stopped being true — Core-4 shipped the run, and [ADR 0061](../../../docs/decisions/0061-launch-v1-operation-rate-card.md)
priced it at 150/200/350 by execution class. `budget.ts` no longer ships an
empty policy array.)*

## The honest state of the product

The interesting refusals are not about a plan's quality. They are about whether
Vibe can independently prove a change builds — `§31` forbids accepting an
agent's own claim instead — and since [ADR 0078](../../../docs/decisions/0078-the-validation-profile-is-a-build-contract.md)
each one names the missing thing rather than reporting "no profile matches".

Read out of production on 2026-09-03, across four connected repositories: two
resolve to a supported application (one at the repository root, one at
`frontend`), one is refused because its buildable application has **no lockfile
Vibe can install from exactly**, and one is refused because its stored analysis
predates the check and its owner has not re-run it. Only the last of those is
about Vibe; the other three are facts about repositories, stated in terms their
owner can act on.

`pnpm execution:dogfood` runs the probe that reads this against a real project,
which is how the paragraph above is reproduced rather than believed.

*(This section previously named that third project as FastAPI + React "with no
detected package manager, so no validation profile matches". The conclusion —
a change to it cannot be independently proven — still holds; the mechanism was
the old framework gate, and the current refusal is narrower and more useful.)*
