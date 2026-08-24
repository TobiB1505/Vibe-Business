import { describe, expect, it } from "vitest";
import { readSurfaceCitation, surfaceEvidenceId } from "./evidence-ids";

/**
 * Reading a citation under the pack that minted it.
 *
 * The property that matters is not that v4 works. It is that a **stored v3
 * citation keeps meaning what it meant** — which is "this check was made", not
 * "this surface exists". Every other guarantee in this module rests on that one.
 */

const V3 = "business-evidence.v3";
const V4 = "business-evidence.v4";

describe("a v3 citation cannot be read as presence", () => {
  /**
   * The ambiguity Sprint 0073 found on screen, now stated as a value.
   *
   * `buildRepositoryEvidence` minted this id whether it found the surface or
   * not. A reader that answered "present" here would be inventing the half of
   * the fact the id never carried — which is exactly what `describeEvidenceId`
   * did before 0073, telling founders their code contained a payments surface
   * against a pack whose own label read "not detected".
   */
  it("reports unknown polarity, not present", () => {
    expect(readSurfaceCitation("repo.surface.payments", V3)).toEqual({
      namespace: "repo",
      surfaceId: "payments",
      polarity: "unknown",
    });
  });

  it.each(["business-evidence.v1", "business-evidence.v2", "business-evidence.v3"])(
    "%s is polarity-free",
    (version) => {
      expect(readSurfaceCitation("live.surface.pricing", version)?.polarity).toBe("unknown");
    },
  );
});

describe("a v4 citation carries its own polarity", () => {
  it("reads a present surface as present", () => {
    expect(readSurfaceCitation("repo.surface.payments", V4)).toEqual({
      namespace: "repo",
      surfaceId: "payments",
      polarity: "present",
    });
  });

  it("reads an absent surface as absent", () => {
    expect(readSurfaceCitation("repo.surface_absent.payments", V4)).toEqual({
      namespace: "repo",
      surfaceId: "payments",
      polarity: "absent",
    });
  });

  it("mints both directions", () => {
    expect(surfaceEvidenceId("repo", "payments", true)).toBe("repo.surface.payments");
    expect(surfaceEvidenceId("repo", "payments", false)).toBe("repo.surface_absent.payments");
    expect(surfaceEvidenceId("live", "pricing", false)).toBe("live.surface_absent.pricing");
  });

  it("round-trips what it mints", () => {
    for (const detected of [true, false]) {
      const id = surfaceEvidenceId("live", "checkout_billing", detected);
      expect(readSurfaceCitation(id, V4)).toEqual({
        namespace: "live",
        surfaceId: "checkout_billing",
        polarity: detected ? "present" : "absent",
      });
    }
  });
});

/**
 * The reach the suffix design would have had, pinned as an absence.
 *
 * `execution-contract/live-premise.ts` selects ids to revalidate with
 * `startsWith("live.") && endsWith("_missing")`. Sprint 0072 narrowed that to
 * defect ids deliberately: a positive surface's absence is ambiguous, and
 * refusing a paid run on that guess is worse than the failure being prevented.
 *
 * Had absence been spelled `live.surface.pricing_missing`, that gate would have
 * silently re-widened to exactly the ids 0072 excluded — and nothing would have
 * failed. Paid runs would just have started being refused on ambiguous
 * evidence. This asserts the namespace design keeps it out of reach.
 */
describe("the absent namespace stays outside the live-premise defect vocabulary", () => {
  it.each(["repo", "live"] as const)("%s absence does not end in _missing", (namespace) => {
    const id = surfaceEvidenceId(namespace, "pricing", false);
    expect(id.endsWith("_missing")).toBe(false);
    expect(id.endsWith("_not_observed")).toBe(false);
    expect(id.endsWith("_not_found")).toBe(false);
    expect(id.endsWith(".not_found")).toBe(false);
  });

  /**
   * And it must not be reachable by a `repo.surface.` / `live.surface.` prefix
   * match either. Every existing matcher — `validation/depth.ts`'s sensitive
   * list, `economy/execution-class.ts`, `execution-context/surface.ts` — keeps
   * seeing only present surfaces, so absence has to be added to each one
   * deliberately rather than arriving by accident of string matching.
   */
  it.each(["repo", "live"] as const)("%s absence is not a prefix match on presence", (namespace) => {
    const absent = surfaceEvidenceId(namespace, "payments", false);
    expect(absent.startsWith(`${namespace}.surface.`)).toBe(false);
  });
});

describe("anything that is not a surface citation", () => {
  it.each(["live.seo.canonical_missing", "auth.surface.billing", "business.primary_goal", "mystery"])(
    "%s reads as null rather than as an error",
    (id) => {
      expect(readSurfaceCitation(id, V4)).toBeNull();
    },
  );

  it("does not mistake auth.surface for a repo or live surface", () => {
    // `auth.surface.*` has always carried its own `_not_observed` polarity and
    // is not part of this scheme.
    expect(readSurfaceCitation("auth.surface.billing_not_observed", V4)).toBeNull();
  });
});
