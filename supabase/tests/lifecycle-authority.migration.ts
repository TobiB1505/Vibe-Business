import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-001 M1 — the database authority behind project deletion (ADR 0056 §5).
 *
 * Every assertion here runs against a real PostgreSQL cluster this suite
 * provisions and destroys. That is not thoroughness for its own sake: the
 * launch audit's root cause for this defect was reasoned from migration text
 * and was wrong, and the two facts M1's design rests on — that a cascade
 * elevates past the caller's privileges, and that the parent row is already
 * gone when the cascaded trigger fires — are not visible in the SQL at all.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MARKER = "vibe.lifecycle_erasure";

let db: Cluster;

/** Ids for one fresh full-depth project, created outside any test transaction. */
function makeProject(label: string): { userId: string; projectId: string; specId: string } {
  const [userId, projectId, specId] = db
    .sql(`select user_id, project_id, spec_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");
  return { userId, projectId, specId };
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("execution_specs immutability survives M1", () => {
  it("A. refuses a normal UPDATE", () => {
    const { projectId } = makeProject("upd");
    const error = db.sqlExpectingError(
      `update public.execution_specs set step_key = 'tampered' where project_id = '${projectId}';`,
    );
    expect(error).toContain("execution_specs rows are immutable");
  });

  it("B. refuses a normal direct DELETE", () => {
    const { projectId } = makeProject("del");
    const error = db.sqlExpectingError(
      `delete from public.execution_specs where project_id = '${projectId}';`,
    );
    expect(error).toContain("execution_specs rows are immutable");
    expect(db.sql(`select count(*) from public.execution_specs where project_id = '${projectId}';`)).toBe("1");
  });

  it("H. refuses UPDATE even while the lifecycle marker is set", () => {
    const { projectId } = makeProject("updflag");
    const error = db.sqlExpectingError(`
      begin;
        select set_config('${MARKER}', 'on', true);
        update public.execution_specs set step_key = 'tampered' where project_id = '${projectId}';
      commit;
    `);
    expect(error).toContain("execution_specs rows are immutable");
    expect(
      db.sql(`select step_key from public.execution_specs where project_id = '${projectId}';`),
    ).toBe("step-1");
  });

  /**
   * The property a privilege revoke cannot give, because an owner's rights are
   * implicit: even `postgres`, holding the marker, cannot delete a spec whose
   * project still exists. Direct spec deletion is unreachable for every role.
   */
  it("refuses a direct DELETE by the table owner even with the marker set", () => {
    const { projectId } = makeProject("owner");
    const error = db.sqlExpectingError(`
      begin;
        select set_config('${MARKER}', 'on', true);
        delete from public.execution_interrupts where project_id = '${projectId}';
        delete from public.agent_execution_runs where project_id = '${projectId}';
        delete from public.execution_specs where project_id = '${projectId}';
      commit;
    `);
    expect(error).toContain("execution_specs rows are immutable");
  });
});

describe("the marker is never the authority", () => {
  it("C. refuses service_role forging the marker and deleting specs directly", () => {
    const { projectId } = makeProject("forge-sr");
    const error = db.sqlExpectingError(`
      begin;
        set local role service_role;
        select set_config('${MARKER}', 'on', true);
        delete from public.execution_specs where project_id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table execution_specs");
  });

  it("D. refuses authenticated forging the marker and deleting specs directly", () => {
    const { projectId } = makeProject("forge-auth");
    const error = db.sqlExpectingError(`
      begin;
        set local role authenticated;
        select set_config('${MARKER}', 'on', true);
        delete from public.execution_specs where project_id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table execution_specs");
  });

  /**
   * The cascade path, which the privilege revoke above does not bind: RI
   * actions run as the referencing table's owner. What stops `service_role`
   * here is that it no longer holds DELETE on the root table, so the forged
   * marker has nothing to act on.
   */
  it("refuses service_role forging the marker and deleting the root project row", () => {
    const { projectId } = makeProject("forge-root");
    const error = db.sqlExpectingError(`
      begin;
        set local role service_role;
        select set_config('${MARKER}', 'on', true);
        delete from public.projects where id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table projects");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
  });

  it("still refuses a plain project delete when no marker is set", () => {
    const { projectId } = makeProject("nomarker");
    const error = db.sqlExpectingError(`delete from public.projects where id = '${projectId}';`);
    expect(error).toContain("execution_specs rows are immutable");
  });
});

