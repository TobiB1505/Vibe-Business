# 0069 - What deletes the expired rows, and what it may not touch

Status: Accepted
Date: 2026-09-02

## Context

[ADR 0068](0068-retention-periods.md) decided four retention periods and closed [ADR 0056](0056-lifecycle-erasure-and-retention.md)'s §Deferred P-2. It deliberately decided no mechanism, and said so:

> **Nothing here authorizes a scheduler.** Rule 24 stands: how a sweep is *triggered* is a separate decision, and "it needs no new infrastructure" remains the argument to prefer. This ADR decides the periods, not the mechanism.

So the periods exist and nothing enforces them. There is no `vercel.json`, no `crons`, no `pg_cron`, no scheduled anything in this repository — **today nothing deletes a row on account of its age.** This ADR is that missing half.

### The reason to build it is not storage

ADR 0068 §Measured reports 23 MB for the whole database and concludes that storage is not the argument. Both halves hold, but the figure invites an arithmetic that does not: dividing the database total by its age counts the fixed floor — `auth`, `storage`, extensions, system catalogues, empty indexes — as if it were growth, and overstates the rate by roughly sevenfold. That projection was made once while this ADR was being argued, produced 380 MB per user-year, and is wrong. Re-measured 2026-09-02 with the floor separated out:

| | |
|---|---:|
| Database total | 24 MB |
| Schema `public` | 9.6 MB |
| The tables retention touches at all | **3.5 MB** |

Twenty-four days of single-operator use. Only the third line grows with a user, so the rate is roughly **50 MB per active user-year**, putting the 500 MB free tier around nine active user-years away. ADR 0068's conclusion stands, and is now measured rather than asserted.

Which means the argument for building this is entirely elsewhere:

1. **GDPR Art. 5(1)(e).** Keeping personal data no longer than necessary is an obligation, not an optimisation. It is not discharged by the data being small.
2. **Art. 13(2)(a) and the privacy page.** ADR 0068 §Consequences requires publishing the periods. A published period that nothing honours is not a gap — it is a false statement, and worse than the silence it replaces. **The mechanism has to exist before the disclosure, not after.**

## Decision

### 1. `pg_cron`, and the option ADR 0068 named first does not work

ADR 0068 §Deferred D-2 nominated read-triggered sweeping — ADR 0042 §P2's pattern, the one `expireStaleOperation` uses — as "the option that needs no new technology and is the one to evaluate first". It was evaluated. **It does not fit, and neither does any activity-driven variant.**

Staleness works read-triggered because somebody reads the row that is stale. Retention is the mirror image: **nobody reads a ninety-day-old event.** The rows that must go are exactly the rows no read reaches, so a read-triggered sweep would delete precisely the rows it did not need to.

Widening it to "amortise a delete budget over any activity" fails for a sharper reason, and this one is fatal rather than merely inefficient: **a sweep tied to activity never fires for an account that has stopped being active.** That is the case Art. 5(1)(e) is *about* — the user who left. A retention period that only elapses while somebody is using the product is not a retention period.

What is left is a clock. Two can provide one:

| | `pg_cron` | Vercel Cron → route |
|---|---|---|
| New hosted component | none — a Postgres extension already available on this project | yes |
| New credential / attack surface | none | an HTTP endpoint whose job is to delete, plus its shared secret |
| Runs while the app is paused, mid-deploy, or rolled back | yes | no |
| Where the schedule lives | `cron.job`, set from a migration | `vercel.json` |
| Language | SQL | TypeScript |

**`pg_cron` is chosen.** Deleting rows is a database operation; putting it in the database is the short path rather than an indirection, and the alternative's cost is concrete — an authenticated, internet-reachable endpoint that exists only to destroy data is a liability with no compensating benefit.

`pg_cron` 1.6.4 is available and not installed on this project. Enabling it is a migration.

**This is a new background technology and rule 24 requires exactly this ADR before it.** It sits beside Vercel Workflows rather than competing with it: Workflows runs one customer operation durably and is started by a request, and it has no periodic trigger. Nothing here may migrate to `pg_cron` on the strength of it existing — a durable customer operation stays a Workflow.

### 2. The schedule is set from a migration, and that is what makes it reviewable

`pg_cron`'s weakness is that its schedule lives in `cron.job`, a table anybody with SQL access can edit. A job silently unscheduled in the dashboard leaves the repository unchanged and every test green, which is the same class of hole ADR 0068 §7 refuses for the periods themselves.

So the job is scheduled by `cron.schedule` **inside a migration file**, under a stable job name. The repository states what the schedule is; the database is expected to converge to it (rule 34), not the other way around. An operator who unschedules it has diverged from the migrations, which is a condition that can be looked for rather than a change that leaves no trace.

