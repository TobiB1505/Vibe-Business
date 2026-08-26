# Wave 0 — Lifecycle / Erasure Architecture Review

**Scope:** VB-002 (erasure/retention architecture), VB-001 (make deletion technically possible), VB-003 (never report failed deletion as success). VB-004 (screenshot retention) appears only as a dependency.
**Status:** architecture + implementation plan. **Nothing was implemented.** No migration, trigger, FK, application file, Supabase project or Vercel setting was changed.
**Source audit:** `docs/audits/2026-08-26-launch-readiness/README.md` @ `39a2bbf` — read as immutable evidence, not edited.

> **Method note — this pass is empirically grounded, not inferred.** Reasoning about PostgreSQL cascade
> ordering from migration text is exactly how the original finding went wrong. So all 63 migrations were
> applied verbatim to a throwaway local PostgreSQL 16 cluster (Supabase-compatible `auth`/`storage` stubs),
> producing **50 tables — matching the audit's inventory exactly**. A realistic full-depth project fixture
> was built (user → installation → project → connection → 2 snapshots → profile → completed v4 audit →
> opportunity set → opportunity → action plan → execution spec → operation run → prepared change →
> validation run → review artifact → approval → merge, plus billing account, ledger entry and audit event).
> Every claim below marked **[proven]** was executed against that database inside `BEGIN/ROLLBACK`.
> The cluster was destroyed afterwards. Production was never touched.

---

## 1. Verified Current State

### 1.1 The deletion entry point

`src/modules/projects/disconnect.ts:20-37` — one statement, cascade-dependent:

```ts
const { data, error } = await supabase
  .from("projects").delete()
  .eq("id", params.projectId).eq("user_id", params.userId)
  .select("id");
```

It returns a three-arm union (`{ok:true}` / `{ok:false,error:"not_found"}` / `{ok:false,error:"unknown",message}`). Its docblock claims it removes "the Project (and, via cascade, its RepositoryConnection)" — naming 1 of the ~40 tables that actually cascade.

### 1.2 VB-003 confirmed verbatim

`src/app/app/projects/[projectId]/actions.ts:14-29` — returns `Promise<void>`; `redirect("/app")` is **outside** the `if (result.ok)` block, so both failure arms are discarded and the audit event is skipped while the user is still sent to a success destination.

### 1.3 The immutability guard

`supabase/migrations/20260818131106_execution_specs.sql:147-149`:

```sql
create trigger execution_specs_immutable
  before update or delete on public.execution_specs
  for each row execute function public.reject_execution_spec_mutation();
```

The function (as amended to `security invoker` by `20260818131334`) raises unconditionally with `errcode = 'restrict_violation'`. `before ... delete ... for each row` fires on **cascaded** deletes, not just direct ones.

### 1.4 What the user is told

`src/app/app/projects/[projectId]/settings/page.tsx:115-117` — "Disconnecting removes Vibe's access to this repository."
`disconnect-button.tsx:34-45` confirmation body — "Vibe Business will stop tracking this repository." / "This does not uninstall the GitHub App and does not change your repository."

Every user-visible sentence describes **detaching**. Nothing states that audits, profiles, opportunities, plans, prepared changes, validations, reviews, approvals, merge history and per-project usage rows are destroyed. The dialog enumerates the two things that do *not* happen and is silent on the ~40 tables that do.

### 1.5 Every destructive path that exists today

Only six in production code — there is no account deletion anywhere, no `auth.admin.deleteUser` outside the CI concurrency harness, no `DROP`/`TRUNCATE`, and no GitHub-side delete:

| # | Site | Target | Client |
|---|---|---|---|
| 1 | `projects/disconnect.ts:24` | `projects` row (+cascade) | cookie-scoped |
| 2 | `projects/connect.ts:58` | `projects` row — compensating rollback, **no `user_id` filter** (RLS is the only guard) | cookie-scoped |
| 3 | `billing/store.ts:331` | `billing_stripe_events` claim release | service-role |
| 4 | `review/storage.ts:86` `removeScreenshots` | storage objects | service-role |
| 5 | `validation/vercel/provider.ts:710` | Vercel sandbox snapshot (external) | Vercel SDK |
| 6 | `coding-agent/gateway.ts:664` | file inside the ephemeral VM | agent workspace port |

Sites 4–6 are not lifecycle paths. **Storage participates in no cascade at all.**

---

## 2. Actual Deletion Dependency Graph

### 2.1 Everything that references `auth.users` — read from the live catalog **[proven]**

26 FKs. **25 are `CASCADE`; exactly one is `SET NULL`:**

`CASCADE` → `projects`, `github_connections`, `github_installations`, `billing_credit_accounts`, `billing_stripe_customers`, `billing_subscriptions`, `billing_usage_events`, `ai_usage_events`, `sandbox_usage_events`, `review_browser_usage`, `operation_runs`, `prepared_changes`, `validation_runs`, `preview_sessions`, `review_artifacts`, `change_approvals`, `change_merges`, `change_outcome_verifications`, `measurement_plans`, `business_outcome_measurements`, `agent_execution_runs`, `agent_execution_events`, `execution_interrupts`, `free_audit_grants`, `product_scan_events`
`SET NULL` → `audit_events` only

That single asymmetry is the whole of the current retention policy: **audit history is designed to outlive the user; financial history is not.**

### 2.2 The `projects` subtree

~40 `on delete cascade` FKs to `projects(id)` spanning the full product surface. Three tables deliberately use `on delete set null` for `project_id` instead — `billing_credit_ledger` (`20260817180000:102`), `billing_credit_reservations` (`:184`), `billing_credit_quotes` (`:275`) — plus `audit_events.project_id` (`20260815180000:35`). Two usage tables do **not** follow that pattern and cascade instead: `billing_usage_events.project_id` (`20260817180000:339`) and `ai_usage_events.project_id` (`20260810013000:213`).

### 2.3 RESTRICT edges, and what they actually do **[proven]**

