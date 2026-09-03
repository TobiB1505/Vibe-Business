-- The founder names which application Vibe works on (Stufe 4).
--
-- A repository can hold more than one independently installable application,
-- and "which one did we just validate?" has no single answer for it. Picking
-- the first would be a guess reported as a verdict, so Vibe asks — once — and
-- remembers.
--
-- ## Why a column rather than `founder_input_requests`
--
-- That table is the pipe for planner-authored, open-ended business content:
-- generated options, free text, a resolved statement. A workspace root is a
-- **path Vibe runs commands in**, and rule 57 leaves less room for paths than
-- for prose. Its CHECK constraints also require either an action plan or an
-- execution interrupt, and a project-level setup question has neither. And a
-- founder-input resolution is an immutable, superseded-by-chain record of a
-- business decision, while this is a setting a founder should be able to change
-- without a supersession chain.
--
-- ## What still decides
--
-- Nothing here is permission. `selectValidationTarget` only ever matches this
-- value against the candidates Vibe computed from the current snapshot, by
-- exact string equality — it never joins, normalizes or repairs a path. A
-- stored answer that is no longer a candidate asks again (rule 55).

alter table public.repository_connections
  add column if not exists workspace_root text,
  add column if not exists workspace_root_chosen_at timestamptz;

-- The shape is a constraint rather than a convention, because this value
-- becomes a sandbox working directory. `..` is excluded explicitly: the
-- character class accepts two dots quite happily, and a path that escapes its
-- repository is the one thing this column must never hold.
alter table public.repository_connections
  drop constraint if exists repository_connections_workspace_root_shape;

alter table public.repository_connections
  add constraint repository_connections_workspace_root_shape
    check (
      workspace_root is null
      or workspace_root = '.'
      or (
        workspace_root ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
        and workspace_root !~ '(^|/)\.\.(/|$)'
      )
    );

-- A choice and the moment it was made are one fact. Either both are present or
-- neither is: a root with no timestamp could not be told from a default, and a
-- timestamp with no root records that somebody answered without saying what.
alter table public.repository_connections
  drop constraint if exists repository_connections_workspace_root_chosen;

alter table public.repository_connections
  add constraint repository_connections_workspace_root_chosen
    check ((workspace_root is null) = (workspace_root_chosen_at is null));

comment on column public.repository_connections.workspace_root is
  'Which application in this repository Vibe works on, chosen by the owner from a closed list Vibe computed. Null means it has not been asked, not that the root was chosen.';

-- ---------------------------------------------------------------------
-- Who may write it
-- ---------------------------------------------------------------------
--
-- `authenticated` holds no UPDATE on this table, and that is deliberate:
-- `20260827010000` withdrew it because the row's RLS update policy lets the
-- owner set *any* column, so a granted UPDATE would let a caller write
-- `detached_at` straight over PostgREST and walk past the detach gate.
--
-- The obvious way back in is a `SECURITY DEFINER` setter, in the shape
-- `detach_repository` uses. It is the wrong way. `lifecycle-authority` asserts
-- that **no** definer function in `public` is reachable by `anon` or
-- `authenticated`, and records why the two that once were are gone rather than
-- grandfathered — the second because its bound was on what an argument could
-- reach rather than on who could pass one. An exception here would spend that
-- assertion to solve a problem PostgreSQL already solves.
--
-- A column-level grant says the same thing without a new callable surface: the
-- owner may update these two columns and no others, and the existing `update
-- own repository_connections` policy still decides *which rows*. Writing
-- `detached_at` stays denied at the privilege layer, which is where it was
-- denied before.
grant update (workspace_root, workspace_root_chosen_at)
  on table public.repository_connections to authenticated;
