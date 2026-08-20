import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_RATE_CARDS, resolveRateCard } from "@/modules/credits/rating";
import { runEconomySimulations } from "./intelligence/growth-simulation";
import { HISTORICAL_LEARNING_RECORDS, learningSummary } from "./intelligence/learning-dataset";
import { resolveEconomyModel } from "./intelligence/model-version";
import { detectCohortBias } from "./intelligence/prediction-bias";
import { reconcileExecutionEconomics } from "./intelligence/reconciliation";

/**
 * The sprint's own boundary, executable rather than asserted (Sprint 0054).
 *
 * "Dieser Sprint baut KEIN produktives Credit-System. Nicht implementieren:
 * User Credit Balance, Stripe Billing, Wallet, Top Ups, Subscription Limits,
 * echte Credit-Abrechnung, aktive Rate Card." — this file is that sentence in
 * a form that fails a build.
 */

const INTELLIGENCE_DIR = join(process.cwd(), "src/modules/economy/intelligence");

type Source = { path: string; code: string };

/** Non-test sources, with comments stripped — prose may discuss what code may not do. */
function intelligenceSources(): Source[] {
  return readdirSync(INTELLIGENCE_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({
      path: file,
      code: readFileSync(join(INTELLIGENCE_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, ""),
    }));
}

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

  it("running every simulation this sprint added leaves it empty", () => {
    const model = resolveEconomyModel(new Date("2026-08-21T00:00:00Z"));

    runEconomySimulations();
    learningSummary();
    detectCohortBias(HISTORICAL_LEARNING_RECORDS, model.adjustmentPolicy);
    reconcileExecutionEconomics({
      comparisons: HISTORICAL_LEARNING_RECORDS.map((record) => record.comparison),
      policy: model.adjustmentPolicy,
      modelVersion: "economy-model.v1",
    });

    expect(CREDIT_RATE_CARDS).toEqual([]);
  });

  it("declares no rate card of its own anywhere in the new layer", () => {
    for (const { path, code } of intelligenceSources()) {
      expect(code, path).not.toMatch(/CREDIT_RATE_CARDS\s*[:=]/);
      expect(code, path).not.toContain("credits/rating");
    }
  });
});

describe("the Economy Intelligence layer bills nobody", () => {
  it("imports nothing from billing, credits, the agent or the operation runtime", () => {
    for (const { path, code } of intelligenceSources()) {
      expect(code, path).not.toMatch(/from "@\/modules\/(credits|billing|coding-agent|operations)\//);
    }
  });

  it("holds no database client and writes no row", () => {
    for (const { path, code } of intelligenceSources()) {
      expect(code, path).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(code, path).not.toContain("SupabaseClient");
      expect(code, path).not.toContain("createClient");
    }
  });

  it("mentions no wallet, top-up, subscription limit or Stripe object", () => {
    for (const { path, code } of intelligenceSources()) {
      for (const forbidden of ["stripe", "wallet", "topUp", "top_up", "checkout", "reservation", "settlement"]) {
        expect(code.toLowerCase(), `${path} mentions ${forbidden}`).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("stays unwired: nothing outside the economy module imports it", () => {
    // The layer is deliberately an island this sprint. Wiring it into
    // coding-agent/service.ts needs persistence, and that is the Credit
    // Settlement sprint's decision to make, not this one's.
    const offenders = walk(join(process.cwd(), "src")).filter(
      (file) =>
        !file.includes(`${join("modules", "economy")}`) &&
        readFileSync(file, "utf8").includes('from "@/modules/economy/'),
    );

    expect(offenders).toEqual([]);
  });
});

describe("no number in this layer is presented as more certain than it is", () => {
  /**
   * A cost without its confidence is a promise. Both customer-facing shapes
   * declare confidence as a required field, so the promise does not typecheck.
   */
  it("makes confidence non-optional on the estimate and the quote", () => {
    const estimate = readFileSync(join(INTELLIGENCE_DIR, "pre-execution-estimate.ts"), "utf8");
    const quote = readFileSync(join(INTELLIGENCE_DIR, "quote-simulation.ts"), "utf8");

    expect(estimate).toMatch(/\n  confidence: EstimateConfidence;/);
    expect(quote).toMatch(/\n  confidence: EstimateConfidence;/);
    expect(estimate).not.toMatch(/confidence\?:/);
    expect(quote).not.toMatch(/confidence\?:/);
  });

  /**
   * The buffer exists because Vibe is unsure. Charging a customer for Vibe's
   * uncertainty is a separate decision nobody has made.
   */
  it("keeps the protected cost out of the customer-facing quote", () => {
    const quote = intelligenceSources().find((source) => source.path === "quote-simulation.ts");
    if (!quote) throw new Error("quote-simulation.ts is missing");

    expect(quote.code).not.toContain("safety-margin");
    expect(quote.code).not.toContain("protectedCost");
    expect(quote.code).not.toContain("SafetyMargin");
  });

  it("marks a simulated quote as activated: false, as a literal", () => {
    const quote = readFileSync(join(INTELLIGENCE_DIR, "quote-simulation.ts"), "utf8");

    expect(quote).toMatch(/activated: false;/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}
