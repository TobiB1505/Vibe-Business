import { describe, expect, it } from "vitest";
import type { ChangeProgress, ChangeStage } from "@/modules/execution/change-progress";
import type { TimelineStep } from "./timeline";
import {
  AGENT_STAGES,
  agentCoreCaption,
  agentCoreState,
  agentStageSteps,
  type AgentStage,
  type AgentStageState,
} from "./agent-stages";

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
    /*
     * No detail. The state word already says "Never reached", and the live rail
     * rendered "Never reached · Never reached" until this was fixed.
     */
    expect(steps.find((step) => step.stage === "review")!.detail).toBeNull();
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
    // Said once, by the state word, for the same reason.
    expect(steps.find((step) => step.stage === "preview")!.detail).toBeNull();
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

describe("the core state follows the stages", () => {
  const steps = (states: AgentStageState[]) =>
    AGENT_STAGES.map((stage, index) => ({
      stage,
      label: stage,
      state: states[index]!,
      detail: null,
    }));

  it("is idle only when nothing at all has happened", () => {
    expect(agentCoreState(steps(["pending", "pending", "pending", "pending", "pending"]))).toBe(
      "idle",
    );
  });

  it("works while any stage is active", () => {
    expect(agentCoreState(steps(["done", "active", "pending", "pending", "pending"]))).toBe(
      "working",
    );
  });

  /**
   * The one worth naming. A core that kept breathing over a failed run is the
   * animated version of a status line narrating work nobody is doing.
   */
  it("settles rather than working when a run failed", () => {
    expect(agentCoreState(steps(["done", "failed", "skipped", "skipped", "skipped"]))).toBe(
      "settled",
    );
  });

  it("settles when everything is behind the change", () => {
    expect(agentCoreState(steps(["done", "done", "done", "done", "done"]))).toBe("settled");
  });
});

describe("the caption never promises what nobody measured", () => {
  const from = (input: Parameters<typeof agentStageSteps>[0]) => agentCoreCaption(agentStageSteps(input));

  it("names the stage that is running", () => {
    expect(
      from({
        timeline: timeline({ preparing: "done", working: "active" }),
        runStatus: "running",
        changeProgress: null,
      }),
    ).toMatch(/making the change/i);
  });

  it("says nothing was applied when a run stopped", () => {
    expect(
      from({
        timeline: timeline({ preparing: "done", working: "failed" }),
        runStatus: "failed",
        changeProgress: null,
      }),
    ).toMatch(/nothing was applied/i);
  });

  it("offers to start when nothing has ever run", () => {
    expect(from({ timeline: null, runStatus: null, changeProgress: null })).toMatch(/ready to work/i);
  });

  /** The whole point: no duration, no fraction, no "almost". */
  it("never estimates", () => {
    const inputs: Parameters<typeof agentStageSteps>[0][] = [
      { timeline: null, runStatus: null, changeProgress: null },
      { timeline: timeline({ preparing: "active" }), runStatus: "running", changeProgress: null },
      {
        timeline: timeline({ preparing: "done", working: "done", validating: "done" }),
        runStatus: "completed",
        changeProgress: progress("awaiting_approval"),
      },
      {
        timeline: timeline({ preparing: "done", working: "failed" }),
        runStatus: "failed",
        changeProgress: null,
      },
    ];

    for (const input of inputs) {
      expect(from(input)).not.toMatch(/almost|soon|minute|hour|%|nearly|shortly/i);
    }
  });
});

/**
 * Waiting on a person is not working (UI-19, found by importing the design).
 *
 * The reference set has an artboard the earlier plan missed: the run stops and
 * asks a question, everything mint turns amber, and the orb holds. `needs_user`
 * is a real operation status, and without a state of its own the stage it
 * stopped on kept reporting progress — a stepper narrating work nobody was
 * doing, which is the exact failure this file exists to prevent elsewhere.
 */
