import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RepositoryContextSize } from "../cost-drivers";
import { resolveEconomyModel } from "./model-version";
import { deriveRepositoryComplexity } from "./repository-signal";

const POLICY = resolveEconomyModel(new Date("2026-08-21T00:00:00Z")).repositoryPolicy;

function size(overrides: Partial<RepositoryContextSize>): RepositoryContextSize {
  return {
    treeEntries: null,
    filesAnalyzed: null,
    bytesAnalyzed: null,
    routesDetected: null,
    surfacesDetected: null,
    candidatesAvailable: null,
    candidatesSent: null,
    ...overrides,
  };
}

const AT_REFERENCE = size({ treeEntries: 1_200, routesDetected: 30, candidatesAvailable: 12, candidatesSent: 12 });

describe("repository complexity is a multiplier, never an amount", () => {
  /**
   * PART P #4, in its structural form. A signal that contains no money cannot
   * be rendered as money by a caller who was not paying attention.
   */
  it("has no nanodollars anywhere in the module", () => {
    const source = readFileSync(join(process.cwd(), "src/modules/economy/intelligence/repository-signal.ts"), "utf8");
    // Comments are allowed to *discuss* money; the code is not allowed to
    // contain any, so the prose is stripped before the scan.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/nanoUsd/);
    expect(code).not.toMatch(/CostAmount/);
  });

  it("sits at 1 for a repository at reference scale", () => {
    const signal = deriveRepositoryComplexity(AT_REFERENCE, POLICY);

    expect(signal.measured).toBe(true);
    expect(signal.complexityIndex).toBeCloseTo(1);
    expect(signal.multiplier).toBeCloseTo(1);
    expect(signal.reasons).toContain("at_reference_scale");
  });

  it("rises with a larger technical space", () => {
    const larger = deriveRepositoryComplexity(
      size({ treeEntries: 12_000, routesDetected: 120, candidatesAvailable: 40, candidatesSent: 12 }),
      POLICY,
    );
    const reference = deriveRepositoryComplexity(AT_REFERENCE, POLICY);

    expect(larger.multiplier ?? 0).toBeGreaterThan(reference.multiplier ?? 0);
  });

  it("falls for a smaller one", () => {
    const smaller = deriveRepositoryComplexity(
      size({ treeEntries: 150, routesDetected: 4, candidatesAvailable: 3, candidatesSent: 3 }),
      POLICY,
    );

    expect(smaller.multiplier ?? 1).toBeLessThan(1);
  });

  /**
   * A signal may nudge an estimate; it may not dominate one. Vibe has executed
   * against exactly one repository, so the true size-to-spend relationship is
   * unmeasured and the honest form of that is a clamp.
   */
  it("stays inside the policy bounds however extreme the repository", () => {
    const enormous = deriveRepositoryComplexity(
      size({ treeEntries: 5_000_000, routesDetected: 40_000, candidatesAvailable: 90_000, candidatesSent: 12 }),
      POLICY,
    );
    const tiny = deriveRepositoryComplexity(
      size({ treeEntries: 1, routesDetected: 1, candidatesAvailable: 1, candidatesSent: 1 }),
      POLICY,
    );

    expect(enormous.multiplier).toBe(POLICY.maxMultiplier);
    expect(tiny.multiplier).toBe(POLICY.minMultiplier);
  });
});

describe("context pressure moves complexity independently of size", () => {
  /**
   * The distinction the whole file exists for: a repository can be at reference
   * scale and still be expensive, because what mattered did not fit.
   */
  it("costs more when a same-sized repository clipped its brief", () => {
    const unclipped = deriveRepositoryComplexity(AT_REFERENCE, POLICY);
    const clipped = deriveRepositoryComplexity(
      size({ treeEntries: 1_200, routesDetected: 30, candidatesAvailable: 200, candidatesSent: 12 }),
      POLICY,
    );

    expect(clipped.multiplier ?? 0).toBeGreaterThan(unclipped.multiplier ?? 0);
    expect(clipped.reasons).toContain("context_pressure");
    expect(clipped.pressure.signal).toBe("severe");
  });
});

describe("an unmeasured repository is not a small one", () => {
  it("returns null rather than 1", () => {
    const signal = deriveRepositoryComplexity(null, POLICY);

    expect(signal.measured).toBe(false);
    expect(signal.complexityIndex).toBeNull();
    expect(signal.multiplier).toBeNull();
    expect(signal.reasons).toEqual(["not_measured"]);
  });

  it("assesses the axes it does have and excludes the ones it does not", () => {
    // Routes only. The absent tree count is left out of the mean rather than
    // counted as being at reference scale.
    const signal = deriveRepositoryComplexity(size({ routesDetected: 120 }), POLICY);

    expect(signal.measured).toBe(true);
    expect(signal.reasons).toEqual(["route_count"]);
    expect(signal.multiplier ?? 0).toBeGreaterThan(1);
  });
});
