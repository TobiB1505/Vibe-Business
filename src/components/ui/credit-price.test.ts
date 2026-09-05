import { describe, expect, it } from "vitest";
import { INCLUDED_WORD, priceDisplayFor } from "./credit-price";

/**
 * What a control says about what it costs (ADR 0094).
 *
 * Three answers, and they must stay three. A number, when there is one. The
 * word, when the policy says the operation costs nothing. Nothing at all, when
 * the policy has no price — because that is a refusal, and a word there would
 * invent an answer the policy did not give.
 *
 * The zero is what §56 was defending against and it is still out of bounds:
 * no state of this function produces one.
 */
describe("the price slot", () => {
  it("names a free operation instead of pricing it at nothing", () => {
    expect(priceDisplayFor("product_understanding")).toEqual({ kind: "included" });
    expect(INCLUDED_WORD).toBe("Included");
  });

  it("gives a priced operation its number", () => {
    const display = priceDisplayFor("deep_scan");
    expect(display.kind).toBe("credits");
    if (display.kind !== "credits") throw new Error("deep_scan is priced under launch-v1");
    expect(display.credits).toBeGreaterThan(0);
  });

  it("stays silent for a class-priced operation with no class in hand", () => {
    // "150-350 Credits" is not a price, and the cheapest of three is a lie.
    expect(priceDisplayFor("agent_execution")).toEqual({ kind: "silent" });
    expect(priceDisplayFor("agent_execution", "standard").kind).toBe("credits");
  });

  it("never renders a zero, in any state", () => {
    for (const operation of [
      "business_audit",
      "opportunity_generation",
      "action_plan",
      "product_understanding",
      "deep_scan",
      "agent_execution",
    ] as const) {
      const display = priceDisplayFor(operation);
      if (display.kind === "credits") expect(display.credits).toBeGreaterThan(0);
    }
  });
});
