import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Sprint 0131 — a spec may name more than one step (`build-chain-v1`).
 *
 * ## Why this runs against a real cluster
 *
 * Because the migration is five CHECK constraints and a default, and the
 * in-memory database evaluates none of them. Two of the five are load-bearing
 * in a way no TypeScript test can reach:
 *
 * - **The head is a member of its own chain.** Without it a row could be the
 *   spec for step 2 while claiming to deliver steps 3 and 4 — an artifact whose
 *   completion, price and provenance disagree about what it is. The application
 *   refuses the same shape; this is the half that holds when the application is
 *   not the writer, which for `execution_specs` means the service-role client.
 * - **The immutability trigger still fires.** `execution_specs_immutable` is
 *   declared `for each row` with no column list, so it *should* cover columns
 *   added years later. "Should" is exactly the kind of thing that is true until
 *   somebody rewrites a trigger with an explicit list, so it is asserted rather
 *   than reasoned about.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA = "a".repeat(40);

let db: Cluster;

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
}, 300_000);

afterAll(() => db?.stop());

/** One `execution_specs` insert, with the chain columns under test. */
function insertSpec(
  label: string,
  chain: { keys: string; orders: string } | null,
  overrides: {
    stepKey?: string;
    stepOrder?: number;
    absorbed?: { keys: string; orders: string };
  } = {},
): string {
  const [, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('${label}');`)
    .split("|");

  const extra: string[] = [];
  const extraValues: string[] = [];
  if (chain) {
    extra.push("chain_step_keys", "chain_step_orders");
    extraValues.push(chain.keys, chain.orders);
  }
  if (overrides.absorbed) {
    extra.push("absorbed_step_keys", "absorbed_step_orders");
    extraValues.push(overrides.absorbed.keys, overrides.absorbed.orders);
  }
  const columns = extra.length > 0 ? `, ${extra.join(", ")}` : "";
  const values = extraValues.length > 0 ? `, ${extraValues.join(", ")}` : "";

  return `
    with plan as (
      select id from public.action_plans where project_id = '${projectId}' limit 1
    ), audit as (
      select id from public.business_readiness_audits where project_id = '${projectId}' limit 1
    ), opp as (
      select o.id from public.business_opportunities o
      join public.opportunity_sets s on s.id = o.opportunity_set_id
      where s.project_id = '${projectId}' limit 1
    ), conn as (
      select id from public.repository_connections where project_id = '${projectId}' limit 1
    ), snap as (
      select id from public.repository_intelligence_snapshots where project_id = '${projectId}' limit 1
    ), created as (
      insert into public.execution_specs
        (project_id, action_plan_id, step_key, step_order, business_audit_id,
         opportunity_id, spec_identity, mode, execution_class, risk_class,
         repository_connection_id, base_sha, repository_snapshot_id, spec,
         schema_version, resolver_version, policy_version, risk_policy_version${columns})
      select '${projectId}', plan.id, '${overrides.stepKey ?? "2-build"}',
             ${overrides.stepOrder ?? 2}, audit.id, opp.id,
             md5(random()::text) || md5(random()::text), 'agentic',
             'application_code_change', 'moderate', conn.id, '${SHA}', snap.id,
             '{}'::jsonb, 'execution-spec.v1', 'execution-resolver-v2',
             'execution-policy-v1', 'execution-risk-policy-v2'${values}
      from plan, audit, opp, conn, snap
      returning id
    )
    select id from created;
  `;
}

describe("the columns arrive empty and mean what they always meant", () => {
  it("defaults a spec with no chain to two empty arrays", () => {
    const id = db.sqlLast(insertSpec("chain-default", null));

    expect(
      db.sql(
        `select chain_step_keys::text || ' ' || chain_step_orders::text
         from public.execution_specs where id = '${id}';`,
      ),
    ).toBe("{} {}");
  });

  it("has no null anywhere — a run of one is an empty chain, not an unknown one", () => {
    // The difference matters to the completion projection: null would be "we do
    // not know what this delivered", and every pre-existing row does know.
    expect(
      db.sql(
        `select count(*) from public.execution_specs
         where chain_step_keys is null or chain_step_orders is null;`,
      ),
    ).toBe("0");
  });
});

describe("a chain the row could not honour is refused", () => {
  it("refuses arrays of different lengths", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("chain-lengths", {
          keys: `'{"2-build","3-link"}'::text[]`,
          orders: `'{2}'::integer[]`,
        }),
      ),
    ).toContain("execution_specs_chain_arrays_agree");
  });

  it("refuses a blank member key", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("chain-blank", {
          keys: `'{"2-build","  "}'::text[]`,
          orders: `'{2,3}'::integer[]`,
        }),
      ),
    ).toContain("execution_specs_chain_keys_non_empty");
  });

  it("refuses orders that do not ascend", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("chain-descending", {
          keys: `'{"2-build","3-link"}'::text[]`,
          orders: `'{3,2}'::integer[]`,
        }),
      ),
    ).toContain("execution_specs_chain_orders_ascending");
  });

  it("refuses a repeated order", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("chain-duplicate", {
          keys: `'{"2-build","2-build"}'::text[]`,
          orders: `'{2,2}'::integer[]`,
        }),
      ),
    ).toContain("execution_specs_chain_orders_ascending");
  });

  /*
   * The constraint that stops an artifact disagreeing with itself.
   */
  it("refuses a chain that does not contain the spec's own step", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("chain-headless", {
          keys: `'{"3-link","4-checkout"}'::text[]`,
          orders: `'{3,4}'::integer[]`,
        }),
      ),
    ).toContain("execution_specs_chain_contains_head");
  });

  it("accepts a chain that does contain it", () => {
    const id = db.sqlLast(
      insertSpec("chain-valid", {
        keys: `'{"2-build","3-link"}'::text[]`,
        orders: `'{2,3}'::integer[]`,
      }),
    );

    expect(id).toHaveLength(36);
  });
});

describe("a chained spec is as immutable as any other", () => {
  it("still refuses an update that touches only the chain", () => {
    const id = db.sqlLast(
      insertSpec("chain-immutable", {
        keys: `'{"2-build","3-link"}'::text[]`,
        orders: `'{2,3}'::integer[]`,
      }),
    );

    expect(
      db.sqlExpectingError(
        `update public.execution_specs
         set chain_step_keys = '{"2-build"}'::text[], chain_step_orders = '{2}'::integer[]
         where id = '${id}';`,
      ),
    ).toContain("immutable");
  });
});

/**
 * The mirror columns, and the one constraint that is the inverse of the chain's.
 *
 * `absorbed_step_keys` names what a run *performed* rather than what it
 * delivered, and the whole distinction rests on a row never being able to claim
 * both about the same step. A chain must contain its head; absorbed preparation
 * must not, because a run that absorbed its own head would satisfy its own
 * prerequisite — and the projection that reads these columns decides what a
 * founder is asked to do next (ADR 0091).
 */
describe("absorbed preparation is constrained as tightly as delivery", () => {
  it("defaults to empty, which is what every pre-existing row absorbed", () => {
    const id = db.sqlLast(insertSpec("absorbed-default", null));

    expect(
      db.sql(
        `select absorbed_step_keys::text || ' ' || absorbed_step_orders::text
         from public.execution_specs where id = '${id}';`,
      ),
    ).toBe("{} {}");
  });

  it("accepts preparation that is neither the head nor a delivery", () => {
    const id = db.sqlLast(
      insertSpec("absorbed-valid", { keys: `'{"2-build","3-link"}'`, orders: "'{2,3}'" }, {
        absorbed: { keys: `'{"1-analyse"}'`, orders: "'{1}'" },
      }),
    );

    expect(
      db.sql(`select absorbed_step_orders::text from public.execution_specs where id = '${id}';`),
    ).toBe("{1}");
  });

  it("refuses arrays of different lengths", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("absorbed-lengths", null, {
          absorbed: { keys: `'{"1-analyse","0-scope"}'`, orders: "'{1}'" },
        }),
      ),
    ).toMatch(/execution_specs_absorbed_arrays_agree/);
  });

  it("refuses a blank key", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("absorbed-blank", null, {
          absorbed: { keys: `'{"  "}'`, orders: "'{1}'" },
        }),
      ),
    ).toMatch(/execution_specs_absorbed_keys_non_empty/);
  });

  it("refuses orders that do not ascend", () => {
    expect(
      db.sqlExpectingError(
        insertSpec("absorbed-descending", null, {
          absorbed: { keys: `'{"1-a","0-b"}'`, orders: "'{3,1}'" },
        }),
      ),
    ).toMatch(/execution_specs_absorbed_orders_ascending/);
  });

  it("refuses a run that absorbed its own head", () => {
    // The inverse of `execution_specs_chain_contains_head`, and the reason the
    // two column pairs are separate: a step cannot satisfy its own prerequisite.
    expect(
      db.sqlExpectingError(
        insertSpec("absorbed-self", null, {
          absorbed: { keys: `'{"2-build"}'`, orders: "'{2}'" },
        }),
      ),
    ).toMatch(/execution_specs_absorbed_excludes_head/);
  });

  it("refuses a step that is both absorbed and delivered", () => {
    // Delivered or covered, never both — otherwise one row would say a step was
    // carried out and that it never needed carrying out.
    expect(
      db.sqlExpectingError(
        insertSpec("absorbed-overlap", { keys: `'{"2-build","3-link"}'`, orders: "'{2,3}'" }, {
          absorbed: { keys: `'{"3-link"}'`, orders: "'{3}'" },
        }),
      ),
    ).toMatch(/execution_specs_absorbed_disjoint_from_chain/);
  });
});