/**
 * VB-001 M1a's invariant — the one that makes M1 deployable.
 *
 * > **No Data API role can start a project cascade.**
 *
 * This block replaces a characterisation test that asserted the opposite. M1
 * shipped with `authenticated` still holding `DELETE ON public.projects`,
 * because `connect.ts` and `disconnect.ts` both rode on it, and an owner who
 * forged the lifecycle marker could therefore destroy their own execution
 * history outside the lifecycle routine — measured, under RLS, as that user.
 *
 * Migration B revoked the privilege once both callers moved onto narrow
 * functions. What is left is what ADR 0056 always claimed the marker was:
 * context, carrying no authority, because there is no longer a delete to
 * attach it to.
 */
describe("no Data API role can start a project cascade", () => {
  /** Acts as PostgREST does: the role plus that user's JWT subject. */
  function asOwner(userId: string): string {
    return `select set_config('request.jwt.claim.sub', '${userId}', true);
            set local role authenticated;`;
  }

  it("A. refuses an authenticated owner deleting their own project", () => {
    const { userId, projectId } = makeProject("auth-direct");
    const error = db.sqlExpectingError(`
      begin;
        ${asOwner(userId)}
        delete from public.projects where id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table projects");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
  });

  it("B. refuses that same owner holding a forged lifecycle marker", () => {
    const { userId, projectId } = makeProject("auth-forged");
    const error = db.sqlExpectingError(`
      begin;
        ${asOwner(userId)}
        select set_config('${MARKER}', 'on', true);
        delete from public.projects where id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table projects");
    expect(
      db.sql(`select count(*) from public.execution_specs where project_id = '${projectId}';`),
    ).toBe("1");
  });

  it("C. refuses service_role deleting a project", () => {
    const { projectId } = makeProject("sr-direct");
    const error = db.sqlExpectingError(`
      begin;
        set local role service_role;
        delete from public.projects where id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table projects");
  });

  it("D. refuses service_role holding a forged lifecycle marker", () => {
    const { projectId } = makeProject("sr-forged");
    const error = db.sqlExpectingError(`
      begin;
        set local role service_role;
        select set_config('${MARKER}', 'on', true);
        delete from public.projects where id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table projects");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
  });

  it("refuses anon, which RLS blocked but the platform grant did not", () => {
    const { projectId } = makeProject("anon-direct");
    const error = db.sqlExpectingError(`
      begin;
        set local role anon;
        select set_config('${MARKER}', 'on', true);
        delete from public.projects where id = '${projectId}';
      commit;
    `);
    expect(error).toContain("permission denied for table projects");
  });

  /**
   * The catalog assertion the invariant reduces to. It is what a future
   * blanket `GRANT ... ON ALL TABLES IN SCHEMA public` would break — silently,
   * everywhere else — and it fails here instead.
   */
  it("grants DELETE on projects to no Data API role", () => {
    const holders = db.sql(`
      select coalesce(string_agg(grantee, ',' order by grantee), '<none>')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'projects'
        and privilege_type = 'DELETE'
        and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
    `);
    expect(holders).toBe("<none>");
  });
});

describe("erase_project_lifecycle", () => {
  it("E. deletes the owned project and its whole subtree", () => {
    const { userId, projectId } = makeProject("erase");
    expect(
      db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`),
    ).toBe("t");

    const remaining = db.sql(`
      select
        (select count(*) from public.projects where id = '${projectId}')
        || ',' || (select count(*) from public.execution_specs where project_id = '${projectId}')
        || ',' || (select count(*) from public.execution_interrupts where project_id = '${projectId}')
        || ',' || (select count(*) from public.agent_execution_runs where project_id = '${projectId}')
        || ',' || (select count(*) from public.operation_runs where project_id = '${projectId}')
        || ',' || (select count(*) from public.business_readiness_audits where project_id = '${projectId}')
        || ',' || (select count(*) from public.action_plans where project_id = '${projectId}')
        || ',' || (select count(*) from public.opportunity_sets where project_id = '${projectId}')
        || ',' || (select count(*) from public.product_profiles where project_id = '${projectId}')
        || ',' || (select count(*) from public.repository_intelligence_snapshots where project_id = '${projectId}')
        || ',' || (select count(*) from public.live_product_intelligence_snapshots where project_id = '${projectId}')
        || ',' || (select count(*) from public.repository_connections where project_id = '${projectId}');
    `);
    expect(remaining).toBe("0,0,0,0,0,0,0,0,0,0,0,0");
  });

  /**
   * L. The regression ADR 0056 §5 asks for. An execution interrupt referencing
   * a spec with ON DELETE RESTRICT is what makes direct spec deletion
   * impossible; this pins that the root-delete design is unaffected by it.
   */
  it("L. deletes a project whose spec is referenced by an execution interrupt", () => {
    const { userId, projectId, specId } = makeProject("interrupt");
    expect(
      db.sql(
        `select count(*) from public.execution_interrupts where execution_spec_id = '${specId}';`,
      ),
    ).toBe("1");

    expect(db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`)).toBe("t");
    expect(
      db.sql(`select count(*) from public.execution_interrupts where execution_spec_id = '${specId}';`),
    ).toBe("0");
  });

  it("F. mutates nothing when another user names the project", () => {
    const victim = makeProject("victim");
    const attacker = makeProject("attacker");

    expect(
      db.sql(`select public.erase_project_lifecycle('${victim.projectId}', '${attacker.userId}');`),
    ).toBe("f");
    expect(db.sql(`select count(*) from public.projects where id = '${victim.projectId}';`)).toBe("1");
    expect(
      db.sql(`select count(*) from public.execution_specs where project_id = '${victim.projectId}';`),
    ).toBe("1");
  });

  it("G. returns false on a second call without raising", () => {
    const { userId, projectId } = makeProject("twice");
    expect(db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`)).toBe("t");
    expect(db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`)).toBe("f");
    expect(db.sql(`select public.erase_project_lifecycle(null, null);`)).toBe("f");
  });

  it("I. leaves the marker unset once the transaction ends", () => {
    const { userId, projectId } = makeProject("marker");
    db.sql(`select public.erase_project_lifecycle('${projectId}', '${userId}');`);
    expect(db.sql(`select coalesce(current_setting('${MARKER}', true), '<unset>');`)).toBe("<unset>");
  });

  it("service_role may execute it; anon and authenticated may not", () => {
    const grants = db.sql(`
      select string_agg(g, ',' order by g) from (
        select r.rolname || '=' ||
          has_function_privilege(r.rolname, 'public.erase_project_lifecycle(uuid,uuid)', 'EXECUTE')::text as g
        from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
      ) s;
    `);
    expect(grants).toBe("anon=false,authenticated=false,service_role=true");
  });
});