Daily, `03:17` UTC. Off the hour deliberately: hourly boundaries are when every other scheduled thing in the world runs.

### 3. The periods stay in TypeScript; the SQL is a second copy a test pins

ADR 0068 §7 requires the periods to be named constants in one module, with their reasoning beside them. A SQL sweep function needs the same numbers, and the two cannot import each other.

This project already has that exact shape and already decided how to hold it: the agent poll interval and the Workflow event-count divisor are two constants in two files that must agree and may not be shared, and the agreement is asserted by **a test that reads both files as text** ([Sprint 0118](../sprints/0118-what-two-tools-can-hold.md)). The same instrument is used here. `src/modules/retention/periods.ts` is the statement of record; the migration is the second copy; the test fails if they diverge.

A shared module is not an option for the same reason it was not there: SQL cannot read it.

### 4. Least privilege: the sweep is callable by nobody

The function is `security invoker`, and `execute` is revoked from `public`, `anon`, `authenticated` and `service_role`. `pg_cron` runs it as the database owner, which is the only caller.

`security definer` was considered and rejected. It would add nothing — cron already runs privileged — while creating a function that deletes data and can be invoked by whoever can reach it. Rule 11.

### 5. What the first sweep covers, and the three things that shrank it

Writing the sweep against ADR 0068 §5 as literally worded would have destroyed data that must not be destroyed. Three findings, each verified against the live schema on 2026-09-02:

**F1 — `operation_runs` cannot be deleted by row age. Not at any period.** It is the parent of six `on delete cascade` edges and three `on delete set null` edges. Deleting one ninety-day-old run row takes with it `prepared_changes`, `review_artifacts`, `validation_runs`, `preview_sessions` and the whole `agent_execution_runs` subtree, and nulls the provenance of `change_merges`, `change_outcome_verifications` and `business_outcome_measurements`.

That is not a retention sweep, it is the deletion of the artifacts a human approval binds to. **Rule 67 requires an approval to bind to an immutable artifact identity — project, prepared change, commit, base, validation run, review artifact.** A sweep that deletes the prepared change and the review artifact of a merge that shipped four months ago makes the approval that authorised it unreconstructable, and leaves an eighteen-month audit trail pointing at rows that are gone.

ADR 0068 §5's wording — *"the operational body of `operation_runs`"* — is not the row. It is at most a payload column, which is a separate decision nobody has taken. **`operation_runs` is out of scope here and no age-based sweep of it is authorized by ADR 0068.**

**F2 — two tables ADR 0068 §5 classed as operational are billing sources.** `sandbox_usage_events` and `review_browser_usage` are both read by `reconcileUsage` in [`credits/reconciliation.ts`](../../src/modules/credits/reconciliation.ts) and projected into `billing_usage_events`. Deleting them at ninety days while keeping the charge is precisely the defect ADR 0056 §7 established and ADR 0068 §5 applied to `ai_usage_events` and then failed to apply to its two siblings: "why was this account charged N credits" becomes permanently unanswerable — a rule 7 defect. Both follow the financial class, exactly as `ai_usage_events` does. They are also already in `TOMBSTONED_TABLES`, which is the same judgement reached independently by the erasure path.

**F3 — `agent_execution_events` is the only record of what the agent did, and a price rests on it.** [`economy/harness-metrics.ts`](../../src/modules/economy/harness-metrics.ts) derives every harness metric from that stream, and rule 78 forbids activating a customer-facing Agent price without a measured cost behind it. No materialised per-run aggregate exists.

This does **not** remove it from the ninety-day class — it is the largest table, its purpose really is a feed somebody watches once, and ADR 0068 decided that on its merits. It creates an obligation instead, discharged in §6.

What remains, and what the migration implements:

| Table | Period | Why it is safe |
|---|---|---|
| `agent_execution_events` | 90 days | Nothing references it; §6 covers the measurement |
| `agent_activity_events` | 90 days | Nothing references it |
| `agent_tool_events` | 90 days | Nothing references it |
| `product_scan_events` | 90 days | Nothing references it; not a billing source |
| `audit_events` | 18 months | Nothing references it; already anonymised in place after erasure |

`agent_activity_events` and `agent_tool_events` are not named in ADR 0068 §5. They are siblings of `agent_execution_events` in every respect that matters — same parent, same cascade, same purpose, written by the same run — and their omission there reads as an oversight rather than a decision. Naming them is the smaller risk; a class defined by what the data is for cannot sensibly contain one of three identical tables.

**The sweep deletes only from tables it names.** No cascade is relied on, no `on delete` edge is followed, and a table not in the list above is not deleted from. This is what makes F1 an absence rather than a rule somebody has to remember.

