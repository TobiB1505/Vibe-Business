import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXECUTION_PRICING_CLASSES } from "@/modules/economy/execution-class";
import { ROBOTS_ABSENCE_EVIDENCE, SITEMAP_ABSENCE_EVIDENCE } from "@/modules/execution/capabilities";
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

/**
 * The check that was missing, and what it cost to notice.
 *
 * Every assertion above verifies the *classification* — which is derived from
 * evidence ids alone, and never touches the filesystem. So a fixture citing
 * `live.surface.pricing` classified as `complex` exactly as designed, and the
 * suite went green, in a repository that has no pricing page. Two of the five
 * fixtures named surfaces that do not exist here; run 2 would have found
 * nothing to edit or invented a page, and either way it would have spent real
 * money measuring nothing.
 *
 * A calibration fixture has to be *possible*, not just well-classified. This
 * maps each named surface to the paths that implement it and requires at least
 * one to exist.
 */
describe("every fixture names a surface this repository actually has", () => {
  const SURFACE_PATHS: Record<string, readonly string[]> = {
    seo_metadata: ["src/app/layout.tsx", "src/app/page.tsx"],
    sitemap: ["src/app/sitemap.ts"],
    robots: ["src/app/robots.ts"],
    legal: ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"],
    pricing_page: ["src/app/pricing/page.tsx"],
    docs_help: ["src/app/docs/page.tsx", "src/app/help/page.tsx"],
    contact: ["src/app/contact/page.tsx"],
    blog_content: ["src/app/blog/page.tsx"],
    onboarding: ["src/app/app/onboarding/page.tsx"],
    dashboard_app: ["src/app/app/page.tsx"],
  };

  it("knows where every surface the fixtures name would live", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      for (const surface of fixture.expectedSurfaces) {
        expect(SURFACE_PATHS[surface], `no path mapping for surface ${surface}`).toBeDefined();
      }
    }
  });

  it("only names surfaces backed by a file that exists", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      for (const surface of fixture.expectedSurfaces) {
        const paths = SURFACE_PATHS[surface] ?? [];
        const present = paths.filter((path) => existsSync(join(process.cwd(), path)));

        expect(
          present.length,
          `${fixture.id} targets the ${surface} surface, and none of ${paths.join(", ")} exists — ` +
            "the class would be right and the work impossible",
        ).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The two complex runs exist to tell the class apart from the surfaces that
   * happened to produce it. Two observations of the same pair would not.
   */
  it("gives the two complex runs different surface pairs", () => {
    const complex = CALIBRATION_FIXTURES.filter((f) => f.expectedPricingClass === "complex");

    expect(complex).toHaveLength(2);
    const [first, second] = complex;
    expect([...(first?.expectedSurfaces ?? [])].sort()).not.toEqual(
      [...(second?.expectedSurfaces ?? [])].sort(),
    );
  });
});

/**
 * The defect this prevents, in full.
 *
 * `fixtures.ts` lists the calibration fixtures and `calibration.ts` builds them,
 * so the two modules reference each other. A *value* import in both directions
 * means whichever module the bundler enters first evaluates while the other is
 * still initialising, and reads `undefined`.
 *
 * The failure is direction-dependent, which is what made it dangerous: the unit
 * suite entered through `calibration.ts` and passed all 51 assertions, and only
 * `next build` — entering through a page that imports `fixtures.ts` — threw
 * `Cannot access 'j' before initialization`. A deferred read papered over it;
 * moving the one shared value into `fixture-version.ts` removed it.
 */
describe("the fixture modules do not import each other's values", () => {
  it("keeps calibration's import of the harness type-only", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/coding-agent/dogfood/calibration.ts"),
      "utf8",
    );

    const harnessImports = source
      .split("\n")
      .filter((line) => line.includes('from "./fixtures"'));

    expect(harnessImports.length).toBeGreaterThan(0);
    for (const line of harnessImports) {
      expect(line, "a value import here reintroduces the build-time cycle").toMatch(/^import type /);
    }
  });

  it("takes the shared constant from the module that depends on nothing", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/coding-agent/dogfood/calibration.ts"),
      "utf8",
    );
    const shared = readFileSync(
      join(process.cwd(), "src/modules/coding-agent/dogfood/fixture-version.ts"),
      "utf8",
    );

    expect(source).toContain('from "./fixture-version"');
    expect(shared, "fixture-version.ts must import nothing").not.toMatch(/^import /m);
  });
});

/**
 * The second thing that was right in classification and wrong in reality.
 *
 * Vibe has exactly one deterministic capability, and the resolver consults the
 * registry *before* it considers an agentic route. A step citing both halves of
 * that capability's evidence therefore resolves to `mode: "deterministic"` — and
 * the calibration harness, which only knows how to observe agent runs, sees
 * `not_agentic` and refuses.
 *
 * Run 5 originally cited `live.seo.sitemap_missing` + `live.seo.robots_txt_missing`,
 * which is precisely that pair. It survived every assertion above, because the
 * pricing classifier and the surface resolver never look at the capability
 * registry.
 *
 * The registry's own snapshot condition would probably have saved it here — this
 * repository has both files, so `surfaceAbsent` is false — but that is the wrong
 * thing to depend on. Whether a calibration run is an agent run at all would
 * then hinge on how the analyzer classified two files, which is outside the
 * fixture's control and can change between runs.
 */
describe("no fixture can route to a deterministic capability", () => {
  it("never cites both halves of the one capability Vibe has", () => {
    for (const fixture of CALIBRATION_FIXTURES) {
      const citesRobots = fixture.evidenceIds.some((id) => ROBOTS_ABSENCE_EVIDENCE.includes(id));
      const citesSitemap = fixture.evidenceIds.some((id) => SITEMAP_ABSENCE_EVIDENCE.includes(id));

      expect(
        citesRobots && citesSitemap,
        `${fixture.id} cites the SEO foundations capability's full evidence pair — it would ` +
          "resolve as deterministic and never reach the agent",
      ).toBe(false);
    }
  });

  /**
   * Stated as a test because it is the reason the pair could not simply be
   * reworded: *every* sitemap and robots evidence id is absence evidence.
   */
  it("leaves the pair unavailable rather than merely discouraged", () => {
    expect(ROBOTS_ABSENCE_EVIDENCE).toContain("live.seo.robots_txt_missing");
    expect(SITEMAP_ABSENCE_EVIDENCE).toContain("live.seo.sitemap_missing");
    expect(ROBOTS_ABSENCE_EVIDENCE).toContain("repo.surface.robots");
    expect(SITEMAP_ABSENCE_EVIDENCE).toContain("repo.surface.sitemap");
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
