-- The conversation's write boundary, tightened to what the product actually does.
--
-- Slice 7's security pass over the tables Slice 5 and Slice 6 introduced. Four
-- changes, each of which closes something the original pair left open. Nothing
-- here widens a permission.
--
-- ## 1. A founder may open their own thread, and until now could not
--
-- `nova_threads` was granted `select` and a column-limited `update` to
-- `authenticated` and no `insert` at all, because when it shipped the only
-- thing that opened a thread was an operation's terminal transition under the
-- service-role client. Slice 6 then called `ensureOpenThread` from
-- `askNovaAction` under the founder's *own* session — so a founder asking the
-- first question in a project that had never finished a run hit
-- `42501 permission denied`, and the whole ask failed. `FakeDatabase` models
-- rows and not grants, which is why every test passed.
--
-- The grant is column-limited rather than whole: a founder supplies the
-- project, themselves and a title, and the four columns that carry state —
-- `status`, `last_read_sequence`, `last_message_at`, `updated_at` — keep their
-- defaults, because they are Vibe's to move. The policy is the authority and it
-- reads ownership off the project row, never off the `user_id` the client sent.
--
-- ## 2. Nothing but the turn function writes a message any more
--
-- `insert own nova_messages` admitted an authenticated founder writing their
-- own `author = 'founder'` words. No code has ever used it: the conversation's
-- one write is `append_nova_conversation_turn`, which is `security definer` and
-- therefore does not pass through the policy at all, and every other message is
-- written by `src/modules/operations/` under the service-role client.
--
-- So it was a second door onto the transcript that nothing walked through, and
-- it was the door every direct-insert attack goes through: a founder choosing
-- their own `sequence`, filing a message under one project's thread id, or
-- writing into a thread they had archived. Rule 11 is least privilege, and an
-- unused insert grant is not a defence in depth — it is reach with no caller.
--
-- ## 3. A turn cannot be written into an archived thread, or written twice
--
-- Both refused inside the function, under the same row lock that orders the
-- sequence, so two tabs racing the same question resolve to one turn and a
-- refusal rather than to two identical questions in the record.
--
-- ## 3b. A thread takes its name from the first question asked in it
--
-- `title` is not a column a founder may update, and until now nothing else set
-- it either: every thread a run opened was called *"Your product"* and every
-- thread stayed called that. A list of conversations with one name is a list
-- nobody can use. The first founder question is the best name available, it is
-- free, and it is set inside the same statement that writes the turn.
--
-- ## 4. The read marker cannot move backwards
--
-- `markThreadRead` compares before it writes, but the grant is on the column
-- and any client holding it can send a smaller number. A marker that went
-- backwards re-announces turns somebody has already read. The store's stated
-- invariant becomes the database's.

-- 1 ---------------------------------------------------------------------------

create policy "insert own nova_threads"
  on public.nova_threads
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and exists (
      select 1 from public.projects p
      where p.id = nova_threads.project_id
        and p.user_id = (select auth.uid())
    )
  );

grant insert (project_id, user_id, title) on table public.nova_threads to authenticated;

-- 2 ---------------------------------------------------------------------------

drop policy "insert own nova_messages" on public.nova_messages;

revoke insert on table public.nova_messages from authenticated;

comment on table public.nova_messages is
  'One turn in a Nova thread (ADR 0109 §6, restructure audit §C.9). One table, a kind discriminator and per-kind CHECKs. An authenticated founder may read these and may write none: the conversation''s one write is append_nova_conversation_turn, and everything else is written by src/modules/operations/ under the service-role client.';

-- 3 ---------------------------------------------------------------------------

