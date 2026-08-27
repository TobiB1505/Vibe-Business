import { describe, expect, it } from "vitest";
import type { ChangeProgress, ChangeStage } from "@/modules/execution/change-progress";
import type { TimelineStep } from "./timeline";
import { AGENT_STAGES, agentStageSteps, type AgentStage, type AgentStageState } from "./agent-stages";

/**
 * The five-stage projection (UI-19).
 *
 * The reference design shows five stages; the system has six execution phases
 * and two of the five are not execution phases at all. This file exists to keep
 * that seam honest, because a stepper is the one component that can lie
 * fluently: it looks equally confident whether or not it knows anything.
 */

const PHASES = [
  "preparing",
  "working",
  "reviewing_change",
  "preparing_branch",
  "validating",
  "finished",
] as const;

function timeline(states: Partial<Record<(typeof PHASES)[number], TimelineStep["state"]>>): TimelineStep[] {
  return PHASES.map((phase) => ({
    phase,
    label: phase,
    state: states[phase] ?? "pending",
    detail: null,
  }));
}

function progress(stage: ChangeStage): ChangeProgress {
  return {
    stage,
    headline: `Headline for ${stage}.`,
    earlySettled: false,
    approved: stage === "ready_to_merge" || stage === "merged" || stage === "observed",
    merged: stage === "merged" || stage === "observed",
  };
}

const stateOf = (steps: ReturnType<typeof agentStageSteps>, stage: AgentStage): AgentStageState =>
  steps.find((step) => step.stage === stage)!.state;

describe("nothing has happened yet", () => {
  it("reports every stage pending when no run exists", () => {
    const steps = agentStageSteps({ timeline: null, runStatus: null, changeProgress: null });

    expect(steps.map((step) => step.stage)).toEqual([...AGENT_STAGES]);
    expect(steps.every((step) => step.state === "pending")).toBe(true);
    // And says nothing measured, because nothing has been measured.
    expect(steps.every((step) => step.detail === null)).toBe(true);
  });
});

describe("stages 1 to 3 come from the run", () => {
  it("lights the stage whose phase is active", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "active" }),
      runStatus: "running",
      changeProgress: null,
    });

    expect(stateOf(steps, "understand")).toBe("done");
    expect(stateOf(steps, "build")).toBe("active");
    expect(stateOf(steps, "validate")).toBe("pending");
  });

  /**
   * Validate collapses three phases. The point of the test is the boundary:
   * two of three done is not "Checks passed".
   */
  it("holds Validate open until all three of its phases are done", () => {
    const partial = agentStageSteps({
      timeline: timeline({
        preparing: "done",
        working: "done",
        reviewing_change: "done",
        preparing_branch: "done",
        validating: "active",
      }),
      runStatus: "running",
      changeProgress: null,
    });
    expect(stateOf(partial, "validate")).toBe("active");

    const complete = agentStageSteps({
      timeline: timeline({
        preparing: "done",
        working: "done",
        reviewing_change: "done",
        preparing_branch: "done",
        validating: "done",
      }),
      runStatus: "running",
      changeProgress: null,
    });
    expect(stateOf(complete, "validate")).toBe("done");
  });

  it("lets one failed phase fail the whole stage", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", reviewing_change: "failed" }),
      runStatus: "failed",
      changeProgress: null,
    });

    expect(stateOf(steps, "validate")).toBe("failed");
  });
});

describe("a run that ended never reaches the rest", () => {
  /**
   * The rule worth having a test for. `pending` and `skipped` look the same in
   * a stepper and mean opposite things: one says keep waiting, the other says
   * this is never coming.
   */
  it("marks unreached stages skipped rather than pending after a failure", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "failed" }),
      runStatus: "failed",
      changeProgress: null,
    });

    expect(stateOf(steps, "understand")).toBe("done");
    expect(stateOf(steps, "validate")).toBe("skipped");
    expect(stateOf(steps, "preview")).toBe("skipped");
    expect(stateOf(steps, "review")).toBe("skipped");
    expect(steps.find((step) => step.stage === "review")!.detail).toBe("Never reached");
  });

  it("treats a cancelled run the same way — it also never got there", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "active" }),
      runStatus: "cancelled",
      changeProgress: null,
    });

    expect(stateOf(steps, "build")).toBe("skipped");
    expect(stateOf(steps, "preview")).toBe("skipped");
  });

  it("keeps the gates pending while a healthy run is still going", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "active" }),
      runStatus: "running",
      changeProgress: null,
    });

    expect(stateOf(steps, "preview")).toBe("pending");
    expect(stateOf(steps, "review")).toBe("pending");
  });
});

