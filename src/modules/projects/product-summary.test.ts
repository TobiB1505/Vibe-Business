import { describe, expect, it } from "vitest";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import { buildProductSummary } from "./product-summary";

describe("product-list summaries", () => {
  it("uses the canonical profile and founder goal", () => {
    const summary = buildProductSummary({
      profile: fakeProductProfile(),
      primaryGoal: "monetize",
    });

    expect(summary.shortDescription).toBeTruthy();
    expect(summary.mainPurpose).toBeTruthy();
    expect(summary.primaryAudience).toBeTruthy();
    expect(summary.founderGoal).toBe("Start monetizing");
  });

  it("puts a founder correction above the derived profile", () => {
    const summary = buildProductSummary({
      profile: fakeProductProfile(),
      corrections: { primaryAudience: "Independent product studios" },
      primaryGoal: null,
    });

    expect(summary.primaryAudience).toBe("Independent product studios");
  });

  it("represents missing context as absence rather than invented copy", () => {
    expect(buildProductSummary({ profile: null, primaryGoal: null })).toEqual({
      shortDescription: null,
      mainPurpose: null,
      primaryAudience: null,
      founderGoal: null,
      category: null,
    });
  });
});