create or replace function public.append_nova_conversation_turn(
  p_thread_id uuid,
  p_question text,
  p_reply text,
  p_artifact_kind text default null,
  p_artifact_ref text default null,
  p_action_id text default null,
  p_context_version text default null,
  p_context_hash text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.nova_threads%rowtype;
  v_user uuid := (select auth.uid());
  v_next integer;
  v_founder_turns integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- The thread, locked, and only if this caller owns the project it belongs to.
  -- Ownership comes from the project row rather than from `nova_threads.user_id`
  -- for the reason rule 53 gives about the service-role client one layer up: the
  -- authority is the persisted relationship, never a column a writer supplied.
  select t.* into v_thread
  from public.nova_threads t
  join public.projects p on p.id = t.project_id
  where t.id = p_thread_id and p.user_id = v_user
  for update of t;

  if not found then
    raise exception 'thread_not_found';
  end if;

  -- A thread the founder put away is not a thread they are talking in. Refused
  -- rather than silently reopened: un-archiving is a decision, and a write that
  -- made it on the founder's behalf would resurrect a conversation they closed.
  if v_thread.status <> 'open' then
    raise exception 'thread_archived';
  end if;

  if coalesce(btrim(p_question), '') = '' or coalesce(btrim(p_reply), '') = '' then
    raise exception 'turn_incomplete';
  end if;

  -- The same question, again, within seconds of itself. A double submission —
  -- two tabs, a double press, a retried action — is the only thing that
  -- produces it, and the row lock above is what makes the check decisive
  -- instead of a race of its own. A founder who genuinely wants to ask twice
  -- waits longer than this.
  if exists (
    select 1 from public.nova_messages m
    where m.thread_id = p_thread_id
      and m.author = 'founder'
      and m.kind = 'text'
      and m.body = btrim(p_question)
      and m.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'turn_duplicate';
  end if;

  select coalesce(max(m.sequence), 0) + 1 into v_next
  from public.nova_messages m
  where m.thread_id = p_thread_id;

  select count(*) into v_founder_turns
  from public.nova_messages m
  where m.thread_id = p_thread_id and m.author = 'founder';

  insert into public.nova_messages
    (thread_id, project_id, user_id, sequence, author, kind, body)
  values
    (p_thread_id, v_thread.project_id, v_user, v_next, 'founder', 'text', btrim(p_question));

  insert into public.nova_messages
    (thread_id, project_id, user_id, sequence, author, kind, body,
     context_version, context_hash)
  values
    (p_thread_id, v_thread.project_id, v_user, v_next + 1, 'nova', 'text', btrim(p_reply),
     p_context_version, p_context_hash);

  -- The pointer and the proposal are their own turns, because they are their
  -- own objects: the thread renders a sentence, a thing to look at and a
  -- control as three items, and a row that carried all three would be the
  -- "one row with a picture stapled to it" the message kinds exist to avoid.
  if p_artifact_kind is not null then
    insert into public.nova_messages
      (thread_id, project_id, user_id, sequence, author, kind, artifact_kind, artifact_ref)
    values
      (p_thread_id, v_thread.project_id, v_user, v_next + 2, 'nova', 'artifact',
       p_artifact_kind, p_artifact_ref);
  end if;

  if p_action_id is not null then
    insert into public.nova_messages
      (thread_id, project_id, user_id, sequence, author, kind, action_id, subject_kind)
    values
      (p_thread_id, v_thread.project_id, v_user,
       v_next + 2 + (case when p_artifact_kind is null then 0 else 1 end),
       'nova', 'action_proposal', p_action_id, 'project');
  end if;

  -- A thread is named after the first thing the founder asked in it.
  --
  -- Until there is one it keeps the name Vibe gave it: a thread opened by a run
  -- finishing has no question to be named after, and *"Your product"* is the
  -- honest placeholder. The founder's first question is a better name than any
  -- placeholder and than anything a model would compose, it is free, and it
  -- happens exactly once — which is why the condition is *no founder message
  -- before this one* rather than *the title is still the default*. A founder who
  -- renamed a thread would not have their name taken away by their next
  -- question, because a founder cannot rename one: `title` is not in the
  -- column grant.
  --
  -- `v_next` is not the test. A thread that already holds four run events and no
  -- questions is still being asked its first one.
  if v_founder_turns = 0 then
    update public.nova_threads
    set title = left(btrim(p_question), 120), last_message_at = now(), updated_at = now()
    where id = p_thread_id;
  else
    update public.nova_threads
    set last_message_at = now(), updated_at = now()
    where id = p_thread_id;
  end if;

  return v_next;
end;
$$;

revoke all on function public.append_nova_conversation_turn(
  uuid, text, text, text, text, text, text, text
) from public, anon;

grant execute on function public.append_nova_conversation_turn(
  uuid, text, text, text, text, text, text, text
) to authenticated;

-- 4 ---------------------------------------------------------------------------

create or replace function public.nova_thread_read_marker_never_retreats()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.last_read_sequence := greatest(old.last_read_sequence, new.last_read_sequence);
  return new;
end;
$$;

comment on function public.nova_thread_read_marker_never_retreats is
  'Clamps nova_threads.last_read_sequence so it can only move forward. The column is granted to authenticated, so a client can send any number; a marker that went backwards would re-announce turns the founder has already read.';

create trigger nova_threads_read_marker_forward_only
  before update of last_read_sequence on public.nova_threads
  for each row
  when (new.last_read_sequence < old.last_read_sequence)
  execute function public.nova_thread_read_marker_never_retreats();