describe("J. privilege catalog", () => {
  it("grants DELETE on execution_specs to no Data API role", () => {
    const holders = db.sql(`
      select coalesce(string_agg(grantee, ',' order by grantee), '<none>')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'execution_specs'
        and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
    `);
    expect(holders).toBe("<none>");
  });

  it("pins the two lifecycle functions and their reach", () => {
    const grants = db.sql(`
      select string_agg(g, ',' order by g) from (
        select p.proname || ':' || r.rolname || '=' ||
          has_function_privilege(r.rolname, p.oid, 'EXECUTE')::text as g
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
        where p.proname in ('detach_repository', 'erase_project_lifecycle')
      ) s;
    `);
    expect(grants).toBe(
      [
        "detach_repository:anon=false",
        "detach_repository:authenticated=false",
        "detach_repository:service_role=true",
        "erase_project_lifecycle:anon=false",
        "erase_project_lifecycle:authenticated=false",
        "erase_project_lifecycle:service_role=true",
      ].join(","),
    );
  });

  it("pins the lifecycle function's security properties", () => {
    const shape = db.sql(`
      select p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '<none>')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'erase_project_lifecycle';
    `);
    expect(shape).toBe('true|search_path=""');
  });

  /**
   * The rule that produced migration `20260818131334`: Supabase's security
   * advisor flags a `SECURITY DEFINER` function in `public` that `anon` can
   * reach over `/rest/v1/rpc/`. `supabase db lint` needs `plpgsql_check` and a
   * platform image, so the rule is asserted here instead — where it fails on a
   * regression rather than on the day somebody remembers to run the advisor.
   */
  it("exposes no unreviewed SECURITY DEFINER function in public to anon or authenticated", () => {
    const reachable = db.sql(`
      select coalesce(string_agg(distinct p.proname, ',' order by p.proname), '<none>')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      cross join (values ('anon'), ('authenticated')) as r(role)
      where p.prosecdef
        and has_function_privilege(r.role, p.oid, 'EXECUTE');
    `);

    // Exactly one exception, and the argument for it is below. Anything else
    // appearing here is a privilege-escalation surface nobody argued for.
    //
    // `record_auth_attempt` (VB-010) has to be both. `SECURITY DEFINER`,
    // because the sign-in throttle must be writable by a caller who cannot
    // read it, cannot clear it and cannot see another account's — and
    // `20260827190821` left `anon` with no privilege on any table, which is
    // what makes that possible rather than what obstructs it. Reachable by
    // `anon`, because sign-in happens before there is a session, so `anon` is
    // who is asking.
    //
    // What bounds it is its own shape: it takes a SHA-256 and a boolean,
    // returns two integers, reads and writes exactly one row keyed by that
    // hash, and raises on anything that is not a hash. There is no argument
    // through which it can reach another table or another account's row.
    //
    // `disconnect_project` used to sit here too: it had to be
    // `SECURITY DEFINER` (its caller holds no `DELETE ON public.projects`) and
    // had to be reachable by `authenticated`, because a founder clicking
    // Disconnect was its only caller. It was safe — it took no owner argument,
    // so its reach was exactly the `delete own projects` RLS policy it
    // replaced — but it was still an exception, and `20260827020000` dropped
    // the function once Disconnect stopped being destructive.
    expect(reachable).toBe("record_auth_attempt");
  });

  it("pins search_path on every SECURITY DEFINER function in public", () => {
    const unpinned = db.sql(`
      select coalesce(string_agg(p.proname, ',' order by p.proname), '<none>')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
        );
    `);
    expect(unpinned).toBe("<none>");
  });

  it("keeps the trigger guard unelevated with a pinned search_path", () => {
    const shape = db.sql(`
      select p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '<none>')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'reject_execution_spec_mutation';
    `);
    expect(shape).toBe('false|search_path=""');
  });
});

