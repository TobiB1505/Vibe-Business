import { describe, expect, it } from "vitest";
import {
  VALIDATION_DEPTHS,
  VALIDATION_DEPTH_POLICY_VERSION,
  depthRunsStep,
  resolveValidationDepth,
  sensitiveDomainsIn,
  stepsForDepth,
  type ResolveValidationDepthInput,
} from "./depth";

/**
 * Risk-adaptive validation depth (Sprint 0047).
 *
 * The property under test throughout is the direction of the bias: every
 * uncertain input must resolve *upward*. A test that only proved "SEO gets
 * fast" would pass on a resolver that returned `fast` for everything.
 */

function input(overrides: Partial<ResolveValidationDepthInput> = {}): ResolveValidationDepthInput {
  return {
    riskClass: "moderate",
    changeKind: "product_change",
    evidenceIds: [],
    changedPaths: ["src/app/page.tsx"],
    ...overrides,
  };
}

describe("PART H — the required test matrix", () => {
  it("case 1: an SEO metadata change is FAST", () => {
    const result = resolveValidationDepth(
      input({
        riskClass: "low",
        evidenceIds: ["live.seo.canonical_missing"],
        changedPaths: ["src/app/page.tsx", "src/app/privacy/page.tsx"],
      }),
    );

    expect(result.depth).toBe("fast");
    expect(result.reason).toBe("presentational_low_risk");
  });

  it("case 2: a landing-page CTA change is STANDARD", () => {
    // `live.conversion.*` is presentational, but the risk class for an
    // ordinary product change is `moderate` — and moderate never buys `fast`.
    const result = resolveValidationDepth(
      input({
        riskClass: "moderate",
        evidenceIds: ["live.conversion.primary_cta"],
        changedPaths: ["src/app/page.tsx", "e2e/first-ten-minutes.spec.ts"],
      }),
    );

    expect(result.depth).toBe("standard");
    expect(result.reason).toBe("moderate_risk_change");
  });

  it("case 3: a billing change is DEEP", () => {
    const result = resolveValidationDepth(
      input({
        riskClass: "moderate",
        evidenceIds: ["repo.surface.payments"],
        changedPaths: ["src/modules/credits/ledger.ts"],
      }),
    );

    expect(result.depth).toBe("deep");
    expect(result.escalatedBy).toContain("billing");
  });

  it("case 4: an authentication change is DEEP", () => {
    const result = resolveValidationDepth(
      input({
        riskClass: "high",
        evidenceIds: ["repo.surface.authentication"],
        changedPaths: ["src/modules/auth/session.ts"],
      }),
    );

    expect(result.depth).toBe("deep");
  });

  it("case 5: an unclassified change falls back to STANDARD, never FAST", () => {
    const result = resolveValidationDepth({
      riskClass: null,
      changeKind: null,
      evidenceIds: [],
      changedPaths: ["src/something/unknown.ts"],
    });

    expect(result.depth).toBe("standard");
    expect(result.reason).toBe("unclassified_default");
  });

  it("never skips validation entirely, at any depth", () => {
    for (const depth of VALIDATION_DEPTHS) {
      expect(stepsForDepth(depth).length).toBeGreaterThan(0);
      // Install is what makes any later step mean anything.
      expect(depthRunsStep(depth, "install")).toBe(true);
    }
  });
});

