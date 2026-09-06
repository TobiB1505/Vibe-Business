# 0092 - The agent runs as the product

Status: Accepted
Date: 2026-09-04

Retires the internal dogfood economics introduced by [ADR 0027](0027-coding-agent-provider-and-tool-gateway.md) and Sprint 0040, and completes [ADR 0061](0061-launch-v1-operation-rate-card.md), which activated the price this depended on. Rewrites CLAUDE.md rule 78 in place. Changes no execution, approval, merge or validation authority.

## Context

`VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS` was introduced to satisfy one paragraph, EXECUTION CORE-4 §18:

> NO production Agent retail price has been approved yet. Do NOT activate a customer-facing production Agent price. For Core-4 dogfood, create the smallest explicit INTERNAL/TEST-ONLY economic policy … designated dev/test billing account only, not reachable by normal customer paths, clearly marked non-production, hard spending ceiling.

That was correct while it was true. Both halves of it have since expired:

- **The price exists.** [ADR 0061](0061-launch-v1-operation-rate-card.md) activated `launch-v1`, which prices `agent_execution` by execution pricing class at 150 / 200 / 350 Credits, with `launch-v1-budget` as the matching ceiling. The measurement §18 was waiting for is the sixteen delivered dogfood runs `execution-contract/budget.ts` derives those numbers from.
- **The measurement no longer needs a fixture.** [ADR 0083](0083-the-estimator-reads-the-runs.md) moved the pre-run forecast onto observations of real runs. The dogfood existed to produce a cost distribution; the product now produces one continuously.

What did not expire was the allowlist itself, and it was doing two different jobs while describing only one.

**Job one, economics.** `resolveAgentEconomics` returned an internal, non-production ceiling for a named project, so a dogfood run reserved 100 Credits out of `credits/internal.ts` rather than 200 out of the retail book. Its own docblock said exactly this, and said the allowlist now meant *"do not bill this one", rather than "let this one run at all"*.

**Job two, access — and this is the part nothing wrote down.** `website-preflight.ts` checked the same variable in three places, first thing, before reading anything:

```ts
if (!isDogfoodEligibleProject(params.projectId, params.env)) {
  return { eligible: false, reason: "not_dogfood_eligible" };
}
```

`resolveAgentPlanRoutes` is what the Agent workspace calls to decide whether to render a start control, and `previewAgentStep` is what `startAgentRunAction` — the one live start path — calls before writing anything. So for every project not named in an operator's environment variable, the Agent screen rendered, the plan rendered, and there was no button; and a request that reached the action anyway was refused. **The agent was not a product anybody could buy.** The price was live, the ceiling was live, the start limits were live, the pre-click disclosure was live, and the gate in front of all of it was an environment variable naming one project.

The intent was recorded plainly: *"der Agent ist live und soll funktionieren"* — and it was not.

## Decision

**Agentic execution is a customer operation, priced like every other one, reachable by every project.**

**The allowlist is deleted, not defaulted open.** `isDogfoodEligibleProject`, `internalDogfoodProjectIds` and the three gate sites are gone; there is no variable left to set. The refusal vocabulary loses `not_dogfood_eligible`, so a founder's screen can no longer answer *"the coding agent isn't turned on for this project"* — a sentence that was true and unactionable.

**There is one book.** `credits/internal.ts`, the `agent_execution_dogfood` operation kind, `EXECUTION_DOGFOOD_BUDGET_POLICIES` and `CORE4_DOGFOOD_BUDGET_POLICY` are deleted, and `AgentEconomicPolicy` loses `nonProduction` and `disclosure`. This is rule 76's shape: an effect that must never happen again is an **absent capability**, not a flag set false. There is no second ceiling anybody can be moved onto, because there is no second ceiling.

`agent_execution_runs.non_production_economics` **stays**, always written `false`. Sixteen rows say `true`, and they mean something different from every row written after this. Dropping the column would delete the only record of that difference.

