# The Move the Planner split, and the run that puts it back together

**Recorded 2026-09-02, after the work.** Four commits, one migration, one ADR ([0077](../decisions/0077-build-chains.md)). Stage 3 of the architecture audit, second half — [Sprint 0131](0131-the-successor-that-never-came-up.md) was the first, and it turned out to be a repair rather than a feature.

## The measurement that decided the shape

Over every completed plan in this product, the maximal runs of contiguous `vibe`/`product_change` steps:

| Length | Chains |
|---|---|
| 2 | 4 |
| 3 | 2 |
| **1** | **none** |

Not a single Move has ever planned its build as one step. The Planner splits engineering work for a founder's readability, and the execution unit inherited that split as if it were a boundary.

## What a chain is not

`dependencies.ts` already answers a question that looks like this one — *may this prerequisite be carried?* — and the temptation was a fourth dependency class. Three reasons it is a separate module instead, and the third is the one that would have quietly broken something:

**Direction.** `classifyExecutionDependency` walks backwards along `dependsOn`, and its output feeds `blockedBy`. `resolver.ts` computes `blocked = blockedBy.length > 0`. A successor arriving in that array would block the run it was meant to extend.

**Partiality.** Absorption is all-or-nothing on purpose — its own comment says a run carrying half its preparation proceeds on an incomplete premise. That is right for prerequisites and wrong for successors: a chain of three that can only carry two is a good chain of two.

**Completion.** `AbsorbedPreparation` is explicitly *not* completion, and ADR 0026 promises the Planner's state is untouched. A chain member must be completed or the chain buys nothing. Reusing that type would have broken ADR 0026's guarantee inside the type that carries it — silently, and only visible months later as steps that never finish.

## The three decisions that were about money

**The identity gains the chain only when there is one.** Appending an empty list to every canonical form would have re-hashed every stored spec. That is not a migration inconvenience: the spec identity feeds `computeAgentRunIdentity`, and `startAgentExecution` returns a *succeeded* run by that identity as `reused`. A re-resolution of already-delivered work would have stopped finding the run that delivered it and taken **a second reservation**. A frozen digest is checked in against exactly that.

The converse is rule 67. Without the keys in the hash, a founder who declines the chain, approves a one-step change, and later has the same unchanged world re-resolved would find their approval sitting on a spec claiming two steps — same project, plan, step key, base, snapshot, mode, class, risk, capability, context and versions, so the same identity. The keys make that unrepresentable, which is also what makes declining safe to offer: it is a different artifact, not a mode.

**Neither the resolver version nor the spec schema version moves.** Both were considered and rejected in writing. No step resolves differently — the head is `agentic` before and after, and the chain adds members to the *offer*. And a v1 spec read by chain-aware code yields no chain, which is what that run was. Bumping either would have cost the rehash above for no behavioural difference.

**A chain is always `complex`, and the awkward case is stated rather than hidden.** `small` and `standard` allow the same eight files and 60 KB — `budget.ts` says that is deliberate — and only `complex` widens. A chain is by construction more than one delivery, so pricing it under a single step's ceiling would not merely undercharge; it would strand the run at `budget_exhausted` after the founder paid. Two `small` steps therefore cost 300 Credits apart and **350 chained**. Two `standard`: 400 → 350. Three `small`: 450 → 350. One case is more expensive and it is written into the ADR rather than left for someone to discover.

## Storage, and the constraint that matters

`step_key` and `step_order` stay singular: the head is still the delivery target. Two parallel arrays carry every member, and the shape exists so the constraints can — the arrays agree in length, keys are non-blank, orders strictly ascend, and **a spec's head is always a member of its own chain**.

That last one is what stops a row claiming to deliver steps 3 and 4 while being the spec for step 2 — an artifact whose completion, price and provenance disagree about what it is. The application refuses the same shape; the constraint is the half that holds when the application is not the writer, which for `execution_specs` means the service-role client.

PostgreSQL refuses a subquery in a CHECK, so two `immutable` helper functions carry the element-wise predicates. Both are pure over their argument and read no table.

## What the tests are for

**`chain.test.ts`'s last suite is the one that matters most.** Every title, purpose and done-when in the founder's real plan is replaced with text arguing for a longer chain, and the answer must not move by one member. That is rule 57 as an assertion rather than as a claim.

**The commit-message pin had to stay green unmodified.** `Vibe-Chain` is omitted entirely without a chain, so a solo commit is byte-identical to before. If `execution.test.ts:823` had needed editing, the design had leaked into runs that carry no chain.

**The security guard was strengthened rather than left to pass by luck.** `startAgentRunAction` gains a parameter, and the existing guard — "no parameter beyond project and step identity" — happened to still pass. It now asserts the actual contract: `chain: boolean` is present, `chain: string[]` is not, and comments are stripped before the check, because prose explaining the boundary is not a parameter a client can fill.

## Verification

| Layer | Result |
|---|---|
| Domain (`pnpm test`) | 431 files, 7,426 tests |
| SQL/RLS (`pnpm db:test`, real PostgreSQL) | 19 files, 242 tests — 9 new |
| Browser (Playwright, chromium) | 38 in `agent-stages.spec.ts`, 5 new |
| `pnpm lint`, `pnpm build` | clean |

The browser tests answer the question the other layers cannot: whether a founder can tell what they are about to buy. Two controls, two *different* figures — a screen showing one price for two options is the specific defect they exist for — both steps named as deliveries rather than groundwork, the boundary sentence rendered, and the declined path identical to the screen as it was.

**Not dogfooded, and this is the sprint where that matters most.** Two things only a real run answers, and one of them is the likeliest way this is wrong:

- Whether an agent given two fenced delivery blocks builds both, or writes the pricing page and stops. Measured by whether the diff contains the link at all.
- **Whether a chain fits under `complex`'s twelve files and 90 KB.** Run #7 took eight files for one step. Two could exceed twelve, and the outcome would be `budget_exhausted` after a 350-Credit reservation.

If the second turns out badly, the answer is a shorter chain, not a bigger ceiling.

## What this deliberately did not do

- **No per-member verification.** The chain does not check each `doneWhen`. That is a new authority over what "delivered" means, and asking the agent would be rules 77 and 78.
- **No chains across Moves, through a hard boundary, or containing a deterministic step.** A chain with a hole is not a chain, and `prepared_changes.capability` is singular.
- **No skipping a settled founder step.** Contiguous in plan order, not in unfinished work — "steps 2 and 3 of this Move" is a sentence a founder can check.
- **No raised ceiling and no fourth pricing tier.** The chain rides `complex`, which exists, is priced and is calibrated.
- **No chain offer on the plan screen.** ADR 0067 gave it one responsibility line per row; a second offer surface there would have to be kept in agreement forever.
