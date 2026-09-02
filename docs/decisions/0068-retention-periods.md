# 0068 - Retention periods, by what the data is for

Status: Accepted
Date: 2026-09-02

## Context

[ADR 0056](0056-lifecycle-erasure-and-retention.md) decided *what* survives an erasure, and deliberately decided no duration. Its §Deferred P-2 states the gap precisely and forbids closing it by accident:

> No product or legal document in this repository states a retention duration for anything. This ADR therefore makes retention *expressible* — a tombstoned account is queryable, a scrub is a discrete step, a detached metering row carries its own timestamps — without hard-coding any period. **No number of years, months or days is decided here, and none may be invented in an implementation.**

This ADR answers it: the three things P-2 asks for are how long, under which jurisdiction, and where the period is configured.

It was also raised from the other end. The [2026-09-01 performance audit](../audits/2026-09-01-performance-code-health/README.md) named PERF-018 — no retention anywhere, and `max_rows = 1000` truncating unbounded reads into results that look correct and are not. That framing needs one correction before anything below makes sense, and it is the first decision here.

### Measured, 2026-09-02

Single-operator dogfood, no customer traffic. Rates are therefore **per active user**, which is what makes them worth writing down rather than the absolute numbers.

| Table | Rows | Per day | Oldest |
|---|---:|---:|---|
| `agent_execution_events` | **1,155** | 88.8 | 2026-08-19 |
| `billing_usage_events` | 950 | 105.6 | 2026-08-17 |
| `audit_events` | 921 | 40.0 | 2026-08-09 |
| `ai_usage_events` | 360 | 16.4 | 2026-08-10 |
| `operation_runs` | 166 | 8.3 | 2026-08-12 |
| `billing_credit_ledger` | 61 | 4.1 | 2026-08-17 |

The whole database is 23 MB. **Storage is not the argument and will not be for years.** `agent_execution_events` has already passed 1,000 rows, which matters for a reason §1 explains and retention does not fix.

## Decision

### 1. Retention is not the fix for `max_rows`, and must never be sold as one

PERF-018 puts two problems in one finding. They are unrelated and only one of them is a retention question.

**Truncation is a correctness defect.** PostgREST returns 1,000 rows and no error. A read that assumes completeness — a sum, an existence check over a whole history — gets a well-formed wrong answer. Deleting old rows does not make such a read correct; it moves the date on which it starts being wrong. **Every read that depends on completeness must aggregate in the database or paginate explicitly, whatever the retention period is.** That work is independent of this ADR and is not authorized by it.

**Unbounded growth is a cost and privacy question.** That is what this ADR decides.

Writing them down together is how a retention sweep gets shipped as a correctness fix, and then quietly relied on for a guarantee it never provided.

### 2. Four classes, because there are four different regulators

A single period across the schema would be wrong in both directions at once: illegal for the ledger, and indefensible for an event stream.

| Class | Period | What decides it |
|---|---|---|
| **Financial records** | **10 years** | Statutory minimum. Not a product choice. |
| **Audit trail** | **18 months** | Forensic usefulness. No statutory floor. |
| **Operational events** | **90 days** | Nothing. Purely operational value. |
| **Derived intelligence** | **latest 3 per project** | Not age at all — see §6. |

### 3. Financial records — 10 years, and this is a floor rather than a target

`billing_credit_ledger`, `billing_usage_events`, `billing_credit_reservations`, `billing_credit_grants`, `billing_credit_allocations`, `billing_stripe_customers`, `billing_subscriptions`.

German commercial and tax law sets the period: **HGB §257 and AO §147 require ten years for `Buchungsbelege`** and six for `Handelsbriefe`. GDPR does not shorten it — Art. 17(3)(b) exempts processing required to comply with a legal obligation, which is why an erasure request tombstones this graph rather than deleting it, exactly as ADR 0056 §6 already decided.

**Open, and deliberately not resolved here: whether a Credit ledger row is a `Buchungsbeleg`.** It records a movement in a prepaid balance that a Stripe charge funded, which is the shape of one, but that determination belongs to a tax advisor and not to this repository. The ten years is therefore adopted as the operating rule *because it is the longer of the two candidate periods*, which is the safe direction to be wrong in: keeping a commercial letter for ten years is lawful, destroying a booking voucher after six is not. **A shorter period may only be adopted on written advice, recorded here as an amendment.**

**A hard constraint that is easy to miss.** ADR 0056 F5 proved that partial deletion of the billing graph is worse than either keeping or deleting it: `repair_account_balance` re-materializes rows where `materialized_at is null`, and a *deleted* row is not a null-marker row — it is invisible. Deleting ledger rows under a live account leaves `posted_credits` permanently overstated with **no repair path that can ever fix it**.

So the sweep for this class is not a row-age sweep. **It may only act on an account that is already tombstoned (`user_id is null`), it acts on the whole graph for that account at once, and it never touches a live account.** ADR 0056 §6 already forbids the alternative and names this exact scenario — "a ledger-pruning migration, a retention sweep that deletes rows under a live account" — as a violation requiring a superseding ADR. This ADR does not supersede it; it agrees with it.

