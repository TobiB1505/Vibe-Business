-- Sprint 11A — Before/After visual review.
--
-- A ReviewArtifact is two screenshots and the metadata needed to say what they
-- are: the public live product as observed at a timestamp, and the exact
-- running preview of one prepared change, captured under one pinned policy.
--
-- It proves only that a controlled comparison was produced. Not that the change
-- is good, that design improved, that SEO is correct, that anyone approved it,
-- or that a merge is safe. See ADR 0017.
--
-- Deliberately NOT stored here: screenshot bytes (object storage), page HTML,
-- DOM, cookies, capability URLs, signed URLs, browser credentials.

-- ---------------------------------------------------------------------
-- Operation type and stages
--
-- Checked against the live constraint before writing this file, not inferred
-- from TypeScript. The deployed CHECK listed six operation types and did not
-- include 'change_review' — the same gap that would have failed every real run
-- at INSERT in Sprint 9 and again in 10B. `schema.test.ts` pins the two
-- representations together.
-- ---------------------------------------------------------------------
alter table public.operation_runs
  drop constraint operation_runs_operation_type_check;

alter table public.operation_runs
  add constraint operation_runs_operation_type_check
  check (operation_type in (
    'business_audit', 'opportunity_generation', 'change_preparation', 'change_validation',
    'change_preview', 'preview_teardown',
    -- Capturing a before/after comparison (Sprint 11A §21).
    'change_review'
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
    -- Visual review (Sprint 11A §21).
    'capturing_before', 'capturing_after', 'persisting_artifacts',
    'completed'
  ));

-- ---------------------------------------------------------------------
-- Screenshot storage
--
-- A PRIVATE bucket. `public = false` is the whole security posture of this
-- feature's storage: a public bucket would put images of a customer's product
-- on a guessable URL forever, and §16 forbids permanently public screenshot
-- URLs.
--
-- No policies are created on storage.objects for this bucket, and that is
-- deliberate rather than an omission. Reads happen through short-lived signed
-- URLs minted server-side *after* the application has authorized the caller;
-- writes happen only from durable execution under the service role. With no
-- policy, an anon or authenticated token can neither read nor list these
-- objects directly, so the application's own authorization is the only way in
-- (§34).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-screenshots',
  'review-screenshots',
  false,
  -- A viewport PNG, with generous headroom. A ceiling rather than a guess:
  -- nothing legitimate this feature produces approaches it, and it bounds what
  -- a defect could upload.
  16777216,
  array['image/png']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- review_artifacts
-- ---------------------------------------------------------------------
create table public.review_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  prepared_change_id uuid not null references public.prepared_changes (id) on delete cascade,
  validation_run_id uuid not null references public.validation_runs (id) on delete cascade,

  -- The exact session photographed. Never "a recent preview" (§6). The preview
  -- is deliberately allowed to be deleted without taking the review with it:
  -- an artifact outlives the sandbox it recorded, which is the entire point of
  -- §7 — so this is ON DELETE SET NULL, not CASCADE.
  preview_session_id uuid references public.preview_sessions (id) on delete set null,
  operation_run_id uuid not null references public.operation_runs (id) on delete cascade,

  review_profile text not null check (review_profile in ('public_visual_review_v1')),
  review_profile_version text not null check (char_length(btrim(review_profile_version)) > 0),

  -- What "comparable" meant when these two images were made: viewport, settle
  -- strategy, animation handling, full-page mode, format. Part of the review
  -- identity, so changing it invalidates reuse by construction (§12, §19).
  review_policy_version text not null check (char_length(btrim(review_policy_version)) > 0),
  provider text not null check (provider in ('browserbase')),

  -- The single compared route, server-resolved. A client cannot name it (§4).
  route text not null check (char_length(btrim(route)) > 0),

  -- The public origin photographed as "before", as observed. NOT a claim about
  -- a commit: production may have been anything at that moment, and the honest
  -- semantics are "the live product as observed at capture time" (§20).
  before_origin text not null check (char_length(btrim(before_origin)) > 0),

  -- Object paths, never URLs. A stored signed URL would be a bearer credential
  -- with a lifetime nobody controls (§16).
  before_object_path text,
  after_object_path text,

  before_capture_status text not null default 'pending'
    check (before_capture_status in ('pending', 'captured', 'failed')),
  after_capture_status text not null default 'pending'
    check (after_capture_status in ('pending', 'captured', 'failed')),

  before_sha256 text check (before_sha256 is null or char_length(before_sha256) = 64),
  after_sha256 text check (after_sha256 is null or char_length(after_sha256) = 64),

  before_width integer check (before_width is null or before_width > 0),
  before_height integer check (before_height is null or before_height > 0),
  after_width integer check (after_width is null or after_width > 0),
  after_height integer check (after_height is null or after_height > 0),

  before_captured_at timestamptz,
  after_captured_at timestamptz,

  status text not null default 'capturing'
    check (status in ('capturing', 'ready', 'failed', 'expired')),
  failure_code text,

  review_identity text not null check (char_length(review_identity) = 64),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Explicit retention. Never inherited from a storage default, which is what
  -- happens when nobody decides (§17).
  expires_at timestamptz not null,

  -- A failed review must say why, so the UI never has to invent a reason.
  constraint review_artifacts_failed_has_code
    check (status <> 'failed' or failure_code is not null),

  -- `ready` is the claim that a comparison exists. A one-sided comparison is
  -- not a comparison: a user shown one image beside an empty box would
  -- reasonably read it as "the change removed everything" (§32). The claim
  -- cannot exist without both of its halves.
  constraint review_artifacts_ready_has_both_sides
    check (
      status <> 'ready' or (
        before_capture_status = 'captured' and after_capture_status = 'captured'
        and before_object_path is not null and after_object_path is not null
        and before_sha256 is not null and after_sha256 is not null
      )
    ),

  -- Comparability, enforced rather than trusted. Two images captured at
  -- different sizes are not a before/after — they are two pictures, and every
  -- reflowed element in them reads as a change that was never made (§12, §39).
  constraint review_artifacts_ready_has_equal_viewport
    check (
      status <> 'ready' or (
        before_width = after_width and before_height = after_height
      )
    )
);