**A benchmark fixture no longer reaches the start path.** `previewAgentStep` used to resolve Vibe's own fixture registry by namespaced step key, so a controlled benchmark could be started through the same Run button a founder uses. What made that safe was the allowlist standing in front of it. Without it, a customer could start a Vibe-authored task against their own repository — and pay for it — by typing a key their plan does not contain. So the start path resolves steps of the project's own plan and nothing else.

The registry itself stays. `economy/historical-runs.ts` reads it to classify the runs it already produced, `execution-context/service.ts` rebuilds a fixture-backed step during execution, and `dogfood/benchmark.probe.ts` remains a dry run that compiles a fixture through the production pipeline without spending anything. **What it loses is the ability to start one**, and the probe now says so instead of printing a URL that no longer exists.

**The live start actions move out of `agent-dogfood/`.** `startAgentRunAction`, `getAgentRunStatusAction` and `resolveAgentFounderInputAction` — the actions the Agent workspace and Nova both submit to — lived in `app/projects/[projectId]/agent-dogfood/[stepKey]/actions.ts`, a directory named after a harness. They are now `agent/agent-run-actions.ts`. The two compatibility redirect pages beside them are deleted rather than emptied: an empty redirect is still a URL somebody can land on.

**Rule 78 is rewritten in place**, per rule 83. Its first two sentences — an agent's own checks are advisory, Vibe's independent validation is the verdict — are untouched and are the part that was never about the dogfood.

## What this does *not* change

Nothing about what a run may do. `verifyCandidateChange` is still authoritative and still reaches the branch write first (rule 77); the harness still holds no long-lived credential (rule 79); the gateway still refuses on either binding (rule 80); `sandbox_validation_passed` still authorizes nothing (rule 66); a merge still needs an immutable human approval and fresh external state (rules 70, 71). **This decision is about who may reach a start button and what they are charged. It widens no capability.**

Nor does it open an unbounded spend. What already stood in front of a start, and still does:

| Bound | Where |
|---|---|
| 150 / 200 / 350 Credits by class, disclosed before the click | `credits/retail.ts`, `AgentStartCta` |
| A hold taken before the provider is called; no balance, no run | `holdAgentExecutionCredits` |
| 5 starts per project per hour, 40 per account per day | `operations/start-limits.ts` |
| Turns, repair loops, wall clock, sandbox time, changed files and bytes, AI calls, provider spend | `launch-v1-budget` |
| No network requests at all | `maxNetworkRequests: 0` |

The `agentic_pricing_not_configured` refusal is still reachable — a date outside every policy's interval produces it — and is still the right answer when it happens.

## Consequences

**Easier.** The agent is a thing a customer can buy. Every run now settles against the retail book, so the ledger, the projections and the internal console describe one economics rather than two, and a cost baseline accumulates from real customers rather than from one project somebody remembered to name.

Testing gets simpler in the way the operator asked for: their own project is charged like a customer's, which means what they exercise is the product, not a parallel path that resembles it.

**Harder.** The internal benchmark cannot be run end to end any more — it compiles and stops. That is a real loss and it is accepted deliberately: the harness existed to price the agent, the agent is priced, and re-opening a start path for it would mean re-opening the hole this closes. If a controlled benchmark is needed again, it needs a start path of its own with its own authorization, argued at that time.

**A mistake now costs money.** Under the allowlist, a defect in the start path could only affect a project an operator had named. It can now affect any customer's balance. The bounds above are what stands in the way, and the internal console ([ADR 0088](0088-the-internal-operator-console.md)) is where a run that goes wrong becomes visible.

**Not decided.** Whether the agent should be *offered* everywhere it is now *permitted* — the plan-routing rules that decide when a step is agentic are unchanged, and this decision does not widen them. Nor whether an operator's own project should be exempt from Credits by some other means; it deliberately is not, because a founder testing the live product with real Credits is the point.
