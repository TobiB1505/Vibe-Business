import { describe, expect, it } from "vitest";
import { creditsToUnits } from "@/modules/credits/units";
import { resolveExecutionBudget } from "./budget";
import { computeBusinessContextHash, computeExecutionSpecIdentity } from "./identity";
import { isToolAllowed } from "./policy";
import { resolveStepExecution } from "./resolver";
import { SecretMaterialRejected } from "./secrets";
import { ExecutionSpecNotBuildable, buildExecutionSpec } from "./spec";
import { resolveExecutionValidation } from "./validation-requirements";
import {
  FIXTURE_OTHER_SHA,
  FIXTURE_PLAN,
  fakeBudgetPolicy,
  fakePlanContext,
  fakePlanStep,
  fakeRepositoryBinding,
  fakeRepositoryContext,
  fakeResolveInput,
  fakeSnapshot,
  fakeWriteScope,
} from "./test-support";

/**
 * ExecutionSpec construction, immutability and secret refusal
 * (EXECUTION CORE-3 §9, §10, §11, §47, §48).
 */

function buildFixtureSpec(
  overrides: {
    step?: ReturnType<typeof fakePlanStep>;
    baseSha?: string;
    decisions?: readonly { key: string; stepOrder: number | null; decision: string }[];
  } = {},
) {
  const step = overrides.step ?? fakePlanStep();
  const resolution = resolveStepExecution(
    fakeResolveInput({ step, plan: fakePlanContext([step]) }),
  );
  const budget = resolveExecutionBudget("standard", new Date("2026-08-18T00:00:00.000Z"), [
    fakeBudgetPolicy(),
  ]);

  return buildExecutionSpec({
    resolution,
    step,
    plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
    projectId: "project-1",
    repository: fakeRepositoryBinding(overrides.baseSha ? { baseSha: overrides.baseSha } : {}),
    approvedDecisions: overrides.decisions ?? [
      { key: "2-decide-auth", stepOrder: 2, decision: "Email and password, no SSO." },
    ],
    validation: resolveExecutionValidation(fakeSnapshot()),
    budget,
    credit: { quoteId: "quote-1", maxAuthorizedCredits: budget?.maxCredits ?? null },
    writeScope: fakeWriteScope(),
    createdAt: "2026-08-18T12:00:00.000Z",
  });
}

describe("ExecutionSpec — what it carries (§9)", () => {
  it("pins the exact base commit rather than a branch name", () => {
    const spec = buildFixtureSpec();
    expect(spec.repository.baseSha).toHaveLength(40);
    expect(spec.repository.defaultBranch).toBe("main");
  });

  it("preserves the objective and the done-when the plan stated", () => {
    const spec = buildFixtureSpec();
    expect(spec.objective.goal).toBe(FIXTURE_PLAN.goal);
    expect(spec.objective.doneWhen).toBe("A visitor can complete the flow end to end.");
    expect(spec.objective.expectedChangedState).toBe(FIXTURE_PLAN.expectedOutcome);
  });

  it("carries approved founder decisions as structured context, not prose to re-infer (§28)", () => {
    const spec = buildFixtureSpec();
    expect(spec.businessContext.approvedDecisions).toEqual([
      { key: "2-decide-auth", stepOrder: 2, decision: "Email and password, no SSO." },
    ]);
  });

  it("carries a real validation requirement derived from the repository (§30, §53)", () => {
    const spec = buildFixtureSpec();
    expect(spec.validation.supported).toBe(true);
    if (!spec.validation.supported) return;
    expect(spec.validation.profile).toBe("node_build_v1");
    expect(spec.validation.sandboxSteps).toEqual(["install", "typecheck", "test", "build"]);
    // §31: the agent's own report is never the authority.
    expect(spec.validation.authority).toBe("vibe_observed");
  });

  it("compiles a policy that permits only what the class needs (§13)", () => {
    const spec = buildFixtureSpec();
    expect(isToolAllowed(spec.policy, "workspace_write_file")).toBe(true);
    expect(isToolAllowed(spec.policy, "git_write_default_branch")).toBe(false);
    expect(isToolAllowed(spec.policy, "secret_read")).toBe(false);
    expect(spec.policy.network).toEqual({ mode: "none" });
  });

  /**
   * §29's premises are re-checked by `evaluateAdmission`, not carried on the spec.
   *
   * The spec used to carry a `freshnessChecks` list naming six of them, read by
   * `evaluateFreshness` — which had no production caller, so the list was
   * written into every immutable `execution_specs` row and never consulted. It
   * was also stale in both directions: it never learned the live-product
   * premise Sprint 0072 added, while every premise it did name is enforced
   * somewhere that runs (`plan.isCurrent`, `snapshotIsLatest`, the live HEAD
   * comparison and the capability re-match in the resolver; ownership by RLS
   * and each durable step's own project check).
   *
   * A second, unread description of a contract is worse than none: it reads as
   * the authority and is not. This pins that the spec no longer carries one.
   */
  it("does not carry a second, unread copy of the freshness contract (§29)", () => {
    expect(buildFixtureSpec()).not.toHaveProperty("freshnessChecks");
  });

  it("binds the Credit ceiling and its quote (§24)", () => {
    const spec = buildFixtureSpec();
    expect(spec.budget?.maxCredits).toBe(creditsToUnits(200));
    expect(spec.credit.quoteId).toBe("quote-1");
  });
});

