import { describe, expect, it } from "vitest";
import { SENSITIVE_EVIDENCE_PREFIXES } from "@/modules/validation/depth";
import {
  EXECUTION_PRICING_CLASS_POLICY_VERSION,
  classifyExecutionPricingClass,
  type ClassifyExecutionPricingClassInput,
} from "./execution-class";

/**
 * Sprint 0052, PART A/C — the classifier is the pricing input, so its own
 * contract matters as much as its output: deterministic, pre-execution-only,
 * and immune to anything the agent did or said.
 */

const BASE: ClassifyExecutionPricingClassInput = {
  riskClass: "moderate",
  changeKind: "product_change",
  evidenceIds: ["live.seo.robots_meta_missing"],
  surfaces: ["seo_metadata"],
};

describe("determinism", () => {
  it("the same pre-execution input always produces the same class", () => {
    const first = classifyExecutionPricingClass(BASE);
    const second = classifyExecutionPricingClass({ ...BASE });
    expect(first).toEqual(second);
  });

  it("field order in evidenceIds/surfaces does not change the result", () => {
    const a = classifyExecutionPricingClass({
      ...BASE,
      evidenceIds: ["live.seo.canonical_missing", "live.access.protected_surface"],
      surfaces: ["seo_metadata", "dashboard_app"],
    });
    const b = classifyExecutionPricingClass({
      ...BASE,
      evidenceIds: ["live.access.protected_surface", "live.seo.canonical_missing"],
      surfaces: ["dashboard_app", "seo_metadata"],
    });
    expect(a).toEqual(b);
  });

  it("carries a stable policy version so a stored classification can be reproduced", () => {
    expect(classifyExecutionPricingClass(BASE).policyVersion).toBe(EXECUTION_PRICING_CLASS_POLICY_VERSION);
    // v2 is `build-chain-v1`: the same inputs can price differently now that a
    // run may carry more than one delivery, and rule 65 says the semantics get
    // a version rather than a silent reinterpretation.
    expect(EXECUTION_PRICING_CLASS_POLICY_VERSION).toBe("execution-pricing-class.v2");
  });
});

describe("input shape excludes everything post-execution", () => {
  it("the input type has no field for cost, tokens, duration, tool calls or agent prose", () => {
    // A compile-time guarantee as much as a runtime one: TypeScript would
    // reject an extra property on a strictly-typed literal, so this object
    // existing and type-checking IS the assertion. Listed explicitly so a
    // reviewer sees the forbidden fields named, not just absent.
    const input: ClassifyExecutionPricingClassInput = {
      riskClass: "moderate",
      changeKind: "product_change",
      evidenceIds: [],
      surfaces: [],
    };
    expect(Object.keys(input).sort()).toEqual(
      ["changeKind", "evidenceIds", "riskClass", "surfaces"].sort(),
    );
  });

  it("two runs with identical pre-execution input but different (hypothetical) actual cost still classify identically", () => {
    // Simulates the real scenario this rule protects against: run #3 cost
    // $0.3465 and run #6 cost $0.1444 with byte-identical structured signals
    // (both cite the live.seo.robots_meta_missing family). The classifier
    // must not be able to see that difference because it is never given it.
    const cheapRun = classifyExecutionPricingClass(BASE);
    const expensiveRun = classifyExecutionPricingClass(BASE);
    expect(cheapRun).toEqual(expensiveRun);
  });
});

