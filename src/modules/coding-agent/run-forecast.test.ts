import { describe, expect, it } from "vitest";
import type { ActionPlanStep } from "@/modules/action-plans/schema";
import { REPOSITORY_INTELLIGENCE_SCHEMA_VERSION } from "@/modules/repository-intelligence/schema";
import type { RepositoryIntelligenceSnapshot } from "@/modules/repository-intelligence/schema";
import { forecastRepositoryContext, forecastRun } from "./run-forecast";
import { forecastDriverNotes, forecastEvidenceNote } from "./view";

/**
 * What stands behind the ceiling on the Run button (ADR 0072).
 *
 * ## What these tests are for, and what they are not
 *
 * They are not about the estimator's accuracy. That is measured by
 * `learning-dataset.ts`'s leave-one-out backtest — 24.3% mean absolute error
 * across 7 comparable runs, worst case +51%, with the repository term validated
 * against nothing — and it is the reason this boundary consumes the estimate's
 * *structure* and never its magnitude.
 *
 * What they are for is the boundary itself: that nothing monetary crosses it,
 * that a founder is told how much evidence is under the number they are about
 * to spend against, and that the two ways of having no evidence read
 * differently.
 */

const AT = new Date("2026-09-02T12:00:00.000Z");

/** A step of the shape the historical runs actually record. */
const SEO_STEP: Pick<ActionPlanStep, "changeKind" | "evidenceIds"> = {
  changeKind: "product_change",
  evidenceIds: ["live.seo.robots_meta_missing"],
};

function snapshot(overrides: {
  treeEntries?: number | null;
  routes?: number;
} = {}): RepositoryIntelligenceSnapshot {
  return {
    schemaVersion: REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
    source: {
      owner: "acme",
      repo: "product",
      ref: "main",
      commitSha: "c".repeat(40),
      analyzedAt: AT.toISOString(),
    },
    routes: {
      framework: "nextjs",
      strategy: "app_router",
      mode: "full",
      truncated: false,
      routes: Array.from({ length: overrides.routes ?? 40 }, (_, index) => ({
        path: `/p${index}`,
        kind: "page",
        dynamic: false,
        sourcePath: `src/app/p${index}/page.tsx`,
      })),
    },
    businessSurfaces: [],
    metrics: {
      treeEntriesConsidered: overrides.treeEntries === undefined ? 2_400 : overrides.treeEntries,
      filesFetched: 120,
      bytesFetched: 900_000,
      filesInspected: 120,
      bytesInspected: 900_000,
      durationMs: 0,
      apiRequests: 0,
    },
  } as unknown as RepositoryIntelligenceSnapshot;
}

describe("the forecast carries no money out of the estimator", () => {
  it("returns exactly the four reviewed fields, none of them an amount", () => {
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    expect(Object.keys(forecast).sort()).toEqual([
      "comparableRuns",
      "confidence",
      "drivers",
      "repositoryMeasured",
    ]);

    // The estimator's own `detail` strings carry its multipliers. None of them
    // may cross, which is why a driver is two enums and nothing else.
    for (const driver of forecast.drivers) {
      expect(Object.keys(driver).sort()).toEqual(["driver", "effect"]);
    }
  });

  it("says nothing at all for a step that changes no code", () => {
    // No execution to forecast. An empty forecast rendered beside a button is
    // worse than no forecast.
    expect(
      forecastRun({
        at: AT,
        step: { changeKind: "decision", evidenceIds: [] },
        riskClass: "low",
        snapshot: snapshot(),
        observations: [],
      }),
    ).toBeNull();
  });
});

