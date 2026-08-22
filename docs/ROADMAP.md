# Roadmap

**Date:** 2026-08-22 · **Repository state:** `main` @ `3c2c246` · **Derived from:** [the intelligence architecture review](audits/2026-08-21-intelligence-architecture-review/README.md) and [the economics architecture review](audits/2026-08-21-economics-architecture-review/README.md)

## What may be in this file

This is a register of **known gaps**, not a plan and not a list of features.

- **Every entry cites something that exists** — a file path, a measured number, an ADR, or a "what has not been proved" line from a sprint record. An entry that cites nothing is a wish, and it does not belong here.
- **Entries are phrased as what is currently untrue or missing**, never as a feature to build. "Outcome verification cannot see agentic changes" is a gap. "Build an outcome dashboard" is an intention.
- **Entries leave this file two ways**: done, or dropped with a stated reason. Never by silent deletion.
- **No dates and no estimates.** The order is an argument about dependency, not a schedule.

The order below is dependency order. Correctness before foundation, foundation before breadth, breadth before fusion, fusion before the loop — because every later group consumes the earlier one.

---

## Now — financial correctness

These are the only entries on this list where the current behaviour can silently cost money or lose it.

**The materialized credit balance can drift, and nothing would notice.**
`credits/store.ts` guards `admitHold`, `takeFromLot` and `returnToLot` with a compare-and-swap and a bounded retry — the fix for the livelock recorded in `25e8f4a` — but `applyPostedDelta` and `releaseHeldCredits` are plain read-modify-write. The comment above the first says drift would be caught by `reconcileBalance`, which has no production caller.

**A retried settlement can leave a hold open forever.**
`credits/service.ts` returns early when it finds an existing charge for the idempotency key, before `closeReservation`. The ordering comment above it argues a crash between charge and close is safe "because a retry fixes it"; the retry takes the early return instead.

**A retried authorization can produce a hold with no lot behind it.**
`credits/operation-billing.ts` returns early on `alreadyHeld` without allocating, and the reservation row is inserted before `admitHold`. A crash in that window leaves an active reservation funded by nothing, which then settles at full price.

**Nothing ties a charge to the lots that funded it.**
`settleReservationAllocations` runs before `settleReservation`, and the release path releases allocations before checking status. There is no database constraint linking a `billing_credit_ledger` charge to its `billing_credit_allocations` rows, so an interleaving can consume lot capacity against no charge.

**No test exercises a real Postgres constraint.**
Every "database-level financial invariant" test runs against `FakeDatabase`'s hand-written re-implementation or string-matches migration text — `credits/schema.test.ts` says so in its own docblock. The 20-way concurrency scenario that found the livelock exists only in a commit message, so nothing would fail if `HOLD_ATTEMPTS` returned to 3.

---

## Next — one shared evidence foundation

**Live-product evidence is never revalidated before a run that costs money.**
`execution-contract/freshness.ts` re-checks repository state, plan currency, dependencies and ownership immediately before a write, but not the live-product evidence a step's classification and rationale rest on. Two calibration runs on the economics branch failed with `agent_produced_no_change` because `live.seo.meta_description_missing` had become false since the fixture was written — both times the agent was right and the premise was wrong. Re-running the scan that produces that evidence is free and deterministic; Rule 60 forbids spending the user's money, not observing.

**Evidence ids are minted twice, with incompatible meanings.**
`business-audit/evidence.ts` and `product-understanding/evidence.ts` each build ids from the same snapshots. `repo.surface.<id>` means "present" in one and "present or absent" in the other, distinguished only by the label — while `evidence-v2.ts` argues in its own comments that polarity must live in the id.

**The evidence pack is the load-bearing artifact of the whole reasoning chain and is never persisted.**
Audit, opportunities and planner each rebuild it from *current* snapshots. Citations inside a stored audit are references into a document that no longer exists; only the input-hash gates keep them resolvable.

**Contradictions are computed and never reach the model.**
`repository-intelligence/cross-check.ts` makes four fixed repository-vs-live comparisons, consumed only by `intelligence-summary.tsx`. There is no `contradiction.*` evidence, and no live-vs-Deep-Scan comparison at all — which is where the most valuable monetization contradiction would be.

