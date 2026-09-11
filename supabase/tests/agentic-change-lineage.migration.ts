import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Backfilling the Move an agentic change descends from.
 *
 * ## Why this runs against a real cluster
 *
 * Because the migration is a four-table join with a `distinct on` inside an
 * `update … from`, and every way it can be wrong is a way PostgreSQL answers
 * and a text search does not: whether the join finds the run at all, whether
 * the set it writes satisfies the foreign key, whether the guard leaves the
 * rows it should leave, and whether re-running it changes anything.
 *
 * It is also the first migration in this repository that *edits customer rows*
 * rather than shaping the table around them. A backfill that fills the wrong
 * column, or fills a row it should not have touched, is not caught by a
 * constraint — it is simply wrong data, quietly. So it is checked here.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKFILL = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20260911102101_agentic_change_lineage_backfill.sql",
);

let db: Cluster;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

/**
 * One project, and one agentic change with both opportunity columns null.
 *
 * `build_lifecycle_fixture` already builds the whole chain this backfill walks
 * — set, opportunity, plan, spec, operation run, agent run — so the change is
 * the only row this has to add, and it is added in the state every agentic
 * change written before today is in.
 */
/**
 * A project, and one agent run whose spec names the project's real Move.
 *
 * `build_lifecycle_fixture` builds the chain but writes `'opp-1'` into the
 * spec's `opportunity_id`, which is a placeholder rather than what production
 * stores — `business_opportunities.id` is a generated uuid and the planner
 * copies that. The backfill matches on exactly that equality, so the run this
 * test needs carries its own spec with the real value.
 *
 * A spec cannot be edited into shape: the table has a trigger that refuses an
 * update outright — *"execution_specs rows are immutable. Re-resolve the step
 * and insert a new spec instead."* — which is the right rule and the reason
 * this inserts rather than patches.
 */
function seedRun(label: string): {
  userId: string;
  projectId: string;
  moveId: string;
  operationRunId: string;
} {
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");

  const [moveId, operationRunId] = db
    .sql(
      `with move as (
         select o.id from public.business_opportunities o
         join public.opportunity_sets s on s.id = o.opportunity_set_id
         where s.project_id = '${projectId}' limit 1
       ), spec as (
         insert into public.execution_specs
           (project_id, action_plan_id, step_key, step_order, business_audit_id, opportunity_id,
            spec_identity, mode, risk_class, repository_connection_id, base_sha,
            repository_snapshot_id, spec, schema_version, resolver_version, policy_version,
            risk_policy_version, execution_class)
         select ap.project_id, ap.id, 'step-1', 1, ap.business_audit_id, (select id::text from move),
                md5(random()::text) || md5(random()::text), 'agentic', 'low',
                (select id from public.repository_connections where project_id = '${projectId}' limit 1),
                repeat('a', 40),
                (select id from public.repository_intelligence_snapshots
                  where project_id = '${projectId}' limit 1),
                '{}'::jsonb, 'v1', 'v1', 'v1', 'v1', 'application_code_change'
           from public.action_plans ap where ap.project_id = '${projectId}' limit 1
         returning id
       ), orun as (
         insert into public.operation_runs
           (project_id, user_id, operation_type, input_identity, status)
         values ('${projectId}', '${userId}', 'agent_execution',
                 md5(random()::text) || md5(random()::text), 'running')
         returning id
       ), arun as (
         insert into public.agent_execution_runs
           (project_id, user_id, operation_run_id, execution_spec_id, run_identity, provider,
            harness, model, coding_agent_policy_version, prompt_compiler_version,
            budget_policy_version, execution_policy_version, base_sha, status)
         select '${projectId}', '${userId}', orun.id, spec.id,
                md5(random()::text) || md5(random()::text), 'anthropic', 'claude-code', 'm',
                'v1', 'v1', 'v1', 'v1', repeat('a', 40), 'needs_user_input'
           from spec, orun
         returning operation_run_id
       )
       select (select id::text from move) || '|' || (select operation_run_id::text from arun);`,
    )
    .trim()
    .split("|");

  return { userId: userId!, projectId: projectId!, moveId: moveId!, operationRunId: operationRunId! };
}

/** One agentic change on that run, in the state every one written so far is in. */
function seedAgenticChange(label: string): { change: string; moveId: string; projectId: string } {
  const { userId, projectId, moveId, operationRunId } = seedRun(label);

  const change = insertChange({
    projectId,
    userId,
    operationRunId,
    lineage: "null, null",
    capability: "agentic_execution_v1",
    branch: "vibe/agent-" + label,
  });

  return { change, moveId, projectId };
}