describe("a run waiting on the founder", () => {
  const paused = () =>
    agentStageSteps({
      timeline: timeline({ preparing: "done", working: "active" }),
      runStatus: "needs_user",
      changeProgress: null,
    });

  it("pauses the stage it stopped on instead of running it", () => {
    expect(stateOf(paused(), "build")).toBe("paused");
    expect(stateOf(paused(), "understand")).toBe("done");
  });

  it("does not treat the pause as failure — later stages can still happen", () => {
    expect(stateOf(paused(), "validate")).toBe("pending");
    expect(stateOf(paused(), "preview")).toBe("pending");
  });

  it("holds the core rather than breathing or settling", () => {
    expect(agentCoreState(paused())).toBe("waiting");
  });

  it("says an answer is what restarts it", () => {
    const caption = agentCoreCaption(paused());
    expect(caption).toMatch(/ask/i);
    expect(caption).toMatch(/answer/i);
    /*
     * And does not promise a resume. A paused attempt is never continued —
     * resolution cancels it and a fresh attempt is admitted with its own hold,
     * so "answering starts the run again" was a false promise.
     */
    expect(caption).not.toMatch(/again|resume|continue/i);
    // And still promises no duration.
    expect(caption).not.toMatch(/almost|soon|minute|hour|%/i);
  });

  it("keeps the stage's own wording and says what it is waiting for", () => {
    const build = paused().find((step) => step.stage === "build")!;
    expect(build.label).toMatch(/making the change/i);
    // No detail of its own: the rail's state word already says it, and one
    // line saying "Waiting for you · Waiting for your answer" is the
    // redundancy this product keeps taking back out.
    expect(build.detail).toBeNull();
  });
});

/**
 * The contradiction the first live screen showed (UI-19).
 *
 * "Check that it works — never reached" sat beside a change whose safety checks
 * had all passed, with stage four already in progress. A stepper that says a
 * stage was never reached while the stage after it is running is not reporting;
 * it is contradicting itself.
 *
 * The cause: the run's own `validating` phase fires only when the harness
 * validated in-run, and validation of the *prepared change* is a separate
 * operation. The change's verdict is the stronger source.
 */
describe("validation has two sources and the change's wins", () => {
  const runWithoutInRunValidation = () =>
    timeline({ preparing: "done", working: "done", finished: "done" });

  it("never says a stage was skipped while a later one is running", () => {
    const steps = agentStageSteps({
      timeline: runWithoutInRunValidation(),
      runStatus: "completed",
      changeProgress: progress("review_required"),
    });

    expect(stateOf(steps, "validate")).toBe("done");
    expect(stateOf(steps, "preview")).toBe("active");

    // The invariant, stated directly: nothing behind an active stage is skipped.
    const order = AGENT_STAGES.map((stage) => stateOf(steps, stage));
    const active = order.indexOf("active");
    expect(order.slice(0, active)).not.toContain("skipped");
  });

  it("shows validation running while the change is being checked", () => {
    const steps = agentStageSteps({
      timeline: runWithoutInRunValidation(),
      runStatus: "completed",
      changeProgress: progress("validating"),
    });

    expect(stateOf(steps, "validate")).toBe("active");
    expect(stateOf(steps, "preview")).toBe("pending");
  });

  it("fails the stage when the change's checks failed", () => {
    const steps = agentStageSteps({
      timeline: runWithoutInRunValidation(),
      runStatus: "completed",
      changeProgress: progress("validation_failed"),
    });

    expect(stateOf(steps, "validate")).toBe("failed");
    expect(stateOf(steps, "preview")).toBe("skipped");
  });

  /** A failed in-run check is not overwritten by a later passing verdict. */
  it("keeps a failed run phase failed", () => {
    const steps = agentStageSteps({
      timeline: timeline({ preparing: "done", working: "done", reviewing_change: "failed" }),
      runStatus: "failed",
      changeProgress: progress("review_required"),
    });

    expect(stateOf(steps, "validate")).toBe("failed");
  });
});
