import { describe, expect, it } from "vitest";
import {
  BLOCK_FOR_MOMENT,
  BLOCK_FOR_OPERATION,
  progressSequenceFor,
  watchableOperations,
} from "./blocks";
import { FOCUS_CANDIDATE_KINDS } from "./focus";
import { OPERATION_TYPES } from "../operations/schema";

/**
 * The registry's whole job is to be total, so this checks it against the
 * domain's own unions rather than against a list written next to it. A second
 * list would go stale in exactly the way the registry exists to prevent.
 */
describe("what a founder sees for each state", () => {
  it("decides something for every operation the product can run", () => {
    for (const type of OPERATION_TYPES) {
      expect(BLOCK_FOR_OPERATION[type], type).toBeDefined();
    }
    expect(Object.keys(BLOCK_FOR_OPERATION).sort()).toEqual([...OPERATION_TYPES].sort());
  });

  it("decides something for every moment Nova can raise", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      expect(BLOCK_FOR_MOMENT[kind], kind).toBeDefined();
    }
    expect(Object.keys(BLOCK_FOR_MOMENT).sort()).toEqual([...FOCUS_CANDIDATE_KINDS].sort());
  });

  /*
   * `none` is an answer and there are enough of them that a typo turning a real
   * block into one would be easy to miss. This does not name which — that would
   * be the registry written twice — but it does refuse a registry that has
   * quietly become all silence.
   */
  it("shows something for more states than it hides", () => {
    const shown = OPERATION_TYPES.filter((type) => BLOCK_FOR_OPERATION[type] !== "none");
    expect(shown.length).toBeGreaterThan(OPERATION_TYPES.length / 2);
  });

  /*
   * Two lists that must agree and are never compared is how they stop
   * agreeing. `nova/read.ts` decides which operations Nova reports progress
   * for; this decides which have something to show. Anything Nova watches must
   * have a block, or a founder gets a running state with a blank space in it.
   *
   * The list is retyped rather than imported because `read.ts` is
   * `server-only` and importing it here would fail before the assertion ran.
   * It is not free-form: `as const` makes every entry an `OperationType`, so a
   * renamed or deleted type fails to compile in this file too.
   */
  it("has a block for everything Nova reports progress on", () => {
    const watched = [
      "product_scan",
      "business_audit",
      "opportunity_generation",
      "action_planning",
      "agent_execution",
      "change_merge",
    ] as const;

    for (const type of watched) {
      expect(BLOCK_FOR_OPERATION[type], type).not.toBe("none");
      expect(watchableOperations()).toContain(type);
    }
  });

  /*
   * A block kind is a promise that something can be drawn. `progress` is the
   * one kind that needs a second thing to exist — the named stages — and the
   * two are decided in different files, so a mapping to `progress` without a
   * sequence would render a run with an empty checklist under it.
   */
  it("has named stages for exactly the operations shown as progress", () => {
    for (const type of OPERATION_TYPES) {
      const shownAsProgress = BLOCK_FOR_OPERATION[type] === "progress";
      expect(progressSequenceFor(type) !== null, type).toBe(shownAsProgress);
    }
  });

  /*
   * And the sequence is the operation's own. The two ids happen to share their
   * names today, which is what makes the narrowing safe and also what would
   * make a silent swap invisible.
   */
  it("gives each run its own stages", () => {
    expect(progressSequenceFor("action_planning")).toBe("action_planning");
    expect(progressSequenceFor("opportunity_generation")).toBe("opportunity_generation");
    expect(progressSequenceFor("business_audit")).toBeNull();
  });
});
