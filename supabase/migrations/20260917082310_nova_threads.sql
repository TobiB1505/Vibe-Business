-- Nova's transcript: threads and the turns in them (ADR 0109 §6).
--
-- ## What this is, and what it must never become
--
-- A **record**, not a position. The Nova architecture audit's §M closed "a
-- transcript as source of truth" and that stays closed: deleting every row in
-- these two tables must not change one canonical fact about a business. An
-- audit lives in `business_audit_results`, an approval in `change_approvals`,
-- a charge in the billing graph. A message can point at one of those and can
-- never be one.
--
-- What §M did not close is a transcript that *records*, which is what makes a
-- conversation a conversation rather than a screen that re-derives itself on
-- every load. A founder who says "the second one" is relying on this.
--
-- ## Why one message table with a kind, and not five tables
--
-- Per-kind CHECK constraints are the idiom `nova_voice_messages` already uses,
-- where three of them enforce that a resolution is whole, that a voice row
-- carries its message and that a fallback carries none. Five tables would be
-- five joins to read one conversation in order; a JSON blob would be a schema
-- nothing enforces. The constraints below *are* the schema, and
-- `src/modules/nova/threads/schema.test.ts` reads them out of this file and
-- fails when a TypeScript union and a CHECK disagree.
--
-- ## The sequence, and why it is a unique index rather than a counter column
--
-- A message's place in a thread has to be stable and gapless enough to read
-- "everything after 7" from a read marker. `(thread_id, sequence)` unique is
-- what makes a second writer at the same position fail rather than interleave;
-- the store takes the next sequence inside the same statement that inserts.
--
-- ## Security model
--
-- The owner reads their own threads and messages through the project, exactly
-- as `project_founder_resolutions` does, and may insert their own `founder`
-- messages. `nova` and `system` rows are written by `src/modules/operations/`
-- under the service-role client — the one module rule 53 lets hold it — because
-- they are written by a durable step that has no session.
--
-- No delete grant for `authenticated` on messages: a founder archives a thread
-- or deletes it whole (which cascades), and a transcript with individual turns
-- removed is a transcript that misrepresents what was said.
--
-- ## Retention
--
-- Deliberately **not** swept by age. ADR 0068's four classes do not contain
-- this: a transcript is not an operational event stream, not an audit trail,
-- not a financial record and not derived intelligence — it is the founder's own
-- words and the product's replies to them. Which class it belongs to is an open
-- decision (the restructure audit's §E.1), and until somebody makes it, nothing
-- deletes a founder's conversation on a clock. `retention/periods.ts` names both
-- tables in `NEVER_SWEPT_BY_AGE` with that reason, so the absence is written
-- down rather than forgotten. Erasure is unaffected: both cascade from
-- `projects`.

create table public.nova_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- The owner at the time of writing, denormalized so a message read can be
  -- scoped without joining through the project on every row.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Vibe-composed, or the founder's first line. 120 is MAX_THREAD_TITLE_CHARS.
  title text not null check (char_length(btrim(title)) between 1 and 120),

  status text not null default 'open' check (status in ('open', 'archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Null until the thread has one. Not a copy of max(created_at) for speed —
  -- it is what the list orders by, and a list that ordered by a subquery over
  -- a growing table is the truncating read PERF-018 is about.
  last_message_at timestamptz,

  -- The highest sequence this founder has seen. Zero means none, which is why
  -- it is not nullable: "unread" is a comparison, not a missing value.
  last_read_sequence integer not null default 0 check (last_read_sequence >= 0)
);

comment on table public.nova_threads is
  'One Nova conversation, scoped to a project (ADR 0109 §6). A record and never a position: deleting a thread must not change canonical business state.';

comment on column public.nova_threads.last_read_sequence is
  'The highest nova_messages.sequence the owner has seen. Zero means none — unread is a comparison against this, never a null check.';

create index nova_threads_project_idx
  on public.nova_threads (project_id, status, last_message_at desc nulls last);

-- The thread half of `nova_messages`' composite foreign key needs a unique
-- index to point at, and it has to exist before that table is created. It is
-- also the lookup every project-scoped thread read makes.
create unique index nova_threads_id_project_idx
  on public.nova_threads (id, project_id);

-- VB-027 again. `project_id` leads the index above it; the owner does not.
create index nova_threads_user_idx
  on public.nova_threads (user_id);

create table public.nova_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.nova_threads (id) on delete cascade,
  -- Denormalized from the thread so RLS and every read scope without a join.
  -- Kept honest by `nova_messages_thread_project_fk` below rather than by care.
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Monotonic within one thread. See the header for why this is an index.
  sequence integer not null check (sequence > 0),

  author text not null check (author in ('founder', 'nova', 'system')),
  kind text not null check (kind in (
    'text',
    'action_proposal',
    'action_result',
    'artifact',
    'event'
  )),

  -- Words. 1200 is MAX_MESSAGE_CHARS, and the same ceiling
  -- `project_founder_resolutions.resolved_statement` carries.
  body text check (char_length(btrim(body)) between 1 and 1200),

  -- The catalogue action, spelled as `src/modules/nova/actions.ts` spells it.
  -- A prefix check rather than an enumeration of eighteen ids: the list changes
  -- with the product and a CHECK that had to be migrated for every new control
  -- is a CHECK somebody eventually widens to `text`. What this rules out is a
  -- value from somewhere else entirely; that the id exists is checked in code,
  -- against the catalogue itself, which is the only place that knows.
  action_id text check (action_id ~ '^nova\.[a-z_]{3,60}$'),

  subject_kind text check (subject_kind in (
    'prepared_change',
    'move',
    'founder_input_request',
    'plan_step',
    'project'
  )),
  subject_id text check (char_length(subject_id) between 1 and 128),

  -- The thing under discussion. A closed union plus a canonical row id — never
  -- a URL, because an address is composed from a section table that moves and a
  -- stored one would rot (ADR 0109 §7).
  artifact_kind text check (artifact_kind in (
    'business_health',
    'product',
    'opportunity',
    'action_plan',
    'agent_execution',
    'prepared_change',
    'experiment',
    'founder_input'
  )),
  artifact_ref text check (char_length(artifact_ref) between 1 and 128),

  operation_run_id uuid references public.operation_runs (id) on delete set null,

  -- What was observed after a pressed proposal, never what a model said would
  -- happen. Short by construction: it is a code, not a sentence.
  outcome text check (outcome in ('succeeded', 'failed', 'refused', 'cancelled')),

  -- What the turn was answered from: the shape of the context pack, never its
  -- content. Rule 43's line, one layer down — enough to explain a reply later,
  -- and nothing that would put repository or page text in a durable log.
  context_version text check (char_length(context_version) between 1 and 100),
  context_hash text check (context_hash ~ '^[0-9a-f]{64}$'),

  created_at timestamptz not null default now(),

  -- A message belongs to a thread and to that thread's project. Without this a
  -- correct-looking insert could file a message under one project's thread and
  -- another project's id, and every scoped read would then disagree with every
  -- other one.
  constraint nova_messages_thread_project_fk
    foreign key (thread_id, project_id)
    references public.nova_threads (id, project_id) on delete cascade,

  constraint nova_messages_sequence_unique unique (thread_id, sequence),

  -- Per-kind shape. Each says what the kind *must* carry and what it must not,
  -- so a row is interpretable by its kind alone.

  -- Words, and nothing else. An `artifact` beside a sentence is its own
  -- message, which is what keeps "Nova explains, the workspace shows" two
  -- objects rather than one row with a picture stapled to it.
  constraint nova_messages_text_is_words check (
    kind <> 'text' or (
      body is not null
      and action_id is null and subject_kind is null and subject_id is null
      and artifact_kind is null and artifact_ref is null
      and outcome is null
    )
  ),

  -- An offer names its action and what the action is about, and carries no
  -- outcome: nothing has happened yet, and a proposal that arrived with one
  -- would be the generated text deciding a result (ADR 0109 §5).
  constraint nova_messages_proposal_names_its_action check (
    kind <> 'action_proposal' or (
      action_id is not null and subject_kind is not null
      and outcome is null and body is null
    )
  ),

  -- A result names the same action and what was observed.
  constraint nova_messages_result_is_observed check (
    kind <> 'action_result' or (
      action_id is not null and subject_kind is not null
      and outcome is not null and body is null
    )
  ),

  -- An artifact is a kind and a reference, and never words.
  constraint nova_messages_artifact_is_a_reference check (
    kind <> 'artifact' or (
      artifact_kind is not null
      and body is null and action_id is null and outcome is null
    )
  ),

  -- An event is a run reaching a terminal state. It carries no words at all:
  -- the sentence a founder reads is composed by `nova/feed.ts` from today's
  -- tables, so a reworded product does not leave last month's phrasing on
  -- screen with nothing to reveal it (rule 83, one layer down — the argument
  -- `nova_voice_messages` makes for not storing its fallback text).
  constraint nova_messages_event_names_its_run check (
    kind <> 'event' or (
      operation_run_id is not null
      and body is null and action_id is null and artifact_kind is null
      and outcome is null
    )
  ),

  -- A subject is whole or absent: a kind with no id, or an id with no kind, is
  -- a reference nobody can follow.
  constraint nova_messages_subject_is_whole check (
    (subject_kind is null) = (subject_id is null)
    -- Except the project, which is the one subject that needs no id: it is the
    -- thread's own project, and storing it twice would be a second answer.
    or (subject_kind = 'project' and subject_id is null)
  ),

  -- The same for an artifact.
  constraint nova_messages_artifact_is_whole check (
    (artifact_kind is null) = (artifact_ref is null)
    -- Four of the eight kinds are a whole section rather than a row in one.
    or (artifact_kind in ('business_health', 'product', 'action_plan', 'agent_execution',
                          'experiment', 'founder_input') and artifact_ref is null)
  ),

  -- A founder writes words and nothing else. Every other kind is Vibe's own,
  -- and a client that could insert an `action_result` could write a merge that
  -- never happened into the record a founder reads.
  constraint nova_messages_founder_writes_words check (
    author <> 'founder' or kind = 'text'
  ),

  -- And Vibe never puts words in a founder's mouth the other way: `system` is
  -- the product observing something, never a sentence somebody chose.
  constraint nova_messages_system_does_not_speak check (
    author <> 'system' or kind in ('action_result', 'event', 'artifact')
  ),

  -- What the turn was answered from is whole or absent.
  constraint nova_messages_context_is_whole check (
    (context_version is null) = (context_hash is null)
  )
);

comment on table public.nova_messages is
  'One turn in a Nova thread (ADR 0109 §6, restructure audit §C.9). One table, a kind discriminator and per-kind CHECKs — never a table per kind and never a JSON blob. An event stores the run it is about and no words: the sentence is composed from today''s tables.';

comment on column public.nova_messages.sequence is
  'Monotonic within one thread, unique with thread_id. A read marker is a comparison against it, which is why it is an integer and not a timestamp.';

comment on column public.nova_messages.context_hash is
  'The shape of the context pack a turn was answered from, never its content (rule 43). Enough to explain a reply later; nothing that would put repository or page text into a durable log.';

create index nova_messages_thread_idx
  on public.nova_messages (thread_id, sequence);

create index nova_messages_project_idx
  on public.nova_messages (project_id, created_at desc);

-- VB-027: every foreign key gets a covering index, so deleting a parent does
-- not sequentially scan this table. `thread_id` and `project_id` are each
-- covered by a leading column above; these are the three that are not.
--
-- The composite one is also the only index that could serve the `(thread_id,
-- project_id)` reference, and column order follows the constraint's.
create index nova_messages_thread_project_idx
  on public.nova_messages (thread_id, project_id);

create index nova_messages_user_idx
  on public.nova_messages (user_id);

create index nova_messages_operation_run_idx
  on public.nova_messages (operation_run_id);

alter table public.nova_threads enable row level security;
alter table public.nova_messages enable row level security;

create policy "select own nova_threads"
  on public.nova_threads
  for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = nova_threads.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "select own nova_messages"
  on public.nova_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = nova_messages.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- A founder may write their own words into their own thread, and the check is
-- on the *project* rather than on the `user_id` column the row carries: a
-- client controls what it sends, and ownership is a fact about the project row.
create policy "insert own nova_messages"
  on public.nova_messages
  for insert
  to authenticated
  with check (
    author = 'founder'
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = nova_messages.project_id
        and p.user_id = (select auth.uid())
    )
  );

-- Marking a thread read, and putting one away. A policy cannot restrict which
-- columns an update touches; a column-level grant can, and these two are the
-- whole of what a founder may change about a thread. Its title, its project and
-- its timestamps are Vibe's.
create policy "update own nova_threads"
  on public.nova_threads
  for update
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = nova_threads.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = nova_threads.project_id
        and p.user_id = (select auth.uid())
    )
  );

revoke all on table public.nova_threads from anon, authenticated;
revoke all on table public.nova_messages from anon, authenticated;

grant select on table public.nova_threads to authenticated;
grant update (status, last_read_sequence) on table public.nova_threads to authenticated;
grant select, insert on table public.nova_messages to authenticated;
grant select, insert, update, delete on table public.nova_threads to service_role;
grant select, insert, update, delete on table public.nova_messages to service_role;
