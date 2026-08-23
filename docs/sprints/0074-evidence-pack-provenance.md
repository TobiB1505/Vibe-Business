# Sprint 0074 — the pack the audit never saw

Status: **Implemented and proven red-then-green on both call sites. No migration, no new failure code.** The ROADMAP entry named a real structural fact and then described the wrong harm from it. The harm it named does not occur; a different one does, and it burns money.

## What the entry claimed, and what is actually true

> *Citations inside a stored audit are references into a document that no longer exists; only the input-hash gates keep them resolvable.*

**Resolvability was never the exposure.** `describeEvidenceId` resolves from the id alone, deliberately, so that a stored citation stays readable years after the pack it came from is gone — Sprint 0073 pinned that as a property and tightened it. A citation whose pack no longer exists renders exactly as well as one whose pack does. Nothing on any screen depends on the pack being retrievable.

**What the input-hash gates keep is not citations. It is the premise that a rebuild reproduces the audit's pack** — and on two of the three consumers, they do not keep it.

## The defect

`operations/opportunities/execution.ts` and `operations/action-plans/execution.ts` both rebuild the audit's evidence pack rather than carrying it across the durable boundary, which is correct and is Rule 52. Both rebuild it by loading the **latest** successful snapshot of each kind. Both then guard their inputs by recomputing the operation's input identity and refusing on a mismatch.

Neither identity contains a snapshot id:

- `computeOpportunityInputHash` hashes the audit's id, the audit's own stored `input_hash`, and seven version constants.
- `computeActionPlanInputHash` adds the Move, the conclusion key, the profile id and the founder intent hash. Still no snapshot id.

The audit row is not rewritten when a scan finishes. So a repository or live scan completing between the click and the durable step moves what `getLatestSuccessfulSnapshot` returns **without moving a single field either hash covers**. The guard passes. The pack is rebuilt from the new observation, and the model is handed the old audit's conclusions to prioritize against it.

`opportunities/execution.ts`'s own comment guards the adjacent case and says so: *"The audit can be superseded between the click and the step."* It does. The audit being superseded is caught. The audit's **evidence** being superseded under a still-current audit is not.

Nothing crashes, and that is the problem. The audit's citations are ids like `repo.surface.payments`, minted by a builder that still mints them, so they still render — pointing at a different observation than the sentence above them was written from. The pack's own label would describe the new scan while the audit's conclusion describes the old one. It is a paid call producing advice about a state that no longer exists, invisible from the outside.

## What shipped

`business-audit/pack-provenance.ts` — one pure function, `verifyPackProvenance`, comparing what a rebuild just loaded against what the audit row recorded. Both `loadSources` implementations call it after their existing identity check and return the existing `inputs_changed` on a mismatch. No new failure code, so no new user-facing surface.

`business-audit/store.ts` now reads back `repository_snapshot_id` and `live_snapshot_id`. Both have been `not null` on the table since it existed and both have been written on every row; neither was ever selected, mapped, or exposed on `StoredAudit`. A consumer rebuilding an audit's pack had no way to ask which snapshots the audit used.

## Two decisions inside the check, and why

**A null profile or intent hash is skipped. A null snapshot id refuses.** `product_profile_id` and `founder_intent_hash` are genuinely nullable — rows written before CORE-2 have neither, and back-filling one would be inventing a fact. The snapshot ids are `not null`, so a null there cannot come from production, only from a fixture describing an audit that could not exist. Skipping it would make the guard pass vacuously wherever a test forgot to seed one, which is precisely how a guard ends up green and absent at the same time. It refuses instead — and the opportunities fixture, which had never seeded either column, was corrected rather than tolerated.

**The check is made against the audit row, not against click time.** `operation.inputIdentity` answers *"are these the inputs the user clicked on?"* This answers the different and stronger question: *"are these the inputs the audit reasoned from?"* — which is what makes a rebuilt pack the audit's pack. For the action planner the two overlap on the profile and the intent; they do not overlap on the snapshots at all.

## The Action Planner had no test of any kind

The guard went into both `loadSources` implementations. Only one of them had a harness that could go red: `operations/action-plans/execution.ts` was wired straight into the Vercel executor and had never been exercised below the workflow level, while every other consumer of the execution foundation has a test file.

So this sprint wrote the first one — deliberately narrow, step 1 and the inputs it refuses on, with a happy-path assertion in front of the refusals so a fixture that never got past source resolution cannot make them all pass for the wrong reason. It is not the coverage the planner deserves. It is the coverage the guard needed in order to be a guard there rather than an unexercised line.

## Proof

Replacing each `if (!provenance.matches) return …` with `void provenance` turns exactly two tests red in each file — the repository-scan race and the live-scan race — and nothing else. Restoring turns them green. The unit suite covers the four divergences by name, the two skipped nulls, and the two refused ones.

## What this does not do

**The Deep Scan snapshot is not compared.** `computeAuditInputHash` takes `authenticatedSnapshotId` from a live lookup and hashes it, but nothing writes it to a column on `business_readiness_audits` — so there is nothing on the row to compare a rebuild against. A Deep Scan completing between the click and the step still moves the pack's `authenticatedProduct` unseen. Closing it needs a column and a migration, and is named here rather than papered over.

**The pack is still not persisted, and this sprint does not argue it should be.** Persisting it would put repository- and website-derived content into a durable store, which Rules 26 and 37 forbid outright, and into the execution provider's log, which Rule 52 forbids. Rebuilding is the correct design; what was missing was the check that the rebuild reproduces what it claims to.

**The audit's own step was already covered.** `computeAuditInputHash` contains all five source identities, so `operations/business-audit/execution.ts`'s `resolveInputs` has always caught this. The defect was in the two consumers that reuse the audit rather than produce it.
