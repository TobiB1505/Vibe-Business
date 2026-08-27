# 0056 - Lifecycle, erasure and retention

Status: Accepted
Date: 2026-08-26

## Context

Vibe Business has one destructive control and no lifecycle model behind it. `disconnectProject` issues a single `DELETE FROM projects` and depends entirely on the cascade; the account has no erasure path at all. Three defects follow from that absence, and the 2026-08-26 launch readiness audit raised all three as launch blockers: deletion does not work (VB-001), nothing states what must survive a deletion and what must not (VB-002), and a failed deletion is reported to the user as a success (VB-003).

VB-003 has since been fixed on its own, because it is a reporting defect and needed no lifecycle model to repair. The remaining two cannot be built until this document exists, for a reason worth stating plainly: **deletion is the one operation whose bugs are unrecoverable.** A wrong retention rule discovered after the fact cannot be undone by a follow-up commit. So the model is decided first, in the open, and the code is written against it.

Two further constraints shape everything below.

The first is that **financial and audit evidence must outlive the person, and today it does not.** Twenty-six of the twenty-seven foreign keys into `auth.users` are `ON DELETE CASCADE`; only `audit_events.user_id` is `SET NULL`. Erasing an identity today would take the credit ledger, the subscription record and every metering row with it. That is not a retention policy — it is the absence of one, and the ratio is the evidence: every table added since has inherited `CASCADE` by default.

The second is that this decision had to be made against **measurements, not migration text**. The audit's own root-cause statement for VB-001 was reasoned from the migrations and was wrong. The Wave 0 architecture review (`docs/audits/2026-08-26-lifecycle-erasure-architecture-review/`) therefore applied all 63 migrations to a throwaway PostgreSQL cluster, built a full-depth project fixture, and executed every claim inside `BEGIN`/`ROLLBACK`. The findings below marked **[proven]** come from that run. Where they contradict the audit, they supersede it — and the audit itself is left standing unedited as the record of what was believed at the time.

This ADR is architecture and policy. It authorizes no migration and no application change; those are separate, separately reviewed work.

## Empirical findings

These five findings are load-bearing. Each one either removes work the audit asked for, or adds work it did not know about.

**F1 — Intra-project `RESTRICT` foreign keys do not block project deletion. [proven]**
The audit named `business_readiness_audits.*_snapshot_id`, `product_profiles.*_snapshot_id`, `execution_specs.*`, `opportunity_sets.business_audit_id`, `change_merges.change_approval_id` and their siblings as immediate-`RESTRICT` edges that abort the `projects` cascade. They do not. `DELETE FROM projects` against a fixture holding every one of those rows raised no `RESTRICT` violation at all. PostgreSQL's `RESTRICT` and `NO ACTION` differ *only* in deferrability; both ask whether referencing rows still exist **when the constraint is checked**, and a same-subtree sibling has already been removed by its own cascade by that point.
**Consequence: none of these foreign keys is converted.** Changing them would be churn against a non-cause and would weaken genuine out-of-band integrity guards in exchange for nothing.

**F2 — The `execution_specs` immutability trigger is the only thing blocking project deletion. [proven]**
`execution_specs_immutable` is a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger that raises unconditionally, and a `BEFORE DELETE` row trigger fires on **cascaded** deletes, not only direct ones. The single error the cascade produced names the cascade statement itself: `DELETE FROM ONLY "public"."execution_specs" WHERE $1 = "project_id"`. With that one trigger carved out, the entire chain — specs, audits, snapshots, plans, prepared changes, validations, reviews, approvals, merges — deleted in one statement.

**F3 — A depth-mismatched `RESTRICT` blocks account erasure, and the audit did not identify it. [proven]**
`repository_connections.github_installation_id → github_installations ON DELETE RESTRICT` sits one hop below `auth.users` on one side and two hops below it on the other. When `auth.users` is deleted, the installation is reached first and its constraint is checked while the connection — still two hops away — has not been processed. `DELETE FROM auth.users` fails for a user with **no execution specs, no audits and no snapshots**: an installation, a project and a connection are enough. Every user who has ever connected a repository is currently undeletable, independent of F2.
Converting that edge to plain `NO ACTION` **does not fix it [proven]** — plain `NO ACTION` is still checked at end of statement. `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED` **does** fix it, and an out-of-band `DELETE FROM github_installations` that would orphan a live connection is **still refused at `COMMIT` [proven]**. Only the check point moves; the integrity guarantee is unchanged.

> **[2026-08-27] Implemented as M2′ in `20260827050000_deferrable_installation_reference.sql`.** One constraint, and both halves of the claim above are now asserted rather than remembered: F3's minimum fixture — an identity, an installation, a project, a connection, and no execution spec at all — erases in a single statement, and an out-of-band `delete from github_installations` against a live connection is still refused, at `COMMIT` rather than at the statement. The relocation of the failure is the whole cost of M2′ and is stated in the test, so a passing `DELETE` is never mistaken for a weakened guard.
>
> **It also had to be removed from M1's RESTRICT-inventory guard, and that is not a loosening.** `lifecycle-authority.migration.ts` pins the exact set of `RESTRICT` edges so a later change cannot quietly convert one — F1's consequence. This edge leaves that list because it was never what F1 covers: F1 is about *intra-project* edges that the cascade clears on its own, and this one is the account-level depth mismatch F3 found precisely because it is not intra-project.

**F4 — A custom GUC is forgeable and must never be the authorization. [proven]**
The proposed carve-out mechanism was `SET LOCAL vibe.lifecycle_erasure = 'on'`. Any role can set a prefixed custom GUC: `set local role authenticated; set local vibe.lifecycle_erasure='on'` succeeds. A flag alone is not a permission.
The working split, proven end to end: **the `DELETE` privilege is the authority; the flag is only a lifecycle-context marker.** With `DELETE` revoked from `anon`, `authenticated` and `service_role`, a caller that forges the flag and issues a raw `DELETE` receives `permission denied for table execution_specs`, while the `SECURITY DEFINER` lifecycle function — which sets the flag itself — succeeds. `UPDATE` remains refused inside lifecycle context, cross-tenant invocation mutates nothing, the flag is unset after commit, and a second invocation returns deterministically rather than throwing.

