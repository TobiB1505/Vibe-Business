# 0054 - Agent Action Plan completion comes from verified execution evidence

Status: Accepted; amended 2026-09-02 — the projection could not complete the route it was written for, and the execution router did not read it
Date: 2026-08-26

## Context

ADR 0053 introduced the first authoritative Action Plan completion evidence:
an active founder resolution completes its matching founder-owned step. Agent
steps deliberately remained incomplete. The execution pipeline already stores
all facts needed to resolve that gap, but no Action Plan read projects them.

Using only `agent_execution_runs.status = 'succeeded'` would be too weak. It is
a terminal lifecycle fact, not proof that the observed candidate passed Vibe's
write policy or that the prepared bytes passed independent validation. Adding a
manual `completed` flag would be weaker still and would create a competing
source of truth beside the execution records.

## Decision

Agent-step completion is a read-time projection over four existing records:

1. an immutable `execution_specs` row binds the exact plan and step;
2. a planner-origin `agent_execution_runs` row succeeded and names a Prepared
   Change;
3. that run has a durable `change_verified` event, proving Vibe accepted the
   observed candidate rather than the agent's account of its work;
4. a `validation_runs` row for that Prepared Change passed, and its recorded
   source integrity says the changed files were verified.

All four must exist. Missing, partial, failed, cancelled, runtime-blocked and
legacy evidence remains incomplete. Dogfood-fixture runs never complete a
customer plan. Matching uses both the stored step key and order.

The projection lives in the Action Plan read model. No table, completion flag,
trigger or new lifecycle state is introduced. `founder_action` and
`external_party` keep their separate unresolved authorities, and no manual
control may complete an Agent step.

This completion means the agent-owned implementation step produced an
independently validated Prepared Change. It does not mean approved, merged,
deployed, live, safe or business-effective; those remain their existing,
separate authorities.

## Consequences

- A downstream plan step can become ready only after the executable step has a
  successful and independently validated artifact.
- An agent status, Prepared Change, verification event or validation pass is
  insufficient by itself, which makes partial writes fail closed.
- Existing canonical execution records remain the only source of truth; the
  Action Plan owns only the projection.
- No migration is required.
- A later policy may choose a stronger delivery boundary for a particular step
  type, but it must not reinterpret this evidence as merge, deployment or
  production outcome authority.

## Amendment, 2026-09-02 — the two reasons a completed step still blocked its successor

The decision above stands. What follows is what was wrong in the code that
implemented it, found while designing build chains, and repaired the same day.

**The projection could not complete an agentic step at all.**
`completedByAgentExecution` required `isExecutableByVibe(step)` —
`executionSupport === "vibe_executes_now"` **and** a non-null `capability`.
That is the deterministic shape. The agentic route is reached only when
`matchCapability` returned null, so an agent-built step carries
`capability: null` by construction and the predicate was false for every change
the coding agent has ever made.

It was correct when written and never noticed afterwards: this ADR shipped when
the deterministic generators were the only producer with completed runs, and
`isExecutableByVibe` was then the only "Vibe can do this" predicate in the
codebase. It outlived its scope by one route.

The deeper error is the one `resolver.ts` refuses to make about itself:
`executionSupport` and `capability` are the Planner's answer from when the plan
was written, and routing re-derives everything from current state rather than
reading them (ADR 0067). Using them as a *completion* authority is the same
mistake one layer over. The predicate is now the actor plus the four records
this ADR names, and nothing else.

**And the execution router never asked.** `resolvePlanExecutionRoutes` built its
`completedSteps` from founder resolutions alone, so even a repaired projection
would not have reached the screen that offers a run.

Together these made a real plan permanently stuck: step 2 ("Build a public
pricing page") ran, verified and validated; step 3 ("Make the pricing page
reachable") depends on it and resolved `blocked`, telling the founder an earlier
step had to finish first.

**One thing this amendment adds rather than repairs.** The router asks a
narrower question than the plan screen, and both are honest. A step is
*completed* at a passed validation, as decided above. A step may be *built on*
only once its Prepared Change is merged — a run is prepared against the default
branch, and starting the successor before then hands the agent a tree without
the work it is supposed to build on. `completedStepsForExecutionRouting` is the
narrower projection; the plan screen keeps the wider one, so a founder is not
told their finished work is unfinished while it waits for review.

**One consequence above is now false and is corrected here rather than edited
away.** "No migration is required" was true of this decision; it remains true
of this amendment, which changes a predicate and a call site and no schema.
"A downstream plan step can become ready only after the executable step has a
successful and independently validated artifact" is amended: for an *agentic*
predecessor it also requires the merge, for the reason above.
