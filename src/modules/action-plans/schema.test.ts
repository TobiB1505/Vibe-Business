import { describe, expect, it } from "vitest";
import { checkedValues } from "@/modules/operations/migration-test-support";
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
