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

/** The shape a build handoff exists for, and the one attestation must refuse. */
function addProductChange(key: string, order: number): string {
  return addStep({
    key,
    order,
    actor: "vibe",
    changeKind: "product_change",
    executionSupport: "not_yet_supported",
  });
}

function handoff(stepKey: string, tool = "claude_code", purpose = "build"): string {
  return db.sql(
    `select public.record_action_plan_handoff('${fx.projectId}', '${planId}', '${stepKey}',
       '${fx.userId}', '${tool}', '${purpose}');`,
  );
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

/**
 * A step Vibe declined and handed out (ADR 0096).
 *
 * `vibe` + `product_change` is excluded from attestation on purpose: it is the
 * work the agent exists to build, and letting a founder tick it off would be
 * the one way to lose it. So the exception cannot be a *shape* — a resolver's
 * opinion at render time would do — it has to be a durable fact, written only
 * where Vibe refuses by policy and bound to one immutable plan/step pair.
 *
 * These tests exist because that gate lives in the database and nowhere else is
 * authoritative.
 */
describe("a step Vibe handed to the founder", () => {
  it("cannot be attested before a handoff exists", () => {
    const key = addProductChange("handoff-before", 9);

    expect(() => attest(key, "I built it")).toThrow(/founder_action_step_not_attestable/);
  });

  it("can be attested once one does, and still carries its finding", () => {
    const key = addProductChange("handoff-after", 9);
    handoff(key);

    expect(answerOf(attest(key, "Claude Code wired Stripe checkout."))).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(
      db.sql(
        `select finding from public.action_plan_founder_attestations
         where action_plan_id = '${planId}' and action_plan_step_key = '${key}';`,
      ),
    ).toBe("Claude Code wired Stripe checkout.");
  });

  it("does not admit any other step in the same plan", () => {
    // Per step, never per plan: handing out one change must not open the next.
    const handed = addProductChange("handoff-scoped-a", 8);
    handoff(handed);
    const other = addProductChange("handoff-scoped-b", 9);

    expect(() => attest(other, "I built it")).toThrow(/founder_action_step_not_attestable/);
  });

  it("refuses a handoff for work that is not the agent's to begin with", () => {
    // A founder_action step is already attestable and a decision is answered,
    // not built. Issuing a handoff there would create a second way to close
    // work that already has one.
    const founderWork = addStep({
      key: "handoff-founder-work",
      order: 9,
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "founder_acts",
    });

    expect(() => handoff(founderWork)).toThrow(/action_plan_step_not_handoffable/);
  });

  it("refuses a handoff in someone else's project", () => {
    const key = addProductChange("handoff-intruder", 9);
    const other = db
      .sql(`select user_id from public.build_lifecycle_fixture('handoff-intruder-fx');`)
      .split("|")[0];

    expect(() =>
      db.sql(
        `select public.record_action_plan_handoff('${fx.projectId}', '${planId}', '${key}',
           '${other}', 'claude_code', 'build');`,
      ),
    ).toThrow(/action_plan_step_not_handoffable/);
  });

  it("refuses a tool outside the closed list", () => {
    const key = addProductChange("handoff-bad-tool", 9);

    expect(() => handoff(key, "my_own_agent")).toThrow(/action_plan_handoffs_tool_check/);
  });

  it("converges a retry on the one row", () => {
    const key = addProductChange("handoff-retry", 9);

    expect(answerOf(handoff(key))).toBe(answerOf(handoff(key)));
    expect(
      db.sql(
        `select count(*) from public.action_plan_handoffs
         where action_plan_id = '${planId}' and action_plan_step_key = '${key}';`,
      ),
    ).toBe("1");
  });
});

/**
 * The second kind of handoff, and why it is a different word.
 *
 * A `build` handoff is a refusal: Vibe will not write this code. A `verify`
 * handoff is the opposite — Vibe *cannot reach* the check, because its
 * validation sandbox runs with no network and no credential and can therefore
 * never complete a real checkout. The founder's own tool has the keys, the
 * running app and the session.
 *
 * The distinction earns a column rather than a sentence because one of them
 * grants something: a build handoff is what admits a `vibe` + `product_change`
 * step to founder attestation, and that must never follow from a prompt issued
 * to check something.
 */
describe("a handoff issued to check rather than to build", () => {
  it("admits the founder's own measurement", () => {
    const key = addStep({
      key: "verify-measurement",
      order: 8,
      actor: "founder_action",
      changeKind: "measurement",
      executionSupport: "founder_acts",
    });

    expect(answerOf(handoff(key, "claude_code", "verify"))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses to verify a step Vibe would build", () => {
    // The shapes do not overlap in either direction: a product change is not a
    // measurement, and issuing a verify prompt for one would be a second way to
    // hand out work the agent exists to do.
    const key = addProductChange("verify-product-change", 9);

    expect(() => handoff(key, "claude_code", "verify")).toThrow(
      /action_plan_step_not_handoffable/,
    );
  });

  it("refuses to build a step that is the founder's to measure", () => {
    const key = "verify-measurement";

    expect(() => handoff(key, "claude_code", "build")).toThrow(
      /action_plan_step_not_handoffable/,
    );
  });

  it("refuses a purpose outside the closed pair", () => {
    const key = "verify-measurement";

    expect(() => handoff(key, "claude_code", "audit")).toThrow(
      /action_plan_handoff_purpose_unknown/,
    );
  });

  it("does not let a verify handoff admit a product change to attestation", () => {
    /*
     * The reason the column exists. The attestation's handoff arm is the one
     * place a `vibe` + `product_change` step may be closed by hand, and it now
     * names `purpose = 'build'` — so a row written for verification cannot
     * inherit that permission if the admitted shapes ever move.
     */
    const key = addProductChange("verify-cannot-admit", 7);
    db.sql(
      `insert into public.action_plan_handoffs
         (project_id, action_plan_id, action_plan_step_key, action_plan_step_order, tool,
          purpose, issued_to_user_id)
       values ('${fx.projectId}', '${planId}', '${key}', 7, 'claude_code', 'verify',
               '${fx.userId}');`,
    );

    expect(() => attest(key, "I built it")).toThrow(/founder_action_step_not_attestable/);
  });
});

/**
 * A measurement records what it found; every other founder action does not.
 *
 * The old rule keyed on the actor alone — `vibe` steps write a finding,
 * everybody else must not — and it was right for real-world setup work: the
 * sitemap is submitted or it is not, and there is nothing to write down. A
 * measurement is the opposite. The result *is* the step's output, and closing
 * it with a bare tick threw away the one thing the next planning run most
 * needed.
 */
describe("what a founder step records when it closes", () => {
  it("requires the result of a measurement", () => {
    const key = addStep({
      key: "measure-requires",
      order: 8,
      actor: "founder_action",
      changeKind: "measurement",
      executionSupport: "founder_acts",
    });

    expect(() => attest(key)).toThrow(/founder_step_finding_required/);
    expect(answerOf(attest(key, "Paid the 19 tier, subscription active."))).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("still refuses one on real-world setup work", () => {
    const key = addStep({
      key: "setup-refuses-finding",
      order: 9,
      actor: "founder_action",
      changeKind: "external_setup",
      executionSupport: "founder_acts",
    });

    expect(() => attest(key, "Submitted it")).toThrow(/founder_step_finding_not_accepted/);
    expect(answerOf(attest(key))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
