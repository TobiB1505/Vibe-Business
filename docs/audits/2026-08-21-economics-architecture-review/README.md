# Vibe Business — Economics Architecture Review

**Date:** 2026-08-21 · **Repository state:** `main` @ `bd7dc42`, compared against branch `claude/economy-intelligence-v1-a5wwfn` @ `dc5943b` (merge-base `405439b`) · **Method & limits:** see [Appendix A](#appendix-a--method-and-limits)

**The question this review answers:** *Is the economics architecture — cost, credits, holds, settlement, margin — sound enough to carry a paying customer, and what must be true before a Credit price is activated?*

**The one-sentence answer:** The design is unusually well thought through and its four-truths separation is structurally enforced, but four financial-integrity defects sit on `main` in the read-modify-write seams, no test exercises a real Postgres constraint, and the measurement layer that any price would have to be answerable to is not yet producing a single comparable observation.

Findings are marked **CONFIRMED** (verified in code), **LIKELY** (strongly indicated, not conclusively proved) or **UNKNOWN**. Unmarked statements are CONFIRMED.

---

## Contents

1. [Executive summary](#1-executive-summary)
2. [Branch state versus main](#2-branch-state-versus-main)
3. [Current economics architecture](#3-current-economics-architecture)
4. [The economic product unit](#4-the-economic-product-unit)
5. [Pricing classification](#5-pricing-classification)
6. [Admission and budgets](#6-admission-and-budgets)
7. [Credits and ledger](#7-credits-and-ledger)
8. [Holds, reservations, settlement](#8-holds-reservations-settlement)
9. [Concurrency and idempotency](#9-concurrency-and-idempotency)
10. [Usage metering](#10-usage-metering)
11. [Provider costs](#11-provider-costs)
12. [Sandbox and infrastructure costs](#12-sandbox-and-infrastructure-costs)
13. [Infrastructure allocation and validation economics](#13-infrastructure-allocation-and-validation-economics)
14. [Failure economics](#14-failure-economics)
15. [Estimate versus actual](#15-estimate-versus-actual)
16. [Economy intelligence](#16-economy-intelligence)
17. [Feedback and adaptive economics](#17-feedback-and-adaptive-economics)
18. [Pricing strategy versus billing engine](#18-pricing-strategy-versus-billing-engine)
19. [Unit economics](#19-unit-economics)
20. [Credit model assessment](#20-credit-model-assessment)
21. [Margin architecture](#21-margin-architecture)
22. [Economic invariants](#22-economic-invariants)
23. [Security, abuse, leakage](#23-security-abuse-leakage)
24. [Dead and transitional logic](#24-dead-and-transitional-logic)
25. [What we should not build yet](#25-what-we-should-not-build-yet)
26. [Target economics architecture](#26-target-economics-architecture)
27. [Gap matrix](#27-gap-matrix)
28. [Migration roadmap](#28-migration-roadmap)
29. [Sprint plan](#29-sprint-plan)
30. [Spreadsheet modelling blueprint](#30-spreadsheet-modelling-blueprint)
31. [Integration points with product intelligence](#31-integration-points-with-product-intelligence)
32. [Open architecture decisions](#32-open-architecture-decisions)
33. [Recommended first sprint](#33-recommended-first-sprint)
34. [Final recommendation](#34-final-recommendation)
- [Appendix A — Method and limits](#appendix-a--method-and-limits)

---

## 1. Executive summary

1. **The "economics branch" is smaller than assumed, and that is good news.** The merge base is `405439b`; the branch is exactly **26 commits** ahead of `main` (28 files, ~5,000 lines), and all 26 are the Sprint 0055 calibration campaign — harness, frozen predictions for five runs, two real runs, a CPU metering fix, a `.env.local` loader, a runbook. **No new migrations, no new ADRs.** The entire economics core — `credits/`, `billing/`, `economy/`, roughly 65 files, reservations, settlement, Stripe, rate simulation — is **already on `main`**.

2. **The four-truths separation (raw cost → rating → credits → revenue) is clean and structurally enforced.** Nanodollar integer arithmetic only in `ai/pricing.ts` and `economy/`; a branded `CreditUnits` type; `CREDIT_RATE_CARDS = []` as a *structural* absence of a production rate card, pinned by three test files; retail as a fixed-price book; EUR prices only in `billing/catalog.ts`. Nothing converts cost into price automatically — verified three independent ways.

3. **But there are four real P0 financial-integrity gaps, all on `main`, none on the branch.** (F1) `applyPostedDelta` and `releaseHeldCredits` are the only two money-cache writers without a compare-and-swap, so a lost update is possible under concurrency. (F2) The settlement retry returns on an existing charge **before** `closeReservation`, so the crash-recovery path its own comment documents does not exist and a hold can stay open forever after a charge. (F3) The `alreadyHeld` retry skips lot allocation, permitting a hold with no lot behind it and a settlement with no lot provenance. (F4) Settle/release interleaving can consume lot capacity against no charge — nothing in the database links a charge to its allocations.

4. **Measurement truth is the bottleneck, not the estimator.** Both real calibration runs ended `actual_incomplete` (validation CPU `null`, measurement confidence "none") and contribute **nothing** to the learning dataset — "not even a zero". The branch fixes that at the root (session read after snapshot, plus status polling); status is **fixed-pending-verification**. Fifteen of nineteen historical validation rows carry `active_cpu_ms: null`.

5. **The leakage discipline (pre-execution inputs only) is the best in the repository — with four concrete holes.** (H1) The "the estimator never reaches the execution path" guard is already **transitively bypassed** (`calibration.probe.ts` → prediction snapshot → pre-execution estimate + safety margin). (H3) The drift term in the calibration path measures the **query, not the repository** — 8 to 34 candidates, because the fixture cites different evidence. (H6) The backtest synthesizes `complete: true` from incomplete actuals, so the 24.3% MAE stands on softer ground than documented. (H2) `expectedValidationDepth` is the one type-level open pre/post boundary.

6. **No CI test exercises a real Postgres constraint.** Every "database invariant" test runs against a hand-modelled fake or string-matches SQL text. The most important backstop, `billing_credit_accounts_available_non_negative`, has **no** behavioural test, and the concurrency livelock actually found in production (20 parallel requests, 8 of 10 correct admissions) has **no** regression guard — `HOLD_ATTEMPTS` could silently return to 3.

7. **Failure economics are coherent: zero charge on every Vibe, provider or no-result failure**, with `abandoned_with_usage` as an honest enum rather than a boolean. The gaps: the `agent_reservation_invalid` path does not release; `cancelAgentRun` has zero callers; there is no generic reservation sweeper, only the agent-specific one; and **no operator correction path exists** — refund, adjustment and goodwill are schema plus logic with not one reachable caller.

8. **The unit that is charged today is "prepared change", not "validated improvement".** The agent run settles at the reserved price on a successful prepared change; if the automatically enqueued, unreserved, uncapped validation then fails, the charge stands. Validation is part of the declared product unit but is neither reserved nor measured (CPU null) nor billed — the economic unit and the billing unit have diverged (§4, §13).

9. **Metering detail findings.** Cache tokens — 55–70% of agent provider cost — are invisible to the billing projection: `credits/schema.ts` carries a now-false comment and `costForAiRow` re-prices from input and output only, so `reconcileAiUsage` would flag every agentic cache row as `costMismatch`. The gateway ceiling has a TOCTOU window (read before forward, write after stream). `agent_execution_runs.turns` is never written. `maxAiCalls: 60` and `maxSandboxMs` are declared and enforced nowhere.

10. **Economy Intelligence is verified as the right template for adaptive systems**, confirming the intelligence review — with reservations. The disciplines are real and tested: weakest-axis confidence, median rather than mean, a sample floor of 20 below which the correction is exactly 1, versioned clamps, propose-never-activate, snapshot reproducibility including a JSON round trip. The reservations are H1, H3 and H6, plus a `median()` duplicated four times and `ON_TARGET_BAND` three times.

11. **The branch itself is merge-light:** a calibration harness (which spends nothing by construction), a metering fix, and documentation. Its merge precondition is essentially **production verification of the CPU fix**. The P0 risks are on `main` and are independent of the merge.

12. **Recommended order:** E1 financial-integrity correctness (F1–F4 plus a sweeper) → E2 a real-database constraint and concurrency harness → E3 measurement truth (verify the CPU fix, cache SKU and projection, calibration runs 3–5, which presupposes the live-evidence freshness fix from the intelligence review) → E4 an operator correction path plus settlement/allocation coupling → E5 the agent quote path → E6 consolidation and documentation drift. No ML pricing, no wallets, no per-request Vercel micro-allocation.

---

## 2. Branch state versus main

Measured directly rather than taken from subagent reports — two analyses computed the merge base against a stale local `main` and wrongly concluded that `economy/` was branch-only.

```
main (bd7dc42) ──── 2 trivial commits (e-mail logo) ────┐
  │                                                      │
  └── merge-base 405439b                                 │
         │                                               │
         │  PR #67 "economy-intelligence-v1" was merged into main
         │  BEFORE the merge base — economy/, credits/ and billing/
         │  are byte-identical on both sides except for three files
         │
         ├── design five calibration moves (classes known before the run)
         ├── render frozen prediction + reconciliation
         ├── operator runbook, two commands
         ├── break the fixture import cycle at the root
         ├── a failed calibration read fails, rather than reading as absence
         ├── records as files, overwrite refusal
         ├── .env.local loader (+ tests)
         ├── preflight reports the actually resolved pricing class
         ├── run 1: prediction frozen, actual bracketed
         ├── fixture corrections (real surfaces, refusal reasons)
         ├── run 2 attempt 1: failed — STALE LIVE EVIDENCE
         ├── live-evidence freshness gap documented
         ├── runs 2/3/5 rebuilt; run 2 succeeded
         ├── CPU: read validation usage from the STOPPED session
         ├── CPU: poll session status before giving up
         └── README: CPU metering → "fixed-pending-verification"   ← HEAD
```

**Diff against the merge base:** 28 files, +4,974 / −247. New: the calibration harness and its probe, a local-env loader, and `docs/business/calibration/` (README plus two prediction/actual pairs and one archived failed attempt). Changed: the Vercel validation provider (the CPU fix), validation budgets (two poll budgets, 500 ms × 10), `actual-economics.ts` (the **bracket** — unpriced sandbox at 0% and 100% CPU as an honest range), the learning dataset, the isolation guard (an allowlist for the calibration harness plus a new estimator-never-reaches-execution guard), fixtures, the probe config and a new `agent:calibrate` script.

**What economics logic exists only on this branch?** Exactly: the calibration harness and its frozen records, the CPU metering fix, the actual-cost bracket, the safety-guard rework, and the env loader. Everything else is already on `main`.

---

## 3. Current economics architecture

The actual flow, which deviates from the expected model in three places (marked ⚠):

```
User starts an operation (audit / opportunities / plan / agent dogfood)
        │
        ▼
[agent only] Admission: resolver → mode, risk, HEAD checks
   ⚠ classifyExecutionPricingClass is NOT called here —
     the pricing class exists only in the calibration harness and analysis
        │
        ▼
Price: chargeFor() = fixed price from retail.ts (35/20/15/free)
       or internal.ts (agent dogfood: a 100-credit CEILING, not a price)
   ⚠ NO cost/credit estimate in the production path; quoteCredits() exists
     with zero callers; the economy estimator is a deliberately unwired island
        │
        ▼
authorizeOperationCredits: sweepExpiredCredits → claimReservation
  (insert before admitHold; CAS 10 attempts with jittered backoff)
  → allocateReservation (lots, expiring-soonest-first, all-or-nothing)
        │
        ▼
Agent execution (sandbox + gateway)
  ├── ai_usage_events: one row per gateway call, tokens including cache,
  │     provider_cost_usd in integer nanodollars
  ├── sandbox_usage_events: wall / activeCpu / egress — provider_cost_usd null
  │     in ALL 43 historical rows (policy: unknown ≠ zero)
  ├── gateway ceilings: 300k output tokens (from $3), 180 requests,
  │     both authorities (signature + per-request re-read state)
  └── agent_execution_events / tool_events (telemetry)
        │
        ▼
Prepared change → SETTLEMENT: settleOperationCredits charges
  reservation.reservedCredits VERBATIM ("that IS the price")
   ⚠ settlement reads NO usage; actual-usage computation exists only in
     economy/ (analysis), never in the billing path
        │
        ▼
Independent validation — AUTOMATICALLY enqueued (ADR 0037), maxRetries 0
  ⚠ AFTER settlement; no reservation, no settlement, no cap beyond
    SANDBOX_BUDGETS; cost lands in its own sandbox_usage_events row
        │
Failure anywhere → releaseOperationCredits: the full hold returns,
  reason failed_without_usage | abandoned_with_usage (persisted)
        │
        ▼
Economic observation: economy/ reads the ledgers READ-ONLY
  deriveActualExecutionEconomics (4 components, floor + bracket)
  → compareEstimateToActual (comparable | actual_incomplete | …)
  → reconcile / detectCohortBias: median, clamp [0.8, 1.25], sample floor 20,
    below which exactly 1 — a PROPOSAL that activates nothing
        │
        ▼
Future estimation: estimateExecutionEconomics (similarity neighbours ×
  repo / drift / validation multipliers × cohort scalar), PredictionSnapshot
  reproducible including a JSON round trip — sole consumer: the calibration harness
```

The three ⚠ deviations are the central architectural facts: **(a)** estimation and classification do not run in the admission path today, **(b)** settlement is a fixed price and never reads usage, and **(c)** validation runs economically *outside* the billed unit.

---

## 4. The economic product unit

**Declared** (`docs/business/CREDIT_PRICING_V1.md`): `validated_agent_improvement`. **Implemented:** what is charged is the **prepared change**. The agent run settles on successfully preparing the change; a validation that fails afterwards does not alter the charge, and validation itself is unreserved, unbilled and today unmeasurable.

| Unit | Measurable | User value | Cost correlation | Understandable | Abuse | Failure / refund | Pricing-fit |
|---|---|---|---|---|---|---|---|
| `agent_run` | ✅ | ❌ (effort ≠ value) | ✅ | ❌ | run spam pays Vibe — the wrong incentive | difficult | ❌ |
| `prepared_change` (today) | ✅ | ⚠ unvalidated | ✅ | ⚠ | medium | zero charge on no-change works | ⚠ |
| **`validated_agent_improvement`** | ✅ once validation is measured | ✅ | ✅ (validation ≈ 15% share, measured) | ✅ | low — validation is Vibe-controlled | clear: not validated ⇒ not delivered | ✅ |
| `business_move` / `action_plan_step` | ✅ | ✅ | ❌ (one move = *n* steps of variable cost) | ✅ | planner-manipulable | unclear | ⚠ as a bundle later |
| `outcome_verified_improvement` | ❌ today | ✅✅ | ❌ (outcome latency is days) | ✅ | attribution | causality boundary in code | ❌ now, P3 |

**`validated_agent_improvement` remains the right unit — but it is not the one billed today.** What the founder should economically pay for is *a prepared, independently validated, review-ready change*: the first link in the chain that Vibe fully controls, that correlates with cost, that is explicable as value, and that has clean failure behaviour (not validated means release, not refund). The roadmap consequence is that **settlement belongs after validation** — which in turn presupposes that validation is measured (E3) and that its window is inside the hold. Until then, a fixed price on a prepared change is an honest transitional state as long as the UI promises nothing else. Outcome-based units stay metrics, never billing units.

---

## 5. Pricing classification

`economy/execution-class.ts` takes exactly four inputs: `riskClass`, `changeKind`, `evidenceIds` and `surfaces` (passed in rather than recomputed). Escalate-first in fixed order: non-mutating → `null`; high or prohibited risk → `complex`; a sensitive evidence prefix (seven entries, **imported** from `validation/depth.ts` rather than copied) → `complex`; two or more surfaces → `complex`; one surface → `standard`; zero evidence → `standard` ("escalate on silence"); otherwise `small`. Version `execution-pricing-class.v1`. Deterministic — no clock, no randomness, no IO, order-independence tested — and price stability proved end to end against real cost spread: run #3 at $0.3465 and run #6 at $0.1444 yield identical credits.

**Input prohibitions:** the classifier by a type-shape test (exactly four keys); the estimator by a source scan banning nine identifiers (`inputTokens`, `outputTokens`, `thinkingTokens`, `durationMs`, `activeCpuMs`, `sandboxDurationMs`, `ai_usage_events`, `sandbox_usage_events`, `actualCost`) plus clock/random and import bans.

**Where is the class determined?** Today **nowhere in the production path** — only in the calibration harness, historical reconstruction and the probe. `agentic_pricing_not_configured` is the admission refusal that makes that honest.

**Are three classes enough? Yes — and more would be wrong today.** `complex` has **n=0** cost observations and `small` has n=1. A five-tier XS–XL scheme would want to calibrate five cohorts where three are not filled — overfitting announced in advance. Continuous estimation as a *customer price* is explicitly and correctly rejected: credits price a class, not a run, or the byte-identical step #6 → #9 at 2.16× the cost would carry two prices. The right long-term path is the one already laid: **class equals price, estimate equals internal reservation and margin control.** A fourth class is worth considering only when real data shows a class is bimodal.

---

## 6. Admission and budgets

`CORE4_DOGFOOD_BUDGET_POLICY`; production policies are `[]`, and an unset allowlist authorizes nobody (rule 78 upheld).

| Budget | Value | Purpose | Hard/soft | Basis | Sound? |
|---|---|---|---|---|---|
| `maxCredits` | 100 ceiling, equal to `internal.ts` — equality required but **not enforced** | dogfood cost cap | hard (admission) | set, "every number is a guess, stated as one" | ✅; the coupling test is missing |
| `maxProviderSpendUsd` | $3.00 | provider cap | hard ×2 (SDK + gateway derivation) | dogfood | ✅ |
| Gateway `maxOutputTokens` | 300,000 (= $3 / output rate; **automatically becomes 200,000 on 2026-09-01**) | containment | hard | derived | ✅, document the price-change effect |
| Gateway `maxRequests` | 180 | containment | hard | derived | ✅ |
| `maxAgentTurns` | 40 | loop cap | hard (SDK) | dogfood | ✅ |
| `maxAiCalls` | 60 | — | **enforced nowhere** | — | ❌ dead value: enforce or delete |
| `maxWallClockMs` | 20 min | runtime | hard (poll + token expiry) | dogfood | ✅ |
| `maxSandboxMs` | 15 min | — | **enforced nowhere**; the comment claims it matches sandbox lifetime, and the real lifetime is 30 min | — | ❌ stale |
| `maxChangedFiles` / `maxChangedBytes` | 8 / 60 KB | blast radius | hard (gateway pre-write) | dogfood | ✅ |
| `maxRepairAttempts` | 3 | repair cap | hard (gateway) | dogfood | ✅ |
| `maxFilesRead` | 300 | discovery | hard | dogfood | ✅ |
| `maxNetworkRequests` | 0 | — | structural (no tool) | — | ✅ |
| AI operation caps | 24k/12k/6k/10k out; 240/120/60/120 s | per operation, sized from the ledger | hard | **measured** | ✅ the model to follow |
| Validation | 300 s/step, 15 min total, 64 KB output, 24 h artifact TTL | sandbox control | hard | set / measured | ✅ |
| Browser | Deep Scan 8 pages / 90 s; review 120 s | per-second cost cap | hard | set | ✅ |

**These are historical dogfood safety limits, not economic limits** — and the code says so itself ("deliberately loose… the budget already stopped the run"; "a guard rail", not accounting). The one thing that *functions* as an economic limit today is the derived pair $3 ⇄ 300k tokens. Genuine economic limits — a reservation derived from an estimate, a class ceiling — are laid out but unwired. That is correct for the dogfood phase; before customer prices, quote → reservation must replace or accompany the fixed amount.

---

## 7. Credits and ledger

**The append-only ledger is the source of truth, and this is true in practice:** the only write paths are `.insert`, there are no UPDATE or DELETE paths, write policies are absent by omission, and refunds are compensating entries. `posted_credits` and `reserved_credits` are declared materialized caches and simultaneously the atomic admission gate.

Strengths: an unusually complete constraint set with justifying comments (`sign_matches_kind`, `refund_references_charge`, `adjustment_has_reason`, `settled_within_reserved`, `available_non_negative`, `(account, idempotency_key)` unique, one active hold per operation run); branded integer units with `-0` normalization and an exactness proof on rounding; a lot model with deadline spend order, read-time expiry rather than trusted status, and a correctly closed allocation/expiry race; a Stripe layer with three independent idempotency levels, a live refetch rather than payload trust, and an amount never taken from the event.

Weaknesses:

- **Cache integrity rests on two unprotected writes (F1).** The rest of the module argues compare-and-swap as its reason for existing, and precisely the decrement half was left out of the livelock fix. The comment points at `reconcileBalance` as the detector — and **`reconcileBalance` has no production caller**, so drift detection can never fire. **P0.**
- No transactional RPC (deliberate); every guarantee rests on single-row serialization plus CHECK constraints. Viable as an architecture **if** F1–F4 are closed and tested against a real database.
- `posted_credits` has no `>= 0` CHECK of its own, only the pair via `available_non_negative`.
- The idempotency-key namespace is inconsistent (the agent path uses a bare UUID).
- Documentation drift: Sprint 0037 calls the retry "bounded at 3"; the code has said 10 since the livelock fix. *(Corrected in the open by [Sprint 0056](../../sprints/0056-documentation-currency.md): the value was 10 in that sprint's own commit, so it was never true.)*

**Long-term financial integrity:** LIKELY yes. The data model — ledger, lots, constraints — is sound; the risks concentrate in the read-modify-write seam and in the test gap, both addressable without a redesign.

---

## 8. Holds, reservations, settlement

Lifecycle: `sweep → chargeFor → claimReservation (insert → CAS admitHold) → allocateReservation → run → settle (charge at reserved, then close) | release (reason persisted)`. The behaviour matrix is largely correct and doubly secured in app and database: double reserve, settle-after-release, release-after-settle, expiry mid-flight, insufficient funds (two gates, the lot gate authoritative, with a hold rollback).

The four holes:

| # | Hole | Consequence | Severity |
|---|---|---|---|
| F2 | Settlement retry: an existing charge causes an early return **without** `closeReservation`; the upstream guard checks `status === "settled"`, which is false in exactly this state, and falls into the same early return | A crash between charge and close leaves the charge booked **and** the hold permanently active. The documented recovery path does not exist | **P0** |
| F3 | The `alreadyHeld` retry skips `allocateReservation`, and the reservation insert precedes `admitHold` | A crash in that window leaves an active hold with no cache increment and no lots. Settlement charges in full while `settleReservationAllocations` returns empty — a charge with no lot provenance | **P0** |
| F4 | `settleReservationAllocations` runs before `settleReservation`; release frees allocations unconditionally before checking status; the database does not link a charge to its allocations | A settle/release race consumes lot capacity against no charge, or produces a charge whose lots were returned | **P0/P1** |
| F7 | `expires_at` on reservations is never set, and there is no general sweeper | Non-agent holds from crashed operations can stand indefinitely — mitigated today by workflow release paths, but with no backstop | P1 |

In addition: the `agent_reservation_invalid` path leaves the hold active with no release call; paused runs keep the hold **deliberately** and correctly; and `cancelAgentRun` is unwired.

---

## 9. Concurrency and idempotency

**The documented incident is found and immortalized in the code** (`credits/store.ts` plus commit `25e8f4a`): a merge verification against live Supabase, 20 × 100-credit requests against exactly 1,000 credits, yielded only 8 of 10 correct admissions. The cause was `HOLD_ATTEMPTS = 3` with no backoff, producing lockstep collisions. It was correctly classified as a liveness rather than a safety defect. The fix: ten attempts with jittered linearly growing backoff, duplicated identically in `lot-store.ts`.

**Does the fix solve the class or the case?** The CAS-loop class: **yes** — one pattern across `admitHold`, `takeFromLot` and `returnToLot`, with safety independent of the retry count via the CHECK backstop. The decrement class: **no** (F1) — the fix was applied where the bug was observed, not to every function of the same shape in the same file. And there is **no regression guard** for the liveness parameters; the fake-database `Promise.all` tests cannot in principle reproduce this bug class.

Other idempotency anchors: the `ai_usage_events` cardinality fix (uniqueness loosened exactly where it was structurally wrong — the agentic loop — plus a hot-path lookup index; without it the gateway ceilings would have been permanently blinded and "a runaway run would not have been stopped"); `sandbox_usage_events` unique on the preview session; the validation write coupled to the terminal transition; and the agent sandbox row with **no** uniqueness gate, protected only by `maxRetries = 0`. **The gateway TOCTOU window** — state read before forward, usage write after stream in `after()` — lets parallel in-flight requests from one harness exceed both ceilings by the degree of parallelism. Bounded in practice by harness seriality, but undocumented. P2.

---

## 10. Usage metering

| Metric | Measured | Persisted | Priced | Customer-price input | Accuracy |
|---|---|---|---|---|---|
| Input / output tokens | ✅ | `ai_usage_events` | ✅ nano per token | **no** | null on a transport failure before the response |
| Thinking tokens | ✅ | ✅ | inside output, never double-counted | no | the agent path does not report the split |
| Cache read / write | ✅ (agent) | ✅ | ✅ 0.1× / 1.25× input | no | **the billing projection ignores them; the SKU comment is stale** |
| Provider cost | derived | `numeric(18,9)` + pricing version | integer nanodollars | no | the SDK's own `costUSD` is deliberately discarded |
| Gateway calls | ✅ | implicit | — | no | counts failures too, intentionally |
| Agent turns | ❌ | column exists, **never written** | — | — | dead column |
| Tool calls | ✅ (events) | events | — | no | the gateway counter is structurally 0 under this topology — documented |
| Sandbox wall / CPU / egress | ✅ / best effort | `sandbox_usage_events` | only in `economy/` (founder-attested) | no | **CPU: a null history; fix pending verification** |
| Validation runtime | ✅ | `validation_runs` + a usage row | rate-derived only | **no — no reservation** | see above |
| Browser | ✅ | own ledgers | no rate (`null`, never guessed) | no | the provider supplies no price |

**The required three-way split is already doctrine in the code:** operational telemetry (events, counters) ≠ cost attribution (`economy/`, floor plus bracket, "unknown is never zero", only provider numbers may be called `measured`) ≠ customer billing input (today: **nothing** — a fixed price). This separation is one of the system's strengths and should remain an invariant.

---

## 11. Provider costs

`ai/pricing.ts` is the only price location (rule 46), effective-dated half-open, integer nanodollars, with cache rates as their own integers rather than a computed multiplier (the float argument is documented), and `UnpricedModelError` rather than silently free. A row is written even when unpriced or failed, so tokens survive with a null cost. `maxRetries: 0` at every money-touching point. The gateway uses stream `tee()` plus `after()` accounting — before that fix, zeroes were feeding the ceilings.

**Historical reproducibility:** yes, with two caveats. (1) `recordAIUsage` prices at wall-clock `new Date()` with no `at` parameter while the projection re-prices at `row.created_at`, which is a mismatch source across the 2026-09-01 price boundary — practically harmless (LIKELY), but unnecessary. (2) **Cache tokens are missing from `costForAiRow`**, so `reconcileAiUsage` would flag every agentic cache row as `costMismatch`, and the schema comment claiming no column exists has been false since the agent migration. An old run stays exactly reconstructible via `pricing_version` plus stored tokens, and prediction snapshots additionally copy the rates in — belt and braces, correctly.

---

## 12. Sandbox and infrastructure costs

`sandbox_usage_events.provider_cost_usd` is null in **all 43 historical rows**, as a policy rather than a gap: "an invented rate would produce a number that looks like money and is not." Pricing exists only analytically in `economy/infrastructure-rates.ts` — Vercel Sandbox CPU $0.128/CPU-hour, memory $0.0212/GB-hour, creation $0.60/M, egress $0.15/GB, and Functions including **workflow events at $20/M**, 33× more expensive than invocations, an attribution the file marks as its own claim. **Provenance is `founder_attested` throughout.** The scale already exists in the code as a `sourceKind` field; only the tiers are missing. Recommendation: extend the enum (`provider_documented`, `invoice_verified`) and reconcile **one** real Vercel invoice against a month of `sandbox_usage_events`. That lifts the entire sandbox cost layer from attested to verified, once, cheaply.

The active-CPU history — the known peculiarity — records four attempts: a stale SDK record after `snapshot()`, a re-read before snapshot (worse), a **session read after snapshot**, and then **status polling** on `snapshotting`/`stopping` at 500 ms × 10. Values are never invented from wall time; instead the new **bracket** (0% to 100% CPU on the unpriced sandbox) supplies the honest range. Status: fixed-**pending-verification**, and that verification run is the branch's real merge gate.

---

## 13. Infrastructure allocation and validation economics

**Infrastructure allocation.** The code answers "attribute every cent to a run?" correctly by implication: direct variable costs (provider tokens measured, sandbox seconds estimated at attested rates, workflow events modelled) are attributed per run; everything else — general Vercel Functions, Supabase, bandwidth — is **deliberately not** allocated per run, and `PLAN_CREDITS_ARE_NOT_MODELLED = true` keeps plan-inclusive volume explicitly out. **Leave it exactly so:** direct variable costs plus a later platform-overhead allowance percentage in the spreadsheet, no micro-allocation. The `infrastructure` component in actual economics (~$0.0013 per run) is already the right order of magnitude for that honesty.

**Validation economics.** Validation is part of the declared product unit but is automatically enqueued *after* settlement (ADR 0037, `maxRetries 0`, every enqueue decision audited), **without reservation, settlement or cap** beyond the sandbox budgets (~5 minutes of microVM per run, named in the ADR itself as "Vibe's infrastructure cost, not the customer's credits"). Its cost is attributed as its own usage row, but CPU was null until the fix. Depth economics: `fast` skips exactly `test`; `deep` is identical to `standard` (honestly documented); depth is part of the validation identity, so there is no reuse across depth boundaries.

**Should an expensive validation path influence the credit price?** Not as a dynamic price — that breaks class stability. Yes as a **class input in the long run**: the model already carries `assumedValidationCostShare: 0.15`, derived from measurement, and a validation multiplier in the estimator. Calibration run 4 is designed for exactly this. Until data exists, whether 0.15 holds is UNKNOWN.

---

## 14. Failure economics

| Failure | Provider cost? | Recorded? | User credits? | Hold |
|---|---|---|---|---|
| Admission refused / insufficient credits | no | — | 0 | never taken |
| Reservation does not cover the ceiling | no | — | 0 | ⚠ **stays active** (no release call) |
| Provider transport failure / timeout | **possible, unknown** | row failed, tokens null | 0 | release `abandoned_with_usage` |
| Provider refusal / truncation / bad JSON | yes | row failed **with** tokens and cost | 0 | release `abandoned_with_usage` |
| Sandbox failure (validation) | no model cost | usage row failed | 0 (nothing reserved) | n/a |
| Agent produces no change | yes (real) | yes | 0 | release `abandoned_with_usage` |
| **Validation fails after a successful agent run** | already settled | yes | **charged in full** | settled |
| User interrupt / pause | yes | yes | — | hold stays **deliberately** (resume needs budget) |
| Infrastructure crash mid-run | yes | yes | 0 | sweeper: fail + release `abandoned_with_usage` |
| Timeout | partly | row failed | 0 | release |

**The economic principle the code already lives:** *Vibe absorbs technical failures and fruitless runs entirely — zero charge, released with an honest reason — and the user pays only for a delivered result, at the fixed price reserved in advance.* Measured reality: a **41.7% failure rate**, and 43% of audit runs historically failed *after* real provider spend, so the zero-charge principle is a genuine margin subsidy that must be priced in. `CREDIT_PRICING_V1.md` does exactly that with failure-adjusted margins. The one inconsistency is that a failed validation is still charged in full, contradicting the declared product unit.

---

## 15. Estimate versus actual

The estimator is a similarity-weighted neighbour mean (weights 0.45/0.20/0.15/0.20, threshold 0.3) × a repository multiplier (log2 terms against a reference scale, clamped [0.75, 1.75], with an unmeasured input yielding a term of 1 *and a stated reason*, never a silent 1) × a drift lookup × a validation term × a cohort scalar defaulting to 1. Confidence is the weakest axis, never an average, and sample size travels with it.

Error metrics: leave-one-out over runs #3–#9 gives **MAE 24.3%, worst +51.3%, median −9.7%, with no systematic direction**, pinned as range assertions. Overfitting protection: a sample floor of 20 below which the correction is exactly 1; a clamp of [0.8, 1.25]; a median rather than a mean.

**How variance information is used:** today, reporting only. The live calibration produced −51.7% and −62.6% against the floor — **both incomparable** because of the measurement gap, so zero learning contribution. The estimator is LIKELY systematically high, since both brackets sit well below the prediction, but that is only assertable once actuals are complete. Which is exactly the right discipline, and exactly why E3 precedes any estimator improvement: the fix is evidence, not a cleverer formula.

---

## 16. Economy intelligence

It exists, is substantial (~65 files including 17 in `intelligence/`) and is of unusual quality: an isolation island (no outward import except the newly allowlisted calibration exception; no Supabase; guards applied recursively including a guard on the guard); a `PredictionSnapshot` with rates copied in and matched runs travelling alongside, so a replay against a grown dataset is identical (JSON round trip tested); `resolveEconomyModel` throws rather than falling back; `economy-model.v1` carrying every assumption explicitly; and reconciliation as propose-never-activate, with `CREDIT_RATE_CARDS === []` re-asserted after every simulation.

Weaknesses: H1 (the guard is transitively bypassed — the commit claims more than the assertion checks), H3 (drift measures the query rather than the repository; `RepositoryContextSize` has no provenance field and the pre/post variants are type-identical — H4), H6 (backtest `complete` is synthetic), H7 (`prediction-bias` is missing from the import ban list), a scan covering only `pre-execution-estimate.ts` while neighbouring modules go unscanned, and `median()` duplicated four times, `ON_TARGET_BAND` three times, the clamp twice.

---

## 17. Feedback and adaptive economics

What the system may learn, and how: exclusively the pattern already codified — cohort statistics over comparable runs → a **scalar, clamped, versioned** correction, exactly neutral below the sample floor, offered as a proposal to a human policy decision, reproducible from a snapshot. Legitimate learning targets in order of data availability: a per-cohort provider-estimate correction (mechanics complete, waiting on n ≥ 20); a reservation buffer calibrated from real brackets; the validation share; and a per-class complexity floor once `complex` reaches the floor.

**Not:** online ML, automatic price changes, per-customer prices, black-box adjustments. The clamp, the versioning and propose-never-activate are already the right prohibition architecture — "a loop that can raise its own cost expectation without limit is an outage with a feedback path". The conservative loop therefore already exists as code; what is missing is **comparable observation** and, later, an explicit audited activation step.

---

## 18. Pricing strategy versus billing engine

**The separation is clean and structurally enforced more than once.** The billing engine (ledger, holds, settlement, Stripe) computes correctly and knows no strategy. Pricing strategy lives in exactly three deliberately separated places: `retail.ts` (founder-approved fixed prices of 35/20/15, explicitly rounded *above* the document's recommendations of ~33/16/11 — a business decision, commented as one), `internal.ts` (a ceiling, not a price), and `economy/credit-rate-card.ts` (hypotheses A/B/C, isolation-banned). No path converts measured cost into a sale price; `applyScenario` is the only cost-to-price function and has no caller outside its test. The doctrine is the sentence in `retail.ts`: *"a customer told '20,413 tokens, therefore 17.29 Credits' has been handed Vibe's cost structure as their problem."* This separation belongs on the invariant list and on the spreadsheet boundary.

---

## 19. Unit economics

From real measurements — all non-production, small n, and to be treated as such:

```
Per improvement (agent run, class standard, current data):
  Model (provider, measured)         $0.11–$0.35   (cache share 55–70%)
  Agent sandbox (attested rates)     ~$0.016–0.025
  Validation (target ~15%)           UNKNOWN (CPU null) → bracket width up to 34%
  Infrastructure (workflow events)   ~$0.0013
  = known floor                      $0.14–$0.43
Failure adjustment: a 41.7% failure rate means cost per DELIVERED improvement ≈ ×1.7
  (the documented learning: a success-mean understates by about a third)
Reference fixed prices today: audit 35 credits / opportunities 20 / plan 15
  Agent: NO price (model C simulated at 200/300/500 credits against a 75% target)
```

**Product execution economics versus company financial economics.** The separation already exists cleanly: execution economics in code (`economy/`), company economics (CAC, LTV, fixed costs, conversion) in no code at all, named only as a non-goal. Leave it that way — CAC, LTV, retention, support and fixed costs belong in the spreadsheet, never in `src/`.

---

## 20. Credit model assessment

**Are credits right? Yes — as what they are here:** an abstracted product usage unit, decoupled from tokens and dollars, with subscription plus included plus packs already built (Free 0 / Builder €19 → 1,000 / Pro €49 → 3,000; packs 500/€12, 1,500/€33, 5,000/€99; a welcome grant of 100 with 30-day expiry; lots with deadline spend order).

Alternatives: *pure usage* is rightly rejected, since it makes Vibe's cost structure the customer's problem; *subscription plus metered overage* is effectively the target state of the existing model, with included credits as subscription lots and packs as overage, so no rebuild is needed; *outcome bundles* are P3; *hybrid* is what this already is. Credit anxiety is correctly addressed by fixed class prices rather than variable billing.

**What one credit means:** today, correctly, *only* a product unit. Retail simulates $0.01 per credit as an assumption, and `units.ts` anchors 1,000 subunits against measured model-cost spread. The warning is already heeded in code: credits are **not** simultaneously a cost unit (nanodollars are), not a risk budget (that is the 100-credit ceiling in a *separate* book, with an equality requirement rather than a shared value), and not a EUR price (the catalog is). The one hardening left is to enforce the internal-ceiling ⇄ budget-policy equality by test.

**Pricing class ⇄ credits:** the right variant is already laid out and should be confirmed — **PricingClass → a fixed credit price** for the customer, **estimate → a reservation ceiling and protected cost** internally. "Class → ceiling, actual → settlement" is convincingly rejected by the #6/#9 argument.

---

## 21. Margin architecture

`marginTarget: 0.75` exists as the **label of a simulation** (two call sites in the growth simulation producing acceptable / watch / unsustainable plus recommendation text); `MARGIN_TARGETS [0.7–0.85]` is a stress evaluation across five margin definitions, always on the pessimistic cost side; a failure-adjusted margin exists. There is **no** price floor, **no** minimum-margin gate, and nothing multiplies. That is right for today.

Where margin belongs in future: (1) target margin and price experiments → the spreadsheet and a business decision; (2) a *minimum-margin sanity check* as a CI **report, not a gate**, once an agent price is activated — "class X at price Y falls below the floor margin at P95 costs", with a human deciding; (3) protected cost as an internal reservation buffer, which already exists. Never: margin in the execution path.

---

## 22. Economic invariants

**Database-enforced:** `settled_credits <= reserved_credits`; settled implies `settled_at` and `settled_credits`; released or expired implies `released_at`; `posted − reserved >= 0`; `credit_delta ≠ 0`; sign matches kind (adjustment free, but a reason is mandatory); a refund references a charge; `(account, idempotency_key)` unique; one active hold per operation run; lot `allocated + expired <= initial`; purchased lots never expirable; one ledger entry yields at most one lot; Stripe event id unique; rated implies `rated_credits` and costed implies `raw_cost`, so unknown-≠-zero is unrepresentable.

**App-enforced only (needs hardening):** a ledger event per balance change (no trigger); `reserved_credits` equals the sum of active reservations; `grants.allocated` equals the sum of allocations (a reconciler exists and is uncalled); `|charge.delta|` equals `settled_credits`; the charge ⇄ allocations coupling (missing entirely — F4); at-most-once settlement across the F2 state; reservation expiry.

**Doctrine invariants (holding; some need a test):** unknown cost is never zero; only provider numbers are `measured`; credits ≠ nanodollars ≠ EUR (type-enforced); no automatic cost-to-price conversion; a correction scalar below the sample floor is exactly 1; historical charges and rates are immutable; reading is never charged; a failure means zero charge with an honest release reason; a ceiling is never silently exceeded.

---

## 23. Security, abuse, leakage

**Leakage and circularity.** The boundary is dense at its core: a run's own actuals are banned from the estimator by source scan; the reconciler has an import ban; the classifier has a shape test; and a validation result influences no original pricing class, since depth is only resolvable after the prepared change and is carried as `null` in production. Four holes: **H1** the guard is transitively bypassed (probe → snapshot → estimator plus safety margin, with `.probe.ts` exempted from the scan); **H2** `expectedValidationDepth` is type-level open (no nominal type); **H3/H4** drift measures the query rather than the repository, with provenance-free identical types for pre- and post-context; **H5** the ban list is narrow and single-file. All four are cheap to close.

**Abuse.** Run spam is bounded by the allowlist, the ceilings and the 100-credit hold. Deliberate failures cost the user nothing and Vibe real money — opening to customers needs per-account rate limits, and the pattern already exists elsewhere (five starts per hour with a cooldown). Credit races are covered by CAS plus CHECK once F1 is fixed. Cancellation abuse is handled correctly by keeping the hold on pause. Settlement replay is covered by the idempotency key plus status CAS once F2 is fixed. Provider-call amplification is bounded by the gateway ceilings, and the cardinality fix closed exactly that class.

**Refunds and support.** The model exists and is ledger-integral — a compensating entry, capped against earlier refunds, with a charge-reference CHECK — but **no path reaches it**. Adjustment with a mandatory reason is modelled with no writer, and there is no admin surface. Before the first paying customer, a minimal operator path is needed, or the first dispute is resolved in the SQL editor, which rule 29 forbids.

**Accounting boundaries.** Rounding is proved; a negative balance is structurally prevented (the only theoretical gap, a negative adjustment, is caught by the account CHECK); expiry as a posted event is exemplary; credit kinds exist as `source_kind` on **one** account with deadline ordering — so **do not build a multi-wallet architecture**, because the lot model already provides the differentiation.

---

## 24. Dead and transitional logic

| Category | Items |
|---|---|
| **KEEP** — deliberate structural absences and scaffolding | `CREDIT_RATE_CARDS = []` and its pins; the `billing_credit_quotes` schema; `projection.ts`; `billing_usage_events`; the bracket; the rate-card scenarios; the derivation-rather-than-table pattern |
| **CONSOLIDATE** | `median()` ×4, `ON_TARGET_BAND` ×3, the clamp ×2, retry constants ×2, Postgres error codes ×4; `reserveCredits` (superseded by operation-billing); an internal-ceiling ⇄ budget equality test |
| **DEPRECATE** — mark, do not delete | `quoteCredits` (zero callers until E5 wires it); `rateBillableUsage`; `estimateModelSpend`; `applyScenario`; reservation `expires_at` and `'expired'` until a sweeper exists; `completion_windows` (already deprecated in place) |
| **DELETE LATER** | `grantCredits` (a lot-less grant beside the correct function is a footgun — make it non-exported first); `agent_execution_runs.turns` (never written — write it or drop it); `recordAgentAiUsage` / `totalAgentUsage` (pre-gateway topology); `cancelAgentRun` (or wire it); `maxAiCalls` / `maxSandboxMs` (or enforce them) |
| **Documentation drift to fix** | Sprint 0037 "bounded at 3"; the `credits/schema.ts` cache-SKU comment; the `execution-contract/budget.ts` lifetime claim; `credit-rate-card.ts` "18 rows"; `CREDIT_PRICING_V1.md` "5 runs"; `credits/service.ts` "wired into nothing"; the `execution-contract/README.md` "FUTURE CODING AGENT" *(all addressed by [Sprint 0056](../../sprints/0056-documentation-currency.md))* |

**Zero formal TODO/FIXME/HACK markers exist in any economics module** — mechanically enforced by `paths.test.ts` and by the agent prompt. Deferred work is instead expressed as structural absence plus prose plus a pinning test. The load-bearing prose decisions include the four-concepts doctrine ("every expensive billing mistake comes from collapsing two of them"), the livelock post-mortem inline, the charge-before-close ordering — whose crash argument F2 refutes, making it the most important *wrong* comment in the system — "actual may never silently exceed the reserved maximum", `abandoned_with_usage` as an enum, the retail-≠-rate-card argument, "reading is never charged", "unknown is never zero", "confidence is the weakest axis", "repository size is a driver, never a cost line", "a prediction that can be edited after the fact is not a prediction", and "escalate on silence".

---

## 25. What we should not build yet

- **ML pricing, dynamic per-user prices, a real-time margin optimizer.** With n ≤ 9 non-production runs, any "intelligent" price adjustment would be noise with a sign. The prohibition architecture exists deliberately.
- **Predictive-LTV execution limits, CAC/LTV in code.** Company economics belong in the spreadsheet.
- **An accounting subledger or tax engine.** Credits are not a fiat currency; the ledger plus Stripe records suffice well past launch. Stripe Tax solves tax if needed.
- **Multiple wallets.** `source_kind` lots on one account with deadline ordering already differentiate promotional, subscription and purchase credits.
- **Per-request Vercel micro-allocation.** False precision; `PLAN_CREDITS_ARE_NOT_MODELLED` is the right posture, with an overhead allowance in the spreadsheet.
- **A Monte Carlo engine in the product.** Test-pinned deterministic scenarios suffice.
- **Automatic price changes of any kind**, including "only reservation levels": every activation is a versioned, human-decided policy bump.
- **A production credit rate card before measurement truth.** `CREDIT_PRICING_V1.md`'s own verdict — *not ready: statistical confidence, not mechanism* — holds unchanged. Calibration is the way there, not a decision.

---

## 26. Target economics architecture

A **completion** of the existing architecture, not a rebuild:

```
                    EXECUTION REQUEST
                           │
              Pre-execution features (spec, step, evidence, surfaces)
                           │
                 ┌─────────┴──────────┐
                 ▼                    ▼
        Pricing class  ────────  Cost estimate + protectedCost
   (execution-class; today        (economy/intelligence; today an island)
    analysis only → NEW:                 │
    resolved in the admission            │  NEW (E5): quote persisted
    path and persisted)                  ▼  (billing_credit_quotes — exists)
                 └─────────┬────────────┘
                           ▼
              Admission (allowlist / policy) → credit reservation
              (class ⇒ fixed price / ceiling; protectedCost ⇒ internal buffer)
                           │
                     Agent execution
              Provider ─ sandbox ─ (validation BEFORE settlement — §32-1)
                           │
                       Raw costs (nanodollars, unknown ≠ 0, bracket)
                           │
              Settlement (the class's fixed price; usage is never a price input)
                 ┌─────────┴──────────┐
                 ▼                    ▼
        Customer credits         Cost ledger (ai / sandbox / browser usage)
        (ledger + lots,               │
         F1–F4 hardened,              ▼
         real-DB-tested)        Unit economics (economy/, read-only)
                                      │
                                      ▼
                          Economy intelligence (the island stays an island;
                          guards transitively firm; actuals complete)
                                      │
                                      ▼
                     Versioned policy proposal → HUMAN → policy bump
```

The deliberate deviation: "actual usage calculation → settlement" stays **severed**. Settlement never reads usage, because class price stability depends on it; usage flows only into the cost ledger and into intelligence.

---

## 27. Gap matrix

| Current | Desired | Gap | Severity | Proposed solution |
|---|---|---|---|---|
| Two cache writers without CAS; `reconcileBalance` uncalled | Uniform CAS discipline plus running drift detection | F1 | **P0** | E1 |
| Settlement retry does not close the hold | The retry completes charge **and** close | F2 | **P0** | E1 |
| `alreadyHeld` without allocation; insert-before-admit window | The retry re-allocates; the state is repairable | F3 | **P0** | E1 |
| Charge ⇄ allocations unlinked; settle/release race | Coupling by constraint or by guard ordering | F4 | **P0/P1** | E1 |
| No real-database test; livelock without a regression guard | A real-Postgres suite for money constraints plus the 20-way race | — | **P0** | E2 |
| Validation CPU null; actuals incomparable | Complete actuals; calibration able to learn | — | **P1** | E3 |
| Cache tokens invisible to the projection; a stale comment | Cache SKUs and a complete `costForAiRow` | — | P1 | E3 |
| The billed unit is the prepared change | The validated improvement | §4 | P1 before customer pricing | §32-1, then E5 |
| No operator refund/adjustment path | A minimal audited operator path | — | P1 before the first customer | E4 |
| No reservation sweeper; `agent_reservation_invalid` does not release | A generic stale-hold backstop | F7 | P1 | E1/E4 |
| Stale live evidence causes paid no-op runs | A freshness check covering live evidence (a free re-scan is not a rule-60 violation) | calibration finding | P1 | **the intelligence-roadmap interface** (§31) |
| Guard bypass H1; drift H3; backtest H6; depth type H2 | Transitive guards; provenance types; an honest backtest | — | P1/P2 | E6 |
| Dead budgets, columns and functions; seven documentation drifts | The §24 list worked through | — | P2 | E6 *(the drift half is done)* |
| Gateway TOCTOU | Documented or an in-flight counter | — | P2 | E6 |
| Rate provenance `founder_attested` | A one-off invoice verification | — | P2 | E3 |

---

## 28. Migration roadmap

| Phase | Content | Exit criterion |
|---|---|---|
| 0 — Verification | Merge the branch **after** the CPU verification run; *prove* F1–F4 with targeted reproduction tests rather than asserting them | One complete actual; four red reproduction tests |
| 1 — Correctness | E1: CAS, settle-retry close, `alreadyHeld` allocation, settle/release ordering, sweeper | Reproduction tests green; the app-enforced invariant list shortened |
| 2 — Test truth | E2: a real-Postgres suite (constraints behaviourally, the 20-way race, crash injection) | A livelock regression guard exists |
| 3 — Measurement truth | E3: calibration 3–5 after the live-evidence fix; cache SKU and projection; the rate invoice check | ≥3 comparable runs; bracket width under 10% |
| 4 — Product unit and operator | E4: the settlement-position decision implemented; a refund/adjustment path | The declared unit is the billed unit; a dispute is resolvable without the SQL editor |
| 5 — Pricing and quote | E5: quote → reserve → settle for the agent; class price activation as a versioned decision | The first agent price with a measured cost basis (rule 78) |
| 6 — Feedback and business model | E6 consolidation; spreadsheet calibration; possibly the first cohort correction activation at n ≥ 20 | The policy-bump process has run once |

---

## 29. Sprint plan

**E1 — Ledger and hold correctness** · P0 · **Goal:** close F1–F4 plus the sweeper with no happy-path behaviour change. **Scope:** CAS in `applyPostedDelta` and `releaseHeldCredits` using the same constants pulled into a shared module; the `settleReservation` early return calls `closeReservation` (guarded, idempotent); the `alreadyHeld` path checks and completes allocations; release checks status before releasing allocations, restoring the truth of its own comment; a generic reservation sweeper; `agent_reservation_invalid` releases. **Non-scope:** no RPC, no transactions, no schema change beyond a possible charge ⇄ allocation consistency CHECK. **Tests:** four reproduction tests, red today. **Risks:** low — tighter guards, no loosening.

**E2 — Real-database financial test harness** · P0 · **Goal:** money constraints and concurrency against real Postgres. **Scope:** a local Supabase or testcontainer suite in its own vitest config and CI stage — `available_non_negative` behaviourally, `sign_matches_kind`, the refund CHECK, the partial uniques; the 20-vs-1000 race as a regression that pins the *effect* of the retry and jitter rather than the constants; crash injection between `postLedgerEntry` and `closeReservation`, and between insert and `admitHold`. **Why:** rule 69's SQL half is systematically unmet for billing, and the most important CHECK has no behavioural test. **Depends on:** E1, or it tests known bugs.

**E3 — Measurement truth** · P1 · **Goal:** complete, comparable actuals. **Scope:** (a) the CPU-fix verification run, which is the branch merge gate, and then calibration 3–5 — **precondition: the live-evidence freshness fix**, a free deterministic re-scan of the cited `live.*` evidence before a fixture run, shared with the intelligence roadmap; (b) cache SKUs in `credits/schema.ts`, cache in `costForAiRow`, and an `at` parameter for `recordAIUsage`; (c) a one-off Vercel invoice verification promoting `sourceKind` to `invoice_verified`. **Acceptance:** ≥3 comparable calibration records; `reconcileAiUsage` over agentic rows with no systematic cost mismatch.

**E4 — Product unit and operator path** · P1 · **Goal:** align the billed unit with the declared unit and make support able to act. **Scope:** implement the settlement-position decision (recommended: settle after validation passes, and release on validation failure under its own measured reason); a minimal operator path — `refundCharge` and adjustment behind a server action with an operator allowlist and an audit event. **Non-scope:** no admin dashboard.

**E5 — Agent quote path** · P1/P3 · **Goal:** `quote → reserve → run → settle` for agent runs on the existing quote schema; resolve the class in the admission path and persist it on the spec, with `agentic_pricing_not_configured` remaining the gate until price activation. **Why:** rule 78 requires measured cost before a customer price; E3 supplies it and E5 is the mechanism. **Depends on:** E3.

**E6 — Consolidation and guards** · P2 · **Goal:** the §24 list — consolidate the duplicated median, band, clamp and retry constants; H1 (a transitive import-graph guard including `.probe.ts`); H6 (the backtest marks incompleteness honestly); H2 (a nominal `ExpectedValidationDepth`); H3/H4 (a provenance field on `RepositoryContextSize`); enforce or delete the dead budgets; the equality test; document the TOCTOU.

---

## 30. Spreadsheet modelling blueprint

| Tab | Inputs | Outputs | Source |
|---|---|---|---|
| ASSUMPTIONS | target margin, $/credit assumption, failure rate, included credits, price experiments | named constants | **manual** (business decision) |
| RATE_CARDS | provider prices (from `ai/pricing.ts`), sandbox rates (from `infrastructure-rates.ts`, with a provenance column) | cost per resource unit | **export**, versioned |
| EXECUTION_CLASSES | class definitions, credits per class (scenarios A/B/C) | the price ladder | manual + simulation export |
| RUN_ECONOMICS | per run: execution id, pricing class, reserved/settled credits, provider cost including the cache split, sandbox wall/CPU, validation wall/CPU, duration, status, change kind, risk class, evidence count, files, bracket low/high, comparable | class cost basis | **export** — every field exists today and is joinable |
| PLAN_DESIGN | plan prices, included credits, pack prices (from `catalog.ts`) | ARPU building blocks | export + manual |
| USER_COHORTS | MAU, executions per user, class mix, unused-credit rate | demand profile | **manual** until analytics |
| MARGIN | all of the above | gross and contribution margin per class, plan and user | computed, failure-adjusted |
| SCENARIOS | conservative / base / high usage / provider cost spike / heavy-complex mix / high failure / high unused credits | margin bands | manual |
| SENSITIVITY | top variables ±X% | a ranking | computed |
| ACTUALS | monthly ledger sums | drift versus the model | **export** |
| ESTIMATE_VS_ACTUAL | prediction snapshots and comparisons | estimator quality | **export** — the calibration JSONs already exist as files |

**The five levers, prioritized:** (1) **provider cost per run including the cache share** (r = 0.96 with total cost; the 2026-09-01 price step is the first real spike); (2) **failure rate**, which multiplies cost per *delivered* improvement by roughly 1.7; (3) **class mix**, where the `complex` share rests on n=0 data today; (4) **included credits × credit price**; (5) **the validation and sandbox share**, unmeasured today with a bracket width up to 34%, which is exactly why E3 comes first. Turns and wall clock are secondary (r = 0.62), and changed files are practically uncorrelated (r ≈ −0.04, measured).

---

## 31. Integration points with product intelligence

| Interface | Direction | Verdict | Reasoning |
|---|---|---|---|
| Evidence ids + surfaces → pricing-class input | Intelligence → Economics | **ALLOW** (exists) | Already the four inputs; the fact-id unification stabilizes exactly this basis |
| **Live-evidence freshness before a fixture run** | Intelligence → Economics | **ALLOW — the most urgent shared sprint** | Stale `live.seo.*` produced paid no-op runs; a free deterministic re-scan is not a rule-60 violation |
| Repository complexity and context → estimator | Intelligence → Economics | **ALLOW** (exists) | Pre-execution by construction; needs the H3/H4 provenance fix |
| Test-infrastructure detector → validation cost estimator | Intelligence → Economics | **ALLOW** | A per-repository validation share instead of a global 0.15 |
| Product archetype → pricing input | Intelligence → Economics | **DO NOT COUPLE** today; later a cohort *dimension* of analysis | An archetype is an interpretation, and building prices on interpretations breaks the class doctrine |
| Historical execution results → estimate calibration | Economics-internal | **ALLOW** (exists, sample floor 20) | |
| Audit priority / materiality → customer price | Intelligence → Economics | **DO NOT COUPLE** | "Important to you" must never mean "more expensive for you" |
| Estimated class → planner display | Economics → Intelligence | **ALLOW WITH GUARD** | Displaying it is fine; **never skew planner prioritization by Vibe's costs** — business priority and feasibility stay the only planner criteria |
| Economics → execution | — | **ALLOW WITH GUARD** | Hard resource ceilings yes (they exist); margin signals never reach the agent, because "less thorough because margin is tight" is structurally impossible to hold |
| Economics → validation | — | **DO NOT COUPLE** for cost optimization | The depth resolver knows no costs, and `fast` is evidence-driven, never price-driven. Keep it that way |
| Outcome verification → cost-per-outcome metrics | Intelligence → Economics | **FUTURE** | Only once agentic outcomes exist; never causal, never a price |
| The economy-intelligence pattern → adaptive intelligence | Economics → Intelligence | **ALLOW** — confirmed | The intelligence review identified the pattern correctly as a template; fix H1 and H6 while copying it |

---

## 32. Open architecture decisions

1. **Settlement position:** before or after validation? Recommended: after validation passes, with a failure releasing under a new reason `validation_failed_after_change`, which makes the declared unit the billed unit. The alternative is to honestly rename the unit to "prepared change". → ADR.
2. **Charge ⇄ allocation coupling:** an app-ordering fix (E1) versus an additional database constraint. → decide with the E2 harness.
3. **The transaction question:** does "no RPC" stay viable after F1–F4, or does the settlement path justify a single Postgres function making charge and close atomic? Recommended: E1 and E2 first; an RPC only if crash-injection tests still show gaps.
4. **Operator correction governance:** who may issue adjustments and refunds, with what audit trail?
5. **Calibration precondition:** a live-evidence re-scan as part of the freshness checks — scope, failure semantics, reuse window — jointly with the intelligence roadmap.
6. **The price activation process:** define the "versioned human policy bump" — who, documented where, referenced how in code — *before* any rate-card entry exists.
7. **The 2026-09-01 Sonnet price change** (introductory → standard, +50%) is already scheduled in code: decide deliberately whether the dogfood budgets and class simulations are re-sized before it.
8. **`maxAiCalls` and `maxSandboxMs`:** enforce or delete.
9. **The gateway TOCTOU:** documented acceptance (the harness is serial) versus an in-flight reservation.
10. **Calibration record storage:** committed files, git-auditable today, versus a later predictions table — define the switching criterion. Recommended: files until price activation.

---

## 33. Recommended first sprint

**E1 — Ledger and hold correctness.** No other sprint may run first. Every measurement improvement and every pricing discussion stands on a ledger whose cache can drift under concurrency and whose settlement retry has a documented but non-existent recovery path. E1 is small — four tightly localized fixes plus a sweeper — schema-free, behaviour-neutral in the happy path, and its reproduction tests are simultaneously the foundation of E2. The **branch merge** is independent of this and hangs only on the CPU-fix verification.

---

## 34. Final recommendation

1. **Is the architecture fundamentally right?** Yes. The four-truths separation, fixed price per class, escalate-first, an append-only ledger plus lots, an isolation island with propose-discipline — this is an above-average economics architecture whose weaknesses are implementation defects, not design defects.
2. **What goes to main unchanged?** The entire branch content, after the one verification run. It contains no schema, no prices and no new product paths.
3. **Correct but incomplete:** the measurement layer (CPU, validation, cache projection), calibration (two of five runs, zero comparable), the quote layer (schema without a writer), refund and adjustment (logic without a path), the class dataset (`complex` n=0, `small` n=1), and real-database tests.
4. **Unnecessarily complex:** little. Candidates are the duplicates, `applyScenario` and `estimateModelSpend` as dead second paths, and `grantCredits` as a footgun. No structural over-engineering finding.
5. **P0 financial-integrity risks?** **Yes, four** — all on `main`, all locally fixable, all undetected today only because of low concurrency and forgiving workflows, plus the test gap that keeps them undetected.
6. **Is `validated_agent_improvement` right?** Yes as the target — but it is not the billed unit today.
7. **Are small/standard/complex sensible?** Yes. More classes at n = 0/1/6 would be overfitting, and continuous customer prices are rightly rejected.
8. **Are credits sensible?** Yes — as a product unit above fixed prices, with subscription and packs already built. No model change needed.
9. **Is raw → rated → credits → revenue clean?** Yes, structurally. One blemish: the rating layer exists completely and is unwired — documented as a deliberate absence and pinned. Leave it.
10. **Is hold → execution → settlement robust?** In design yes; in four seams no. After E1 and E2: yes.
11. **Are rate cards historically reproducible?** Yes. Caveats: `recordAIUsage` without `at`, and the cache gap in the projection.
12. **Is economy intelligence a template?** **Confirmed.** With three mistakes to avoid when copying it: textual rather than transitive guards, provenance-free measurement types, and synthetic completeness in the backtest.
13. **What does not belong in production code?** Code invariants: everything in §22. Code policy: retail prices, budgets, clamps, floors, versioned. Configuration: allowlists and feature gates. Economic model (spreadsheet): target margin, $/credit, failure/mix/usage assumptions, scenarios, CAC/LTV/retention. Business decision: plan prices, pack prices, rate-card activation, refund policy, unit definition.
14. **Spreadsheet quantities:** §30 in full; the core exports already exist as columns and files.
15. **The five strongest variables:** provider cost per run including the cache share (and the scheduled price step) · failure rate (41.7%) · class mix · included credits × credit price · the validation and sandbox share.
16. **Sensible intelligence interfaces:** the ALLOW rows of §31, above all live-evidence freshness as a shared sprint.
17. **Dangerous couplings:** audit priority → price; planner prioritization by Vibe's costs; margin signals → agent or validation; archetype → price. Forbid all four explicitly.
18. **Over-engineering would be:** everything in §25.
19. **What must be validated before the branch merge:** exactly one thing — a real run with a complete `active_cpu_ms` on the validation path. Everything else is main-side and does not block the merge.
20. **The smallest first economics sprint after that:** **E1**.

---

## Appendix A — Method and limits

**Method.** Read-only analysis: four independent code deep-reads plus direct verification of every load-bearing finding, against `main` at `bd7dc42` and branch `dc5943b` with the merge base measured directly. No implementation, no commits, no branches, no migrations were produced by the analysis.

**Limits.**

- **This is a record of two commits.** Every path, count and measurement decays from there.
- **Every cost figure is non-production.** All runs carry `non_production_economics = true`; n is small, `complex` is n=0 and `small` is n=1, and no statement here should be read as a customer-facing cost basis.
- **Two subagent analyses initially reported that `economy/` was branch-only.** Both had computed the merge base against a stale local `main`. The merge base was re-measured directly and the finding corrected; §2 is the corrected version.
- **F1, F3, F4 and F7 were read from the code, not reproduced.** F2 was checked line by line. The reproduction tests that would prove all four are proposed as E1's deliverable precisely because reading is not proving.
- **The 24.3% MAE is quoted from the repository's own backtest**, and §16 records why it stands on softer ground than it appears (H6).
- **The review proposes; it decides nothing.** §32 is a list of open questions.

---

*Read-only review · `main` @ `bd7dc42` versus branch `dc5943b` · 2026-08-21. A record of what was true on those commits; not edited to match the present — see [ADR 0039](../../decisions/0039-documentation-currency.md).*
