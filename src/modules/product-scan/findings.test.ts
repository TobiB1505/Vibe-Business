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
});
