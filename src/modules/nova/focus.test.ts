import { describe, expect, it } from "vitest";

import type { ChangeStage } from "../execution/change-progress";
import type { OperationView } from "../operations/view";
import {
  FOCUS_CANDIDATE_KINDS,
  deriveNovaFocus,
  novaCandidateAction,
  novaCandidateTier,
} from "./focus";
import type { FocusCandidateKind, NovaFocusFacts, NovaMoveFact } from "./focus";

/**
 * The tests §O.1's ranking made possible and the single cascade could not have
 * had: several things true at once, and an assertion about which one leads.
 *
 * A cascade returns the first predicate that holds, so "a change awaiting
 * review *and* a stale audit" has no observable behaviour to test beyond the
 * winner — the loser is unreachable by construction. Here both are in the
 * result, and the order between them is the thing under test.
 */

/** Nothing waiting, nothing failed, nothing available. Every test starts here. */
function quiet(): NovaFocusFacts {
  return {
    changes: [],
    questions: [],
    moves: [],
    plannedMoveId: null,
    executableStep: null,
    planOffered: false,
    auditOutdated: false,
    repositoryReadOutdated: false,
    workspaceChoiceRequired: false,
    working: null,
  };
}

function move(rank: number, id = `move-${rank}`): NovaMoveFact {
  return { id, rank, title: `Move ${rank}` };
}

function changeAt(stage: ChangeStage, preparedChangeId = "change-1") {
  return { preparedChangeId, stage, headline: `Headline for ${stage}` };
}

const RUNNING: OperationView = {
  operationId: "op-1",
  status: "running",
  stage: "running_agent",
  startedAt: "2026-09-03T10:00:00.000Z",
  completedAt: null,
  failureCode: null,
  resultId: null,
  shouldPoll: true,
  retryAllowed: false,
  stalled: false,
};

describe("the candidate vocabulary", () => {
  it("gives every kind a tier", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      expect(novaCandidateTier(kind), kind).toBeDefined();
    }
  });

  /**
   * `nothing_to_do` is the one kind with no control, and that is the point: a
   * button on it would be Nova inventing work to look busy.
   */
  it("gives every kind but one a control", () => {
    for (const kind of FOCUS_CANDIDATE_KINDS) {
      const action = novaCandidateAction(kind);
      if (kind === "nothing_to_do") expect(action).toBeNull();
      else expect(action, kind).not.toBeNull();
    }
  });

  it("sorts the settled tier after every tier that means work", () => {
    expect(novaCandidateTier("nothing_to_do")).toBe("settled");
  });
});

describe("one candidate at a time", () => {
  it("says nothing_to_do when nothing is true", () => {
    const focus = deriveNovaFocus(quiet());

    expect(focus.primary.kind).toBe("nothing_to_do");
    expect(focus.secondary).toEqual([]);
    expect(focus.nextAction).toBeNull();
  });

  it("raises validation_failed from a failed check", () => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt("validation_failed")] });

    expect(focus.primary.kind).toBe("validation_failed");
    expect(focus.nextAction).toBe("nova.validate_again");
  });

  it("raises merge_blocked from a stalled change", () => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt("stalled")] });

    expect(focus.primary.kind).toBe("merge_blocked");
    expect(focus.nextAction).toBe("nova.review_change");
  });

  it("raises review_change from a change awaiting approval", () => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt("awaiting_approval")] });

    expect(focus.primary.kind).toBe("review_change");
    expect(focus.nextAction).toBe("nova.review_change");
  });

  it("raises merge_ready from an approved change", () => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt("ready_to_merge")] });

    expect(focus.primary.kind).toBe("merge_ready");
    expect(focus.nextAction).toBe("nova.merge_change");
  });

  it("raises outcome_pending from a merged change", () => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt("merged")] });

    expect(focus.primary.kind).toBe("outcome_pending");
    expect(focus.nextAction).toBe("nova.verify_outcome");
  });

  it("raises agent_question for a question the agent asked mid-run", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      questions: [
        {
          founderInputRequestId: "req-1",
          question: "Which pricing model?",
          origin: "execution_blocker",
          stepOrder: 2,
        },
      ],
    });

    expect(focus.primary.kind).toBe("agent_question");
    expect(focus.nextAction).toBe("nova.answer_agent_question");
  });

  it("raises founder_input_required for a question the plan asked", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      questions: [
        {
          founderInputRequestId: "req-2",
          question: "Which pricing model?",
          origin: "planner",
          stepOrder: 1,
        },
      ],
    });

    expect(focus.primary.kind).toBe("founder_input_required");
  });

  /**
   * The two questions carry different controls because they are answered by
   * different Server Actions, and only one of them left a run stopped.
   */
  it("gives the two kinds of question two different controls", () => {
    expect(novaCandidateAction("agent_question")).toBe("nova.answer_agent_question");
    expect(novaCandidateAction("founder_input_required")).toBe("nova.answer_plan_question");
  });

  it("raises repository_read_outdated", () => {
    const focus = deriveNovaFocus({ ...quiet(), repositoryReadOutdated: true });

    expect(focus.primary.kind).toBe("repository_read_outdated");
    expect(focus.nextAction).toBe("nova.rescan_product");
  });

  it("raises workspace_choice_required", () => {
    const focus = deriveNovaFocus({ ...quiet(), workspaceChoiceRequired: true });

    expect(focus.primary.kind).toBe("workspace_choice_required");
    expect(focus.nextAction).toBe("nova.choose_workspace");
  });

  it("raises execution_offered from a buildable step", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      executableStep: { order: 3, title: "Show the annual price" },
    });

    expect(focus.primary).toEqual({
      kind: "execution_offered",
      stepOrder: 3,
      stepTitle: "Show the annual price",
    });
    expect(focus.nextAction).toBe("nova.start_agent");
  });

  it("raises plan_offered for the top Move when no plan covers it", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      moves: [move(2), move(1)],
      planOffered: true,
    });

    expect(focus.primary).toEqual({ kind: "plan_offered", move: move(1) });
    expect(focus.nextAction).toBe("nova.plan_move");
  });

  it("raises audit_outdated", () => {
    const focus = deriveNovaFocus({ ...quiet(), auditOutdated: true });

    expect(focus.primary.kind).toBe("audit_outdated");
    expect(focus.nextAction).toBe("nova.refresh_audit");
  });
});