### 6. An economy analysis must not be able to read a truncated window silently

`METRIC_AVAILABILITY` in [`economy/metric-availability.ts`](../../src/modules/economy/metric-availability.ts) exists because a `null` was once read as a zero: *"it means nobody was counting"*, and reading it otherwise "puts a fabricated data point into a correlation and moves the answer."

The sweep introduces the mirror failure, and it is worse because it is invisible: a run whose events were deleted is not a run with null metrics, it is a run that does not appear. An analysis six months from now would compute a perfectly well-formed cost-per-run over whatever survived — the same shape of well-formed wrong answer ADR 0068 §1 separates from retention and then, here, causes.

So the horizon is recorded beside the availability dates, as a rolling bound rather than a fixed one. Nothing enforces that a reader consults it, exactly as nothing enforces `METRIC_AVAILABILITY` — but the number is stated where the person asking the question is already looking.

### 7. What is deliberately not built

**The financial ten-year sweep.** It is decided (ADR 0068 §3) and it is not implemented. The oldest financial row in this database is dated 2026-08-17; the earliest date on which such a sweep could delete anything is 2036. Writing it now would be code that cannot run for ten years, cannot be tested against a real tombstoned account because none exists, and carries ADR 0056 F5's landmine — partial deletion of the billing graph has no repair path, and `posted_credits` is overstated permanently. Rule 15. It is written when there is something for it to act on and something to test it against.

**The derived-intelligence count rule** (ADR 0068 §6, latest three per project). Not an age sweep, so `pg_cron` is the wrong instrument and a different one has to be argued. It also interacts with the RESTRICT edges that keep a cited snapshot alive, which is a per-table analysis rather than one predicate.

**The privacy-page disclosure.** It becomes truthful for the operational and audit classes once this deploys, and stays untrue for the two classes above. Publishing a period per class as each becomes enforced is the honest sequence; publishing all four now would restate the problem this ADR exists to fix.

> **[2026-09-02, later the same day] Done for the two enforced classes, in exactly that sequence.** The migration was applied (recorded as `20260902103614`) and verified against the live database — extension installed, `SECURITY INVOKER`, job active, no Data API role able to execute it, no row deleted. `/privacy` now states ninety days and eighteen months as facts, and states the financial and derived classes as **what is kept** rather than as a promise to delete. `retention-disclosure.test.ts` fails if a published period stops matching `periods.ts`, if a period appears that no sweep implements, or if the financial class acquires the word "automatically". The unbuilt half stays on the page's own pending list.

## Consequences

- **Something finally deletes.** For the two classes covered, the period stated in code is the period the data has.
- **A daily job runs against the production database forever.** It is the first scheduled thing in this system. It is idempotent, it deletes by an indexed timestamp predicate, and on the current data volume it deletes nothing at all for another sixty-odd days.
- **A second copy of every period exists in SQL.** Guarded by a test rather than by discipline, which is the only reason it is acceptable.
- **`operation_runs` is now explicitly out of reach of retention**, and the reason is written down where the next person to read ADR 0068 §5 will find it.
- **The obligation is not discharged.** Two of four classes are enforced. Saying "Vibe honours its retention policy" remains false until the other two are, and the privacy page must not claim otherwise.
- **`pg_cron` is now available to anything that wants a schedule.** Rule 24 is not weakened by it existing: a second use is a second decision.

## Deferred

**D-1 — Detecting an unscheduled job.** §2 makes the repository the source of truth, which makes divergence *detectable* rather than detected. Nothing currently compares `cron.job` against the migrations. That check belongs with the migration-drift checking rule 30 already asks for by hand.

**D-2 — The financial sweep, and ADR 0068's D-1 underneath it.** Ten years is adopted as the safe direction while whether a Credit ledger row is a `Buchungsbeleg` is open. Neither question needs answering before 2036, and the second wants a tax advisor rather than a decision here.

**D-3 — Retention still has no reader.** ADR 0068 §D-3 and ADR 0056 §Deferred P-6 stand unchanged. Once `user_id` is null the surviving audit rows match no RLS policy and are invisible to every application path. This ADR deletes them on schedule without making the survivors readable, which is an improvement in one direction only.

## Related

- [ADR 0068](0068-retention-periods.md) — the periods this enforces, and the §5 class list §5 here corrects.
- [ADR 0056](0056-lifecycle-erasure-and-retention.md) — §6 "retained whole or not at all", §7 metering, F5 the billing graph's missing repair path.
- [ADR 0042](0042-billing-reconciliation-authority.md) — §P2's read-triggered pattern, evaluated and rejected in §1.
- [ADR 0013](0013-durable-operation-execution.md) — Vercel Workflows, which this sits beside rather than replaces.
