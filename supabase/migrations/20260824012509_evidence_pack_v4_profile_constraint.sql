-- ---------------------------------------------------------------------
-- business_readiness_audits: the v3 profile constraint learns v4
--
-- `business_readiness_audits_v3_has_profile` (migration 20260816020000)
-- requires the CORE-2 traceability columns for one pack version, named as a
-- literal:
--
--   evidence_pack_version <> 'business-evidence.v3'
--   or (product_profile_id is not null and ... )
--
-- That was correct when v3 was the only pack that carried a Product Profile,
-- and it deliberately used the pack version rather than a timestamp so it would
-- stay true regardless of when the migration ran. What it could not anticipate
-- is a *newer* pack: `business-evidence.v4` satisfies `<> 'business-evidence.v3'`,
-- so a v4 audit would be free to omit the profile entirely.
--
-- That matters beyond tidiness. `business-audit/pack-provenance.ts` recomputes
-- an audit's own `input_hash` to verify that a rebuilt evidence pack came from
-- the observations the audit reasoned from — the only check that can see the
-- Deep Scan, which has no column. It trusts these columns to be present for
-- every version in its `HASH_VERIFIABLE_PACKS` list, and v4 is now in it.
-- Without this migration that trust would rest on nothing the database
-- enforces.
--
-- Rewritten rather than added alongside: two overlapping constraints naming
-- different version sets is how one of them quietly stops being maintained.
-- The name is kept so the history stays greppable, even though it now covers
-- more than v3.
-- ---------------------------------------------------------------------

alter table public.business_readiness_audits
  drop constraint business_readiness_audits_v3_has_profile;

alter table public.business_readiness_audits
  add constraint business_readiness_audits_v3_has_profile
  check (
    evidence_pack_version not in ('business-evidence.v3', 'business-evidence.v4')
    or (
      product_profile_id is not null
      and product_profile_schema_version is not null
      and product_profile_builder_version is not null
      and founder_intent_hash is not null
    )
  );

comment on constraint business_readiness_audits_v3_has_profile
  on public.business_readiness_audits is
  'Every pack version that carries a Product Profile must record which one, and the founder intent hash. Named for v3 because that is where it started; it covers v4 too. Adding a version to pack-provenance.ts''s HASH_VERIFIABLE_PACKS means adding it here in the same change.';