**F5 — The billing graph cannot be partially deleted, and today it is entirely deleted. [proven]**
Erasing an identity today leaves `ledger_surviving = 0`: the credit account cascades from `auth.users`, and the ledger cascades from the account. With `billing_credit_accounts.user_id` made nullable and `ON DELETE SET NULL`, the same erasure yields `ledger_surviving = 1`, `accounts_surviving = 1`, `account_user_id_is_null = true`.
Partial deletion is worse than either. `repair_account_balance` and `repair_lot_allocation` re-materialize rows where `materialized_at is null`; a **deleted** row is not a null-marker row, it is invisible. Deleting ledger rows under a surviving account leaves `posted_credits` permanently overstated, `reconcileBalance` reporting non-zero drift on every `getBillingOverview` read, and **no repair path that can ever fix it**.

One further measurement is recorded because it changes what "anonymized" has to mean: `audit_events` already survives erasure with its owner columns nulled, **and its JSONB payload survives unscrubbed** — `audit_metadata_still_has_login = octo-founder` **[proven]**. Nulling a foreign key is not anonymization.

## Decision

### 1. Two operations, and each is named for what it does

The product ships **two** distinct controls. Today's single "Disconnect project" button means one thing in its copy and another in its behaviour, and that disagreement is itself the defect.

**Disconnect Repository** — non-destructive. It severs Vibe's link to the GitHub repository and stops all further reading and writing. The project, its derived intelligence, its audits, plans and execution history all remain. This is what today's copy already promises ("Vibe Business will stop tracking this repository", "does not uninstall the GitHub App and does not change your repository"), so the copy stays and the behaviour moves to match it.

**Delete Project** — destructive, and says so. It runs the lifecycle routine in §3 and destroys the project and everything derived from it. Its copy enumerates what is destroyed. It is never reachable by a user who believes they are merely detaching a repository.

Disconnect cannot be implemented as a plain row delete, and this is forced rather than chosen. Three tables reference `repository_connections` with `ON DELETE RESTRICT` — `repository_intelligence_snapshots`, `change_merges` and `execution_specs` — and unlike F1's intra-project edges these are **real** blockers here, because the parent is being deleted directly rather than swept up by a cascade that has already removed its children. Deleting the connection row would mean destroying the evidence that points at it, which is exactly what Disconnect promises not to do.

Therefore **Disconnect retains the connection row and marks it detached.** The row becomes the historical anchor for the evidence that references it; the GitHub authority it carried stops being usable. Two uniqueness constraints must narrow to match, because both are currently global and would otherwise make a detached repository permanently unreconnectable: `repository_connections_github_repository_id_key` and `repository_connections_project_id_key` become **partial** unique indexes over live connections only. Detached rows are then unconstrained history, and one live connection per project — and per repository — remains enforced.

### 2. Four verbs, and every table gets exactly one

Four lifecycle verbs, kept strictly apart. A table's verb is a property of the table and the lifecycle event, never a per-call decision.

| Verb | Meaning |
|---|---|
| **DELETE** | The row is physically removed. |
| **TOMBSTONE** | The row survives; its owner foreign key becomes `NULL`; its non-identifying content is untouched. |
| **ANONYMIZE** | The row survives; its owner foreign key becomes `NULL` **and** identifying fields inside its payload are scrubbed in place. |
| **RETAIN** | The row survives untouched. It holds no owner reference and no personal field. |

The canonical classification. "Delete Project" and "Erase Account" are the two lifecycle events; "Today" records the current behaviour so the gap each row represents is visible.

| # | Class / tables | Delete Project | Erase Account | Today | Gap |
|---|---|---|---|---|---|
| A | **Identity** — `auth.users`, `github_connections`, `github_installations` | — | **DELETE** | CASCADE, but **blocked by F3** | F3 |
| B | **Project-owned state** — `projects`, `repository_connections`, `project_founder_intent`, `project_onboarding`, `product_profile_corrections` | **DELETE** | DELETE (via project) | CASCADE, **blocked by F2** | F2 |
| C | **Derived intelligence** — `repository_intelligence_snapshots`, `live_product_intelligence_snapshots`, `authenticated_product_intelligence_snapshots`, `product_profiles`, `business_readiness_audits`, `opportunity_sets`, `business_opportunities`, `action_plans`, `action_plan_steps`, `product_scan_events` | **DELETE** | DELETE (via project) | CASCADE, blocked by F2 | F2 |
| D | **Execution evidence** — `execution_specs`, `operation_runs`, `prepared_changes`, `validation_runs`, `preview_sessions`, `review_artifacts`, `change_approvals`, `change_merges`, `change_outcome_verifications`, `measurement_plans`, `business_outcome_measurements`, `agent_execution_runs`, `agent_execution_events`, `agent_tool_events`, `agent_activity_events`, `execution_interrupts`, `project_founder_input_requests`, `project_founder_resolutions`, `action_plan_founder_attestations` | **DELETE** (under §5 authority) | DELETE (via project) | CASCADE except `execution_specs`, which **raises** | F2 |
| E | **Financial evidence** — `billing_credit_accounts`, `billing_credit_ledger`, `_reservations`, `_quotes`, `_grants`, `_allocations` | RETAIN (project link already `SET NULL`) | **TOMBSTONE** the account; everything below it RETAIN | **CASCADE-destroyed with the identity** | F5 |
| E′ | **Stripe mapping** — `billing_stripe_customers`, `billing_subscriptions` | RETAIN | **TOMBSTONE** | CASCADE-destroyed | §9, P-3 |
| E″ | **Stripe webhook log** — `billing_stripe_events` | RETAIN | RETAIN | already correct (no owner column) | none |
| F | **Metering** — `billing_usage_events`, `ai_usage_events`, `sandbox_usage_events`, `review_browser_usage`, `deep_scan_provider_usage` | **TOMBSTONE** (`project_id` → `NULL`) | **TOMBSTONE** (`user_id` → `NULL`) | CASCADE-destroyed by **both** events | §7 |
| G | **Audit trail** — `audit_events` | RETAIN (`project_id` already `SET NULL`) | **ANONYMIZE** | row survives, **payload does not get scrubbed** | §8 |
| H | **Entitlements** — `free_audit_grants` | — | **DELETE** | CASCADE — already correct | none |
| I | **Storage** — `review-screenshots/{projectId}/{artifactId}/{side}.png` | **DELETE** | DELETE (per project) | **never deleted; no foreign key reaches Storage** | §3 |

Two entries deserve their reasoning stated rather than assumed.

**Class D is deleted, not archived.** An `ExecutionSpec`'s entire meaning is "the instruction package for this step of this project's plan". With the project gone there is no reader. Archiving it would retain customer-derived content — repository full names, file paths, objective text — to serve nobody, which rule 26 exists to prevent.

