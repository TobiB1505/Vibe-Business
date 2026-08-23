# ADR 0042 Sprint F — activation checklist

**Status as of this writing: all four stages complete. `BILLING_REPAIR_ENABLED=true` is live in Production.** See `docs/sprints/0068-billing-reconciliation-sprint-f-activation.md` for the full record of how each stage actually executed, including the one real finding along the way (two orphaned, pre-cutover `operation_runs` rows that failed the drain check and were cancelled, verified dependency-free first). This document remains the reusable procedure for any *future* activation cycle (e.g. after a rollback) — the sections below are kept in their original prescriptive form for that reason, not rewritten into a past-tense narrative; the sprint record is where the narrative lives, per this repository's own records-vs-current-state-docs split (rule 83). See [ADR 0042 §P3, "Rollout"](../decisions/0042-billing-reconciliation-authority.md) for the full derivation and proof this checklist executes against; this document adds nothing to that reasoning; it only makes it runnable.

**A known, flagged inconsistency, not silently fixed**: the migration files this checklist and ADR 0042 name (`supabase/migrations/20260823000000_billing_reconciliation_cutover.sql`, `..._primitives.sql`, `..._operation_pause_cycle.sql`) carry different timestamps than what the remote database's own migration history actually recorded when `apply_migration` applied them (`20260823085754`, `20260823092748`, `20260823134718` — same names, different versions). This is exactly the "manually-applied migrations may already exist on the remote database without matching local history" case rule 30 names. Nothing in this session has attempted to reconcile it; `pnpm db:status` should be run and the mismatch resolved deliberately (per rule 34, the local files are the source of truth) before any future migration touches these tables, rather than assumed away.

Every stage below is a **precondition for the next, not an independent option.** Skipping a stage, or activating the flag before the drain window is verified, reopens the exact double-count/permanently-invisible-drift failure modes §P3 exists to prevent.

## Confirmed account identity (checked once, recorded so it is never re-guessed)

- **Vercel project:** `vibe-business` (`prj_YSM0fYcTzRiVCcE09ajUH3vAmswR`), team `planner-agent` (`team_M4fegq2Wl26ILNCQOha6sKVW`), linked to `TobiB1505/Vibe-Business`. This is the *Vercel team slug*, unrelated to the Supabase project rule 33 forbids — do not confuse the two.
- **Supabase project:** `Vibe-Business` (`dcbwlctscooefwnivxzv`), `eu-north-1`, the only Supabase project in the organization — no `Planner-Agent` Supabase project is reachable from this account, so there is no ambiguity to resolve at activation time (rule 32/33).

If either of those ever stops being true — a second Supabase project appears, the Vercel project is renamed or forked — re-verify by the same read-only listing before proceeding; do not carry this section's identifiers forward blindly.

## Stage 0 — merge to `main` (explicit human approval required; not autonomous) — DONE

Per CLAUDE.md rule 5, this step is never taken by an AI-authored flow on its own. PR #75 was merged on explicit instruction; merge commit `8929e05` on `main`.

## Stage 1 — schema migration, deployed alone — DONE (executed earlier this session, ahead of Stage 0)

Confirmed by direct read against `dcbwlctscooefwnivxzv`: all four marker columns, `operation_runs.pause_cycle`, and all five `materialize_*`/`repair_*` functions exist. Applied via `apply_migration` in this session's earlier work — see the flagged local/remote migration-version mismatch above; `get_advisors` verification is recorded in `docs/sprints/0059-billing-reconciliation-b1-primitives.md`. This happened before Stage 0 rather than after, which does not violate the ADR's required order (migration-before-app-code) — it satisfies it more conservatively, since the app code that depends on this schema only just went live in Stage 2.

## Stage 2 — application deploy, repair gated off — DONE (automatic, as a direct consequence of Stage 0)

Vercel's GitHub integration deploys `main` to Production automatically; merging PR #75 *was* this stage, not a separate later action. Deployment `dpl_D6YExD1cEvbGpobmWF5LNigYQZje`, target `production`, state `READY`, commit `8929e05`, promoted `2026-08-23T17:47:22Z`. `BILLING_REPAIR_ENABLED` was confirmed absent for the duration of this stage (zero `credit_drift.*` audit events; the operator's own Vercel dashboard read).

