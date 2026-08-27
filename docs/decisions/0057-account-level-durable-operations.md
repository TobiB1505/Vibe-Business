# 0057 - Account-level durable operations, and how an erasure outlives itself

Status: Accepted
Date: 2026-08-27

Extends [ADR 0013](0013-durable-operation-execution.md) and unblocks [ADR 0056](0056-lifecycle-erasure-and-retention.md) §4. Supersedes nothing.

## Context

[ADR 0056](0056-lifecycle-erasure-and-retention.md) §4 decided that account erasure runs as **one durable operation in eleven ordered steps**, and §11 listed the six migration families it needs. All six are now built. The orchestrator is not, and the reason is not that it is hard: the durable-operation model cannot currently express the operation ADR 0056 asked for, and the eleventh step destroys the record of the operation performing it.

None of this is visible in the migration text, and none of it was known when 0056 was written. It was measured while building the orchestrator, on a throwaway cluster carrying all sixty-nine migrations — the same method that corrected 0056's own §5 twice.

The decision is recorded here rather than improvised inside an implementation slice because it changes a model three years of operations depend on. Under rule 14 an ambiguity that materially affects architecture stops the work; under rule 20 a confirmed decision is changed by an ADR, not by a quiet deviation in code. ADR 0013 established what a durable operation *is*; this is the first operation that is not about a project, and that is an extension to it rather than a use of it.

## Empirical findings

Five, all measured. Each one is a reason the orchestrator could not simply be written.

**G1 — An account-level operation is invisible to its own owner. [proven]**
`operation_runs.project_id` is `NOT NULL`, and **all four** RLS policies on the table route through it: `exists (select 1 from projects p where p.id = operation_runs.project_id and p.user_id = auth.uid())`. Every one of the fourteen `operation_type` values is project-scoped, so nothing has ever needed otherwise. A row with a null `project_id` would match no policy in any direction — the user could not watch the progress of their own erasure, and could not have inserted it in the first place.

**G2 — Step 11 deletes the operation performing it. [proven]**
`operation_runs.user_id` is `ON DELETE CASCADE` into `auth.users`. The erasure's final act therefore removes the erasure's own row, mid-flight, and the workflow's terminal write lands on nothing. Marking the operation terminal *before* step 11 does not help: same transaction or not, the row is gone at the end, and "the row is absent" cannot distinguish a successful erasure from a deletion that happened for any other reason. That is exactly the ambiguity rule 73 refuses to resolve by inference.

**G3 — The double-submission guard silently does not apply. [proven]**
`operation_runs_single_active_idx` is `unique (project_id, operation_type, input_identity) where status in ('queued','running')`. Under PostgreSQL's default `NULLS DISTINCT`, a null `project_id` makes every account-level row distinct from every other. Two concurrent erasures of the same account would both be admitted, and `createOperationRun`'s `already_active` path — which is nothing but this index's unique violation — would never fire. Rule 48 requires double submission to be blocked by a database constraint; for account-level operations there is currently none.

**G4 — The type vocabulary and the completion contract both exclude erasure. [proven]**
`operation_type` is a closed `CHECK` over fourteen values. Separately, `check (status <> 'completed' or result_id is not null)` requires a completed operation to point at the artifact it produced. An erasure produces no artifact — that is its definition, not an omission — so it cannot satisfy the constraint as written.

**G5 — There is exactly one insertion funnel. [proven]**
Every one of the fourteen operation types is inserted by `createOperationRun` in `operations/store.ts`. This is the finding that makes ADR 0056 §4's step 1 — "every start path is closed for the duration" — a tractable sentence rather than an aspiration, and §5 below is about where the closure belongs given that it is true.

## Decision

### 1. The durable-operation model gains an account level, additively

`operation_runs.project_id` becomes nullable. A null means *this operation is about the account, not about a project* — it is never "unknown" and never a default.

The four RLS policies branch on it rather than being rewritten:

```sql
case when operation_runs.project_id is null
     then operation_runs.user_id = auth.uid()
     else exists (select 1 from public.projects p
                  where p.id = operation_runs.project_id and p.user_id = auth.uid())
end
```

**The `else` branch is the existing rule, verbatim.** That is deliberate and is the whole reason for a `case` rather than an `or`. A disjunction would also grant visibility to any project-scoped row whose `user_id` happens to match — a different rule for existing data, which is not what this ADR is deciding. Under the branch above, **no existing row changes visibility**, and the new rule applies only where the old one had nothing to say.

### 2. The erasure operation is tombstoned, not deleted

`operation_runs.user_id` becomes nullable with `ON DELETE SET NULL`.