**Class H is deleted (decision P-4).** `free_audit_grants` records that a free audit was consumed for a repository. That is an *entitlement* — its purpose is to stop a second free audit for the same repository — not accounting evidence. When the account is gone the entitlement has no subject. Today's `CASCADE` is therefore already the correct behaviour and needs no migration.

### 3. Project lifecycle semantics

Delete Project is a durable operation, not a request-scoped action. It runs in four ordered stages:

1. **Refuse if busy.** The safety gate in §10 is evaluated. Failing it is a typed refusal, never a wait and never a partial deletion.
2. **Sweep Storage.** Every object under the `{projectId}/` prefix in `review-screenshots` is removed.
3. **Erase the database subtree** in one transaction, through the §5 lifecycle function.
4. **Report the outcome** through a closed union of failure reasons.

The result type is a closed union — `project_not_found` (which is also the idempotent second call), `active_operation`, `agent_running`, `merge_in_progress`, `billing_not_finalized`, `storage_cleanup_failed`, `deletion_failed` — mapped to copy by an exhaustive `Record`. **No PostgreSQL message reaches the client**, which is the invariant VB-003 established and this design inherits.

**No `projects.status` column is introduced.** The prompt for this work asked whether a persisted lifecycle state is justified; on the evidence it is not, for single-project deletion. Refuse-if-busy needs only a pre-flight query, and the erase itself is one short transaction. A persisted `deleting` state earns its place only if the product later chooses to *wait* for running work rather than refuse it — at which point the drain must survive across requests. Adding it now would create a second source of truth about whether a project is alive.

**Ownership is re-established inside the SQL function**, not merely by the caller: `where id = p_project_id and user_id = p_user_id`, with `p_user_id` taken from the verified session and never from a client argument. A service-role bug therefore cannot cross tenants — **[proven]**, a cross-tenant invocation returns `false` and mutates nothing.

The routine lives in `src/modules/operations/`, and that placement is forced rather than preferred: it needs the service-role client for both the Storage sweep and the lifecycle RPC, and rule 53 confines `createServiceClient` to `src/modules/operations/` and `src/modules/billing/`. It cannot live beside `disconnect.ts` in `src/modules/projects/`.

### 4. Account erasure semantics

**Model R1 is adopted: the identity row is deleted, the financial graph is retained, and financial ownership is tombstoned.** `billing_credit_accounts.user_id` becomes nullable with `ON DELETE SET NULL`, and `auth.users` is deleted.

The Wave 0 review recommended R2 — pseudonymizing `auth.users` in place and never deleting the row — on the grounds that it requires no foreign-key migration at all. That recommendation is **not adopted**, and the reason is a product commitment rather than an engineering one: *the `auth.users` row must not be the long-term tombstone.* An erasure that leaves the identity row standing is pseudonymization, and Vibe is not going to describe pseudonymization as erasure. R1's extra migrations are the price of being able to say the identity is gone and mean it.

R1's cost is recorded honestly here rather than discovered later: because the identity row actually disappears, **every** `CASCADE` edge into `auth.users` fires, and each table that must survive needs its own nullable owner column. That is more migration surface than R2, and §11 accounts for all of it.

Erasure runs as one durable operation in eleven ordered steps. The order is not cosmetic; each step exists because the one before it made it possible or safe.

1. **Accept the request and refuse new work account-wide.** Every start path is closed for the duration.
2. **Cancel the Stripe subscription** — the external effect, first, for the reason in §9. Failure is typed and stops the erasure here.
3. **Verify billing is finalized.** No reservation may remain `active`; no `billing_stripe_events` claim may be outstanding. Erasure *waits for or refuses on* an unfinalized hold — it never settles or releases one itself (§10).
4. **Delete every project** through the §3 machine, one at a time. A project that cannot drain stops the whole erasure and names itself in the failure. This reuses one deletion mechanism rather than introducing a second.
5. **Delete `free_audit_grants`** (P-4). Already the current cascade behaviour.
6. **Delete the GitHub identity rows** — `github_connections`, then `github_installations`. Step 4 removed every `repository_connections` row, which is precisely what F3's `RESTRICT` was objecting to; by this point the installations are unreferenced.
7. **Tombstone the credit account** — `billing_credit_accounts.user_id → NULL`. Everything below it is untouched: the twenty-odd `NOT NULL` columns keyed on `credit_account_id` never need migrating, because the account row survives.
8. **Tombstone the Stripe mapping** — `billing_stripe_customers.user_id → NULL`, `billing_subscriptions.user_id → NULL` (P-3, §9).
9. **Tombstone metering** — `user_id → NULL` on the four usage tables that carry one (§7).
10. **Anonymize `audit_events`** — the owner columns are already `SET NULL` by foreign key; the JSONB payload is scrubbed in place (§8).
11. **Delete `auth.users`.** Nothing above still depends on it.

**The GitHub App installation is not uninstalled on GitHub's side.** Vibe has never had that behaviour, and adding an outbound mutation to an erasure path is exactly the kind of external effect that must not appear silently. The erasure copy states it; the code does not do it.

### 5. ExecutionSpec authority model

The `execution_specs` immutability trigger stays. It is the guarantee that an approved instruction package cannot be edited after the fact, and F2 is a reason to make one narrow hole in it — not a reason to remove it.

Three parts, and the split between them is the whole point:

1. **The trigger** refuses `UPDATE` unconditionally — flag or no flag, lifecycle context or not. It permits `DELETE` only when `TG_OP = 'DELETE'` **and** the lifecycle marker is set.
2. **`DELETE` is revoked** on `public.execution_specs` from `anon`, `authenticated` and `service_role`.
3. **A `SECURITY DEFINER` function**, owned by the table owner with `search_path = ''`, verifies ownership, sets the marker itself via `set_config(..., true)`, and performs the delete. `EXECUTE` is granted to `service_role` only, and revoked from `public`, `anon` and `authenticated`.

> **The `DELETE` privilege is the authority. The marker only distinguishes lifecycle context from an accidental delete inside that authority.**

This inversion is the correction F4 forced. The marker is forgeable and that is fine, because forging it buys nothing: a caller holding the flag and no privilege gets `permission denied`. Read the other way — and this is the failure mode §6 of *Security considerations* pins with a test — the design's safety rests **entirely** on that privilege staying revoked.