/**
 * K. The migration's central claim about what it did *not* touch. F1 measured
 * that these edges never blocked the cascade, so converting them would be churn
 * against a non-cause; this fails if a later change quietly converts one.
 */
describe("K. no intra-project RESTRICT foreign key was modified", () => {
  it("keeps every RESTRICT edge the schema had", () => {
    const edges = db.sql(`
      select string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname)
      from pg_constraint t
      join pg_class c on c.oid = t.conrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attnum = t.conkey[1]
      where t.contype = 'f' and t.confdeltype = 'r';
    `);
    expect(edges.split(",")).toEqual([
      "action_plans.business_audit_id",
      "action_plans.opportunity_set_id",
      "action_plans.product_profile_id",
      "agent_execution_runs.execution_spec_id",
      "billing_credit_allocations.grant_id",
      "billing_credit_allocations.reservation_id",
      "billing_credit_grants.ledger_entry_id",
      "billing_credit_ledger.refunds_ledger_entry_id",
      "business_outcome_measurements.change_merge_id",
      "business_readiness_audits.live_snapshot_id",
      "business_readiness_audits.product_profile_id",
      "business_readiness_audits.repository_snapshot_id",
      "change_approvals.review_artifact_id",
      "change_merges.change_approval_id",
      "change_merges.repository_connection_id",
      "change_outcome_verifications.change_approval_id",
      "change_outcome_verifications.change_merge_id",
      "execution_interrupts.execution_spec_id",
      "execution_specs.action_plan_id",
      "execution_specs.business_audit_id",
      "execution_specs.repository_connection_id",
      "execution_specs.repository_snapshot_id",
      "measurement_plans.change_merge_id",
      "opportunity_sets.business_audit_id",
      "prepared_changes.opportunity_id",
      "prepared_changes.opportunity_set_id",
      "prepared_changes.repository_snapshot_id",
      "product_profiles.authenticated_snapshot_id",
      "product_profiles.live_snapshot_id",
      "product_profiles.repository_snapshot_id",
      "project_founder_resolutions.request_id",
      "project_founder_resolutions.supersedes_resolution_id",
      // `repository_connections.github_installation_id` deliberately left this
      // list in VB-002 M2′. It is not an intra-project edge and F1 is not what
      // covers it: F3 measured it as the depth-mismatched account-level RESTRICT
      // that made every user who had ever connected a repository undeletable,
      // and ADR 0056 §11 converts exactly this one to `no action deferrable
      // initially deferred`. `installation-reference.migration.ts` asserts both
      // halves of that — the erasure it now permits, and the orphaning it still
      // refuses at commit.
      "repository_intelligence_snapshots.repository_connection_id",
    ]);
  });
});
