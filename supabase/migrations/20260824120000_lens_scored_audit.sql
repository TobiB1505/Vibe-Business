-- Lens-scored audits (ADR 0050).
--
-- The overall score is now the mean over scored business lenses, so a
-- completed audit records its lens coverage: how many lenses carried a
-- score, and how many were eligible to (nine minus the ones the audit
-- itself judged not_material). The five-dimension columns stay untouched —
-- rows written under contracts v6/v7 keep their recorded coverage, and
-- rule 60 forbids invalidating a paid result.
--
-- Deliberately NO cross-check that assessed_lenses <= eligible_lenses:
-- a lens the model scored and also marked not_material counts in the
-- numerator but not in the denominator (ADR 0050 §3), so the "excess" is
-- legitimate and constraining it away would corrupt honest data.

alter table public.business_readiness_audits
  add column assessed_lenses smallint
    check (assessed_lenses is null or assessed_lenses between 0 and 9),
  add column eligible_lenses smallint
    check (eligible_lenses is null or eligible_lenses between 0 and 9);

comment on column public.business_readiness_audits.assessed_lenses is
  'Lenses that carried a validated score in this audit. Null on rows written before ADR 0050 and on non-completed rows.';
comment on column public.business_readiness_audits.eligible_lenses is
  'Lenses eligible for scoring: nine minus the ones this audit marked not_material. The coverage denominator (ADR 0050).';

-- A completed audit must carry its result and its coverage verdict — from
-- either generation. Old completed rows recorded assessed_dimensions; new
-- ones record assessed_lenses. Neither generation may record both nulls.
alter table public.business_readiness_audits
  drop constraint business_readiness_audits_completed_has_result;

alter table public.business_readiness_audits
  add constraint business_readiness_audits_completed_has_result
    check (
      status <> 'completed'
      or (result is not null and (assessed_dimensions is not null or assessed_lenses is not null))
    );

comment on column public.business_readiness_audits.overall_score is
  'Computed deterministically by the application. Since ADR 0050 the mean over scored lenses; before, over scored dimensions. Null means coverage was insufficient, NOT a score of zero.';