After step 11 the erasure's row survives with both owner columns null: a completed operation belonging to nobody. That is the same shape ADR 0056 §6 gives the credit account, §7 gives metering, and §8 gives `audit_events` — and it is adopted here for the same reason. The alternative is not "a tidier schema", it is an operation that cannot report its own outcome.

The consequence is stated rather than discovered: **`StoredOperationRun.userId` and `.projectId` become nullable in TypeScript**, and every consumer is re-typed. As with M3′, the compiler performs that audit rather than a grep.

### 3. Account-level double submission is blocked by an index, not by a check

A second partial unique index mirrors the existing one for the account level:

```sql
unique (user_id, operation_type, input_identity)
  where project_id is null and status in ('queued', 'running')
```

`createOperationRun`'s existing `already_active` unique-violation path then covers account-level operations with no change to its code — which is the point of expressing it as an index rather than as a lookup. Two erasures of one account cannot both be admitted, and the one that loses learns so from PostgreSQL rather than from a race-prone read.

### 4. `account_erasure` joins the vocabulary, and produces no artifact

The `operation_type` check gains `'account_erasure'`. The completion check gains one exemption:

```sql
check (status <> 'completed' or result_id is not null or operation_type = 'account_erasure')
```

**An erasure's product is absence.** `result_id` points at what an operation made; there is nothing for this one to point at, and inventing a row so a constraint is satisfied would be a lie told to a `CHECK`. The exemption is narrow, names the one type, and is preferable to relaxing the constraint for everybody.

### 5. "Every start path is closed" is a trigger, not an application check

ADR 0056 §4 step 1 says every start path is closed for the duration of an erasure. G5 says there is one funnel today, so an application check in `createOperationRun` would be true today.

It is a trigger anyway, and the reason is rule 76's: **an effect that must never happen is better as an absent capability than as a denied one.** A `BEFORE INSERT` trigger on `operation_runs` closes paths that do not exist yet, paths that bypass the store, and paths taken by the service-role client — which bypasses RLS and is precisely the client durable execution uses. A check inside one function protects the callers who go through that function.

The trigger refuses an insert when the row's owner has an erasure in `queued`, `running` or `needs_user`, and exempts `account_erasure` itself so the erasure can be started and so a failed one does not lock the account out forever. **The blocking set is `isActive()`'s three statuses**, not the store's two-value `ACTIVE_STATUSES` — the same trap ADR 0056 §10 names, and for the same reason.

### 6. The receipt is an audit event, and there is no new table

Erasure records its outcome as an `audit_events` row written in step 11's own transaction. That row survives with `user_id` nulled by the same cascade, which is what `audit_events` has always been for.

No `account_erasures` table is introduced. It was the obvious design and it is rejected in full below: a second home for operation state contradicts rule 51, and the receipt it would hold is already held by the log built to outlive its owner.

## Security considerations

The RLS change is the only part of this that touches an access boundary, and it is written to be provably additive: the project branch is byte-identical to the policy it replaces, so a regression could only appear on rows the old policy already denied. The new branch grants a user visibility of account-level rows carrying their own `user_id` — the same identity the `INSERT` policy already requires them to write.

The trigger runs `security definer`-free: it needs no privilege beyond reading the table it is attached to, and it is not a place to put authorization. It refuses work; it authorizes none.

Two things this ADR deliberately does **not** do. It does not grant any role `DELETE` on `operation_runs` — the erasure never deletes its own row, it lets the cascade null it. And it does not widen the service-role client's reach: rule 53 still confines it to `src/modules/operations/`, which is where the orchestrator lives.

## Failure and retry semantics

An erasure that fails is `failed`, and the account is usable again — the trigger's blocking set is the three active statuses, so a terminal erasure blocks nothing. This is deliberate: an account frozen by a failed erasure is a worse outcome than one whose erasure must be restarted, and ADR 0056 §9 already stops the erasure at the first external failure rather than proceeding.

A retry is a **new** operation with a new identity, never a resumption of the failed one. Steps 1–3 re-run from scratch, including the Stripe cancellation, which is idempotent at Stripe for a subscription already cancelled. Steps 4–11 are each idempotent against a partially erased account: a project already deleted is not found, a column already null is set to null, and the scrub of an already-scrubbed payload is a no-op because the transform is pure and its output contains none of the keys it removes.

The one non-idempotent moment is step 11 itself, and it is protected the way rule 73 requires: the identity either exists or it does not, and the observation decides. There is no third state to resolve.

## Verification requirements

Because this changes a model everything else runs on, the migration is not considered landed until a real-PostgreSQL suite asserts:

