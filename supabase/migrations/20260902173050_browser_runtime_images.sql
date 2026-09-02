-- ADR 0076: the Deep Scan browser runs in a sandbox Vibe owns.
-- See docs/sprints/0130-the-browser-we-own.md.
--
-- One table, holding one fact: which provider snapshot a browser session should
-- start from. The snapshot carries Chromium and the guard's dependencies, built
-- once and reused, because installing a browser at the start of every scan
-- would spend thirty to sixty seconds of a person's attention on a download.
--
-- ## Why this is not customer data
--
-- There is no project_id and no user_id, and that is the point rather than an
-- omission. A runtime image is Vibe's own infrastructure — the same bytes for
-- every customer — and attaching an owner to it would invent a relationship
-- that does not exist and then have to be maintained.
--
-- RLS is enabled with **no policies at all**. That is deliberate and it is the
-- whole access rule: nothing but the service role can read or write this table,
-- and an authenticated user reaching it gets an empty result rather than a
-- refusal. Nobody signed in has a reason to know a snapshot id.
--
-- ## Why it expires, and why nothing schedules the rebuild
--
-- Provider snapshots have a lifetime, so the id in a row stops naming anything
-- after `expires_at`. The rebuild is **read-triggered**: the next scan that
-- finds no usable row builds one and records it. No cron, no scheduler, no
-- queue — CLAUDE.md rule 24's "needs no new infrastructure" met rather than
-- argued around.
--
-- ## Deliberately absent
--
-- No tokens, no capability URLs, no sandbox name of a live session, no
-- customer origin, and nothing about any individual scan. This table describes
-- an image, never a session.

create table public.browser_runtime_images (
  id uuid primary key default gen_random_uuid(),

  -- The guard version the image was built for. A guard whose behaviour changed
  -- must not be started from an image built for the old one, so the lookup is
  -- keyed on this rather than on recency alone.
  runtime_version text not null,

  -- The provider's snapshot id. An identifier, not a capability: it names an
  -- image and opens nothing (CLAUDE.md rule 52).
  snapshot_id text not null,

  built_at timestamptz not null default now(),

  -- Always explicit. The provider's own default is 30 days, which is not a
  -- retention anybody chose.
  expires_at timestamptz not null,

  constraint browser_runtime_images_expires_after_build check (expires_at > built_at)
);

-- The lookup this table exists for: the newest image for one guard version that
-- has not expired. Partial on neither column, because "has not expired" is
-- evaluated against a moving clock and cannot be indexed as a predicate.
create index browser_runtime_images_by_version
  on public.browser_runtime_images (runtime_version, expires_at desc);

alter table public.browser_runtime_images enable row level security;

-- No policies, on purpose. See the header: this is Vibe's own infrastructure,
-- reachable only by the service role, and there is no signed-in caller with a
-- reason to read it.

comment on table public.browser_runtime_images is
  'ADR 0076. Reusable Chromium snapshots for Deep Scan browser sandboxes. Vibe infrastructure, not customer data: service-role only, rebuilt lazily on read when none is usable.';