comment on table public.review_artifacts is
  'One before/after visual comparison. Proves a controlled representation was captured — never that the change is good, approved, or safe to merge.';

comment on column public.review_artifacts.before_origin is
  'The public origin photographed as "before", as observed at capture time. Not a claim about a commit.';

comment on column public.review_artifacts.preview_session_id is
  'The exact PreviewSession photographed. ON DELETE SET NULL: the artifact deliberately outlives the temporary sandbox it recorded.';

create index review_artifacts_prepared_change_idx
  on public.review_artifacts (prepared_change_id, created_at desc);

create index review_artifacts_project_created_idx
  on public.review_artifacts (project_id, created_at desc);

create index review_artifacts_operation_idx
  on public.review_artifacts (operation_run_id);

-- Finding artifacts past their retention deadline, for cleanup.
create index review_artifacts_live_expiry_idx
  on public.review_artifacts (expires_at)
  where status in ('capturing', 'ready');

-- Idempotency (§43). At most one live-or-ready review per identity: a double
-- click loses its second insert here rather than paying for a second browser
-- session photographing the same two things.
create unique index review_artifacts_single_active_idx
  on public.review_artifacts (project_id, review_identity)
  where status in ('capturing', 'ready');

alter table public.review_artifacts enable row level security;

create trigger set_updated_at
  before update on public.review_artifacts
  for each row execute function public.set_updated_at();

-- Browser reads stay RLS-protected. Durable execution uses the service role and
-- re-establishes ownership in code (ADR 0013).
create policy "select own review_artifacts"
  on public.review_artifacts
  for select using (
    exists (select 1 from public.projects p where p.id = review_artifacts.project_id and p.user_id = auth.uid())
  );

create policy "insert own review_artifacts"
  on public.review_artifacts
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "update own review_artifacts"
  on public.review_artifacts
  for update using (
    exists (select 1 from public.projects p where p.id = review_artifacts.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

create policy "delete own review_artifacts"
  on public.review_artifacts
  for delete using (
    exists (select 1 from public.projects p where p.id = review_artifacts.project_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- review_browser_usage
--
-- A narrow ledger of its own rather than a widened Deep Scan table.
-- `deep_scan_provider_usage` is shaped around an authenticated analysis: it
-- requires an access mode, references a browser session row, and pins
-- `operation = 'authenticated_product_analysis'`. Loosening those to fit a
-- screenshot would blur the one question the table exists to answer.
--
-- **No INSERT policy, deliberately.** This is the Sprint 10B lesson applied
-- before it can bite again: `sandbox_usage_events` grants SELECT only, an
-- inline stop tried to write it under the cookie-scoped client, RLS refused,
-- and the error was swallowed — the preview stopped correctly and its spend was
-- recorded nowhere. A ledger the client can write is not a ledger, and a ledger
-- written from a request is one RLS failure away from silence. Writes come from
-- durable execution under the service role, and nothing else.
-- ---------------------------------------------------------------------
create table public.review_browser_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Not a foreign key: the ledger must outlive what it paid for, because
  -- deleting a review does not undo the browser seconds.
  review_artifact_id uuid,

  operation text not null check (operation = 'change_review'),
  provider text not null check (provider in ('browserbase')),

  status text not null check (status in ('ready', 'failed')),

  -- Measured, never estimated.
  duration_ms integer not null check (duration_ms >= 0),
  captures integer not null check (captures >= 0),

  -- Null unless the provider reports an attributable amount. Browserbase does
  -- not, so a figure here would be a guess wearing an accounting figure's
  -- clothes — the same discipline the AI pricing module follows.
  provider_cost_usd numeric(18, 9) check (provider_cost_usd is null or provider_cost_usd >= 0),

  failure_code text,
  created_at timestamptz not null default now()
);

comment on table public.review_browser_usage is
  'Browser-provider consumption for visual review. Separate from Deep Scan usage and from ai_usage_events: browser-seconds are not tokens. Service-role writes only.';

create index review_browser_usage_project_created_idx
  on public.review_browser_usage (project_id, created_at desc);

-- One ledger row per review artifact, enforced rather than argued. A retried
-- terminal step must not double-count a browser session that ran once.
create unique index review_browser_usage_artifact_idx
  on public.review_browser_usage (review_artifact_id)
  where review_artifact_id is not null;

alter table public.review_browser_usage enable row level security;

-- Read-only to the owner, and no write policy at all. See the note above.
create policy "select own review_browser_usage"
  on public.review_browser_usage
  for select using (
    exists (select 1 from public.projects p where p.id = review_browser_usage.project_id and p.user_id = auth.uid())
  );
