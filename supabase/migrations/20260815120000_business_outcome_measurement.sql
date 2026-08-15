-- Sprint 12B — Business outcome measurement foundation.
--
-- The third and last question in the trust loop, and the only one Vibe cannot
-- answer by looking at something it controls:
--
--   DELIVERY          the default branch moved                    Sprint 11C
--   PRODUCT OUTCOME   the intended behaviour appeared publicly    Sprint 12A
--   BUSINESS OUTCOME  the metric it was meant to move, moved      here
--
-- Two tables, and the split matters. A MeasurementPlan is *what we would
-- measure* — deterministic, free, and knowable the moment a change is merged. A
-- BusinessOutcomeMeasurement is *what was actually observed*, which needs a
-- connected data source, two elapsed windows and enough traffic to mean
-- anything. Collapsing them would make "we know what to watch" and "we watched
-- it" the same row, and the product could then never say the first without
-- implying the second.
--
-- Deliberately NOT stored here: OAuth tokens, refresh tokens, API keys, vendor
-- account identifiers, or raw analytics payloads. Provenance says *where a
-- number came from*; it is not a credential store, and an analytics response
-- routinely carries per-user data that has no business in this schema (§18).

-- ---------------------------------------------------------------------
-- Operation type and stages
--
-- Read from the LIVE constraints before this file was written, not inferred
-- from the TypeScript unions: the deployed CHECK listed nine operation types
-- and thirty-four stages, and included neither `business_measurement` nor
-- `collecting_baseline`/`collecting_post`/`comparing`. That gap is the one that
-- failed every real run at INSERT in Sprints 9, 10B, 11A and 11C.
-- `schema.test.ts` pins both representations together from here on.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview', 'preview_teardown', 'change_review', 'change_merge',
    'change_outcome_verification',
    -- Measuring a business metric across two elapsed windows (Sprint 12B §30).
    'business_measurement'
  ));

alter table public.operation_runs
  drop constraint operation_runs_stage_check;

