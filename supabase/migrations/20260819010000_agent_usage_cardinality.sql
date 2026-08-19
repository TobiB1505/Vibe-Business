-- EXECUTION CORE-4 runtime placement: one agent execution, many sampling calls.
--
-- Found by the first real agent run, not by a test. The run reached Anthropic
-- through the Agent Gateway 27 times in five minutes; the first call recorded a
-- usage row and every one after it failed with
--
--     duplicate key value violates unique constraint "ai_usage_events_job_idx"
--
-- ## What the old constraint was for, and why it was right
--
-- `20260812010000_operation_runs.sql` states it plainly: "One provider call per
-- audit means one usage event per audit. Under durable execution a step can in
-- principle be entered twice, so 'we only call this once' stops being an
-- argument and has to become a constraint."
--
-- That reasoning still holds for every operation it was written for. A business
-- audit, an opportunity generation, a product understanding and an action plan
-- each make exactly one structured-generation call per operation, keyed on the
-- operation's own result id. A second row for one of those job ids means a step
-- was entered twice and a customer was charged twice, and the database refusing
-- it is the last line of defence.
--
-- ## Why an agent run cannot live under it
--
-- An agentic execution is the first job in this product that is a *loop*. The
-- harness re-sends a growing transcript every turn, and each turn is its own
-- billed request. Forty turns is forty rows, and forty rows is the point: the
-- Agent Gateway reads this ledger back on every request to decide whether the
-- run has spent its authorization (ADR 0029 §2).
--
-- So the defect was worse than lost accounting. With exactly one row that could
-- ever exist, `readAgentRunGatewayState` saw `forwardedRequests = 1` and
-- `spentOutputTokens = 0` forever, and the gateway's containment ceilings could
-- never bind. A runaway run would not have been stopped.
--
-- ## The smallest safe change
--
-- Uniqueness is kept, and kept *exactly* as strong, for every operation that
-- has always had it. It is lifted only for `agentic_execution`, which never had
-- it and structurally cannot. This is enforcement moved to the boundary where
-- it is true rather than weakened globally.
--
-- An agent run's own idempotency is not affected and never lived here: it is
-- the unique index on `agent_execution_runs (project_id, run_identity)` for
-- active runs, plus `markAgentRunStarted` scoping the paid-loop claim to
-- `queued`. Those decide whether a second agent *runs*. This index only ever
-- decided whether a second usage row could be *written*.

-- ---------------------------------------------------------------------
-- 1. Uniqueness, unchanged for every operation that already had it.
-- ---------------------------------------------------------------------
drop index if exists public.ai_usage_events_job_idx;

create unique index ai_usage_events_job_idx
  on public.ai_usage_events (job_id)
  where job_id is not null and operation <> 'agentic_execution';

-- ---------------------------------------------------------------------
-- 2. The lookup the gateway makes on every single sampling request.
--
-- Not covered by the partial unique index above, which excludes exactly the
-- rows this query reads. Without it, every request a live agent run makes would
-- be a sequential scan of the whole usage ledger — on the hot path of a proxy
-- that holds an API key.
-- ---------------------------------------------------------------------
create index if not exists ai_usage_events_job_lookup_idx
  on public.ai_usage_events (job_id)
  where job_id is not null;
