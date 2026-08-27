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

/**
 * VB-001 M5 part 2 — the two write paths, and the privilege that makes the
 * detach gate more than advisory.
 */
describe("detach and attach", () => {
  function connect(userId: string, installationId: string, repoId: string, name: string): string {
    return db
      .sqlLast(`begin; ${asUser(userId)} ${connectCall(installationId, repoId, name)} commit;`)
      .split("|")[0];
  }

  it("marks the live connection detached and keeps the row", () => {
    const { userId, installationId } = makeInstallation("m5b-detach");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5b-detach");

    expect(db.sql(`select public.detach_repository('${projectId}'::uuid, '${userId}'::uuid);`)).toBe(
      "detached",
    );
    expect(db.sql(`select count(*) from public.repository_connections where project_id = '${projectId}';`)).toBe("1");
    expect(
      db.sql(`select count(*) from public.repository_connections
                where project_id = '${projectId}' and detached_at is null;`),
    ).toBe("0");
    // The project and everything under it survive — that is the split.
    expect(db.sql(`select count(*) from public.projects where id = '${projectId}';`)).toBe("1");
  });

  it("is idempotent and reports nothing live to detach", () => {
    const { userId, installationId } = makeInstallation("m5b-twice");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5b-twice");

    expect(db.sql(`select public.detach_repository('${projectId}'::uuid, '${userId}'::uuid);`)).toBe("detached");
    expect(db.sql(`select public.detach_repository('${projectId}'::uuid, '${userId}'::uuid);`)).toBe("not_found");
    expect(db.sql(`select public.detach_repository(null, null);`)).toBe("not_found");
  });

  it("mutates nothing for a caller who does not own the project", () => {
    const victim = makeInstallation("m5b-victim");
    const attacker = makeInstallation("m5b-attacker");
    const projectId = connect(victim.userId, victim.installationId, `${freshRepositoryId()}`, "m5b-victim");

    expect(
      db.sql(`select public.detach_repository('${projectId}'::uuid, '${attacker.userId}'::uuid);`),
    ).toBe("not_found");
    expect(
      db.sql(`select count(*) from public.repository_connections
                where project_id = '${projectId}' and detached_at is null;`),
    ).toBe("1");
  });

  /**
   * The gate lives in TypeScript, so the privilege is what stops a caller
   * writing the marker straight over PostgREST and skipping it.
   */
  it("grants no Data API role a direct UPDATE or DELETE on the table", () => {
    const holders = db.sql(`
      select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '<none>')
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'repository_connections'
        and privilege_type in ('UPDATE', 'DELETE')
        and grantee in ('anon', 'authenticated', 'PUBLIC');
    `);
    expect(holders).toBe("<none>");
  });

  it("keeps INSERT, which create_project_with_repository needs as the caller", () => {
    expect(
      db.sql(`
        select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'repository_connections'
          and privilege_type = 'INSERT' and grantee = 'authenticated';
      `),
    ).toBe("1");
  });

  it("reaches detach_repository from service_role only", () => {
    const grants = db.sql(`
      select string_agg(r.rolname || '=' ||
               has_function_privilege(r.rolname, 'public.detach_repository(uuid,uuid)', 'EXECUTE')::text,
               ',' order by r.rolname)
      from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');
    `);
    expect(grants).toBe("anon=false,authenticated=false,service_role=true");
  });

  it("attaches a repository to a project that already exists", () => {
    const { userId, installationId } = makeInstallation("m5b-attach");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5b-attach");
    db.sql(`select public.detach_repository('${projectId}'::uuid, '${userId}'::uuid);`);

    const attached = db.sqlLast(`
      begin;
        ${asUser(userId)}
        select connection_id, coalesce(failure, '-') from public.attach_repository_to_project(
          '${projectId}'::uuid, '${installationId}'::uuid, ${freshRepositoryId()}::bigint,
          'octo', 'again', 'octo/again', 'main', false, 'https://github.com/octo/again');
      commit;
    `);

    expect(attached.split("|")[1]).toBe("-");
    expect(
      db.sql(`select count(*) from public.repository_connections
                where project_id = '${projectId}' and detached_at is null;`),
    ).toBe("1");
    // The detached row stays as history beside the new live one.
    expect(db.sql(`select count(*) from public.repository_connections where project_id = '${projectId}';`)).toBe("2");
  });

  it("refuses to attach a second live connection to the same project", () => {
    const { userId, installationId } = makeInstallation("m5b-second");
    const projectId = connect(userId, installationId, `${freshRepositoryId()}`, "m5b-second");

    const attached = db.sqlLast(`
      begin;
        ${asUser(userId)}
        select connection_id, coalesce(failure, '-') from public.attach_repository_to_project(
          '${projectId}'::uuid, '${installationId}'::uuid, ${freshRepositoryId()}::bigint,
          'octo', 'x', 'octo/x', 'main', false, 'https://github.com/octo/x');
      commit;
    `);
    expect(attached.split("|")[1]).toBe("already_connected");
  });

  /** A forged project id reaches somebody else's project and RLS refuses it. */
  it("refuses to attach to a project the caller does not own", () => {
    const victim = makeInstallation("m5b-av");
    const attacker = makeInstallation("m5b-aa");
    const projectId = connect(victim.userId, victim.installationId, `${freshRepositoryId()}`, "m5b-av");
    db.sql(`select public.detach_repository('${projectId}'::uuid, '${victim.userId}'::uuid);`);

    const error = db.sqlExpectingError(`
      begin;
        ${asUser(attacker.userId)}
        select * from public.attach_repository_to_project(
          '${projectId}'::uuid, '${attacker.installationId}'::uuid, ${freshRepositoryId()}::bigint,
          'octo', 'steal', 'octo/steal', 'main', false, 'https://github.com/octo/steal');
      commit;
    `);
    expect(error).toContain("row-level security policy");
    expect(db.sql(`select count(*) from public.repository_connections where project_id = '${projectId}';`)).toBe("1");
  });
});
