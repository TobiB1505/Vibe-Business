# The successor that never came up

**Recorded 2026-09-02, after the work.** Two commits, no migration, no product feature. Stage 1 of the architecture audit's build-chain work turned out to be a repair, and this is the repair: [ADR 0054](../decisions/0054-agent-action-plan-completion-evidence.md) is amended, nothing new is decided.

## The plan that could not move

The founder's own Action Plan, read out of the live database while scoping build chains:

```
1  founder_decision    Confirm the pricing structure       depends_on []     resolved
2  vibe/product_change Build a public pricing page         depends_on [1]    ran · verified · validated
3  vibe/product_change Make the pricing page reachable     depends_on [2]    blocked
4  vibe/product_change Wire Stripe checkout                depends_on [2]    prohibited (ADR 0066)
5  founder_action      Confirm a real purchase             depends_on [3,4]
```

Step 3 was not blocked pending something. It was **permanently unstartable**, and the sentence on screen — *"An earlier step has to finish first."* — was false while it was displayed.

The build-chain work was proposed as an efficiency: two runs cost two paid repository re-reads. It is not an efficiency. Without this repair, the sequential path a chain is supposed to improve on **does not exist**.

## Two independent causes, and the second is the interesting one

**The router never asked.** `resolvePlanExecutionRoutes` and `previewDogfoodStep` built their `completedSteps` from `completedStepsFromFounderResolutions` — one third of the projection ADR 0054 shipped. The resolver's own comment still read *"Empty today — nothing in the product completes a step yet"*, six sprints after it stopped being true.

**And the projection could not have answered.** `completedByAgentExecution` required `isExecutableByVibe(step)`:

```ts
return step.executionSupport === "vibe_executes_now" && step.capability !== null;
```

That is the **deterministic** shape. The agentic route is reached only when `matchCapability` returned null, so an agent-built step carries `capability: null` *by construction*. The predicate was false for every change the coding agent has ever made. Confirmed against the live row: step 2 is stored `not_yet_supported` with no capability, and it ran.

It was right when written — this ADR shipped when the SEO generators were the only producer with completed runs — and it outlived its scope by exactly one route.

The deeper error is one this repository already refuses to make elsewhere. `resolver.ts` does not read `executionSupport`, and says why: it was the Planner's answer when the plan was written, and routing re-derives from current state. Using those same two fields as a **completion** authority is the same mistake one layer over — a stale routing signal deciding whether something that demonstrably happened counts.

## A test was protecting the defect

`completion.test.ts` had a case named *"never lets Agent evidence complete founder, unsupported, or external work"*, and its middle fixture was `fakePlanStep({ id: "2-build", order: 2 })`. That builder's defaults are `actor: "vibe"`, `changeKind: "product_change"`, `executionSupport: "not_yet_supported"`, `capability: null` — **the agentic shape**, and deliberately so: the comment beside them says they are "the wrong answer on purpose, so a test that passes cannot be passing because the resolver read them".

So the suite filed the agent's own steps under "unsupported" and asserted that nothing completes them. Green, and pinning the bug. The case is now split: founder and external work stay refused; the third is renamed for what it is and asserts the opposite, with the Planner's two fields asserted still-wrong beside it.

## One thing added rather than repaired

The router asks a narrower question than the plan screen, and both answers are honest.

*"Is this done?"* is settled by a passed validation, exactly as ADR 0054 decided. *"May the next one start?"* needs one thing more: a run is prepared against the default branch, so starting a successor while its predecessor sits on an unmerged branch would hand the agent a tree without the pricing page it is supposed to link to.

`completedStepsForExecutionRouting` requires the merge for an agent step and leaves founder resolutions and attestations alone — neither produces a commit, so neither has a base to be missing from. The plan screen keeps the wider answer, so a founder is never told their finished work is unfinished while it waits for review.

## Verification

| Layer | Result |
|---|---|
| Domain (`pnpm test`) | 427 files, 7,383 tests |
| `pnpm lint`, `pnpm build` | clean |

**Proven red before green, both halves separately.** Restoring the `capability !== null` gate turns the new end-to-end case red on its own; blanking the router's completed set turns three red, including two that predate this work. Neither passes for a reason the other provides.

The end-to-end case drives the founder's plan shape through the real store reads rather than either projection in isolation: step 2 delivered and merged ⇒ step 3 `agentic`; delivered and unmerged ⇒ still refused; never run ⇒ refused.

**No browser test, and the reason is structural.** The screen that renders this reads `responsibilityByStepKey`, and the e2e harness supplies that map as fixture input rather than resolving it — so a Playwright test here would assert that a component renders what it was handed, which is already covered. The layer that would have caught this defect is the one it lived in: the resolver's *input*, now pinned by the end-to-end case above.

**Not dogfooded.** Step 2's Prepared Change is still unmerged on the real project, so the founder's own step 3 stays blocked — correctly, and now for a reason that will clear. One merge answers it.

## What this deliberately did not do

- **No build chains.** That is the next slice and it needs an ADR. This is the repair it rests on.
- **No new authority.** No table, no flag, no trigger. The four records ADR 0054 named are still the whole of it.
- **No widening of what completes a step.** `founder_action` and `external_party` are refused exactly as before, and the tests that prove it are unchanged.
