# The charge lands on what was sold

**Recorded 2026-09-02, after the work.** Not a planned stage. It came out of one
question — *did the run actually do the economics right?* — asked about
production run `c462c083`, and answered by reading the database rather than the
code.

## What the database said

```
00:22:31.463   100 Credits reserved
00:22:31.732   agent run created
00:31:35.305   ledger charge  −100 Credits
00:31:35.365   reservation settled
00:31:38.770   change_validation starts        ← three seconds later
00:37:55.711   change_validation passes
00:39:46        change_preview starts
```

The customer was charged before a single check ran. `refundCharge` has zero
callers, so a failing validation would have left them paying in full for a
change Vibe refuses to ship.

Three things came out of the same reading and are worth separating, because two
of them turned out to be **correct as they stood**:

| | |
| --- | --- |
| settled at the reserved amount, not a metered one | **correct** — `launch-v1` is a fixed price per execution class |
| validation, preview and teardown billed nothing | **correct** — their cost is inside the agent price by design |
| settled before validation | **the defect** |

`credits/retail.ts` had already written down why the third is a defect, in the
paragraph explaining the second:

> They are bundled into the agent price… **A customer bought a validated
> improvement, not a pipeline.**

## The finding that mattered more than the fix

Settlement was removed from `finishAgentExecutionStep` — and **not one test
failed.**

7,382 tests, and the only assertion that a delivered run charges lived on the
winning branch of a race:

```ts
if (runs[0].status === "completed") {
  expect(charges()).toHaveLength(1);
  expect(reservation().status).toBe("settled");
} else { … }
```

Two things were wrong with it. `Promise.all` decides which actor wins and in
that harness the expiry always does, so the branch had never executed. And the
status it compares against — `completed` — is not a value
`agent_execution_runs.status` can hold; the real one is `succeeded`. A branch
that could not be reached had a condition that could not be true.

That branch is now driven directly, in its own test, and it was verified to fail
when the settlement is put back.

## What shipped

**Settlement waits for the verdict.**

```
agent run succeeds                     hold stays held
  validation reused (already passed)   settle
  validation started / running         wait
  validation could not start           release
validation passes                      settle
validation fails                       release
validation swept as stale              release
```

One function owns it, reached through persisted rows only — prepared change →
its operation → the agent run → `credit_reservation_id`. Idempotent by
construction rather than by care: settle returns the existing charge for a
settled reservation and release refuses one that is not `active`, so a verdict
arriving twice charges once and a sweep racing a verdict cannot claw back money
already charged. Eight tests drive those corners against the real billing chain,
including both directions of the race.

**"Could not start" releases**, and it cannot mean "this repository has no
validation": eligibility refuses admission on `validation_not_supported` before
a run begins, precisely so that an agent's own claim is never the only evidence.
So it is Vibe's own fault, and the approved failure policy absorbs it. No new
pricing policy is invented anywhere in this sprint.

**Discard needed nothing**, which is worth recording because it looked like it
would. A validated improvement the founder chooses not to merge was still
delivered; one that never reached a verdict has already been released by one of
the branches above. So no new service-role site was needed either.

### Two things the same reading exposed

**The sandbox half of every run's cost was never in the ledger.**
`provider_cost_usd` is null in all 63 rows and correctly so — Vercel reports no
attributable per-sandbox amount — but `VERCEL_SANDBOX_RATES` has been
founder-attested and `verified: true` since 2026-08-20. For run `c462c083` the
derived figure is roughly **$0.10 against $0.754 of model spend**: an eighth of
the run, invisible.

It now lands in columns of its own with a fifth cost status, `cost_estimated`,
rather than overloading the provider's column — mixing *"the provider charged
this"* with *"Vibe computed this"* is the one thing `economy/cost.ts` exists to
prevent. The vCPU count is stored with it, because a profile moving from four to
two would otherwise silently restate every historical estimate.

Writing it found a defect in the new code before production did:
`deriveSandboxCost` guards on `null` specifically, so an `undefined` slipped
past, multiplied into `NaN`, satisfied `known`, and landed in the total. The
agent execution suite caught it writing `NaN` into a cost column. Every
dimension is now narrowed to a finite number or to absence.

**`billing_usage_events` had one writer and it was a probe.** The ledger that
makes margin knowable — the one every price in `retail.ts` was derived from —
filled up when an operator remembered to type `pnpm billing:dogfood`. Its newest
row was six days old and this run appeared in it nowhere.

Usage is now projected as it is measured, for both AI and sandbox rows.
`reconcileUsage` keeps its job — finding what that missed. No cron, no queue, no
sweep: usage is created by an operation and can be projected by the same
operation, so rule 24's *"it needs no new infrastructure"* is met rather than
argued around.

## Three stale sentences corrected

`economy/cost.ts` and `run-economics.ts` both said no sandbox price exists
anywhere in the codebase. True when written, and not since 2026-08-20. Both are
corrected in the open, with a dated bracket leaving the original standing —
`run-economics.ts` keeps its required rate parameter anyway, because a scenario
is asked under a rate the operator chose and reaching for the current card there
would silently answer a different question.

## What this does not do

**It does not satisfy rule 78.** Nothing here is a measured cost for a
customer-facing Agent price; it is the instrument that will produce one. The
`launch-v1` tiers stay `basis: "modelled"`.

**It does not backfill the six days of unprojected usage.** `reconcileUsage` is
exactly the repair pass for it, and running it is an operator action against a
financial table.

**`refundCharge` still has zero callers.** The window it would cover is much
smaller now — a charge lands only after a passing validation — but "no operator
can correct a charge" is still true.

## Verification

7,392 unit tests, typecheck, lint and build clean. One migration, applied to the
remote database through the same authenticated path as the CLI and verified by
reading the catalog rather than the apply response; the local file carries the
version the server stamped.

**Not dogfooded.** The next real "Run with Vibe" is what confirms the new
settlement order end to end, and it is a founder action on a paid path.
