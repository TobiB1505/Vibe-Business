import { describe, expect, it } from "vitest";
import { conclusionKeySet, findConclusionByKey, identifiedConclusions } from "./conclusions";
import { fakeConclusion, fakePlannedAudit } from "@/modules/action-plans/test-support";

/**
 * Stable conclusion identity (CORE-2b FIX §1).
 *
 * The property under test is that a key means the same thing every time it is read from
 * the same stored audit — because the Opportunity Engine writes one into a database row
 * and the Action Planner resolves it back weeks later.
 */

function auditWith(blockers: number, strengths: number) {
  return fakePlannedAudit({
    synthesis: {
      version: "business-audit-synthesis-v6",
      lenses: [],
      overall: "…",
      strengths: Array.from({ length: strengths }, (unused, index) =>
        fakeConclusion({ rootProblem: `Strength ${index + 1}.`, tone: "positive" }),
      ),
      blockers: Array.from({ length: blockers }, (unused, index) =>
        fakeConclusion({ rootProblem: `Blocker ${index + 1}.` }),
      ),
    },
  });
}

describe("identifiedConclusions", () => {
  it("keys blockers and strengths separately, 1-based", () => {
    const identified = identifiedConclusions(auditWith(2, 2));

    expect(identified.map((entry) => entry.key)).toEqual([
      "blocker-1",
      "blocker-2",
      "strength-1",
      "strength-2",
    ]);
  });

  /** Blockers first — the audit's own order is its priority statement. */
  it("puts blockers before strengths", () => {
    const identified = identifiedConclusions(auditWith(1, 1));

    expect(identified[0].kind).toBe("blocker");
    expect(identified[1].kind).toBe("strength");
  });

  it("is stable across repeated reads of the same audit", () => {
    const audit = auditWith(3, 1);

    expect(identifiedConclusions(audit).map((entry) => entry.key)).toEqual(
      identifiedConclusions(audit).map((entry) => entry.key),
    );
  });

  /**
   * An audit predating the synthesis contract has no conclusions, and that is a real
   * state rather than an error — the planner turns it into an honest refusal.
   */
  it("returns nothing for an audit with no synthesis", () => {
    expect(identifiedConclusions(fakePlannedAudit({ synthesis: null }))).toEqual([]);
  });
});

describe("findConclusionByKey", () => {
  it("resolves a key to the conclusion it addresses", () => {
    const audit = auditWith(2, 0);

    expect(findConclusionByKey(audit, "blocker-2")?.conclusion.rootProblem).toBe("Blocker 2.");
  });

  it("returns null for a key this audit does not contain", () => {
    expect(findConclusionByKey(auditWith(1, 0), "blocker-9")).toBeNull();
    expect(findConclusionByKey(auditWith(1, 0), "strength-1")).toBeNull();
  });

  /**
   * A key from one audit must not silently resolve against another.
   *
   * It cannot, because the key is only ever looked up inside a specific document — the
   * audit id is the other half of the address. This pins the consequence: the same key
   * means different things in different audits, which is why both halves are stored.
   */
  it("resolves the same key differently in different audits", () => {
    expect(findConclusionByKey(auditWith(1, 0), "blocker-1")?.conclusion.rootProblem).toBe(
      "Blocker 1.",
    );
    expect(
      findConclusionByKey(
        fakePlannedAudit({
          synthesis: {
            version: "business-audit-synthesis-v6",
            lenses: [],
            overall: "…",
            strengths: [],
            blockers: [fakeConclusion({ rootProblem: "Something else entirely." })],
          },
        }),
        "blocker-1",
      )?.conclusion.rootProblem,
    ).toBe("Something else entirely.");
  });
});

describe("conclusionKeySet", () => {
  it("offers exactly the keys the audit contains", () => {
    expect([...conclusionKeySet(auditWith(2, 1))].sort()).toEqual([
      "blocker-1",
      "blocker-2",
      "strength-1",
    ]);
  });

  it("is empty for an audit with no synthesis", () => {
    expect(conclusionKeySet(fakePlannedAudit({ synthesis: null })).size).toBe(0);
  });
});
