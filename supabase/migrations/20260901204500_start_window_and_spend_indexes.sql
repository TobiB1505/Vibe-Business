-- Three access paths that read a whole history to answer a question about the
-- last hour (PERF-010).
--
-- Each of these runs on a hot path, filters on a window, and had no index that
-- reached the window's column. At today's row counts none of them is slow —
-- the largest table in the database holds about a thousand rows — so this is
-- not a repair of an observed problem. It is the difference between a cost
-- that stays flat and one that grows with every operation a customer ever
-- starts, added while the tables are small enough for the change to be free.
--
-- ## `operation_runs (user_id, operation_type, created_at desc)`
--
-- `withinStartWindows` counts an account's recent starts of one operation type
-- before every operation begins. `operation_runs` has two indexes that lead
-- with `user_id` and both are **partial** — one to the single-active identity
-- (`project_id is null and status in ('queued','running')`), one to active
-- account erasures — so neither can serve a count over an account's whole
-- history. That count therefore had no usable index at all and scanned every
-- run the account has ever started, to answer a question about the last hour.
--
-- It also gives `operation_runs.user_id` its first complete index, which the
-- account-erasure cascade and the `project_id is null` branch of the table's
-- RLS policy both walk.
--
-- ## `operation_runs (project_id, operation_type, created_at desc)`
--
-- The project-scoped half of the same check. `operation_runs_identity_idx`
-- supplies the `(project_id, operation_type)` prefix but carries
-- `input_identity` third and no timestamp, so the window was a heap filter
-- over every run of that type the project has.
--
-- ## `ai_usage_events (user_id, created_at desc)`
--
-- `observeAccountSpend` runs after **every** billed provider call and reads up
-- to 500 rows from the last 24 hours. The table's only index on the column is
-- `(user_id)` alone, generated for the foreign key, so PostgreSQL walks the
-- user's entire usage history in index order and filters on `created_at` until
-- it has collected 500 matches — worst on exactly the account that has used
-- the product most.
--
-- ## What this migration deliberately does not do
--
-- The foreign-key index generator in `wave2_database_hygiene.sql` treats a
-- partial index as covering, because its coverage predicate omits
-- `i.indpred is null`. Five further foreign keys are left with partial-only
-- cover by that gap. They are deletion-cascade paths on small tables rather
-- than hot reads, so closing them is its own change with its own argument, not
-- a rider on this one.
--
-- Written without `concurrently`, following every other index in this
-- directory: these tables are small, the build is instantaneous, and
-- `concurrently` cannot run inside the transaction a migration is applied in.

create index if not exists operation_runs_user_type_created_idx
  on public.operation_runs (user_id, operation_type, created_at desc);

create index if not exists operation_runs_project_type_created_idx
  on public.operation_runs (project_id, operation_type, created_at desc);

create index if not exists ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);
