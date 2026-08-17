import { describe, expect, it } from "vitest";
import { findDependencyCycles } from "./sequence";
import {
  FAKE_PLAN_EVIDENCE_IDS,
  fakeRepositorySnapshotFor,
  fakeWirePlan,
  fakeWirePlanStep,
} from "./test-support";
import { validateActionPlanOutput } from "./validate";

/**
 * Validation of a billed plan (CORE-2b §63–§67, §79–§82).
 *
 * Findings are asserted by code rather than by message text, which is the
 * reason `PlanValidationFinding` exists: a test that matched on English would
 * break on a copy edit and pass on a semantic regression.
 */

const CONTEXT = { repository: fakeRepositorySnapshotFor() };

function validate(plan = fakeWirePlan()) {
  return validateActionPlanOutput(plan, FAKE_PLAN_EVIDENCE_IDS, CONTEXT);
}

describe("a well-formed plan", () => {
  it("passes with no findings", () => {
    const result = validate();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.findings).toEqual([]);
    expect(result.result.notes).toEqual([]);
    expect(result.result.steps).toHaveLength(4);
  });

  it("assigns contiguous orders and stable ids", () => {
    const result = validate();
    if (!result.ok) return;

    expect(result.result.steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
    for (const step of result.result.steps) expect(step.id).not.toBe("");
  });

  it("classifies every step on the server", () => {
    const result = validate();
    if (!result.ok) return;

    expect(result.result.steps.map((step) => step.executionSupport)).toEqual([
      "vibe_prepares",
      "founder_decides",
      "not_yet_supported",
      "vibe_prepares",
    ]);
  });
});

describe("rejections", () => {
  it("rejects a plan with no goal", () => {
    const result = validate(fakeWirePlan({ goal: "   " }));

    expect(result).toMatchObject({ ok: false, reason: "missing_plan_goal" });
  });

  /** §64 — a plan that cannot say how it moves the problem is a different plan. */
  it("rejects a plan that does not link to the root problem", () => {
    const result = validate(fakeWirePlan({ addressesRootProblem: "" }));

    expect(result).toMatchObject({ ok: false, reason: "missing_root_problem_link" });
  });

  it("rejects a plan whose steps are all unusable", () => {
    const result = validate(
      fakeWirePlan({ steps: [fakeWirePlanStep({ title: "", completionCriteria: "" })] }),
    );

    expect(result).toMatchObject({ ok: false, reason: "no_valid_steps" });
  });

  /** §30 — one step is not a path, and no repair makes it one. */
  it("rejects a single-step plan", () => {
    const result = validate(fakeWirePlan({ steps: [fakeWirePlanStep()] }));

    expect(result).toMatchObject({ ok: false, reason: "plan_too_thin" });
  });
});

describe("evidence", () => {
  /** Rule 45 — an unverifiable citation is never displayed as justification. */
  it("drops cited ids that are not in the pack", () => {
    const plan = fakeWirePlan();
    plan.steps[0].evidenceIds = ["profile.identity.description", "live.invented.fact"];

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.steps[0].evidenceIds).toEqual(["profile.identity.description"]);
    expect(result.result.findings).toContain("unverified_evidence_dropped");
  });

  /** §35 — a strategic decision does not need an observation behind it. */
  it("accepts a step with no evidence at all", () => {
    const result = validate();
    if (!result.ok) return;

    expect(result.result.steps[1].evidenceIds).toEqual([]);
  });
});

describe("actor validation", () => {
  /**
   * §63, §75 — the single most consequential repair in this file.
   *
   * A strategic decision assigned to Vibe is Vibe taking a decision that is not
   * ours. It is repaired rather than rejected because the step is usually right
   * and only its ownership is wrong.
   */
  it("reassigns a strategic decision handed to Vibe", () => {
    const plan = fakeWirePlan();
    plan.steps[1].actor = "vibe";

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.steps[1].actor).toBe("founder_decision");
    expect(result.result.steps[1].executionSupport).toBe("founder_decides");
    expect(result.result.findings).toContain("founder_decision_reassigned");
  });
});