describe("escalation outranks everything that could lower the answer", () => {
  it("escalates on a sensitive path even when every other signal says low risk", () => {
    // The important case: a change that *said* it was presentational SEO work
    // and then touched billing. The artifact wins over the intention.
    const result = resolveValidationDepth(
      input({
        riskClass: "low",
        changeKind: "product_change",
        evidenceIds: ["live.seo.canonical_missing"],
        changedPaths: ["src/app/page.tsx", "src/modules/billing/stripe.ts"],
      }),
    );

    expect(result.depth).toBe("deep");
    expect(result.reason).toBe("sensitive_domain_changed");
    expect(result.escalatedBy).toEqual(["billing"]);
  });

  it("escalates on a database migration", () => {
    expect(
      resolveValidationDepth(input({ changedPaths: ["supabase/migrations/20260101_x.sql"] })).depth,
    ).toBe("deep");
  });

  it("escalates on a change to what gets installed", () => {
    for (const path of ["package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json"]) {
      const result = resolveValidationDepth(
        input({
          riskClass: "low",
          evidenceIds: ["live.seo.canonical_missing"],
          changedPaths: [path],
        }),
      );
      expect(result.depth, path).toBe("deep");
      expect(result.escalatedBy, path).toContain("build-identity");
    }
  });

  it("escalates on a CI workflow change, because that is supply chain", () => {
    expect(
      resolveValidationDepth(input({ changedPaths: [".github/workflows/deploy.yml"] })).escalatedBy,
    ).toContain("ci");
  });

  it("escalates on the execution core itself", () => {
    expect(
      resolveValidationDepth(input({ changedPaths: ["src/modules/coding-agent/gateway.ts"] }))
        .escalatedBy,
    ).toContain("execution-core");
  });

  it("reports every sensitive domain it found, deduped and sorted", () => {
    const result = resolveValidationDepth(
      input({
        changedPaths: [
          "src/modules/auth/session.ts",
          "src/modules/billing/stripe.ts",
          "src/modules/auth/actions.ts",
        ],
      }),
    );

    expect(result.escalatedBy).toEqual(["auth", "billing"]);
  });

  it("escalates on a high risk class with entirely innocuous paths", () => {
    const result = resolveValidationDepth(
      input({ riskClass: "high", changedPaths: ["src/components/ui/button.tsx"] }),
    );

    expect(result.depth).toBe("deep");
    expect(result.reason).toBe("high_risk_class");
  });

  it("escalates on prohibited risk", () => {
    expect(resolveValidationDepth(input({ riskClass: "prohibited" })).depth).toBe("deep");
  });

  it("escalates on sensitive evidence with innocuous paths", () => {
    const result = resolveValidationDepth(
      input({
        riskClass: "low",
        evidenceIds: ["live.access.protected_surface"],
        changedPaths: ["src/components/ui/button.tsx"],
      }),
    );

    expect(result.depth).toBe("deep");
    expect(result.reason).toBe("sensitive_surface_evidence");
  });
});

describe("FAST requires a positive trusted signal — silence never buys speed", () => {
  /**
   * This assertion replaced one that required `riskClass !== "moderate"` for
   * `fast`. The historical benchmark (PART I) proved that guard unreachable —
   * `classifyExecutionRisk` only returns `low` for a non-mutating change kind,
   * which `no_code_change` already catches — so it made `fast` dead rather than
   * safe. The real guard is the artifact: presentational *intent* is not enough
   * on its own, and a path outside the presentational set withholds the skip
   * however cosmetic the cited evidence is.
   */
  it("does not go fast on presentational evidence when a changed path is not presentational", () => {
    expect(
      resolveValidationDepth(
        input({
          riskClass: "moderate",
          evidenceIds: ["live.seo.canonical_missing"],
          changedPaths: ["src/app/page.tsx", "src/modules/seo/metadata.ts"],
        }),
      ).depth,
    ).toBe("standard");
  });

  it("does not go fast when a test file is among the changed paths", () => {
    // A change that edits a test is exactly the change whose test step must run.
    expect(
      resolveValidationDepth(
        input({
          riskClass: "moderate",
          evidenceIds: ["live.conversion.primary_cta"],
          changedPaths: ["src/app/page.tsx", "e2e/first-ten-minutes.spec.ts"],
        }),
      ).depth,
    ).toBe("standard");
  });

  it("goes fast when the intent and the artifact are both presentational", () => {
    const result = resolveValidationDepth(
      input({
        riskClass: "moderate",
        evidenceIds: ["live.seo.robots_meta_missing"],
        changedPaths: ["src/app/layout.tsx", "src/app/app/layout.tsx"],
      }),
    );

    expect(result.depth).toBe("fast");
    expect(result.reason).toBe("presentational_low_risk");
  });

  it("does not go fast on a low risk class with no evidence at all", () => {
    expect(resolveValidationDepth(input({ riskClass: "low", evidenceIds: [] })).depth).toBe(
      "standard",
    );
  });

  it("does not go fast when one cited id is not a recognised presentational family", () => {
    const result = resolveValidationDepth(
      input({
        riskClass: "low",
        evidenceIds: ["live.seo.canonical_missing", "some.future.family"],
      }),
    );

    expect(result.depth).toBe("standard");
  });

  it("goes fast for a step that changes no application code", () => {
    const result = resolveValidationDepth(input({ changeKind: "analysis" }));

    expect(result.depth).toBe("fast");
    expect(result.reason).toBe("no_code_change");
  });

  it("still escalates a no-code-change step that somehow touched a sensitive path", () => {
    const result = resolveValidationDepth(
      input({ changeKind: "analysis", changedPaths: ["supabase/migrations/x.sql"] }),
    );

    expect(result.depth).toBe("deep");
  });
});

