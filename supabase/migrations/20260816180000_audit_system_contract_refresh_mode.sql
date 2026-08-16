-- CORE-2a.2 — permit the system contract refresh access mode.
--
-- `20260816020000` fixed the CHECK at three values. CORE-2a.2 added a fourth in
-- TypeScript — `system_contract_refresh`, the mode that funds a replacement
-- audit Vibe owes the user because Vibe's own contract moved — and did not
-- extend the constraint. Every refresh therefore failed at INSERT, inside
-- `createAuditRun`, which reports a database error as the generic
-- `audit_failed`.
--
-- The first real refresh attempt failed exactly there: operation
-- `d139e089-…` at stage `preparing`, `inference_started_at` null, no usage
-- event. Nothing was billed and the entitlement was untouched, so the failure
-- was safe — but it was entirely self-inflicted.
--
-- This is the **third** time a TypeScript union and a SQL CHECK have drifted in
-- this repository. `src/modules/operations/migration-test-support.ts` exists
-- because of the first two, and its own header says so. It was not applied to
-- `access_mode`. The accompanying test now pins this constraint the same way,
-- so a fourth mode cannot be added in TypeScript alone.

alter table public.business_readiness_audits
  drop constraint business_readiness_audits_access_mode_check;

alter table public.business_readiness_audits
  add constraint business_readiness_audits_access_mode_check
  check (access_mode in (
    'included_first_audit',
    'credits',
    'legacy_pre_entitlement',
    -- Free to the customer, paid by us, and it neither spends nor restores the
    -- included entitlement (CORE-2a.2 §19).
    'system_contract_refresh'
  ));

comment on column public.business_readiness_audits.access_mode is
  'Entitlement that funded the audit. A completed row with ''included_first_audit'' IS the proof that the project''s free audit was consumed (CORE-2 §16). ''system_contract_refresh'' funds a replacement Vibe owed because its own audit contract moved, and never consumes or restores the entitlement (CORE-2a.2 §19). ''legacy_pre_entitlement'' marks rows written before the entitlement existed.';

-- The one-included-audit index is unaffected on purpose: it filters on
-- `access_mode = 'included_first_audit'`, so a refresh row is outside its
-- predicate and cannot collide with the audit whose place it takes.