The intra-project `RESTRICT` edges — `execution_specs.business_audit_id`, `.repository_snapshot_id`, `.repository_connection_id`, `action_plans.{business_audit_id,opportunity_set_id,product_profile_id}`, `product_profiles.*_snapshot_id`, `business_readiness_audits.*_snapshot_id`, `change_approvals.review_artifact_id`, `change_merges.{change_approval_id,repository_connection_id}`, `change_outcome_verifications.*`, `measurement_plans.change_merge_id`, `repository_intelligence_snapshots.repository_connection_id` — **do not block project deletion.**

This was tested directly, with every one of those rows present. The only error raised by `DELETE FROM projects` was the execution-specs trigger. With the trigger carved out, the same delete removed the entire chain.

The reason is in the PostgreSQL documentation: `RESTRICT` and `NO ACTION` differ **only in deferrability**; both ask whether referencing rows *still exist when the constraint is checked*. For same-subtree siblings, their own cascade has already removed them by that point.

**One `RESTRICT` edge does block, and the audit did not identify it:**

`repository_connections.github_installation_id → github_installations ON DELETE RESTRICT` (`20260809210125:150`) blocks **account** erasure, because the two sides sit at different depths under `auth.users`:

```
auth.users ──CASCADE──▶ github_installations            (1 hop — RESTRICT checked here)
     └─────CASCADE──▶ projects ──CASCADE──▶ repository_connections   (2 hops — not yet processed)
```

**[proven]** `DELETE FROM auth.users` fails with `repository_connections_github_installation_id_fkey` for a user with **no execution specs, no audits, no snapshots** — merely an installation, a project and a connection. Deleting that same project alone succeeds. So *every user who has ever connected a repository is undeletable*, independent of VB-001's trigger.

---

## 3. Root Causes

Four distinct causes, only two of which the audit named correctly.

**RC-1 — `execution_specs` immutability fires on cascade. [confirmed]**
The sole blocker of project deletion. Error context names the cascade statement itself: `DELETE FROM ONLY "public"."execution_specs" WHERE $1 = "project_id"`.

**RC-2 — a depth-mismatched `RESTRICT` blocks account erasure. [new — not in the audit]**
`repository_connections.github_installation_id`. Independent of RC-1 and triggered by the ordinary act of connecting a repository.

**RC-3 — financial history is cascade-wired to the identity. [confirmed]**
`billing_credit_accounts.user_id` is `not null references auth.users on delete cascade`, and `billing_credit_ledger.credit_account_id` cascades from the account. **[proven]** erasing the user takes the ledger with it (`ledger_surviving=0`).

**RC-4 — the failure is swallowed. [confirmed]**
`actions.ts:28` redirects unconditionally. Because RC-1 makes the delete fail for any project that ever resolved an execution spec, today's realistic outcome is: nothing deleted, no audit event, user redirected to a list still containing the project.

**Corrected root cause the audit asserted and this pass refutes:** intra-project `RESTRICT` FKs were named as a blocker of project deletion (audit §6 C15-1). They are not. Converting them would be churn against a non-cause, and would remove genuine out-of-band integrity guards for nothing. **Recommendation: change none of them.**

**A fifth issue, not a deletion defect but a correctness one (RC-5):** the product calls this "disconnect" while performing destruction. Whatever else is decided, the naming and the copy must stop disagreeing with the behaviour.


---

## 4. Data Classification

Verbs per §5. "**Today**" = current behaviour; "**Target**" = recommended.

### A. User identity / personal account data
| Data | Today (user delete) | Target | Note |
|---|---|---|---|
| `auth.users` (email) | deleted | **scrub or delete — see §9 fork** | root of 25 CASCADE edges |
| `github_connections.github_login` | CASCADE deleted | delete | direct PII |
| `github_installations.github_account_login`, `github_account_id`, `installation_id` | CASCADE deleted | delete | direct PII; deletable once connections are gone |

### B. Project-owned mutable product data
| Data | Today (project delete) | Target |
|---|---|---|
| `projects` (incl. `name` = repo name, `production_url`) | CASCADE — **but blocked by RC-1** | **delete** |
| `repository_connections` (`owner`, `full_name`, `html_url`) | CASCADE | delete |
| `project_founder_intent`, `project_onboarding`, `product_profile_corrections` (founder free text, ≤8000 chars) | CASCADE | delete |

### C. Generated business intelligence
`repository_intelligence_snapshots`, `live_product_intelligence_snapshots`, `authenticated_product_intelligence_snapshots`, `product_profiles`, `business_readiness_audits`, `opportunity_sets`, `business_opportunities`, `action_plans`, `action_plan_steps`, `product_scan_events` — all CASCADE today, all **delete** as target.

These JSONB documents are the densest customer-derived payload in the schema: `.repository.fullName`, `.brand.siteName` (the product's own brand name), `.pages[].title`/`.ctas[]` (the customer's marketing copy), `.identity.*`, `.audience.*`, `.synthesis.*` (model prose naming the business), `.routes[].sourcePath` (repo file paths). **Deleting them is right, and rule 26 makes it doubly right** — none of this should outlive the project.

### D. Execution / correctness evidence
| Data | Today | Target |
|---|---|---|
| `execution_specs` (`.repository.fullName`, `.objective.goal`) | **DELETE RAISES — RC-1** | **delete under lifecycle authority** (§8) |
| `operation_runs`, `prepared_changes` (`files[].path`), `validation_runs`, `preview_sessions`, `review_artifacts`, `change_approvals`, `change_merges`, `change_outcome_verifications`, `measurement_plans`, `business_outcome_measurements` | CASCADE | delete |
| `agent_execution_runs`, `agent_execution_events`, `agent_tool_events` (`path`, `command`), `agent_activity_events`, `execution_interrupts` (founder answers) | CASCADE | delete |

**Decision recorded:** execution evidence is **deleted**, not archived. Its meaning is "the instruction package for this step of this project's plan"; with the project gone there is no reader, and archiving would retain customer-derived content (rule 26) to serve nobody. Option B in §8 is rejected on that basis.

