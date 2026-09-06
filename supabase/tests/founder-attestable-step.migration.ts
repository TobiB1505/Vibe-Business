import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startCluster, type Cluster } from "./harness";

/**
 * Which steps a founder may close with their own confirmation (ADR 0090).
 *
 * ## Why this runs against a real cluster
 *
 * `attest_founder_action_step` is the authority, not the application. It is
 * `security definer`, granted to `service_role` alone, and it repeats every
 * check the server action makes — precisely so a bug or a future caller in
 * TypeScript cannot widen who may confirm what. A unit test of the predicate
 * proves the application agrees with the rule; only this proves the rule.
 *
 * The widening is what makes it worth testing now. A `vibe` step whose change
 * kind is not `product_change` has no executor — no run produces it, no
 * founder resolution covers it — so before this it could be completed by
 * nothing at all, and every step behind it in the plan was unreachable.
 *
 * The dangerous direction is the other one, and it is asserted hardest: a
 * `product_change` must stay refused whatever its stored `execution_support`
 * says, because `not_yet_supported` is also what an agent-buildable step
 * carries. If that ever passed, a founder could confirm away the work Vibe
 * exists to build.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: Cluster;
let fx: { userId: string; projectId: string };
let planId: string;

function answerOf(output: string): string {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trim());
  return lines.filter((line) => !["BEGIN", "COMMIT", "SET", "INSERT 0 1"].includes(line)).at(-1) ?? "";
}

/** Adds one immutable step to the fixture's plan and returns its key. */
function addStep(params: {
  key: string;
  order: number;
  actor: string;
  changeKind: string;
  executionSupport: string;
}): string {
  // Orders are scarce — the table caps a plan at nine steps — so a refusal
  // case reuses one slot. Each is asserted on its own, never against another.
  db.sql(`delete from public.action_plan_steps
          where action_plan_id = '${planId}' and step_order = ${params.order};`);
  db.sql(
    `insert into public.action_plan_steps
       (action_plan_id, step_key, step_order, title, description, purpose, actor, change_kind,
        completion_criteria, execution_support, capability)
     values ('${planId}', '${params.key}', ${params.order}, 't', 'd', 'p', '${params.actor}',
             '${params.changeKind}', 'c', '${params.executionSupport}', ${
               params.executionSupport === "vibe_executes_now"
                 ? "'nextjs_seo_foundations_v2'"
                 : "null"
             });`,
  );
  return params.key;
}

function attest(stepKey: string, finding: string | null = null): string {
  const arg = finding === null ? "null" : `'${finding.replace(/'/g, "''")}'`;
  return db.sql(
    `select public.attest_founder_action_step('${fx.projectId}', '${planId}', '${stepKey}',
       '${fx.userId}', ${arg});`,
  );
}

beforeAll(() => {
  db = startCluster(REPO_ROOT);
  db.sql(readFileSync(join(REPO_ROOT, "supabase", "tests", "fixture.sql"), "utf8"));
  const [userId, projectId] = db
    .sql(`select user_id, project_id from public.build_lifecycle_fixture('attest');`)
    .split("|");
  fx = { userId, projectId };
  planId = db.sql(
    `select id from public.action_plans where project_id = '${fx.projectId}' limit 1;`,
  );
  // The function admits only a finished plan, and the fixture leaves it planning.
  db.sql(
    `update public.action_plans
       set status = 'completed', step_count = 9, goal = 'g', source_conclusion_key = 'ck',
           source_conclusion_lineage = 'direct'
     where id = '${planId}';`,
  );
}, 300_000);

afterAll(() => db?.stop());

