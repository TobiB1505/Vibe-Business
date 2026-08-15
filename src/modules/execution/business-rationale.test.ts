import { describe, expect, it } from "vitest";
import { findCausalClaims } from "@/modules/business-measurement/causality";
import { businessRationaleFor, type BusinessRationale } from "./business-rationale";
import { EXECUTION_CAPABILITIES } from "./schema";

/**
 * The rationale must stay the weakest claim in the product (§7, §10, §13).
 *
 * A rationale is written *before* anything happens, from what a capability
 * deterministically does. It is the least evidenced thing Vibe says, so it is
 * held to the same causal-language standard as a measured result — which is the
 * only way "why this change should matter" never drifts into sounding like
 * "this change did matter".
 */

const SEO = businessRationaleFor("nextjs_seo_foundations_v2")!;

function everySentence(rationale: BusinessRationale): string {
  return [
    rationale.problem,
    rationale.changeSummary,
    rationale.whyItMatters,
    rationale.expectedOutcome,
    rationale.limitations,
  ].join(" ");
}

describe("the SEO foundations rationale", () => {
  it("describes what the capability actually emits", () => {
    // Checkable against the generator: it adds robots.ts and sitemap.ts, and
    // the sitemap lists the homepage while excluding authentication routes.
    expect(SEO.changeSummary).toContain("sitemap");
    expect(SEO.expectedOutcome).toContain("homepage");
    expect(SEO.expectedOutcome).toContain("authentication routes");
  });

  it("always states what it does not establish", () => {
    // The load-bearing sentence. Without it the paragraph reads as a promise
    // about traffic — exactly the claim the measurement architecture exists to
    // avoid making for free.
    expect(SEO.limitations).toMatch(/does not guarantee/i);
    expect(SEO.limitations).toMatch(/rankings|traffic|revenue/i);
  });

  it("never claims causality", () => {
    // The same checker the measurement layer runs over measured copy. A
    // rationale has strictly less evidence behind it than a measurement, so it
    // cannot be allowed stronger verbs.
    expect(findCausalClaims(everySentence(SEO))).toEqual([]);
  });

  it("promises nothing measurable", () => {
    const copy = everySentence(SEO);

    // No percentages, no counts, no "will increase". A rationale that carried a
    // number would be indistinguishable from a result.
    expect(copy).not.toMatch(/\d+\s*%/);
    expect(copy).not.toMatch(/\bwill (increase|improve|grow|boost)\b/i);
    expect(copy).not.toMatch(/\bguarantees\b/i);
  });

  it("speaks in the user's terms rather than in file names", () => {
    // "Vibe added robots.ts and sitemap.ts" is a changelog. The rationale is
    // for someone deciding whether the change was worth making.
    expect(SEO.changeSummary).not.toContain(".ts");
    expect(SEO.whyItMatters).not.toContain(".ts");
  });
});

describe("coverage and absence", () => {
  it("gives both SEO capability versions the same rationale", () => {
    // v2 refined which routes the sitemap lists, not why a sitemap is worth
    // having. The intent did not change, so neither does the rationale.
    expect(businessRationaleFor("nextjs_seo_foundations_v1")).toEqual(
      businessRationaleFor("nextjs_seo_foundations_v2"),
    );
  });

  it("returns null for a capability with no written rationale", () => {
    // Null is a real answer: the UI renders no section rather than a generic
    // sentence that would be true of any change and informative about none.
    expect(businessRationaleFor("some_future_capability")).toBeNull();
    expect(businessRationaleFor("")).toBeNull();
  });

  it("holds every rationale that exists to the same standard", () => {
    // Guards the next one somebody adds, not just the one that exists today.
    for (const capability of EXECUTION_CAPABILITIES) {
      const rationale = businessRationaleFor(capability);
      if (!rationale) continue;

      expect(findCausalClaims(everySentence(rationale))).toEqual([]);
      expect(rationale.limitations.trim().length).toBeGreaterThan(0);
      expect(everySentence(rationale)).not.toMatch(/\d+\s*%/);
    }
  });
});

describe("rationale is independent of measurement", () => {
  it("needs no metric source, no measurement and no AI to resolve", () => {
    // The whole point of the cleanup: a completed change explains itself
    // without an analytics connection existing anywhere.
    expect(businessRationaleFor("nextjs_seo_foundations_v2")).not.toBeNull();
  });
});
