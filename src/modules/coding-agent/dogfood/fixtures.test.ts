import { describe, expect, it } from "vitest";
import { deriveExecutionSurfaceRequirement } from "@/modules/execution-context/surface";
import { compileAgentVerificationPlan } from "@/modules/execution-context/verification";
import { compileCompletionBudget } from "@/modules/execution-context/completion";
import { completionBudgetFor } from "@/modules/execution-context/service";
import { classifyExecutionRisk } from "@/modules/execution-contract/risk";
import { fakeBriefSnapshot, fakePublicSiteSnapshot } from "@/modules/execution-context/test-support";
import { resolveExecutionSurface } from "@/modules/execution-context/surface";
import { usablePath } from "@/modules/execution-context/compiler";
import {
  BENCHMARK_STEP_PREFIX,
  LOW_UI_PRIMARY_CTA,
  benchmarkStep,
  benchmarkStepKey,
  findBenchmarkFixture,
  fixtureForStepKey,
  isBenchmarkStepKey,
  listBenchmarkFixtures,
} from "./fixtures";

/**
 * The trust boundary around an internal benchmark fixture (Sprint 0045).
 *
 * A fixture chooses *which* benchmark step runs. Everything else — risk,
 * execution support, verification mode, completion budget, tools, write scope —
 * is derived by the same production code a customer's plan step goes through.
 * These tests exist to keep that true as the fixture set grows.
 */

const SNAPSHOT = fakePublicSiteSnapshot();

