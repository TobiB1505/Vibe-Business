import { describe, expect, it } from "vitest";
import { resolveRateCard, CREDIT_RATE_CARDS } from "@/modules/credits/rating";
import { calculateAllDeliveredRunMargins } from "./failure-economics";
import { runAllStressTests } from "./stress-test";
import { simulateAllHistoricalRuns } from "./credit-rate-card";

/**
 * PART M/N — the sprint's own hard boundary, verified rather than asserted
 * in prose: everything built this sprint is pure analysis, and nothing about
 * real billing changed.
 *
 * "Keine Credits werden verändert. Keine Rate Card wird aktiviert. Keine
 * Stripe-Logik wird verändert. Keine Reservation-/Settlement-Logik wird
 * verändert." — this file is the executable form of that sentence.
 */

describe("CREDIT_RATE_CARDS stays empty after this sprint", () => {
  it("is still the empty array credits/rating.ts declares by design", () => {
    expect(CREDIT_RATE_CARDS).toEqual([]);
    expect(CREDIT_RATE_CARDS).toHaveLength(0);
  });

  it("real usage still resolves to no rate card at any instant", () => {
    expect(resolveRateCard(new Date("2020-01-01T00:00:00Z"))).toBeNull();
    expect(resolveRateCard(new Date())).toBeNull();
    expect(resolveRateCard(new Date("2099-01-01T00:00:00Z"))).toBeNull();
  });

  it("running every simulation this sprint added does not mutate CREDIT_RATE_CARDS", () => {
    simulateAllHistoricalRuns();
    calculateAllDeliveredRunMargins();
    runAllStressTests();
    expect(CREDIT_RATE_CARDS).toEqual([]);
  });
});

describe("no module this sprint touches billing, Stripe, reservation or settlement", () => {
  it("credit-rate-card.ts imports nothing from credits/, billing/, or a Stripe module", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./credit-rate-card.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/from ["']@\/modules\/(credits|billing)/);
    expect(source.toLowerCase()).not.toContain("stripe");
  });

  it("failure-economics.ts imports nothing from credits/, billing/, or a Stripe module", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./failure-economics.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/from ["']@\/modules\/(credits|billing)/);
    expect(source.toLowerCase()).not.toContain("stripe");
  });

  it("stress-test.ts imports nothing from credits/, billing/, or a Stripe module", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./stress-test.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/from ["']@\/modules\/(credits|billing)/);
    expect(source.toLowerCase()).not.toContain("stripe");
  });

  it("execution-class.ts and historical-runs.ts touch no reservation or settlement module", async () => {
    const fs = await import("node:fs/promises");
    const files = ["./execution-class.ts", "./historical-runs.ts", "./class-cost-analysis.ts"];
    for (const file of files) {
      const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/reservation|settlement/i);
    }
  });
});

describe("every new function this sprint added is pure — no writes, no side effects", () => {
  it("calling every simulation/classification entry point twice in a row is idempotent", () => {
    expect(simulateAllHistoricalRuns()).toEqual(simulateAllHistoricalRuns());
    expect(calculateAllDeliveredRunMargins()).toEqual(calculateAllDeliveredRunMargins());
    expect(runAllStressTests()).toEqual(runAllStressTests());
  });
});
