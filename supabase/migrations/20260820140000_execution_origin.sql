-- ---------------------------------------------------------------------
-- execution_origin: tell a benchmark run from a customer run
-- ---------------------------------------------------------------------
-- A controlled agent benchmark sometimes needs an execution shape the Business
-- Audit and Planner would not naturally produce — a small UI change, a task
-- with no evidence, a task whose surface is every public page. Bending the
-- Planner to manufacture one would corrupt the thing every downstream
-- measurement is taken against, so an internal fixture replaces exactly one
-- span (Audit → Opportunity → Move → Action Plan) and nothing below it.
--
-- Those runs are real executions: real spec, real context, real policy, real
-- provider spend, real Prepared Change, real validation. So they land in the
-- same tables — and that is precisely why they have to be labelled. Economics
-- read across `agent_execution_runs` would otherwise average a benchmark that
-- exists to be re-run into a customer cost figure, and nobody would know.
--
-- Derived server-side from the persisted spec's own step key, never supplied by
-- a caller: a benchmark must be visible as one, so it cannot be the thing that
-- decides whether it is labelled as one.
--
-- Default 'planner' and backfilled to it. Every row before this migration was a
-- Planner-generated execution; that is a fact about how they were started, not
-- an assumption.

alter table public.agent_execution_runs
  add column execution_origin text not null default 'planner'
    check (execution_origin in ('planner', 'dogfood_fixture')),
  add column dogfood_fixture_id text
    check (dogfood_fixture_id is null or char_length(btrim(dogfood_fixture_id)) > 0);

-- A fixture id exists if and only if the run came from one. The pair cannot
-- disagree, so a filtered read cannot be half right.
alter table public.agent_execution_runs
  add constraint agent_execution_runs_origin_fixture_check
    check (
      (execution_origin = 'dogfood_fixture' and dogfood_fixture_id is not null)
      or (execution_origin = 'planner' and dogfood_fixture_id is null)
    );

comment on column public.agent_execution_runs.execution_origin is
  'planner = the step came from a customer Action Plan. dogfood_fixture = the step came from a Vibe-authored internal benchmark fixture. Derived from the immutable spec step key, never from a caller. Filter production economics on this.';

comment on column public.agent_execution_runs.dogfood_fixture_id is
  'The internal benchmark fixture this run executed, e.g. low-ui-primary-cta. Null for every customer execution.';

create index if not exists agent_execution_runs_origin_idx
  on public.agent_execution_runs (execution_origin, created_at desc);