The carve-out deliberately does **not** re-open casual deletion. `DELETE FROM projects` remains blocked afterwards **[proven]**, which structurally prevents a second competing deletion mechanism from appearing next to this one.

**One ordering constraint inside the function, and it is the exception that proves F1.** `execution_interrupts.execution_spec_id` references `execution_specs` with `ON DELETE RESTRICT`. F1 says such an edge cannot block the `projects` cascade — and that remains true — but the lifecycle function deletes `execution_specs` **directly**, which is the other case entirely: a direct delete of a referenced parent while its children are still present *is* refused, exactly as §1 describes for Disconnect. The function must therefore delete `execution_interrupts` for the project before it deletes the specs, or defer the specs to the `projects` cascade it has just unlocked. This is asserted by a fixture carrying an interrupt row, not left to reading order — the Wave 0 fixture predates the interrupt table and did not cover it.

> **[2026-08-26] Implemented as M1 in `20260826213000_project_lifecycle_deletion_authority.sql`. Three sentences above were wrong when written, and building M1 measured them.**
>
> **1. The cascade never checks the caller's privilege on `execution_specs`, so revoking it is not the authority.** A referential-integrity action runs with the *referencing table's owner* authority: measured, `current_user` inside the cascaded trigger is `postgres` even when the caller is `service_role`. Part 2 above therefore protects **direct** deletion only. It is worth keeping for exactly that, and it is not what makes the cascade safe.
>
> **2. The actual entry authority is `DELETE` on `public.projects`.** That is the privilege a caller needs to start the cascade that reaches the specs, and it is the one that has to be closed. M1 withdrew it from `service_role` — the one role that bypasses RLS and could otherwise reach any tenant — and left it with `authenticated`, because `projects/connect.ts` and `projects/disconnect.ts` still depend on it. That leaves a real gap, stated plainly: an `authenticated` caller who forges the marker can delete **their own** project and cascade its specs. Measured end to end under RLS as the owning user: `DELETE 1`, `remaining specs=0`. **M1 must not be deployed until that privilege is closed.**
>
> **3. "`DELETE FROM projects` remains blocked afterwards [proven]" no longer holds, and the sentence that follows it is the one that mattered.** The Wave 0 proof was of the *direct-spec* design; under the root-delete design M1 actually ships, a marker-holding caller with `DELETE` on `projects` is not blocked. What replaced it is a second condition that no caller can supply: **a spec may be deleted only when its project row is already gone.** Inside the cascade it is (`parent_gone = t`); in a direct delete it is not (`f`). That binds `postgres` itself, which no privilege revoke can do, and it is why direct spec deletion is now unreachable for *every* role rather than merely ungranted.
>
> **The direct-delete ordering constraint in the paragraph above is therefore moot, and for a bigger reason than it gives.** M1 does not delete `execution_specs` directly at all — it deletes the root project row and lets the proven cascade do the rest. Direct deletion was measured and refused, and by the edge this ADR does *not* name: `agent_execution_runs.execution_spec_id` is a second `ON DELETE RESTRICT` reference to `execution_specs`, and it is the one that fires first.
>
> **[2026-08-26, later the same day] Closed by M1a.** `20260826220000` moved both callers onto narrow functions — connect became one transaction with no compensating delete, disconnect became `disconnect_project()` — and `20260826221000` revoked `DELETE ON public.projects` from `PUBLIC`, `anon`, `authenticated` and `service_role`. M1's file was renumbered to `20260826222000` so it sorts after that revoke and no single push can apply it first. The invariant is now what point 2 asked for: **no Data API role can start a project cascade**, so the forgeable marker carries no authority at all. Two things M1a measured on the way, both design errors of its own that the tests caught before deployment: a `SECURITY DEFINER` function taking a `p_user_id` is not performing an ownership check but accepting a claim, because it is reachable at `/rest/v1/rpc/` with arguments the caller chooses; and such a function must *clear* the lifecycle marker rather than merely not set one, because `set_config(…, true)` is transaction-local and the function runs inside the caller's transaction.
>
> **What stands unchanged:** the trigger is kept rather than removed; `UPDATE` is refused unconditionally in every role and context; the marker is a forgeable context marker and never a permission; the function verifies ownership internally; and no intra-project `RESTRICT` foreign key is converted. The correction is to *which* privilege carries the authority, not to the principle that a privilege — never the marker — must carry it.

### 6. The billing graph is retained whole or not at all

**`DELETE` is never a legal verb for class E.** The billing graph — account, ledger, reservations, quotes, grants, allocations — is retained in its entirety or it is not touched. There is no third option, and no future job may introduce one.

F5 is why. The repair functions re-materialize rows marked `materialized_at is null`; a deleted row is invisible to them, not pending for them. Deleting part of the graph under a surviving account leaves the materialized balances permanently wrong with **no repair path that can ever fix it**, and `billing_credit_accounts_available_non_negative` may abort the erasure mid-transaction on the way there.

This rule is written into the ADR rather than only into an implementation plan because the way it will be violated is not by the erasure code. It will be violated by a plausible future change — a "clean up old reservations" job, a ledger-pruning migration, a retention sweep that deletes rows under a live account. Any such change is a violation of this decision and requires a superseding ADR, not a judgement call.

### 7. Metering retention

The five metering tables — `billing_usage_events`, `ai_usage_events`, `sandbox_usage_events`, `review_browser_usage`, `deep_scan_provider_usage` — carry `project_id` as `NOT NULL … ON DELETE CASCADE`, and four of them additionally carry `user_id` the same way. **Both** lifecycle events therefore destroy them today.

That is a defect in its own right, and it is not primarily a privacy one. The credit *ledger* correctly nulls its project link; the *metering* that priced those charges cascades away. Deleting a project today already makes "why was this account charged N credits" permanently unanswerable, while the charge itself survives. That contradicts rule 7 (AI usage must be measurable) and rule 47.

**Target: `project_id` becomes nullable with `ON DELETE SET NULL` on all five, and `user_id` the same on the four that have one.** The rows then survive both events, detached, holding exactly what they should: tokens, milliseconds, bytes, provider, model version, cost. No personal field, so RETAIN needs no scrub.

This is tracked as launch backlog item VB-040 and is worth landing independently of erasure — it closes the rule-7 defect the moment a project is deletable at all.

