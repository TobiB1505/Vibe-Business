# VB-001 / VB-002 / VB-003 — Lifecycle, Erasure and Retention

**Recorded 2026-08-27, after the work.** Landed as PRs #106, #107, #108, #109, #110 and #113; the browser suite the last of those merged red was greened by #114 the same day. Two ADRs — [0056](../decisions/0056-lifecycle-erasure-and-retention.md) and [0057](../decisions/0057-account-level-durable-operations.md) — eleven migrations, all deployed to production, and one dogfood against real identities.

## What was wrong

The [2026-08-26 launch readiness audit](../audits/2026-08-26-launch-readiness/README.md) raised three findings in one cluster, and public launch was gated on all three:

- **VB-001 (HIGH)** — "User/project deletion structurally impossible." The `execution_specs` immutability trigger raises on cascaded deletes as readily as on direct ones, and immediate-`RESTRICT` snapshot foreign keys abort the `projects` cascade. Any project owning an audit or a profile could not be deleted, and the specs rooted its user permanently.
- **VB-002 (HIGH)** — "Billing ledger/usage cascade-wiped with the auth user; no retention/erasure model; `audit_events.githubLogin` outlives users." Deleting an identity destroyed the accounting evidence for money that had already changed hands, while leaving the personal data in the payloads that survived.
- **VB-003 (MEDIUM)** — `disconnectProject`'s failure was discarded: `redirect("/app")` sat outside the `if (result.ok)` block, so a user whose data was still there was sent to a success destination.

The obvious reading of VB-001 — "make the cascade work" — is what the [Wave 0 architecture review](../audits/2026-08-26-lifecycle-erasure-architecture-review/README.md) was written to stop. Reasoning about PostgreSQL cascade ordering from migration text is exactly how the original finding had gone wrong, so all 63 migrations were replayed onto a throwaway PostgreSQL 16 cluster, producing **50 tables — matching the audit's inventory exactly** — and every claim was executed rather than inferred.

That method paid immediately. Five findings reached ADR 0056 as F1–F5, and two of them contradicted the audit:

- **F1** — intra-project `RESTRICT` edges do **not** block project deletion. The audit's premise for half the fix was wrong.
- **F3** — a *depth-mismatched* `RESTRICT` blocks account erasure, **and the audit did not identify it**. `repository_connections.github_installation_id` is reached one hop below `auth.users` while the connection two hops below it has not been processed yet. Every user who had ever connected a repository was undeletable for this reason alone.

## What changed, and why that shape

Eleven migrations, deploy-ordered, plus the application layer above them. What follows is the reasoning that is not visible in the migration text.

### Deletion is a root delete, not a spec delete

M1 (`20260826222000`) opens exactly one hole in the immutability trigger: `DELETE` is permitted only under a lifecycle marker, `UPDATE` never. Three sentences of the ADR were wrong when written and building it measured them.

The authority is not the `EXECUTE` grant and not the marker — the marker is forgeable, which is F4, and that is fine because forging it buys nothing. **The authority is `DELETE` on `public.projects`**, and Migration B (`20260826221000`) withdrew it from every Data API role. What replaced the direct-delete design is a condition no caller can supply: *a spec may be deleted only when its project row is already gone.* Inside the cascade it is; in a direct delete it is not. That binds `postgres` itself, which no privilege revoke can do.

Direct spec deletion was measured and refused — by an edge the ADR does not name. `agent_execution_runs.execution_spec_id` is a *second* `ON DELETE RESTRICT` reference to `execution_specs`, and it fires first.

### The installation reference defers rather than disappears

M2′ (`20260827050000`) converts F3's edge to `no action deferrable initially deferred`. `RESTRICT` cannot be deferred at all — that is the only behavioural difference between the two, and it is the whole point. Both halves of the claim are asserted rather than remembered: F3's minimum fixture now erases in a single statement, **and** an out-of-band delete against a live connection is still refused, at `COMMIT` rather than at the statement. The relocation of the failure is the entire cost, and it is stated in the test so a passing `DELETE` is never mistaken for a weakened guard.

### Metering and the billing graph are tombstoned, never cascaded

M2 (`20260827030000`) and M3′ (`20260827040000`) make nine metering owner columns and three billing owner columns nullable with `ON DELETE SET NULL`. The previous promise was `cascade`, and it was destroying the evidence for charges that outlived it.

The consequence was found by widening a type rather than by grepping. `RecordAuditEventParams.userId` became `string | null`, and letting `tsc` enumerate the consumers surfaced the real defect: the Stripe webhook's owner resolution would happily mint a wallet for a tombstoned account. It now returns `owner_erased`.

### The audit log is anonymized in place, by a transform that can be asserted

Nulling a foreign key is not anonymization: the Wave 0 run measured `audit_metadata_still_has_login = octo-founder` after a full erasure. M3 (`20260827060000`) is two functions, and the split is the point — a pure, immutable `scrub_audit_metadata(jsonb, int)` with no privileges and no table access, and a `security definer` driver granted to `service_role` alone. Splitting them is what lets the transform be asserted directly against a fixture of **every** event category, which §8 demands of an operation nobody can re-run.

It recurses because none of the three path fields §8 names is a top-level key; they sit inside evidence objects whose shapes differ per event and will change again. A walker over fixed top-level keys would have been correct the day it was written and quietly wrong afterwards.

### The durable-operation model gained an account level first