describe("how much evidence is under the number", () => {
  it("counts the comparable runs Vibe has actually completed", () => {
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    // The historical dataset holds real runs of exactly this shape, so this is
    // a measurement rather than a policy figure — and the copy says which.
    expect(forecast.comparableRuns).toBeGreaterThan(0);
    expect(forecastEvidenceNote(forecast)).toContain("comparable run");
    expect(forecastEvidenceNote(forecast)).not.toContain("policy ceiling");
  });

  it("says the ceiling is policy when nothing comparable has been run", () => {
    // A change kind and evidence set the history has never seen. The honest
    // sentence is that the number rests on policy, and rule 78 is why it must
    // be said rather than left to look like a measurement.
    const forecast = forecastRun({
      at: AT,
      step: { changeKind: "product_change", evidenceIds: ["repo.surface.payments"] },
      riskClass: "low",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    expect(forecast.comparableRuns).toBe(0);
    expect(forecastEvidenceNote(forecast)).toContain("policy ceiling");
  });
});

describe("the repository the run will actually work in", () => {
  it("measures it, which the estimator's backtest never could", () => {
    // `repositoryContextAvailableFor` is 0 across every backtested run, and the
    // brief's own scale is not computed until a run starts. The pre-run screen
    // is the first caller that can hand the estimator a tree.
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    expect(forecast.repositoryMeasured).toBe(true);
  });

  it("reports an unmeasured repository as unmeasured, never as small", () => {
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: null,
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    expect(forecast.repositoryMeasured).toBe(false);
    expect(forecastDriverNotes(forecast).join(" ")).toContain("not measured your repository");
  });

  it("excludes the candidate count rather than reading zero as no candidates", () => {
    // The Context Compiler has not run, so `candidatesAvailable` is 0 — and
    // `ratioTerm` drops a non-positive axis, so it is an absent measurement
    // rather than a repository that offered nothing.
    const context = forecastRepositoryContext(snapshot());
    expect(context?.candidatesAvailable).toBe(0);
    expect(context?.candidatesSent).toBeNull();

    // A large tree still measures, on the axes that exist.
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    expect(forecast?.repositoryMeasured).toBe(true);
  });

  it("projects the snapshot exactly as the compiler's own scale does", () => {
    // Two derivations of "how big is this repository" is how the estimate a
    // founder was shown stops describing the run they started.
    const source = snapshot();
    expect(forecastRepositoryContext(source)).toEqual({
      treeEntries: source.metrics.treeEntriesConsidered,
      filesAnalyzed: source.metrics.filesFetched,
      bytesAnalyzed: source.metrics.bytesFetched,
      routesDetected: source.routes.routes.length,
      surfacesDetected: source.businessSurfaces.length,
      candidatesAvailable: 0,
      candidatesSent: null,
    });
  });
});

describe("what a founder is told, above a button that spends money", () => {
  it("never renders the estimator's own working notes", () => {
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    const notes = [forecastEvidenceNote(forecast), ...forecastDriverNotes(forecast)].join(" ");

    // "complexity 1.34x against the reference repository" is a calibration
    // report's sentence, not a founder's.
    expect(notes).not.toMatch(/\d+\.\d+x/);
    expect(notes).not.toContain("reference repository");
    expect(notes).not.toContain("$");
  });

  it("says at most two things, deterministically", () => {
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    expect(forecastDriverNotes(forecast).length).toBeLessThanOrEqual(2);
    expect(forecastDriverNotes(forecast)).toEqual(forecastDriverNotes(forecast));
  });

  it("stays silent about a validation depth that is simply not resolved yet", () => {
    // Depth comes from a Prepared Change, which does not exist before a run.
    // "Vibe does not know yet" beside a Run button reads as a warning, and it
    // is not one — so that driver has no copy for `unknown` and drops out.
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [],
    });
    if (!forecast) throw new Error("expected a forecast");

    expect(forecast.drivers.some((driver) => driver.driver === "validation_depth")).toBe(true);
    expect(forecastDriverNotes(forecast).join(" ")).not.toContain("checks");
  });
});

/*
 * The sample stops being a constant.
 *
 * `economy/historical-runs.ts` was read out of Supabase by a person on
 * 2026-08-20 and typed into the repository. It was this estimator's whole
 * dataset, it has no database access, and it therefore stopped growing that
 * morning — so "Based on N comparable runs" counted against that day while the
 * runs kept accumulating. The 2026-08-21 intelligence review named it as the
 * missing learning loop; this is the half of the loop that was a constant.
 */
describe("what the forecast counts", () => {
  function observation(overrides: Record<string, unknown> = {}) {
    return {
      id: "run_new",
      createdAt: "2026-09-02T00:22:31.732Z",
      title: "Add a sitemap route",
      riskClass: "moderate" as const,
      changeKind: "product_change" as const,
      evidenceIds: ["live.seo.sitemap_missing"],
      providerCostNanoUsd: 120_000_000,
      agentSandbox: null,
      validationSandbox: null,
      validationAttempted: false,
      durationMs: 300_000,
      ...overrides,
    };
  }

  function sampleWith(observations: ReturnType<typeof observation>[]): number {
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations,
    });
    if (!forecast) throw new Error("expected a forecast");
    return forecast.comparableRuns;
  }

  it("counts a completed run the seed does not describe", () => {
    expect(sampleWith([observation()])).toBeGreaterThan(sampleWith([]));
  });

  it("counts one run once, however many rows describe it", () => {
    /*
     * Deduplication against the transcribed seed is asserted in
     * `economy/measured-runs.test.ts`, where the seed can be named — this file
     * may not import it (`sprint-0054-safety.test.ts` allows `run-forecast.ts`
     * to read the economy layer and not its test). What belongs here is the
     * consequence: a sample reported under a button that spends money must
     * count a run once.
     */
    const twice = [observation(), observation()];

    expect(sampleWith(twice)).toBe(sampleWith([observation()]));
  });

  it("still carries no amount out, however many runs it read", () => {
    // The permission this file holds is conditional (ADR 0072). Growing the
    // dataset must not grow what crosses the boundary.
    const forecast = forecastRun({
      at: AT,
      step: SEO_STEP,
      riskClass: "moderate",
      snapshot: snapshot(),
      observations: [observation()],
    });

    expect(Object.keys(forecast ?? {}).sort()).toEqual([
      "comparableRuns",
      "confidence",
      "drivers",
      "repositoryMeasured",
    ]);
  });
});