alter table public.operation_runs
  add constraint operation_runs_stage_check
  check (stage in (
    'preparing', 'counting_tokens', 'running_ai', 'prioritizing', 'validating', 'persisting',
    'preflight', 'generating_change', 'writing_repository', 'verifying_repository',
    'provisioning', 'acquiring_source', 'verifying_source', 'securing_sandbox',
    'installing', 'typechecking', 'testing', 'building', 'collecting_results', 'cleaning_up',
    'restoring_artifact', 'verifying_artifact', 'starting_server', 'checking_preview',
    'capturing_before', 'capturing_after', 'persisting_artifacts',
    'authorizing', 'writing_default_ref', 'verifying_default_ref', 'converging',
    'observing', 'evaluating',
    -- Business measurement (Sprint 12B §30). Named for the two halves of the
    -- comparison, because "collecting" alone would leave a user unable to tell
    -- whether the slow part is the historical read or the recent one.
    'collecting_baseline', 'collecting_post', 'comparing',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- measurement_plans
--
-- What would be measured. Costs nothing to produce and needs no connected
-- source, which is exactly why it is a separate table: a project with no
-- analytics can still be told, truthfully and for free, what Vibe would watch.
-- ---------------------------------------------------------------------
create table public.measurement_plans (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,
  -- `restrict`: a plan that cannot say which merge it is about documents
  -- nothing, and there is no delete path for merges through the product.
  change_merge_id uuid not null references public.change_merges (id) on delete restrict,

  -- Stated in the founder's terms, derived from the project's *structured*
  -- context — never from free text a user typed, which would put arbitrary
  -- prose into a stored plan.
  business_goal text not null check (char_length(btrim(business_goal)) > 0),

  -- The one metric the result is stated in. Enumerated, because an unknown
  -- metric key has no direction and no minimums, and a measurement of it could
  -- not be classified at all.
  primary_metric text not null
    check (primary_metric in ('search_impressions', 'search_clicks', 'organic_sessions')),
  -- Context only. Never used to classify a result (§15).
  secondary_metrics text[] not null default '{}',

  -- **Not every metric should go up** (§5). A stored plan that could not say
  -- which way is better would be a plan whose result depends on who reads it.
  metric_direction text not null
    check (metric_direction in ('higher_is_better', 'lower_is_better', 'target_range')),
  metric_category text not null
    check (metric_category in (
      'traffic', 'conversion', 'activation', 'revenue', 'retention', 'search_visibility'
    )),
  -- Vendor-neutral kinds, never a vendor name (§6).
  compatible_source_kinds text[] not null default '{}',

  -- Whole calendar days. Bounded so a plan cannot describe a window nobody
  -- would live long enough to see close.
  baseline_days integer not null check (baseline_days between 1 and 180),
  measurement_days integer not null check (measurement_days between 1 and 180),
  -- Days after the merge before the post-window opens. Zero is valid for a
  -- capability whose effect is immediate; the SEO profile uses 14 (§9, §13).
  settling_days integer not null default 0 check (settling_days between 0 and 90),
  minimum_observations integer not null check (minimum_observations >= 0),

  measurement_profile text not null check (char_length(btrim(measurement_profile)) > 0),
  measurement_profile_version text not null check (char_length(btrim(measurement_profile_version)) > 0),
  -- Deliberately NOT enumerated, matching every other policy version in this
  -- schema: a CHECK listing versions turns a bump into a migration, and a
  -- forgotten one fails only at INSERT.
  measurement_policy_version text not null check (char_length(btrim(measurement_policy_version)) > 0),

  status text not null default 'ready' check (status in ('ready', 'unsupported')),
  unsupported_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An unsupported plan must say why, and a ready one must not pretend to.
  constraint measurement_plans_unsupported_has_reason
    check (
      (status = 'unsupported' and unsupported_reason is not null)
      or (status = 'ready' and unsupported_reason is null)
    )
);

comment on table public.measurement_plans is
  'What Vibe would measure to tell whether a merged change moved the business metric it was meant to move. Deterministic, free, and independent of whether any analytics source is connected.';

-- One plan per merged change. A second plan for the same merge would be a
-- second opinion about what the change was for, and the product would have no
-- basis for choosing between them.
create unique index measurement_plans_merge_idx
  on public.measurement_plans (project_id, change_merge_id);

create index measurement_plans_prepared_change_idx
  on public.measurement_plans (prepared_change_id, created_at desc);

alter table public.measurement_plans enable row level security;

create trigger set_updated_at
  before update on public.measurement_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- business_outcome_measurements
--
-- What was actually observed. Immutable once terminal: a measurement is a
-- statement about a period that has already happened, and recomputing it later
-- under different rules would make every historical record unreadable (§12).
-- ---------------------------------------------------------------------
create table public.business_outcome_measurements (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  measurement_plan_id uuid not null references public.measurement_plans (id) on delete cascade,
  change_merge_id uuid not null references public.change_merges (id) on delete restrict,

  metric_key text not null
    check (metric_key in ('search_impressions', 'search_clicks', 'organic_sessions')),
  metric_direction text not null
    check (metric_direction in ('higher_is_better', 'lower_is_better', 'target_range')),
  metric_aggregation text not null check (metric_aggregation in ('sum', 'mean', 'rate')),

  -- Null until a source is connected and chosen. Vendor-neutral (§6).
  -- Nullable, and the CHECK says so by omission rather than by an explicit
  -- `is null or`: a CHECK whose expression evaluates to NULL passes in
  -- Postgres, so the extra clause was redundant — and it hid the enum from the
  -- contract test that pins this column against the TypeScript union.
  metric_source_kind text
    check (metric_source_kind in (
      'search_console', 'web_analytics', 'product_analytics', 'billing', 'first_party'
    )),

  -- **Both windows, explicit and immutable** (§11, §13, §42).
  --
  -- Written once when the measurement is created and never recomputed. A
  -- baseline re-derived at read time changes a historical result as the
  -- calendar advances, which is the single most misleading thing this table
  -- could do.
  baseline_start timestamptz not null,
  baseline_end timestamptz not null,
  measurement_start timestamptz not null,
  measurement_end timestamptz not null,
  -- Never implicit, never the server's locale (§32).
  measurement_timezone text not null check (char_length(btrim(measurement_timezone)) > 0),

  -- Null until collected. **Never defaulted to zero** — a missing value and a
  -- measured zero are different facts, and a default would make an outage look
  -- like a collapse in the customer's traffic.
  baseline_value double precision,
  observed_value double precision,
  observed_absolute_change double precision,
  observed_relative_change double precision,

  sample_size_before integer check (sample_size_before >= 0),
  sample_size_after integer check (sample_size_after >= 0),

  -- Not success/failure. Five of these are states of the world rather than
  -- results, and the product renders each as a different sentence (§20).
  status text not null default 'waiting_for_source'
    check (status in (
      'waiting_for_source', 'waiting_for_window', 'measuring',
      'improved', 'degraded', 'neutral', 'insufficient_data', 'failed'
    )),
  data_quality text
    check (data_quality in ('complete', 'partial', 'insufficient', 'source_error')),
  failure_code text,

  -- Where every number came from. Bounded derived provenance only — never a
  -- token, never a vendor account id, never a raw payload (§18).
  provenance jsonb not null default '[]'::jsonb,

  measurement_policy_version text not null check (char_length(btrim(measurement_policy_version)) > 0),
  measurement_profile_version text not null check (char_length(btrim(measurement_profile_version)) > 0),
  evidence_schema_version text not null check (char_length(btrim(evidence_schema_version)) > 0),

  -- sha256 over project + merge + plan + metric + windows + policy version.
  measurement_identity text not null check (char_length(measurement_identity) = 64),

  operation_run_id uuid references public.operation_runs (id) on delete set null,

  -- **The scheduling contract, as data rather than as a running process** (§30).
  --
  -- A measurement is *due* when this instant has passed. Whatever eventually
  -- resumes due measurements — a page visit, an explicit action, or a scheduled
  -- runner that does not exist in this architecture yet — reads this column and
  -- needs to know nothing about windows. See ADR 0021.
  next_observation_at timestamptz,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- **A stated result must carry the numbers that produced it.**
  --
  -- The most important constraint in this file. Classification lives in
  -- application code, and application code is exactly what this project has
  -- repeatedly watched be right and still not run. Here the database refuses an
  -- `improved`, `degraded` or `neutral` row that has no baseline, no observed
  -- value, no sample sizes and no provenance — so a mutation that skips
  -- collection entirely cannot store a green result (§37, §46).
  constraint business_measurement_result_has_values
    check (
      status not in ('improved', 'degraded', 'neutral')
      or (
        baseline_value is not null
        and observed_value is not null
        and sample_size_before is not null
        and sample_size_after is not null
        and data_quality is not null
        and completed_at is not null
        and failure_code is null
        and jsonb_array_length(provenance) > 0
      )
    ),

  -- `insufficient_data` is an honest non-result and must still say it looked.
  constraint business_measurement_insufficient_has_quality
    check (
      status <> 'insufficient_data'
      or (data_quality is not null and completed_at is not null)
    ),

  -- `failed` is the one terminal state about Vibe rather than the business, and
  -- it is the only one that may exist with no numbers at all — but it must say
  -- why (§33).
  constraint business_measurement_failed_has_reason
    check (status <> 'failed' or (failure_code is not null and completed_at is not null)),

  -- A measurement in flight has not concluded.
  constraint business_measurement_in_flight_is_not_concluded
    check (
      status not in ('waiting_for_source', 'waiting_for_window', 'measuring')
      or completed_at is null
    ),

  -- **The two windows must be real, and must not overlap** (§42).
  --
  -- An overlap silently compares part of a period against itself and biases
  -- every result toward "no change". Enforced from below because it is the kind
  -- of arithmetic mistake that reads as correct.
  constraint business_measurement_windows_are_ordered
    check (baseline_end > baseline_start and measurement_end > measurement_start),
  constraint business_measurement_windows_do_not_overlap
    check (measurement_start >= baseline_end)
);

comment on table public.business_outcome_measurements is
  'One observed comparison of one metric across a baseline and a post-change window. "improved" means the metric moved in the better direction between two defined periods — never that this change caused it.';

comment on column public.business_outcome_measurements.observed_relative_change is
  'Observed, not caused. No control group exists, so no causal claim is available (Sprint 12B §10).';

comment on column public.business_outcome_measurements.next_observation_at is
  'When this measurement becomes due. The scheduling contract is data, not a running process (Sprint 12B §30, ADR 0021).';

comment on column public.business_outcome_measurements.provenance is
  'Bounded derived provenance only: source kind, adapter, metric, window, days returned, retrieved_at. Never a token or a raw payload (Sprint 12B §18).';

-- **One live measurement per exact question** (§35).
--
-- Covers every state except `failed`, for the reason the outcome verification
-- index excludes it: `failed` is where a Vibe-side problem lands — the source
-- was unreachable, the operation could not be enqueued — and a lock with no
-- release would block that measurement forever with no way to clear it through
-- the product.
create unique index business_measurements_identity_idx
  on public.business_outcome_measurements (project_id, measurement_identity)
  where status in (
    'waiting_for_source', 'waiting_for_window', 'measuring',
    'improved', 'degraded', 'neutral', 'insufficient_data'
  );

create index business_measurements_plan_idx
  on public.business_outcome_measurements (measurement_plan_id, created_at desc);

create index business_measurements_merge_idx
  on public.business_outcome_measurements (change_merge_id, created_at desc);

create index business_measurements_operation_idx
  on public.business_outcome_measurements (operation_run_id);

-- The due-work index. Ordered so that "which measurements are actionable now?"
-- is a range scan rather than a table scan, whenever something is finally in a
-- position to ask.
create index business_measurements_due_idx
  on public.business_outcome_measurements (next_observation_at)
  where status in ('waiting_for_source', 'waiting_for_window', 'measuring');

alter table public.business_outcome_measurements enable row level security;

create trigger set_updated_at
  before update on public.business_outcome_measurements
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- The same split the merge and outcome tables use (§37, §38).
--
--   INSERT  a human may *request* a plan and a measurement of something merged.
--   UPDATE  nobody may, through the product. There is no update policy on
--           either table, so every authoritative value — the baseline, the
--           observed value, the relative change, the classification, the sample
--           sizes, the timestamps — can only be written by the service-role
--           client that durable execution holds.
--   DELETE  nobody, ever.
--
-- So a caller holding nothing but an authenticated anon-key token cannot forge
-- `improved`, cannot invent a baseline, cannot claim a sample size and cannot
-- attach itself to somebody else's operation. Not because a code path
-- declined — because no policy permits the statement (§44).
--
-- Every reference to the new row is qualified. Unqualified would be a guess
-- about scope: `change_merge_id` and `prepared_change_id` exist on several
-- tables, so inside a subquery a bare name binds to the inner table and the
-- check silently passes for the wrong row. Migration 20260814101000 is that
-- lesson learned expensively.
-- ---------------------------------------------------------------------
create policy "select own measurement_plans"
  on public.measurement_plans
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = measurement_plans.project_id and p.user_id = auth.uid()
    )
  );

