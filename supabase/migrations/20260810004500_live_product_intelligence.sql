-- Sprint 3: Live Product Intelligence.
-- See docs/sprints/0003-live-product-intelligence.md and ADR 0010.
--
-- Two changes only: a configurable production URL on a project, and a
-- versioned snapshot table for what the public website actually serves.
--
-- Deliberately absent (Sprint 3 §25): no raw HTML table, no screenshots,
-- no vector/embedding tables. The payload holds derived facts and short
-- evidence labels — never page source, cookies, or query strings.

-- ---------------------------------------------------------------------
-- projects.production_url
-- Optional, explicitly configured by the user. Never inferred from a
-- deployment and silently persisted as truth (Sprint 3 §3).
-- ---------------------------------------------------------------------
alter table public.projects
  add column production_url text
    check (
      production_url is null
      or (
        -- HTTPS only, matching the application's URL policy. There is no
        -- localhost/dev exception: the same check is what keeps the SSRF
        -- guard meaningful (Sprint 3 §4).
        production_url ~ '^https://'
        and char_length(production_url) between 12 and 2000
        -- Credentials in a URL are both a secret we refuse to store and a
        -- parser-confusion vector.
        and production_url !~ '^https://[^/@]*@'
      )
    );

comment on column public.projects.production_url is
  'User-configured public production URL, normalized (https, no credentials, no query/fragment). Untrusted input.';

-- ---------------------------------------------------------------------
-- live_product_intelligence_snapshots
-- Kept separate from repository_intelligence_snapshots on purpose
-- (Sprint 3 §24): a project has two independent evidence sources, and
-- the future Business Audit consumes both. Merging them would make it
-- impossible to say "the code has a pricing route but the live site does
-- not serve one".
-- ---------------------------------------------------------------------
create table public.live_product_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  -- The origin actually analysed. Stored rather than only referencing
  -- projects.production_url so a snapshot stays meaningful after the
  -- project's URL is changed, and so reuse can detect that change.
  source_origin text not null check (
    source_origin ~ '^https://' and char_length(source_origin) between 12 and 2000
  ),
  -- The URL as configured at analysis time; may differ from source_origin
  -- when the site redirected (example.com -> www.example.com).
  configured_url text not null check (char_length(btrim(configured_url)) > 0),

  analyzer_version text not null check (char_length(btrim(analyzer_version)) > 0),
  schema_version text not null check (char_length(btrim(schema_version)) > 0),

  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'completed', 'failed')),

  -- Null until the run completes; populated only for status = 'completed'.
  -- Derived intelligence only — never raw HTML (Sprint 3 §13).
  result jsonb,

  completeness text check (completeness in ('complete', 'partial')),
  completeness_reasons text[] not null default '{}',

  -- Typed failure code only (e.g. 'unsafe_destination'). Never a raw
  -- network error or upstream response body (Sprint 3 §32).
  failure_code text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A completed snapshot must actually carry its result and verdict.
  constraint live_product_intelligence_completed_has_result
    check (status <> 'completed' or (result is not null and completeness is not null))
);

comment on table public.live_product_intelligence_snapshots is
  'Deterministic, versioned intelligence about a project''s public live product. Derived facts only — never raw HTML, cookies, or query strings.';

comment on column public.live_product_intelligence_snapshots.result is
  'Versioned LiveProductIntelligenceSnapshot payload. Untrusted, website-derived DATA — never instructions.';

-- Latest-snapshot lookup for the project page.
create index live_product_intelligence_project_created_idx
  on public.live_product_intelligence_snapshots (project_id, created_at desc);

-- Freshness-based reuse lookup (Sprint 3 §27): unchanged origin +
-- analyzer version, within the freshness window. A live site has no
-- commit SHA, so recency is the only honest reuse key.
create index live_product_intelligence_reuse_idx
  on public.live_product_intelligence_snapshots
  (project_id, source_origin, analyzer_version, status, completed_at desc);

-- Concurrency guard (Sprint 3 §28): at most one in-flight run per
-- project + analyzer version. A double-clicked "Inspect" therefore fails
-- the second insert at the database rather than starting two crawls —
-- no queue, worker, or lock service involved.
create unique index live_product_intelligence_single_in_flight_idx
  on public.live_product_intelligence_snapshots (project_id, analyzer_version)
  where status in ('pending', 'analyzing');

alter table public.live_product_intelligence_snapshots enable row level security;

create trigger set_updated_at
  before update on public.live_product_intelligence_snapshots
  for each row execute function public.set_updated_at();

-- Ownership is indirect (via projects.user_id), matching the pattern
-- already used by repository_intelligence_snapshots.
create policy "select own live_product_intelligence_snapshots"
  on public.live_product_intelligence_snapshots
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = live_product_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  );

create policy "insert own live_product_intelligence_snapshots"
  on public.live_product_intelligence_snapshots
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );

create policy "update own live_product_intelligence_snapshots"
  on public.live_product_intelligence_snapshots
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = live_product_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = auth.uid()
    )
  );

create policy "delete own live_product_intelligence_snapshots"
  on public.live_product_intelligence_snapshots
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = live_product_intelligence_snapshots.project_id
        and p.user_id = auth.uid()
    )
  );
