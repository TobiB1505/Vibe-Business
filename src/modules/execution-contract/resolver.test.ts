import { describe, expect, it } from "vitest";
import { resolvePlanExecution, resolveStepExecution } from "./resolver";
import { isAgentReady, isDeterministicReady } from "./schema";
import {
  FIXTURE_OTHER_SHA,
  fakePlanContext,
  fakePlanStep,
  fakeRepositoryContext,
  fakeResolveInput,
  fakeSnapshot,
} from "./test-support";

/**
 * Resolver behaviour (EXECUTION CORE-3 §41–§46, §52).
 *
 * Every test here changes exactly one thing about a fixture that would
 * otherwise resolve `agentic` and admissible, and asserts the refusal.
 */

describe("execution resolver — the Planner is not the authority (§6, §41)", () => {
  it("does not return an executable mode merely because the Planner said Vibe executes now", () => {
    // A plan step carrying the strongest possible Planner claim: Vibe executes
    // it now, with a named capability. The registry, asked afresh, disagrees —
    // this project is not Next.js and cites no SEO evidence.
    const step = fakePlanStep({
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v2",
      evidenceIds: [],
      changeKind: "product_change",
    });

    const resolution = resolveStepExecution(
      fakeResolveInput({
        step,
        plan: fakePlanContext([step]),
        repository: fakeRepositoryContext({
          snapshot: fakeSnapshot({ frameworks: [{ id: "django", name: "Django" }] }),
        }),
      }),
    );

    expect(resolution.mode).not.toBe("deterministic");
    expect(resolution.capability).toBeNull();
    expect(isDeterministicReady(resolution)).toBe(false);
  });

  it("ignores a Planner capability that the current registry does not re-derive", () => {
    // The registry needs both robots *and* sitemap evidence plus Next.js. This
    // step cites neither, so no amount of stored classification produces one.
    const step = fakePlanStep({
      executionSupport: "vibe_executes_now",
      capability: "nextjs_seo_foundations_v1",
      evidenceIds: ["live.surface.dashboard_app"],
    });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.capability).toBeNull();
    expect(resolution.capabilityVersion).toBeNull();
  });

  it("resolves work the Planner called unsupported, when a capability genuinely matches", () => {
    // The mirror image: the plan says `not_yet_supported`, and the resolver
    // says otherwise because the registry actually matches. Authority runs in
    // both directions or it is not authority.
    const step = fakePlanStep({
      executionSupport: "not_yet_supported",
      capability: null,
      changeKind: "product_change",
      evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
    });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.mode).toBe("deterministic");
    expect(resolution.capability).toBe("nextjs_seo_foundations_v2");
  });
});

describe("execution resolver — deterministic is preferred (§7, §42)", () => {
  it("chooses the existing capability over an agentic route when both would apply", () => {
    // This step is a moderate-risk product change — the agentic shape — *and*
    // matches the registry. Deterministic must win: cheaper, predictable,
    // already validated, no model variance.
    const step = fakePlanStep({
      changeKind: "product_change",
      evidenceIds: ["live.seo.robots_txt_missing", "live.seo.sitemap_missing"],
    });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.mode).toBe("deterministic");
    expect(resolution.reason).toBe("deterministic_capability_matched");
    expect(resolution.executionClass).toBeNull();
    expect(isDeterministicReady(resolution)).toBe(true);
  });
});

describe("execution resolver — agentic fallback (§20, §43)", () => {
  it("returns agentic when no capability matches and every gate is satisfied", () => {
    const resolution = resolveStepExecution(fakeResolveInput());

    expect(resolution.mode).toBe("agentic");
    expect(resolution.reason).toBe("agentic_v1_eligible");
    expect(resolution.executionClass).toBe("application_code_change");
    expect(resolution.riskClass).toBe("moderate");
    expect(isAgentReady(resolution)).toBe(true);
  });

  it("refuses agentic admission while no Credit budget policy authorizes it", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({ agenticBudgetAuthorized: false }),
    );

    // Still classified agentic — the work is the shape an agent could do. It
    // simply may not start, which is a different sentence (§24).
    expect(resolution.mode).toBe("agentic");
    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "agentic_pricing_not_configured",
    });
    expect(isAgentReady(resolution)).toBe(false);
  });

  it("refuses agentic when the repository has no validation profile (§30, §53)", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({
        repository: fakeRepositoryContext({
          snapshot: fakeSnapshot({ frameworks: [{ id: "fastapi", name: "FastAPI" }] }),
        }),
      }),
    );

    expect(resolution.mode).toBe("unsupported");
    expect(resolution.unmetRequirements).toContain("validation_profile_unsupported");
  });

  it("refuses agentic when no repository is connected", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({ repository: fakeRepositoryContext({ connection: null }) }),
    );

    expect(resolution.mode).toBe("unsupported");
    expect(resolution.unmetRequirements).toContain("repository_not_connected");
  });

  it("refuses agentic when Vibe has never read the repository", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({
        repository: fakeRepositoryContext({ snapshot: null, snapshotCommitSha: null }),
      }),
    );

    expect(resolution.mode).toBe("unsupported");
    expect(resolution.unmetRequirements).toContain("repository_snapshot_missing");
  });
});

describe("execution resolver — missing user input (§28, §44)", () => {
  it("returns needs_user_input for a founder decision, with no admission", () => {
    const step = fakePlanStep({ actor: "founder_decision", changeKind: "decision" });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.mode).toBe("needs_user_input");
    expect(resolution.requiresUserInput).toBe(true);
    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "not_executable_mode",
    });
    expect(isAgentReady(resolution)).toBe(false);
  });

  it("returns manual for founder action rather than pretending it is blocked", () => {
    const step = fakePlanStep({ actor: "founder_action", changeKind: "measurement" });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.mode).toBe("manual");
    expect(resolution.reason).toBe("founder_action_required");
  });

  it("returns blocked for an external party, and never calls it a Vibe failure", () => {
    const step = fakePlanStep({ actor: "external_party", changeKind: "external_setup" });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.mode).toBe("blocked");
    expect(resolution.reason).toBe("external_party_required");
  });
});

