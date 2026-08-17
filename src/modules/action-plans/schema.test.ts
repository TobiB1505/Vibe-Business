import { describe, expect, it } from "vitest";
import { checkedValues, migrationSql } from "@/modules/operations/migration-test-support";
import { EXECUTION_CAPABILITIES } from "@/modules/execution/schema";
import { OPERATION_STAGES, OPERATION_TYPES } from "@/modules/operations/schema";
import {
  ACTION_PLAN_STATUSES,
  EXECUTION_SUPPORT,
  MAX_PLAN_STEPS,
  MIN_PLAN_STEPS,
  STEP_ACTORS,
  STEP_CHANGE_KINDS,
} from "./schema";
import { CONCLUSION_LINEAGES } from "./source";

/**
 * The TypeScript unions, pinned to the SQL CHECK constraints.
 *
 * This file exists because the drift it catches has happened repeatedly in this
 * repository, and the in-memory test database does not evaluate constraints —
 * so no behavioural test can see a union and a CHECK disagree. Every value that
 * can reach an INSERT is asserted here, on the day the table is created rather
 * than after the first production failure.
 */

describe("action_plan_steps constraints", () => {
  it("permits exactly the actors the application can persist", () => {
    expect(checkedValues("action_plan_steps", "actor").sort()).toEqual([...STEP_ACTORS].sort());
  });

  it("permits exactly the change kinds the application can persist", () => {
    expect(checkedValues("action_plan_steps", "change_kind").sort()).toEqual(
      [...STEP_CHANGE_KINDS].sort(),
    );
  });

  it("permits exactly the execution support values the classifier can produce", () => {
    expect(checkedValues("action_plan_steps", "execution_support").sort()).toEqual(
      [...EXECUTION_SUPPORT].sort(),
    );
  });

  /**
   * The capability column may only carry ids that exist as capabilities.
   *
   * Includes the historical v1: a step never resolves to it, but the column's
   * vocabulary is the execution module's, and narrowing it here would make the
   * two definitions of "a capability" disagree.
   */
  it("permits exactly the known execution capabilities", () => {
    expect(checkedValues("action_plan_steps", "capability").sort()).toEqual(
      [...EXECUTION_CAPABILITIES].sort(),
    );
  });
});

describe("action_plans constraints", () => {
  it("permits exactly the run statuses the store writes", () => {
    expect(checkedValues("action_plans", "status").sort()).toEqual([...ACTION_PLAN_STATUSES].sort());
  });
});

describe("operation_runs constraints", () => {
  /**
   * The one that would have broken production silently.
   *
   * A start path that inserts `action_planning` against a constraint that does
   * not permit it fails at INSERT and surfaces as a generic failure, with every
   * unit test green.
   */
  it("permits the action planning operation type", () => {
    expect(checkedValues("operation_runs", "operation_type")).toContain("action_planning");
  });

  it("permits the planning stage", () => {
    expect(checkedValues("operation_runs", "stage")).toContain("planning");
  });

  it("still permits every operation type and stage the application knows about", () => {
    const types = checkedValues("operation_runs", "operation_type");
    for (const type of OPERATION_TYPES) expect(types).toContain(type);

    const stages = checkedValues("operation_runs", "stage");
    for (const stage of OPERATION_STAGES) expect(stages).toContain(stage);
  });
});

/**
 * The lineage columns (CORE-2b FIX §10).
 *
 * Read out of the migration source rather than asserted against a live database, for
 * the reason this file exists at all: the in-memory test database evaluates no
 * constraints, so a union and a CHECK can drift with every behavioural test green.
 */
describe("Move → Conclusion lineage schema", () => {
  const sql = () => migrationSql().join("\n");

  it("records the source conclusion on a Move", () => {
    expect(sql()).toContain("alter table public.business_opportunities\n  add column source_conclusion_key text");
  });

  it("records the source conclusion and its lineage on a plan", () => {
    expect(sql()).toContain("alter table public.action_plans\n  add column source_conclusion_key text");
    expect(sql()).toContain("add column source_conclusion_lineage text");
  });

  it("permits exactly the lineages the application can produce", () => {
    expect(checkedValues("action_plans", "source_conclusion_lineage").sort()).toEqual(
      [...CONCLUSION_LINEAGES].sort(),
    );
  });

  /**
   * §7 at the database: a completed plan knows what problem it was solving.
   *
   * The application refuses long before this — readiness will not let a run start
   * without a resolved source — so the constraint is the backstop that makes a bug
   * there fail loudly rather than persisting a plan with no problem attached.
   */
  it("refuses a completed plan with no source conclusion", () => {
    expect(sql()).toContain("action_plans_completed_has_conclusion");
    expect(sql()).toContain("action_plans_completed_has_lineage");
  });
});

describe("plan size", () => {
  /**
   * The database's `step_count` range and the application's constants are the
   * same rule written twice. A completed plan outside the range fails at
   * UPDATE, so they have to agree.
   */
  it("matches the step_count range the schema permits", () => {
    expect(MIN_PLAN_STEPS).toBe(2);
    expect(MAX_PLAN_STEPS).toBe(9);
  });
});
