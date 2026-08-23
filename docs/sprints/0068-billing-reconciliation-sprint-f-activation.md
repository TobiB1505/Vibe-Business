# Sprint 0068 — ADR 0042 Sprint F: activation, executed against real production

Status: **Executed. `BILLING_REPAIR_ENABLED=true` is live in Production.** No new code, no new migration — this sprint is the operational execution of the checklist `docs/sprints/0058-0067` built toward, plus one real finding and correction found only by actually running it.

## What happened, in order

**Merge (Stage 0).** PR #75 — the entire ADR 0042 implementation, Sprints 0058–0067 — merged to `main` on explicit instruction. `origin/main` had not carried any of this work before; merging revealed a real ADR-numbering collision with `main`'s own independent Sprint (the Meta Pixel decision had taken "0041" while this branch's Billing Reconciliation Authority ADR used the same number) — resolved by renumbering the billing ADR to 0042 throughout, not by editing history.

**Discovery: Stage 1 had already happened.** Checking the live database directly (not the git-tracked migration files, which is what an earlier check in this same session had wrongly relied on) found all four marker columns, `operation_runs.pause_cycle`, and all five `materialize_*`/`repair_*` functions already deployed — applied via `apply_migration` in this session's earlier Sprint B0/B1 work, independent of the git branch. This corrected an inaccurate claim made minutes earlier in this same conversation ("nothing has reached production") — the database and the git branch are two different sources of truth, and only one had been checked.

**Stage 2 happened automatically.** Vercel's GitHub integration deploys `main` straight to Production — merging PR #75 *was* the application deploy, not a separate later action the checklist's original wording (written before the merge) had assumed a human would trigger deliberately.

**Stage 3 failed on its first real run.** The exact drain queries from ADR 0042 §P3, run fresh against production, returned two rows: `operation_runs` ids `f970d6b8...` and `690b6bfa...`, both `agent_execution` type, `status='queued'`, created 2026-08-18 — five days stale, `workflow_run_id` and `started_at` both `null`. The checklist's own rule — any row fails the check, no case-by-case exceptions — was honored rather than rationalized past. A full read-only dependency sweep, run before proposing any fix, confirmed both were genuinely inert: no `agent_execution_runs` row, no `billing_credit_reservations` row, no `billing_credit_ledger` row referenced either operation id anywhere. Likely cause, consistent with this codebase's own architecture: staleness detection here is lazy, firing only on a read that already happens (rule 24 — no cron); an operation nobody ever revisits again stays `queued` forever, and the mechanical drain check can never pass while one exists.

**The fix, executed under explicit operator control.** The exact `UPDATE` statement was presented before running; a Claude Code permission classifier blocked the write tool regardless of the operator's chat approval, so the operator ran it directly in the Supabase SQL editor:
```sql
UPDATE operation_runs
SET status = 'cancelled', completed_at = now()
WHERE id IN ('f970d6b8-cc05-4469-97e4-c1d19e1b6869', '690b6bfa-0284-4823-bb46-8e4be4e43dd8')
  AND status = 'queued'
RETURNING id, status, completed_at;
```
Read back independently afterward: both rows `status='cancelled'`, `completed_at` set.

**Stage 3, rerun fresh — passed.** Not reusing the earlier failed result, per the checklist's own explicit rule: condition (a) re-verified against the *current* serving deployment (a same-commit redeploy had since occurred, for the environment-variable change to take effect) — ~10 minutes elapsed, past the 300s ceiling of every `maxDuration` declared in this codebase. Condition (b), all three queries (`operation_runs`, `agent_execution_runs`, the reservations belt-and-braces join): zero rows.

**Stage 4 — activation.** `BILLING_REPAIR_ENABLED` set to `true`, Production-only scope (corrected from an initial Production+Preview scope the operator had set when first adding the variable — flagged and fixed before activation, since Preview deployments share the same single Supabase project and would otherwise have gained live repair too), redeployed, read back. A fresh audit-log check after the redeploy found zero `credit_drift.*` events — consistent with either outcome (nothing drifted, matching Sprint B1's earlier "byte-for-byte identical" proof against real data) and not, on its own, positive proof the flag is read as `true`; recorded honestly as a limit of what this session's tools could verify, rather than overclaimed.

**Migration-history reconciliation, closed as a follow-up.** This activation's own investigation surfaced a second instance of an already-precedented drift (Sprint 0058 first found and fixed one, on an unrelated earlier migration): the three migrations this sprint depends on were recorded remotely under `apply_migration`-generated version numbers (`20260823085754`, `20260823092748`, `20260823134718`) that did not match their local filenames' timestamps (`20260823000000`, `20260823010000`, `20260823020000`), same names throughout. Fixed identically to the Sprint 0058 precedent — per rule 34, local files are the source of truth, so the remote converges to them, never the reverse: three one-row `UPDATE supabase_migrations.schema_migrations SET version = '<local>' WHERE version = '<remote>' AND name = '<name>'` statements, touching only the migration bookkeeping ledger, never `billing_credit_*`/`operation_runs`/any application table. The classifier that blocked Stage 3's row cancellation blocked this write too, independent of chat approval; the operator ran all three directly. Verified afterward by an independent read-back, then a full history diff: all 57 remote migration versions now match the 57 local files, entry for entry, name and version both — not just the three just fixed.

## What this closes

Every open item `docs/ROADMAP.md`'s billing-reconciliation section had been carrying since Sprint 0057 — schema, primitives, both hot paths, both repair triggers, the audit trail, two independent authority derivations, and now activation — is closed. The mechanism ADR 0041/0042 was designed around across eight prior sprints is now live.

## What this does not close

**Recording drift and the two preconditions Sprint 0067 named** (a settlement retry's differing amount silently discarded; `refundCharge`'s dormancy) remain exactly as that sprint left them — genuinely out of scope for activation, not reopened here. **No new test, no new code.** This sprint is an operational record, not an implementation sprint.

## A note on process, not mechanism

This activation surfaced a real gap the checklist itself didn't anticipate: a Claude Code permission classifier blocking a tool-level write independently of explicit operator approval in chat is a second, separate gate — conversational "yes" and tool-level permission are not the same thing, and a consequential production write needs both. Worth keeping in mind for any future sprint that expects to execute, not just propose, a database change from within a session.