ADR 0057 was written before implementing, per rules 14 and 20, because ADR 0056 §4's operation could not be expressed. Five reasons, none visible in the migration text: `project_id` was `NOT NULL` and every RLS policy routed through it, so an account-level row was invisible to its own owner; `user_id` cascaded, so step 11 deleted the record of the operation performing it; the single-active index keyed on `project_id`, so under `NULLS DISTINCT` it admitted unlimited concurrent erasures of one account; `completed` demanded a `result_id` an erasure has no artifact to point at.

The RLS policies branch with a `case` rather than an `or`. A disjunction would also grant visibility of any *project-scoped* row whose `user_id` happens to match — a different rule for existing data. Under the branch, no existing row changes visibility and the new rule applies only where the old one had nothing to say.

Step 1's account-wide closure is a trigger rather than a check inside `createOperationRun`, per rule 76: an effect that must never happen is better as an absent capability than a denied one. There is one insertion funnel today, so a check would be true today; a trigger closes paths that do not exist yet, paths that bypass the store, and paths taken by the service-role client — which is exactly the client durable execution uses.

### The erasure, and why Stripe is second

Six workflow steps carry ADR 0056 §4's eleven, and the grouping is the retry boundary:

```
admit ─▶ cancel Stripe ─▶ delete projects ─▶ tombstone ─▶ scrub audit ─▶ delete identity
 gate       external         reuses §3        idempotent   irreversible     terminal
```

Deleting the local identity does not stop the card being charged; it only removes Vibe's ability to see that it is happening. So the external effect goes first, and a failure to cancel **stops** the erasure rather than proceeding — an erasure that half-succeeded and left a live subscription nobody can see is strictly worse than one that refused. `cancelSubscription` and `deleteIdentity` are `maxRetries = 0` per rule 73; everything between them converges to the same state however many times it runs.

### VB-003, and the control

The disconnect failure now reaches the screen, narrowed to closed reasons. `/app/settings` carries the erasure control, and the copy obligations are asserted in a real browser rather than only in the source: that the GitHub App is not uninstalled, that the remaining paid period is not refunded, that billing history is kept without the person's name, and that it cannot be undone — all above the confirm button, because a disclosure a person scrolls past after deciding is not a disclosure.

## What the build found that the design did not predict

- **`FakeDatabase` modelled `null === null` as an index collision**, so ADR 0057's double-submission guarantee would have passed by accident against a fake that was wrong in the product's favour. `checkConstraints` was made faithful to both `operation_runs` indexes.
- **The schema guard only parses `check (col in (…))`.** The `= any (array[…])` spelling parses fine as SQL and silently falls out of the assertion that `OPERATION_TYPES` and the database agree — worse than a build error. The migration is written in the `in` form with that reason stated in it.
- **F3's `RESTRICT`, not the `execution_specs` trigger, is what refuses a premature step 11.** Both stand in the way; which one PostgreSQL reaches first is an implementation detail, so the test asserts refusal rather than a message.
- **M1's `RESTRICT`-inventory guard failed** when M2′ removed the installation edge — correctly. It is recorded with an inline reason rather than silently narrowed: F1 covers *intra-project* edges, and this one is the account-level depth mismatch F3 found precisely because it is not.

## What was not done, and why

- **Half of erasure step 3.** `billing_stripe_events` carries no owner column at all, so a claim cannot be attributed to an account and the only expressible gate is "no Stripe event is being processed anywhere, for anybody" — which blocks one user's erasure on another user's payment and cannot pass under load. What it was protecting against is covered where it can be: step 2 stops new events being generated, and an event landing after step 8 refuses as `owner_erased` rather than minting an ownerless wallet. An event landing *before* step 8 grants to an account that is still live, which is correct.
- **VB-004 (screenshot retention).** A dependency in the Wave 0 review, not in this scope.
- **A deletion-ordering rewrite of `disconnectProject`.** F1 removed the premise for it.

## What has not been proved

- **Real Stripe cancellation semantics.** `cancelSubscriptionsForErasure()` cancels immediately, treats `resource_missing` as success and a read failure as failure. None of that has run against Stripe — there were no credentials in the dogfood environment.
- **The Vercel Workflows orchestration itself.** The step functions were dogfooded; the workflow that sequences them was not.
- **The dogfood is quoted, not re-run here.** PR #113's merge commit records it: *"Dogfooded end to end against the real database with two throwaway identities — one full eleven-step erasure with independent verification of every retention claim, one confirming a step-2 failure halts the sequence and leaves the account untouched."*
- **One deployment-order mistake, recorded rather than glossed.** Earlier in the stream, #109 was merged before its migrations were applied.
- **#113 was merged with the browser suite red** — six failures in `e2e/action-plan-ui.spec.ts`, all pre-existing on main from #112 and none introduced by this work. They were fixed by #114 the same day, which also found a real dead end behind one of them: the stale plan screen said the plan may be out of date and hid the only way to replan it.

## Validation

Measured on `c675ea8`:

| check | result |
| --- | --- |
| Migration tests (real PostgreSQL) | **115 passed**, 7 files |
| Unit tests | 6676 passed, 382 files |
| Browser suite | 359 passed |
| Typecheck | clean |
| Lint | 19 warnings, 0 errors |
| Build | clean |

All eleven migrations are applied to production and verified against the live catalog. Every guard added here was checked for teeth by deliberately breaking the thing it guards.