### E. Financial / accounting evidence — **the class that must survive**
| Data | Today (user delete) | Today (project delete) | Target |
|---|---|---|---|
| `billing_credit_accounts` | **CASCADE deleted** | — | **retain, tombstone owner** |
| `billing_credit_ledger`, `_reservations`, `_quotes`, `_grants`, `_allocations` | **CASCADE via account** | `project_id` → SET NULL ✓ | **retain** (survive automatically once the account survives) |
| `billing_stripe_customers`, `billing_subscriptions` | **CASCADE deleted** | — | **retain, scrub external ids** (§9, decision P-3) |
| `billing_stripe_events` | untouched (no owner column) | untouched | retain unchanged |
| `free_audit_grants` (`github_repository_id`) | CASCADE deleted | — | retain tombstoned **or** delete — entitlement, not accounting (P-4) |

### F. Provider / internal economics
| Data | Today (project delete) | Target |
|---|---|---|
| `billing_usage_events`, `ai_usage_events`, `sandbox_usage_events`, `review_browser_usage`, `deep_scan_provider_usage` | **CASCADE deleted** — `project_id` is NOT NULL on all five | **retain, detached** |

**This is a defect the audit under-stated.** The Credit *ledger* correctly tombstones its project link (SET NULL), but all five *metering* tables cascade. So disconnecting a project today destroys the AI/sandbox/browser usage that priced the charges — while the charges survive. Reconstructing "why was this account charged N credits" is already impossible after a disconnect. That contradicts CLAUDE.md rule 7 (AI usage must be measurable) and rule 47.
**Target: `project_id` → nullable + SET NULL on these five, matching the ledger's existing pattern.** Tracked as audit item VB-040; this pass supplies the evidence for it.

### G. Audit / security evidence
| Data | Today | Target |
|---|---|---|
| `audit_events` row | **survives** (`user_id`/`project_id` SET NULL) ✓ | **retain, anonymized** |
| `audit_events.metadata` payload | **survives unscrubbed** ✗ **[proven]** | **scrub per §10** |

### H. External storage
| Data | Today | Target |
|---|---|---|
| `review-screenshots/{projectId}/{artifactId}/{side}.png` | **survives every deletion** — no FK reaches Storage | **delete on project deletion** (§6), sweep expired separately (VB-004) |

---

### Answering the Phase-2 questions per class

| Class | Physical delete required? | Should survive? | Owner fields to null | Retains value without PII? | Blocked today? | Wrongly deleted today? |
|---|---|---|---|---|---|---|
| A identity | yes | no | — | — | **yes (RC-2)** | no |
| B project data | yes | no | — | — | **yes (RC-1)** | no |
| C intelligence | yes | no | — | — | **yes (RC-1)** | no |
| D execution evidence | yes | no | — | — | **yes (RC-1)** | no |
| E financial | **no** | **yes** | `billing_credit_accounts.user_id` | yes — ids, amounts, policy versions | no | **yes (RC-3)** |
| F economics | **no** | **yes** | `project_id` ×5 | yes — tokens, ms, bytes, costs | no | **yes (VB-040)** |
| G audit | **no** | **yes** | already SET NULL | **only after metadata scrub** | no | no |
| H storage | yes | no | — | — | n/a (no mechanism) | **no — never deleted at all** |

---

## 5. Recommended Erasure & Retention Model

Four verbs, kept strictly apart. Every table lands in exactly one column per lifecycle event (§4 matrix).

| Verb | Meaning | Applies to |
|---|---|---|
| **Delete** | row physically removed | project-owned live state and derived intelligence, execution evidence, storage objects |
| **Tombstone** | row survives; owner FK set null; a stable non-identifying key retained | billing account + everything hanging off it |
| **Anonymize** | row survives; owner FK nulled **and** personal payload fields scrubbed in place | `audit_events` |
| **Retain unchanged** | row survives untouched | provider/internal economics rows with no personal field, once detached |

**The naming decision (RC-5) comes first, because it changes what the other verbs apply to.** Repository evidence shows the product currently uses one control to mean two things. The model below splits them, which is also the smallest honest fix:

- **Disconnect repository** — detach GitHub, keep the project and its history. Matches the existing copy.
- **Delete project** — destroy the project and its derived data, under the lifecycle routine, with copy that says so.
- **Erase account** — delete every project, then tombstone/anonymize what must outlive the person, then remove the identity.

> **Founder/product decision required (P-1).** Whether today's "Disconnect project" button becomes *Disconnect repository* (non-destructive) or *Delete project* (destructive, with corrected copy) is a product decision, not an architectural one. The architecture supports both and the migration plan does not depend on the answer. **What is not optional is that the button's copy and its behaviour agree.**

**Retention periods are out of scope by instruction and by evidence.** No product or legal document in the repository states a retention duration. The design therefore makes retention *configurable and expressible* (a tombstoned account is queryable, a scrub is a discrete step) without hard-coding any period. **Legal/product dependency (P-2): how long tombstoned financial records are kept, and under what jurisdiction, is undecided and must not be guessed in code.**

**One rule constrains every verb above, and it is the strongest finding in §9:** the billing graph is **retained whole or not at all**. Deleting part of it (ledger rows while keeping the account, allocations while keeping the grant) leaves the materialized balances permanently wrong with **no repair path**, because the repair functions only re-materialize rows marked `materialized_at is null` and a deleted row is invisible to them. "Delete" is therefore never a legal verb for class E.

---

## 6. Project Deletion State Machine

```
                    ┌──────────────────────────────────────────────┐
   active ──────────▶ deletion_requested                            │
                    │  • new work refused at every start path       │
                    │  • active work drained (§11)                  │
                    └───────────────┬──────────────────────────────┘
                                    │ all operations terminal
                                    │ all reservations settled/released
                                    ▼
                          ┌───────────────────┐
                          │ erasing           │  durable operation
                          └─────────┬─────────┘
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
       (1) storage sweep first          (2) DB transaction second
           delete review-screenshots/       erase_project_lifecycle()
           <projectId>/**                   one atomic commit
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                                 deleted
```

**Storage before database, deliberately.** The two cannot share a transaction, so one of them must be able to fail without corrupting the other. Deleting storage first means the failure mode is *orphaned bytes with the project row still present* — visible, retryable, and safe. The reverse order loses the only pointer to the objects the moment the DB commits.