This stage is, by R2's proof, safe to roll out incrementally — old and new code writing concurrently compose correctly. It is not safe to *skip waiting* after it before proceeding, which is the entire point of Stage 3.

## Stage 3 — drain window verification (the actual gate; read-only, run fresh every time)

Both conditions below must return a clean result **at the same sitting** — do not reuse a result from an earlier check, and do not infer either from elapsed time alone (the ADR is explicit this is not permitted).

**(a) No in-flight ordinary invocation from before Stage 2's deploy.**
Confirm, via Vercel's deployment status for `prj_YSM0fYcTzRiVCcE09ajUH3vAmswR`, that Stage 2's deployment has been the sole Production-serving deployment for at least the platform's configured maximum function duration, measured from its actual promotion timestamp — not from when it was triggered.

**(b) No non-terminal legacy workflow instance.** Run, against the Supabase project (`dcbwlctscooefwnivxzv`), exactly the queries ADR 0042 §P3 specifies — reproduced here verbatim so this checklist never drifts from the derivation:

```sql
SELECT id FROM operation_runs
WHERE created_at < :cutover_deployment_at
  AND status NOT IN (<fully terminal statuses — excludes 'needs_user'>);
-- and the equivalent query against agent_execution_runs, excluding 'needs_user_input'
```

```sql
SELECT r.id FROM billing_credit_reservations r
LEFT JOIN operation_runs o ON o.id = r.operation_run_id
WHERE r.created_at < :cutover_deployment_at
  AND r.status = 'active'
  AND (o.id IS NULL OR o.status NOT IN (<fully terminal — excludes 'needs_user'>));
```

`:cutover_deployment_at` is Stage 2's actual promotion timestamp, read from Vercel, not typed from memory. Fill in the exact terminal-status lists from each table's own schema (`operation_runs`/`agent_execution_runs` status enums) before running — do not approximate.

**All three queries must return zero rows.** If any returns rows: do not activate. Wait, and re-run condition (a) and re-run all of condition (b) again — a row draining does not mean the check as a whole is closer to passing; it means run it again, fresh, next time.

## Stage 4 — activation

Only once Stage 3 passes cleanly, in one sitting:

1. Set `BILLING_REPAIR_ENABLED=true` as a **Production-only**, server-only Vercel environment variable (never `NEXT_PUBLIC_*` — it must not reach the client bundle) on project `prj_YSM0fYcTzRiVCcE09ajUH3vAmswR`.
2. **Read it back** — do not treat the write call's own success response as the guarantee (this codebase's own "independent read decides success" discipline, ADR 0042 §P3 rollback section and rule 73).
3. Trigger a fresh deploy/redeploy so the running instances actually pick up the new environment variable (Vercel environment variable changes do not retroactively affect already-running serverless instances).
4. Confirm activation by observing the audit log: the next `getBillingOverview` read against a genuinely drifted account/lot (if any exist) produces `credit_drift.repaired` or `credit_drift.repair_failed`, not silent `console.error` — and a read against an already-consistent account/lot changes nothing (matching Sprint B1's own "byte-for-byte identical" proof, now checked against live traffic instead of a one-off script).

## Rollback, if anything looks wrong post-activation

Follow ADR 0042 §P3's own rollback procedure exactly — unset `BILLING_REPAIR_ENABLED`, **read it back to confirm it is actually off**, redeploy old application code, and treat any future reactivation as a **fresh** Stage 3 drain proof, never a resumption of this one. Do not attempt an ad hoc fix (rule: never recompute/overwrite a cache directly — that is the exact failure mode this whole ADR exists to prevent).

## What this document is not

Not a sprint record — this document is the reusable procedure, kept prescriptive on purpose so a future activation (after a rollback, or a second project) can follow it again; `docs/sprints/0068-billing-reconciliation-sprint-f-activation.md` is where the narrative of this specific run — dates, deployment IDs, the orphaned-row finding — actually lives. Not a new architecture decision — every step is a direct execution of ADR 0042 §P3's already-approved rollout order; if any step here turns out to need a design change, that is a further ADR revision, not a silent deviation in this checklist.