create policy "insert own measurement_plans"
  on public.measurement_plans
  for insert with check (
    measurement_plans.user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = measurement_plans.project_id and p.user_id = auth.uid()
    )
    -- A **merged** merge, whose read-back head is the approved commit. A plan
    -- for something that never shipped would be measuring a change the public
    -- product never received (§37).
    and exists (
      select 1 from public.change_merges cm
      where cm.id = measurement_plans.change_merge_id
        and cm.project_id = measurement_plans.project_id
        and cm.prepared_change_id = measurement_plans.prepared_change_id
        and cm.status = 'merged'
        and cm.resulting_default_head_sha = cm.prepared_commit_sha
    )
  );

create policy "select own business_outcome_measurements"
  on public.business_outcome_measurements
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = business_outcome_measurements.project_id and p.user_id = auth.uid()
    )
  );

create policy "insert own business_outcome_measurements"
  on public.business_outcome_measurements
  for insert with check (
    business_outcome_measurements.user_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = business_outcome_measurements.project_id and p.user_id = auth.uid()
    )
    -- The plan must be this project's, be `ready`, and name this exact metric.
    -- A client cannot open a measurement of a metric nobody planned (§44).
    and exists (
      select 1 from public.measurement_plans mp
      where mp.id = business_outcome_measurements.measurement_plan_id
        and mp.project_id = business_outcome_measurements.project_id
        and mp.change_merge_id = business_outcome_measurements.change_merge_id
        and mp.status = 'ready'
        and mp.primary_metric = business_outcome_measurements.metric_key
        and mp.metric_direction = business_outcome_measurements.metric_direction
    )
    and exists (
      select 1 from public.operation_runs orn
      where orn.id = business_outcome_measurements.operation_run_id
        and orn.project_id = business_outcome_measurements.project_id
        and orn.user_id = auth.uid()
        and orn.operation_type = 'business_measurement'
    )
    -- A requested measurement has observed nothing and concluded nothing. The
    -- client cannot open a row that already claims a result (§44).
    and business_outcome_measurements.status in ('waiting_for_source', 'waiting_for_window')
    and business_outcome_measurements.baseline_value is null
    and business_outcome_measurements.observed_value is null
    and business_outcome_measurements.observed_absolute_change is null
    and business_outcome_measurements.observed_relative_change is null
    and business_outcome_measurements.sample_size_before is null
    and business_outcome_measurements.sample_size_after is null
    and business_outcome_measurements.data_quality is null
    and business_outcome_measurements.failure_code is null
    and business_outcome_measurements.completed_at is null
    and business_outcome_measurements.provenance = '[]'::jsonb
  );

-- No update policy and no delete policy on either table, deliberately.