### 4. Audit trail — 18 months

`audit_events`.

No statute requires it and none forbids deleting it. Its purpose is forensic: answering *what did this system do, and when* after somebody asks. Eighteen months is chosen so that an incident noticed late still has a full year of prior activity behind it, which is the shape of the question actually asked — "has this been happening before?" — and beyond that the value falls away sharply while the row count does not.

After an erasure these rows are already anonymized in place (ADR 0056 §8), so the eighteen months applies to rows that no longer identify anybody.

### 5. Operational events — 90 days

`agent_execution_events`, `product_scan_events`, `sandbox_usage_events`, and the operational body of `operation_runs`.

These exist so a person can watch a run and read it back shortly afterwards. Nobody opens a ninety-day-old agent event feed. This is the class with the highest write rate and the lowest retained value, so it is where nearly all of the eventual saving is — and it carries no statutory obligation in either direction.

`ai_usage_events` is deliberately **not** in this class. It prices what the ledger charged, and ADR 0056 §7 already established that deleting metering while keeping the charge makes "why was this account charged N credits" permanently unanswerable — a rule 7 defect. It follows the financial class.

### 6. Derived intelligence — the latest three per project, not an age

`repository_intelligence_snapshots`, `live_product_intelligence_snapshots`, `authenticated_product_intelligence_snapshots`, `product_profiles`, `business_readiness_audits`, `opportunity_sets`, `action_plans`.

An age rule is the wrong instrument here, and the reason is a failure mode rather than a preference: **a quiet project would lose its only audit.** A project analysed once, eight months ago, is not a project whose analysis has stopped mattering — it is a project nobody has re-run. An age sweep would delete the single document the screen renders and leave the founder looking at "not analysed yet" for work they paid for.

Count answers what age cannot. The value of these documents is *the current understanding*, plus enough history to see that it changed; a two-year-old repository snapshot is not evidence of anything, because the repository it describes no longer exists. Three is the smallest number that shows a change and its predecessor.

Where a document is cited by something that must outlive it — an approval, a merge, an audit an Opportunity set was derived from — the citation wins and the row is kept. That is already how the RESTRICT edges in ADR 0056 F1 behave, and this ADR does not weaken them.

### 7. Where the period is configured: in code, and nowhere else

The periods are named constants with their reasoning beside them, in one module. **Not environment variables, not a dashboard setting, not a database table.**

A retention period that can be changed by a deploy-time variable is a period that can be changed without review, without a diff, and without anybody able to say afterwards what it was when a given row was deleted. ADR 0056 §6 calls a silent change to this policy a violation requiring a superseding ADR; a value that is editable outside the repository makes that rule unenforceable by construction.

The same argument decides the operator interface: **there is none.** No admin screen sets a retention period.

## Consequences

- **The largest class by volume has the shortest period**, so the saving arrives where the growth is without touching anything anybody is obliged to keep.
- **An erasure request is still answered by tombstoning**, not deletion, for the financial graph. That is unchanged; this ADR only says how long the tombstone lasts.
- **The privacy page becomes wrong by omission.** It currently states no duration at all — zero matches for days, months or years — while GDPR Art. 13(2)(a) requires the storage period or the criteria used to determine it. Publishing these periods is part of implementing this ADR, not a follow-up to it.
- **Nothing here authorizes a scheduler.** Rule 24 stands: how a sweep is *triggered* is a separate decision, and "it needs no new infrastructure" remains the argument to prefer. This ADR decides the periods, not the mechanism.
- **`agent_execution_events` is past 1,000 rows today.** Under §5 it would hold roughly 8,000 at the measured single-user rate. That is fine for storage and irrelevant to §1's correctness problem, which is why the two are decided separately.

## Deferred

**D-1 — Whether a Credit ledger row is a `Buchungsbeleg`.** §3 adopts ten years as the safe direction while this is open. Resolving it may shorten the period for part of the class; it cannot lengthen it.

**D-2 — The trigger mechanism.** Nothing in this repository runs on a schedule, and rule 24 requires an ADR before that changes. Read-triggered sweeping (the pattern ADR 0042 §P2 uses for staleness) is the option that needs no new technology and is the one to evaluate first.

**D-3 — Retention still has no reader.** ADR 0056 §Deferred P-6 stands: once `user_id` is NULL the surviving audit rows match no RLS policy and are invisible to every application path. Deciding how long to keep something nobody can read is worth doing, and it does not make the something readable.

## Related

- [ADR 0056](0056-lifecycle-erasure-and-retention.md) — what survives an erasure; this ADR closes its §Deferred P-2.
- [ADR 0042](0042-billing-reconciliation-authority.md) — why partial deletion of the billing graph has no repair path.
- [2026-09-01 performance audit](../audits/2026-09-01-performance-code-health/README.md) — PERF-018, and the truncation half §1 separates from it.
