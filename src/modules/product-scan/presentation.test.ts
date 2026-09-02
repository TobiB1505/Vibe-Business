import { describe, expect, it } from "vitest";
import { fakeProductProfile } from "@/modules/product-understanding/test-support";
import { buildProductScanPresentation } from "./presentation";

/**
 * What the scan screen says about how a product makes money.
 *
 * The three business-model labels were chosen by asking whether a signal was
 * *present in the list* — and `deriveBusinessSignals` emits a signal for every
 * dimension it assessed, whatever the answer. So the `null` branch was
 * unreachable: every product ever scanned reported at least "Pricing observed",
 * including one whose pricing signal said Vibe had found none.
 *
 * Presence now means the dimension was assessed; `confidence` says how it came
 * out, and only a found signal names a business model.
 */
describe("the business model the scan reports", () => {
  const withSignals = (
    signals: { id: "pricing_surface" | "payment_capability" | "subscription_capability"; confidence: "confirmed" | "not_found" }[],
  ) =>
    buildProductScanPresentation(
      fakeProductProfile({
        businessSignals: signals.map((signal) => ({
          id: signal.id,
          statement: "…",
          confidence: signal.confidence,
          sources: signal.confidence === "not_found" ? [] : (["live_product"] as const),
          evidence: [],
        })),
      }),
      false,
      "Fallback",
    );

  it("says nothing when every money signal came back not found", () => {
    const scan = withSignals([
      { id: "pricing_surface", confidence: "not_found" },
      { id: "payment_capability", confidence: "not_found" },
      { id: "subscription_capability", confidence: "not_found" },
    ]);

    expect(scan.businessModel).toBeNull();
  });

  it("names the strongest signal that was actually found", () => {
    expect(
      withSignals([
        { id: "pricing_surface", confidence: "confirmed" },
        { id: "payment_capability", confidence: "not_found" },
      ]).businessModel,
    ).toBe("Pricing observed");

    // Subscription outranks payment, which outranks pricing.
    expect(
      withSignals([
        { id: "pricing_surface", confidence: "confirmed" },
        { id: "subscription_capability", confidence: "confirmed" },
      ]).businessModel,
    ).toBe("Subscription signals");
  });

  it("says nothing when the dimension was never assessed", () => {
    expect(withSignals([]).businessModel).toBeNull();
  });
});