> **[2026-08-27] Implemented as M2 in `20260827030000_metering_survives_lifecycle.sql`.** Nine columns, exactly as described. Three measurements taken on the way, none of which the paragraph above knew:
>
> **1. No hidden second cascade path.** `operation_run_id`, `validation_run_id`, `preview_session_id` and `review_artifact_id` are plain columns with no foreign key, so nulling the two owner columns genuinely detaches the row rather than leaving it reachable by another `CASCADE`. Had any of them been a foreign key to a project-scoped table, M2 as written would have been cosmetic.
>
> **2. Idempotent projection survives detachment.** `billing_usage_events_source_sku_idx` is `(source_kind, source_id, sku)` — no owner column — so a detached row's usage-event identity is unchanged and a repeat reconciliation still recognises it. No unique index on any of the five involves an owner column at all, which is what makes nulling one incapable of violating a uniqueness invariant.
>
> **3. One read had to change, and it is a read this ADR did not list.** `credits/reconciliation.ts` sweeps all four canonical ledgers and projects them into `billing_usage_events`. Left alone it would have projected detached rows into *new* financial records owned by a deleted project or an erased identity — minting exactly the unattributable rows §6 objects to. It now excludes them in SQL and reports `rowsSkippedDetached`, so the repair pass says what it did not touch. The M3′ read-audit requirement in §11 is stated for the billing columns; the metering columns needed one too.
>
> **And one ordering fact, measured rather than reasoned.** Deleting `auth.users` while the account still owns a project is refused — which is what makes §4's step 4 a physical prerequisite for step 11 rather than a tidy sequence. The blocker that actually fires is F3's `repository_connections.github_installation_id` RESTRICT, not the `execution_specs` immutability trigger the step order implies. Both stand in the way; M2′ removes the first and the second remains.

### 8. Audit anonymization

`audit_events` is the only table already architected to outlive its owner, and it is the one place where nulling a foreign key achieves the least. The row survives with `user_id` NULL and the payload keeps its contents **[proven]**.

Anonymization is an **update in place**, executed by a privileged routine. Not a second anonymized projection — that would be two homes for one truth. Not an application write — `audit_events` has no `UPDATE` policy and is append-only by omission, so this necessarily runs as service-role and, under rule 53, from `src/modules/operations/`.

What is scrubbed, in priority order: GitHub identity (`githubLogin`, `accountLogin`, `githubRepositoryId`) is **deleted**; changed-file paths (`changedPaths[].path`, `largestChanges[].path`, `violations[].path`) are **pseudonymized** to positional labels, keeping status, byte counts, artifact class and every count, so the withheld-path incident record still answers every question it was built to answer; origins (`sourceOrigin`, `newOrigin`, `previousOrigin`, `beforeOrigin`, `public_origin`) are **nulled**; the Stripe `externalReference` is **deleted** as an external join key; the free-text `message` on `credit_drift.repair_failed` is **deleted**, being the only unbounded field in the vocabulary and one a PostgreSQL error can embed row values into — its machine-readable `code` already carries the useful half; Storage paths (`beforeObjectPath`, `afterObjectPath`) are **nulled at the same moment the objects are deleted**, because a path pointing at deleted bytes is worse than no path; founder-intent fields (`stage`, `monetizationModel`, `primaryGoal`) are **deleted**, keeping the non-reversible `intentHash`; and `projectId` / `project_id` inside the payload are scrubbed **together with** the column, or the `SET NULL` is cosmetic.

Retained untouched: commit SHAs (content identifiers), credit amounts and ids, policy and model versions, closed-enum reasons and failure codes, counts and durations, correction *field names*, and the approval/merge/outcome family — which under rules 67–74 is the record of Vibe writing to a customer's default branch and is the strongest retention case in the schema.

Two constraints on the mechanism, both discovered rather than assumed:

- **A hard prerequisite.** `merge/store.ts` deduplicates `change_merge.not_eligible` by querying `metadata->>project_id` and `metadata->>prepared_change_id`. Stripping those keys would silently convert merge-ineligibility logging into per-page-view logging. That query moves onto the real columns **before** the scrub exists, or the event type is exempted.
- **It is irreversible.** It must therefore be tested against a fixture covering every event category in the vocabulary, not a sample.

One framing note that keeps this proportionate: the reader-side allowlist in `audit-log/view.ts` means none of these fields can reach a screen today. This is a **data-at-rest retention** problem, not a UI leak.

### 9. Stripe external-effect ordering

**The Stripe subscription is cancelled before any local state is touched, and a failure to cancel stops the erasure.**

Nothing in `src/modules/billing/` currently cancels a subscription when a user goes away. Deleting the Vibe identity does not stop the card being charged — it only removes Vibe's ability to see that it is happening. So the rule is stated as a prohibition, because that is how it will be checked:

> **Never delete the local identity while Stripe can continue charging it.**

Cancellation is an external, non-transactional effect. It gets its own typed outcome — `stripe_cancel_failed` — and the erasure **stops** on it rather than proceeding. An erasure that half-succeeded and left a live subscription no one can see is strictly worse than one that refused.

The Stripe mapping rows are **tombstoned, not deleted, and their Stripe identifiers are kept** (decision P-3). Retaining financial evidence that cannot be reconciled against the processor would be retention without value — the same defect §7 identifies on the metering side. `stripe_customer_id` is what makes a later dispute or refund for a past charge attributable. The tradeoff is real and is not hidden: a resolvable pointer into Stripe survives erasure, which is precisely why the retention *period* (§Deferred, P-2) governs how long it exists, and why deleting the customer record at Stripe is a separate act this ADR does not cover.

A related defect is fixed as part of this work rather than left: `credits/service.ts` writes `userId: (await accountOwner(...)) ?? ""` in three places. An empty string is not a UUID, so the insert fails, and `recordAuditEvent` only logs to the console. A settlement landing after the owner is gone silently loses its financial audit record. §10's finalize-before-erasure rule prevents the situation; the `?? ""` is fixed anyway.

