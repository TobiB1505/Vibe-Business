# Sprint 0076 — provenance by identity, and one contract too many

Status: **Both residuals closed. No migration.** Two items this session's own work left named and open: the Deep Scan the provenance check could not see, and a freshness module with no caller.

## Item 1 — the source with no column

[Sprint 0074](0074-evidence-pack-provenance.md) stopped the Opportunity Engine and the Action Planner from rebuilding an audit's evidence pack out of snapshots the audit never saw. It compared four source identities field by field and named the fifth as still open:

> The Deep Scan snapshot is not compared, because the audit table has no column for it … Closing it needs a column and a migration.

**It does not.** `computeAuditInputHash` already *is* the definition of "the same inputs": fourteen values, of which **nine are versions the audit row stores** and **five are the source identities a rebuild just loaded**. Recomputing that digest from the row's own versions and the fresh sources, then comparing it to the row's `input_hash`, verifies all five at once — including the one with no column.

So the fix is a smaller change than the one it replaces: no migration, no column, no backfill. It also inherits the identity function's existing care with null — `authenticatedSnapshotId` is carried through as JSON null rather than a sentinel, so "this audit reasoned without a Deep Scan" cannot be satisfied by one appearing later, and cannot be forged by a snapshot whose id happens to match a placeholder.

**The versions come from the row, never from today's constants.** A prompt or model bump is a legitimate reason to buy a *new* audit; it is not a reason to refuse to reuse an existing one's conclusions. Checking against current constants would answer "is this reproducible now?" — a different question from the one being asked.

**What the exactness costs is attribution.** A mismatched digest says something moved, not what. The verdict reports `unattributed` rather than guessing; the failure code is `inputs_changed` either way, as before.

### Why there are still two paths

`business_readiness_audits_v3_has_profile` guarantees the CORE-2 columns *only* for rows whose `evidence_pack_version` is `business-evidence.v3`. A pre-CORE-2 row was hashed by an older shape of the function, so recomputing it would refuse forever rather than detect anything. Those keep 0074's field-by-field comparison. The discriminator is the pack version, not a timestamp — the pattern that migration's own constraint established.

### The fixtures were describing pre-CORE-2 audits

Both durable-step suites seeded an audit with no reproducibility set at all, so `evidence_pack_version` was `undefined` and the new check silently took its legacy path — the v3 path would never have run. They now seed the full set **and a real `input_hash`**, computed by `computeAuditInputHash` from the sources they seed, instead of `"a".repeat(64)`.

That is the same class of defect this session has now hit four times: a fixture describing a world that cannot exist, letting a guard pass for the wrong reason. Here it was load-bearing — with a placeholder digest, every test in both files failed the moment the check became real, which is how it was caught.

## Item 2 — a second description of a contract that runs elsewhere

`execution-contract/freshness.ts` defined six premises to re-check before a consequential write, plus `evaluateFreshness` to check them. [Sprint 0072](0072-live-premise-revalidation.md) established it has **zero production callers**, and that `spec.freshnessChecks` is written onto every spec and read by nothing — into `execution_specs`, which is immutable by trigger, so every row has carried an unread list since the table existed.

Deleted rather than wired up, because tracing where each premise actually lives showed the list was **stale in both directions**:

| `FRESHNESS_CHECKS` named | actually enforced by |
|---|---|
| `repository_head_unchanged` | `evaluateAdmission` — live HEAD read, then compared |
| `repository_snapshot_current` | `evaluateAdmission` — `repository.snapshotIsLatest` |
| `action_plan_current` | `evaluateAdmission` — `plan.isCurrent` |
| `dependencies_still_satisfied` | `resolveStepExecution`, before the mode is decided |
| `deterministic_capability_still_matches` | `resolveMode`'s live capability re-match |
| `project_ownership_unchanged` | RLS, and each durable step's own `project.user_id` check |
| — *(never named)* | the **live-product premise**, added by 0072 |

Every premise it listed is enforced somewhere that runs, and the one premise added since was never added to it. A second, unread description of a contract is worse than none: it reads as the authority and is not. `freshnessChecks` is not part of `computeExecutionSpecIdentity`, so removing it changes no stored identity and orphans no row.

Its `spec.test.ts` assertion was left empty by the deletion and would have passed vacuously; it is replaced by one that pins the *absence* — the spec must not grow a second copy of this again.

## Proof

Item 1 is proven red-then-green on both call sites: replacing each `if (!provenance.matches)` with `void provenance` turns exactly four tests red — the repository-scan and live-scan races in each durable step — and restoring them turns them green. The unit suite adds the Deep Scan to the divergence set and pins both null directions.

Item 2 is proven by the typechecker and by the whole suite: nothing referenced what was deleted.

## What this does not do

**It does not remove `freshnessChecks` from rows already written.** `execution_specs` rejects every UPDATE by design, so historical rows keep the key in their `spec` jsonb. Nothing reads it, and nothing ever did.

**It does not touch the other freshness gate.** `execution-context`'s brief freshness — `assessFreshness`, `BriefFreshness`, `context_freshness` — is a different, live mechanism that withholds repository-derived claims from a stale snapshot. The name collision is precisely what made the dead one a trap, and is why the deleted module is named explicitly here rather than as "the freshness code".

**It does not close the pricing-class residual.** `economy/execution-class.ts` and `validation/depth.ts` still derive a price and a validation depth from evidence ids at plan time, so both can still be computed from a premise that has since gone stale. Named by 0072, still open.
