import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-001 M1a — the two narrow functions that replaced `DELETE ON projects`.
 *
 * Both are asserted through the role PostgREST would use, because that is the
 * whole subject: the point of this slice is not what the functions compute but
 * what privilege a browser-scoped caller needs to reach them.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MARKER = "vibe.lifecycle_erasure";

let db: Cluster;

/** Repository ids are globally unique in the schema, so fixtures must not collide. */
let nextRepositoryId = 700_000;
function freshRepositoryId(): number {
  nextRepositoryId += 1;
  return nextRepositoryId;
}

function makeProject(label: string): { userId: string; projectId: string } {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");
  return { userId, projectId };
}

/** A user and an installation, with no project — the connect flow's start. */
function makeInstallation(label: string): { userId: string; installationId: string } {
  const [userId, installationId] = db
    .sql(
      `with u as (insert into auth.users (email) values ('${label}@fixture.test') returning id),
            i as (
              insert into public.github_installations
                (user_id, installation_id, github_account_id, github_account_login,
                 account_type, repository_selection)
              select u.id, (random()*1000000000)::bigint, (random()*1000000000)::bigint,
                     'octo-${label}', 'User', 'all'
              from u returning user_id, id
            )
       select i.user_id, i.id from i;`,
    )
    .split("|");
  return { userId, installationId };
}

/** Acts as PostgREST does: the role plus that user's JWT subject. */
function asUser(userId: string): string {
  return `select set_config('request.jwt.claim.sub', '${userId}', true);
          set local role authenticated;`;
}

function connectCall(installationId: string, repoId: string, name: string): string {
  return `select project_id, coalesce(failure, '-') from public.create_project_with_repository(
    '${name}', '${installationId}'::uuid, ${repoId}::bigint,
    'octo', '${name}', 'octo/${name}', 'main', false, 'https://github.com/octo/${name}');`;
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

describe("create_project_with_repository is one transaction", () => {
  it("1. creates the project and its connection", () => {
    const { userId, installationId } = makeInstallation("happy");
    const [projectId, failure] = db
      .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, `${freshRepositoryId()}`, "happy")} commit;`)
      .split("|");

    expect(failure).toBe("-");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
    expect(
      db.sql(`select full_name from public.repository_connections where project_id = '${projectId}';`),
    ).toBe("octo/happy");
  });

  it("2. classifies an already-connected repository", () => {
    const taken = makeProject("taken");
    const repoId = db.sql(
      `select github_repository_id from public.repository_connections
        where project_id = '${taken.projectId}';`,
    );
    const { userId, installationId } = makeInstallation("dupe");

    const [projectId, failure] = db
      .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, "dupe")} commit;`)
      .split("|");

    expect(failure).toBe("duplicate_repository");
    expect(projectId).toBe("");
  });

  it("3. leaves zero orphan projects when the connection insert fails", () => {
    const taken = makeProject("taken-orphan");
    const repoId = db.sql(
      `select github_repository_id from public.repository_connections
        where project_id = '${taken.projectId}';`,
    );
    const { userId, installationId } = makeInstallation("orphan");

    db.sql(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, "orphan")} commit;`);

    // The failure path is a rollback, not a compensating delete. Nothing to
    // clean up means nothing that can fail to be cleaned up.
    expect(db.sql(`select count(*) from public.projects where user_id = '${userId}';`)).toBe("0");
  });

  it("4. cannot create a project for another user", () => {
    const victim = makeInstallation("victim");
    const attacker = makeInstallation("attacker");

    // The attacker names the victim's installation. There is no argument in
    // which to name the victim as owner — the row takes `auth.uid()`.
    const error = db.sqlExpectingError(
      `begin; ${asUser(attacker.userId)} ${connectCall(victim.installationId, `${freshRepositoryId()}`, "steal")} commit;`,
    );

    // The repository_connections insert policy requires the caller to own the
    // installation too, so the whole transaction is refused.
    expect(error).toContain("row-level security policy");
    expect(db.sql(`select count(*) from public.projects where user_id = '${victim.userId}';`)).toBe("0");
    expect(db.sql(`select count(*) from public.projects where user_id = '${attacker.userId}';`)).toBe("0");
  });

  it("5. needs no DELETE privilege on projects", () => {
    const holders = db.sql(`
      select coalesce(string_agg(grantee, ',' order by grantee), '<none>')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'projects'
        and privilege_type = 'DELETE'
        and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
    `);
    expect(holders).toBe("<none>");
  });

  it("6. leaks no rows when the same failing call is retried", () => {
    const taken = makeProject("taken-retry");
    const repoId = db.sql(
      `select github_repository_id from public.repository_connections
        where project_id = '${taken.projectId}';`,
    );
    const { userId, installationId } = makeInstallation("retry");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      db.sql(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, "retry")} commit;`);
    }

    expect(db.sql(`select count(*) from public.projects where user_id = '${userId}';`)).toBe("0");
  });

  it("7. keeps a repository connectable to exactly one project", () => {
    const { userId, installationId } = makeInstallation("unique");
    const shared = `${freshRepositoryId()}`;
    db.sql(`begin; ${asUser(userId)} ${connectCall(installationId, shared, "first")} commit;`);
    const second = db.sqlLast(
      `begin; ${asUser(userId)} ${connectCall(installationId, shared, "second")} commit;`,
    );

    expect(second.split("|")[1]).toBe("duplicate_repository");
    expect(db.sql(`select count(*) from public.projects where user_id = '${userId}';`)).toBe("1");
  });
});

