# Roadmap

**Date:** 2026-08-22 · **Repository state:** `main` @ `e0a35b3`, plus Sprint 0057 on its branch · **Derived from:** [the intelligence architecture review](audits/2026-08-21-intelligence-architecture-review/README.md) and [the economics architecture review](audits/2026-08-21-economics-architecture-review/README.md)

## What may be in this file

This is a register of **known gaps**, not a plan and not a list of features.

- **Every entry cites something that exists** — a file path, a measured number, an ADR, or a "what has not been proved" line from a sprint record. An entry that cites nothing is a wish, and it does not belong here.
- **Entries are phrased as what is currently untrue or missing**, never as a feature to build. "Outcome verification cannot see agentic changes" is a gap. "Build an outcome dashboard" is an intention.
- **Entries leave this file two ways**: done, or dropped with a stated reason. Never by silent deletion.
- **No dates and no estimates.** The order is an argument about dependency, not a schedule.

The order below is dependency order. Correctness before foundation, foundation before breadth, breadth before fusion, fusion before the loop — because every later group consumes the earlier one.

---

## Now — financial correctness

*Most of this section was closed by [Sprint 0057](sprints/0057-e1-ledger-hold-correctness.md). What remains is what a local fix could not reach.*

**Nothing repairs a drifted balance, and nothing ever reads the detector.**
`credits/balance.ts` computes drift and `service.ts` logs it — then returns the drifted figure anyway. Its only caller, `getBillingBalance`, has no caller of its own outside the module, and `reconcileLotAllocation` has none at all. Sprint 0057 made the failure that produces drift loud (`MaterializationError`) rather than silent, which is the input a repairer would need; it deliberately did not invent one. Who repairs, on what trigger, with what audit trail is ADR-sized.

**An orphaned hold is never reclaimed, and terminal operation status cannot authorize reclaiming it.**
`completeOperationRun` runs before `settleOperationBilling` (`business-audit/execution.ts:661/672`, and the same in action-plans and opportunities), so a sweeper keyed on a terminal operation would race settlement and produce a charge whose hold had been released. Sprint 0057 removed its planned sweeper on that evidence rather than shipping a heuristic. Closing this needs a lease — a running execution renews its claim — or a finalization marker on the reservation proving settlement can no longer arrive.

**`returnToLot` can permanently strand lot capacity.**
`lot-store.ts` logs and returns after ten contended attempts, on the argument that returning capacity is "the customer-favourable direction". It is the opposite: the customer keeps paying for Credits they can no longer spend, and nothing reconciles it. A money-losing path, deferred because the fix is a durable repair mechanism rather than a local correction.

**A zero-credit settlement is not idempotent.**
`service.ts` skips `postLedgerEntry` when `actualCredits === 0`, because the `credit_delta <> 0` CHECK forbids a zero-delta row. So the retry cannot find an existing charge, falls through, and refuses with `reservation_not_active`.

**No test exercises a real Postgres constraint.**
Every "database-level financial invariant" test runs against `FakeDatabase`'s hand-written re-implementation or string-matches migration text — `credits/schema.test.ts` says so in its own docblock. Sprint 0057 reproduced eleven defects against that fake and was explicit about the ceiling: it models statement atomicity honestly and does not serialize sequences, so it reproduces lost updates faithfully and cannot reach MVCC, `40001`, deadlocks, or the livelock class. The 20-way concurrency scenario that found the original livelock exists only in a commit message, so nothing would fail if `CONTENTION_ATTEMPTS` returned to 3 — and the new `UNIQUE (reservation_id, grant_id)` index is asserted only as a string. **This is E2, and it is next with nothing scheduled in between: financial correctness is not marked validated until it is green.**

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

**Cache token quantities are not metered, though their cost now is.**
*Narrowed by Sprint 0057 E2 (2026-08-22): the cost half is closed. `costForAiRow` prices cache reads and writes, which repaired 234 of the live ledger's 314 AI rows — every row carrying cache tokens was reported by `reconcileAiUsage` as a §69 cost mismatch, because the ledger priced cache and the projection did not.* What remains is the metering half: there is still no `anthropic_cache_read_tokens` or `anthropic_cache_write_tokens` SKU, and adding one is a migration because `billing_usage_events.sku` carries a CHECK constraint listing every value. It becomes chargeable-behaviour rather than reporting detail the moment a Credit rate card exists, since `rating.ts` rates per SKU quantity — `ECONOMY_MODEL.md` measured cache at 55–70% of agent provider cost, and a card would charge for none of it. `CREDIT_RATE_CARDS` is empty, so nothing is mischarged today.

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

**No operator can correct a charge.**
`refundCharge` is implemented, tested through its decision function, constrained by a database CHECK — and has zero callers. So does the adjustment kind. There is no admin surface of any kind.

---

## Dropped

Nothing yet. Entries removed from this file are recorded here with the reason, so that "we decided not to" stays distinguishable from "we forgot".
