import { describe, expect, it } from "vitest";
import type { ChangeStage } from "./change-progress";
import { CHANGE_STEPS, deriveChangeSteps, type ChangeStepId } from "./change-steps";

/**
 * Which of a prepared change's four gates it is on (UI-8 §2).
 *
 * All twelve `ChangeStage` values are named individually below rather than
 * generated, because the failure this guards against is one value silently
 * landing in the wrong box — and a table built from the same mapping the code
 * uses would agree with the bug.
 */

/** The id of the one step that is neither done nor pending. */
function current(stage: ChangeStage): ChangeStepId | null {
  return (
    deriveChangeSteps(stage).find((step) => step.state === "active" || step.state === "blocked")
      ?.id ?? null
  );
}

describe("which gate a change is on", () => {
  it.each<[ChangeStage, ChangeStepId]>([
    ["not_validated", "validation"],
    ["validating", "validation"],
    ["validation_failed", "validation"],
    ["reviewing", "review"],
    ["review_required", "review"],
    ["review_unavailable", "review"],
    ["awaiting_approval", "approval"],
    ["ready_to_merge", "merge"],
    ["merging", "merge"],
    ["stalled", "merge"],
  ])("puts %s on the %s step", (stage, expected) => {
    expect(current(stage)).toBe(expected);
  });

  it.each<ChangeStage>(["merged", "observed"])("shows every step done for %s", (stage) => {
    const steps = deriveChangeSteps(stage);

    expect(current(stage)).toBeNull();
    expect(steps.every((step) => step.state === "done")).toBe(true);
  });

  it("renders the four gates in order", () => {
    expect(deriveChangeSteps("awaiting_approval").map((step) => step.id)).toEqual([
      "validation",
      "review",
      "approval",
      "merge",
    ]);
  });

  it("marks everything before the current step done", () => {
    const steps = deriveChangeSteps("awaiting_approval");

    expect(steps[0]).toMatchObject({ id: "validation", state: "done" });
    expect(steps[1]).toMatchObject({ id: "review", state: "done" });
    expect(steps[3]).toMatchObject({ id: "merge", state: "pending" });
  });
});

describe("blocking", () => {
  it.each<[ChangeStage, ChangeStepId]>([
    ["validation_failed", "validation"],
    ["review_unavailable", "review"],
    ["stalled", "merge"],
  ])("marks %s as blocked on the %s step", (stage, id) => {
    const step = deriveChangeSteps(stage).find((entry) => entry.id === id);

    expect(step?.state).toBe("blocked");
  });

  /*
   * Both of these are the founder's move. Marking them as trouble would tell
   * somebody their change is broken when it is simply waiting for them to look
   * at it — the same distinction `STALLING_MERGE_FAILURES` draws one gate later
   * between "it is your turn" and "this cannot go in".
   */
  it.each<ChangeStage>(["review_required", "awaiting_approval"])(
    "does not treat %s as blocked",
    (stage) => {
      expect(deriveChangeSteps(stage).some((step) => step.state === "blocked")).toBe(false);
    },
  );

  it("never blocks a gate the change has not reached", () => {
    const steps = deriveChangeSteps("validation_failed");

    for (const step of steps.slice(1)) {
      expect(step.state).toBe("pending");
    }
  });

  it("exposes exactly one live step for every stage", () => {
    const stages: ChangeStage[] = [
      "not_validated",
      "validating",
      "validation_failed",
      "reviewing",
      "review_required",
      "review_unavailable",
      "awaiting_approval",
      "ready_to_merge",
      "merging",
      "stalled",
    ];

    for (const stage of stages) {
      const live = deriveChangeSteps(stage).filter(
        (step) => step.state === "active" || step.state === "blocked",
      );
      expect(live, stage).toHaveLength(1);
    }
  });
});

/*
 * The rail must not grow a preview step. `reviewGate` folds a preview in flight
 * into `reviewing` because a preview never gates a change — a fifth step would
 * show "pending" forever on changes that legitimately skipped it, which reads
 * as unfinished business that does not exist.
 */
describe("the shape of the rail", () => {
  it("has four gates, and preview is not one of them", () => {
    expect(CHANGE_STEPS).toHaveLength(4);
    expect(CHANGE_STEPS.map((step) => step.id)).not.toContain("preview");
  });
});
