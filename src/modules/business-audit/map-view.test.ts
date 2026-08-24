import { describe, expect, it } from "vitest";
import {
  buildBusinessMap,
  connectionsFrom,
  countSignals,
  evidenceSource,
  evidenceSources,
  lensesByRing,
  ringFor,
  HEALTH_LABELS,
  LENS_LABELS,
} from "./map-view";
import {
  AUDIT_SYNTHESIS_VERSION,
  BUSINESS_LENSES,
  type AuditSynthesis,
  type BusinessConclusion,
  type BusinessLens,
  type BusinessLensAssessment,
  type LensHealth,
  type LensMateriality,
} from "./schema";

/**
 * The Business Map view model (AUDIT UI-1).
 *
 * ## What these guard
 *
 * The map is a picture of a business, and a picture is persuasive whether or
 * not it is true. Most of this file asserts that nothing appears on it which
 * the audit did not actually say — no invented dependency, no lens promoted by
 * how bad it looks, no signal count inflated by evidence nobody cited.
 */

function lens(
  id: BusinessLens,
  health: LensHealth,
  materiality: LensMateriality,
  evidenceIds: string[] = [],
): BusinessLensAssessment {
  return {
    lens: id,
    health,
    materiality,
    summary: `Reasoning for ${id}.`,
    evidenceIds,
    missingContext: [],
  };
}

function conclusion(
  headline: string,
  lenses: BusinessLens[],
  evidenceIds: string[] = ["live.site.title"],
): BusinessConclusion {
  return {
    rootProblem: `Root behind ${headline}`,
    headline,
    explanation: "What it means.",
    whyItMatters: null,
    evidenceIds,
    lenses,
    tone: "critical",
    confidence: "high",
  };
}

function synthesis(
  lenses: BusinessLensAssessment[],
  blockers: BusinessConclusion[] = [],
  strengths: BusinessConclusion[] = [],
): AuditSynthesis {
  return {
    version: AUDIT_SYNTHESIS_VERSION,
    lenses,
    overall: "One sentence.",
    strengths,
    blockers,
  };
}

describe("position carries when, never how bad (§3, §11)", () => {
  it("puts a lens in the ring its materiality names", () => {
    expect(ringFor("now")).toBe("now");
    expect(ringFor("soon")).toBe("soon");
    expect(ringFor("later")).toBe("later");
  });

  /**
   * Both mean "not something to act on today". A ring of their own would encode
   * a precision the audit does not have; the node's own label still says which.
   */
  it("puts not-material and unknown in the outer ring rather than inventing orbits", () => {
    expect(ringFor("not_material")).toBe("later");
    expect(ringFor("unknown")).toBe("later");
  });

  /**
   * The sentence CORE-2a.3.1 spent a sprint making the audit able to say, now
   * as geometry: genuinely poor, and still not this month's problem.
   */
  it("keeps a weak lens in the outer ring when it is a later problem", () => {
    const map = buildBusinessMap(synthesis([lens("business_readiness", "weak", "later")]));
    const node = map.nodes.find((entry) => entry.lens === "business_readiness")!;

    expect(node.health).toBe("weak");
    expect(node.ring).toBe("later");
  });

  it("keeps an adequate lens in the inner ring when it blocks the next milestone", () => {
    const map = buildBusinessMap(synthesis([lens("conversion", "adequate", "now")]));
    expect(map.nodes.find((entry) => entry.lens === "conversion")!.ring).toBe("now");
  });
});

describe("the layout is identity, the distance is judgment", () => {
  /**
   * A map that reshuffled as materiality changed would make two audits of the
   * same business unrecognisable — and the re-audit loop depends on a founder
   * seeing a node move *inward*.
   */
  it("gives a lens the same angle whatever the audit concluded", () => {
    const early = buildBusinessMap(synthesis([lens("audience", "weak", "now")]));
    const later = buildBusinessMap(synthesis([lens("audience", "strong", "later")]));

    const angleOf = (map: ReturnType<typeof buildBusinessMap>) =>
      map.nodes.find((entry) => entry.lens === "audience")!.angle;

    expect(angleOf(early)).toBe(angleOf(later));
    expect(angleOf(early)).not.toBe(
      early.nodes.find((entry) => entry.lens === "offer")!.angle,
    );
  });

  it("always renders all nine lenses, assessed or not", () => {
    const map = buildBusinessMap(synthesis([lens("offer", "strong", "now")]));

    expect(map.nodes).toHaveLength(BUSINESS_LENSES.length);
    expect(map.assessedCount).toBe(1);
  });

  /** A missing assessment is information, not a hole to hide. */
  it("shows an unassessed lens as unknown rather than dropping it", () => {
    const map = buildBusinessMap(synthesis([lens("offer", "strong", "now")]));
    const untouched = map.nodes.find((entry) => entry.lens === "retention")!;

    expect(untouched.materiality).toBe("unknown");
    expect(HEALTH_LABELS[untouched.health]).toBe("Unknown");
  });

  /** §50 — "blocked" sounds like the product failed. It is Vibe that lacks information. */
  it("never labels a health value as blocked to the founder", () => {
    expect(HEALTH_LABELS.blocked_by_missing_context).toBe("Unknown");
    expect(Object.values(HEALTH_LABELS)).not.toContain("Blocked");
  });

  it("gives every lens a human label rather than its key", () => {
    for (const id of BUSINESS_LENSES) {
      expect(LENS_LABELS[id]).toBeTruthy();
      expect(LENS_LABELS[id]).not.toContain("_");
    }
  });
});

