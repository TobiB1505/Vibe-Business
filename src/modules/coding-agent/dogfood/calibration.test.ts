import { describe, expect, it } from "vitest";
import { EXECUTION_PRICING_CLASSES } from "@/modules/economy/execution-class";
import { MAX_AGENTIC_V1_RISK, riskExceeds } from "@/modules/execution-contract/schema";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import { SENSITIVE_EVIDENCE_PREFIXES } from "@/modules/validation/depth";
import {
  CALIBRATION_FIXTURES,
  calibrationFixtureForRun,
  classifyCalibrationFixture,
  findCalibrationFixture,
} from "./calibration";
import { benchmarkStepKey, executionOriginForStepKey, listBenchmarkFixtures } from "./fixtures";

/**
 * The calibration set, checked before it costs anything (Sprint 0055).
 *
 * Every assertion here exists because the alternative is discovering the same
 * thing after five real agent runs have been paid for. A calibration set whose
 * classes turn out wrong once the money is spent has measured nothing.
 */

describe("the calibration set covers the classes the dataset is missing", () => {
  it("has one fixture per run, numbered 1 to 5", () => {
    expect(CALIBRATION_FIXTURES.map((fixture) => fixture.calibrationRun)).toEqual([1, 2, 3, 4, 5]);
  });

  it("uses a distinct id per fixture", () => {
    const ids = CALIBRATION_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * `complex` has zero observations in Vibe's entire history — it is the single
   * biggest gap Sprint 0054 named. Two of the five exist to close it.
   */
  it("produces two complex runs, two standard and one small", () => {
    const classes = CALIBRATION_FIXTURES.map((fixture) => fixture.expectedPricingClass);

    expect(classes.filter((entry) => entry === "complex")).toHaveLength(2);
    expect(classes.filter((entry) => entry === "standard")).toHaveLength(2);
    expect(classes.filter((entry) => entry === "small")).toHaveLength(1);
  });

  it("covers every pricing class the classifier can produce", () => {
    const covered = new Set(CALIBRATION_FIXTURES.map((fixture) => fixture.expectedPricingClass));
    expect([...covered].sort()).toEqual([...EXECUTION_PRICING_CLASSES].sort());
  });
});

/**
 * The load-bearing assertions. Each fixture's expected class is written down by
 * hand; the classifier derives one independently. If those two ever disagree,
 * the prediction recorded before a run would describe a different run than the
 * one that executes.
 */
describe("every fixture resolves to the class it claims", () => {
  for (const fixture of CALIBRATION_FIXTURES) {
    it(`run ${fixture.calibrationRun} (${fixture.id}) is ${fixture.expectedPricingClass}`, () => {
      const resolved = classifyCalibrationFixture(fixture);

      expect(resolved.pricingClass).toBe(fixture.expectedPricingClass);
    });

    it(`run ${fixture.calibrationRun} implies exactly the surfaces it claims`, () => {
      const resolved = classifyCalibrationFixture(fixture);

      expect(resolved.surfaces).toEqual(fixture.expectedSurfaces);
    });
  }

  it("reaches complex by surface count, never by risk class", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      if (fixture.expectedPricingClass !== "complex") continue;

      const resolved = classifyCalibrationFixture(fixture);
      expect(resolved.reason, fixture.id).toBe("multi_surface");
      expect(resolved.surfaces.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("reaches small by having no named surface at all", () => {
    const small = CALIBRATION_FIXTURES.filter((fixture) => fixture.expectedPricingClass === "small");

    for (const fixture of small) {
      const resolved = classifyCalibrationFixture(fixture);
      expect(resolved.reason, fixture.id).toBe("public_pages_only");
      expect(resolved.surfaces).toEqual([]);
    }
  });
});

/**
 * Three ways a calibration run could cost money and return nothing. All three
 * are cheaper to rule out here than in production.
 */
describe("no fixture can produce a refused or unusable run", () => {
  /**
   * `MAX_AGENTIC_V1_RISK` is `moderate`. A high-risk fixture would also classify
   * as `complex` — and then be refused before the agent starts, producing a
   * blocked run and no cost data at all.
   */
  it("never asks for a risk class the execution contract refuses", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      expect(riskExceeds(fixture.expectedRiskClass, MAX_AGENTIC_V1_RISK), fixture.id).toBe(false);
    }
  });

  /**
   * Payments, checkout and authentication are the surfaces Vibe should not be
   * practising on. They would also force `complex` and `deep` for a reason that
   * has nothing to do with how broad the change is.
   */
  it("cites no sensitive evidence", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      for (const id of fixture.evidenceIds) {
        const sensitive = SENSITIVE_EVIDENCE_PREFIXES.some((prefix) => id.startsWith(prefix));
        expect(sensitive, `${fixture.id} cites sensitive evidence ${id}`).toBe(false);
      }
    }
  });

  /**
   * An unrecognised evidence namespace implies nothing, which would silently
   * drop a fixture to a narrower class than intended — a `complex` run quietly
   * executing and being recorded as `standard`.
   */
  it("cites only evidence the surface resolver recognises", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      const requirement = deriveExecutionSurfaceRequirement({
        changeKind: fixture.changeKind,
        evidenceIds: fixture.evidenceIds,
      });

      expect(requirement.unrecognised, `${fixture.id} cites unrecognised evidence`).toEqual([]);
    }
  });

  it("only uses change kinds that actually change the repository", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      expect(fixture.changeKind, fixture.id).toBe("product_change");
    }
  });
});

/**
 * Sprint 0055 forbids a migration, and `execution_origin` accepts only
 * `planner` and `dogfood_fixture`. The step-key prefix is what puts a run in
 * the second bucket, so a fixture that did not carry it would be recorded as
 * production planner traffic.
 */
describe("every calibration run is recorded as dogfood, without a migration", () => {
  it("resolves to execution_origin dogfood_fixture", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      const origin = executionOriginForStepKey(benchmarkStepKey(fixture));

      expect(origin.executionOrigin, fixture.id).toBe("dogfood_fixture");
      expect(origin.dogfoodFixtureId, fixture.id).toBe(fixture.id);
    }
  });

  it("is registered in the benchmark fixture list the dogfood surface reads", () => {
    const registered = listBenchmarkFixtures().map((fixture) => fixture.id);

    for (const fixture of CALIBRATION_FIXTURES) {
      expect(registered, `${fixture.id} is not reachable from the dogfood surface`).toContain(
        fixture.id,
      );
    }
  });

  it("produces a url-safe step key", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      expect(benchmarkStepKey(fixture)).toMatch(/^dogfood-fixture--[a-z0-9-]+$/);
    }
  });
});

describe("fixture lookup", () => {
  it("finds a fixture by id and by run number", () => {
    expect(findCalibrationFixture("calibration-3-standard-logic")?.calibrationRun).toBe(3);
    expect(calibrationFixtureForRun(5)?.expectedPricingClass).toBe("complex");
  });

  it("returns null rather than a default for an unknown fixture", () => {
    expect(findCalibrationFixture("nope")).toBeNull();
    expect(calibrationFixtureForRun(99)).toBeNull();
  });
});
