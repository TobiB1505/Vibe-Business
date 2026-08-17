-- CORE-2 — close the gap the first dogfood found.
--
-- The one-included-audit index created in 20260816020000 covers `completed`
-- rows only. That made the entitlement enforceable at the wrong moment: a
-- second free audit could be claimed, could run, could pay for inference, and
-- only failed when `completeAuditRun` tried to set status = 'completed' and hit
-- the index — at stage `persisting`, with the money already spent.
--
-- That is exactly what happened on the first real run: operation
-- `dac026a9-…` failed at `persisting` with `audit_failed`, leaving audit
-- `5a4eea6f-…` stranded in `analyzing`, after a billed model call.
--
-- The application now refuses at the start, in `startBusinessAuditOperation`.
-- This is the half that does not depend on remembering to call it: widening the
-- predicate to in-flight rows moves the collision from *after* inference to the
-- INSERT that claims the run, which happens before a single token is counted.
--
-- ## Order matters, and the first attempt got it wrong
--
-- Creating the widened index before releasing the stranded row failed outright:
--
--   ERROR: could not create unique index … (SQLSTATE 23505)
--   Key (project_id)=(b95779dc-…) is duplicated.
--
-- because that project has both a completed included audit and the stranded
-- `analyzing` one, and the wider predicate covers both. The transaction rolled
-- back cleanly and nothing was left half-applied — but it is the same mistake
-- as the `access_mode` default in 20260816020000: **constrain the data only
-- after the data satisfies the constraint.** Repair first, then enforce.

-- ---------------------------------------------------------------------
-- 1. Release rows stranded by that failure.
--
-- `5a4eea6f-…` sits in `analyzing` with no result and no failure code, because
-- the exception happened inside the completion UPDATE rather than being
-- returned as an outcome, so nothing ever marked the row. Its operation is
-- already `failed`.
--
-- Targeted by the conditions that describe a stranded row — in flight, no
-- result, and an owning operation that already failed — rather than by id, so
-- this is a no-op on any database where it did not happen.
-- ---------------------------------------------------------------------
update public.business_readiness_audits a
set status = 'failed',
    failure_code = coalesce(a.failure_code, 'audit_failed'),
    completed_at = coalesce(a.completed_at, now())
where a.status in ('pending', 'analyzing')
  and a.result is null
  and exists (
    select 1 from public.operation_runs o
    where o.result_id = a.id
      and o.operation_type = 'business_audit'
      and o.status = 'failed'
  );

-- ---------------------------------------------------------------------
-- 2. Now widen the index, against data that satisfies it.
--
-- A failed row is deliberately still excluded. An audit that failed consumed
-- nothing (CORE-2 §17), so it must not stand in the way of the retry it is
-- supposed to allow — which is also what makes step 1 sufficient rather than
-- merely tidy.
-- ---------------------------------------------------------------------
drop index if exists public.business_readiness_audits_one_included_idx;

create unique index business_readiness_audits_one_included_idx
  on public.business_readiness_audits (project_id)
  where access_mode = 'included_first_audit'
    and status in ('pending', 'analyzing', 'completed');

comment on index public.business_readiness_audits_one_included_idx is
  'At most one included-entitlement audit per project that is in flight or completed. Covers in-flight rows so a second free audit collides at the claim, before inference is paid for — not at completion, after (CORE-2 §16).';
