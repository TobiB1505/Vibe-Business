import { describe, expect, it } from "vitest";
import { liveProductFindingEvents, repositoryFindingEvents } from "./findings";

describe("Product Scan findings", () => {
  it("keeps repository findings bounded and describes integrations as signals", () => {
    const events = repositoryFindingEvents({
      frameworks: [{ id: "nextjs", name: "Next.js", confidence: "high", evidence: [] }],
      integrationSignals: [
        { id: "stripe", name: "Stripe", category: "payments", confidence: "high", evidence: [] },
      ],
      businessSurfaces: [],
      brand: { assets: [], colors: [], typefaces: [], tokenSources: [] },
    } as never, "00000000-0000-0000-0000-000000000001");

    expect(events).toHaveLength(2);
    expect(events[1].title).toBe("payments signal found");
    expect(events[1].detail).toContain("not a claim");
  });

  it("does not infer a business model from a reached pricing page", () => {
    const events = liveProductFindingEvents({
      productSurfaces: [],
      pricing: { pricingPageReached: true },
      conversionSignals: { primaryCta: null },
    } as never, "00000000-0000-0000-0000-000000000002");

    expect(events[0].title).toBe("Public pricing reached");
    expect(events[0].detail).toContain("does not infer a business model");
  });

  it("emits logo, typography and color as individual grounded discoveries", () => {
    const events = repositoryFindingEvents({
      frameworks: [],
      integrationSignals: [],
      businessSurfaces: [],
      brand: {
        assets: [{ role: "logo", path: "public/logo.svg", servedPath: "/logo.svg", confidence: "high", evidence: [] }],
        colors: [{ role: "primary", value: "#00e5a0", token: "--brand", confidence: "high", evidence: [] }],
        typefaces: [{ role: "display", family: "Space Grotesk", confidence: "high", evidence: [] }],
        tokenSources: [],
      },
    } as never, "00000000-0000-0000-0000-000000000003");

    expect(events.map((event) => event.findingKey)).toEqual([
      "brand.asset.logo",
      "brand.typeface.display",
      "brand.color.primary",
    ]);
    expect(events[1].title).toBe("Space Grotesk typography detected");
    expect(events[2].detail).toContain("#00E5A0");
  });
});
