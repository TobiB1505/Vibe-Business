import { describe, expect, it } from "vitest";
import {
  toPreparedChangeLoopFacts,
  type PreparedChangeVerdicts,
} from "./loop-facts";

/**
 * What the database said, turned into what the loop rail is told (UI-8 §1).
 *
 * The mapping is small and every line of it is a claim about a founder's
 * project, so it is tested here rather than left to a live project to
 * exercise. Two of these assertions exist because the opposite behaviour would
 * be a lie rather than a bug: a change nobody validated is not a failed one,
 * and a change with no verdict rows has not been approved.
 */

function verdicts(
  entries: Record<string, Partial<PreparedChangeVerdicts>> = {},
): Map<string, PreparedChangeVerdicts> {
  return new Map(
    Object.entries(entries).map(([id, verdict]) => [
      id,
      { approved: false, merged: false, mergeStalled: false, ...verdict },
    ]),
  );
}

describe("toPreparedChangeLoopFacts", () => {
  it("reads a passing validation as passed and nothing else", () => {
    const [facts] = toPreparedChangeLoopFacts([{ id: "a", validationStatus: "passed" }], verdicts());

    expect(facts).toEqual({
      validationPassed: true,
      validationFailed: false,
      approved: false,
      merged: false,
      mergeStalled: false,
    });
  });

  it("reads a failing validation as failed", () => {
    const [facts] = toPreparedChangeLoopFacts([{ id: "a", validationStatus: "failed" }], verdicts());

    expect(facts.validationFailed).toBe(true);
    expect(facts.validationPassed).toBe(false);
  });

  /*
   * `null` means nothing has run. Rendering that as a failure would put a red
   * step on the rail of a project whose change is simply waiting to be checked
   * — the same "never a false failed" the summary type promises in its own
   * docblock.
   */
  it("does not treat an unvalidated change as failed", () => {
    const [facts] = toPreparedChangeLoopFacts([{ id: "a", validationStatus: null }], verdicts());

    expect(facts.validationPassed).toBe(false);
    expect(facts.validationFailed).toBe(false);
  });

  /*
   * A cancelled run says nothing about the change — somebody stopped it. This
   * matches `validationGate`, which reads `cancelled` as "not checked".
   */
  it("does not treat a cancelled validation as failed", () => {
    const [facts] = toPreparedChangeLoopFacts([{ id: "a", validationStatus: "cancelled" }], verdicts());

    expect(facts.validationFailed).toBe(false);
  });

  it("carries the approval and merge verdicts for the matching change", () => {
    const [facts] = toPreparedChangeLoopFacts(
      [{ id: "a", validationStatus: "passed" }],
      verdicts({ a: { approved: true, merged: true } }),
    );

    expect(facts).toMatchObject({ approved: true, merged: true });
  });

  it("does not give one change another change's verdict", () => {
    const [first, second] = toPreparedChangeLoopFacts(
      [
        { id: "a", validationStatus: "passed" },
        { id: "b", validationStatus: "passed" },
      ],
      verdicts({ a: { merged: true } }),
    );

    expect(first.merged).toBe(true);
    expect(second.merged).toBe(false);
  });

  /*
   * A missing verdict is the honest default and the conservative one. When the
   * read fails, `getPreparedChangeVerdicts` returns an empty map — and the rail
   * must then say "not approved yet", never invent progress the project has
   * not made.
   */
  it("treats an absent verdict as no progress", () => {
    const [facts] = toPreparedChangeLoopFacts([{ id: "a", validationStatus: "passed" }], verdicts());

    expect(facts).toMatchObject({ approved: false, merged: false, mergeStalled: false });
  });

  it("returns nothing for a project with no prepared changes", () => {
    expect(toPreparedChangeLoopFacts([], verdicts())).toEqual([]);
  });
});
