-- ADR 0041 §P2 — a distinct idempotency key per pause/resume cycle.
--
-- `pauseOperationForUser` releases the operation's held Credits (§P2). Resuming
-- re-acquires a fresh hold, and the reservation idempotency key already used for
-- the operation's first hold (`operation:<operationRunId>`) cannot be reused for
-- the second one: `claimReservation` replays an existing key regardless of the
-- reservation's status, so a second call with the same key would return the
-- first (now released) reservation rather than take a new one.
--
-- `pause_cycle` is incremented inside `pauseOperationForUser`'s existing guarded
-- UPDATE (`operations/store.ts` — no new write, no new race) and gives each
-- pause a distinct, stable, retry-safe number: the resume key becomes
-- `operation:<operationRunId>:resume:<pauseCycle>`, so a step that re-enters
-- after a crash re-reads the same cycle and lands on the same reservation
-- rather than taking a second one.
alter table public.operation_runs
  add column pause_cycle smallint not null default 0;

comment on column public.operation_runs.pause_cycle is
  'How many times this operation has been paused for the user (ADR 0041 §P2). Incremented by pauseOperationForUser; used to give each pause/resume cycle its own reservation idempotency key.';