describe("disconnect_project is today's semantics without today's privilege", () => {
  /** `actAs` is whose JWT the call carries — the only owner the function reads. */
  function disconnect(actAs: string, projectId: string | null): string {
    const id = projectId === null ? "null" : `'${projectId}'::uuid`;
    return db.sqlLast(`
      begin;
        ${asUser(actAs)}
        select public.disconnect_project(${id});
      commit;
    `);
  }

  /** A project with no execution spec — what disconnect can still remove. */
  function makeSpeclessProject(label: string): { userId: string; projectId: string } {
    const { userId, installationId } = makeInstallation(label);
    const [projectId] = db
      .sqlLast(
        `begin; ${asUser(userId)} ${connectCall(installationId, `${freshRepositoryId()}`, label)} commit;`,
      )
      .split("|");
    return { userId, projectId };
  }

  it("1. removes an owned project that has no execution spec", () => {
    const { userId, projectId } = makeSpeclessProject("specless");

    expect(disconnect(userId, projectId)).toBe("disconnected");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("0");
  });

  it("2. is refused for a project holding an execution spec", () => {
    const { userId, projectId } = makeProject("with-spec");

    expect(disconnect(userId, projectId)).toBe("blocked_by_execution_history");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
    expect(
      db.sql(`select count(*) from public.execution_specs where project_id = '${projectId}';`),
    ).toBe("1");
  });

  it("3. mutates nothing when another user names the project", () => {
    const victim = makeSpeclessProject("dc-victim");
    const attacker = makeInstallation("dc-attacker");

    // The attacker's own id in the ownership argument, acting as themselves.
    expect(disconnect(attacker.userId, victim.projectId)).toBe("not_found");
    expect(db.sql(`select count(*) from public.projects where id = '${victim.projectId}';`)).toBe("1");
  });

  /**
   * The case that made the owner argument untenable. An earlier revision took
   * `(p_project_id, p_user_id)` and deleted on the pair — which reads as an
   * ownership check and is not one, because `SECURITY DEFINER` bypasses RLS
   * and the function is reachable at `/rest/v1/rpc/` with arguments the caller
   * chooses. A caller who knew both uuids deleted somebody else's project.
   * There is now no argument in which to name another owner.
   */
  it("3b. cannot be aimed at another user's project by any argument", () => {
    const victim = makeSpeclessProject("dc-forged");
    const attacker = makeInstallation("dc-forger");

    expect(disconnect(attacker.userId, victim.projectId)).toBe("not_found");
    expect(db.sql(`select count(*) from public.projects where id = '${victim.projectId}';`)).toBe("1");

    // And the two-argument form it replaced does not exist to fall back to.
    const gone = db.sqlExpectingError(
      `select public.disconnect_project('${victim.projectId}'::uuid, '${victim.userId}'::uuid);`,
    );
    expect(gone).toContain("does not exist");
  });

  it("4. reports not_found deterministically for an unknown project", () => {
    const { userId } = makeInstallation("dc-unknown");

    expect(disconnect(userId, "00000000-0000-0000-0000-000000000000")).toBe("not_found");
    expect(disconnect(userId, null)).toBe("not_found");
  });

  it("5. leaves no lifecycle marker set", () => {
    const { userId, projectId } = makeSpeclessProject("dc-marker");

    const after = db.sqlLast(`
      begin;
        ${asUser(userId)}
        select public.disconnect_project('${projectId}'::uuid);
        select coalesce(nullif(current_setting('${MARKER}', true), ''), '<unset>');
      commit;
    `);
    expect(after).toBe("<unset>");
  });

  /**
   * The hole this function had until the marker was *cleared* rather than
   * merely not set. `set_config(…, true)` is transaction-local and a
   * `SECURITY DEFINER` function runs inside the caller's transaction, so a
   * marker forged before the call was visible to the cascade the function
   * triggered — and the specs went. Clearing it is what closes that.
   */
  it("6. cannot be used to bypass ExecutionSpec immutability with a forged marker", () => {
    const { userId, projectId } = makeProject("dc-bypass");

    const result = db.sqlLast(`
      begin;
        ${asUser(userId)}
        select set_config('${MARKER}', 'on', true);
        select public.disconnect_project('${projectId}'::uuid);
      commit;
    `);

    expect(result).toBe("blocked_by_execution_history");
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
    expect(
      db.sql(`select count(*) from public.execution_specs where project_id = '${projectId}';`),
    ).toBe("1");
  });

  it("7. is reachable by authenticated, and reaches no other role", () => {
    const grants = db.sql(`
      select string_agg(r.rolname || '=' ||
               has_function_privilege(r.rolname, 'public.disconnect_project(uuid)', 'EXECUTE')::text,
               ',' order by r.rolname)
      from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
    `);
    expect(grants).toBe("anon=false,authenticated=true,service_role=false");
  });
});