describe("a founder may confirm work no execution can finish", () => {
  it("admits real-world work, as it always did", () => {
    const key = addStep({
      key: "attest-founder-action",
      order: 2,
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "founder_acts",
    });

    expect(answerOf(attest(key))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["research", 3],
    ["decision", 4],
    ["analysis", 5],
    ["measurement", 6],
  ] as const)("admits Vibe's own %s work, which no run produces", (changeKind, order) => {
    const key = addStep({
      key: `attest-vibe-${changeKind}`,
      order,
      actor: "vibe",
      changeKind,
      executionSupport: "not_yet_supported",
    });

    expect(answerOf(attest(key, "Billing is partially wired."))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("converges a retry on the one evidence row", () => {
    const key = "attest-vibe-research";
    const finding = "Billing is partially wired.";
    expect(answerOf(attest(key, finding))).toBe(answerOf(attest(key, finding)));
    expect(
      db.sql(
        `select count(*) from public.action_plan_founder_attestations
         where action_plan_id = '${planId}' and action_plan_step_key = '${key}';`,
      ),
    ).toBe("1");
  });
});

describe("a founder may never confirm away work Vibe would build", () => {
  it.each(["not_yet_supported", "vibe_executes_now", "vibe_prepares"] as const)(
    "refuses a product_change stored as %s",
    (executionSupport, index) => {
      const key = addStep({
        key: `attest-product-change-${executionSupport}`,
        order: 7,
        actor: "vibe",
        changeKind: "product_change",
        executionSupport,
      });
      void index;

      expect(() => attest(key)).toThrow(/founder_action_step_not_attestable/);
    },
  );

  it.each([
    ["founder_decision", "decision", "founder_decides"],
    ["founder_input", "input", "founder_provides_input"],
    ["external_party", "external_setup", "external_dependency"],
  ] as const)("refuses %s work, which belongs to somebody else", (actor, changeKind, support) => {
    const key = addStep({
      key: `attest-other-${actor}`,
      order: 8,
      actor,
      changeKind,
      executionSupport: support,
    });

    expect(() => attest(key)).toThrow(/founder_action_step_not_attestable/);
  });

  it("refuses a step in someone else's project", () => {
    const other = db
      .sql(`select user_id from public.build_lifecycle_fixture('attest-intruder');`)
      .split("|")[0];

    expect(() =>
      db.sql(
        `select public.attest_founder_action_step('${fx.projectId}', '${planId}',
           'attest-vibe-analysis', '${other}');`,
      ),
    ).toThrow(/founder_action_step_not_attestable/);
  });
});

/**
 * A step whose output is a finding must record the finding (ADR 0093).
 *
 * The attestation ADR 0090 opened to Vibe steps closed them with a boolean,
 * and for real-world work that is right — the sitemap is submitted or it is
 * not. For Vibe's own research it loses the answer: a step asking whether
 * billing is *fully working, partially wired, or not implemented* has three,
 * its successors are written to depend on which, and a tick carries none.
 *
 * Both directions are enforced here rather than in the application, because
 * the pairing is a property of the step kind and the database is the only
 * writer that always sees it.
 */
describe("the finding a Vibe step is closed with", () => {
  it("refuses to close a Vibe step without one", () => {
    const key = addStep({
      key: "finding-missing",
      order: 9,
      actor: "vibe",
      changeKind: "research",
      executionSupport: "not_yet_supported",
    });

    expect(() => attest(key)).toThrow(/founder_step_finding_required/);
    expect(() => attest(key, "   ")).toThrow(/founder_step_finding_required/);
  });

  it("stores the founder's own words, unparsed", () => {
    const key = addStep({
      key: "finding-stored",
      order: 9,
      actor: "vibe",
      changeKind: "analysis",
      executionSupport: "vibe_prepares",
    });
    attest(key, "Stripe is wired but the route 404s.");

    expect(
      db.sql(
        `select finding from public.action_plan_founder_attestations
         where action_plan_id = '${planId}' and action_plan_step_key = '${key}';`,
      ),
    ).toBe("Stripe is wired but the route 404s.");
  });

  it("refuses a finding on real-world work, which reports nothing", () => {
    // The other direction, and it matters: accepting one here would invent a
    // second, weaker meaning for the same column.
    const key = addStep({
      key: "finding-not-accepted",
      order: 9,
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "founder_acts",
    });

    expect(() => attest(key, "I did it")).toThrow(/founder_step_finding_not_accepted/);
    expect(answerOf(attest(key))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a finding longer than the column admits", () => {
    const key = addStep({
      key: "finding-too-long",
      order: 9,
      actor: "vibe",
      changeKind: "research",
      executionSupport: "not_yet_supported",
    });

    expect(() => attest(key, "x".repeat(1201))).toThrow(
      /action_plan_founder_attestations_finding_shape/,
    );
  });
});
