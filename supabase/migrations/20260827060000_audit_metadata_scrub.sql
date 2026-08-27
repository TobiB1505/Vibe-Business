-- VB-002 M3 — anonymizing the audit log in place (ADR 0056 §8).
--
-- `audit_events` is the only table already architected to outlive its owner,
-- and it is the one place where nulling a foreign key achieves the least. The
-- row survives with `user_id` null and the JSONB payload keeps its contents
-- untouched — the Wave 0 run measured `audit_metadata_still_has_login =
-- octo-founder` after a full erasure. Nulling a foreign key is not
-- anonymization.
--
-- Two functions, and the split is the point. `scrub_audit_metadata` is a pure,
-- immutable transform on one JSONB value: it has no privileges, touches no
-- table, and can therefore be asserted directly against a fixture of every
-- event category, which is what §8 requires of an irreversible operation.
-- `erase_account_audit_metadata` is the privileged driver that applies it.
--
-- ## Why the transform recurses
--
-- §8 names `changedPaths[].path`, `largestChanges[].path` and `violations[].path`
-- as fields to pseudonymize. None of them is a top-level metadata key — they
-- are nested inside richer evidence objects, and the exact nesting differs per
-- event and will change again. A transform that walked a fixed set of top-level
-- keys would therefore be correct on the day it was written and quietly wrong
-- afterwards, on an operation that cannot be re-run. So the rules are applied
-- to every object at every depth, and the shape of the payload stops mattering.
--
-- ## Three verbs, per §8
--
--   * deleted — the key is removed outright;
--   * nulled  — the key survives with a null value, so the payload's shape
--               still reads and a consumer can tell "withheld" from "absent";
--   * pseudonymized — a `path` becomes a positional label, keeping status,
--               byte counts, artifact class and every count intact, so the
--               withheld-path incident record still answers what it was built
--               to answer.
--
-- Everything else is retained deliberately: commit SHAs, credit amounts and
-- ids, policy and model versions, closed-enum reasons and failure codes, counts
-- and durations, the non-reversible `intentHash`, and the approval/merge/outcome
-- family — which under rules 67–74 is the record of Vibe writing to a
-- customer's default branch, and is the strongest retention case in the schema.

create or replace function public.scrub_audit_metadata(m jsonb, p_position int default null)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- GitHub identity, the Stripe external join key, founder intent, the one
  -- unbounded free-text field in the vocabulary, and the project id that must
  -- go together with the column or the SET NULL is cosmetic.
  deleted_keys constant text[] := array[
    'githubLogin', 'accountLogin', 'githubRepositoryId',
    'externalReference',
    'message',
    'stage', 'monetizationModel', 'primaryGoal',
    'projectId', 'project_id'
  ];
  -- Origins, and Storage object paths — nulled at the same moment the objects
  -- themselves are deleted, because a path pointing at deleted bytes is worse
  -- than no path.
  nulled_keys constant text[] := array[
    'sourceOrigin', 'newOrigin', 'previousOrigin', 'beforeOrigin', 'public_origin',
    'beforeObjectPath', 'afterObjectPath'
  ];
  result jsonb;
  k text;
  v jsonb;
begin
  if m is null then return null; end if;

  if jsonb_typeof(m) = 'object' then
    result := '{}'::jsonb;
    for k, v in select key, value from jsonb_each(m) loop
      if k = any (deleted_keys) then
        continue;
      elsif k = any (nulled_keys) then
        result := result || jsonb_build_object(k, 'null'::jsonb);
      elsif k = 'path' and jsonb_typeof(v) = 'string' then
        -- Positional, so two different repositories' paths are
        -- indistinguishable while their ordering and count survive.
        result := result || jsonb_build_object(k, to_jsonb('path-' || coalesce(p_position, 1)::text));
      else
        result := result || jsonb_build_object(k, public.scrub_audit_metadata(v));
      end if;
    end loop;
    return result;
  end if;

  if jsonb_typeof(m) = 'array' then
    return coalesce(
      (
        select jsonb_agg(public.scrub_audit_metadata(element, ordinality::int) order by ordinality)
        from jsonb_array_elements(m) with ordinality as t (element, ordinality)
      ),
      '[]'::jsonb
    );
  end if;

  return m;
end;
$$;

comment on function public.scrub_audit_metadata(jsonb, int) is
  'ADR 0056 §8 — pure, irreversible anonymization of one audit_events payload.';

-- The privileged driver -------------------------------------------------------
--
-- `audit_events` has an INSERT policy and a SELECT policy and nothing else: it
-- is append-only by omission, so no application role can express this update
-- through the Data API. It runs as `security definer` for the same reason M1's
-- lifecycle function does — one named routine that can be granted, revoked and
-- asserted on, rather than an ad-hoc service-role UPDATE that any future caller
-- could copy.
--
-- It returns the row count so the erasure operation can record what it changed
-- without reading the rows back, and it never returns the rows themselves.

create or replace function public.erase_account_audit_metadata(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected bigint;
begin
  if p_user_id is null then
    raise exception 'erase_account_audit_metadata requires a user id';
  end if;

  update public.audit_events
  set metadata = public.scrub_audit_metadata(metadata),
      -- Together with the payload keys, per §8. By this point in the erasure
      -- the foreign key has usually nulled it already; stating it here means
      -- the function is correct whatever order it is called in.
      project_id = null
  where user_id = p_user_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.erase_account_audit_metadata(uuid) is
  'ADR 0056 §8 — scrubs every audit_events payload owned by one identity. Irreversible.';

revoke all on function public.scrub_audit_metadata(jsonb, int) from public, anon, authenticated;
revoke all on function public.erase_account_audit_metadata(uuid) from public, anon, authenticated;
grant execute on function public.erase_account_audit_metadata(uuid) to service_role;
