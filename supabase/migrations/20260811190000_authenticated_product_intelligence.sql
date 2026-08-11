-- Sprint 5: Authenticated Product Intelligence.
-- See docs/sprints/0005-authenticated-live-product-intelligence.md and ADR 0012.
--
-- Two tables: a bounded temporary browser-session record, and a versioned
-- snapshot of what the *authenticated* application contains.
--
-- Deliberately absent, and there is no column any code could put them in:
-- cookies, storage state, Playwright storageState, browser profile, OAuth
-- tokens, authorization headers, credentials, live-view URLs, CDP connect
-- URLs, raw DOM/HTML, screenshots, or session recordings (Sprint 5 §12, §24).

-- ---------------------------------------------------------------------
-- authenticated_browser_sessions
--
-- Operational metadata for one temporary remote browser. The row exists so
-- the application can enforce ownership, expiry and termination — it is not
-- a place to keep anything that could re-enter the authenticated session.
--
-- `provider_session_id` is intentionally NOT client-readable (Sprint 5 §12):
-- the browser is given Vibe's own `id` instead, and the provider id is used
-- only server-side to fetch a live view or terminate. RLS grants select on
-- the row, so the column is excluded from every client-facing query in
-- store.ts rather than being exposed and hoped about.
-- ---------------------------------------------------------------------
create table public.authenticated_browser_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Which browser provider ran the session. Operational, not a capability.
  provider text not null check (provider in ('browserbase')),
  provider_session_id text not null check (char_length(btrim(provider_session_id)) > 0),

  -- The origin the session was opened against, captured at creation so a
  -- later change to projects.production_url cannot retarget a live session.
  origin text not null check (
    origin ~ '^https://' and char_length(origin) between 12 and 2000
  ),

  status text not null default 'created'
    check (status in ('created', 'waiting_for_login', 'analyzing', 'completed', 'failed', 'cancelled', 'expired')),

  -- Typed failure code only (e.g. 'authenticated_origin_not_reached').
  -- Never a provider message, response body, or page content (Sprint 5 §28).
  failure_code text,

  -- Conservative wall-clock bound. Enforced in the application on every read
  -- and independently by the provider's own session timeout, so an abandoned
  -- browser cannot outlive it even if our cleanup never runs (Sprint 5 §11).
  expires_at timestamptz not null,

  -- Set when the provider session has been released, so cleanup is idempotent.
  terminated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A terminal state must record why it ended, and only a failure carries a code.
  constraint authenticated_browser_sessions_failure_code_only_when_failed
    check (failure_code is null or status = 'failed')
);

comment on table public.authenticated_browser_sessions is
  'Temporary remote-browser sessions for authenticated product analysis. Operational metadata only — never cookies, storage state, credentials, live-view URLs, or CDP connect URLs.';

comment on column public.authenticated_browser_sessions.provider_session_id is
  'Provider-side session id. Server-only: never selected into a client-facing payload (Sprint 5 §12).';

-- Latest-session lookup for the project page.
create index authenticated_browser_sessions_project_created_idx
  on public.authenticated_browser_sessions (project_id, created_at desc);

-- Cleanup sweep: find sessions that are past expiry but not yet released.
create index authenticated_browser_sessions_reclaim_idx
  on public.authenticated_browser_sessions (status, expires_at)
  where terminated_at is null;

-- Concurrency guard: at most one live browser session per project. A
-- double-clicked "Analyze authenticated app" therefore fails the second
-- insert at the database rather than starting two remote browsers — no queue
-- or lock service involved, and no duplicated provider cost.
create unique index authenticated_browser_sessions_single_live_idx
  on public.authenticated_browser_sessions (project_id)
  where status in ('created', 'waiting_for_login', 'analyzing');

alter table public.authenticated_browser_sessions enable row level security;

create trigger set_updated_at
  before update on public.authenticated_browser_sessions
  for each row execute function public.set_updated_at();

