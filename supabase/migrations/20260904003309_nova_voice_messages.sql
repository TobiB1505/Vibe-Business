-- One Nova voice message per identity, attempted exactly once (ADR 0086).
--
-- ## What this table is for
--
-- §M of the Nova audit refuses "a Nova copy LLM call per message… no reuse
-- key, no ledger meaning". This is the reuse key, made durable. Every
-- output-relevant input is hashed into `identity`; the row is claimed before
-- the provider is called; and whatever happens next — an accepted sentence, a
-- refusal, an outage, a malformed response, a switch that was off — resolves
-- that identity forever. Nothing about a founder's screen costs more the
-- second time they look at it.
--
-- ## The race, and why the primary key settles it
--
-- Two tabs, two regions, or one page rendered twice all build the same payload
-- and therefore the same identity. A check-then-call in application code would
-- have both read "nothing stored" and both call the model. So the right to
-- call is claimed by an insert: `on conflict (identity) do nothing … returning`
-- is one statement Postgres serializes, and the caller learns whether it won by
-- whether a row came back. There is no second winner and no lock to release.
--
-- ## A claim is never withdrawn
--
-- A process that claims an identity and then dies leaves `resolved_at` null,
-- and that identity is never generated again — every read falls through to the
-- deterministic template, permanently, for that exact payload. That is
-- intended. A claim that expired, or a sweep that released stale claims, would
-- be a mechanism whose failure mode is a duplicate charge and whose success
-- mode is a marginally nicer sentence. `claim_gateway_request` reasons the same
-- way one layer down: never decremented, because a counter that gave attempts
-- back on failure is a counter an unreliable network can reset.
--
-- ## Why a fallback row carries no message
--
-- An accepted sentence is the model's and cannot be reconstructed, so it is
-- stored. A fallback's text is Vibe's own template, which the caller already
-- holds — storing a copy would freeze today's wording into a row that outlives
-- it, and a reworded template would then leave the old sentence on screen with
-- nothing to reveal it (rule 83, one layer down). So a fallback stores its
-- reason and nothing else, and the read returns whatever the template says
-- today. What the row exists to prevent is the second paid attempt, and it
-- prevents that by existing.
--
-- ## Security model
--
-- Select for `authenticated` through project ownership, because a render
-- reads. Insert and update for `service_role` only. No delete grant and no
-- delete policy at all: a row records an attempt that may have been billed,
-- and rule 47's ledger has a matching usage event whose counterpart must not
-- be able to disappear.

create table public.nova_voice_messages (
  -- The reuse identity: sha256 over project, locale, canonical payload,
  -- prompt version, policy version and model. Hex, checked, so a truncated or
  -- differently-encoded key cannot quietly become a distinct identity.
  identity text primary key check (identity ~ '^[0-9a-f]{64}$'),

  project_id uuid not null references public.projects (id) on delete cascade,

  -- The identity's inputs, stored beside it. Not read to resolve anything —
  -- the hash does that — but a hash nobody can interpret is a row nobody can
  -- audit, and these are what a future "why did this regenerate" is answered
  -- from.
  slot text not null check (slot in (
    'product_reveal',
    'audit_result',
    'move_recommendation',
    'founder_question',
    'execution_result',
    'outcome_result'
  )),
  locale text not null check (locale in ('en')),
  prompt_version text not null check (char_length(prompt_version) between 1 and 100),
  policy_version text not null check (char_length(policy_version) between 1 and 100),
  model text not null check (char_length(model) between 1 and 100),

  claimed_at timestamptz not null default now(),

  -- Null together until the single attempt finishes.
  resolved_at timestamptz,
  source text check (source in ('voice', 'template')),
  fallback_reason text check (fallback_reason in (
    'disabled',
    'over_input_budget',
    'provider_failed',
    'invalid_output',
    'validation_rejected'
  )),
  -- 700 chars is MAX_NOVA_MESSAGE_CHARS; 20 is MIN_NOVA_MESSAGE_CHARS, below
  -- which `checks.ts` calls it `empty_message` rather than a message.
  message text check (char_length(message) between 20 and 700),

  -- A resolution is whole or absent. A row with a source and no timestamp, or
  -- a timestamp and no source, is a half-written attempt nobody could classify.
  constraint nova_voice_messages_resolution_is_whole
    check ((resolved_at is null) = (source is null)),

  -- An accepted sentence has text and no reason.
  constraint nova_voice_messages_voice_carries_the_message
    check (source is distinct from 'voice'
           or (message is not null and fallback_reason is null)),

  -- A fallback has a reason and no text. The template is not stored.
  constraint nova_voice_messages_fallback_carries_no_message
    check (source is distinct from 'template'
           or (message is null and fallback_reason is not null))
);

comment on table public.nova_voice_messages is
  'One Nova voice message per reuse identity, attempted exactly once (ADR 0086). Claimed before the provider call; never retried. A fallback row stores its reason and no text, because the fallback text is the deterministic Vibe template the caller already holds.';

comment on column public.nova_voice_messages.identity is
  'sha256 over project, locale, canonical payload, prompt version, policy version and model. Any output-relevant change is a different identity.';

comment on column public.nova_voice_messages.resolved_at is
  'Null while the one claimed attempt is in flight, and permanently null if it never finished. A claim is never withdrawn: that identity falls through to the template forever rather than being paid for twice.';

create index nova_voice_messages_project_idx
  on public.nova_voice_messages (project_id, claimed_at desc);

alter table public.nova_voice_messages enable row level security;

create policy "select own nova_voice_messages"
  on public.nova_voice_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = nova_voice_messages.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.nova_voice_messages from anon, authenticated;
grant select on table public.nova_voice_messages to authenticated;
grant select, insert, update on table public.nova_voice_messages to service_role;
