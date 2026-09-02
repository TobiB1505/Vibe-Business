import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Sprint 0128 — the capability that may remove a file (ADR 0074).
 *
 * ## Why this runs against a real cluster
 *
 * Because the whole migration is two CHECK constraints on one column, and the
 * one that matters is not the one it looks like. Widening the capability
 * enumeration is the obvious half. The other half is
 * `prepared_changes_opportunity_required_for_generators`, which exempted
 * `agentic_execution_v1` **by name** — so a v2 row, which carries nulls in both
 * opportunity columns exactly as a v1 row does, would have been refused by a
 * constraint nobody was thinking about while bumping the capability.
 *
 * Neither the in-memory database nor a migration-text search can see that: the
 * text contains both constraint names and says nothing about whether the second
 * one admits the row the first one now permits. Only PostgreSQL answers it.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);

let db: Cluster;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

/** One `prepared_changes` insert, with the columns this migration governs. */
function insertChange(
  label: string,
  change: {
    capability: string;
    version: string;
    withOpportunity: boolean;
    files?: string;
  },
): string {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");

  const opportunity = change.withOpportunity ? "oset.id, opp.id" : "null, null";

  return `
    with run as (
      insert into public.operation_runs (project_id, user_id, operation_type, input_identity, status)
      values ('${projectId}', '${userId}', 'change_preparation',
              md5(random()::text) || md5(random()::text), 'running')
      returning id
    ), oset as (
      select id from public.opportunity_sets where project_id = '${projectId}' limit 1
    ), opp as (
      select o.id from public.business_opportunities o
      join oset on o.opportunity_set_id = oset.id limit 1
    ), snap as (
      select id from public.repository_intelligence_snapshots where project_id = '${projectId}' limit 1
    ), created as (
      insert into public.prepared_changes
        (project_id, user_id, operation_run_id, opportunity_set_id, opportunity_id,
         execution_capability, execution_version, repository_snapshot_id, base_branch, base_sha,
         branch_name, commit_sha, files, execution_identity, status, completed_at)
      select '${projectId}', '${userId}', run.id, ${opportunity},
             '${change.capability}', '${change.version}', snap.id, 'main', '${SHA}',
             'vibe/agent-${label}', '${HEAD}',
             '${change.files ?? '[{"path":"src/app/page.tsx","contentHash":"c","bytes":10}]'}'::jsonb,
             md5(random()::text) || md5(random()::text), 'prepared', now()
      from run, oset, opp, snap
      returning id
    )
    select id from created;
  `;
}

describe("the capability enumeration", () => {
  it("accepts a change prepared under agentic_execution_v2", () => {
    const id = db.sqlLast(
      insertChange("cap-v2", {
        capability: "agentic_execution_v2",
        version: "agentic-execution-v2",
        withOpportunity: false,
      }),
    );

    expect(id).toHaveLength(36);
  });

  it("still accepts a change prepared under agentic_execution_v1", () => {
    // Widening only. A stored v1 row keeps meaning what it meant — a commit
    // nothing was removed by, because the writer could not remove anything.
    const id = db.sqlLast(
      insertChange("cap-v1", {
        capability: "agentic_execution_v1",
        version: "agentic-execution-v1",
        withOpportunity: false,
      }),
    );

    expect(id).toHaveLength(36);
  });

  it("refuses a capability nobody has implemented", () => {
    expect(
      db.sqlExpectingError(
        insertChange("cap-unknown", {
          capability: "agentic_execution_v3",
          version: "agentic-execution-v3",
          withOpportunity: false,
        }),
      ),
    ).toContain("prepared_changes_execution_capability_check");
  });
});

describe("the opportunity requirement, restated for v2", () => {
  it("lets an agentic v2 change name no opportunity, as v1 may", () => {
    // The constraint this migration had to restate. It exempted v1 by name, so
    // the capability bump alone would have made every v2 change unstorable.
    const id = db.sqlLast(
      insertChange("opp-v2", {
        capability: "agentic_execution_v2",
        version: "agentic-execution-v2",
        withOpportunity: false,
      }),
    );

    expect(id).toHaveLength(36);
  });

  it("still requires an opportunity from a generator-produced change", () => {
    // The nullability is for the agentic path only, and this is what stops it
    // becoming permission for everything else.
    expect(
      db.sqlExpectingError(
        insertChange("opp-generator", {
          capability: "nextjs_seo_foundations_v2",
          version: "v2",
          withOpportunity: false,
        }),
      ),
    ).toContain("prepared_changes_opportunity_required_for_generators");
  });
});

describe("a removed path in prepared_changes.files", () => {
  it("stores a deletion with no hash and no byte count", () => {
    // `files` is jsonb with no shape constraint, so this is not a constraint
    // test — it is the round trip, asserted rather than assumed, because every
    // reader of this column now branches on `status`.
    const id = db.sqlLast(
      insertChange("files-deleted", {
        capability: "agentic_execution_v2",
        version: "agentic-execution-v2",
        withOpportunity: false,
        files: '[{"path":"src/app/pricing/page.tsx","status":"deleted"}]',
      }),
    );

    expect(db.sql(`select files from public.prepared_changes where id = '${id}';`)).toBe(
      '[{"path": "src/app/pricing/page.tsx", "status": "deleted"}]',
    );
  });
});