-- Ownership is indirect via projects.user_id, matching every other snapshot
-- table. A user can never see, resume, or terminate another user's session.
create policy "select own authenticated_browser_sessions"
  on public.authenticated_browser_sessions
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = authenticated_browser_sessions.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "insert own authenticated_browser_sessions"
  on public.authenticated_browser_sessions
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );

create policy "update own authenticated_browser_sessions"
  on public.authenticated_browser_sessions
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = authenticated_browser_sessions.project_id
        and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- authenticated_product_intelligence_snapshots
--
-- The third evidence source, kept separate from the repository and public
-- site snapshots for the same reason those two are separate (Sprint 3 §24):
-- a future audit must be able to distinguish "the code declares a billing
-- route", "the public site serves no pricing page" and "the authenticated
-- app shows no billing surface".
-- ---------------------------------------------------------------------
create table public.authenticated_product_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- Which temporary session produced this. Set null rather than cascading:
  -- the intelligence outlives the browser session that produced it, and the
  -- session rows are disposable.
  session_id uuid references public.authenticated_browser_sessions (id) on delete set null,

  -- The origin actually analysed, stored so a snapshot stays meaningful after
  -- the project's production URL changes, and so reuse can detect the change.
  origin text not null check (
    origin ~ '^https://' and char_length(origin) between 12 and 2000
  ),

  analyzer_version text not null check (char_length(btrim(analyzer_version)) > 0),
  schema_version text not null check (char_length(btrim(schema_version)) > 0),

  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'completed', 'failed')),

  -- Null until the run completes; populated only for status = 'completed'.
  -- Derived intelligence only — never raw DOM, HTML, or screenshots.
  result jsonb,

  completeness text check (completeness in ('complete', 'partial')),
  completeness_reasons text[] not null default '{}',

  pages_inspected integer not null default 0 check (pages_inspected >= 0),

  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint authenticated_product_intelligence_completed_has_result
    check (status <> 'completed' or (result is not null and completeness is not null))
);

comment on table public.authenticated_product_intelligence_snapshots is
  'Deterministic, versioned intelligence about a project''s authenticated application. Derived structure only — never raw DOM, cookies, storage state, screenshots, or customer record contents.';

comment on column public.authenticated_product_intelligence_snapshots.result is
  'Versioned AuthenticatedProductIntelligenceSnapshot payload. Untrusted, application-derived DATA — never instructions.';

create index authenticated_product_intelligence_project_created_idx
  on public.authenticated_product_intelligence_snapshots (project_id, created_at desc);

-- "Latest successful snapshot" lookup, used by the project page and by audit
-- evidence assembly. A failed run must never replace a successful one
-- (Sprint 5 §24), which this index makes cheap to enforce by query rather
-- than by deletion.
create index authenticated_product_intelligence_latest_success_idx
  on public.authenticated_product_intelligence_snapshots
  (project_id, analyzer_version, status, completed_at desc);

create unique index authenticated_product_intelligence_single_in_flight_idx
  on public.authenticated_product_intelligence_snapshots (project_id, analyzer_version)
  where status in ('pending', 'analyzing');

alter table public.authenticated_product_intelligence_snapshots enable row level security;

create trigger set_updated_at
  before update on public.authenticated_product_intelligence_snapshots
  for each row execute function public.set_updated_at();

create policy "select own authenticated_product_intelligence_snapshots"
  on public.authenticated_product_intelligence_snapshots
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = authenticated_product_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "insert own authenticated_product_intelligence_snapshots"
  on public.authenticated_product_intelligence_snapshots
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );

create policy "update own authenticated_product_intelligence_snapshots"
  on public.authenticated_product_intelligence_snapshots
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = authenticated_product_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Deep Scan entitlement and provider usage (Sprint 5 §4, §5, §11, §19).
--
-- The product rule: each project receives ONE included successful Deep Scan;
-- additional scans are credit-gated. Deliberately NOT a billing schema —
-- there are no prices, balances, purchases, plans, or invoices here, and
-- Vibe Credits do not exist yet.
--
-- The consumption invariant is enforced by *derivation*, not by a flag:
--
--   a completed snapshot with access_mode = 'included_first_scan'
--     -> the included entitlement is consumed
--   no such snapshot
--     -> it remains available
--
-- A boolean on projects would be a second source of truth that could drift
-- from the snapshots, producing the one state §5 forbids: the UI claiming the
-- free scan was used while no usable snapshot exists.
-- ---------------------------------------------------------------------