describe("connections are the audit's, never the map's (§15, §25)", () => {
  /**
   * 1b draws "Revenue holds up Scalability". The contract supports only
   * "Revenue and Scalability are the same problem", so that is what is drawn —
   * with the reason attached, so a line never has to be interpreted.
   */
  it("connects lenses the audit put inside one root problem", () => {
    const edges = connectionsFrom([
      conclusion("The economics aren't defined.", ["revenue_economics", "scalability"]),
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0]!.reason).toBe("The economics aren't defined.");
  });

  it("draws nothing between lenses that never shared a conclusion", () => {
    const edges = connectionsFrom([
      conclusion("A.", ["revenue_economics"]),
      conclusion("B.", ["measurement"]),
    ]);

    expect(edges).toEqual([]);
  });

  it("does not repeat an edge two conclusions both imply", () => {
    const edges = connectionsFrom([
      conclusion("A.", ["audience", "acquisition"]),
      conclusion("B.", ["acquisition", "audience"]),
    ]);

    expect(edges).toHaveLength(1);
  });

  it("names the lenses on the other end of each connection", () => {
    const map = buildBusinessMap(
      synthesis(
        [lens("revenue_economics", "weak", "now"), lens("scalability", "unclear", "later")],
        [conclusion("The economics aren't defined.", ["revenue_economics", "scalability"])],
      ),
    );

    const revenue = map.nodes.find((entry) => entry.lens === "revenue_economics")!;
    expect(revenue.relatedLenses).toEqual(["scalability"]);
  });
});

describe("rank comes from the blocker list, not from severity", () => {
  it("numbers a lens by where its blocker sits", () => {
    const map = buildBusinessMap(
      synthesis(
        [lens("audience", "weak", "now"), lens("revenue_economics", "weak", "soon")],
        [
          conclusion("Your first customer isn't defined.", ["audience"]),
          conclusion("You haven't decided how this earns.", ["revenue_economics"]),
        ],
      ),
    );

    expect(map.nodes.find((entry) => entry.lens === "audience")!.blockerRank).toBe(1);
    expect(map.nodes.find((entry) => entry.lens === "revenue_economics")!.blockerRank).toBe(2);
  });

  it("leaves a lens unranked when it produced no blocker", () => {
    const map = buildBusinessMap(synthesis([lens("offer", "strong", "now")]));
    expect(map.nodes.find((entry) => entry.lens === "offer")!.blockerRank).toBeNull();
  });

  it("keeps the first rank when one lens spans two blockers", () => {
    const map = buildBusinessMap(
      synthesis(
        [lens("revenue_economics", "weak", "now")],
        [
          conclusion("First.", ["revenue_economics"]),
          conclusion("Second.", ["revenue_economics"]),
        ],
      ),
    );

    expect(map.nodes.find((entry) => entry.lens === "revenue_economics")!.blockerRank).toBe(1);
  });
});

describe("evidence provenance is read, not assumed (§22)", () => {
  it.each([
    ["live.site.title", "from your live site"],
    ["repo.deps.next", "from your code"],
    ["auth.surface.dashboard", "from your signed-in product"],
    ["intent.how_it_earns", "from your answers"],
    ["profile.identity.name", "from what Vibe understood"],
  ])("labels %s as %s", (id, expected) => {
    expect(evidenceSource(id)).toBe(expected);
  });

  /** A new source shows no label rather than a wrong one. */
  it("returns nothing for an unrecognised prefix", () => {
    expect(evidenceSource("telemetry.something.new")).toBeNull();
  });

  it("lists each distinct source once, in first-use order", () => {
    expect(
      evidenceSources(["repo.a", "live.b", "repo.c", "intent.d"]),
    ).toEqual(["from your code", "from your live site", "from your answers"]);
  });
});

describe("the signal count is what the audit actually cited (§7)", () => {
  /**
   * The header carries this number to say the judgment came from a real
   * analysis. Counting the evidence pack instead would say the opposite: a
   * bigger number for evidence the audit never used.
   */
  it("counts distinct citations across lenses and conclusions", () => {
    const map = buildBusinessMap(
      synthesis(
        [
          lens("offer", "strong", "now", ["live.a", "repo.b"]),
          lens("audience", "weak", "now", ["live.a"]),
        ],
        [conclusion("A blocker.", ["audience"], ["intent.c"])],
      ),
    );

    expect(map.signalCount).toBe(3);
  });

  it("is zero for a synthesis that cites nothing", () => {
    expect(countSignals(synthesis([lens("offer", "strong", "now")]))).toBe(0);
  });
});

describe("the mobile representation carries the same judgment (§17, §64)", () => {
  it("groups lenses into priority buckets in reading order", () => {
    const map = buildBusinessMap(
      synthesis([
        lens("audience", "weak", "now"),
        lens("revenue_economics", "weak", "soon"),
        lens("measurement", "weak", "later"),
        lens("retention", "adequate", "not_material"),
      ]),
    );

    const groups = lensesByRing(map);
    expect(groups.map((group) => group.ring)).toEqual(["now", "soon", "later"]);
    expect(groups[0]!.nodes.map((node) => node.lens)).toEqual(["audience"]);
    // Everything not actionable shares the outer bucket, labels intact.
    expect(groups[2]!.nodes.map((node) => node.lens)).toContain("retention");
  });

  it("omits an empty bucket rather than showing a heading with nothing under it", () => {
    const map = buildBusinessMap(synthesis(BUSINESS_LENSES.map((id) => lens(id, "weak", "later"))));
    expect(lensesByRing(map).map((group) => group.ring)).toEqual(["later"]);
  });
});
