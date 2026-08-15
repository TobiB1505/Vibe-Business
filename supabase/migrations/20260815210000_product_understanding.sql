-- CORE-1: Product Understanding Layer.
-- See docs/sprints/0015-core1-product-understanding.md.
--
-- Two tables and one widened enum:
--   product_profiles              what Vibe believes this product is
--   product_profile_corrections   what the user said Vibe got wrong
--
-- The split between them is the whole point of the schema. A profile is
-- *derived* and is replaced wholesale whenever the evidence moves. A
-- correction is *authored* by a person and must outlive every re-scan, so it
-- cannot live inside the thing that gets replaced (CORE-1 §25).
--
-- Deliberately absent: no prompt text, no raw model responses, no reasoning
-- traces, no copy of any repository or page, no image bytes. Brand assets are
-- stored as references — a repository path or an origin-relative URL — never
-- as files (CORE-1 §39).

-- ---------------------------------------------------------------------
-- Operation type and stages
--
-- Read from the live constraints as they stand after 20260815120000, not
-- inferred from the TypeScript unions. `schema.test.ts` pins the two
-- representations together, which is how this project stopped shipping
-- operation types that failed at INSERT.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview', 'preview_teardown', 'change_review', 'change_merge',
    'change_outcome_verification', 'business_measurement',
    -- Understanding what a product is, before anything is judged (CORE-1 §22).
    'product_understanding'
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
    'collecting_baseline', 'collecting_post', 'comparing',
    -- Product Understanding (CORE-1 §27). Named for what a waiting user is
    -- told is happening, because this is the one flow whose loading screen is
    -- part of the product rather than an apology for latency.
    'reading_code', 'reading_public_product', 'understanding_product',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- product_profiles
--
-- The derived half. One row per successful (or failed) derivation, so the
-- history of what Vibe believed and when is preserved rather than overwritten
-- — the first piece of the product memory CORE-1 §38 describes.
-- ---------------------------------------------------------------------
create table public.product_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Exactly which evidence produced this profile. Nullable, unlike the audit's:
  -- a profile built from code alone is a legitimate partial result, not a
  -- failure (CORE-1 §43). Restrict rather than cascade — deleting a snapshot a
  -- profile was derived from would make the profile unexplainable.
  repository_snapshot_id uuid
    references public.repository_intelligence_snapshots (id) on delete restrict,
  live_snapshot_id uuid
    references public.live_product_intelligence_snapshots (id) on delete restrict,
  authenticated_snapshot_id uuid
    references public.authenticated_product_intelligence_snapshots (id) on delete restrict,

  -- Reproducibility set. A profile is only comparable to another if every one
  -- of these matches. `prompt_version`, `provider` and `model` are null for a
  -- profile derived with no model at all, which is a real and supported state.
  schema_version text not null check (char_length(btrim(schema_version)) > 0),
  builder_version text not null check (char_length(btrim(builder_version)) > 0),
  evidence_version text not null check (char_length(btrim(evidence_version)) > 0),
  prompt_version text,
  provider text,
  model text,

  -- Digest of everything above plus the snapshot ids. The reuse key: an
  -- identical input hash means an identical profile, and paying for it twice
  -- is pure waste (CLAUDE.md rule 48).
  input_hash text not null check (char_length(input_hash) = 64),

  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'completed', 'failed')),

  -- The validated `product-profile.v1` document. Null until the run completes.
  result jsonb,

  -- Whether the paid synthesis step succeeded. False on a completed row means
  -- the deterministic profile stood in for it — which the UI must be able to
  -- say out loud rather than pretending the model ran.
  synthesized boolean not null default false,

  -- Typed failure code only, never a raw provider error.
  failure_code text,

  -- Set when a person looked at THIS profile and said yes (CORE-1 §23).
  -- Bound to the row, not to the project: a confirmation is about one specific
  -- thing Vibe said, and a later re-derivation has not been confirmed by
  -- anyone (ADR 0018's rule, applied to a much smaller decision).
  confirmed_at timestamptz,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed profile must carry its result.
  constraint product_profiles_completed_has_result
    check (status <> 'completed' or result is not null),

  -- Nothing may be confirmed that was never completed.
  constraint product_profiles_confirmed_is_completed
    check (confirmed_at is null or status = 'completed'),

  -- A profile derived with a model must say which one, and one derived
  -- without must not claim a prompt version it never used.
  constraint product_profiles_synthesis_is_attributed
    check (
      (synthesized = false and prompt_version is null and model is null)
      or (synthesized = true and prompt_version is not null and model is not null)
    )
);