describe("execution resolver — dependency block (§27, §45)", () => {
  it("blocks a step whose prerequisite is unfinished, however eligible it is", () => {
    const first = fakePlanStep({ id: "1-decide", order: 1, actor: "founder_decision", changeKind: "decision" });
    const second = fakePlanStep({ id: "2-build", order: 2, dependsOn: [1] });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step: second, plan: fakePlanContext([first, second]) }),
    );

    expect(resolution.mode).toBe("blocked");
    expect(resolution.reason).toBe("dependency_unsatisfied");
    expect(resolution.blockedBy).toEqual([1]);
    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "not_executable_mode",
    });
    expect(isAgentReady(resolution)).toBe(false);
  });

  it("still reports what the step would have resolved to, without admitting it", () => {
    const first = fakePlanStep({ id: "1-decide", order: 1, actor: "founder_decision", changeKind: "decision" });
    const second = fakePlanStep({ id: "2-build", order: 2, dependsOn: [1] });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step: second, plan: fakePlanContext([first, second]) }),
    );

    // The forecast is useful — "yes, once you decide" — and it is never
    // permission: the mode, not the forecast, is what `isAgentReady` reads.
    expect(resolution.intrinsicMode).toBe("agentic");
    expect(resolution.mode).toBe("blocked");
  });

  it("unblocks once the prerequisite is recorded as finished", () => {
    const first = fakePlanStep({ id: "1-decide", order: 1, actor: "founder_decision", changeKind: "decision" });
    const second = fakePlanStep({ id: "2-build", order: 2, dependsOn: [1] });

    const resolution = resolveStepExecution(
      fakeResolveInput({
        step: second,
        plan: fakePlanContext([first, second], { completedSteps: new Set([1]) }),
      }),
    );

    expect(resolution.mode).toBe("agentic");
    expect(resolution.blockedBy).toEqual([]);
  });
});

describe("execution resolver — risk (§19, §46)", () => {
  it("refuses a payments-adjacent step outright rather than calling it agentic", () => {
    const step = fakePlanStep({ evidenceIds: ["repo.surface.payments"] });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.riskClass).toBe("prohibited");
    expect(resolution.mode).toBe("unsupported");
    expect(resolution.reason).toBe("risk_class_prohibited");
  });

  it("refuses an authentication step as beyond the V1 ceiling", () => {
    const step = fakePlanStep({ evidenceIds: ["repo.surface.authentication"] });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.riskClass).toBe("high");
    expect(resolution.mode).toBe("unsupported");
    expect(resolution.unmetRequirements).toContain("risk_class_not_permitted");
  });

  it("refuses a prohibited step even when a deterministic capability would match", () => {
    // Financial authority is not a risk tolerance question. A capability match
    // must not smuggle it through.
    const step = fakePlanStep({
      evidenceIds: [
        "repo.surface.payments",
        "live.seo.robots_txt_missing",
        "live.seo.sitemap_missing",
      ],
    });

    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.mode).toBe("unsupported");
    expect(resolution.capability).toBeNull();
  });

  it("treats Vibe's own analysis work as low risk and unsupported, not manual", () => {
    const step = fakePlanStep({ changeKind: "analysis", evidenceIds: ["profile.audience.primary"] });
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step]) }),
    );

    expect(resolution.riskClass).toBe("low");
    expect(resolution.mode).toBe("unsupported");
    expect(resolution.reason).toBe("no_executor_for_vibe_work");
  });
});

describe("execution resolver — freshness of live state (§16, §29, §52)", () => {
  it("refuses admission when the repository has moved since the snapshot", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({
        repository: fakeRepositoryContext({
          liveHead: { defaultBranch: "main", commitSha: FIXTURE_OTHER_SHA },
        }),
      }),
    );

    expect(resolution.mode).toBe("agentic");
    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "repository_head_moved",
    });
  });

  it("treats an unread HEAD as unknown rather than unchanged", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({ repository: fakeRepositoryContext({ liveHead: null }) }),
    );

    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "source_revision_unverified",
    });
  });

  it("refuses admission when a newer snapshot exists", () => {
    const resolution = resolveStepExecution(
      fakeResolveInput({ repository: fakeRepositoryContext({ snapshotIsLatest: false }) }),
    );

    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "repository_snapshot_stale",
    });
  });

  it("refuses admission when the plan has been superseded", () => {
    const step = fakePlanStep();
    const resolution = resolveStepExecution(
      fakeResolveInput({ step, plan: fakePlanContext([step], { isCurrent: false }) }),
    );

    expect(resolution.admission).toEqual({
      admissible: false,
      refusal: "action_plan_superseded",
    });
  });
});

describe("execution resolver — determinism (§37)", () => {
  it("returns an identical result for identical input", () => {
    const input = fakeResolveInput();
    expect(resolveStepExecution(input)).toEqual(resolveStepExecution(input));
  });

  it("resolves a whole plan in step order", () => {
    const steps = [
      fakePlanStep({ id: "2-b", order: 2, dependsOn: [1] }),
      fakePlanStep({ id: "1-a", order: 1 }),
    ];

    const resolutions = resolvePlanExecution({
      plan: fakePlanContext(steps),
      repository: fakeRepositoryContext(),
      agenticBudgetAuthorized: true,
    });

    expect(resolutions.map((entry) => entry.stepOrder)).toEqual([1, 2]);
  });
});
