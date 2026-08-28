-- VB-049 — answering a question stops meaning "rewrite the question".
--
-- `answer own execution_interrupts` checked that the caller owns the project
-- and nothing else, and `authenticated` held table-level `UPDATE` — every
-- column. Its own comment said which fields may change "is enforced in code",
-- which is true of the application's own store function and says nothing about
-- what a browser holding the publishable key can send to PostgREST directly.
--
-- ## What that let a customer do
--
-- Rewrite `question` — the Vibe-authored text a *historical* interrupt keeps so
-- it still means what the customer read. Rewrite `response_schema`, which is
-- the contract `answerInterrupt` validates the answer against: widen it and a
-- previously invalid answer becomes valid, and that answer is what an agent
-- execution resumes on. Change `interrupt_type`, or move the row to a different
-- run of theirs.
--
-- None of it crosses a tenant boundary — the policy's ownership check was
-- always sound — so this is integrity rather than confidentiality: what Vibe
-- believes it asked, and what it believes it was told.
--
-- ## The shape of the fix is VB-018's
--
-- PostgreSQL cannot subtract a column from a table-level grant, so the grant is
-- withdrawn and re-issued per column — the same move
-- `20260827190354` made for `business_readiness_audits`. Three columns is the
-- whole of what a founder answering a question writes.
--
-- `updated_at` is deliberately not granted: `set_updated_at` assigns it on the
-- trigger's `NEW` record, which is not a privilege-checked write.
--
-- ## And the policy says which way the status may move
--
-- `open -> answered`, and only that. `cancelled` and `expired` are Vibe's
-- conclusions about its own run — `cancelOpenInterrupts` writes them from
-- durable execution with the service-role client, which no policy constrains.
-- A customer cancelling their own open question would be forging that
-- conclusion to unstick a run.
--
-- `USING` gains the same `open` requirement, so an answer cannot be revised
-- after the execution has already consumed it. The store function already
-- filtered on it; now the database does.

revoke update on public.execution_interrupts from authenticated;

grant update (status, answer, answered_at)
  on public.execution_interrupts to authenticated;

drop policy "answer own execution_interrupts" on public.execution_interrupts;

create policy "answer own execution_interrupts"
  on public.execution_interrupts
  for update using (
    status = 'open'
    and exists (
      select 1 from public.projects p
      where p.id = execution_interrupts.project_id and p.user_id = (select auth.uid())
    )
  ) with check (
    status = 'answered'
    and exists (
      select 1 from public.projects p
      where p.id = execution_interrupts.project_id and p.user_id = (select auth.uid())
    )
  );

-- VB-049, second half. `set_updated_at` is `SECURITY INVOKER`, so an unpinned
-- `search_path` is far less dangerous here than on a definer function — a
-- caller can only redirect resolution to something they already had the rights
-- to reach. It is pinned anyway: the argument for leaving it is "this one is
-- not exploitable", which is an argument that has to be re-made every time
-- somebody edits the body, and pinning it costs nothing.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
