import { describe, expect, it } from "vitest";
import { compileExecutionPolicy } from "@/modules/execution-contract/policy";
import { renderAgentPreflight, runAgentPreflight } from "./preflight";
import { resolveAgentEconomics } from "./authorization";
import { fakeAgenticResolution, fakeAgentSpec } from "./test-support";

/**
 * The pre-spend preflight (EXECUTION CORE-4 §43).
 *
 * The property under test is that **nothing is spent until every question is
 * answered from structured state**. Each case below removes one answer and
 * asserts the refusal, because a gate is only proven by the case where it
 * fires.
 */

const ECONOMICS = resolveAgentEconomics({
  pricingClass: "standard",
  projectId: "project-1",
  at: new Date("2026-08-19T00:00:00.000Z"),
  env: { VIBE_INTERNAL_AGENT_DOGFOOD_PROJECT_IDS: "project-1" },
});

function preflight(overrides: Partial<Parameters<typeof runAgentPreflight>[0]> = {}) {
  return runAgentPreflight({
    resolution: overrides.resolution ?? fakeAgenticResolution(),
    spec: overrides.spec ?? fakeAgentSpec(),
    economics: overrides.economics === undefined ? ECONOMICS : overrides.economics,
  });
}

describe("the happy path", () => {
  it("passes for a resolved, admissible, funded, validatable agentic step", () => {
    const result = preflight();

    expect(result.passed).toBe(true);
    expect(result.refusals).toEqual([]);
  });

  it("answers every question §43 asks", () => {
    const result = preflight();

    // Why agentic rather than deterministic: no registry capability matched.
    expect(result.route.mode).toBe("agentic");
    expect(result.route.deterministicCapability).toBeNull();

    // Why risk ≤ moderate.
    expect(result.route.riskClass).toBe("moderate");

    // Why existing validation can prove it.
    expect(result.validation).toMatchObject({ supported: true, profile: "nextjs_node_v1" });

    // What the agent may do, and what it may never do.
    expect(result.authority.allowedCapabilities).toContain("workspace_write_file");
    expect(result.authority.forbiddenCapabilities).toContain("git_push_branch");
    expect(result.authority.network).toBe("none");
    expect(result.authority.secrets).toBe("unavailable");

    // Expected file/diff scope and the maximum dogfood budget.
    expect(result.limits?.maxChangedFiles).toBeGreaterThan(0);
    expect(result.limits?.maxProviderSpendUsd).toBeGreaterThan(0);

    // What "Done" means.
    expect(result.doneWhen.length).toBeGreaterThan(0);
  });

  it("renders a report that states the production pricing status plainly", () => {
    const rendered = renderAgentPreflight(preflight());

    expect(rendered).toContain("PREFLIGHT: PASS");
    expect(rendered).toContain("production price     NOT ACTIVATED");
    expect(rendered).toContain("network              none");
  });
});

describe("every gate refuses", () => {
  it("refuses a step that did not resolve to an agentic route", () => {
    const result = preflight({
      resolution: fakeAgenticResolution({ mode: "unsupported", reason: "change_kind_not_executable" }),
      spec: fakeAgentSpec(),
      economics: ECONOMICS,
    });

    expect(result.passed).toBe(false);
    expect(result.refusals).toContain("not_agentic");
  });

  it("refuses a step that is classified but not admissible", () => {
    const result = preflight({
      resolution: fakeAgenticResolution({
        admission: { admissible: false, refusal: "repository_head_moved" },
      }),
      spec: fakeAgentSpec(),
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("not_admissible");
  });

  it("refuses anything above the V1 risk ceiling", () => {
    for (const riskClass of ["high", "prohibited"] as const) {
      const result = preflight({
        resolution: fakeAgenticResolution({ riskClass }),
        spec: fakeAgentSpec(),
        economics: ECONOMICS,
      });
      expect(result.refusals, riskClass).toContain("risk_too_high");
    }
  });

  it("refuses when a founder decision is still missing (§26)", () => {
    const result = preflight({
      resolution: fakeAgenticResolution({ requiresUserInput: true }),
      spec: fakeAgentSpec(),
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("user_decision_missing");
  });

  /**
   * The most important refusal in the file.
   *
   * §31 forbids accepting the agent's own claim instead of an independent
   * verdict. A repository with no validation profile has no independent verdict
   * available, so there is no honest way to let an agent produce a change for
   * it — whatever else is in order.
   */
  it("refuses when nothing could independently prove the result", () => {
    const result = preflight({
      resolution: fakeAgenticResolution(),
      spec: fakeAgentSpec({
        validation: {
          supported: false,
          authority: "vibe_observed",
          preconditions: [],
          reason: "validation_not_supported",
        },
      }),
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("validation_unsupported");
    expect(result.validation).toEqual({ supported: false, reason: "validation_not_supported" });
  });

  it("refuses when no economics authorize the project (§18)", () => {
    const result = preflight({
      resolution: fakeAgenticResolution(),
      spec: fakeAgentSpec(),
      economics: null,
    });

    expect(result.refusals).toContain("not_authorized");
    expect(result.economics.authorized).toBe(false);
  });

  it("refuses a spec with no budget", () => {
    const result = preflight({
      resolution: fakeAgenticResolution(),
      spec: fakeAgentSpec({ budget: null }),
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("no_budget");
    expect(result.limits).toBeNull();
  });

  it("refuses when the budget and the write scope disagree", () => {
    const spec = fakeAgentSpec();
    const result = preflight({
      resolution: fakeAgenticResolution(),
      spec: {
        ...spec,
        budget: { ...spec.budget!, maxChangedFiles: 999 },
      },
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("budget_scope_mismatch");
  });

  it("refuses a policy that grants nothing", () => {
    const spec = fakeAgentSpec();
    const result = preflight({
      resolution: fakeAgenticResolution(),
      spec: {
        ...spec,
        policy: compileExecutionPolicy({
          // A deterministic mode compiles an empty grant list.
          mode: "deterministic",
          executionClass: null,
          riskClass: "moderate",
          writeScope: spec.policy.writeScope,
        }),
      },
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("no_tool_grants");
  });

  /**
   * A policy read back from a database has not been through the compiler that
   * subtracts the forbidden set. This is the last check before money is spent,
   * and it is the one that catches a hand-edited or corrupted stored policy.
   */
  it("refuses a stored policy that somehow grants a forbidden capability", () => {
    const spec = fakeAgentSpec();
    const result = preflight({
      resolution: fakeAgenticResolution(),
      spec: {
        ...spec,
        policy: {
          ...spec.policy,
          allowedCapabilities: [...spec.policy.allowedCapabilities, "git_push_branch"],
        },
      },
      economics: ECONOMICS,
    });

    expect(result.refusals).toContain("forbidden_grant");
  });

  it("reports every refusal at once rather than the first", () => {
    const result = preflight({
      resolution: fakeAgenticResolution({
        mode: "unsupported",
        riskClass: "high",
        admission: { admissible: false, refusal: "agentic_pricing_not_configured" },
      }),
      spec: fakeAgentSpec({ budget: null }),
      economics: null,
    });

    expect(result.refusals).toEqual(
      expect.arrayContaining([
        "not_agentic",
        "not_admissible",
        "risk_too_high",
        "not_authorized",
        "no_budget",
      ]),
    );
  });
});