function insertChange(input: {
  projectId: string;
  userId: string;
  operationRunId: string;
  lineage: string;
  capability: string;
  branch: string;
}): string {
  /* Wrapped in a CTE so the only output is the id: a bare `insert … returning`
     prints psql's command tag on the next line, and `.trim()` keeps it. */
  return db
    .sql(
      `with inserted as (
       insert into public.prepared_changes
         (project_id, user_id, operation_run_id, opportunity_set_id, opportunity_id,
          execution_capability, execution_version, repository_snapshot_id, base_branch,
          base_sha, branch_name, commit_sha, completed_at, execution_identity, status)
       values ('${input.projectId}', '${input.userId}', '${input.operationRunId}', ${input.lineage},
               '${input.capability}', 'v1',
               (select id from public.repository_intelligence_snapshots
                 where project_id = '${input.projectId}' limit 1),
               'main', repeat('a', 40), '${input.branch}', repeat('b', 40), now(),
               md5(random()::text) || md5(random()::text), 'prepared')
       returning id
       )
       select id::text from inserted;`,
    )
    .trim();
}

const lineageOf = (changeId: string) =>
  db
    .sql(
      `select coalesce(opportunity_set_id::text, 'null') || '|' || coalesce(opportunity_id::text, 'null')
         from public.prepared_changes where id = '${changeId}';`,
    )
    .trim();

const runBackfill = () => db.sql(readFileSync(BACKFILL, "utf8"));

describe("the agentic change lineage backfill", () => {
  it("fills the set from the plan and the Move from the spec", () => {
    const { change, moveId } = seedAgenticChange("fills");
    expect(lineageOf(change)).toBe("null|null");

    runBackfill();

    const [setId, opportunityId] = lineageOf(change).split("|");
    expect(opportunityId, "the spec's Move").toBe(moveId);
    expect(setId, "the plan's set").not.toBe("null");

    /* And it is the plan's set, not any set: the foreign key would have
       accepted any row, so the value is checked against its source. */
    const expected = db
      .sql(
        `select ap.opportunity_set_id::text
           from public.prepared_changes pc
           join public.agent_execution_runs aer on aer.operation_run_id = pc.operation_run_id
           join public.execution_specs es on es.id = aer.execution_spec_id
           join public.action_plans ap on ap.id = es.action_plan_id
          where pc.id = '${change}';`,
      )
      .trim();
    expect(setId).toBe(expected);
  });

  it("changes nothing on a second run", () => {
    const { change } = seedAgenticChange("idempotent");
    runBackfill();
    const once = lineageOf(change);

    runBackfill();

    expect(lineageOf(change)).toBe(once);
  });

  /**
   * A change that already names its Move is not rewritten.
   *
   * The guard is `is null` on both columns, and this is the case that proves
   * it: a deterministic change carries a set and an opportunity the constraint
   * requires, and a backfill that overwrote them would be replacing a recorded
   * lineage with a re-derived one.
   */
  it("leaves a change that already has a lineage alone", () => {
    const { userId, projectId, moveId, operationRunId } = seedRun("untouched");

    const change = insertChange({
      projectId,
      userId,
      operationRunId,
      lineage: `(select id from public.opportunity_sets where project_id = '${projectId}' limit 1), '${moveId}'`,
      capability: "nextjs_seo_foundations_v2",
      branch: "vibe/change-kept",
    });

    runBackfill();

    expect(lineageOf(change).split("|")[1]).toBe(moveId);
  });

  /**
   * A change whose lineage cannot be resolved keeps its nulls.
   *
   * `operation_run_id` is NOT NULL, so this is not a missing run — it is an
   * operation with no agent run hanging off it, which is what a preparation
   * that never reached the agent looks like. Null is a legitimate state here,
   * and a backfill that could not find a lineage must leave the row rather
   * than write one it cannot justify.
   */
  it("leaves an agentic change whose run cannot be found", () => {
    const [userId, projectId] = db
      .sql(`select user_id, project_id from public.build_lifecycle_fixture('no-run');`)
      .split("|");

    const orphanRun = db
      .sql(
        `with inserted as (
           insert into public.operation_runs
             (project_id, user_id, operation_type, input_identity, status)
           values ('${projectId}', '${userId}', 'agent_execution',
                   md5(random()::text) || md5(random()::text), 'running')
           returning id
         )
         select id::text from inserted;`,
      )
      .trim();

    const change = insertChange({
      projectId: projectId!,
      userId: userId!,
      operationRunId: orphanRun,
      lineage: "null, null",
      capability: "agentic_execution_v1",
      branch: "vibe/agent-orphan",
    });

    runBackfill();

    expect(lineageOf(change)).toBe("null|null");
  });
});
