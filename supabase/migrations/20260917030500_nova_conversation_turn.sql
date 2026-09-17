-- One conversational turn, written in one statement (ADR 0110, ADR 0109 §5).
--
-- ## Why a function rather than two inserts
--
-- A turn is a founder's question **and** Nova's reply, and a transcript with
-- one of them missing is worse than a transcript with neither: a question with
-- no answer reads as an answer that never came, and an answer with no question
-- reads as Nova volunteering something. They are one write.
--
-- ## Why `security definer`
--
-- Because the alternative was worse in two different directions.
--
-- `nova_messages`' insert policy pins `authenticated` to `author = 'founder'`,
-- deliberately: a client controls every byte it sends, and a browser that could
-- write `author = 'nova'` could put words in her mouth in the founder's own
-- history. Widening that policy to admit `'nova'` would hand the browser
-- exactly that.
--
-- The other way out is the service-role client, and the restructure audit's
-- §C.8 forecloses it by name: *no service-role client anywhere in
-- `features/nova/conversation/` or `modules/nova/conversation/`*. It bypasses
-- RLS entirely (rule 53), and a conversation layer holding it is a conversation
-- layer one bug away from reading across tenants.
--
-- So: a definer function that does the one write the founder is entitled to,
-- with ownership re-checked inside it against `auth.uid()` rather than trusted
-- from an argument. The same shape and the same argument as
-- `resolve_founder_input_request`.
--
-- ## What it refuses
--
-- A thread that is not the caller's. A question or a reply that is empty. A
-- sequence that is already taken — `select … for update` on the thread row
-- serializes two tabs rather than letting them interleave.
--
-- It writes **no other table**. In particular it never touches a canonical one:
-- deleting this conversation must change no fact about the business (ADR 0109
-- §6), and a function that could write one would be the mechanism by which it
-- eventually did.

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

  if coalesce(btrim(p_question), '') = '' or coalesce(btrim(p_reply), '') = '' then
    raise exception 'turn_incomplete';
  end if;

  select coalesce(max(m.sequence), 0) + 1 into v_next
  from public.nova_messages m
  where m.thread_id = p_thread_id;

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

  update public.nova_threads
  set last_message_at = now(), updated_at = now()
  where id = p_thread_id;

  return v_next;
end;
$$;

comment on function public.append_nova_conversation_turn is
  'One conversational turn — the founder''s question and Nova''s reply, plus an optional artifact pointer and action proposal — written atomically. Security definer because nova_messages'' insert policy pins authenticated callers to author = founder on purpose, and the service-role client is foreclosed for the conversation layer by the restructure audit''s §C.8. Ownership is re-checked inside against auth.uid() through the project row.';

revoke all on function public.append_nova_conversation_turn(
  uuid, text, text, text, text, text, text, text
) from public, anon;

grant execute on function public.append_nova_conversation_turn(
  uuid, text, text, text, text, text, text, text
) to authenticated;