> **[2026-08-27] Implemented as M3′ in `20260827040000_billing_owner_tombstone.sql`, with §6.** Three columns, and the `?? ""` removed as promised — `RecordAuditEventParams.userId` is now `string | null`, which is what `audit_events.user_id` (the schema's one `SET NULL` edge into `auth.users`) has always permitted.
>
> **The read audit §11 asks for was run by the compiler, not by grep, and it found one site.** Widening `CreditAccount.userId`, `StripeCustomerLink.userId` and `SubscriptionSnapshot.userId` to `string | null` produced exactly one type error across the repository: `resolveOwner` in `billing/webhook-service.ts`. That is a stronger audit than an enumeration of `.eq("user_id", …)` filters, which are all safe under a nullable column and are not where the risk was.
>
> **And the one site is worse than a type error.** `resolveOwner` returns `{ ok: true, userId }` from the mapping row. Against a tombstoned mapping it would have returned `ok: true` with a null owner, and `grantCreditLot(null)` would have opened a *second*, ownerless wallet and granted purchased Credits into it — money with no owner who could spend or dispute it, recorded as a normal successful grant. A tombstoned mapping now resolves to a typed `owner_erased` refusal, and specifically **not** to the `claimedUserId` fallback, which exists for the window before a mapping is written and would otherwise resurrect an erased identity out of Stripe's own copy of its id. §9's cancel-first rule makes this rare; webhooks are asynchronous, so it does not make it impossible.
>
> **What was confirmed rather than changed:** `billing_credit_accounts_user_idx` and `billing_stripe_customers_user_mode_idx` are plain `nulls distinct` btrees, so the second erasure in the product's life does not collide with the first — asserted, because a `nulls not distinct` index here is the kind of defect that would first appear in production. The `stripe_customer_id` and `stripe_subscription_id` unique indexes survive untouched, which is what keeps P-3's retention meaningful.

### 10. Active-work safety rules

**Deletion is refused while consequential work can still complete.** Never delete state that a workflow, a sandbox, a merge or a settlement may still write to.

Deletion is refused when any of these hold:

| Condition | Source of truth |
|---|---|
| An operation is `queued`, `running` **or `needs_user`** | `isActive()` in `operations/schema.ts` |
| An agent run is live | the agent run's own status |
| A merge is `preflight` or `merging` | `change_merges.status` |
| A credit reservation is `active` | reservations for the account, filtered to the project |
| A Stripe event claim is outstanding | `billing_stripe_events` (account erasure only) |

**The active set is `isActive()`'s three statuses, never the store's `ACTIVE_STATUSES`.** `operations/store.ts` defines `ACTIVE_STATUSES` as `queued` and `running` only — it omits `needs_user`, deliberately, because it answers a different question ("is something *working*", which `isWorking()` also expresses). A safety gate built on `findActiveOperation` would delete a project holding a paused audit that still owns a live credit reservation. This is the specific trap this rule exists to name.

No type-agnostic "is anything live for this project" query exists today; every lookup is per `operation_type`. One must be added, built on `isActive()`.

**Billing is finalized, never cancelled by deletion.** Deletion does not release or settle a hold. That authority belongs to the CAS-gated finalizers, and moving it would risk the `charge_without_hold` class that four sprints of billing work went into eliminating. Deletion waits for, or refuses on, an unfinalized hold.

### 11. Migration direction

Six migration families, described here and **implemented by no part of this decision**. Each is small, and each is deployable on its own.

| Family | What it changes | Why | Required by |
|---|---|---|---|
| **M1** | Replace `reject_execution_spec_mutation()` per §5; `REVOKE DELETE ON public.execution_specs` from `anon`, `authenticated`, `service_role`; add the `SECURITY DEFINER` lifecycle function with `EXECUTE` to `service_role` only | F2 | Delete Project |
| **M2** | Metering owner columns nullable with `ON DELETE SET NULL`: `project_id` on all five tables, `user_id` on the four that carry one | §7, rules 7/47 | Delete Project **and** Erase Account |
| **M2′** | `repository_connections.github_installation_id` → `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED` | F3 | Erase Account |
| **M3′** | Owner columns nullable with `ON DELETE SET NULL` on `billing_credit_accounts.user_id`, `billing_stripe_customers.user_id`, `billing_subscriptions.user_id` | F5, §6, §9 | Erase Account |
| **M3** | The `audit_events` metadata scrub function | §8 | Erase Account |
| **M5** | `repository_connections`: detachment marker; `repository_connections_github_repository_id_key` and `_project_id_key` become partial unique indexes over live connections | §1 | Disconnect Repository |

**Deploy order: M1 → (code) → M2 → (code) → M3′ → M2′ → M3.** M1 is inert until a caller exists, so it lands safely ahead of the application change. **M3′ must land before any erasure runs**, or the first erasure destroys a ledger. M5 is independent of the erasure chain and can land whenever Disconnect is built.

Two things are deliberately absent, and their absence is the decision:

- **No intra-project `RESTRICT` foreign key is converted.** F1 proved they are not the cause. Converting them is churn against a non-cause that weakens real out-of-band integrity guards. **Do not convert them to `NO ACTION`, and do not convert them to `CASCADE`.**
- **No `projects.status` column** (§3).

M3′ widens a `NOT NULL` invariant that TypeScript reads may assume. Every read of `billing_credit_accounts.user_id`, `billing_stripe_customers.user_id` and `billing_subscriptions.user_id` must be audited before it lands.

Per rules 29, 30 and 34, all of these go through the linked Supabase CLI workflow with `pnpm db:status` inspected first, never the SQL editor, and the migration files remain the source of truth.

## Security considerations

**The `SECURITY DEFINER` function is a standing privilege.** The repository has already removed one unnecessary `SECURITY DEFINER` after an advisor finding. This one is necessary, so it is narrow: a fixed signature, the ownership check inside the function body rather than at the caller, `search_path = ''`, and `EXECUTE` revoked from `public`, `anon` and `authenticated`. `get_advisors` is re-run after M1.

**The carve-out's entire safety rests on one revoked privilege.** F4 established that the lifecycle marker is forgeable by design and harmless only because `DELETE` is not granted. A future migration that re-grants it — most plausibly a blanket `GRANT ... ON ALL TABLES IN SCHEMA public` — silently converts the carve-out into an open door with no error and no test failure anywhere else. **A test asserting `DELETE` on `execution_specs` is not granted to `anon`, `authenticated` or `service_role` is part of M1, not optional hardening.** The pending grant-tightening work in VB-015 must not collide with it.

**A tenant boundary that a service-role bug cannot cross.** The lifecycle function re-establishes ownership internally; the caller's assertion is not trusted. `userId` originates from `requireSession()` and is never accepted as a client argument. Under rule 53 the service-role client is confined to `src/modules/operations/`, and every query it makes filters on ownership taken from the persisted operation row.

**No PostgreSQL message reaches a client.** Failure reasons are a closed union mapped by an exhaustive `Record`. This is the invariant VB-003 established when `disconnect.ts` stopped returning `error.message`, and every lifecycle path inherits it.

**Anonymization is irreversible and privileged.** It runs as a service-role routine against a fixture covering the whole event vocabulary, not a sample, because there is no second chance to notice it scrubbed the wrong field.

**A second, weaker deletion path already exists.** `connect.ts` deletes a project row with no `user_id` filter as a compensating rollback, relying on RLS alone. Not a live vulnerability, but it belongs under the same scrutiny as the lifecycle path.

## Failure and retry semantics

**Storage and the database cannot be deleted atomically, and this ADR does not pretend otherwise.** They are two systems with no shared transaction. Every design below assumes one of them will fail while the other has already succeeded.

Both directions are real:

- **Storage swept, database delete fails.** The bytes are gone; the project row, the review artifacts and their `beforeObjectPath` / `afterObjectPath` remain, now pointing at nothing. The user still sees the project. A review screen that tries to render a captured image finds it missing.
- **Database committed, storage sweep fails.** The rows are gone; the bytes remain under the `{projectId}/` prefix, unreferenced and unbilled to anyone's attention.

The chosen order is **Storage first, database second** — but *not* on the grounds that the database row is the only pointer to the objects. It is not: `reviewObjectPath` derives the path from `projectId`, `reviewArtifactId` and side, and the durable operation record retains the project id independently of the row. **An ordering justified only by "the pointer would disappear" would be a false justification**, and correctness must not rest on it.

The order is chosen because it produces the failure mode that is *visible and safely retryable*: the project still exists, the user is told the deletion failed, and re-running the operation re-sweeps a prefix that is already partly empty and then completes. The reverse order produces a failure that looks like success from the outside.

Three properties do the actual work, and the ordering is only a preference on top of them:

1. **Both stages are idempotent.** Removing an absent object is a success. Deleting an absent project subtree returns `project_not_found` deterministically, without throwing **[proven]**.
2. **Retry is safe at any point.** No stage's success depends on a previous stage having failed or succeeded, so the operation can be re-run from the top after any failure.
3. **Reconciliation is independent of the database.** Storage paths are project-prefixed, so orphaned bytes are discoverable by prefix listing with no surviving row required. This is what makes the "database committed, storage failed" direction recoverable rather than permanent — and it is the property that must be preserved if the ordering is ever revisited.

`storage_cleanup_failed` and `deletion_failed` are therefore **distinct** reasons. They describe different residues and imply different follow-up.

**Erasure stops; it does not partially proceed.** A project that cannot drain (§10), a Stripe cancellation that fails (§9), an unfinalized hold (§10) — each halts the erasure with a typed reason naming what blocked it. The account remains fully intact and the operation can be retried once the blocker clears. **A partially erased account is never an outcome**, which is the same principle §6 states for the billing graph, applied to the sequence rather than to one table.

## Verification requirements

This model is not considered implemented until each of these is green against real PostgreSQL. The harness pattern exists (`src/modules/credits/concurrency/`, `vitest.concurrency.config.mts`) and refuses non-loopback targets by construction. Items marked **[proven]** already hold at fixture level and become regression tests rather than new investigations.

1. A project with a connection, intelligence, a completed audit, opportunities, a plan and a founder resolution deletes; retention matches §2 exactly; **no other project is touched**.
2. A project with a spec, prepared change, validation, approval and merge deletes under lifecycle authority, while a plain `DELETE` is **still refused**. **[proven]**
3. An account with credits, a ledger, reservations and usage erases: the identity is gone, and the account, ledger and all five metering tables are retained. `reconcileBalance` and `reconcileLotAllocation` report **zero drift**, and no `CHECK` is violated. *A retained-but-drifting ledger is a worse outcome than a deleted one — the drift assertion is the point of this scenario.*
4. Two accounts erased: both credit accounts tombstoned with `user_id` NULL, and the unique index tolerates both. *PostgreSQL's default `NULLS DISTINCT` makes this work; it is asserted rather than assumed, because a single-row proof does not cover it.*
5. A project deleted, then usage history queried: metering rows still present with `project_id` NULL. Proves M2 closed the rule-7 defect.
6. Deletion refused while an operation is `running` **and** while one is `needs_user`, with no orphaned hold and no workflow resurrecting deleted state. *The `needs_user` half is the case §10's trap produces.*
7. A cross-tenant call mutates **nothing** and returns `project_not_found`. **[proven]** at SQL level; repeated through the domain API.
8. Deletion invoked twice: deterministic, second returns `project_not_found`, no throw. **[proven]**
9. A forced database failure mid-delete: the UI does not report success, a failure audit event is recorded, no partial state remains. *The VB-003 regression test.*
10. `execution_specs` `DELETE` and `UPDATE` outside the routine: both refused. **[proven]** — pinned as a permanent guard.
11. `DELETE` on `execution_specs` is **not granted** to `anon`, `authenticated` or `service_role`. *The single assertion the §5 carve-out's safety rests on.*
12. Storage sweep fails with the database intact, and the database commits with the sweep failed: both retryable, both reported, distinct reasons.
13. An out-of-band `DELETE FROM github_installations` with a live connection is still refused at `COMMIT` under the deferrable constraint. **[proven]** — proves M2′ moved the check point without weakening the guarantee.
14. Stripe cancellation failure stops erasure with `stripe_cancel_failed` and leaves the account fully intact.
15. The audit scrub runs against a fixture covering every event category and leaves the retained set of §8 byte-identical.
16. A project carrying an `execution_interrupts` row deletes. *Covers the §5 ordering constraint the Wave 0 fixture predates; a naive direct `DELETE FROM execution_specs` is refused here.*

Rule 69 applies in full: the domain state, the SQL and RLS contract, and the actual browser-visible state are each tested, and the destructive paths are dogfooded in a non-production environment before a user can reach them.

## Deferred decisions

Four questions are left open **on purpose**. Each is recorded here so that its absence is visible rather than silently resolved by whatever the first implementation happens to do.

**P-2 — Retention period. Unresolved, and not to be guessed in code.**
No product or legal document in this repository states a retention duration for anything. This ADR therefore makes retention *expressible* — a tombstoned account is queryable, a scrub is a discrete step, a detached metering row carries its own timestamps — without hard-coding any period. **No number of years, months or days is decided here, and none may be invented in an implementation.** What is still needed, before "Done" can be claimed for VB-002: how long tombstoned financial records are kept, under which jurisdiction, and where that period is configured.

**P-6 — No operator read path, and no admin surface this sprint.**
Once `user_id` is NULL the surviving audit rows match no RLS policy (`user_id = auth.uid()` never matches NULL) and are invisible to `listAuditEventsForProject`. Retained audit history is currently readable by **nobody**. That is accepted for now: retention for legal and forensic access, reachable only through direct database access. **No new admin surface is created by this decision**, and the launch backlog already tracks the general absence of one as VB-038.

**GitHub App uninstallation.** Erasure removes Vibe's local installation rows and does not uninstall the App on GitHub. Whether it should is a product question; the copy states the current behaviour either way.

**Deleting the Stripe customer at Stripe.** §9 retains the mapping so past charges stay reconcilable. Whether the customer object itself is deleted at Stripe, and when, is a finance decision outside this ADR.

## Consequences

### Positive

- Deletion becomes possible at all, which it is not today — for projects (M1) and for accounts (M1 + M2′ + M3′).
- Financial evidence survives the person, tombstoned rather than destroyed, and it survives **whole**, with reconciliation invariants asserted rather than hoped for.
- Metering survives both lifecycle events, so "why was this account charged" stays answerable — closing a rule-7 defect that already exists today, independently of erasure.
- The audit trail survives with its payload actually anonymized, not merely with its foreign key nulled.
- One deletion mechanism exists, and the carve-out structurally prevents a second from appearing beside it: plain `DELETE FROM projects` stays blocked.
- The user-facing controls stop lying. Disconnect detaches; Delete deletes; each says what it does.
- Erasure can no longer leave a live Stripe subscription charging a card nobody can see.
- Five of the audit's suggested foreign-key conversions are cancelled outright, and one blocker it never found is now named.

### Negative / Tradeoffs

- **R1 costs more migration surface than R2.** Deleting the identity row fires every `CASCADE` into `auth.users`, so each table that must survive needs its own nullable owner column. R2 needed none. This is accepted so that "erased" can mean the identity row is gone.
- **M3′ widens a `NOT NULL` invariant** on three billing tables. Every TypeScript read assuming non-null must be found before it lands.
- **A `SECURITY DEFINER` function is a standing privilege**, and the carve-out's safety rests on a single revoked `DELETE` grant that a future blanket `GRANT` could silently undo. One test stands between that and an open door.
- **Anonymization is irreversible**, and one existing query (`merge/store.ts`) depends on payload keys the scrub removes. That query must move first or the scrub breaks merge-ineligibility logging silently.
- **Storage and the database cannot be atomic.** Both partial-failure directions are possible and are handled by idempotent retry and prefix-based reconciliation, not by ordering alone.
- **Retention has no reader.** Anonymized audit rows are invisible to every application path, so they are retained for legal and forensic access only until P-6 is answered.
- **Retention has no period.** Nothing here says how long anything is kept; that is the largest single gap remaining in VB-002.
- **Disconnect keeps a row that Delete would remove.** Detached connections accumulate as history, and two uniqueness constraints must narrow to partial indexes to keep reconnection possible.

## Rejected alternatives

**R2 — pseudonymize `auth.users` in place and never delete the row.** The Wave 0 review recommended it, and it is technically cheaper: no foreign-key migration at all, every `NOT NULL` column preserved, F3 never encountered, Stripe attribution intact. Rejected because it leaves the identity row as the long-term tombstone, and that is pseudonymization described as erasure. **R2 is not the final model.**

**Dropping or weakening the `execution_specs` immutability trigger.** Narrowing it to allow all `DELETE` from any caller would make F2 disappear in one line and discard the guarantee the trigger exists to make — that an approved instruction package cannot be mutated after the fact. It would pass every test trivially and prove nothing.

**A GUC flag as the authorization.** `SET LOCAL vibe.lifecycle_erasure = 'on'` as the permission was the original sketch. **[proven] forgeable by any role.** The flag survives as a context marker; the `DELETE` privilege is the authority. *(Which `DELETE` privilege — see the [2026-08-26] correction in §5: it is `public.projects`, not `public.execution_specs`.)*

**Converting the intra-project `RESTRICT` foreign keys.** The audit's own recommendation, and **[proven]** wrong: F1 showed they never block the `projects` cascade. Converting them to `NO ACTION` or to `CASCADE` would be churn against a non-cause and would remove real out-of-band integrity guards in exchange for nothing.

**Archiving execution evidence instead of deleting it.** A detached archive table with a backfill and a dual read. Rejected: nothing reads a spec whose project is gone, so it would retain customer-derived content to serve no reader — pressure against rule 26 for no benefit.

**Cascade-deleting financial history.** The current behaviour. It destroys the ledger, the subscription record and every metering row along with the identity, leaving charges with no evidence of what produced them.

**Partial deletion of the billing graph.** Deleting ledger rows under a surviving account, or allocations under a surviving grant. **[proven]** unrepairable: the repair functions cannot see deleted rows, so the balances stay wrong forever. This is the one option that must never be chosen.

**Deleting or releasing active credit reservations to let a deletion proceed.** Deletion would be taking authority that belongs to the CAS-gated finalizers, risking the `charge_without_hold` class four sprints of billing work eliminated. Deletion waits or refuses.

**Ordered child deletion in application code, instead of the lifecycle function.** Relies on every caller remembering the order — which is what a trigger exists to replace — and is fragile against any new table.

**A separate account-erasure deletion path that does not reuse project deletion.** Two mechanisms that must stay in agreement about what a project consists of. Erasure calls the project machine per project instead.

**A `projects.status` lifecycle column.** A second source of truth about whether a project is alive, to support a drain that refuse-if-busy does not need. Reconsidered only if the product chooses to wait for running work rather than refuse it.

## Related

- [ADR 0006](0006-untrusted-repository-execution.md) — repository content is untrusted data; class C and D payloads are customer-derived and are deleted rather than archived.
- [ADR 0013](0013-durable-operation-execution.md) — both lifecycle operations run as durable operations, not inside a request.
- [ADR 0024](0024-vibe-credits-economic-layer.md) and [ADR 0025](0025-stripe-payment-rail-and-credit-grants.md) — the ledger and settlement invariants that §6's whole-or-nothing rule protects.
- [ADR 0019](0019-safe-approved-change-merge.md) — the merge record whose audit events §8 retains untouched.
- [ADR 0039](0039-documentation-currency.md) — why the Wave 0 review is a record left standing unedited, and this ADR is where the current decision lives.
- `docs/audits/2026-08-26-launch-readiness/` — VB-001, VB-002, VB-003, VB-004, VB-040.
- `docs/audits/2026-08-26-lifecycle-erasure-architecture-review/` — the empirical evidence behind F1–F5.