**Do not introduce a `projects.status` lifecycle column yet.** The prompt asks whether it is justified; on current evidence it is not, for single-project deletion: the drain can be enforced by the existing single-active indexes plus a pre-flight check, and the erase itself is one short transaction. A persisted `deleting` state earns its place only if the drain must survive across requests (i.e. if we choose to *wait* for a running agent rather than refuse). **Recommendation: start with refuse-if-busy (no new column); add the state column only if product wants "delete when it finishes".** That keeps VB-001 small and avoids a second source of truth about whether a project is alive.

---

## 7. Account Erasure State Machine

```
erasure_requested
   │  refuse new work account-wide
   ▼
cancel the Stripe subscription            ← EXTERNAL EFFECT, FIRST
   │  nothing local stops Stripe charging the card (§9 defect 1)
   ▼
per project: run the §6 project-deletion machine   ← reuses one mechanism, not a second one
   │  (any project failing to drain stops the whole erasure, reporting which)
   ▼
finalize billing authority
   │  every reservation settled or released; nothing 'active'
   │  (never released BY erasure — §11)
   ▼
delete GitHub identity rows
   │  github_connections + github_installations  (now unreferenced: RC-2's
   │  repository_connections went with the projects)
   ▼
tombstone + anonymize
   │  audit_events: user_id already NULL by FK; metadata scrubbed in place (§10)
   │  billing: retained WHOLE — never partially deleted (§9)
   ▼
   ├── R2 (recommended): scrub auth.users to a non-identifying shell → erased
   └── R1 (fallback):    billing_credit_accounts.user_id → NULL, then
                         delete auth.users  ← needs M2 deferrable FK + M3
```

**Note what the ordering buys.** Deleting the projects first removes every `repository_connections` row, which is exactly what RC-2's RESTRICT was complaining about — so under **R2 the account erasure never hits RC-2 at all**, and M2 becomes unnecessary. RC-2 only has to be solved if legal requires R1.

**GitHub:** local `github_installations` / `github_connections` rows cascade away. The GitHub-side App installation is **not** uninstalled — Vibe has never had that behaviour (`disconnect.ts:12-14`) and adding an outbound mutation to an erasure path is exactly the kind of external effect that should not be introduced silently. **Document it in the erasure copy; do not implement an uninstall in this slice.**

> **Decision required (P-3):** `billing_stripe_customers` and `billing_subscriptions` map a Vibe user to an external Stripe identity. Deleting them severs Vibe's ability to reconcile a future Stripe dispute or refund for a past charge; keeping them retains an external personal identifier. This is a finance/legal call, not an engineering one. The architecture supports either (both are `CASCADE` today, so *keeping* them requires the same nullable-owner treatment as the credit account).

---

## 8. ExecutionSpec Immutability Solution

### The options, compared

| | **A — flag + trigger carve-out** | **B — archive/detach specs** | **C — narrow trigger semantics (allow all DELETE)** | **D — pre-delete specs in an ordered routine** |
|---|---|---|---|---|
| Correctness | Deletes only in lifecycle context | Evidence survives but is decoupled from a deleted project | Any code can delete a spec | Same as A but ordering-dependent |
| Immutability preserved | **UPDATE still always refused** | Yes | **No — the guarantee is gone** | UPDATE preserved, DELETE open |
| Blast radius | One function + one privilege | New table + backfill + dual-read | Whole table, every future caller | Every caller must remember the order |
| Auditability | Single choke point, easy to log | Two homes for one truth | None | Diffuse |
| Testability | Directly assertable both ways | Complex | Trivially passes, proves nothing | Order-fragile |
| Migration cost | Small | Large | Trivial | Small |
| Accidental-DELETE risk | **Low (privilege-gated)** | Low | **High** | Medium |

**B** is the only serious rival: it treats specs as evidence that should outlive the project. But nothing in the product reads a spec whose project is gone — a spec's entire meaning is "the instruction package for *this* step of *this* project's plan" — so archiving would retain customer-derived data (rule 26 pressure) to serve no reader. **C** is disqualified outright: it discards the guarantee ADR/§10 exists to make. **D** relies on convention, which is what a trigger exists to replace.

### Recommended: **Option A, with one essential correction to the design as sketched in the brief.**

The brief proposes `SET LOCAL vibe.lifecycle_erasure = 'on'` as the authorization. **That flag alone is forgeable and must not be the authority. [proven]** — `set local role authenticated; set local vibe.lifecycle_erasure='on'` succeeds; PostgreSQL lets any role set a custom prefixed GUC.

The correct split is:

> **The `DELETE` privilege is the authority. The flag only distinguishes lifecycle context from an accidental delete inside that authority.**

Three parts, all **[proven]** together:

1. **Trigger** allows `DELETE` only when `TG_OP='DELETE'` **and** the flag is set; **`UPDATE` is refused unconditionally, flag or not.**
2. **`REVOKE DELETE ON public.execution_specs FROM anon, authenticated, service_role`** — so nobody holding the flag can use it.
3. **`SECURITY DEFINER` function** (owned by the table owner) that verifies ownership, sets the flag itself via `set_config(..., true)`, and performs the delete. `EXECUTE` granted to `service_role` only.

### Measured behaviour of that design **[all proven]**

| Probe | Result |
|---|---|
| `service_role` forges the flag, issues raw `DELETE` | **`permission denied for table execution_specs`** |
| `service_role` calls the lifecycle function | `t` — project and specs gone |
| `UPDATE` a spec *inside* lifecycle context | **still refused** — immutability of content intact |
| Cross-tenant: user B's id against user A's project | returns `f`, spec still present, **no mutation** |
| Flag value after commit | `<unset>` — transaction-local, no leak |
| Function invoked twice | `t` then `f` — deterministic, no throw |
| Plain `DELETE FROM projects` afterwards | **still blocked** — callers are forced through the one lifecycle API |

That last row matters: the carve-out does **not** re-open casual deletion, and it structurally prevents a second competing deletion mechanism from appearing.

---

## 9. Financial Retention Design

### The constraint that shapes everything

**Every owner column in billing is `NOT NULL … ON DELETE CASCADE`** — 21 of them. Only `audit_events` has nullable owner columns anywhere in the schema. So "just null the owner" is not available without migration.

