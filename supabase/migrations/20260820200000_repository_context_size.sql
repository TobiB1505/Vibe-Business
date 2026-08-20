-- ---------------------------------------------------------------------
-- Repository context size: how big the thing being compressed was (Sprint 0053)
-- ---------------------------------------------------------------------
-- Production run 5ea8a9a0 re-ran the same Action Step as run #6, at the same
-- pricing class, and cost 2.16× as much: $0.1444 → $0.3115 of model spend,
-- 79.9s → 201.5s, 10 → 14 provider calls, 4 → 14 unique files read. Nothing
-- about the *task* changed. The repository had grown three relevant files
-- underneath it, and the agent correctly read them.
--
-- That is a cost driver this table could not express. Every existing context_*
-- column measures **what Vibe sent** — a bounded, Vibe-controlled compression —
-- and the closest proxy was saturated: context_candidates_sent went 6 → 12
-- against BRIEF_BUDGET.maxCandidates = 12, so it cannot distinguish a
-- repository with twelve relevant files from one with fifty.
--
-- These six columns record how large the thing being compressed was, so that
-- "what drives a Credit's cost" can be answered by a query rather than by
-- reconstructing runs by hand. The numbers are not new measurements: the
-- repository analyzer already counts every one of them on the snapshot. This
-- projects them onto the run, so repository shape and run cost are joinable
-- without walking back to the snapshot each time.
--
-- ## Why nothing here is a copy of the repository (Rule 26)
--
-- Six integers. No path, no filename, no content, no manifest. Derived
-- intelligence about size, which is the only thing pricing needs.
--
-- ## Why every column is nullable, and why null is never zero
--
-- Written only for a run whose snapshot is *fresh* — one that describes the
-- exact commit the run worked against. A stale snapshot describes a different
-- tree, and reporting its size as this run's would be precisely the
-- confidently-wrong number the brief's freshness gate exists to refuse. Null
-- means "not measured"; zero would claim an empty repository. Every existing
-- row is null, and no back-fill is invented for runs that never recorded it.
--
-- context_candidates_available is the exception in one respect: a run with no
-- usable snapshot genuinely had zero candidates to offer, and zero is the true
-- count there rather than a missing measurement.

alter table public.agent_execution_runs
  add column repo_tree_entries integer
    check (repo_tree_entries is null or repo_tree_entries >= 0),
  add column repo_files_analyzed integer
    check (repo_files_analyzed is null or repo_files_analyzed >= 0),
  add column repo_bytes_analyzed integer
    check (repo_bytes_analyzed is null or repo_bytes_analyzed >= 0),
  add column repo_routes_detected integer
    check (repo_routes_detected is null or repo_routes_detected >= 0),
  add column repo_surfaces_detected integer
    check (repo_surfaces_detected is null or repo_surfaces_detected >= 0),
  add column context_candidates_available integer
    check (context_candidates_available is null or context_candidates_available >= 0);

comment on column public.agent_execution_runs.repo_tree_entries is
  'Tree entries the repository analyzer considered at the pinned commit. The broadest available measure of repository size. Null when no fresh snapshot described this run''s commit — never zero, which would claim an empty repository.';

comment on column public.agent_execution_runs.repo_files_analyzed is
  'Files whose contents the analyzer actually fetched at the pinned commit. Bounded by the analyzer''s own read budget, so it measures analysis effort rather than repository size.';

comment on column public.agent_execution_runs.repo_bytes_analyzed is
  'Bytes of those files. Paired with repo_files_analyzed because average file size is itself a cost signal.';

comment on column public.agent_execution_runs.repo_routes_detected is
  'Routes the analyzer resolved at the pinned commit. The closest single number to "how much product exists", and the one that grew between run #6 and run #9.';

comment on column public.agent_execution_runs.repo_surfaces_detected is
  'Business surfaces the analyzer recognised at the pinned commit.';

comment on column public.agent_execution_runs.context_candidates_available is
  'File candidates the Context Compiler had before BRIEF_BUDGET.maxCandidates cut the list. De-saturates context_candidates_sent: without it, "the brief was clipped at 12" is indistinguishable from "the repository offered exactly 12".';
