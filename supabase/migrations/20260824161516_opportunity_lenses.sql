-- Opportunities attribute to business lenses (ADR 0050 §5).
--
-- The Opportunity Engine now names the business lens each Move most belongs
-- to, in the audit's own nine-lens vocabulary. Rows written before
-- business-opportunity.v3 keep their recorded dimension attribution — it is a
-- record, and it is not translated into a lens it never asserted.

alter table public.business_opportunities
  add column primary_lens text
    check (primary_lens is null or primary_lens in (
      'offer', 'audience', 'revenue_economics', 'acquisition', 'conversion',
      'retention', 'measurement', 'business_readiness', 'scalability'
    )),
  add column secondary_lenses jsonb not null default '[]'::jsonb;

comment on column public.business_opportunities.primary_lens is
  'The business lens this Move most belongs to (ADR 0050 §5). Null on rows written before business-opportunity.v3, which recorded a dimension instead.';

-- The dimension columns stay for the rows that carry them, but a new row no
-- longer writes one. The existing IN check already passes on null (unknown),
-- so only the NOT NULL has to go.
alter table public.business_opportunities
  alter column primary_dimension drop not null;

-- Every Move carries exactly one generation's attribution. Neither-null-nor
-- would be a row that answers "which part of the business is this about?"
-- with nothing, which no writer has ever produced.
alter table public.business_opportunities
  add constraint business_opportunities_has_attribution
    check (primary_dimension is not null or primary_lens is not null);