---

## Then — measurement truth, then breadth

**The calibration dataset is too thin to calibrate anything.**
*Narrowed by Sprint 0055 (2026-08-22): validation CPU is no longer the blocker — the fix is verified, and runs 3, 4 and 5 recorded non-null `active_cpu_ms` every time.* What remains is the sample: three comparable runs at a mean absolute error of **53.4%**, roughly double the backtest's 24.3%, against a cohort sample floor of 20 below which the correction is exactly 1. Runs 1 and 2 stay `actual_incomplete` and contribute nothing. More runs is the only thing that closes this; a cleverer formula is not.

**Cache tokens are invisible to the billing projection.**
`credits/projection.ts` re-prices from input and output only, and `credits/schema.ts` explains the absent cache SKU with a reason that is no longer true — the columns exist and `ai/usage.ts` writes them. `ECONOMY_MODEL.md` measured cache at 55–70% of agent provider cost.

**Sandbox rates are founder-attested and unverified.**
`economy/infrastructure-rates.ts` carries `sourceKind: "founder_attested"` on every rate. One reconciled invoice would move the whole sandbox cost layer from attested to verified.

**Repository intelligence cannot see what execution needs.**
`package.json` scripts are parsed and discarded, then re-parsed inside the sandbox in two places; there is no test-infrastructure, CI, e-mail or feature-flag detection; and `runtime` is empty for anything that is not Node or Docker.

**Live product intelligence is homepage-centric.**
All eight document-level SEO signals and the entire brand block are read from the homepage only. `/pricing` is fetched at top priority and yields a title and CTA labels — no prices, plans or billing period — for a product whose central dimension is monetization. Headings are parsed, capped at 40 per page, and thrown away.

**A client-rendered product produces an almost empty scan with no warning.**
There is no rendering signal, so "we could not read this" is indistinguishable from "there is nothing here" — the failure mode the audit's own `insufficient_evidence` rule exists to prevent.

---

## Later — the loop, and what it is blocked on

**Outcome verification cannot see agentic changes.**
`execution/outcome-contract.ts` maps `agentic_execution_v1` to `null`, so every change the coding agent produces resolves to `outcome_not_supported`. The measurement half of the product is wired to two deterministic SEO generators.

**Business outcome measurement has no data source.**
Three metrics are defined and the port is vendor-neutral, but no adapter exists; every project resolves to `waiting_for_source`. Draft PR #34 holds partial Search Console work from 15.08.

**Snapshot history is complete, immutable, and never read.**
All four snapshot tables retain every version; no code compares two. A re-scan that loses the pricing page produces a new audit with no note that anything disappeared.

**Nothing learns from a run.**
`agent_execution_runs` carries around ninety observation columns and `execution-context/verification.ts` names the feedback in prose — a validation failure on a run whose agent verification was `low` "is exactly the signal that would justify moving a task class up a mode" — and nothing reads it. `economy/intelligence/` is the one correctly-built learning layer and is deliberately unwired.

**The unit that is charged and the unit that is sold are different things.**
An agent run settles at the reserved fixed price when the prepared change exists; validation runs afterwards, unreserved and uncapped. A validation failure after a successful preparation still charges.

**The one component that draws a score honestly has never drawn one.**
`src/components/ui/score-display.ts` encodes Rule 44 in code — a `null` dimension renders an empty track and the text `n/a`, never a `0` — and its only caller is its own test. `ScoreMeter` was deleted by UI-6 for want of a home, and Sprint 0057 confirmed the nine lenses are not where it belongs: `business-audit/schema.ts:146` says they are "not scores", and `business-map.tsx:132` already draws their health in words. The scored layer is the five dimensions, which UI-1.2 removed from the customer's face as a competing verdict. So the rule is enforced nowhere a customer can see, and the honest fix is a decision about whether dimension scores are ever shown again — not a component.

**No operator can correct a charge.**
`refundCharge` is implemented, tested through its decision function, constrained by a database CHECK — and has zero callers. So does the adjustment kind. There is no admin surface of any kind.

---

## Dropped

Nothing yet. Entries removed from this file are recorded here with the reason, so that "we decided not to" stays distinguishable from "we forgot".
