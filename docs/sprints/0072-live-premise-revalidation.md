# Sprint 0072 — the live premise, rechecked before the money

Status: **Implemented and proven red-then-green. No migration.** The ROADMAP entry that asked for this named a module that does not run; the check went where spending is actually gated instead.

## The gap this closes

Three of five dogfood calibration fixtures cited a `live.seo.*` defect that had been fixed between the audit and the run. All three reached the agent, which read the files, correctly found nothing to do, and failed with `agent_produced_no_change`. `docs/business/calibration/README.md` records it, and is blunt about what it means: *"the honest outcome for a false premise, not a defect in the agent."* Sprint 0055 named the production consequence — nothing stopped a real user starting a run against a premise that had already resolved, and once Credits were live they would pay for it.

## What the audit found, and where the ROADMAP was wrong

- **The entry's central mechanism claim was false.** It says `execution-contract/freshness.ts` "re-checks repository state, plan currency, dependencies and ownership immediately before a write." It re-checks nothing: `evaluateFreshness` has **zero production callers** — the only non-test reference is a prose mention inside a comment — and `spec.freshnessChecks` is written onto every spec and read by nothing. A seventh entry in that dead switch would have prevented nothing. (The audit of 2026-08-21 already listed `evaluateFreshness` as dead code; the ROADMAP entry was written as though it were live.)
- **The blast radius was understated.** Three of five fixtures, not two runs; `sitemap_missing` and `robots_txt_missing` were false too, not only `meta_description_missing`.
- **The "free and deterministic" claim held**, and it is what makes the fix legitimate. Verified by import trace, not assumption: `live-product-intelligence` imports no `AIProvider` and reaches no billable provider — it is bounded static HTTP through the safe-fetch boundary (Rules 35, 39). Rule 60's target is re-running the Business Audit, which *does* synthesize with a model. Observing costs nothing; concluding costs money. ("Deterministic" is the one word to hold loosely: it reads a third-party site that can change, and a budget-exhausted crawl degrades to `partial`.)

## What shipped

**`execution-contract/live-premise.ts`** — the decision, pure and unit-tested without a network. It rebuilds the live evidence pack from a snapshot with the same builder that minted the ids in the first place, and asks whether each cited id is still in it. No threshold and no polarity decoding: `business-audit/evidence.ts` appends `_missing` exactly when a signal is absent, so a fixed defect does not flip a value — its id stops being minted at all, and set membership is the whole test.

**A refusal at the gate that actually spends.** `evaluateAdmission` (`resolver.ts`) gains `live_premise_no_longer_true` and `live_premise_unverified`, beside the four premise checks it already performed. The verdict is *passed in*, never observed there — the resolver is deliberately a pure function of its inputs, exactly as `liveHead` is read by the caller and refused on here.

**`website-preflight.ts` does the I/O.** A snapshot completed *after* the plan already reflects a site the plan could not have been written against, so it answers for free; only an older one triggers a crawl. Every failure — no production URL, a crawl error, an inspection already running — resolves to `unverified` rather than to an assumption, because a refusal is always safe here and a false pass never is.

### Two design decisions worth naming

**Narrowed to defect ids, on evidence from a failing test.** The first implementation checked every `live.*` id and broke three existing tests — correctly, as it turned out: `buildLiveEvidence` also mints *positive* ids (`live.surface.pricing`, `live.site.title`), whose absence is ambiguous. A surface can vanish from a pack because it was renamed, moved behind auth, or simply not reached. Refusing a paid run on that guess is a worse failure than the one being prevented, so only `_missing` ids — where absence means one thing — are checked. Every case the calibration runs actually hit was a `_missing` id.

**Absence from a `partial` scan is not a fix.** A crawl that reaches a budget degrades rather than failing (Rule 39), and may simply not have fetched the page the defect is on. Unobserved and fixed are opposite facts, so a partial scan missing a cited id returns `unverified` and refuses — the same posture an unread repository HEAD already has, and the reason the verdict has four states rather than two.

**The prerequisite the research expected was not needed.** A check inside `freshness.ts` would have required `ExecutionSpec` to start carrying `evidenceIds`, which it drops today after deriving risk, routing and price. Seating the check at admission — which reads `step.evidenceIds` directly — avoids widening the spec at all.

## Proof

**Red before the fix, green after, verified by removing the gate and restoring it.** Both integration tests fail against the pre-fix code (`refuses when the cited defect is gone`, `refuses rather than guessing when the scan came back partial`) and pass with it. A third test is the control — a defect that is *still* real must still admit — so the refusal cannot be satisfied by something that simply stopped admitting.

Existing `website-preflight` fixtures were seeding steps that cite `live.*` evidence for a project with no live observation at all — a state the product cannot produce. They now seed the observation, which makes them represent a real world and additionally prove the check passes when the premise holds.

## What this does not do

**It does not stop a wrong price.** `economy/execution-class.ts` derives the pricing class and `validation/depth.ts` the validation depth from the same evidence ids at plan time. Both can still be computed from a premise that has since gone stale, and be shown to the user before admission ever runs. Named here rather than left implied.

**It does not revive `freshness.ts`.** `evaluateFreshness` and `spec.freshnessChecks` remain dead code. Deleting them, or giving them a caller, is its own item — this sprint deliberately did not add a check to a switch nothing calls in order to look like it had.

**It does not recheck repository-side premises.** Run 2's premise was falsified in source as much as live. The repository snapshot is already covered by `repository_snapshot_stale`/`repository_head_moved`; a stale `repo.*` evidence id is a separate gap.

**No migration. No new dependency.** The crawl reuses `inspectLiveProduct`, inheriting its budgets and the safe-fetch boundary rather than adding a second outbound path.
