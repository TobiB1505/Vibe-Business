-- ---------------------------------------------------------------------
-- business_readiness_audits: the profile constraint learns v5
--
-- The same change migration 20260824012509 made for v4, for the same reason
-- and under the instruction that migration's own comment left behind: adding
-- a version to `pack-provenance.ts`'s HASH_VERIFIABLE_PACKS means adding it
-- here in the same change. `business-evidence.v5` is now in that list, so
-- without this a v5 audit would satisfy `not in (v3, v4)` and be free to omit
-- the Product Profile that `verifyPackProvenance` depends on.
--
-- ## Why v5 exists
--
-- `buildIntelligenceCrossChecks` used to raise `payments-not-reachable` and
-- `pricing-not-reachable` from the repository's view alone, so a site whose
-- prices Vibe had *observed* was still reported as hiding them. The correction
-- **removes** contradiction ids rather than adding them, and every stored v4
-- audit cites `contradiction.payments_not_reachable` — so a rebuild that no
-- longer mints it drops the citation, and `opportunities/validate.ts` discards
-- an opportunity whose evidence cannot be verified. Three earlier sprints
-- declined a bump on the argument that a rebuild "mints nothing it never
-- cited"; the inverse does not hold.
--
-- ## What this migration is also cleaning up after
--
-- No row has ever carried `business-evidence.v4`. From 2026-08-24 the audit
-- *built* a v4 pack and *recorded* v3 — on the row and inside
-- `computeAuditInputHash` — so migration 20260824012509 has been guarding a
-- value nothing writes. Both versions stay named here anyway: they are what
-- stored rows and stored documents say, and a constraint that forgets a
-- version is how one stops being enforced.
--
-- Rewritten rather than added alongside, and the name is kept, for the reasons
-- 20260824012509 gives.
-- ---------------------------------------------------------------------

alter table public.business_readiness_audits
  drop constraint business_readiness_audits_v3_has_profile;

alter table public.business_readiness_audits
  add constraint business_readiness_audits_v3_has_profile
  check (
    evidence_pack_version not in (
      'business-evidence.v3',
      'business-evidence.v4',
      'business-evidence.v5'
    )
    or (
      product_profile_id is not null
      and product_profile_schema_version is not null
      and product_profile_builder_version is not null
      and founder_intent_hash is not null
    )
  );

comment on constraint business_readiness_audits_v3_has_profile
  on public.business_readiness_audits is
  'Every pack version that carries a Product Profile must record which one, and the founder intent hash. Named for v3 because that is where it started; it covers v4 and v5 too. Adding a version to pack-provenance.ts''s HASH_VERIFIABLE_PACKS means adding it here in the same change.';
