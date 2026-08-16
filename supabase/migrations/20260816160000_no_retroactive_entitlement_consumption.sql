-- CORE-2 — correct the entitlement backfill.
--
-- 20260816020000 marked the earliest completed audit per project as
-- `included_first_audit`, on the reasoning that "those projects have already
-- had a free audit, so recording that is accurate".
--
-- That reasoning was wrong, and the dogfood made it obvious: the owner could
-- not run the first v3 audit on their own product, because a run from five days
-- *before the entitlement existed* had been retroactively counted against it.
--
-- The free audit is a CORE-2 promise introduced with this sprint. At the time
-- those audits ran, the audit was ungated and freely repeatable — one project
-- has ten of them. Nobody has been *offered* the free audit yet, so nobody can
-- have consumed it. Introducing an entitlement by retroactively billing
-- existing usage against it is not how an entitlement is introduced.
--
-- Compare the Deep Scan (20260811190000), which did default existing rows to
-- `included_first_scan` — correctly, because that entitlement shipped *with*
-- the feature and there was no prior usage to mislabel. The audit's situation is
-- the opposite, and copying the pattern without checking that is what caused
-- this.
--
-- So: every pre-CORE-2 audit becomes `legacy_pre_entitlement`, and every
-- existing project keeps its CORE-2 free audit unspent.

-- ---------------------------------------------------------------------
-- 1. Reclassify.
--
-- Identified by evidence pack version rather than by date: a v1 or v2 pack is,
-- by construction, an audit produced before this sprint's contract existed.
-- That stays true regardless of when this migration runs, and it cannot
-- accidentally catch a genuine post-CORE-2 run.
-- ---------------------------------------------------------------------
update public.business_readiness_audits
set access_mode = 'legacy_pre_entitlement'
where access_mode = 'included_first_audit'
  and evidence_pack_version <> 'business-evidence.v3';

-- ---------------------------------------------------------------------
-- 2. Drop the grants derived from those rows.
--
-- The durable half was backfilled from exactly the audits reclassified above,
-- so leaving it would keep the entitlement consumed through the other half and
-- make step 1 pointless — the two signals are OR-ed on purpose.
--
-- Scoped to grants whose audit is now legacy, and to grants whose audit row is
-- gone entirely (`audit_id is null`), which is what a project deletion leaves
-- behind. A grant earned by a real v3 audit is untouched.
-- ---------------------------------------------------------------------
delete from public.free_audit_grants g
where g.audit_id is null
   or exists (
     select 1 from public.business_readiness_audits a
     where a.id = g.audit_id
       and a.access_mode = 'legacy_pre_entitlement'
   );
