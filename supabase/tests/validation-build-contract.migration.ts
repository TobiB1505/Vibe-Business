import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Stufe 4 — the validation profile becomes a build contract.
 *
 * ## Why this runs against a real cluster
 *
 * Two of the three things this migration does are constraints the in-memory
 * database does not evaluate, and both are load-bearing:
 *
 * - **The retired profile still inserts.** Sixteen rows carry `nextjs_node_v1`.
 *   A widened CHECK that dropped the old value would not fail a TypeScript
 *   test — it would fail the first time anything touched a historical row, and
 *   rule 83 says a record is not rewritten to match the present.
 * - **`workspace_root` cannot escape its repository.** This column becomes the
 *   working directory a sandbox runs a customer's build in. The application
 *   refuses an unsafe path twice over; this is the half that holds when the
 *   application is not the writer, which for `validation_runs` means the
 *   service-role client.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA = "a".repeat(40);

let db: Cluster;
let userId: string;
let projectId: string;
let preparedChangeId: string;
let operationRunId: string;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));

  [userId, projectId] = db
    .sql("select user_id, project_id from public.build_lifecycle_fixture('build-contract');")
    .split("|");

  [operationRunId, preparedChangeId] = db
    .sql(
      `
      with run as (
        insert into public.operation_runs
          (project_id, user_id, operation_type, status, stage, input_identity)
        values ('${projectId}', '${userId}', 'change_validation', 'running', 'preparing',
                md5(random()::text) || md5(random()::text))
        returning id
      ), snap as (
        select id from public.repository_intelligence_snapshots
        where project_id = '${projectId}' limit 1
      ), oset as (
        select id from public.opportunity_sets where project_id = '${projectId}' limit 1
      ), opp as (
        select id from public.business_opportunities
        where opportunity_set_id = (select id from oset) limit 1
      ), change as (
        insert into public.prepared_changes
          (project_id, user_id, operation_run_id, opportunity_set_id, opportunity_id,
           execution_capability, execution_version, repository_snapshot_id, base_branch, base_sha,
           branch_name, commit_sha, files, execution_identity, status, completed_at)
        select '${projectId}', '${userId}', run.id, oset.id, opp.id,
               'nextjs_seo_foundations_v2', 'v2', snap.id, 'main', '${SHA}',
               'vibe/build-contract', '${SHA}',
               '[{"path":"src/page.tsx","contentHash":"c","bytes":10}]'::jsonb,
               md5(random()::text) || md5(random()::text), 'prepared', now()
        from run, oset, opp, snap
        returning id, operation_run_id
      )
      select change.operation_run_id || '|' || change.id from change;
    `,
    )
    .split("|");
}, 300_000);

afterAll(() => db?.stop());

/** One `validation_runs` insert, with the columns under test. */
function insertRun(profile: string, workspaceRoot: string | null): string {
  const root = workspaceRoot === null ? "" : ", workspace_root";
  const value = workspaceRoot === null ? "" : `, '${workspaceRoot}'`;

  return `
    insert into public.validation_runs
      (project_id, user_id, prepared_change_id, operation_run_id, validation_profile,
       validation_profile_version, sandbox_policy_version, sandbox_provider, package_manager,
       prepared_commit_sha, status, stage, validation_identity${root})
    values ('${projectId}', '${userId}', '${preparedChangeId}', '${operationRunId}', '${profile}',
            'v1', 'v1', 'vercel_sandbox', 'pnpm', '${SHA}', 'running', 'provisioning',
            md5(random()::text) || md5(random()::text)${value});
  `;
}

describe("the profile a run records", () => {
  it("accepts the contract profile", () => {
    expect(() => db.sql(insertRun("node_build_v1", "."))).not.toThrow();
  });

  it("still accepts the retired profile, because sixteen rows carry it", () => {
    // Not an alias and not a fallback — the value simply stays legal, so the
    // history that recorded it stays readable (rule 83).
    expect(() => db.sql(insertRun("nextjs_node_v1", "."))).not.toThrow();
  });

  it("refuses a profile that does not exist", () => {
    expect(() => db.sql(insertRun("vite_node_v1", "."))).toThrow(
      /validation_runs_validation_profile_check/,
    );
  });
});

describe("the directory a run records", () => {
  it("defaults to the repository root", () => {
    // The truth for every row written before the column existed, not a
    // placeholder: each of them validated a single-application repository.
    db.sql(insertRun("node_build_v1", null));

    const roots = db.sql(
      `select distinct workspace_root from public.validation_runs where workspace_root = '.';`,
    );
    expect(roots).toContain(".");
  });

  it.each(["frontend", "apps/web", "packages/ui-kit", "a.b-c/d_e"])(
    "accepts %s",
    (workspaceRoot) => {
      expect(() => db.sql(insertRun("node_build_v1", workspaceRoot))).not.toThrow();
    },
  );

  /*
   * The assertion this file exists for.
   *
   * `[A-Za-z0-9._-]+` accepts two dots quite happily, so the character class
   * alone would let `../etc` through — and the next thing that happens to this
   * value is that a sandbox runs a customer's build in it.
   */
  it.each(["..", "../etc", "apps/../..", "a/../../b", "/etc", "apps//web", "", " ", "apps/"])(
    "refuses %s",
    (workspaceRoot) => {
      expect(() => db.sql(insertRun("node_build_v1", workspaceRoot))).toThrow(
        /validation_runs_workspace_root_shape/,
      );
    },
  );

  it("refuses null, so a row always says where it ran", () => {
    expect(() =>
      db.sql(`
        insert into public.validation_runs
          (project_id, user_id, prepared_change_id, operation_run_id, validation_profile,
           validation_profile_version, sandbox_policy_version, sandbox_provider, package_manager,
           prepared_commit_sha, status, stage, validation_identity, workspace_root)
        values ('${projectId}', '${userId}', '${preparedChangeId}', '${operationRunId}',
                'node_build_v1', 'v1', 'v1', 'vercel_sandbox', 'pnpm', '${SHA}', 'running',
                'provisioning', md5(random()::text) || md5(random()::text), null);
      `),
    ).toThrow(/null value in column "workspace_root"/);
  });
});
