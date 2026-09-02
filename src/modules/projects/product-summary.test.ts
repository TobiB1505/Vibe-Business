import { describe, expect, it } from "vitest";
import type { BrandAsset, BrandAssetRole } from "@/modules/product-understanding/schema";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import { buildProductSummary } from "./product-summary";

function asset(role: BrandAssetRole, displayUrl: string | null): BrandAsset {
  return {
    role,
    reference: `/${role}.svg`,
    displayUrl,
    confidence: "likely",
    sources: ["live_product"],
    evidence: [],
  };
}

function withAssets(...assets: BrandAsset[]) {
  const base = fakeProductProfile();
  return fakeProductProfile({ brand: { ...base.brand, assets } });
}

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

  describe("the name the product goes by", () => {
    it("is read from the profile rather than left to the project label", () => {
      expect(
        buildProductSummary({ profile: fakeProductProfile(), primaryGoal: null }).productName,
      ).toBe("Acme");
    });

    it("lets a founder's correction win, as every other field does", () => {
      const summary = buildProductSummary({
        profile: fakeProductProfile(),
        corrections: { name: "Acme Invoicing" },
        primaryGoal: null,
      });

      expect(summary.productName).toBe("Acme Invoicing");
    });
  });

  describe("the logo", () => {
    it("takes the primary logo when it can be displayed", () => {
      const summary = buildProductSummary({
        profile: withAssets(asset("logo", "https://acme.test/logo.svg")),
        primaryGoal: null,
      });

      expect(summary.logoUrl).toBe("https://acme.test/logo.svg");
    });

    it("falls through to the alternate when the primary cannot be shown", () => {
      // A located logo with no `displayUrl` is one Vibe found a reference for
      // and cannot render. Preferring it would put a broken image on the card.
      const summary = buildProductSummary({
        profile: withAssets(
          asset("logo", null),
          asset("logo_alternate", "https://acme.test/mark.svg"),
        ),
        primaryGoal: null,
      });

      expect(summary.logoUrl).toBe("https://acme.test/mark.svg");
    });

    it("prefers the primary over the alternate regardless of stored order", () => {
      const summary = buildProductSummary({
        profile: withAssets(
          asset("logo_alternate", "https://acme.test/mark.svg"),
          asset("logo", "https://acme.test/logo.svg"),
        ),
        primaryGoal: null,
      });

      expect(summary.logoUrl).toBe("https://acme.test/logo.svg");
    });

    it("never substitutes an icon for a logo", () => {
      // A favicon is a different class of asset at a size where the difference
      // shows. Absent is the honest answer; the card has its own fallback.
      const summary = buildProductSummary({
        profile: withAssets(
          asset("favicon", "https://acme.test/favicon.ico"),
          asset("app_icon", "https://acme.test/icon.png"),
          asset("open_graph_image", "https://acme.test/og.png"),
        ),
        primaryGoal: null,
      });

      expect(summary.logoUrl).toBeNull();
    });
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
      productName: null,
      logoUrl: null,
      shortDescription: null,
      mainPurpose: null,
      primaryAudience: null,
      founderGoal: null,
      category: null,
    });
  });
});