/**
 * Every stage `deriveChangeProgress` can produce, and what Nova does with it.
 *
 * Typed as a `Record<ChangeStage, …>` rather than a list, so a stage added
 * upstream fails this file's *compile* — the same guarantee `focus.ts`'s
 * `switch` gives the implementation. A change in a state nobody mapped would
 * be a founder with no way forward, which is the one thing every surface in
 * this product is required not to do.
 */
const STAGE_EXPECTATION: Record<ChangeStage, FocusCandidateKind> = {
  validation_failed: "validation_failed",
  stalled: "merge_blocked",
  review_required: "review_change",
  review_unavailable: "review_change",
  awaiting_approval: "review_change",
  ready_to_merge: "merge_ready",
  merged: "outcome_pending",
  /* Vibe owes the next move in all five of these, so none is a decision. */
  not_validated: "nothing_to_do",
  validating: "nothing_to_do",
  reviewing: "nothing_to_do",
  merging: "nothing_to_do",
  observed: "nothing_to_do",
};

describe("every change stage", () => {
  it.each(Object.entries(STAGE_EXPECTATION))("maps %s to %s", (stage, expected) => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt(stage as ChangeStage)] });

    expect(focus.primary.kind).toBe(expected);
  });

  /**
   * The one that would be a safety defect rather than a cosmetic one: an
   * unchecked change presented as ready to look at reads as "Vibe checked
   * this", which is the false confidence rule 66 exists to refuse.
   */
  it("never presents an unvalidated change as reviewable", () => {
    const focus = deriveNovaFocus({ ...quiet(), changes: [changeAt("not_validated")] });

    expect(focus.primary.kind).not.toBe("review_change");
    expect(focus.secondary.map((candidate) => candidate.kind)).not.toContain("review_change");
  });
});