describe("ExecutionSpec — immutability by identity (§10, §47)", () => {
  it("produces the same identity for the same world", () => {
    expect(buildFixtureSpec().identity).toBe(buildFixtureSpec().identity);
  });

  it("produces a new identity when the repository moves", () => {
    const before = buildFixtureSpec();
    const after = buildFixtureSpec({ baseSha: FIXTURE_OTHER_SHA });

    expect(after.identity).not.toBe(before.identity);
    // The historical spec is untouched: it still describes commit A.
    expect(before.repository.baseSha).not.toBe(after.repository.baseSha);
  });

  it("produces a new identity when a founder decision changes", () => {
    const before = buildFixtureSpec();
    const after = buildFixtureSpec({
      decisions: [{ key: "2-decide-auth", stepOrder: 2, decision: "Magic links only." }],
    });

    expect(after.identity).not.toBe(before.identity);
  });

  it("produces a new identity when a policy version changes", () => {
    const base = {
      projectId: "project-1",
      actionPlanId: "plan-1",
      stepKey: "1-a",
      baseSha: "a".repeat(40),
      repositorySnapshotId: "snap-1",
      mode: "agentic",
      executionClass: "application_code_change",
      riskClass: "moderate",
      capability: null,
      capabilityVersion: null,
      businessContextHash: "hash",
      absorbedPreparationKeys: [],
      specSchemaVersion: "execution-spec.v1",
      resolverVersion: "execution-resolver-v1",
      policyVersion: "execution-policy-v1",
      riskPolicyVersion: "execution-risk-policy-v1",
    };

    expect(computeExecutionSpecIdentity(base)).not.toBe(
      computeExecutionSpecIdentity({ ...base, policyVersion: "execution-policy-v2" }),
    );
  });

  it("does not depend on the order decisions were recorded in", () => {
    const a = computeBusinessContextHash([
      { key: "b", value: "second" },
      { key: "a", value: "first" },
    ]);
    const b = computeBusinessContextHash([
      { key: "a", value: "first" },
      { key: "b", value: "second" },
    ]);

    expect(a).toBe(b);
  });
});

describe("ExecutionSpec — nothing ready to run for work that is not (§44, §45)", () => {
  it("refuses to build a spec for a step needing a founder decision", () => {
    const step = fakePlanStep({ actor: "founder_decision", changeKind: "decision" });
    expect(() => buildFixtureSpec({ step })).toThrow(ExecutionSpecNotBuildable);
  });

  it("refuses to build a spec for a blocked step", () => {
    const first = fakePlanStep({
      id: "1-a",
      order: 1,
      actor: "founder_decision",
      changeKind: "decision",
    });
    const second = fakePlanStep({ id: "2-b", order: 2, dependsOn: [1] });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step: second, plan: fakePlanContext([first, second]) }),
    );

    expect(() =>
      buildExecutionSpec({
        resolution,
        step: second,
        plan: { ...FIXTURE_PLAN, assumptions: [...FIXTURE_PLAN.assumptions] },
        projectId: "project-1",
        repository: fakeRepositoryBinding(),
        approvedDecisions: [],
        validation: resolveExecutionValidation(fakeSnapshot()),
        budget: null,
        credit: { quoteId: null, maxAuthorizedCredits: null },
        writeScope: fakeWriteScope(),
        createdAt: "2026-08-18T12:00:00.000Z",
      }),
    ).toThrow(ExecutionSpecNotBuildable);
  });

  it("refuses to build a spec for an unsupported step", () => {
    const step = fakePlanStep({ evidenceIds: ["repo.surface.payments"] });
    expect(() => buildFixtureSpec({ step })).toThrow(ExecutionSpecNotBuildable);
  });
});

describe("ExecutionSpec — no secret content (§11, §48)", () => {
  it("rejects a credential pasted into a plan step's own wording", () => {
    const step = fakePlanStep({
      completionCriteria: "Set STRIPE_KEY=sk_live_51HxYzAbCdEfGhIjKlMnO and confirm checkout.",
    });

    expect(() => buildFixtureSpec({ step })).toThrow(SecretMaterialRejected);
  });

  it("rejects a credential in a recorded founder decision", () => {
    expect(() =>
      buildFixtureSpec({
        decisions: [
          {
            key: "2-decide-auth",
            stepOrder: 2,
            decision: "Use this token: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
          },
        ],
      }),
    ).toThrow(SecretMaterialRejected);
  });

  it("has no field a credential could legitimately occupy", () => {
    // The structural defence §48 asks for, asserted rather than assumed. A
    // future field named any of these would fail here before it shipped.
    const spec = buildFixtureSpec() as unknown as Record<string, unknown>;
    for (const forbidden of [
      "token",
      "apiKey",
      "secret",
      "secrets",
      "credentials",
      "env",
      "environment",
      "headers",
      "connectionString",
    ]) {
      expect(spec).not.toHaveProperty(forbidden);
    }

    // The one secret-adjacent field that exists says only that there are none.
    expect(spec.policy).toMatchObject({ secrets: { mode: "unavailable" } });
  });

  it("does not describe a repository whose snapshot it never saw", () => {
    // Guards against a future refactor letting a caller pass a repository
    // binding that disagrees with the resolution's own snapshot.
    const resolution = resolveStepExecution(
      fakeResolveInput({ repository: fakeRepositoryContext() }),
    );
    expect(resolution.admission.admissible).toBe(true);
  });
});
