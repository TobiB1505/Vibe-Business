# ADR 0041 Sprint F — activation checklist

**Status as of this writing: not started. Nothing in this document has been executed.** `origin/main` currently ends at Sprint 0057 — the ADR 0041 migration, primitives, and hot-path rewiring (Sprints 0058–0061, "B0"–"D") have not been merged, so none of the columns, functions, or gated call sites this checklist verifies exist in production yet. This document is the concrete, operator-run procedure for the day they do — written now so activation follows the ADR's own required sequencing rather than being improvised at the moment someone wants the flag on. See [ADR 0041 §P3, "Rollout"](../decisions/0041-billing-reconciliation-authority.md) for the full derivation and proof this checklist executes against; this document adds nothing to that reasoning; it only makes it runnable.

Every stage below is a **precondition for the next, not an independent option.** Skipping a stage, or activating the flag before the drain window is verified, reopens the exact double-count/permanently-invisible-drift failure modes §P3 exists to prevent.

## Confirmed account identity (checked once, recorded so it is never re-guessed)

- **Vercel project:** `vibe-business` (`prj_YSM0fYcTzRiVCcE09ajUH3vAmswR`), team `planner-agent` (`team_M4fegq2Wl26ILNCQOha6sKVW`), linked to `TobiB1505/Vibe-Business`. This is the *Vercel team slug*, unrelated to the Supabase project rule 33 forbids — do not confuse the two.
- **Supabase project:** `Vibe-Business` (`dcbwlctscooefwnivxzv`), `eu-north-1`, the only Supabase project in the organization — no `Planner-Agent` Supabase project is reachable from this account, so there is no ambiguity to resolve at activation time (rule 32/33).

If either of those ever stops being true — a second Supabase project appears, the Vercel project is renamed or forked — re-verify by the same read-only listing before proceeding; do not carry this section's identifiers forward blindly.

## Stage 0 — merge to `main` (explicit human approval required; not autonomous)

Per CLAUDE.md rule 5, this step is never taken by an AI-authored flow on its own. Someone with merge authority opens/approves the PR carrying Sprints 0058–0067 into `main`. Nothing past this point in the checklist is meaningful before this lands.

## Stage 1 — schema migration, deployed alone

The migration (`supabase/migrations/20260823000000_billing_reconciliation_cutover.sql` and `..._primitives.sql`, currently only on this branch) ships **before any application code that reads the new columns or calls the new functions.** Concretely:

1. Deploy the migration to the linked Supabase project — via the linked Supabase CLI workflow (rule 29: never manual SQL Editor copy/paste for this), or `apply_migration` if operating through this session's Supabase MCP connection against project `dcbwlctscooefwnivxzv`.
2. Confirm via `list_migrations` that history matches the local migration files (mirroring rule 30's `pnpm db:status` discipline) — do not assume; read it back.
3. Run `get_advisors --type security` and `--type performance` against the new functions, matching Sprint B1's own verification (`docs/sprints/0059-billing-reconciliation-b1-primitives.md`) — expect zero new findings beyond the pre-existing, already-documented ones.
4. **The migration's own in-transaction certification (§P3 Rollout, "Certify... Backfill") is what actually proves R1** — this is not a separate manual step; if the migration transaction completes, certification passed. If it aborts, stop: an account or lot failed reconciliation before any of this work began, and needs manual remediation first, unrelated to this rollout.

Application code is still the pre-0041 CAS loops at this point — nothing behaviorally changes for a live user yet.

## Stage 2 — application deploy, repair gated off

Deploy the branch's application code (Sprints C/D onward: `.rpc()`-based hot-path writers, both repair call sites wired to `getBillingOverview`) to Production. `BILLING_REPAIR_ENABLED` is **not** set — it must remain absent through this entire stage. Verify:

- The deployment is live and is the sole Production deployment serving traffic (`list_deployments`/`get_deployment` against Vercel project `prj_YSM0fYcTzRiVCcE09ajUH3vAmswR`, team `team_M4fegq2Wl26ILNCQOha6sKVW` — confirm `readyState`/promotion, not merely "build succeeded").
- `reconcileBalance`/`reconcileLotAllocation` still run and still log drift on every `getBillingOverview` read, exactly as before (they are unconditional; only the repair call is gated) — spot-check the audit log for `credit_drift.detected` events appearing, `credit_drift.repaired`/`repair_failed` never appearing.

This stage is, by R2's proof, safe to roll out incrementally — old and new code writing concurrently compose correctly. It is not safe to *skip waiting* after it before proceeding, which is the entire point of Stage 3.

## Stage 3 — drain window verification (the actual gate; read-only, run fresh every time)

Both conditions below must return a clean result **at the same sitting** — do not reuse a result from an earlier check, and do not infer either from elapsed time alone (the ADR is explicit this is not permitted).

**(a) No in-flight ordinary invocation from before Stage 2's deploy.**
Confirm, via Vercel's deployment status for `prj_YSM0fYcTzRiVCcE09ajUH3vAmswR`, that Stage 2's deployment has been the sole Production-serving deployment for at least the platform's configured maximum function duration, measured from its actual promotion timestamp — not from when it was triggered.

**(b) No non-terminal legacy workflow instance.** Run, against the Supabase project (`dcbwlctscooefwnivxzv`), exactly the queries ADR 0041 §P3 specifies — reproduced here verbatim so this checklist never drifts from the derivation:

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
2. **Read it back** — do not treat the write call's own success response as the guarantee (this codebase's own "independent read decides success" discipline, ADR 0041 §P3 rollback section and rule 73).
3. Trigger a fresh deploy/redeploy so the running instances actually pick up the new environment variable (Vercel environment variable changes do not retroactively affect already-running serverless instances).
4. Confirm activation by observing the audit log: the next `getBillingOverview` read against a genuinely drifted account/lot (if any exist) produces `credit_drift.repaired` or `credit_drift.repair_failed`, not silent `console.error` — and a read against an already-consistent account/lot changes nothing (matching Sprint B1's own "byte-for-byte identical" proof, now checked against live traffic instead of a one-off script).

## Rollback, if anything looks wrong post-activation

Follow ADR 0041 §P3's own rollback procedure exactly — unset `BILLING_REPAIR_ENABLED`, **read it back to confirm it is actually off**, redeploy old application code, and treat any future reactivation as a **fresh** Stage 3 drain proof, never a resumption of this one. Do not attempt an ad hoc fix (rule: never recompute/overwrite a cache directly — that is the exact failure mode this whole ADR exists to prevent).

## What this document is not

Not a sprint record — nothing here has run. Not a new architecture decision — every step is a direct execution of ADR 0041 §P3's already-approved rollout order; if any step here turns out to need a design change, that is a further ADR revision, not a silent deviation in this checklist. When Stage 0 actually happens, this document should be updated to reflect real dates/deployment IDs as each stage executes, and a genuine sprint record written once Stage 4 completes — matching this repository's existing sprint-record discipline for every other piece of ADR 0041's implementation.