And a second constraint makes partial deletion actively dangerous: **the repair functions cannot see deleted rows.** `repair_account_balance` / `repair_lot_allocation` scan for rows `where materialized_at is null` and re-materialize them. A *deleted* ledger row is not a null-marker row — it is invisible. So deleting ledger rows while keeping the account leaves `posted_credits` permanently overstated, `reconcileBalance` reporting non-zero drift on **every** `getBillingOverview` read, and **no repair path that can ever fix it**. `billing_credit_accounts_available_non_negative` may also abort the erasure mid-transaction.

> **Therefore: the billing graph is retained whole, or not at all. Partial deletion is the one option that must never be chosen.**

### Two viable designs

**R1 — Delete the identity, tombstone the wallet.** `billing_credit_accounts.user_id` → nullable + `ON DELETE SET NULL`; delete `auth.users`.
- **[proven]** — with this change, full account erasure succeeds and `ledger_surviving=1`, `accounts_surviving=1`, `account_user_id_is_null=true`.
- The unique index `billing_credit_accounts_user_idx` tolerates many tombstones, because PostgreSQL's default `NULLS DISTINCT` treats each NULL as unique. *(Standard behaviour; assert it in Scenario 3 with two erased users.)*
- Also requires the **M2 deferrable FK**, since deleting `auth.users` still hits RC-2.
- Everything below the account (`credit_account_id`) is untouched — those 20 NOT NULL columns never need migrating, because the account row survives.
- Cost: `billing_stripe_customers` / `billing_subscriptions` / usage-event `user_id`s still cascade away unless separately migrated.

**R2 — Erase the identity in place; never delete the row.** Scrub `auth.users` (email and metadata) to a non-identifying shell; delete all projects; scrub `github_*` rows; leave every billing FK pointing at the retained shell.
- Requires **no FK migration at all** — not M2, not M3. Every NOT NULL column and every materialized-balance invariant stays exactly as designed and provable.
- Keeps the Stripe reverse-lookup (`billing_stripe_customers_stripe_id_idx`) resolvable, so a later `invoice.paid` still attributes instead of orphaning.
- Cost: an `auth.users` row persists. This is **pseudonymization**, and whether it satisfies the erasure promise is a legal question, not an engineering one.

### Recommendation

**Adopt R2 as the default, with R1 as the fallback if legal requires the identity row itself to disappear.**

R2 wins on repository evidence: it touches no NOT NULL column, preserves every reconciliation invariant intact rather than relying on them surviving a cascade, avoids the RC-2 blocker entirely, and keeps webhook attribution working. R1 is fully proven and remains available — the two differ only in the last step, so the work is not wasted either way. **This is decision P-2/P-5 and needs founder/legal input; do not pick it in code.**

### Two live-money defects that erasure must handle regardless of fork

1. **Stripe keeps charging.** Nothing in `src/modules/billing/` cancels a Stripe subscription when a user is removed. Deleting the Vibe user does **not** stop the card being charged. **Erasure must cancel the subscription in Stripe before touching local state**, and that is an external, non-transactional effect — it belongs first in the sequence, with its own failure code.
2. **Post-erasure settlements lose their audit event.** `credits/service.ts:489,717,816` write `userId: (await accountOwner(...)) ?? ""` — an empty string is not a valid UUID, so the insert fails, and `recordAuditEvent` only `console.error`s (`events.ts:391-393`). A settlement landing after the owner is gone silently loses its financial audit record. §11's "billing finalized before erasure" rule prevents this; the `?? ""` should be fixed regardless.

---

## 10. Audit / Privacy Retention Design

### Why this matters, precisely

`audit_events` is the **only** table already architected to outlive its owner — and **[proven]** the row survives with `user_id` NULL while `metadata` keeps its payload: `audit_metadata_still_has_login = octo-founder`. Nulling the FK achieves nothing on its own.

**Reassuring scope limit:** the reader-side allowlist (`view.ts:274-285`, `FACT_KEYS` = `branchName`, `baseBranch`, `commitSha`, `mergedSha`, `approvedCommitSha`, `capability`, `failureCode`, `reason`, `metricKey`, `pagesInspected`) means **none** of the identifying fields can reach a screen today. This is a **data-at-rest retention** problem, not a UI leak — the correct framing for VB-002. *(Incidental: `baseBranch` is allowlisted but no writer emits it; merge writers use the non-allowlisted `default_branch`. Dead entry.)*

### What to scrub, across 120 event types

| Priority | Field(s) | Where written | Action |
|---|---|---|---|
| 1 | `githubLogin`, `accountLogin`, `githubRepositoryId` | `connect/github/callback/route.ts:123,132`; `repositories/actions.ts:88` | **delete** — replace with `{connected:true}`. Highest-value scrub. |
| 2 | `changedPaths[].path`, `largestChanges[].path`, `violations[].path` (≤100 paths/event, ≤200 chars) | `change-evidence.ts:373,375,343` → `agent-execution/execution.ts:2026,2087` | **pseudonymize** to `p1…pN`; keep `status`, `bytes`, `artifactClass`, `detectedBy`, `ignoredBy.rule`, and all counts — this preserves every question the withheld-path incident record needs to answer |
| 3 | `sourceOrigin`, `newOrigin`, `previousOrigin`, `beforeOrigin`, `public_origin` | live-product, production-url, review, outcome writers | **null** (or reduce to a domain hash) |
| 4 | `externalReference` (Stripe session/invoice id) | `credits/grants.ts:125` | **delete** — external join key |
| 5 | `message` on `credit_drift.repair_failed` | `credits/service.ts:216`; `lot-store.ts:274` | **delete** — the only unbounded free-text field in the vocabulary; a Postgres error can embed row values. `code` already carries the machine-readable half |
| 6 | `beforeObjectPath`, `afterObjectPath` | `change-review/execution.ts:289-290` | **null, at the same moment the Storage objects are deleted** — a path pointing at deleted bytes is worse than no path |
| 7 | `stage`, `monetizationModel`, `primaryGoal` | `founder-intent-store.ts:142-144` | delete; keep the non-reversible `intentHash` |
| 8 | `projectId` / `project_id` inside `metadata` | ~every writer (`events.ts:350-354` retains both spellings deliberately) | scrub **together with** the column, or the SET NULL is cosmetic |