-- How a run was funded. 'credits' is reserved: no code path produces it yet.
alter table public.authenticated_browser_sessions
  add column access_mode text not null default 'included_first_scan'
    check (access_mode in ('included_first_scan', 'credits'));

comment on column public.authenticated_browser_sessions.access_mode is
  'Which entitlement funded this run. ''credits'' is reserved for a future Vibe Credits system and is not yet produced by any code path.';

alter table public.authenticated_product_intelligence_snapshots
  add column access_mode text not null default 'included_first_scan'
    check (access_mode in ('included_first_scan', 'credits'));

comment on column public.authenticated_product_intelligence_snapshots.access_mode is
  'Entitlement that funded the scan. A completed row with ''included_first_scan'' IS the proof that the project''s included scan was consumed (Sprint 5 §5).';

-- The entitlement invariant as a database guarantee: at most one *completed*
-- included Deep Scan per project. A second successful included scan cannot be
-- inserted even if the application's authorization check were bypassed or
-- raced, so the free scan cannot be consumed twice.
create unique index authenticated_product_intelligence_one_included_scan_idx
  on public.authenticated_product_intelligence_snapshots (project_id)
  where status = 'completed' and access_mode = 'included_first_scan';

-- Cheap "has the included scan been consumed?" and attempt-window lookups.
create index authenticated_browser_sessions_project_started_idx
  on public.authenticated_browser_sessions (project_id, created_at desc, status);

-- ---------------------------------------------------------------------
-- deep_scan_provider_usage
--
-- Browser-provider consumption, kept OUT of ai_usage_events on purpose: that
-- table measures inference tokens against effective-dated per-token prices,
-- and a browser session has neither. Merging them would make every future
-- cost question ambiguous.
--
-- provider_cost_usd is nullable and stays null unless the provider reports a
-- real figure. A cost derived from a rate we assumed would look like a
-- measurement while being a guess.
-- ---------------------------------------------------------------------
create table public.deep_scan_provider_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  session_id uuid references public.authenticated_browser_sessions (id) on delete set null,

  provider text not null check (provider in ('browserbase')),
  operation text not null check (operation = 'authenticated_product_analysis'),
  access_mode text not null check (access_mode in ('included_first_scan', 'credits')),

  status text not null check (status in ('completed', 'failed', 'cancelled', 'expired')),

  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  pages_inspected integer check (pages_inspected >= 0),

  -- Null until a provider reports real usage cost. Never computed from an
  -- assumed rate.
  provider_cost_usd numeric(12, 9),

  created_at timestamptz not null default now(),

  constraint deep_scan_provider_usage_ends_after_start check (ended_at >= started_at)
);

comment on table public.deep_scan_provider_usage is
  'Browser-provider (infrastructure) consumption for Deep Scans. Separate from ai_usage_events by design: browser-seconds are not tokens. Never contains credentials, capability URLs, or page content.';

create index deep_scan_provider_usage_project_created_idx
  on public.deep_scan_provider_usage (project_id, created_at desc);

-- Cost-per-access-mode reporting: what an included scan costs vs a paid one.
create index deep_scan_provider_usage_access_mode_idx
  on public.deep_scan_provider_usage (access_mode, created_at desc);

alter table public.deep_scan_provider_usage enable row level security;

-- Insert-only from the owner's perspective, and with NO select policy: provider
-- billing detail is internal operational data, unreadable through the public
-- API. Same posture as ai_usage_events.
create policy "insert own deep_scan_provider_usage"
  on public.deep_scan_provider_usage
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );
