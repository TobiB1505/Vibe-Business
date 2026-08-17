import { describe, expect, it } from "vitest";
import type { BusinessConclusion, BusinessReadinessAudit } from "@/modules/business-audit/schema";
import {
  MOVES_CONTEXT_PARAM,
  movesContextHref,
  movesPerConclusion,
  partitionByContext,
  resolveMoveLineage,
  resolveMovesContext,
} from "./lineage";
import { fakeOpportunity } from "@/modules/action-plans/test-support";
import type { BusinessOpportunity } from "./schema";

/**
 * The identity rule, pinned (UI-S2 §43, §50).
 *
 * ## The sibling file
 *
 * `lineage.test.ts` covers where the relationship is **created** — that the
 * model is shown the conclusion keys, and that a key it returns is verified
 * against the audit rather than trusted. This file covers where it is **read**:
 * given a set that already records its keys, which finding does each Move
 * answer, and what does the screen do with that.
 *
 * Every test here exists because of a specific way the seam between an audit
 * and its Moves could quietly start lying: by matching on prose, by rebinding a
 * historical Move to a newer diagnosis, by inventing a source for a Move that
 * has none, or by reordering a list the engine already ordered. Those are not
 * display bugs — each one makes the product assert a causal link nobody made.
 */

function conclusion(headline: string, overrides: Partial<BusinessConclusion> = {}): BusinessConclusion {
  return {
    headline,
    explanation: `Explanation for ${headline}`,
    lenses: ["offer"],
    evidenceIds: [],
    ...overrides,
  } as BusinessConclusion;
}

function audit(blockers: BusinessConclusion[], strengths: BusinessConclusion[] = []): BusinessReadinessAudit {
  return {
    synthesis: { blockers, strengths, lenses: [] },
  } as unknown as BusinessReadinessAudit;
}

function move(overrides: Partial<BusinessOpportunity>): BusinessOpportunity {
  return { ...fakeOpportunity(), ...overrides };
}

const PAYMENT = "People don't yet have a clear way to pay you.";
const AUDIENCE = "It isn't clear who this is for.";

describe("resolving which finding a Move answers", () => {
  it("resolves through the stored key, into the audit's own words", () => {
    const lineage = resolveMoveLineage({
      sourceAudit: audit([conclusion(PAYMENT)]),
      opportunities: [move({ id: "m1", sourceConclusionKey: "blocker-1" })],
    });

    expect(lineage.m1).toEqual({ conclusionKey: "blocker-1", headline: PAYMENT });
  });

  /**
   * The rule this module exists to hold (§4, §43.2).
   *
   * The Move's title is deliberately identical to a conclusion headline it does
   * **not** cite. A resolver that fell back to text similarity would attach it
   * to the wrong finding and look entirely convincing doing so.
   */
  it("never matches by title, headline or any other prose", () => {
    const lineage = resolveMoveLineage({
      sourceAudit: audit([conclusion(PAYMENT), conclusion(AUDIENCE)]),
      opportunities: [
        move({ id: "m1", title: PAYMENT, problem: PAYMENT, sourceConclusionKey: "blocker-2" }),
      ],
    });

    expect(lineage.m1.headline).toBe(AUDIENCE);
  });

  it("resolves nothing for a legacy Move that stored no key", () => {
    const lineage = resolveMoveLineage({
      sourceAudit: audit([conclusion(PAYMENT)]),
      opportunities: [move({ id: "m1", sourceConclusionKey: null })],
    });

    expect(lineage.m1).toBeUndefined();
  });

  /** A key naming nothing is a mismatch, not a licence to pick something. */
  it("fabricates no lineage when the key names nothing in the audit", () => {
    const lineage = resolveMoveLineage({
      sourceAudit: audit([conclusion(PAYMENT)]),
      opportunities: [move({ id: "m1", sourceConclusionKey: "blocker-9" })],
    });

    expect(lineage.m1).toBeUndefined();
    expect(Object.keys(lineage)).toHaveLength(0);
  });

  it("does not crash when the source audit cannot be read", () => {
    expect(
      resolveMoveLineage({
        sourceAudit: null,
        opportunities: [move({ id: "m1", sourceConclusionKey: "blocker-1" })],
      }),
    ).toEqual({});
  });

  it("resolves strengths as well as blockers", () => {
    const lineage = resolveMoveLineage({
      sourceAudit: audit([conclusion(PAYMENT)], [conclusion("Your onboarding is strong.")]),
      opportunities: [move({ id: "m1", sourceConclusionKey: "strength-1" })],
    });

    expect(lineage.m1.headline).toBe("Your onboarding is strong.");
  });

  /** §24: one finding, several Moves. The data says so, so the UI must. */
  it("maps several Moves onto one finding", () => {
    const lineage = resolveMoveLineage({
      sourceAudit: audit([conclusion(PAYMENT)]),
      opportunities: [
        move({ id: "m1", rank: 1, sourceConclusionKey: "blocker-1" }),
        move({ id: "m2", rank: 2, sourceConclusionKey: "blocker-1" }),
      ],
    });

    expect(movesPerConclusion(lineage)).toEqual({ "blocker-1": 2 });
  });

  /**
   * §7, §43.3 — the trust boundary.
   *
   * Both audits have a `blocker-1`; they are different findings. A set built
   * from the older audit keeps answering the older audit, and resolving it
   * against the newer one would silently reassign it. The caller is what
   * chooses the audit, so this asserts the consequence of that choice.
   */
  it("stays bound to whichever audit it is resolved against", () => {
    const historical = audit([conclusion(PAYMENT)]);
    const current = audit([conclusion(AUDIENCE)]);
    const opportunities = [move({ id: "m1", sourceConclusionKey: "blocker-1" })];

    expect(resolveMoveLineage({ sourceAudit: historical, opportunities }).m1.headline).toBe(PAYMENT);
    expect(resolveMoveLineage({ sourceAudit: current, opportunities }).m1.headline).toBe(AUDIENCE);
  });
});

describe("entering the Moves page from one finding", () => {
  const opportunities = [
    move({ id: "m1", rank: 1, sourceConclusionKey: "blocker-1" }),
    move({ id: "m2", rank: 2, sourceConclusionKey: "blocker-2" }),
    move({ id: "m3", rank: 3, sourceConclusionKey: "blocker-1" }),
  ];
  const lineage = resolveMoveLineage({
    sourceAudit: audit([conclusion(PAYMENT), conclusion(AUDIENCE)]),
    opportunities,
  });

  it("selects only the Moves that address the requested finding", () => {
    const context = resolveMovesContext({ requested: "blocker-1", lineage, opportunities });

    expect(context).not.toBeNull();
    expect(context?.moveIds).toEqual(["m1", "m3"]);
    expect(context?.headline).toBe(PAYMENT);
  });

  it("returns no context without a request", () => {
    for (const requested of [null, undefined, ""]) {
      expect(resolveMovesContext({ requested, lineage, opportunities })).toBeNull();
    }
  });

  /** §31: a malformed value degrades to the ordinary page, never to an error. */
  it("refuses anything that is not a key this project's Moves cite", () => {
    for (const requested of [
      "blocker-99",
      "../../etc/passwd",
      "https://evil.example",
      "<script>",
      "blocker-1 ",
      "x".repeat(500),
    ]) {
      expect(resolveMovesContext({ requested, lineage, opportunities }), requested).toBeNull();
    }
  });

  /**
   * §43.5 — the cross-project boundary.
   *
   * The lineage map is built from one project's own set, so a key that another
   * project's audit uses resolves to nothing here. There is no lookup to
   * poison: the requested value is only ever compared against keys already
   * resolved under this caller's scope.
   */
  it("cannot surface another project's finding through a guessed key", () => {
    const foreignLineage = resolveMoveLineage({
      sourceAudit: audit([conclusion("Another project's problem.")]),
      opportunities: [move({ id: "other", sourceConclusionKey: "blocker-1" })],
    });

    // `blocker-1` is a perfectly valid key over there and resolves to nothing
    // against this project's Moves.
    expect(
      resolveMovesContext({ requested: "blocker-1", lineage: {}, opportunities }),
    ).toBeNull();
    expect(foreignLineage.other.headline).toBe("Another project's problem.");
  });

  it("is not a context when nothing addresses the finding", () => {
    const noMoves = resolveMovesContext({ requested: "blocker-2", lineage: {}, opportunities });
    expect(noMoves).toBeNull();
  });

  it("builds an internal, project-relative href", () => {
    const href = movesContextHref("/app/projects/p1/moves", "blocker-1");
    expect(href).toBe(`/app/projects/p1/moves?${MOVES_CONTEXT_PARAM}=blocker-1`);
    expect(href.startsWith("/")).toBe(true);
  });
});

describe("elevation never becomes reranking", () => {
  const opportunities = [
    move({ id: "m3", rank: 3, sourceConclusionKey: "blocker-1" }),
    move({ id: "m1", rank: 1, sourceConclusionKey: "blocker-2" }),
    move({ id: "m2", rank: 2, sourceConclusionKey: "blocker-1" }),
  ];
  const lineage = resolveMoveLineage({
    sourceAudit: audit([conclusion(PAYMENT), conclusion(AUDIENCE)]),
    opportunities,
  });

  /** §44: contextual entry may change what is shown first, never the ranks. */
  it("keeps the engine's rank inside a contextual group", () => {
    const context = resolveMovesContext({ requested: "blocker-1", lineage, opportunities });
    const { addressing, others } = partitionByContext(opportunities, context);

    expect(addressing.map((entry) => entry.rank)).toEqual([2, 3]);
    expect(others.map((entry) => entry.rank)).toEqual([1]);
    // No renumbering: rank 2 is still rank 2 even when shown first.
    expect(addressing[0].rank).toBe(2);
  });

  it("returns the whole list in rank order without a context", () => {
    const { addressing, others } = partitionByContext(opportunities, null);

    expect(addressing).toEqual([]);
    expect(others.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it("never mutates the caller's array", () => {
    const original = [...opportunities];
    partitionByContext(opportunities, null);
    expect(opportunities).toEqual(original);
  });

  it("loses no Move when partitioning", () => {
    const context = resolveMovesContext({ requested: "blocker-1", lineage, opportunities });
    const { addressing, others } = partitionByContext(opportunities, context);
    expect(addressing.length + others.length).toBe(opportunities.length);
  });
});