describe("a fixture is the Planner's half of a step, and no more", () => {
  it("produces a canonical Action Step", () => {
    const step = benchmarkStep(LOW_UI_PRIMARY_CTA, SNAPSHOT);

    expect(step.id).toBe("dogfood-fixture--low-ui-primary-cta");
    expect(step.order).toBe(1);
    expect(step.dependsOn).toEqual([]);
    expect(step.changeKind).toBe("product_change");
    expect(step.evidenceIds).toEqual(["live.conversion.primary_cta"]);
  });

  it("derives executionSupport from the server registry, not from the fixture", () => {
    const step = benchmarkStep(LOW_UI_PRIMARY_CTA, SNAPSHOT);

    // There is no field on BenchmarkFixture for any of these three. They exist
    // on the step only because `classifyStep` put them there.
    expect(step).toHaveProperty("executionSupport");
    expect(step).toHaveProperty("capability");
    expect(step).toHaveProperty("requiresApproval");
    expect(Object.keys(LOW_UI_PRIMARY_CTA)).not.toContain("executionSupport");
    expect(Object.keys(LOW_UI_PRIMARY_CTA)).not.toContain("capability");
    expect(Object.keys(LOW_UI_PRIMARY_CTA)).not.toContain("requiresApproval");
  });

  it("derives requiresApproval for a product change", () => {
    expect(benchmarkStep(LOW_UI_PRIMARY_CTA, SNAPSHOT).requiresApproval).toBe(true);
  });

  it("cannot name a verification mode, a budget, a model or a tool", () => {
    const keys = Object.keys(LOW_UI_PRIMARY_CTA);

    for (const forbidden of [
      "verificationMode",
      "completionBudget",
      "model",
      "effort",
      "tools",
      "writeScope",
      "riskClass",
      "maxTurns",
      "maxProviderSpendUsd",
      "systemPrompt",
      "prompt",
      "instruction",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("carries no free-form instruction to the model", () => {
    // Every text field is a Planner-shaped business field. There is no field
    // whose contents become an instruction rather than fenced, quoted data.
    const text = [
      LOW_UI_PRIMARY_CTA.title,
      LOW_UI_PRIMARY_CTA.description,
      LOW_UI_PRIMARY_CTA.purpose,
      LOW_UI_PRIMARY_CTA.doneWhen,
      LOW_UI_PRIMARY_CTA.goal,
      LOW_UI_PRIMARY_CTA.expectedChangedState,
    ];

    expect(text.every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.keys(LOW_UI_PRIMARY_CTA).length).toBe(12);
  });
});

describe("the benchmark namespace cannot collide with a customer's plan", () => {
  it("recognises its own keys", () => {
    expect(isBenchmarkStepKey(benchmarkStepKey(LOW_UI_PRIMARY_CTA))).toBe(true);
    expect(fixtureForStepKey(benchmarkStepKey(LOW_UI_PRIMARY_CTA))?.id).toBe(LOW_UI_PRIMARY_CTA.id);
  });

  it("does not claim a Planner step id", () => {
    // The real shape: `${order}-${changeKind}-${slug(title)}`.
    for (const key of [
      "2-product_change-add-canonical-urls-to-public-pages",
      "4-product_change-add-robots-meta-directives-to-public-and-signed-",
      "1-analysis-define-the-metadata-plan",
    ]) {
      expect(isBenchmarkStepKey(key)).toBe(false);
      expect(fixtureForStepKey(key)).toBeNull();
    }
  });

  /*
   * The defect this asserts, in full.
   *
   * The first version separated the namespace with a colon. A colon in a URL
   * path segment is sent as `%3A`, the internal dogfood page received that
   * string, and the prefix check failed — so a fixture that resolved in every
   * test answered "that step could not be found" in the browser. A key that
   * needs no escaping is the fix; this is what keeps it that way.
   */
  it("survives a URL round trip untouched, because it is a path segment", () => {
    for (const fixture of listBenchmarkFixtures()) {
      const key = benchmarkStepKey(fixture);
      expect(encodeURIComponent(key)).toBe(key);
      expect(fixtureForStepKey(decodeURIComponent(encodeURIComponent(key)))?.id).toBe(fixture.id);
    }
  });

  it("refuses an unknown fixture rather than inventing one", () => {
    expect(fixtureForStepKey(`${BENCHMARK_STEP_PREFIX}not-a-fixture`)).toBeNull();
    expect(findBenchmarkFixture("not-a-fixture")).toBeNull();
  });

  it("keeps every registered fixture id unique and namespaced", () => {
    const ids = listBenchmarkFixtures().map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of listBenchmarkFixtures()) {
      expect(benchmarkStepKey(fixture).startsWith(BENCHMARK_STEP_PREFIX)).toBe(true);
    }
  });
});

describe("the fixture routes through the production classifiers", () => {
  const step = benchmarkStep(LOW_UI_PRIMARY_CTA, SNAPSHOT);

  it("derives risk from change kind and evidence, never from the fixture", () => {
    expect(classifyExecutionRisk(step)).toBe("moderate");
  });

  it("derives the public-page surface from live.conversion.primary_cta", () => {
    const requirement = deriveExecutionSurfaceRequirement(step);

    expect(requirement.scopes).toEqual(["public_pages"]);
    expect(requirement.derivedFrom).toEqual(["live.conversion.primary_cta"]);
  });

  it("resolves that surface through the normal route intelligence", () => {
    const resolved = resolveExecutionSurface({ snapshot: SNAPSHOT, live: null, usablePath });

    expect(resolved.publicPages.map((route) => route.path)).toEqual([
      "/",
      "/forgot-password",
      "/login",
      "/privacy",
      "/reset-password",
      "/signup",
      "/terms",
    ]);
  });

  it("excludes the signed-in area, because the evidence does not name it", () => {
    const requirement = deriveExecutionSurfaceRequirement(step);
    expect(requirement.scopes).not.toContain("authenticated_pages");
  });

  it("includes the signed-in area only when structured evidence says so", () => {
    const widened = deriveExecutionSurfaceRequirement({
      changeKind: "product_change",
      evidenceIds: ["live.conversion.primary_cta", "live.access.protected_surface"],
    });

    expect(widened.scopes).toContain("authenticated_pages");
  });

  it("takes the verification mode the classifier gives it, whatever the fixture is called", () => {
    const plan = compileAgentVerificationPlan({
      changeKind: step.changeKind,
      evidenceIds: step.evidenceIds,
      riskClass: classifyExecutionRisk(step),
    });

    // `live.conversion.*` is not in the presentational evidence families, so
    // this is MEDIUM. The fixture is named `low-ui-…` for the size of the task,
    // and naming it did not buy it a cheaper plan.
    expect(plan.mode).toBe("medium");
    expect(plan.requiredChecks).toContain("diff_review");
  });

  it("takes the completion budget keyed off that mode", () => {
    const plan = compileAgentVerificationPlan({
      changeKind: step.changeKind,
      evidenceIds: step.evidenceIds,
      riskClass: classifyExecutionRisk(step),
    });

    expect(completionBudgetFor(plan)).toEqual(compileCompletionBudget(plan.mode));
  });

  it("resolves nothing extra when the repository has no public routes", () => {
    const empty = fakeBriefSnapshot({ routeMode: "none" });
    const resolved = resolveExecutionSurface({ snapshot: empty, live: null, usablePath });

    expect(resolved.publicPages).toEqual([]);
  });
});
