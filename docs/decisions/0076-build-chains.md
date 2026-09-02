# 0076 - Build chains: one run may deliver the contiguous steps of a Move

Status: Accepted
Date: 2026-09-02

Amends [0026](0026-agentic-execution-contract.md) — a run carries successors as well as preparation — and [0054](0054-agent-action-plan-completion-evidence.md), whose projection now completes several steps from one execution. Changes no risk class, no path policy, no tool set and no merge rule.

## Context

The Planner splits engineering work for a founder's readability. It is not drawing execution boundaries, and the plans in production say so plainly. Over every completed plan in this product: **six runs of contiguous `vibe`/`product_change` steps — four of length two, two of length three, and never one.** Not a single Move has planned its build as a single step.

The founder's own plan is the shape:

```
1  founder_decision    Confirm the pricing structure       resolved
2  vibe/product_change Build a public pricing page         depends on 1
3  vibe/product_change Make the pricing page reachable     depends on 2
4  vibe/product_change Wire Stripe checkout                depends on 2 — prohibited (ADR 0066)
5  founder_action      Confirm a real purchase             depends on 3, 4
```

Steps 2 and 3 are one engineering change. Executing them as two runs means run → approve → merge → re-read the repository (HEAD moved) → the plan may have been superseded → run again. [Sprint 0130](../sprints/0130-the-successor-that-never-came-up.md) had to make that sequence *work at all* before this decision could be about efficiency rather than about a defect.

## Decision

**A run may carry a build chain: the contiguous, dependent, agent-eligible `product_change` successors of its head, within one Move.** One spec, one prepared change, one approval, one fast-forward.

**A chain is offered, never imposed.** The screen shows two controls at two prices, and the founder may still start the head alone. That is not a courtesy: a bigger diff per approval is a real cost to review quality, and a founder who wanted to stop after step 2 must be able to.

### It is not a dependency class

`classifyExecutionDependency` walks backwards along `dependsOn` and its output feeds `blockedBy`. Three reasons the two stay apart, and the third is the one that would break a promise:

1. **Direction.** `resolver.ts` computes `blocked = blockedBy.length > 0`, so a successor arriving in that array would block the run it was meant to extend.
2. **Partiality.** Absorption is all-or-nothing on purpose — a run carrying half its preparation proceeds on an incomplete premise. A chain of three that can only carry two is a perfectly good chain of two.
3. **Completion.** `AbsorbedPreparation` is explicitly *not* completion; ADR 0026 promises the Planner's state is untouched. A chain member must be completed or the chain buys nothing. One type for both would break that promise inside the type that carries it.

So `EXECUTION_DEPENDENCY_CLASSES` keeps three values, `dependencies.ts` is untouched, and `chain.ts` is a separate forward walk resolved **over** the resolutions rather than inside one — `resolvePlanExecution` maps steps independently and two screens depend on that.

### The rules, structural and in this order

A successor joins when its prerequisites are satisfied by completed work or by this same chain; it is `vibe`/`product_change`; its risk is within `MAX_AGENTIC_V1_RISK` and not `prohibited`; no registry capability serves it; and the chain is under `MAX_BUILD_CHAIN_MEMBERS`. The first successor that fails ends the walk, and the reason is reported.

**No prose is read.** Rewording every title, purpose and done-when in a plan changes nothing, and a test asserts exactly that. It is the property that stops a model talking its way into a longer run.

**Three members, measured rather than chosen.** The longest chain any plan here has contained is three, and `complex` allows twelve changed files while dogfood run #7 took eight for a single step.

**Contiguous in plan order, not in unfinished work.** A settled founder step in the middle still ends the chain. "Steps 2 and 3 of this Move" is a sentence a founder can check against their plan; "steps 2 and 4, skipping the decision you already made" is one they would have to reconstruct.

### Identity, and the money consequence of getting it wrong

The chain's step keys and `BUILD_CHAIN_POLICY_VERSION` enter `computeExecutionSpecIdentity` **as an optional tail element, appended only when there is more than one member.** A solo spec therefore hashes to exactly what it always did, pinned by a frozen digest.

That is not tidiness. The spec identity feeds `computeAgentRunIdentity`, and `startAgentExecution` returns a *succeeded* run by that identity as `reused`. Re-hashing every stored spec would mean a re-resolution of already-delivered work stops finding the run that delivered it and takes a second reservation.

And without the keys in the hash, rule 67 breaks in the other direction: a founder declines the chain, approves a one-step change, and a later re-resolution of the same unchanged world — same project, plan, step key, base, snapshot, mode, class, risk, capability, context, versions — produces the same identity for a two-step spec. The approval of A would come to apply to B. The keys make that state unrepresentable, which is also what lets the chain be *offered*: declining is not a mode, it is a different artifact.