describe("ordering when several things are true", () => {
  /** §O.1's own example, and the reason the shape changed. */
  it("leads with a change awaiting review over a stale audit, and keeps both", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [changeAt("awaiting_approval")],
      auditOutdated: true,
    });

    expect(focus.primary.kind).toBe("review_change");
    expect(focus.secondary.map((candidate) => candidate.kind)).toEqual(["audit_outdated"]);
  });

  it("leads with a blocked candidate over a decision", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [
        changeAt("validation_failed", "change-a"),
        changeAt("awaiting_approval", "change-b"),
      ],
    });

    expect(focus.primary.kind).toBe("validation_failed");
  });

  it("leads with a decision over work available to start", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [changeAt("awaiting_approval")],
      executableStep: { order: 1, title: "Show the annual price" },
    });

    expect(focus.primary.kind).toBe("review_change");
  });

  it("leads with work available to start over a stale audit", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      executableStep: { order: 1, title: "Show the annual price" },
      auditOutdated: true,
    });

    expect(focus.primary.kind).toBe("execution_offered");
  });

  /**
   * All three are `decision`, so the tier cannot separate them. An agent that
   * stopped mid-run is holding a sandbox and a Credit hold open; a finished
   * change is not.
   */
  it("puts an interrupted agent ahead of a finished change", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [changeAt("ready_to_merge", "change-a"), changeAt("awaiting_approval", "change-b")],
      questions: [
        {
          founderInputRequestId: "req-1",
          question: "Which pricing model?",
          origin: "execution_blocker",
          stepOrder: null,
        },
      ],
    });

    expect([focus.primary, ...focus.secondary].map((candidate) => candidate.kind)).toEqual([
      "agent_question",
      "review_change",
      "merge_ready",
    ]);
  });

  it("breaks a tie inside one kind by the domain's own rank", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      questions: [
        {
          founderInputRequestId: "req-late",
          question: "Second",
          origin: "planner",
          stepOrder: 4,
        },
        {
          founderInputRequestId: "req-early",
          question: "First",
          origin: "planner",
          stepOrder: 2,
        },
      ],
    });

    expect([focus.primary, ...focus.secondary]).toEqual([
      {
        kind: "founder_input_required",
        founderInputRequestId: "req-early",
        question: "First",
        stepOrder: 2,
      },
      {
        kind: "founder_input_required",
        founderInputRequestId: "req-late",
        question: "Second",
        stepOrder: 4,
      },
    ]);
  });

  it("sorts a candidate with no rank after one that has one", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      questions: [
        {
          founderInputRequestId: "req-a",
          question: "Unranked",
          origin: "planner",
          stepOrder: null,
        },
        { founderInputRequestId: "req-b", question: "Ranked", origin: "planner", stepOrder: 9 },
      ],
    });

    expect([focus.primary, ...focus.secondary].map((c) => c.kind)).toEqual([
      "founder_input_required",
      "founder_input_required",
    ]);
    expect(focus.primary).toMatchObject({ founderInputRequestId: "req-b" });
  });

  it("orders two changes in the same stage stably by subject", () => {
    const first = deriveNovaFocus({
      ...quiet(),
      changes: [
        changeAt("awaiting_approval", "change-b"),
        changeAt("awaiting_approval", "change-a"),
      ],
    });
    const second = deriveNovaFocus({
      ...quiet(),
      changes: [
        changeAt("awaiting_approval", "change-a"),
        changeAt("awaiting_approval", "change-b"),
      ],
    });

    expect(first.primary).toMatchObject({ preparedChangeId: "change-a" });
    expect(first).toEqual(second);
  });

  it("loses no candidate: everything true is either primary or secondary", () => {
    const facts: NovaFocusFacts = {
      changes: [changeAt("validation_failed", "change-a"), changeAt("merged", "change-b")],
      questions: [
        { founderInputRequestId: "req-1", question: "Q", origin: "planner", stepOrder: 1 },
      ],
      moves: [move(1), move(2)],
      plannedMoveId: "move-1",
      executableStep: null,
      planOffered: false,
      auditOutdated: true,
      repositoryReadOutdated: true,
      workspaceChoiceRequired: true,
      working: null,
    };

    const focus = deriveNovaFocus(facts);
    const kinds = [focus.primary, ...focus.secondary].map((candidate) => candidate.kind);

    expect(kinds).toEqual([
      "validation_failed",
      "repository_read_outdated",
      "founder_input_required",
      "workspace_choice_required",
      "outcome_pending",
      "next_move_available",
      "audit_outdated",
    ]);
  });

  it("never shows nothing_to_do beside something to do", () => {
    const focus = deriveNovaFocus({ ...quiet(), auditOutdated: true });

    expect([focus.primary, ...focus.secondary].map((c) => c.kind)).not.toContain("nothing_to_do");
  });

  it("always carries the primary's own control as nextAction", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [changeAt("validation_failed")],
      auditOutdated: true,
    });

    expect(focus.nextAction).toBe(novaCandidateAction(focus.primary.kind));
  });
});

describe("the next Move", () => {
  it("is not offered while a step of this plan is still buildable", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      moves: [move(1), move(2)],
      plannedMoveId: "move-1",
      executableStep: { order: 1, title: "Show the annual price" },
    });

    expect([focus.primary, ...focus.secondary].map((c) => c.kind)).toEqual(["execution_offered"]);
  });

  it("is the lowest-ranked Move the current plan does not cover", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      moves: [move(3), move(1), move(2)],
      plannedMoveId: "move-1",
    });

    expect(focus.primary).toEqual({ kind: "next_move_available", move: move(2) });
  });

  it("is absent when the plan already covers the only Move", () => {
    const focus = deriveNovaFocus({ ...quiet(), moves: [move(1)], plannedMoveId: "move-1" });

    expect(focus.primary.kind).toBe("nothing_to_do");
  });

  /** `planOffered` and `next_move_available` are never both true. */
  it("gives way to plan_offered, which is about the Move in hand", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      moves: [move(1), move(2)],
      plannedMoveId: null,
      planOffered: true,
    });

    expect([focus.primary, ...focus.secondary].map((c) => c.kind)).toEqual(["plan_offered"]);
  });
});

describe("what is running", () => {
  it("carries the operation through without turning it into a candidate", () => {
    const focus = deriveNovaFocus({ ...quiet(), working: RUNNING });

    expect(focus.working).toBe(RUNNING);
    expect(focus.primary.kind).toBe("nothing_to_do");
  });

  /**
   * The §O.1 collapse rule, observable: a validating change is work in
   * flight, so it is shown as progress and asked about nowhere.
   */
  it("shows a validating change as progress rather than as a decision", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [changeAt("validating")],
      working: RUNNING,
    });

    expect(focus.working).toBe(RUNNING);
    expect(focus.primary.kind).toBe("nothing_to_do");
  });

  it("still leads with a decision while something else runs", () => {
    const focus = deriveNovaFocus({
      ...quiet(),
      changes: [changeAt("awaiting_approval", "change-a"), changeAt("validating", "change-b")],
      working: RUNNING,
    });

    expect(focus.primary.kind).toBe("review_change");
    expect(focus.working).toBe(RUNNING);
  });
});
