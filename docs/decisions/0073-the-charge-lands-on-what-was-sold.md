# 0073 - The charge lands on what was sold, and the ledger fills itself

Status: Accepted
Date: 2026-09-02

Amends [ADR 0061](0061-launch-v1-operation-rate-card.md) in its settlement
timing, not its prices. Nothing in the rate card moves; no Credit amount
changes; no Stripe object is touched.

## Context

Read out of production, from run `c462c083` on 2026-09-02:

```
00:22:31.463   100 Credits reserved
00:22:31.732   agent run created
00:31:35.305   ledger charge  −100 Credits
00:31:35.365   reservation settled
00:31:38.770   change_validation starts        ← three seconds later
00:37:55.711   change_validation passes
```

The customer was charged before a single check ran. Had those checks failed,
they would have paid in full for a change Vibe itself refuses to ship — and
`refundCharge` exists with zero callers, so nothing would have given it back.

That is not a small mismatch with what the price says it is for.
`credits/retail.ts`, explaining why validation, preview and review carry no
price of their own:

> They are bundled into the agent price, and their measured cost (~$0.045 +
> ~$0.022 + browser) is inside the $0.4282 above. **A customer bought a
> validated improvement, not a pipeline**; line-item them and the total price of
> an improvement stops being knowable in advance.

Two further findings came out of the same reading, and both bear on whether the
price is right at all rather than on when it is taken:

- **The sandbox half of every run's cost was never in the ledger.**
  `sandbox_usage_events.provider_cost_usd` is null in all 63 rows. That column
  is correct — Vercel reports no attributable per-sandbox amount — but
  `VERCEL_SANDBOX_RATES` has been founder-attested and `verified: true` since
  2026-08-20, and `deriveSandboxCost` computes a figure from dimensions the rows
  already carry. For run `c462c083` that figure is roughly **$0.10 against
  $0.754 of model spend**: about an eighth of the run, invisible.
- **`billing_usage_events` had one writer and it was a probe.** `reconcileUsage`
  is correct, idempotent and well tested, and its only caller is
  `pnpm billing:dogfood`. So the ledger that makes margin knowable — the one
  every price in `retail.ts` was derived from — filled up when an operator
  remembered. On 2026-09-02 its newest row was six days old and the run above
  appeared in it nowhere.

## Decision

### 1. Settlement waits for the verdict

The agent's hold survives the run and is resolved by validation.

```
agent run succeeds                     hold stays held
  validation reused (already passed)   settle
  validation started / running         wait
  validation could not start           release
validation passes                      settle
validation fails                       release
validation swept as stale              release
```

One function owns it — `coding-agent/hold.ts` — reached through persisted rows
only: prepared change → its operation → the agent run → `credit_reservation_id`.
It is idempotent by construction rather than by care: `settleOperationCredits`
returns the existing charge for a settled reservation and
`releaseOperationCredits` refuses one that is not `active`, so a verdict
arriving twice charges once, and a sweep racing a verdict cannot take back money
already charged.

**"Could not start" releases, and cannot mean "this repository has no
validation."** A repository whose changes cannot be independently validated
never reaches a run: `execution-contract/validation-requirements.ts` produces
`validation_not_supported` and eligibility refuses admission on it, precisely so
that an agent's own claim is never the only evidence. A failure at the hand-off
is therefore something moving underneath a run that had already started, which
CREDIT_ECONOMICS.md's approved failure policy absorbs — *a Vibe/system failure …
is 0 charged, Vibe absorbs*. No new pricing policy is invented anywhere here.

**Discard is deliberately untouched.** A validated improvement the founder
chooses not to merge was still delivered, and the price is for the improvement
rather than for the merge. One that never reached a verdict has already been
released by one of the branches above. So no path needed a new billing call, and
`execution/discard.ts` needed no service-role client.

### 2. The sandbox is priced where it is measured, in columns of its own

`estimated_cost_nano_usd`, `cost_pricing_version` and `vcpus` join
`sandbox_usage_events`. `provider_cost_usd` is unchanged and stays null.

Overloading it would mix *"the provider charged this"* with *"Vibe computed
this from a rate"* in a column that means the first everywhere else, and
`economy/cost.ts` exists to keep exactly those apart. So the ledger gains a
fifth cost status, `cost_estimated`, and a sum can still be taken over
measurements alone.

The vCPU count is stored with the figure because CPU and memory both scale with
it and it is a property of the sandbox *profile*: a profile moving from four
vCPUs to two would otherwise silently restate every historical estimate — the
failure `rateCardByVersion` prevents for prices, applied to the allocation.
Nothing is backfilled: a historical row was genuinely written under no rate card.

A partially measured sandbox stores **no** estimate. A total missing its CPU
term is a floor, and a floor in a cost column reads as the whole bill.

### 3. Usage is projected as it is measured

`credits/meter.ts` projects each AI and sandbox usage row into
`billing_usage_events` at the moment it is written. `reconcileUsage` keeps its
job — finding what this missed — rather than being the only way anything
arrives.

No cron, no queue, no sweep. Usage is created by an operation and can be
projected by the same operation, so nothing here needs a clock; [rule 24](../../CLAUDE.md)'s
"it needs no new infrastructure" is met rather than argued around. Projection is
idempotent through `billing_usage_events_source_sku_idx`, so a row projected
here and again by a later repair pass produces one event per SKU either way.

## Consequences

- **A customer is charged later than before, and only for what the price
  describes.** The hold is open across validation — typically six minutes — and
  their spendable balance reflects it, which is what a hold is for.
- **A validation that fails now costs Vibe rather than the customer.** That is
  the approved failure policy finally reaching the case it was written for.
- **Margin becomes measurable for the first time.** Both halves of a run's cost
  are in one ledger, and the ledger is current.
- **Rule 78 is unchanged and still binding.** Nothing here is a measured cost
  for a customer-facing Agent price; it is the instrument that will produce one.
  The `launch-v1` Agent tiers stay `basis: "modelled"`.
- **The existing six days of unprojected usage are not backfilled by this
  change.** `reconcileUsage` is exactly the repair pass for it and is an
  operator action.

## What this does not fix

`refundCharge` still has zero callers and there is still no admin surface. The
window it would cover is now much smaller — a charge lands only after a passing
validation — but "no operator can correct a charge" remains true and remains on
the roadmap.