comment on table public.product_profiles is
  'What Vibe believes a product is. Validated structured conclusions only — never prompts, raw responses, model reasoning, or copies of customer code or pages.';

comment on column public.product_profiles.confirmed_at is
  'Set when a person confirmed THIS profile. Never carried forward to a later derivation.';

comment on column public.product_profiles.synthesized is
  'False means the deterministic layer produced this profile alone, because the model call failed or was never made. It is not a degraded profile, but it is a different one.';

-- Latest-profile lookup for the understanding screen.
create index product_profiles_project_created_idx
  on public.product_profiles (project_id, created_at desc);

-- Reuse lookup: identical input means an identical profile.
create index product_profiles_reuse_idx
  on public.product_profiles (project_id, input_hash, status);

-- Concurrency guard: at most one in-flight derivation per project + input, so
-- a double-clicked "check again" fails the second insert at the database
-- rather than buying a second inference call.
create unique index product_profiles_single_in_flight_idx
  on public.product_profiles (project_id, input_hash)
  where status in ('pending', 'analyzing');

alter table public.product_profiles enable row level security;

create trigger set_updated_at
  before update on public.product_profiles
  for each row execute function public.set_updated_at();

create policy "select own product_profiles"
  on public.product_profiles
  for select using (
    exists (select 1 from public.projects p where p.id = product_profiles.project_id and p.user_id = auth.uid())
  );

create policy "insert own product_profiles"
  on public.product_profiles
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own product_profiles"
  on public.product_profiles
  for update using (
    exists (select 1 from public.projects p where p.id = product_profiles.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own product_profiles"
  on public.product_profiles
  for delete using (
    exists (select 1 from public.projects p where p.id = product_profiles.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- product_profile_corrections
--
-- The authored half. One row per project, holding only the fields a person
-- actually rewrote (CORE-1 §24).
--
-- Project-scoped rather than profile-scoped, and that is the design decision
-- this table exists to express: a correction is a statement about the
-- *product*, not about one derivation of it. Scoping it to a profile id would
-- mean every re-scan silently discards what the founder told us, which is
-- precisely the failure CORE-1 §25 names.
-- ---------------------------------------------------------------------
create table public.product_profile_corrections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Sparse: an absent key means "not corrected", which is different from a key
  -- set to an empty string. Field names are validated in application code
  -- against a closed list; the bound here exists so a pasted document cannot
  -- become the profile.
  corrections jsonb not null default '{}'::jsonb,

  constraint product_profile_corrections_is_object
    check (jsonb_typeof(corrections) = 'object'),
  constraint product_profile_corrections_bounded
    check (char_length(corrections::text) <= 8000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_profile_corrections_project_key unique (project_id)
);

comment on table public.product_profile_corrections is
  'What a person said Vibe got wrong about their product. Outranks every derived source and survives every re-scan. Free text here is untrusted DATA, never instructions.';

alter table public.product_profile_corrections enable row level security;

create trigger set_updated_at
  before update on public.product_profile_corrections
  for each row execute function public.set_updated_at();

create policy "select own product_profile_corrections"
  on public.product_profile_corrections
  for select using (
    exists (select 1 from public.projects p where p.id = product_profile_corrections.project_id and p.user_id = auth.uid())
  );

create policy "insert own product_profile_corrections"
  on public.product_profile_corrections
  for insert with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own product_profile_corrections"
  on public.product_profile_corrections
  for update using (
    exists (select 1 from public.projects p where p.id = product_profile_corrections.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own product_profile_corrections"
  on public.product_profile_corrections
  for delete using (
    exists (select 1 from public.projects p where p.id = product_profile_corrections.project_id and p.user_id = auth.uid())
  );