/**
 * The gate's schema contract (VB-001, ADR 0056 §10).
 *
 * `findBlockingWork` names four tables, four columns and eight status strings.
 * Its unit tests run against `FakeDatabase`, which stores whatever it is given
 * — a typo'd column or a status value the real CHECK constraint would reject
 * passes there and matches nothing in production, which is a gate that is
 * silently open. This asserts the names against the real schema.
 */
describe("the active-work gate's schema contract", () => {
  it.each([
    ["operation_runs", "project_id"],
    ["agent_execution_runs", "project_id"],
    ["change_merges", "project_id"],
    ["billing_credit_reservations", "project_id"],
  ])("%s carries the %s the gate filters on", (table, column) => {
    expect(
      db.sql(`
        select count(*)::text from information_schema.columns
        where table_schema = 'public' and table_name = '${table}' and column_name = '${column}';
      `),
    ).toBe("1");
  });

  it.each([
    ["operation_runs", "queued"],
    ["operation_runs", "running"],
    ["operation_runs", "needs_user"],
    ["agent_execution_runs", "queued"],
    ["agent_execution_runs", "running"],
    ["agent_execution_runs", "needs_user_input"],
    ["change_merges", "preflight"],
    ["change_merges", "merging"],
    ["billing_credit_reservations", "active"],
  ])("%s accepts the status %s the gate blocks on", (table, status) => {
    // The CHECK constraint is the authority on which strings can ever exist.
    // A status the gate names but the column cannot hold is a gate that never
    // fires — the failure mode this asserts against.
    const accepted = db.sql(`
      select count(*)::text
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
      where t.relname = '${table}'
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%''${status}''::text%';
    `);
    expect(Number(accepted)).toBeGreaterThan(0);
  });
});

