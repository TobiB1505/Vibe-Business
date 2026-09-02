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

  /**
   * Who outside the economy module may read it at all.
   *
   * Sprint 0054 asserted "nobody", because the layer was deliberately an island
   * until persistence existed. Sprint 0055 changed that on purpose and narrowly:
   * the internal calibration harness has to know a fixture's pricing class
   * *before* the run, and the only honest way to know it is to ask the same
   * classifier the run itself will use. A second copy of the policy would make
   * the recorded prediction and the executed run answer different questions —
   * exactly the drift this suite exists to prevent.
   *
   * So this is an allowlist naming its readers, not a deleted guard. What it
   * still forbids is the thing that matters: the estimator being wired into the
   * production execution path, which needs persistence and is the Credit
   * Settlement sprint's decision to make.
   *
   * ADR 0072 named the second reader, `coding-agent/run-forecast.ts`, and it is
   * a different kind of caller from the first — it renders to a founder. What
   * makes it admissible is not an argument but a shape: it is read-only, it
   * runs on a page render and never on the start action, and **its return type
   * contains no amount**. The estimator's cost, upper bound, multipliers and
   * provider rates all stop inside it, and the test below reads its source to
   * keep that true rather than trusting this paragraph.
   */
  const PERMITTED_ECONOMY_READERS = [
    join("modules", "coding-agent", "dogfood"),
    join("modules", "coding-agent", "run-forecast.ts"),
  ];

  /**
   * What the rest of the application may import from here, by module.
   *
   * `launch-v1` widened this a second time, and again narrowly. Activating a
   * per-class Agent price means the money paths have to know a step's execution
   * pricing class — and the only honest way to know it is to ask the classifier
   * the analysis itself uses. A second copy would let the price a customer was
   * shown and the class Vibe reasons about drift apart, which is the failure
   * this whole suite exists to prevent.
   *
   * The three modules below are the ones safe to be read this way, and they
   * share a property: none of them decides an amount.
   *
   * ```
   * execution-class.ts        classifies a step. Contains no money at all.
   * infrastructure-rates.ts   what Vibe pays a provider. Not what it charges.
   * sandbox-cost.ts           dimensions to nanodollars. Arithmetic, not policy.
   * ```
   *
   * Everything else stays unreadable from outside, and the test below keeps the
   * one that matters unreadable by anybody: the predictive estimator, which
   * produces a number that would eventually authorize something.
   */
  const PERMITTED_ECONOMY_IMPORTS = [
    "@/modules/economy/execution-class",
    "@/modules/economy/infrastructure-rates",
    "@/modules/economy/sandbox-cost",
    /*
     * ADR 0073. Composes the two above and adds nothing of its own: the
     * founder-attested rate card, and the arithmetic that turns CPU
     * milliseconds and wall time into nanodollars.
     *
     * It is on this list rather than inlined at each writer because there are
     * three of them — validation, preview and the agent — and "what did this
     * sandbox cost" answered three times is "what did this sandbox cost"
     * answered differently the first time somebody edits one. It decides no
     * amount that was not already decidable by importing its two parts
     * directly, which is the property this list is drawn on.
     */
    "@/modules/economy/sandbox-usage-estimate",
  ];

  it("is read only by the economy module, the calibration harness and the permitted primitives", () => {
    const offenders = walk(join(process.cwd(), "src")).filter((file) => {
      if (file.includes(join("modules", "economy"))) return false;
      if (PERMITTED_ECONOMY_READERS.some((permitted) => file.includes(permitted))) return false;

      const imports = [
        ...readFileSync(file, "utf8").matchAll(/from "(@\/modules\/economy\/[^"]+)"/g),
      ].map((match) => match[1]!);

      return imports.some((module) => !PERMITTED_ECONOMY_IMPORTS.includes(module));
    });

    expect(offenders).toEqual([]);
  });

  /**
   * The narrower rule the allowlist above must not be allowed to erode: a
   * caller may ask what class a change is, and may not ask what it will cost.
   * A quote reaching the execution path is a quote that will eventually
   * authorize something.
   *
   * `run-forecast.ts` is the one file permitted to read the estimator, and the
   * two tests after this one are the price of that permission. `quote-simulation`
   * and `safety-margin` stay unreadable by anybody: the first produces a Credit
   * figure from a hypothetical rate card, and the second buffers a number for
   * Vibe's own planning — "charging a customer for Vibe's uncertainty is a
   * separate decision that nobody has made", in that file's own words.
   */
  const ESTIMATOR_BOUNDARY = join("modules", "coding-agent", "run-forecast.ts");

  it("never lets the predictive estimator reach the execution path", () => {
    const forbidden = [
      "economy/intelligence/pre-execution-estimate",
      "economy/intelligence/quote-simulation",
      "economy/intelligence/safety-margin",
    ];

    const offenders = walk(join(process.cwd(), "src"))
      .filter((file) => !file.includes(join("modules", "economy")))
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => !file.endsWith(ESTIMATOR_BOUNDARY))
      .filter((file) => {
        const code = readFileSync(file, "utf8");
        return forbidden.some((module) => code.includes(module));
      });

    expect(offenders).toEqual([]);
  });

  /**
   * The permission's actual condition (ADR 0072).
   *
   * The boundary file may read the estimator because nothing monetary survives
   * it. That is a property of its source, so it is checked by reading its
   * source — the same instrument the rest of this file uses, and the reason the
   * allowlist above is not simply a hole.
   *
   * Comments are stripped first: the file's own docblock explains at length why
   * it produces no cost, and matching that prose would fail it for saying so.
   */
  it("lets no amount out of the one file permitted to read the estimator", () => {
    const code = readFileSync(join(process.cwd(), "src", ESTIMATOR_BOUNDARY), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const forbidden of [
      "nanoUsd",
      "estimatedCost",
      "Credit",
      "usd",
      "price",
      "quote",
      "safety-margin",
      "safetyMargin",
    ]) {
      expect(code.toLowerCase(), `run-forecast.ts mentions ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  /**
   * And that the shape it exports is the one that was reviewed.
   *
   * A field list is the thing an "improvement" quietly grows. Pinning it means
   * adding one is a deliberate edit to this test with a reason beside it, which
   * is exactly the friction a boundary is for.
   */
  it("exports the four non-monetary fields the boundary was granted for", () => {
    const code = readFileSync(join(process.cwd(), "src", ESTIMATOR_BOUNDARY), "utf8");
    const shape = code.slice(code.indexOf("export type RunForecast = {"));
    const body = shape.slice(0, shape.indexOf("\n};"));

    const fields = [...body.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
    expect(fields).toEqual(["comparableRuns", "confidence", "repositoryMeasured", "drivers"]);
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