**Neither `EXECUTION_RESOLVER_VERSION` nor `EXECUTION_SPEC_SCHEMA_VERSION` bumps.** No step resolves differently — the head is `agentic` before and after, and the chain adds members to the offer rather than to the classification. And a v1 spec document read by chain-aware code yields no chain, which is exactly what that run was; there is nothing to reinterpret. Bumping either would cost the identity rehash above and buy nothing. Considered and rejected rather than overlooked.

### Storage

`execution_specs.step_key` and `step_order` stay singular and not null: the head is still the delivery target — what `loadPlanStep` finds, what the commit subject anchors to, what provenance derives from. Two parallel arrays carry every member including the head, and the shape exists so the constraints can: the arrays agree in length, keys are non-blank, orders strictly ascend, and a spec's head is always a member of its own chain.

Not a jsonb path, because the completion projection is about to decide from this row whether several plan steps are finished. ADR 0054's first authority is "an immutable `execution_specs` row binds this plan and this step"; extending that binding should be as constrainable in SQL as the single one is. Empty arrays mean today's meaning, so there is no backfill — the existing rows *were* single-step runs.

### Completion

One record per member, sharing all four ids. The four-record requirement is evaluated **once per run**, unchanged: a chain does not turn one weak verdict into several, and a run whose validation did not verify the changed files completes nothing at all.

The claim is exactly as strong as ADR 0054's and no stronger: *the spec named this step as a delivery target of one change, and that change passed independent validation.* Vibe cannot verify delivery per member — `changed_file_count` and the verdict are per change, and asking the agent would be rules 77 and 78. What bounds the risk is structural: at most three contiguous dependent members of one Move, and a human still approves the one diff, in which they can see whether the pricing page is actually reachable.

### Price

The classifier runs over the union of the members' evidence, with the **maximum** risk among them — not the head's, because `risk.ts` escalates on evidence families and taking the head's would be the "talk a risky step down" move the escalate-first order exists to prevent. Then more than one member escalates to `complex`, with a new reason `chained_delivery`.

The argument is blast radius, not surface count. `small` and `standard` allow the **same** eight files and 60 KB — deliberately, per `budget.ts` — and only `complex` widens, because it is the tier defined by spanning more than one thing. Pricing two deliveries under a single step's ceiling would not merely undercharge; it would strand the run at `budget_exhausted` after the founder had paid.

**The consequence, stated rather than hidden:** two `small` steps cost 300 Credits apart and 350 as a chain. Two `standard` cost 400 apart and 350 chained; three `small`, 450 and 350. Only the cheapest case is more expensive, and it also collapses two approvals into one.

The union is computed in exactly one place, and everything downstream reads the answer off the stored document — so the quote, the reservation and the settle agree by construction. The one surface that could disagree is the screen, which now resolves both figures through the same function.

`EXECUTION_PRICING_CLASS_POLICY_VERSION` moves to v2 (rule 65). The bump is free: the pricing class is deliberately not in the spec identity.

### The commit message

A second, differently-named trailer:

```
Vibe-Step: <head step key>
Vibe-Chain: <member key> <member key>
```

Not a repeated `Vibe-Step` (impossible in the type) and not a comma-joined value (it would silently change the meaning of a trailer ADR 0035 defines as one step key). `Vibe-Chain` is omitted entirely without a chain, so a solo commit is byte-identical and the existing test pin stays green unmodified — if that pin had needed editing, the design had leaked.

The subject stays the head's. `branch.ts` reads it from the trusted plan step rather than from the objective so as not to open a second source of truth, and a composite subject would mean synthesising prose from several Planner titles.

## Consequences

**What the founder sees.** Two controls at two prices, both steps named as deliveries rather than groundwork, and a sentence saying why the chain stops where it does. After the run: *one change, checked once, covering these N steps* — never "N steps done", which would imply N artifacts and N verdicts.

**What the browser cannot supply.** The start action takes one boolean of intent. A submitted list of step keys would be caller-controlled input deciding what gets built and charged for; the server re-derives the members inside the same fresh preflight, so a world that moved between render and click yields a shorter chain and a smaller charge rather than a quote that no longer resolves.

**Deliberately absent.** No per-member verification of `doneWhen`; no chains across Moves; no chains through a hard boundary — a chain with a hole is not a chain; no chains containing a deterministic step, since `prepared_changes.capability` is singular; no raise to `MAX_AGENTIC_V1_RISK` or to the `complex` ceiling; and no fourth pricing tier. If a dogfood shows two members do not fit in twelve files, the answer is a shorter chain rather than a bigger ceiling.

**Untested until a real run.** Whether an agent given two fenced delivery blocks builds both, and whether a chain fits the `complex` envelope, are behavioural facts about the harness that no unit test reaches.