**Retained untouched** (real security/accounting value, no PII): commit SHAs (content identifiers), credit amounts and ids, policy/model versions, closed-enum reasons and failure codes, counts and durations, `fields: Object.keys(corrections)` (names only), `answered: "value"|"unsure"`, `questionIntent`. The approval/merge/outcome family is the strongest retention case in the schema — under rules 67–74 it is the record of writes to a customer's default branch.

### Mechanism

- **Update-in-place**, executed by a privileged routine — not a new anonymized projection (two homes for one truth) and not an application write. `audit_events` has **no UPDATE policy** (append-only by omission), so this necessarily runs as service-role, which under rule 53 places it in `src/modules/operations/` alongside the rest of the lifecycle code.
- **Irreversible by design**; must therefore be tested against a fixture of every event category, not a sample.
- **One hard prerequisite (proven coupling):** `merge/store.ts:229-236` deduplicates `change_merge.not_eligible` by querying `metadata->>project_id` and `metadata->>prepared_change_id`. **Stripping those keys would silently convert merge-ineligibility logging into per-page-view logging.** Either exempt that event type or migrate the query to the real columns *first*.

### An open question the scrub exposes

Once `user_id` is NULL, the row is unreadable through every RLS path (`user_id = auth.uid()` never matches NULL) **and** invisible to `listAuditEventsForProject`. Retained audit history is therefore currently readable **by nobody** — there is no operator read path. Retention without a reader is storage, not evidence. **Decision P-6: either accept that (retain for legal/forensic access only) or build an operator surface.** Do not invent one in this slice; the audit already tracks the absence of any admin surface (VB-038).

---

## 11. Active-Operation / Billing Safety Rules

**Rule: deletion is refused while consequential work can still complete.** Never delete state a workflow, a sandbox, a merge or a settlement may still write to.

Refuse deletion when any of these hold:

| Condition | Detection (existing code) |
|---|---|
| Operation `queued` / `running` / `needs_user` | `isActive()` — `operations/schema.ts:258`. **Note the trap:** the store's `ACTIVE_STATUSES` (`operations/store.ts:90`) is only `queued`/`running` and **misses `needs_user`**. A gate built on `findActiveOperation` alone would delete a project holding a paused audit that still owns a credit reservation. |
| Agent run live | `findActiveAgentRunByIdentity` / status set at `coding-agent/store.ts:433` |
| Merge in flight | `change_merges.status in ('preflight','merging')` |
| Credit reservation `active` | reservations joined via `billing_credit_reservations.project_id` (they are keyed by account, not project) |
| Stripe event `processing` | `billing_stripe_events` claim outstanding for the account (erasure only) |

There is **no** existing type-agnostic "is anything live for this project" query — every lookup is per `operation_type`. One must be added, built on `isActive()`'s three statuses rather than the store's two.

**Billing must be finalized, not cancelled.** Deletion never releases or settles a hold itself — that authority belongs to the CAS-gated finalizers (audit §5 C4/C5). Deletion *waits for* or *refuses on* an unfinalized hold. Anything else risks the `charge_without_hold` class the billing work spent four sprints eliminating.

---

## 12. Domain API / Trust Boundary

**Placement is constrained by an existing rule, not free choice.** `src/lib/supabase/service.ts:36-40` confines `createServiceClient` to `src/modules/operations/` and `src/modules/billing/`. Erasure needs the service-role client (storage removal + the lifecycle RPC), so it **cannot** live in `src/modules/projects/` where `disconnect.ts` sits today. It belongs behind a durable operation in `src/modules/operations/`.

```ts
// src/modules/operations/project-lifecycle/  (new)
export type ProjectDeletionResult =
  | { ok: true }
  | { ok: false; reason:
      | "project_not_found"       // also the idempotent second call
      | "active_operation"
      | "agent_running"
      | "merge_in_progress"
      | "billing_not_finalized"
      | "storage_cleanup_failed"
      | "deletion_failed" };

export async function deleteProjectLifecycle(
  params: { projectId: string; userId: string },   // userId ALWAYS from the verified session
): Promise<ProjectDeletionResult>;
```

