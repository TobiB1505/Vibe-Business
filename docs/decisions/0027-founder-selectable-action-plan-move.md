# 0027 - Founder-Selectable Action Plan Move

Status: Accepted
Date: 2026-08-18
Builds on [0026](0026-agentic-execution-contract.md)

## Context

Action Plans have always been generated for exactly one Move: whichever the Opportunity Engine currently ranks first. `defaultPlannedOpportunity` enforces this everywhere a plan gets built — readiness, identity resolution, the durable planning step — and a dedicated test calls it "the most important test in this file" (`action-plans/plans.test.ts`, §83): when the top Move needs a founder decision and a lower-ranked Move has a real capability behind it, the planner must still plan the top Move. Doing otherwise would mean the product quietly works on the easy thing while telling the founder it worked on the important thing.

That rule is correct and this ADR does not touch it. What changed is what a founder discovered by actually planning their own real Moves (`docs/sprints/0040-execution-core4-first-coding-agent.md`, addendum): business priority and execution suitability are *independent* dimensions, and for two real projects in a row, the top-ranked Move landed on exactly the category the execution-contract risk policy exists to refuse — payments for one project, authentication for the other (ADR 0026 §10). Under the rank-1-only rule, there was no way to ever reach a Move that could genuinely execute, without waiting for the business itself to change.

PRODUCT.md's own Core Loop (§6, step 7) already says "User selects an opportunity" for the single-shot "prepare a change" flow (`execution/service.ts::StartPreparationParams`), which has taken a caller-supplied `opportunityId` since it was built. Action Plans withheld that agency only because no caller had ever asked for it — not because §83 forbids a founder's own choice.

## Decision

### 1. §83 forbids one specific thing: Vibe substituting silently. It does not forbid a founder choosing explicitly.

`defaultPlannedOpportunity` is unchanged and stays the unconditional answer whenever nothing was requested — which is every caller today except a new, explicit "Plan this Move" click. A new sibling, `resolveRequestedOpportunity`, adds exactly one behavior: if a caller names a specific Move that exists in the *current* set, plan that one instead. A stale or foreign id resolves to `null`, never a silent fallback to rank 1 — substituting a different Move than the one actually requested, without saying so, is the same failure §83 already names.

### 2. The deviation is always disclosed, never implicit

`ActionPlanReadiness` gains `isDefaultMove: boolean`. Whenever the resolved Move is not the engine's own rank 1, `ActionPlanPanel` renders "Planned out of priority order," naming the engine's actual top choice. This is the mechanism that keeps an explicit choice from decaying into the exact thing §83 forbids: nothing about the panel reads identically whether the founder deviated or not.

### 3. Selection threads through the same identity, not a new authority

`startActionPlanOperation` accepts `requestedOpportunityId` and resolves it through the identical `resolveActionPlanIdentity` chain every plan already goes through — same audit-currency gate, same source-conclusion gate, same input-hash idempotency (now correctly scoped per Move, since `opportunityId` was already part of the hash). The operation persists the resolved Move as `subjectId` (mirroring `change_preparation`, which has done this since it was built), so the durable step re-resolves against the *current* set at execution time rather than trusting whatever was true at the click — a Move that disappears between click and step blocks (`move_not_found`) rather than silently executing a different one.

### 4. No new route, no new authority surface

Selection is a query parameter (`?plan=<opportunityId>`) on the existing `/moves` page, read server-side and validated by the same `resolveRequestedOpportunity` readiness already uses — never trusted as an id to act on directly. `startDogfoodRunAction`'s equivalent in the Core-4 website surface (ADR-in-progress, not this one) sets the precedent this follows: the browser supplies an identity, the server re-derives everything else.

## Consequences

- A founder can now reach a genuinely executable Move without waiting for the business itself to reprioritize — the actual blocker Core-4's dogfood exposed.
- §83's guarantee is unchanged for every existing caller: omit the parameter, and behavior is byte-for-byte what it was before this ADR.
- Every deviation from rank 1 is a labelled, on-screen fact, not a silent one — extending the same honesty rule to a case §83's author had not yet needed to handle.
- The single "latest completed plan" remains project-wide (`supersedeOtherPlans`), not per-Move. Planning a second Move supersedes the first; the panel shows a plan only when it answers the currently selected Move, never a mismatched one under an unrelated CTA.
- `getActiveActionPlanOperation`'s read model is not yet scoped to a specific Move. Two concurrent plan runs for two different Moves on one project are possible in principle and would show whichever one it happens to find; documented as a known, low-probability gap rather than fixed now.

## Alternatives considered

**Let the engine itself choose an easier Move when the top one cannot execute.** Rejected outright — this is the literal failure mode §83 was written to prevent.

**A dedicated `/moves/[opportunityId]/plan` route.** Rejected: there is still only one *current* plan per project (`supersedeOtherPlans` is project-wide, not per-Move), so a per-Move route would imply a persistent per-Move plan history that does not exist. A query parameter on the existing page matches what the backend actually models.

**Silently fall back to rank 1 when a requested Move no longer exists.** Rejected: indistinguishable, on screen, from "Vibe decided to plan the important thing" when what actually happened is a stale link resolved to nothing. `move_not_found` says so instead.