/**
 * VB-001 M5 — a connection can be detached, and detached rows stop constraining
 * (ADR 0056 §1).
 */
describe("repository connection detachment", () => {
  function connect(userId: string, installationId: string, repoId: string, name: string): string {
    return db
      .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, name)} commit;`)
      .split("|")[0];
  }

  it("starts every connection live", () => {
    const { userId, installationId } = makeInstallation("m5-live");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5-live");

    expect(
      db.sql(`select count(*) from public.repository_connections
                where project_id = '${projectId}' and detached_at is null;`),
    ).toBe("1");
  });

  /**
   * The whole point. Before M5 both constraints were global, so a detached row
   * held its repository hostage: the founder could never reconnect it, to this
   * project or any other.
   */
  it("frees the repository for reconnection once the row is detached", () => {
    const { userId, installationId } = makeInstallation("m5-reconnect");
    const repoId = `${freshRepositoryId()}`;
    const first = connect(userId, installationId, repoId, "m5-first");

    // Connecting the same repository again is refused while the row is live.
    expect(
      db
        .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, "m5-second")} commit;`)
        .split("|")[1],
    ).toBe("duplicate_repository");

    db.sql(`update public.repository_connections set detached_at = now() where project_id = '${first}';`);

    // And accepted once it is not.
    const second = db
      .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, "m5-second")} commit;`)
      .split("|");
    // `connectCall` coalesces a null failure to '-', so '-' is success.
    expect(second[1]).toBe("-");
    expect(second[0]).not.toBe("");
  });

  it("lets one project hold a live connection beside its detached history", () => {
    const { userId, installationId } = makeInstallation("m5-history");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5-history");

    db.sql(`update public.repository_connections set detached_at = now() where project_id = '${projectId}';`);
    db.sql(`
      insert into public.repository_connections
        (project_id, github_installation_id, github_repository_id, owner, name, full_name,
         default_branch, private, html_url)
      select '${projectId}', github_installation_id, ${freshRepositoryId()}, owner, 'again',
             'octo/again', 'main', false, 'https://github.com/octo/again'
      from public.repository_connections where project_id = '${projectId}' limit 1;
    `);

    expect(db.sql(`select count(*) from public.repository_connections where project_id = '${projectId}';`)).toBe("2");
    expect(
      db.sql(`select count(*) from public.repository_connections
                where project_id = '${projectId}' and detached_at is null;`),
    ).toBe("1");
  });

  it("still refuses a second live connection for the same project", () => {
    const { userId, installationId } = makeInstallation("m5-two-live");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5-two-live");

    const error = db.sqlExpectingError(`
      insert into public.repository_connections
        (project_id, github_installation_id, github_repository_id, owner, name, full_name,
         default_branch, private, html_url)
      values ('${projectId}', '${installationId}'::uuid, ${freshRepositoryId()}, 'octo', 'x',
              'octo/x', 'main', false, 'https://github.com/octo/x');
    `);
    expect(error).toContain("repository_connections_live_project_key");
  });

  it("still refuses the same repository being live in two projects", () => {
    const { userId, installationId } = makeInstallation("m5-two-repos");
    const repoId = `${freshRepositoryId()}`;
    connect(userId, installationId, repoId, "m5-owner");

    expect(
      db
        .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, "m5-thief")} commit;`)
        .split("|")[1],
    ).toBe("duplicate_repository");
  });

  /** The three RESTRICT references are why the row is retained at all. */
  it("keeps the references that make deletion of the row impossible", () => {
    const edges = db.sql(`
      select string_agg(c.relname, ',' order by c.relname)
      from pg_constraint t
      join pg_class c on c.oid = t.conrelid
      join pg_class r on r.oid = t.confrelid
      where t.contype = 'f' and t.confdeltype = 'r' and r.relname = 'repository_connections';
    `);
    expect(edges).toBe("change_merges,execution_specs,repository_intelligence_snapshots");
  });
});
