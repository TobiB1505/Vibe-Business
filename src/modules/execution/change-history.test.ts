import { describe, expect, it } from "vitest";
import type { ChangeApproval } from "@/modules/approvals/schema";
import type { ChangeMerge } from "@/modules/merge/schema";
import type { StoredValidationRun } from "@/modules/validation/store";
import {
  CHANGE_HISTORY_OUTCOMES,
  changeHistoryOutcome,
  type ChangeHistoryOutcome,
} from "./change-history";
import {
  CHANGE_HISTORY_LABELS,
  CHANGE_HISTORY_OPEN,
  CHANGE_HISTORY_TONES,
} from "./change-history-view";
import type { PreparedChangeStatus } from "./schema";

/**
 * What became of a change, and what a list is allowed to say about it.
 *
 * The history is sorted by change rather than by run, so this projection is
 * what every row's word comes from. Two of its answers are claims this product
 * is specifically able to overstate — a merge, and an ambiguous write — and
 * both are asserted here rather than left to the table's copy.
 */

function outcomeOf(
  overrides: Partial<{
    status: PreparedChangeStatus;
    validation: StoredValidationRun | null;
    approval: ChangeApproval | null;
    merge: ChangeMerge | null;
  }> = {},
): ChangeHistoryOutcome {
  return changeHistoryOutcome({
    status: "prepared",
    validation: null,
    approval: null,
    merge: null,
    ...overrides,
  });
}

/** Only the fields the projection reads. The rest of a row is not its business. */
const validation = (status: string) => ({ status }) as StoredValidationRun;
const approval = (status: string) => ({ status }) as ChangeApproval;
const merge = (status: ChangeMerge["status"]) => ({ status }) as ChangeMerge;

describe("what became of a change", () => {
  it("says nobody has decided when nothing has happened to it", () => {
    expect(outcomeOf()).toBe("waiting");
  });

  it("reads from the far end backwards", () => {
    /*
     * A merged change has been through every gate before it, so an early
     * gate's row must not speak for it. This is the same direction
     * `deriveChangeProgress` reads in, and the case that proves it is a merged
     * change whose validation row says something else entirely.
     */
    expect(
      outcomeOf({
        validation: validation("failed"),
        approval: approval("approved"),
        merge: merge("merged"),
      }),
    ).toBe("merged");
  });

  it("lets a passed validation say nothing on its own", () => {
    // Checks passing is not a decision. Somebody still has to make one.
    expect(outcomeOf({ validation: validation("passed") })).toBe("waiting");
  });

  it("names an approval that has not been acted on", () => {
    expect(outcomeOf({ validation: validation("passed"), approval: approval("approved") })).toBe(
      "approved",
    );
  });

  it("does not let a revoked or invalidated approval count as one", () => {
    for (const state of ["revoked", "invalidated"]) {
      expect(outcomeOf({ approval: approval(state) }), state).toBe("waiting");
    }
  });

  it("says the checks failed when they did", () => {
    expect(outcomeOf({ validation: validation("failed") })).toBe("checks_failed");
  });

  /**
   * Rule 73, in a list.
   *
   * A `merging` row means a write was attempted and nobody has read the branch
   * back yet. The safe next move is an independent read, never a guess — so a
   * list must not resolve it to either side, and both it and an outright
   * failure read as stopped.
   */
  it("never resolves an ambiguous write", () => {
    expect(outcomeOf({ merge: merge("merging") })).toBe("merge_stopped");
    expect(outcomeOf({ merge: merge("failed") })).toBe("merge_stopped");
  });

  it("keeps a refusal apart from a failed write", () => {
    // `blocked` means the repository was not touched, which is a different
    // thing to tell a founder than "a write stopped somewhere".
    expect(outcomeOf({ merge: merge("blocked") })).toBe("merge_refused");
  });

  it("treats an authorized-but-unattempted merge as the approval it rests on", () => {
    // `preflight`: a human said yes and nothing has been written. Saying
    // anything about the merge would be describing a write that never began.
    expect(outcomeOf({ approval: approval("approved"), merge: merge("preflight") })).toBe(
      "approved",
    );
  });

  /**
   * The change's own status wins over every gate.
   *
   * A discarded change can carry a passed validation and an approval that was
   * later revoked; reading the gates first would show it as waiting for a
   * decision somebody has already made.
   */
  it("says a person said no, whatever the gates hold", () => {
    expect(
      outcomeOf({
        status: "discarded",
        validation: validation("passed"),
        approval: approval("revoked"),
      }),
    ).toBe("discarded");
  });

  it("keeps an unfinished preparation apart from one waiting on a person", () => {
    // `waiting` means nobody has decided. There is nothing to decide about a
    // change Vibe is still writing.
    expect(outcomeOf({ status: "preparing" })).toBe("preparing");
    expect(outcomeOf({ status: "failed" })).toBe("failed");
  });
});

describe("what a row is allowed to say", () => {
  it("gives every outcome a label, a tone and an answer about whose turn it is", () => {
    for (const outcome of CHANGE_HISTORY_OUTCOMES) {
      expect(CHANGE_HISTORY_LABELS[outcome], outcome).toBeTruthy();
      expect(CHANGE_HISTORY_TONES[outcome], outcome).toBeTruthy();
      expect(typeof CHANGE_HISTORY_OPEN[outcome], outcome).toBe("boolean");
    }
  });

  /**
   * Rule 74, in a word.
   *
   * `merged` means the default branch points at the approved commit and Vibe
   * read it back. Vibe calls no deployment provider, so every stronger word is
   * a claim about the customer's own pipeline.
   */
  it("never claims a deployment", () => {
    for (const label of Object.values(CHANGE_HISTORY_LABELS)) {
      expect(label.toLowerCase(), label).not.toMatch(/deploy|ship|release|live|launch/);
    }
  });

  it("gives exactly one outcome the success register", () => {
    const successes = CHANGE_HISTORY_OUTCOMES.filter(
      (outcome) => CHANGE_HISTORY_TONES[outcome] === "success",
    );
    expect(successes).toEqual(["merged"]);
  });

  it("does not treat a founder saying no as a fault", () => {
    // Discarding is the product working. `problem` would tell a founder their
    // own decision went wrong.
    expect(CHANGE_HISTORY_TONES.discarded).toBe("neutral");
    expect(CHANGE_HISTORY_OPEN.discarded).toBe(false);
  });

  it("counts an ambiguous write as still somebody's turn", () => {
    // Somebody has to read the branch before this change means anything.
    expect(CHANGE_HISTORY_OPEN.merge_stopped).toBe(true);
  });
});
