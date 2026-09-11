import { describe, expect, it } from "vitest";
import { agentStageForChange } from "./change-stage-view";

/**
 * Which of the Agent's screens a prepared change belongs on.
 *
 * This mapping exists because the one it replaced could not answer the
 * question. Nova's ranking gives a change moment a *kind*, and
 * `review_required` and `awaiting_approval` are both `review_change` — while
 * meaning opposite things. A founder on a phone was shown the decision screen
 * for a change whose next step was starting a preview: the approval section
 * refused, naming a step that had no control anywhere on it.
 */
describe("the Agent screen a change belongs on", () => {
  /*
   * Totality is the compiler's job here, not a test's: the table is declared
   * `Record<ChangeStage, …>`, so a twelfth stage fails the build. What a test
   * can add is which screen each state lands on, and why that is the right
   * one.
   */
  /**
   * The distinction the candidate kind lost, asserted as itself.
   *
   * `reviewGate` returns `review_required` exactly when the approval is
   * blocked with `approval_preview_required` — so this is the state whose next
   * move is a preview, and it must land on the screen that starts one.
   */
  it("sends a change that still needs a preview to the preview screen", () => {
    expect(agentStageForChange("review_required")).toBe("preview");
    expect(agentStageForChange("review_unavailable")).toBe("preview");
    expect(agentStageForChange("reviewing")).toBe("preview");
  });

  it("sends a change whose evidence is ready to the decision screen", () => {
    expect(agentStageForChange("awaiting_approval")).toBe("review");
    expect(agentStageForChange("ready_to_merge")).toBe("review");
  });

  /**
   * The guarantee that used to live in `home-view.test.ts`: a change that has
   * not passed its checks is never shown the approval and merge panels.
   */
  it("never shows a decision for a change that has not been checked", () => {
    for (const stage of ["not_validated", "validating", "validation_failed"] as const) {
      expect(agentStageForChange(stage), stage).toBe("validate");
    }
  });

  /* After the fact, the decision screen is the record: what moved, on which
     commit, and whether it was read back. */
  it("keeps a merged change on the screen that records it", () => {
    expect(agentStageForChange("merged")).toBe("review");
    expect(agentStageForChange("observed")).toBe("review");
  });
});