describe("duplicates", () => {
  /**
   * §80 — "define audience / choose audience / finalize audience".
   *
   * Keyed on the claimed finished state rather than the title, so three names
   * for one outcome collapse while two genuinely different outcomes survive.
   */
  it("removes steps claiming the same finished state", () => {
    const plan = fakeWirePlan({
      steps: [
        fakeWirePlanStep({ order: 1, title: "Define your audience" }),
        fakeWirePlanStep({ order: 2, title: "Choose your audience" }),
        fakeWirePlanStep({ order: 3, title: "Finalize your audience" }),
        fakeWirePlanStep({
          order: 4,
          title: "Rewrite the promise",
          completionCriteria:
            "The homepage's primary promise names the chosen segment's situation in its first sentence.",
        }),
      ],
    });

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.steps).toHaveLength(2);
    expect(result.result.findings).toContain("duplicate_step_removed");
  });

  it("keeps steps whose finished states genuinely differ", () => {
    const result = validate();
    if (!result.ok) return;

    expect(result.result.findings).not.toContain("duplicate_step_removed");
  });
});

describe("plan size", () => {
  it("caps a plan at the ceiling", () => {
    const steps = Array.from({ length: 12 }, (unused, index) =>
      fakeWirePlanStep({
        order: index + 1,
        title: `Distinct step ${index + 1}`,
        completionCriteria: `Observable result number ${index + 1} exists and is written down.`,
      }),
    );

    const result = validate(fakeWirePlan({ steps }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.steps).toHaveLength(9);
    expect(result.result.findings).toContain("plan_truncated");
    expect(result.result.findings).toContain("plan_inflation");
  });
});

describe("dependencies", () => {
  it("remaps prerequisites when steps are discarded", () => {
    const plan = fakeWirePlan();
    // Discard step 1; step 2 depended on it and step 3 depended on step 2.
    plan.steps[0].title = "";

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.steps).toHaveLength(3);
    // The decision is now step 1 and its dangling prerequisite is gone.
    expect(result.result.steps[0].dependsOn).toEqual([]);
    // The rewrite still follows the decision, under its new number.
    expect(result.result.steps[1].dependsOn).toEqual([1]);
    expect(result.result.findings).toContain("dependency_removed");
  });

  /** §79 — a plan where nothing can start is repaired so something can. */
  it("breaks a dependency loop", () => {
    const plan = fakeWirePlan({
      steps: [
        fakeWirePlanStep({ order: 1, dependsOn: [2] }),
        fakeWirePlanStep({
          order: 2,
          title: "Second thing",
          completionCriteria: "A different observable result is written down and agreed.",
          dependsOn: [1],
        }),
      ],
    });

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(findDependencyCycles(result.result.steps)).toEqual([]);
    expect(result.result.findings).toContain("dependency_cycle_broken");
  });
});

describe("plan quality", () => {
  /**
   * §65, §81 — the anti-checklist validator.
   *
   * Structural rather than a phrase blacklist: each criterion below adds no
   * word its own title did not already contain, which is what makes it empty.
   */
  it("catches a consulting checklist", () => {
    const plan = fakeWirePlan({
      steps: [
        fakeWirePlanStep({
          order: 1,
          title: "Improve positioning",
          completionCriteria: "Positioning has been improved successfully.",
        }),
        fakeWirePlanStep({
          order: 2,
          title: "Improve marketing",
          completionCriteria: "Marketing is improved and complete.",
        }),
        fakeWirePlanStep({
          order: 3,
          title: "Add analytics",
          completionCriteria: "Analytics are added properly.",
        }),
      ],
    });

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.findings).toContain("vague_completion_criteria");
    expect(result.result.findings).toContain("checklist_shaped_plan");
  });

  it("does not flag a plan whose criteria say something", () => {
    const result = validate();
    if (!result.ok) return;

    expect(result.result.findings).not.toContain("vague_completion_criteria");
    expect(result.result.findings).not.toContain("checklist_shaped_plan");
  });

  /**
   * §64 — a plan of pure analysis leaves the business exactly where it was.
   *
   * A research memo is a fine thing; it is not a plan, and the finding says so
   * without discarding work that may still be useful.
   */
  it("catches a plan that decides and changes nothing", () => {
    const plan = fakeWirePlan({
      steps: [
        fakeWirePlanStep({ order: 1 }),
        fakeWirePlanStep({
          order: 2,
          title: "Compare the segments against current traction",
          completionCriteria:
            "A written comparison of each candidate segment against current usage exists.",
          changeKind: "analysis",
        }),
      ],
    });

    const result = validate(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.result.findings).toContain("no_changed_state");
  });

  it("does not flag a plan containing a decision", () => {
    const result = validate();
    if (!result.ok) return;

    expect(result.result.findings).not.toContain("no_changed_state");
  });
});
