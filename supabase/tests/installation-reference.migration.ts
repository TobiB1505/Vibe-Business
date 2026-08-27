import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * VB-002 M2′ — the installation reference defers to commit (ADR 0056 F3).
 *
 * Two claims, and they pull in opposite directions, which is why both are
 * asserted: a single-statement erasure must stop being refused by this
 * constraint, and an out-of-band delete of a still-referenced installation
 * must still be refused. `restrict` gives the second and forbids the first;
 * `no action deferrable initially deferred` gives both.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let counter = 0;

/** F3's minimum: an identity, an installation, a project, a connection. */
function minimalSeed(): { userId: string; installationId: string } {
  counter += 1;
  const label = `m2min${counter}`;
  const n = 900_000 + counter;

  const userId = db.sql(
    `with ins as (insert into auth.users (email) values ('${label}@fixture.test') returning id)` +
      ` select id from ins;`,
  );
  const installationId = db.sql(
    `with ins as (insert into public.github_installations` +
      ` (user_id, installation_id, github_account_id, github_account_login, account_type,` +
      ` repository_selection) values ('${userId}', ${n}, ${n}, 'octo-${label}', 'User', 'all')` +
      ` returning id) select id from ins;`,
  );
  const projectId = db.sql(
    `with ins as (insert into public.projects (user_id, name) values ('${userId}', '${label}')` +
      ` returning id) select id from ins;`,
  );
  db.sql(`
    insert into public.repository_connections
      (project_id, github_installation_id, github_repository_id, owner, name, full_name,
       default_branch, private, html_url)
    values ('${projectId}', '${installationId}', ${n}, 'octo', '${label}', 'octo/${label}', 'main',
            false, 'https://github.com/octo/${label}');
  `);

  return { userId, installationId };
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
}, 300_000);

afterAll(() => db?.stop());

describe("M2′ constraint shape", () => {
  it("A. is NO ACTION, deferrable, initially deferred", () => {
    const row = db.sql(`
      select condeferrable::text || ':' || condeferred::text || ':' || confdeltype::text
      from pg_constraint
      where conrelid = 'public.repository_connections'::regclass
        and conname = 'repository_connections_github_installation_id_fkey';
    `);

    // 'a' is NO ACTION. RESTRICT ('r') cannot be deferred at all, which is the
    // only behavioural difference between the two and the whole point here.
    expect(row).toBe("true:true:a");
  });
});

describe("what it now permits", () => {
  it("B. erases the identity F3 measured as undeletable", () => {
    // F3's exact case, and the reason it is separate from F2: an installation,
    // a project and a connection are enough. No execution spec, no audit, no
    // snapshot — so the `execution_specs` trigger is not involved, and this
    // user was undeletable purely because the installation is reached one hop
    // below `auth.users` while the connection sitting two hops below it has
    // not been processed yet. Every user who has ever connected a repository
    // was in this state.
    const { userId } = minimalSeed();

    db.sql(`delete from auth.users where id = '${userId}';`);

    expect(db.sql(`select count(*) from public.projects where user_id = '${userId}';`)).toBe("0");
    expect(db.sql(`select count(*) from public.github_installations where user_id = '${userId}';`)).toBe(
      "0",
    );
  });
});

describe("what it still refuses", () => {
  it("C. refuses to orphan a live connection, now at commit rather than at the statement", () => {
    const { installationId } = minimalSeed();

    // The delete itself is accepted — deferred — and the transaction is what
    // fails. That relocation is the entire cost of M2′, and it is stated here
    // so a future reader does not mistake a passing DELETE for a weakened
    // guard.
    const error = db.sqlExpectingError(`
      begin;
      delete from public.github_installations where id = '${installationId}';
      commit;
    `);

    expect(error).toContain("repository_connections_github_installation_id_fkey");
    expect(db.sql(`select count(*) from public.github_installations where id = '${installationId}';`)).toBe(
      "1",
    );
  });
});
