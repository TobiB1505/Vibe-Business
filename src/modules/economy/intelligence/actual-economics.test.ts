import { describe, expect, it } from "vitest";
import { VERCEL_FUNCTIONS_RATES, VERCEL_SANDBOX_RATES } from "../infrastructure-rates";
import type { SandboxUsage } from "../sandbox-cost";
import { REALISTIC_STEP_WORK } from "../workflow-invocation-cost";
import { type ActualEconomicsInput, deriveActualExecutionEconomics } from "./actual-economics";

function sandbox(overrides: Partial<SandboxUsage> = {}): SandboxUsage {
  return {
    purpose: "agent_execution",
    wallMs: 600_000,
    activeCpuMs: 120_000,
    vcpus: 4,
    vcpusBasis: "derived_from_configuration",
    creations: 1,
    outboundBytes: 0,
    snapshot: null,
    ...overrides,
  };
}

function input(overrides: Partial<ActualEconomicsInput> = {}): ActualEconomicsInput {
  return {
    providerCostNanoUsd: 311_505_500,
    agentSandbox: sandbox(),
    validationSandbox: sandbox({ purpose: "change_validation", wallMs: 210_000, activeCpuMs: 60_000 }),
    validationAttempted: true,
    workflowSteps: 30,
    rates: VERCEL_SANDBOX_RATES,
    functionsRates: VERCEL_FUNCTIONS_RATES,
    stepWork: REALISTIC_STEP_WORK,
    ...overrides,
  };
}

describe("a run's actual cost splits into the components a variance can name", () => {
  it("prices all four when everything was recorded", () => {
    const actual = deriveActualExecutionEconomics(input());

    expect(actual.actualCost.complete).toBe(true);
    expect(actual.components.model.known).toBe(true);
    expect(actual.components.agentSandbox.known).toBe(true);
    expect(actual.components.validation.known).toBe(true);
    expect(actual.components.infrastructure.known).toBe(true);
    expect(actual.actualCost.knownFloorNanoUsd).toBeGreaterThan(311_505_500);
  });

  it("carries the provenance of the derived half", () => {
    const actual = deriveActualExecutionEconomics(input());

    expect(actual.provenance?.pricingVersion).toBe("vercel-sandbox-2026-08-20");
    expect(actual.provenance?.assumptions.join(" ")).toContain("vCPU count reconstructed");
  });

  it("keeps the full-CPU upper bound available without folding it into the answer", () => {
    const actual = deriveActualExecutionEconomics(input());

    expect(actual.agentSandboxUpperBoundNanoUsd ?? 0).toBeGreaterThan(0);
    expect(actual.validationSandboxUpperBoundNanoUsd ?? 0).toBeGreaterThan(0);
  });
});

/**
 * PART P #9. A rate-derived number stamped `measured` is indistinguishable from
 * a provider invoice in every downstream reader, and the first time a rate card
 * is wrong the error is untraceable.
 */
describe("no estimated number is ever recorded as measured", () => {
  it("marks only the provider figure measured", () => {
    const actual = deriveActualExecutionEconomics(input());

    for (const [name, component] of Object.entries(actual.components)) {
      if (!component.known) continue;
      expect(component.basis, name).toBe(name === "model" ? "measured" : "estimated");
    }
  });

  it("does not become measured just because every rate resolved", () => {
    const actual = deriveActualExecutionEconomics(input());

    if (!actual.components.agentSandbox.known) throw new Error("expected a priced sandbox");
    expect(actual.components.agentSandbox.basis).toBe("estimated");
  });
});

describe("an absence is never a zero", () => {
  it("reports unknown when the provider figure was never recorded", () => {
    const actual = deriveActualExecutionEconomics(input({ providerCostNanoUsd: null }));

    expect(actual.components.model).toEqual({ known: false, reason: "not_measured" });
    expect(actual.actualCost.complete).toBe(false);
    expect(actual.actualCost.missing).toContain("model");
  });

  /**
   * Wall duration is not active CPU. Substituting one for the other would be
   * the largest single line of the bill, invented.
   */
  it("refuses to price a sandbox whose active CPU was never recorded", () => {
    const actual = deriveActualExecutionEconomics(
      input({ agentSandbox: sandbox({ activeCpuMs: null }) }),
    );

    expect(actual.components.agentSandbox.known).toBe(false);
    expect(actual.actualCost.missing).toContain("agentSandbox");
  });

  /**
   * An unvalidated change has no validation cost to be missing. `sumCosts`
   * excludes `stage_not_run` from `missing` for exactly this reason.
   */
  it("distinguishes a stage that did not run from one that was not measured", () => {
    const notRun = deriveActualExecutionEconomics(
      input({ validationAttempted: false, validationSandbox: null }),
    );
    const notMeasured = deriveActualExecutionEconomics(input({ validationSandbox: null }));

    expect(notRun.components.validation).toEqual({ known: false, reason: "stage_not_run" });
    expect(notRun.actualCost.missing).not.toContain("validation");
    expect(notRun.actualCost.complete).toBe(true);

    expect(notMeasured.components.validation).toEqual({ known: false, reason: "not_measured" });
    expect(notMeasured.actualCost.missing).toContain("validation");
  });

  it("says nothing about infrastructure it did not count", () => {
    const actual = deriveActualExecutionEconomics(input({ workflowSteps: null }));

    expect(actual.components.infrastructure).toEqual({ known: false, reason: "not_measured" });
  });
});

describe("confidence reflects how much of the figure was actually measured", () => {
  /**
   * The honest ceiling. `sandbox_usage_events.provider_cost_usd` is null in
   * every row Vibe has ever written, so the sandbox and infrastructure halves
   * are always rate-derived and a complete picture is still only `medium`.
   * `high` becomes reachable the day a provider reports attributable sandbox
   * cost, and this test is what will notice.
   */
  it("tops out at medium while every sandbox second is rate-derived", () => {
    const actual = deriveActualExecutionEconomics(input());

    expect(actual.actualCost.complete).toBe(true);
    expect(actual.confidence).toBe("medium");
  });

  it("collapses when a component is missing, so a floor is never read as a total", () => {
    const actual = deriveActualExecutionEconomics(input({ providerCostNanoUsd: null }));

    expect(actual.confidence).toBe("none");
    expect(actual.actualCost.complete).toBe(false);
  });

  it("is not lowered by a stage that legitimately did not run", () => {
    const withValidation = deriveActualExecutionEconomics(input());
    const withoutValidation = deriveActualExecutionEconomics(
      input({ validationAttempted: false, validationSandbox: null }),
    );

    expect(withoutValidation.confidence).toBe(withValidation.confidence);
  });

  it("reports none when the sandbox was never metered at all", () => {
    // An agent run always provisions a VM, so an unmetered sandbox is a gap in
    // Vibe's own recording rather than a stage that did not happen.
    const actual = deriveActualExecutionEconomics(
      input({ agentSandbox: null, validationSandbox: null, validationAttempted: false, workflowSteps: null }),
    );

    expect(actual.components.agentSandbox).toEqual({ known: false, reason: "not_measured" });
    expect(actual.confidence).toBe("none");
  });
});