1. A project-scoped operation's visibility is **unchanged** under the new policies — asserted as the owner, and as a second user who must still see nothing.
2. An account-level row is visible to its owner and invisible to everybody else.
3. Two concurrent account-level operations with the same identity cannot both be active.
4. The trigger refuses a project-scoped insert while an erasure is active, permits one once the erasure is terminal, and never blocks the erasure's own insert.
5. An operation row survives the deletion of its owner with both owner columns null and its status intact.

Rule 69's four questions apply to the orchestrator that follows, not to this ADR: the SQL/RLS contract is (1)–(5), the domain state is the orchestrator's own suite, and the browser-visible state and the dogfood belong to whatever surface eventually offers erasure to a user. **No user-facing erasure control is authorized by this document.**

## Deferred decisions

- **Whether account-level operations get a surface.** This makes them expressible and describes exactly one of them. Whether an account-level operation ever appears in the UI, and where, is not decided here.
- **Whether a failed erasure notifies anybody.** ADR 0056 defers the erasure's user-facing copy entirely, and this does not pre-empt it.
- **What reads a tombstoned operation row.** As with ADR 0056's tombstoned billing rows, the surviving record matches no policy once its owner is null, so it is readable by nobody. That is the same deferred question ARCHITECTURE.md §7 already records, and this adds one more table to it rather than answering it.

## Consequences

### Positive

- ADR 0056 §4's eleven steps become buildable as the single durable operation it specified, rather than as something weaker wearing the same name.
- The durable-operation model gains an account level that any future account-scoped work can use — plan changes, exports, transfers — without a second model beside it.
- The double-submission guard, which G3 showed silently did not cover account-level rows, now covers them by the same mechanism it covers everything else.
- "Every start path is closed" becomes structurally true rather than true-by-inspection, and stays true for start paths nobody has written yet.

### Negative / Tradeoffs

- **Two owner columns on `operation_runs` become nullable, and every reader is re-typed.** This is real churn in a hot module, and it makes two fields optional that are, for all fourteen existing operation types, always present. The compiler enumerates the sites; it cannot enumerate the readers who will now have to think about a null that in practice only appears on one row per erased account.
- **A `CHECK` now names a specific operation type.** That is a smell, and it is accepted knowingly: the alternative is either a fake `result_id` or a constraint relaxed for all fourteen types to accommodate one.
- **A trigger on the insert path of every durable operation.** One indexed lookup per operation start, forever, to protect against a state that is rare by construction. Judged worth it because the thing it prevents — new work starting inside an erasure and being destroyed by it — is unrecoverable, and because G5's single funnel is a fact about today, not a guarantee.

## Rejected alternatives

**A separate `account_erasures` table, carrying its own state machine.**
The obvious design, and the one that avoids every schema change above. Rejected because it creates a second home for operation state, which rule 51 forbids for good reason: the moment two tables can both say whether something is running, they can disagree, and the repair path for that disagreement is a third mechanism. ADR 0042's whole subject is what that costs in the billing domain. The receipt such a table would hold is already held by `audit_events`, which was built to outlive its owner.

**Leave `user_id` cascading and treat the row's disappearance as success.**
Rejected on G2. It converts a reported outcome into an inference from an absence, which is the failure class rule 73 exists to eliminate — and the inference is not even sound, since any other deletion produces the same evidence.

**Terminalize the operation before step 11.**
Rejected as dishonest. `completed` written before the last step means `completed` can be wrong, and an erasure is the operation where a wrong success is least recoverable.

**Make erasure a non-durable request-scoped action.**
Rejected. It calls Stripe, deletes an unbounded number of projects and sweeps Storage; rule 49 and ADR 0013 both put that in a durable operation, and a browser tab closing mid-erasure is exactly the scenario they exist for.

**Rewrite the RLS policies as `user_id = auth.uid()` alone.**
Simpler, and equivalent for every row `createOperationRun` writes. Rejected because it is not equivalent for rows it did not write: a row with a matching `user_id` and somebody else's `project_id` would change from denied to allowed. A `case` costs one line and changes nothing that exists.

## Related

- [ADR 0013](0013-durable-operation-execution.md) — Durable Operation Execution, which this extends
- [ADR 0056](0056-lifecycle-erasure-and-retention.md) — Lifecycle, erasure and retention: §4's eleven steps, §10's active-work rules, §11's six migration families
- [ADR 0042](0042-billing-reconciliation-authority.md) — what two homes for one truth costs
- [ADR 0018](0018-human-approval-authority.md) and [ADR 0019](0019-safe-approved-change-merge.md) — rule 73's observation-decides doctrine, applied here to step 11