describe("stages 4 and 5 come from the prepared change", () => {
  it.each([
    ["not_validated", "pending", "pending"],
    ["validating", "pending", "pending"],
    ["reviewing", "active", "pending"],
    ["review_required", "active", "pending"],
    ["awaiting_approval", "done", "active"],
    ["ready_to_merge", "done", "active"],
    ["merging", "done", "active"],
    ["merged", "done", "done"],
    ["observed", "done", "done"],
  ] as const)("%s → preview %s, review %s", (stage, preview, review) => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", validating: "done" }),
      runStatus: "completed",
      changeProgress: progress(stage),
    });

    expect(stateOf(steps, "preview")).toBe(preview);
    expect(stateOf(steps, "review")).toBe(review);
  });

  /**
   * A preview is temporary and optional, so a change can reach review without
   * one ever existing. Parking that stage at pending forever would promise
   * something that is never coming.
   */
  it("calls a missing comparison inapplicable, not failed and not pending", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", validating: "done" }),
      runStatus: "completed",
      changeProgress: progress("review_unavailable"),
    });

    expect(stateOf(steps, "preview")).toBe("not_applicable");
    expect(steps.find((step) => step.stage === "preview")!.detail).toBe(
      "Not available for this change",
    );
  });

  it("stops both gates when validation failed, because nothing downstream can start", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", validating: "done" }),
      runStatus: "completed",
      changeProgress: progress("validation_failed"),
    });

    expect(stateOf(steps, "preview")).toBe("skipped");
    expect(stateOf(steps, "review")).toBe("skipped");
  });

  /** A stalled merge cannot advance on its own, and a spinner would say otherwise. */
  it("fails Review when the merge stalled", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", validating: "done" }),
      runStatus: "completed",
      changeProgress: progress("stalled"),
    });

    expect(stateOf(steps, "review")).toBe("failed");
  });

  /** Only a verified merge is "Merged". Approval alone is not. */
  it("does not call Review done until the change is actually merged", () => {
    const approved = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", validating: "done" }),
      runStatus: "completed",
      changeProgress: progress("ready_to_merge"),
    });

    expect(stateOf(approved, "review")).toBe("active");
    expect(approved.find((step) => step.stage === "review")!.label).not.toMatch(/merged/i);
  });
});

describe("only measured numbers appear", () => {
  it("reports counts Vibe recorded, and nothing when it recorded none", () => {
    const withCounts = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done" }),
      runStatus: "running",
      changeProgress: null,
      filesInspected: 6,
      filesChanged: 1,
    });

    expect(withCounts.find((step) => step.stage === "understand")!.detail).toBe("6 files inspected");
    // Singular, because "1 files changed" is the kind of detail that makes a
    // person stop trusting the rest of the numbers.
    expect(withCounts.find((step) => step.stage === "build")!.detail).toBe("1 file changed");

    const without = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done" }),
      runStatus: "running",
      changeProgress: null,
    });
    expect(without.find((step) => step.stage === "understand")!.detail).toBeNull();
  });

  /**
   * The reference design shows "Estimated time ~1–2 hours" and "Expected
   * changes 8–15 files". No estimator exists, which is the same reason this
   * codebase refuses progress percentages. Nothing here may produce a range.
   */
  it("never produces an estimate or a range", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "active" }),
      runStatus: "running",
      changeProgress: null,
      filesInspected: 3,
      filesChanged: 2,
    });

    for (const step of steps) {
      expect(step.detail ?? "").not.toMatch(/~|–|--|\bestimat|\bexpected\b|%/i);
    }
  });
});
