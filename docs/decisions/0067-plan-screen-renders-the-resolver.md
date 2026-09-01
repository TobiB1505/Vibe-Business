# 0067 - The plan screen renders the execution resolver, not only the stored classification

Status: Accepted
Date: 2026-09-01

## Context

There are three independent answers to *"can Vibe do this?"*, and the Action
Plan screen rendered the weakest one:

| Layer | Field | Derived from | Knows about the coding agent |
|---|---|---|---|
| Plan step, stored | `executionSupport` | `action-plans/classify.ts`, deterministic registry (one entry) | no |
| Move, on screen | `capability` | `execution/capabilities.ts`, same registry | no |
| Execution resolver | `ExecutionResolution.mode` | `execution-contract/resolver.ts` | **yes** |

`resolver.ts` deliberately does not read `executionSupport` at all — its header
says so, and the reason is Rule 55: a stored classification was written against
a snapshot and a registry that may since have moved, so it is a routing signal
and never permission.

The consequence reached a founder. A real plan step — *"Build a public pricing
page for the confirmed plans"*, `vibe` + `product_change`, no registry match —
was stored `not_yet_supported` and read on the plan screen as **"Vibe's work /
Not automated yet"**, while `resolveStepExecution` classified the same step
`agentic` and the Agent workspace offered a Run button for it. Both sentences
were true of the same step, in the same product, at the same time.

## Decision

For `not_yet_supported` steps, and only those, the plan screen renders what the
resolver says.

`stepResponsibility(step, resolution)` in `action-plans/view.ts` is the whole
rule, and it is pure:

- no resolution → today's copy, which is the honest answer when the route could
  not resolve one;
- `executionSupport !== "not_yet_supported"` → today's copy, unchanged;
- `not_yet_supported` + `intrinsicMode === "agentic"` → `EXECUTION_MODE_LABELS.agentic`
  ("Vibe could build this") and `EXECUTION_REASON_LABELS.agentic_v1_eligible`.

The route resolves it with `resolvePlanExecutionRoutes` — the body of
`resolveDogfoodPlanRoutes` with the allowlist gate lifted off. That split is the
decision underneath this one:

> *"What could Vibe build?"* and *"may you start it right now?"* are different
> questions. Every founder is owed the first; the second stays behind the
> allowlist, the Credits and admission.

It reads state and never the network — no live HEAD, no site crawl — so
classifying a whole plan costs four queries and spends nothing.

`intrinsicMode` rather than `mode`: a step waiting on an earlier one is still a
step the agent could build, and the row already prints its own "Waiting for step
N" line immediately below. Two facts, neither contradicting the other.

## Consequences

**The deterministic path's meaning does not move.** `isExecutableByVibe` is
untouched, `vibe_executes_now` still requires a real capability, and the
database still enforces the pairing. `vibe_prepares` keeps its own sentence:
letting the resolver speak there would print "Not something Vibe can build yet"
over work Vibe genuinely does.

**No new affordance.** "Could build" is a capability statement, which is exactly
why `EXECUTION_MODE_LABELS` was written before any screen rendered it. The
browser test asserts the existing forbidden-control sweep still finds nothing —
a copy change that quietly became a button would be worse than the defect.

**The stored classification was deliberately not changed.** Adding an agentic
value to `ExecutionSupport` was the alternative and is rejected: it is a CHECK
constraint migration plus a paired constraint to re-reason about, it makes
`classify.ts` depend on a repository connection and a validation profile at
plan-generation time, every already-persisted row stays wrong forever, and —
decisively — it would write a *stale* answer into a durable column, which is the
failure this ADR exists to remove rather than relocate.

**The route pays four extra queries per render**, in one parallel round after
the plan is known — they cannot join the existing top-level `Promise.all`
because resolving needs the plan that call returns. One added round trip on a
page that already resolves readiness per Move and three execution reads per
Move.

## Related

- [ADR 0026](0026-agentic-execution-contract.md) — the resolver and why the
  permission does not generalize with the architecture.
- [ADR 0053](0053-founder-input-resolution.md) — the founder
  resolutions this resolution reads to decide which prerequisites are satisfied.