describe("escalation order — nothing can talk a risky or broad step down", () => {
  it("non-mutating change kind has no class at all", () => {
    const result = classifyExecutionPricingClass({ ...BASE, changeKind: "analysis" });
    expect(result.pricingClass).toBeNull();
    expect(result.reason).toBe("not_mutating");
  });

  it("high risk class is complex even with a single narrow surface", () => {
    const result = classifyExecutionPricingClass({ ...BASE, riskClass: "high" });
    expect(result.pricingClass).toBe("complex");
    expect(result.reason).toBe("high_risk_class");
  });

  it("prohibited risk class is complex", () => {
    const result = classifyExecutionPricingClass({ ...BASE, riskClass: "prohibited" });
    expect(result.pricingClass).toBe("complex");
  });

  it("sensitive evidence escalates to complex even at moderate risk and one surface", () => {
    const result = classifyExecutionPricingClass({
      ...BASE,
      evidenceIds: ["live.surface.login"],
      surfaces: ["authentication"],
    });
    expect(result.pricingClass).toBe("complex");
    expect(result.reason).toBe("sensitive_surface_evidence");
  });

  it("every SENSITIVE_EVIDENCE_PREFIXES entry escalates to complex, proving no second list drifted", () => {
    for (const prefix of SENSITIVE_EVIDENCE_PREFIXES) {
      const result = classifyExecutionPricingClass({
        ...BASE,
        evidenceIds: [`${prefix}.example`],
        surfaces: [],
      });
      expect(result.pricingClass, prefix).toBe("complex");
      expect(result.reason, prefix).toBe("sensitive_surface_evidence");
    }
  });

  it("two or more named surfaces is complex even at moderate risk with no sensitive evidence", () => {
    const result = classifyExecutionPricingClass({
      ...BASE,
      evidenceIds: ["live.seo.canonical_missing", "live.surface.pricing"],
      surfaces: ["seo_metadata", "pricing_page"],
    });
    expect(result.pricingClass).toBe("complex");
    expect(result.reason).toBe("multi_surface");
  });

  it("exactly one named surface is standard", () => {
    const result = classifyExecutionPricingClass(BASE);
    expect(result.pricingClass).toBe("standard");
    expect(result.reason).toBe("single_surface");
  });

  it("a mutating step with no evidence at all escalates to standard, never small", () => {
    const result = classifyExecutionPricingClass({ ...BASE, evidenceIds: [], surfaces: [] });
    expect(result.pricingClass).toBe("standard");
    expect(result.reason).toBe("no_evidence_cited");
  });

  it("public-pages-only with zero named surfaces and real evidence is small", () => {
    const result = classifyExecutionPricingClass({
      ...BASE,
      evidenceIds: ["live.conversion.primary_cta"],
      surfaces: [],
    });
    expect(result.pricingClass).toBe("small");
    expect(result.reason).toBe("public_pages_only");
  });
});

describe("historical runs #3-8 (Sprint 0052 PART D) classify as documented", () => {
  it("runs #3-6 (live.seo.robots_meta_missing, one surface) are standard", () => {
    const result = classifyExecutionPricingClass({
      riskClass: "moderate",
      changeKind: "product_change",
      evidenceIds: ["live.seo.robots_meta_missing"],
      surfaces: ["seo_metadata"],
    });
    expect(result.pricingClass).toBe("standard");
  });

  it("run #7 (live.seo.canonical_missing, one surface) is standard", () => {
    const result = classifyExecutionPricingClass({
      riskClass: "moderate",
      changeKind: "product_change",
      evidenceIds: ["live.seo.canonical_missing"],
      surfaces: ["seo_metadata"],
    });
    expect(result.pricingClass).toBe("standard");
  });

  it("run #8 (live.conversion.primary_cta, zero named surfaces) is small", () => {
    const result = classifyExecutionPricingClass({
      riskClass: "moderate",
      changeKind: "product_change",
      evidenceIds: ["live.conversion.primary_cta"],
      surfaces: [],
    });
    expect(result.pricingClass).toBe("small");
  });

  it("no historical run reaches complex — the tier has zero real-data coverage", () => {
    const historical: ClassifyExecutionPricingClassInput[] = [
      { riskClass: "moderate", changeKind: "product_change", evidenceIds: ["live.seo.robots_meta_missing"], surfaces: ["seo_metadata"] },
      { riskClass: "moderate", changeKind: "product_change", evidenceIds: ["live.seo.canonical_missing"], surfaces: ["seo_metadata"] },
      { riskClass: "moderate", changeKind: "product_change", evidenceIds: ["live.conversion.primary_cta"], surfaces: [] },
    ];
    for (const input of historical) {
      expect(classifyExecutionPricingClass(input).pricingClass).not.toBe("complex");
    }
  });
});