describe("what each depth actually runs", () => {
  it("FAST skips the unit suite and nothing else", () => {
    expect(stepsForDepth("fast")).toEqual(["install", "typecheck", "build"]);
    expect(depthRunsStep("fast", "test")).toBe(false);
  });

  /**
   * The build is not depth-adjustable, and this is the regression test for the
   * first dogfood: `fast` skipped it, `buildSatisfiesProfile` requires a passing
   * build for any run to be recorded as passed, and the preview artifact is the
   * validated filesystem the build produces. The run failed with
   * `validation_not_supported`.
   */
  it("every depth runs the build, because a pass and a preview both depend on it", () => {
    for (const depth of VALIDATION_DEPTHS) {
      expect(depthRunsStep(depth, "build")).toBe(true);
      expect(depthRunsStep(depth, "install")).toBe(true);
    }
  });

  it("STANDARD runs the profile's full step set", () => {
    expect(stepsForDepth("standard")).toEqual(["install", "typecheck", "test", "build"]);
  });

  it("DEEP runs at least everything STANDARD does", () => {
    // Stated as a subset relation rather than as equality, so that the day
    // `deep` gains a step this test keeps passing and still means something.
    for (const step of stepsForDepth("standard")) {
      expect(depthRunsStep("deep", step)).toBe(true);
    }
  });

  it("no depth invents a step the profile does not define", () => {
    const profileSteps = ["install", "typecheck", "test", "build"];
    for (const depth of VALIDATION_DEPTHS) {
      for (const step of stepsForDepth(depth)) {
        expect(profileSteps).toContain(step);
      }
    }
  });
});

describe("determinism and versioning", () => {
  it("is a pure function of its inputs", () => {
    const args = input({ evidenceIds: ["live.seo.canonical_missing"], riskClass: "low" });
    expect(resolveValidationDepth(args)).toEqual(resolveValidationDepth(args));
  });

  it("does not depend on the order of changed paths", () => {
    const forwards = resolveValidationDepth(
      input({ changedPaths: ["src/modules/auth/x.ts", "src/app/page.tsx"] }),
    );
    const backwards = resolveValidationDepth(
      input({ changedPaths: ["src/app/page.tsx", "src/modules/auth/x.ts"] }),
    );
    expect(forwards).toEqual(backwards);
  });

  it("stamps every resolution with the depth policy version", () => {
    expect(resolveValidationDepth(input()).policyVersion).toBe(VALIDATION_DEPTH_POLICY_VERSION);
  });

  it("finds nothing sensitive in an ordinary page change", () => {
    expect(sensitiveDomainsIn(["src/app/page.tsx", "src/app/terms/page.tsx"])).toEqual([]);
  });
});