**Trust boundary rules:**
- `userId` is taken from `requireSession()` and passed down; it is never accepted from a client argument.
- Ownership is re-established **inside** the SQL function (`where id = p_project_id and user_id = p_user_id`), not merely by the caller — so a service-role bug cannot cross tenants. **[proven]** cross-tenant invocation returns `f` with no mutation.
- Failure codes are a closed union mapped by an exhaustive `Record` (the repository's established pattern, `operations/messages.ts:16`). **No PostgreSQL message ever reaches the client** — `disconnect.ts` currently returns `error.message`, which must stop.
- Idempotency: a second call returns `project_not_found`, deterministically, without throwing.

---

## 13. Migration Plan

Five migrations, deploy-ordered. Each is small, and **M1 alone unblocks VB-001 for projects**.

| # | Migration | Why | Lock / size | Back-compat | Rollback |
|---|---|---|---|---|---|
| **M1** | `execution_specs` carve-out: replace `reject_execution_spec_mutation()` (UPDATE always refused; DELETE only under the flag), `REVOKE DELETE` from `anon`/`authenticated`/`service_role`, create `erase_project_lifecycle(uuid,uuid)` `SECURITY DEFINER` + `GRANT EXECUTE` to `service_role` | RC-1 | `CREATE OR REPLACE FUNCTION` + grants — no table rewrite, no scan | **Fully backwards-compatible**: deployed code neither deletes projects successfully today nor calls the new function | Restore the previous function body; drop the new function |
| **M2** | Usage-metering `project_id` → nullable + `ON DELETE SET NULL` on `billing_usage_events`, `ai_usage_events`, `sandbox_usage_events`, `review_browser_usage`, `deep_scan_provider_usage` | class F (VB-040) — today a project delete destroys the metering that priced the charges (rules 7/47) | `DROP NOT NULL` catalog-only; five small FK swaps | Strictly wider; all writers supply a real `project_id` | Restore `NOT NULL` if no detached rows exist |
| **M3** | Audit-metadata scrub function (§10) | privacy | function only | additive, no caller until §14 lands | drop function |
| **M2′** | *(R1 only)* `repository_connections.github_installation_id` → `no action deferrable initially deferred` | RC-2 | `DROP`+`ADD CONSTRAINT` takes brief `ACCESS EXCLUSIVE` and re-validates | No app change; out-of-band orphaning still refused **[proven]** | Re-add as `RESTRICT` |
| **M3′** | *(R1 only)* `billing_credit_accounts.user_id` → nullable + `ON DELETE SET NULL` | RC-3 | catalog-only + small FK swap | Nullable is strictly wider, but **every read assuming non-null must be audited first** (§14) | Restore `NOT NULL` only if no tombstoned rows exist |
| **M4** | *(deferred with VB-004)* storage-retention sweep support | VB-004 | — | — | — |

**Deploy order: M1 → (code) → M2 → (code) → M3.** M1 is inert until a caller exists, so it lands safely ahead of the application change. **M2′/M3′ are needed only if legal chooses R1** (§9); under R2 they are never written. M3′ must land *before* any R1 erasure runs, or the first erasure destroys a ledger.

**Note what is deliberately absent: no intra-project `RESTRICT` FK is converted.** They were empirically shown not to block project deletion, so changing them would be churn against a non-cause and would weaken genuine out-of-band integrity guards for nothing.

Per CLAUDE.md rules 29/30, these go through the linked Supabase CLI workflow with `pnpm db:status` inspected first — never the SQL editor.

---

## 14. Application Changes

| File | Change |
|---|---|
| `src/modules/operations/project-lifecycle/service.ts` **(new)** | `deleteProjectLifecycle()`; drains per §11, sweeps storage, calls the RPC via the service client |
| `src/modules/operations/project-lifecycle/store.ts` **(new)** | `.rpc("erase_project_lifecycle", …)`; type-agnostic active-work query built on `isActive()`'s three statuses |
| `src/modules/review/storage.ts` | reuse `removeScreenshots`; add a project-prefix sweep (`list("<projectId>")` → `remove`) — paths are project-prefixed by `review/identity.ts:76-81`, so this is clean |
| `src/app/app/projects/[projectId]/actions.ts` | **VB-003.** Return a state union instead of `Promise<void>`; `redirect("/app")` only inside `if (result.ok)`; record a `project.deletion_failed` audit event on the failure branch |
| `src/app/app/projects/[projectId]/disconnect-button.tsx` | `useActionState`; render failure via a local `Record<Reason,string>` and the established `text-sm text-amber` line; `<form action={formAction}>` |
| `src/modules/audit-log/events.ts` | extend the closed `AuditEventType` union with `project.deletion_failed` (and `project.deleted` if the naming split lands). No SQL change — `event_type` is unconstrained `text` |
| `src/modules/projects/disconnect.ts` | either retire, or narrow to genuine GitHub detach under the §5 naming decision. **Must stop returning `error.message`.** |
| `src/modules/credits/service.ts:489,717,816` | fix `userId: … ?? ""` — an empty string is not a UUID, so a post-erasure settlement silently loses its financial audit event (§9 defect 2) |
| `src/modules/billing/checkout.ts` (or a new erasure step) | cancel the Stripe subscription **before** local erasure — nothing currently stops Stripe charging a deleted user's card (§9 defect 1) |
| `src/modules/merge/store.ts:229-236` | migrate the `metadata->>project_id` / `->>prepared_change_id` dedup query onto the real columns **before** the §10 scrub, or the scrub turns merge-ineligibility logging into per-page-view logging |
| `src/modules/billing/**` | *(R1 only)* audit every read assuming `billing_credit_accounts.user_id` is non-null before M3′ lands |

**VB-003 can ship on its own, before any migration** — it is a pure correctness fix to the reporting path and is strictly better than today even while deletion still fails.

---

## 15. Verification Matrix

Local Supabase/Postgres only. The harness pattern already exists (`src/modules/credits/concurrency/`, `vitest.concurrency.config.mts`) and refuses non-loopback targets by construction.

| # | Scenario | Expected | Notes |
|---|---|---|---|
| 1 | Project with connection, intelligence, completed audit, opportunities, plan, founder resolution → delete | succeeds; no live project rows; retained history per §4; **no other project touched** | pre-proven at fixture level |
| 2 | Project with spec + prepared change + validation + approval + merge → delete | succeeds under lifecycle authority; **plain `DELETE` still refused**; retention matches ADR | **[already proven]** — becomes the regression test |
| 3 | User with credits, ledger, reservations, usage → erase | identity non-identifying; **ledger + account + all five usage tables retained**; `reconcileBalance` and `reconcileLotAllocation` report **zero drift**; no CHECK violated | the invariant assertion is the point — a retained-but-drifting ledger is a worse outcome than a deleted one |
| 3b | Two users erased (R1 only) | both accounts tombstoned with `user_id` NULL; the unique index tolerates both (`NULLS DISTINCT`) | the multi-tombstone case the single-row proof did not cover |
| 3c | Project deleted, then usage history queried | metering rows still present with `project_id` NULL | proves M2 fixed the rule-7 defect |
| 4 | Delete while an operation is `running` / `needs_user` | refused with `active_operation`; no orphan hold; no workflow resurrects deleted state | must cover `needs_user` — the store's active set misses it |
| 5 | User B calls deletion with user A's project id | **no mutation whatsoever**, `project_not_found` | **[already proven]** at SQL level; repeat through the domain API |
| 6 | Invoke deletion twice | deterministic; second returns `project_not_found`; no throw | **[already proven]** |
| 7 | Force a DB failure mid-delete | **UI does not report success**; failure audit event recorded; no partial state | the VB-003 regression test |
| 8 | Ordinary `execution_specs` DELETE/UPDATE outside the routine | both refused | **[already proven]** — pin as a permanent guard |
| 9 | Storage sweep fails, DB succeeds / DB fails, storage swept | orphaned-bytes case is retryable and reported; never a committed delete with a lost pointer | §6 ordering rationale |
| 10 | Out-of-band `DELETE FROM github_installations` with a live connection | still refused at COMMIT under the deferrable FK | **[already proven]** — proves M2 keeps integrity |

---

## 16. Risks / Edge Cases

1. **`SECURITY DEFINER` is a standing privilege.** The repository already removed one unnecessary `SECURITY DEFINER` after an advisor finding (`20260818131334`). This one is necessary, so it must be narrow: fixed signature, ownership check inside, `search_path = ''`, `EXECUTE` revoked from `public`/`anon`/`authenticated`. Re-run `get_advisors` after M1.
2. **The flag is forgeable — by design, and harmless.** Its safety rests entirely on the `DELETE` privilege being revoked. **If a future migration re-grants `DELETE` on `execution_specs` (e.g. a blanket `GRANT ... ON ALL TABLES`), the carve-out silently becomes an open door.** Pin this with a test asserting the privilege is absent. Note the pending VB-015 grant-tightening migration must not collide with it.
3. **M3 widens a `NOT NULL` invariant.** Nullable `user_id` on a billing account is a real semantic change; TypeScript reads assuming non-null must be found before it lands.
4. **Deleting a project with in-flight external effects** (a merge Vibe has requested but not read back) risks losing the row that records what was attempted. §11 refuses rather than races.
5. **Storage orphans remain until VB-004.** Deleting a project sweeps its own prefix, but expired-artifact bytes across live projects still accumulate — a known dependency, not solved here.
6. **`connect.ts:58` deletes a project row with no `user_id` filter.** Not a live vulnerability (RLS holds), but it is a second, weaker deletion path and should be brought under the same scrutiny.
7. **Retention duration is undecided (P-2).** The architecture is period-agnostic; someone must still choose.
8. **Anonymizing `audit_events` in place is irreversible** and the table is append-only by policy (no UPDATE policy). The scrub must be a privileged, audited routine, not an application write — and must run against a fixture covering **all 120 event types**, not a sample.
9. **Stripe outlives Vibe.** Cancelling the subscription is an external, non-transactional effect that must precede local erasure and can fail independently. Erasure needs a `stripe_cancel_failed` outcome; it must not proceed and leave a live subscription no one can see.
10. **Retention without a reader (P-6).** Once `user_id` is NULL the surviving audit rows are invisible to every RLS path and to `listAuditEventsForProject` — retained for legal/forensic access only, with no operator surface (the audit's VB-038 tracks that absence).
11. **The billing-graph rule is easy to violate later.** A future "clean up old reservations" job that deletes rows under a live account would silently re-introduce unrepairable drift. The whole-or-nothing rule belongs in the ADR text, not only in this plan.

---

## 17. Backlog Mapping

Lifecycle: `New → Implemented → Needs Review → Validated → Done`. All three are **New**. **Implemented ≠ Done.**

### VB-002 — Erasure / retention architecture *(the gating item; do first)*
- **→ Implemented:** this ADR merged (verbs, §4 matrix, the whole-or-nothing billing rule, R1-vs-R2 chosen); M2 + M3 written; the Stripe-cancellation step and the `?? ""` fix landed.
- **→ Needs Review:** reviewed against CLAUDE.md rules 7/26/34/47/83; the `merge/store.ts` dedup coupling migrated; P-1/P-3/P-4/P-6 answered; *(R1 only)* billing non-null reads audited.
- **→ Validated:** Scenarios 3, 3b, 3c green — retained ledger **and** metering, **zero reconciliation drift**, no CHECK violated, identity non-identifying.
- **→ Done:** the above plus a written statement of what is retained, for how long, under which fork, and where that is configured; `documentation-currency` green.

### VB-001 — Make deletion technically possible
- **→ Implemented:** M1 applied; `deleteProjectLifecycle()` landed with the §11 drain and the storage sweep. *(R1 only: + M2′.)*
- **→ Needs Review:** `get_advisors` clean after the `SECURITY DEFINER` addition; a test asserting `DELETE` on `execution_specs` is **not** granted (the carve-out's whole safety rests on it, and VB-015's grant-tightening migration must not collide); confirmation that **no intra-project RESTRICT FK was changed**.
- **→ Validated:** Scenarios 1, 2, 4, 5, 6, 8, 9 green against real PostgreSQL *(10 under R1)*.
- **→ Done:** a real project and a real account erased end-to-end in a non-production environment, with retained/deleted row counts matching §4 exactly.

### VB-003 — Never report failed deletion as success
- **→ Implemented:** action returns the union; redirect only on success; failure audit event; fixed copy in the button.
- **→ Needs Review:** no `error.message` reaches the client anywhere on the path; copy matches actual behaviour (RC-5).
- **→ Validated:** Scenario 7 green — forced DB failure shows an error and does not navigate.
- **→ Done:** Validated **and** shipped behind the corrected wording, so a user is never told a project was removed when it was not.

---

## 18. Recommended Implementation Order

1. **VB-003 first, alone.** No migration, no dependency, immediately stops the worst behaviour (a user told their project was removed when nothing was). Ship it while the rest is still being decided.
2. **Answer the open decisions** — P-1 (naming), P-2/P-5 (R1 vs R2 + retention period), P-3 (Stripe mapping), P-4 (`free_audit_grants`), P-6 (operator read path). Only P-2/P-5 gates code.
3. **VB-002 ADR** — the retention model and the whole-or-nothing billing rule, merged before any code can destroy anything.
4. **M1 + `deleteProjectLifecycle()`** — project deletion works; Scenarios 1, 2, 5, 6, 7, 8, 9.
5. **M2 + the metering fix** — Scenario 3c; closes the rule-7 defect independently of erasure.
6. **Erasure path (R2, or R1 + M2′/M3′)** — Scenarios 3, 3b, 4, 10; includes the Stripe cancellation step and the `?? ""` fix.
7. **M3 audit scrub** — after the `merge/store.ts` dedup migration; Scenario 3's privacy half.
8. **VB-004 storage retention** — separately, on this foundation.

Steps 4–7 are each independently verifiable; do not batch their migrations. **Nothing in steps 4–8 should start before step 3 is merged.**
